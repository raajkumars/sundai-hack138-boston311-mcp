import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { classifyCategory, locationOf } from '../civic-normalizer.js'
import { compilePurposePack, executePlan, PurposeCompilerError } from '../purpose-compiler.js'
import { parseDirectDecision, runDirectAgent } from '../direct-agent.js'

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
