import { registerMediaLibraryServiceLoader } from '../stores/media-library-service-access'

export const importMediaLibraryService = () => import('./media-library-service')

const unregisterMediaLibraryServiceLoader =
  registerMediaLibraryServiceLoader(importMediaLibraryService)

if (import.meta.hot) {
  import.meta.hot.dispose(unregisterMediaLibraryServiceLoader)
}
