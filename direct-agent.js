// Baseline executor: the model sees raw tools/list descriptions and chooses
// calls itself. It is intentionally separate from the compiled Purpose Pack
// path so the two orchestration strategies can be measured honestly.

import { validateValue } from './purpose-compiler.js'

function toolSummary(tools) {
  return tools.map((tool) => {
    const properties = Object.keys(tool.inputSchema?.properties || {}).join(', ')
    return `${tool.name}(${properties}): ${tool.description || ''}`
  }).join('\n')
}

export function buildDirectAgentPrompt(tools, complaint, observation) {
  const observed = observation
    ? `\nThe previous tool returned:\n${JSON.stringify(observation).slice(0, 1200)}\nChoose the next tool needed to finish.`
    : ''
  return `Use these MCP tools to find recent reports related to the complaint.\n\n${toolSummary(tools)}\n\nComplaint: ${complaint}${observed}\n\nOutput exactly three lines:\nTOOL: tool_name\nCATEGORY: short category\nLOCATION: location from complaint, or NONE`
}

export function parseDirectDecision(text, tools) {
  const names = new Set(tools.map((tool) => tool.name))
  const json = text.match(/\{[\s\S]*\}/)?.[0]
  if (json) {
    try {
      const parsed = JSON.parse(json)
      const name = parsed.tool || parsed.name
      if (names.has(name)) return { name, arguments: parsed.arguments || parsed.args || {} }
    } catch (_) {
      // Fall through to the labeled-line parser used by very small models.
    }
  }

  const tool = text.match(/^\s*TOOL:\s*([^\n]+)/im)?.[1]?.trim()
  const category = text.match(/^\s*CATEGORY:\s*([^\n]+)/im)?.[1]?.trim()
  const location = text.match(/^\s*LOCATION:\s*([^\n]+)/im)?.[1]?.trim()
  if (!tool || !names.has(tool)) throw new Error(`Direct agent did not select an available MCP tool: ${tool || '(missing)'}`)
  if (!category) throw new Error('Direct agent omitted CATEGORY')
  const args = { category }
  if (tool === 'query_recent' && location && !/^none$/i.test(location)) args.location = location
  return { name: tool, arguments: args }
}

export async function runDirectAgent({ complaint, tools, generate, callTool, maxSteps = 2, onEvent = () => {} }) {
  let observation = null
  const decisions = []
  let modelCalls = 0
  let mcpCalls = 0

  for (let step = 0; step < maxSteps; step += 1) {
    const prompt = buildDirectAgentPrompt(tools, complaint, observation)
    const modelStarted = performance.now()
    const reply = await generate(prompt)
    modelCalls += 1
    onEvent({ type: 'direct_model_call', durationMs: performance.now() - modelStarted, reply })
    const decision = parseDirectDecision(reply, tools)
    const selectedTool = tools.find((tool) => tool.name === decision.name)
    validateValue(decision.arguments, selectedTool.inputSchema, `Direct-agent ${decision.name} arguments`)
    decisions.push(decision)
    onEvent({ type: 'mcp_call', tool: decision.name, arguments: decision.arguments })
    observation = await callTool(decision.name, decision.arguments)
    mcpCalls += 1
    if (decision.name === 'query_recent') {
      return { result: observation, decisions, modelCalls, mcpCalls }
    }
  }
  throw new Error(`Direct agent did not call query_recent within ${maxSteps} steps`)
}
