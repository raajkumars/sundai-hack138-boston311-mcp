import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { classifyCategory, locationOf } from '../civic-normalizer.js'
import { compilePurposePack, executePlan, PurposeCompilerError } from '../purpose-compiler.js'
import { buildDirectAgentPrompt, describeDirectFailure, parseDirectDecision, runDirectAgent } from '../direct-agent.js'
import { chatOllama, listOllamaModels, ollamaModelLabel, ollamaTools, preloadOllamaModel, toolCallDecision } from '../ollama-client.js'

const root = new URL('../', import.meta.url)
const pack = JSON.parse(await readFile(new URL('purpose-packs/boston-311-related-reports.json', root)))
const tools = [
  {
    name: 'lookup_service',
    description: 'Resolve a category',
    inputSchema: { type: 'object', required: ['category'], properties: { category: { type: 'string' } } },
  },
  {
    name: 'query_recent',
    description: 'Query reports',
    inputSchema: {
      type: 'object',
      required: ['category'],
      properties: { category: { type: 'string' }, location: { type: 'string' } },
    },
  },
]

test('compiles the Boston Purpose Pack against tools/list', () => {
  const plan = compilePurposePack(pack, tools)
  assert.equal(plan.steps.length, 3)
  assert.equal(plan.resultStep, 'query')
  assert.deepEqual(plan.limits, { maxModelCalls: 1, maxMcpCalls: 2 })
})

test('fails closed when a required MCP tool is unavailable', () => {
  assert.throws(() => compilePurposePack(pack, tools.slice(0, 1)), PurposeCompilerError)
})

test('rejects Purpose Pack arguments absent from the live tool schema', () => {
  const invalid = structuredClone(pack)
  invalid.workflow[2].arguments.unknown = '$extract.description'
  assert.throws(() => compilePurposePack(invalid, tools), /unknown query_recent argument unknown/)
})

test('executes model and MCP steps with references and empty argument omission', async () => {
  const calls = []
  const plan = compilePurposePack(pack, tools)
  const execution = await executePlan(plan, {
    model: async () => ({ description: 'blocked bike lane', category: 'Illegal Parking', location: '' }),
    mcp: async (name, args) => {
      calls.push({ name, args })
      if (name === 'lookup_service') return { service_name: 'Illegal Parking' }
      return { matched: { service_name: 'Illegal Parking' }, locationMatched: null, results: [] }
    },
  }, { complaint: 'blocked bike lane' })

  assert.deepEqual(calls, [
    { name: 'lookup_service', args: { category: 'Illegal Parking' } },
    { name: 'query_recent', args: { category: 'Illegal Parking' } },
  ])
  assert.equal(execution.result.matched.service_name, 'Illegal Parking')
})

test('parses direct-agent labeled tool decisions', () => {
  assert.deepEqual(
    parseDirectDecision('TOOL: query_recent\nCATEGORY: Illegal Parking\nLOCATION: Main St', tools),
    { name: 'query_recent', arguments: { category: 'Illegal Parking', location: 'Main St' } }
  )
})

test('parses a small model function-style tool decision with surrounding prose', () => {
  assert.deepEqual(
    parseDirectDecision(
      'To use the MCP tools, I would call:\nlookup_service(CATEGORY: "CIVIL INCIDENT", "Bike Lane")',
      tools
    ),
    { name: 'lookup_service', arguments: { category: 'CIVIL INCIDENT' } }
  )
})

test('parses function-style query arguments and canonicalizes the tool name', () => {
  assert.deepEqual(
    parseDirectDecision('QUERY_RECENT(category="Illegal Parking", location="Main St")', tools),
    { name: 'query_recent', arguments: { category: 'Illegal Parking', location: 'Main St' } }
  )
})

test('direct-agent prompt makes the exact available names salient', () => {
  const prompt = buildDirectAgentPrompt(tools, 'blocked lane')
  assert.match(prompt, /AVAILABLE TOOL NAMES \(copy one exactly\):\nlookup_service \| query_recent/)
  assert.match(prompt, /Tool arguments must describe this complaint/)
  assert.doesNotMatch(prompt, /broken traffic light|Beacon and Arlington/)
})

test('classifies a missing direct tool choice as a measured baseline failure', () => {
  assert.equal(
    describeDirectFailure(new Error('Direct agent did not select an available MCP tool: (missing)')),
    'invalid or missing MCP tool selection'
  )
})

test('direct agent validates its selected arguments against tools/list', async () => {
  await assert.rejects(
    runDirectAgent({
      complaint: 'blocked lane',
      tools,
      generate: async () => '{"tool":"query_recent","arguments":{}}',
      callTool: async () => { throw new Error('must not execute') },
    }),
    /missing required field category/
  )
})

test('deterministic civic routing passes the benchmark fixtures', async () => {
  const fixtures = JSON.parse(await readFile(new URL('tests/fixtures/civic-issues.json', root)))
  for (const fixture of fixtures) {
    assert.equal(classifyCategory(fixture.input), fixture.category, fixture.input)
    assert.equal(locationOf(fixture.input), fixture.location, fixture.input)
  }
})

test('discovers and labels locally installed Ollama models', async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({ models: [{ name: 'llama3.2:1b', details: { parameter_size: '1.2B', quantization_level: 'Q8_0' } }] }),
  })
  const models = await listOllamaModels('http://localhost:11434', fakeFetch)
  assert.equal(models[0].name, 'llama3.2:1b')
  assert.equal(ollamaModelLabel(models[0]), 'llama3.2:1b — 1.2B · Q8_0')
})

test('preloads the selected Ollama model for fair warm-start comparisons', async () => {
  let requestBody
  const fakeFetch = async (_url, init) => {
    requestBody = JSON.parse(init.body)
    return { ok: true, json: async () => ({ model: 'llama3.1:8b', load_duration: 8_000_000, total_duration: 10_000_000 }) }
  }
  const result = await preloadOllamaModel('http://localhost:11434', 'llama3.1:8b', fakeFetch)
  assert.deepEqual(requestBody, { model: 'llama3.1:8b', stream: false, keep_alive: '10m' })
  assert.deepEqual(result, { model: 'llama3.1:8b', loadDurationMs: 8, totalDurationMs: 10 })
})

test('sends non-streaming Ollama chat requests and exposes inference metrics', async () => {
  let requestBody
  const fakeFetch = async (_url, init) => {
    requestBody = JSON.parse(init.body)
    return {
      ok: true,
      json: async () => ({
        model: 'llama3.1:8b',
        message: { content: '', tool_calls: [{ function: { name: 'query_recent', arguments: { category: 'Illegal Parking' } } }] },
        total_duration: 25_000_000,
        load_duration: 5_000_000,
        prompt_eval_count: 42,
        eval_count: 7,
      }),
    }
  }
  const response = await chatOllama('http://localhost:11434', {
    model: 'llama3.1:8b',
    messages: [{ role: 'user', content: 'blocked bike lane' }],
    tools: ollamaTools(tools),
  }, fakeFetch)

  assert.equal(requestBody.stream, false)
  assert.equal(requestBody.options.temperature, 0)
  assert.equal(requestBody.tools[1].function.name, 'query_recent')
  assert.deepEqual(toolCallDecision(response), { tool: 'query_recent', arguments: { category: 'Illegal Parking' } })
  assert.deepEqual(
    { totalDurationMs: response.totalDurationMs, loadDurationMs: response.loadDurationMs, promptTokens: response.promptTokens, outputTokens: response.outputTokens },
    { totalDurationMs: 25, loadDurationMs: 5, promptTokens: 42, outputTokens: 7 }
  )
})
