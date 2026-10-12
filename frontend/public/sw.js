// __FREECUT_BUILD_ID__ is replaced at build time (see serviceWorkerVersionPlugin in
// vite.config.ts) with the hashed entry-chunk filename, so the cache name — and the SW
// file bytes — change on every deploy. That lets registration.update() detect new
// versions and lets `activate` purge the previous deploy's cached chunks. In dev the SW
// is never registered (PROD-gated in main.tsx), so the unreplaced literal is harmless.
const CACHE_VERSION = 'freecut-app-shell-__FREECUT_BUILD_ID__'
const APP_SHELL_URLS = [
  '/',
  '/index.html',
  '/favicon.svg',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
]
const CACHEABLE_DESTINATIONS = new Set(['document', 'script', 'style', 'font', 'image'])
const EXCLUDED_PATH_PREFIXES = ['/moss-tts/']
const MAX_DYNAMIC_CACHE_ENTRIES = 160

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      return cache.addAll(APP_SHELL_URLS)
    }),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      caches
        .keys()
        .then((cacheNames) =>
          Promise.all(
            cacheNames
              .filter((cacheName) => cacheName !== CACHE_VERSION)
              .map((cacheName) => caches.delete(cacheName)),
          ),
        ),
      self.clients.claim(),
    ]),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  if (request.method !== 'GET') {
    return
  }

  const url = new URL(request.url)

  if (url.origin !== self.location.origin) {
    return
  }

  if (EXCLUDED_PATH_PREFIXES.some((pathPrefix) => url.pathname.startsWith(pathPrefix))) {
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstWithOfflineFallback(request))
    return
  }

  if (!CACHEABLE_DESTINATIONS.has(request.destination)) {
    return
  }

  event.respondWith(staleWhileRevalidate(request))
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

async function networkFirstWithOfflineFallback(request) {
  const cache = await caches.open(CACHE_VERSION)

  try {
    const response = await fetch(request)
    if (response.ok) {
      cache.put('/index.html', response.clone())
    }
    return response
  } catch {
    return (await cache.match('/index.html')) ?? Response.error()
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_VERSION)
  const cachedResponse = await cache.match(request)

  const fetchPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache
          .put(request, response.clone())
          .then(() => trimRuntimeCache(cache))
          .catch(() => {})
      }
      return response
    })
    .catch((error) => {
      if (cachedResponse) {
        return cachedResponse
      }
      throw error
    })

  return cachedResponse ?? fetchPromise
}

async function trimRuntimeCache(cache) {
  const requests = await cache.keys()
  const dynamicRequests = requests.filter((request) => {
    const url = new URL(request.url)
    return !APP_SHELL_URLS.includes(url.pathname)
  })
  const deleteCount = dynamicRequests.length - MAX_DYNAMIC_CACHE_ENTRIES
  if (deleteCount <= 0) {
    return
  }

  await Promise.all(dynamicRequests.slice(0, deleteCount).map((request) => cache.delete(request)))
}
