// Service worker. Two different caching strategies for two different kinds
// of asset — conflating them is the exact bug that hit project 1 twice
// today: it cached its app shell (HTML/JS) cache-first under a static
// CACHE_NAME, so a returning browser kept serving the FIRST version it
// ever loaded, forever, no matter how many times the server was fixed.
//
// - APP SHELL (every local .js/.json module + index.html/manifest.json) —
//   code that changes on every deploy: NETWORK-FIRST, falling back to
//   cache only if the network fetch fails (offline resilience), so a
//   returning visitor always gets the current build when online.
// - IMMUTABLE (vendor/transformers.min.js, model weights) — large,
//   version-pinned, never changes without a code change to the URL itself:
//   CACHE-FIRST, so the 180MB model isn't re-downloaded every visit.
//
// CACHE_NAME is bumped on every shell change to evict previously-cached
// entries for anyone (Ted, @raaj, a judge) who visited an earlier build.
const CACHE_NAME = 'sundai-311-mcp-v4'
const SHELL = [
  'index.html',
  'manifest.json',
  'mcp-client.js',
  'purpose-compiler.js',
  'direct-agent.js',
  'run-metrics.js',
  'civic-normalizer.js',
  'purpose-packs/boston-311-related-reports.json',
]
const IMMUTABLE = ['./vendor/transformers.min.js']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(IMMUTABLE)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin) return // never cache Ollama, the MCP server, or any cross-origin call

  const isShell = url.pathname.endsWith('/') || SHELL.some((f) => url.pathname.endsWith('/' + f))

  if (isShell) {
    // Network-first: always try for the current build; cache is only the
    // offline fallback, and gets refreshed on every successful online fetch.
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy))
          }
          return response
        })
        .catch(() => caches.match(event.request))
    )
    return
  }

  // Cache-first for everything else (model weights, icons): large and
  // effectively immutable, no reason to hit the network once cached.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy))
        }
        return response
      })
    })
  )
})
