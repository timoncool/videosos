import type {
  MainThreadMessage,
  PCMChunk,
  TranscriptWord,
  WhisperWorkerMessage,
} from '../types'
import { getChunkStartProgress, transcribingProgressEvent } from '../lib/chunk-progress'
import {
  updateDownloadProgress,
  type DownloadProgressCache,
} from '@/shared/utils/download-progress'
import { joinTranscriptWords } from '@/shared/utils/transcript-text'
import { resolveWhisperWordTimings, type RawWhisperWord } from '../lib/whisper-word-timings'

const TRANSFORMERS_CDN_URL = 'https://esm.sh/@huggingface/transformers@3.8.1?bundle'
const WASM_CDN_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/'
const WHISPER_CHUNK_SECONDS = 30
const WHISPER_STRIDE_SECONDS = 5
const WHISPER_TASK = 'transcribe'
const RECENT_WORD_RETENTION_SECONDS = 8
const DUPLICATE_WORD_START_TOLERANCE_SECONDS = 0.5

type ASRPipeline = (input: Float32Array, options: Record<string, unknown>) => Promise<unknown>

interface ProgressInfo {
  status?: string
  file?: string
  progress?: number
  loaded?: number
  total?: number
}

interface TransformersModule {
  env: {
    useBrowserCache: boolean
    allowLocalModels: boolean
    backends: {
      onnx: {
        wasm: {
          wasmPaths?: string
          numThreads?: number
        }
      }
    }
  }
  pipeline: (
    task: string,
    modelId: string,
    options: {
      device: 'webgpu' | 'wasm'
      dtype: Record<string, string> | string
      progress_callback?: (progress: ProgressInfo) => void
    },
  ) => Promise<ASRPipeline>
}

let asrPipeline: ASRPipeline | null = null
let currentModelId: string | null = null
let port: MessagePort | null = null
let language: string | undefined
let pipelineReady = false
let paused = false
// Serializes init so a pre-warm init and the real job's init can't load concurrently.
let initChain: Promise<void> = Promise.resolve()
const queue: PCMChunk[] = []
const recentWords: TranscriptWord[] = []
let processing = false
let reportedEstimatedBytes = 0

self.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
  const reason = event.reason
  const message =
    reason instanceof Error
      ? `${reason.name}: ${reason.message}`
      : typeof reason === 'string'
        ? reason
        : 'Unknown worker error'
  postMain({ type: 'error', message })
  event.preventDefault()
})

self.addEventListener('error', (event: ErrorEvent) => {
  postMain({
    type: 'error',
    message: event.message || (event.error instanceof Error ? event.error.message : 'Worker error'),
  })
})

self.onmessage = async (event: MessageEvent) => {
  const message = event.data as WhisperWorkerMessage

  if (message.type === 'port') {
    port = message.port
    port.onmessage = (portEvent: MessageEvent<PCMChunk>) => {
      enqueue(portEvent.data)
    }
    return
  }

  if (message.type === 'init') {
    // Reset per-job state — the worker (and its compiled pipeline) is reused across jobs.
    language = message.language
    recentWords.length = 0
    queue.length = 0
    processing = false
    paused = false
    initChain = initChain
      .then(() => initPipeline(message.modelId))
      .catch(() => {})
    await initChain
    return
  }

  if (message.type === 'pause') {
    paused = true
    return
  }

  if (message.type === 'resume') {
    if (!paused) return
    paused = false
    if (pipelineReady && !processing && queue.length > 0) {
      void processNext()
    }
  }
}

function enqueue(chunk: PCMChunk): void {
  queue.push(chunk)
  port?.postMessage(queue.length)
  if (pipelineReady && !processing && !paused) {
    void processNext()
  }
}

