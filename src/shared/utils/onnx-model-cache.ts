/**
 * Durable Cache Storage layer for models loaded directly through onnxruntime-web.
 *
 * Models that go through transformers.js get cached automatically (`env.useBrowserCache`).
 * Models we hand to `InferenceSession.create()` ourselves do NOT — onnxruntime-web fetches
 * the weights with a plain network request and relies only on the volatile browser HTTP
 * cache, which evicts multi-hundred-MB/GB files. These helpers mirror the transformers.js
 * behaviour: check Cache Storage first, fetch + persist on a miss, keyed by URL. The bucket
 * is inspectable/clearable from Settings via `local-model-cache.ts`.
 *
 * Worker-safe: depends only on `caches`/`fetch`/`Response`, all available in workers.
 */

export const ONNX_MODEL_CACHE_NAME = 'onnx-model-cache'

function getCacheStorage(): CacheStorage | null {
  if (typeof globalThis === 'undefined' || !('caches' in globalThis)) {
    return null
  }
  try {
    return globalThis.caches
  } catch {
    // Accessing `caches` throws in insecure contexts (non-HTTPS, non-localhost).
    return null
  }
}

async function openCache(): Promise<Cache | null> {
  const storage = getCacheStorage()
  if (!storage) {
    return null
  }
  try {
    return await storage.open(ONNX_MODEL_CACHE_NAME)
  } catch {
    return null
  }
}

async function readWithProgress(
  response: Response,
  onBytes: ProgressFn | undefined,
  fromCache: boolean,
): Promise<ArrayBuffer> {
  if (!response.body || !onBytes) {
    return response.arrayBuffer()
  }

  const total = Number(response.headers.get('content-length')) || 0
  const reader = response.body.getReader()
  let received = 0

  // Fast path: with a known length, stream chunks straight into one
  // preallocated buffer. Avoids retaining every chunk and then copying the whole
  // thing again into a second full-size array — which doubles peak memory for
  // multi-hundred-MB ONNX weights. `prefixLen` tracks bytes written into the
  // buffer; if the server's content-length undercounts the body, overflow chunks
  // spill into `tail` and we merge once at the end.
  if (total > 0) {
    const buffer = new Uint8Array(total)
    const tail: Uint8Array[] = []
    let prefixLen = 0

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (tail.length === 0 && prefixLen + value.byteLength <= total) {
        buffer.set(value, prefixLen)
        prefixLen += value.byteLength
      } else {
        tail.push(value)
      }
      received += value.byteLength
      onBytes(received, total, fromCache)
    }

    if (tail.length === 0) {
      // Common case: content-length was exact (or the body was shorter).
      return prefixLen === total ? buffer.buffer : buffer.buffer.slice(0, prefixLen)
    }

    const merged = new Uint8Array(received)
    merged.set(buffer.subarray(0, prefixLen))
    let offset = prefixLen
    for (const chunk of tail) {
      merged.set(chunk, offset)
      offset += chunk.byteLength
    }
    return merged.buffer
  }

  // Fallback: unknown length — accumulate chunks, then merge once.
  const chunks: Uint8Array[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.byteLength
    onBytes(received, total, fromCache)
  }

  const merged = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return merged.buffer
}

/**
 * `fromCache` lets callers distinguish a warm read (bytes replayed off disk in a blink) from
 * a cold multi-hundred-MB network transfer. Both report byte progress, so without this flag
 * a UI cannot tell the user which one it is waiting on.
 */
type ProgressFn = (received: number, total: number, fromCache: boolean) => void

/**
 * In-flight `fetchOnnxModelBytes` requests, keyed by URL. Without this, two callers
 * racing on the same uncached URL (a component mounting twice, or shared config/weights
 * URLs) would each `fetch` and download multi-hundred-MB weights in parallel. Concurrent
 * callers share the single download; their progress callbacks are fanned out via `listeners`.
 */
const inFlightModelBytes = new Map<
  string,
  { promise: Promise<ArrayBuffer>; listeners: Set<ProgressFn> }
>()

async function downloadOnnxModelBytes(url: string, onBytes: ProgressFn): Promise<ArrayBuffer> {
  const cache = await openCache()
  const cached = cache ? await cache.match(url).catch(() => undefined) : undefined

  if (cached) {
    return readWithProgress(cached, onBytes, true)
  }

  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new Error(`Failed to fetch ${url} (${response.status} ${response.statusText})`)
  }

  const contentType = response.headers.get('content-type') ?? 'application/octet-stream'
  const bytes = await readWithProgress(response, onBytes, false)

  if (cache) {
    // Rebuild a Response from the downloaded bytes; the original stream is already consumed.
    // content-length is set so the Settings cache inspector can report the on-disk size.
    const cacheable = new Response(bytes, {
      headers: {
        'content-type': contentType,
        'content-length': String(bytes.byteLength),
      },
    })
    await cache.put(url, cacheable).catch(() => {})
  }

  return bytes
}

/**
 * Fetch model weights as an ArrayBuffer, serving from (and populating) Cache Storage.
 * Progress is reported on both the network and the cache-hit path so the loading bar
 * behaves identically whether or not the model was already downloaded.
 *
 * Concurrent requests for the same URL are deduplicated to a single download; each
 * caller's `onBytes` still receives progress. Returns the same ArrayBuffer instance to
 * all in-flight callers.
 */
export function fetchOnnxModelBytes(url: string, onBytes?: ProgressFn): Promise<ArrayBuffer> {
  const existing = inFlightModelBytes.get(url)
  if (existing) {
    if (onBytes) existing.listeners.add(onBytes)
    return existing.promise
  }

  const listeners = new Set<ProgressFn>()
  if (onBytes) listeners.add(onBytes)
  const broadcast: ProgressFn = (received, total, fromCache) => {
    for (const fn of listeners) fn(received, total, fromCache)
  }

  const promise = downloadOnnxModelBytes(url, broadcast).finally(() => {
    inFlightModelBytes.delete(url)
  })
  inFlightModelBytes.set(url, { promise, listeners })
  return promise
}

/** Fetch a small text asset (vocab, etc.), serving from / populating Cache Storage. */
export async function fetchOnnxModelText(url: string): Promise<string> {
  const cache = await openCache()
  const cached = cache ? await cache.match(url).catch(() => undefined) : undefined
  if (cached) {
    return cached.text()
  }

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url} (${response.status} ${response.statusText})`)
  }
  if (cache) {
    await cache.put(url, response.clone()).catch(() => {})
  }
  return response.text()
}

/** Fetch a small JSON asset (config, tokenizer, voice style), with the same caching. */
export async function fetchOnnxModelJson<T>(url: string): Promise<T> {
  return JSON.parse(await fetchOnnxModelText(url)) as T
}
