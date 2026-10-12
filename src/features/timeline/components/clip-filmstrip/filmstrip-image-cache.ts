const MAX_DECODED_FILMSTRIP_IMAGES = 512

interface CachedFilmstripImage {
  image: HTMLImageElement
  status: 'loading' | 'ready' | 'error'
  listeners: Set<{
    onChange: () => void
    onError: () => void
  }>
}

const decodedImages = new Map<string, CachedFilmstripImage>()

function touch(url: string, entry: CachedFilmstripImage): void {
  decodedImages.delete(url)
  decodedImages.set(url, entry)
}

function prune(): void {
  if (decodedImages.size <= MAX_DECODED_FILMSTRIP_IMAGES) return

  for (const [url, entry] of decodedImages) {
    if (decodedImages.size <= MAX_DECODED_FILMSTRIP_IMAGES) break
    if (entry.listeners.size > 0) continue

    entry.image.onload = null
    entry.image.onerror = null
    entry.image.src = ''
    decodedImages.delete(url)
  }
}

function createEntry(url: string): CachedFilmstripImage {
  const image = new Image()
  image.decoding = 'async'
  const entry: CachedFilmstripImage = {
    image,
    status: 'loading',
    listeners: new Set(),
  }
  image.onload = () => {
    entry.status = 'ready'
    for (const listener of entry.listeners) {
      listener.onChange()
    }
  }
  image.onerror = () => {
    entry.status = 'error'
    for (const listener of entry.listeners) {
      listener.onError()
    }
  }
  image.src = url
  decodedImages.set(url, entry)
  return entry
}

export function subscribeFilmstripImage(
  url: string,
  onChange: () => void,
  onError: () => void,
): () => void {
  const entry = decodedImages.get(url) ?? createEntry(url)
  const listener = { onChange, onError }
  entry.listeners.add(listener)
  touch(url, entry)
  prune()
  if (entry.status === 'ready') {
    onChange()
  } else if (entry.status === 'error') {
    onError()
  }

  return () => {
    entry.listeners.delete(listener)
    prune()
  }
}

export function getDecodedFilmstripImage(url: string): HTMLImageElement | null {
  const entry = decodedImages.get(url)
  if (!entry || entry.status !== 'ready') return null
  touch(url, entry)
  return entry.image
}

export function resetDecodedFilmstripImagesForTest(): void {
  for (const entry of decodedImages.values()) {
    entry.image.onload = null
    entry.image.onerror = null
    entry.image.src = ''
  }
  decodedImages.clear()
}
