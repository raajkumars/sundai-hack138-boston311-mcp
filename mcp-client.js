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

async function rpc(serverUrl, method, params) {
  const id = nextId++
  const res = await fetch(serverUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  })
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
