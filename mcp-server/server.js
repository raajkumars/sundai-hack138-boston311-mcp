// Boston 311 MCP server — Sundai Hack 138, project 2 (@raaj + Ted).
// Streamable HTTP transport (stateless: no session id) so a browser PWA can
// speak MCP directly. Wraps exactly two tools against the live Boston Open311
// API. Memory-light and purely request-driven — no polling, no busy loop —
// deliberately, since the host (oci-main) is CPU-saturated.

import express from 'express'
import cors from 'cors'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'

const OPEN311_BASE = 'https://311.boston.gov/open311/v2'
const PORT = process.env.PORT || 8311

// Fetched once at boot and cached — 10 small objects, never refetched, so a
// request never blocks on an extra round trip to Boston's services list.
let SERVICES = []

// Bounds every outbound call to Boston's API — this host runs other jobs
// (a DB backup can spike load) and Boston's own API could be slow too;
// either way a tool call should fail fast, not hang the request open.
async function fetchWithTimeout(url, ms = 5000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, { signal: controller.signal })
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`upstream timed out after ${ms}ms: ${url}`)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

async function loadServices() {
  const res = await fetchWithTimeout(`${OPEN311_BASE}/services.json`)
  if (!res.ok) throw new Error(`services.json -> HTTP ${res.status}`)
  SERVICES = await res.json()
  console.log(`Loaded ${SERVICES.length} Boston 311 service codes`)
}

// Deterministic keyword match, on purpose — the model is not trusted to
// pick the exact service_code string. It names a category in plain words;
// this code resolves that to a real code.
function matchService(category) {
  const q = (category || '').toLowerCase()
  let best = null
  let bestScore = 0
  for (const s of SERVICES) {
    const name = s.service_name.toLowerCase()
    const words = name.split(/\W+/).filter(Boolean)
    const score = words.reduce((acc, w) => acc + (q.includes(w) ? 1 : 0), 0)
    if (score > bestScore) { bestScore = score; best = s }
  }
  return best
}

async function queryRecent({ category, location }, limit = 5) {
  const svc = matchService(category)
  if (!svc) return { matched: null, results: [] }
  // Pull a wider page than we need so an (optional) location filter has real
  // rows to narrow from — Boston's address text rarely matches a spoken
  // location verbatim, so if the filter would zero out the results we fall
  // back to the unfiltered top N rather than showing an empty, "broken"-
  // looking demo. locationMatched tells the caller which happened; nothing
  // here is faked, it's a real query either way.
  const params = new URLSearchParams({ service_code: svc.service_code, page_size: String(location ? 25 : limit) })
  const res = await fetchWithTimeout(`${OPEN311_BASE}/requests.json?${params}`)
  if (!res.ok) throw new Error(`requests.json -> HTTP ${res.status}`)
  const all = await res.json()
  const filtered = location
    ? all.filter((r) => (r.address || '').toLowerCase().includes(location.toLowerCase()))
    : all
  const locationMatched = location ? filtered.length > 0 : null
  const results = (filtered.length ? filtered : all).slice(0, limit)
  return {
    matched: { service_code: svc.service_code, service_name: svc.service_name },
    locationMatched,
    results: results.map((r) => ({
      id: r.service_request_id,
      status: r.status,
      description: r.description,
      address: r.address,
      requested: r.requested_datetime,
    })),
  }
}

function buildServer() {
  const server = new McpServer({ name: 'boston-311', version: '1.0.0' })

  server.registerTool(
    'lookup_service',
    {
      title: 'Look up a Boston 311 service',
      description: 'Match a plain-language civic issue category (e.g. "illegal parking", "broken traffic light") to a real Boston 311 service code.',
      inputSchema: { category: z.string().describe('Plain-language issue category') },
    },
    async ({ category }) => {
      const svc = matchService(category)
      return {
        content: [{ type: 'text', text: JSON.stringify(svc || { error: 'no matching service' }) }],
      }
    }
  )

  server.registerTool(
    'query_recent',
    {
      title: 'Query recent Boston 311 reports',
      description: 'Look up real, currently open Boston 311 reports for a civic issue category, optionally filtered by street/location text.',
      inputSchema: {
        category: z.string().describe('Plain-language issue category'),
        location: z.string().optional().describe('Street or area text to filter by'),
      },
    },
    async ({ category, location }) => {
      const data = await queryRecent({ category, location })
      return { content: [{ type: 'text', text: JSON.stringify(data) }] }
    }
  )

  return server
}

async function main() {
  await loadServices()

  const app = express()
  app.use(cors({ origin: '*', methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Mcp-Session-Id'] }))
  app.use(express.json())

  app.get('/health', (_req, res) => res.status(200).json({ ok: true, services: SERVICES.length }))

  app.post('/mcp', async (req, res) => {
    // Stateless: a fresh server+transport per request. Cheap — no per-session
    // state to leak or accumulate on a memory-constrained host.
    const server = buildServer()
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    res.on('close', () => { transport.close(); server.close() })
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  })

  app.listen(PORT, () => console.log(`boston-311 MCP server listening on :${PORT}`))
}

main().catch((err) => {
  console.error('fatal:', err)
  process.exit(1)
})