async function initPipeline(modelId: string): Promise<void> {
  postMain({ type: 'progress', event: { stage: 'downloading', progress: 0 } })
  reportedEstimatedBytes = 0

  try {
    const { pipeline, env } = (await import(
      /* @vite-ignore */ TRANSFORMERS_CDN_URL
    )) as TransformersModule

    env.useBrowserCache = true
    env.allowLocalModels = false
    env.backends.onnx.wasm.wasmPaths = WASM_CDN_URL
    env.backends.onnx.wasm.numThreads = Math.min(8, Math.max(1, Math.floor((navigator.hardwareConcurrency || 2) / 2)))

    if (asrPipeline && currentModelId !== modelId) {
      const disposable = asrPipeline as ASRPipeline & { dispose?: () => Promise<void> | void }
      await disposable.dispose?.()
      asrPipeline = null
    }

    if (!asrPipeline || currentModelId !== modelId) {
      currentModelId = modelId
      const downloadCache: DownloadProgressCache = new Map()

      const progressCallback = (progress: ProgressInfo) => {
        if (progress.status !== 'progress') {
          return
        }

        const downloadProgress = updateDownloadProgress(progress, downloadCache)
        if (!downloadProgress) return

        if (downloadProgress.total > reportedEstimatedBytes) {
          reportedEstimatedBytes = downloadProgress.total
          postMain({ type: 'runtime', info: { estimatedBytes: downloadProgress.total } })
        }

        postMain({
          type: 'progress',
          event: {
            stage: 'downloading',
            progress: downloadProgress.fraction,
            receivedBytes: downloadProgress.loaded,
            totalBytes: downloadProgress.total,
          },
        })
      }

      // int8 on ORT-web's WebGPU decodes to garbage; q8 on multi-threaded WASM is exact
      asrPipeline = await pipeline('automatic-speech-recognition', modelId, {
        device: 'wasm',
        dtype: 'q8',
        progress_callback: progressCallback,
      })
      postMain({ type: 'runtime', info: { backend: 'wasm' } })

      // Weights are down; what remains is graph compile + the pre-warm inference below,
      // neither of which reports progress.
      postMain({ type: 'progress', event: { stage: 'preparing', progress: 0 } })
      try {
        await asrPipeline(new Float32Array(1_600), {
          sampling_rate: 16_000,
          task: WHISPER_TASK,
          ...(language ? { language } : {}),
        })
      } catch {
        // Ignore pre-warm failures. Real inference may still succeed.
      }
    }

    pipelineReady = true
    postMain({ type: 'progress', event: { stage: 'preparing', progress: 1 } })
    postMain({ type: 'ready' })

    if (queue.length > 0 && !processing) {
      void processNext()
    }
  } catch (error) {
    currentModelId = null
    asrPipeline = null
    pipelineReady = false
    postMain({
      type: 'error',
      message: `Failed to initialize Whisper model: ${
        error instanceof Error ? error.message : String(error)
      }`,
    })
  }
}

async function processNext(): Promise<void> {
  if (!pipelineReady || !asrPipeline || paused) {
    processing = false
    return
  }

  const chunk = queue.shift()
  if (!chunk) {
    processing = false
    return
  }

  processing = true
  port?.postMessage(queue.length)

  try {
    await transcribeChunk(chunk)
  } catch (error) {
    postMain({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    })
    processing = false
    return
  }

  processing = false
  if (queue.length > 0 && !paused) {
    void processNext()
  }
}

async function transcribeChunk(chunk: PCMChunk): Promise<void> {
  if (!asrPipeline) {
    return
  }

  if (chunk.samples.length === 0) {
    if (chunk.final) {
      postMain({ type: 'progress', event: { stage: 'transcribing', progress: 1 } })
      postMain({ type: 'done' })
    }
    return
  }

  const startProgress = getChunkStartProgress(chunk)
  if (startProgress !== null) {
    postMain({ type: 'progress', event: { stage: 'transcribing', progress: startProgress } })
  }

  const result = await asrPipeline(chunk.samples, {
    sampling_rate: 16_000,
    return_timestamps: 'word',
    chunk_length_s: WHISPER_CHUNK_SECONDS,
    stride_length_s: WHISPER_STRIDE_SECONDS,
    batch_size: 1,
    force_full_sequences: false,
    top_k: 0,
    do_sample: false,
    task: WHISPER_TASK,
    ...(language ? { language } : {}),
  })

  const output = result as {
    text?: string
    chunks?: RawWhisperWord[]
  }

  const words = dedupeOverlappingWords(
    resolveWhisperWordTimings(output.chunks ?? [], chunk.timestamp, chunk.samples.length / 16_000),
  )

  if (words.length > 0) {
    const newestEnd = words.at(-1)?.end ?? chunk.timestamp
    recentWords.push(...words)
    while (
      recentWords.length > 0 &&
      (recentWords[0]?.end ?? 0) < newestEnd - RECENT_WORD_RETENTION_SECONDS
    ) {
      recentWords.shift()
    }
  }

  if (words.length > 0) {
    postMain({
      type: 'segment',
      segment: {
        text: joinTranscriptWords(words.map((word) => word.text)),
        start: words[0]?.start ?? chunk.timestamp,
        end: words.at(-1)?.end ?? chunk.timestamp,
        words,
      },
    })
  }

  postMain({ type: 'progress', event: transcribingProgressEvent(chunk) })

  if (chunk.final) {
    postMain({ type: 'done' })
  }
}

function dedupeOverlappingWords(words: TranscriptWord[]): TranscriptWord[] {
  return words.filter((word) => {
    const normalizedText = normalizeWordText(word.text)
    if (!normalizedText) {
      return true
    }

    return !recentWords.some((recentWord) => {
      if (normalizeWordText(recentWord.text) !== normalizedText) {
        return false
      }

      const startsClose =
        Math.abs(recentWord.start - word.start) <= DUPLICATE_WORD_START_TOLERANCE_SECONDS
      const overlaps = recentWord.start < word.end && word.start < recentWord.end
      return startsClose || overlaps
    })
  })
}

function normalizeWordText(text: string): string {
  return text.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
}

function postMain(message: MainThreadMessage): void {
  ;(self as unknown as Worker).postMessage(message)
}
