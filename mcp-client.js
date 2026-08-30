// Minimal browser MCP client — real JSON-RPC 2.0 over the streamable-HTTP
// transport (MCP spec 2025-06-18), speaking to our own server, not shaped to
// look like it. No bundler in this project (same no-build-step approach as
// project 1), so this is a small hand-rolled client rather than pulling in
// @modelcontextprotocol/sdk's Node-oriented client bundle.
//
// The server responds with a single SSE-framed message per request (it runs
// stateless: no session id, no persistent stream) — parse the "data: " line
// out of the response body rather than opening an EventSource.

let nextId = 1

// The MCP server's host runs other jobs (a DB backup can spike its load) —
// a slow response should degrade the demo, not hang it. 8s is generous for
// a live 311 lookup on a healthy host, short enough to fail visibly on
// stage instead of standing there.
const RPC_TIMEOUT_MS = 8000

async function rpc(serverUrl, method, params) {
  const id = nextId++
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS)
  let res
  try {
    res = await fetch(serverUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      signal: controller.signal,
    })
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`MCP ${method}: timed out after ${RPC_TIMEOUT_MS}ms`)
    throw err
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) throw new Error(`MCP ${method} -> HTTP ${res.status}`)
  const text = await res.text()
  const dataLine = text.split('\n').find((l) => l.startsWith('data: '))
  if (!dataLine) throw new Error(`MCP ${method}: no data frame in response (${text.slice(0, 200)})`)
  const msg = JSON.parse(dataLine.slice('data: '.length))
  if (msg.error) throw new Error(`MCP ${method}: ${msg.error.message}`)
  return msg.result
}

export async function mcpInitialize(serverUrl) {
  return rpc(serverUrl, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'sundai-311-pwa', version: '1.0' },
  })
}

export async function mcpListTools(serverUrl) {
  const result = await rpc(serverUrl, 'tools/list', {})
  return result.tools
}

export async function mcpCallTool(serverUrl, name, args) {
  const result = await rpc(serverUrl, 'tools/call', { name, arguments: args })
  const textPart = result?.content?.find((c) => c.type === 'text')
  return textPart ? JSON.parse(textPart.text) : result
}
