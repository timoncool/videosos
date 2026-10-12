type MediaLibraryServiceModule = typeof import('../services/media-library-service')
type MediaLibraryServiceLoader = () => Promise<MediaLibraryServiceModule>

let serviceLoader: MediaLibraryServiceLoader | null = null

export function registerMediaLibraryServiceLoader(loader: MediaLibraryServiceLoader): () => void {
  serviceLoader = loader
  return () => {
    if (serviceLoader === loader) {
      serviceLoader = null
    }
  }
}

export function loadMediaLibraryService(): Promise<MediaLibraryServiceModule> {
  if (!serviceLoader) {
    throw new Error('Media library service loader is not registered')
  }
  return serviceLoader()
}
