// Service worker: cache the static app shell only. Cross-origin requests to
// local Ollama and the public MCP server deliberately stay live.
const CACHE_NAME = 'sundai-311-purpose-compiler-v19-purpose-pack-editor'
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './mcp-client.js',
  './ollama-client.js',
  './purpose-compiler.js',
  './direct-agent.js',
  './run-metrics.js',
  './civic-normalizer.js',
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
  if (url.origin !== self.location.origin) return // never cache Ollama or MCP responses

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
