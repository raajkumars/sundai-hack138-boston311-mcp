// Service worker: cache-first for the app shell and model weights (same
// pattern as project 1). MCP calls are cross-origin (different host from
// the PWA) and GET-only caching below already skips those — the 311 lookup
// stays live, which is the whole point: only inference is offline-capable,
// the MCP call is deliberately real and current.
const CACHE_NAME = 'sundai-311-purpose-compiler-v4'
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './vendor/transformers.min.js',
  './vendor/ort-wasm-simd-threaded.jsep.wasm',
  './vendor/ort-wasm-simd-threaded.jsep.mjs',
  './mcp-client.js',
  './purpose-compiler.js',
  './direct-agent.js',
  './run-metrics.js',
  './civic-normalizer.js',
  './model-backend.js',
  './purpose-packs/boston-311-related-reports.json',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
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
  if (url.origin !== self.location.origin) return // never cache the MCP server or the transformers.js CDN load

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
