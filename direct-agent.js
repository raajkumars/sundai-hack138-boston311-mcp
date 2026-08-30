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
  const availableNames = tools.map((tool) => tool.name).join(' | ')
  const observed = observation
    ? `\nPrevious tool result:\n${JSON.stringify(observation).slice(0, 700)}\nChoose the next tool needed to finish.`
    : ''
  return `Find recent reports related to the complaint using one MCP tool.\n\nAVAILABLE TOOL NAMES (copy one exactly):\n${availableNames}\n\nTOOL DESCRIPTIONS:\n${toolSummary(tools)}\n\nExample:\nComplaint: Broken traffic light at Beacon and Arlington\nTOOL: query_recent\nCATEGORY: broken traffic light\nLOCATION: Beacon and Arlington\n\nComplaint: ${complaint}${observed}\n\nReply with exactly three labeled lines and no explanation.`
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

  const labeledName = text.match(/^\s*TOOL:\s*([^\s(\n]+)/im)?.[1]?.trim()
  const calledTool = tools.find((candidate) => {
    const escapedName = candidate.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`\\b${escapedName}\\s*\\(`, 'i').test(text)
  })
  const selectedTool = tools.find((candidate) => candidate.name.toLowerCase() === labeledName?.toLowerCase()) || calledTool
  const tool = selectedTool?.name

  const argumentText = tool
    ? text.match(new RegExp(`\\b${tool.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(([^)]*)`, 'i'))?.[1] || text
    : text
  const readArgument = (label) => text
    .match(new RegExp(`^\\s*${label}\\s*:\\s*["']?([^"'\\n,]+)`, 'im'))?.[1]?.trim()
    || argumentText.match(new RegExp(`["']?${label}["']?\\s*[:=]\\s*["']?([^"'\\n,)]+)`, 'i'))?.[1]?.trim()
  const category = readArgument('category')
    || argumentText.match(/^\s*["']([^"']+)/)?.[1]?.trim()
  const location = readArgument('location')

  if (!tool || !names.has(tool)) throw new Error(`Direct agent did not select an available MCP tool: ${labeledName || '(missing)'}`)
  if (!category) throw new Error('Direct agent omitted CATEGORY')
  const args = { category }
  if (tool === 'query_recent' && location && !/^none$/i.test(location)) args.location = location
  return { name: tool, arguments: args }
}

export function describeDirectFailure(error) {
  const message = error?.message || String(error)
  if (/did not select an available MCP tool/i.test(message)) return 'invalid or missing MCP tool selection'
  if (/omitted CATEGORY|missing required field|arguments/i.test(message)) return 'invalid or missing tool arguments'
  if (/did not call query_recent/i.test(message)) return 'workflow did not reach query_recent'
  return 'direct workflow execution failed'
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
