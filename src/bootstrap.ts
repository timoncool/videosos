const APP_SHELL_CACHE_PREFIX = 'freecut-app-shell-'

async function removeProductionAppShellFromDevelopment(): Promise<boolean> {
  if (!import.meta.env.DEV) return false

  const wasControlled = 'serviceWorker' in navigator && navigator.serviceWorker.controller !== null

  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(
      registrations
        .filter((registration) => registration.scope.startsWith(window.location.origin))
        .map((registration) => registration.unregister()),
    )
  }

  if ('caches' in window) {
    const cacheNames = await caches.keys()
    await Promise.all(
      cacheNames
        .filter((cacheName) => cacheName.startsWith(APP_SHELL_CACHE_PREFIX))
        .map((cacheName) => caches.delete(cacheName)),
    )
  }

  return wasControlled
}

void removeProductionAppShellFromDevelopment()
  .then((requiresReload) => {
    if (requiresReload) {
      window.location.reload()
      return
    }
    return import('./main')
  })
  .catch(() => import('./main'))
