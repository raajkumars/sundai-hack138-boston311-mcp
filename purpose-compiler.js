// A small, server-independent workflow compiler. Purpose Packs are local
// application policy: MCP servers remain ordinary tool providers and do not
// need to know this format exists.

export class PurposeCompilerError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'PurposeCompilerError'
    this.details = details
  }
}

export async function loadPurposePack(url) {
  const response = await fetch(url, { cache: 'no-cache' })
  if (!response.ok) throw new PurposeCompilerError(`Purpose Pack ${url} -> HTTP ${response.status}`)
  return response.json()
}

function assert(condition, message, details) {
  if (!condition) throw new PurposeCompilerError(message, details)
}

function toolProperties(tool) {
  return tool?.inputSchema?.properties || {}
}

function validatePackShape(pack) {
  assert(pack && typeof pack === 'object', 'Purpose Pack must be an object')
  assert(typeof pack.task_id === 'string' && pack.task_id, 'Purpose Pack requires task_id')
  assert(typeof pack.objective === 'string' && pack.objective, 'Purpose Pack requires objective')
  assert(Array.isArray(pack.required_tools), 'Purpose Pack requires required_tools')
  assert(Array.isArray(pack.workflow) && pack.workflow.length, 'Purpose Pack requires workflow steps')
  assert(typeof pack.result_step === 'string', 'Purpose Pack requires result_step')
}

function validateReferences(value, knownSteps, stepId) {
  if (typeof value === 'string' && value.startsWith('$')) {
    const source = value.slice(1).split('.')[0]
    assert(knownSteps.has(source), `Step ${stepId} references unavailable step ${source}`)
    return
  }
  if (Array.isArray(value)) value.forEach((item) => validateReferences(item, knownSteps, stepId))
  if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => validateReferences(item, knownSteps, stepId))
  }
}

export function compilePurposePack(pack, tools) {
  validatePackShape(pack)
  assert(Array.isArray(tools), 'tools/list did not return an array')

  const toolMap = new Map(tools.map((tool) => [tool.name, tool]))
  for (const name of pack.required_tools) {
    assert(toolMap.has(name), `MCP server is missing required tool ${name}`, { tool: name })
  }

  const knownSteps = new Set()
  let modelCalls = 0
  let mcpCalls = 0

  for (const step of pack.workflow) {
    assert(typeof step.id === 'string' && step.id, 'Every workflow step requires an id')
    assert(!knownSteps.has(step.id), `Duplicate workflow step id ${step.id}`)
    assert(step.executor === 'model' || step.executor === 'mcp', `Unsupported executor ${step.executor}`)

    if (step.executor === 'model') {
      modelCalls += 1
      assert(step.output_schema, `Model step ${step.id} requires output_schema`)
    } else {
      mcpCalls += 1
      const tool = toolMap.get(step.tool)
      assert(tool, `Step ${step.id} references unavailable tool ${step.tool}`)
      assert(step.arguments && typeof step.arguments === 'object', `MCP step ${step.id} requires arguments`)
      validateReferences(step.arguments, knownSteps, step.id)
      const allowed = toolProperties(tool)
      for (const argument of Object.keys(step.arguments)) {
        assert(argument in allowed, `Step ${step.id} supplies unknown ${step.tool} argument ${argument}`)
      }
    }
    knownSteps.add(step.id)
  }

  assert(knownSteps.has(pack.result_step), `Unknown result_step ${pack.result_step}`)
  const limits = pack.limits || {}
  assert(modelCalls <= (limits.max_model_calls ?? modelCalls), 'Workflow exceeds max_model_calls')
  assert(mcpCalls <= (limits.max_mcp_calls ?? mcpCalls), 'Workflow exceeds max_mcp_calls')

  return Object.freeze({
    taskId: pack.task_id,
    title: pack.title || pack.task_id,
    objective: pack.objective,
    resultStep: pack.result_step,
    successConditions: pack.success_conditions || [],
    limits: { maxModelCalls: limits.max_model_calls ?? modelCalls, maxMcpCalls: limits.max_mcp_calls ?? mcpCalls },
    steps: pack.workflow.map((step) => Object.freeze({ ...step })),
    tools: toolMap,
  })
}

function readPath(state, reference) {
  const path = reference.slice(1).split('.')
  let value = state
  for (const segment of path) {
    if (value === null || value === undefined || !(segment in Object(value))) {
      throw new PurposeCompilerError(`Cannot resolve workflow reference ${reference}`)
    }
    value = value[segment]
  }
  return value
}

export function resolveReferences(value, state) {
  if (typeof value === 'string' && value.startsWith('$')) return readPath(state, value)
  if (Array.isArray(value)) return value.map((item) => resolveReferences(item, state))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveReferences(item, state)]))
  }
  return value
}

function typeMatches(value, expected) {
  if (expected === 'array') return Array.isArray(value)
  if (expected === 'null') return value === null
  if (expected === 'integer') return Number.isInteger(value)
  if (expected === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (expected === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value)
  return typeof value === expected
}

export function validateValue(value, schema, label = 'value') {
  if (!schema) return value
  const expectedTypes = Array.isArray(schema.type) ? schema.type : [schema.type]
  if (schema.type) assert(expectedTypes.some((type) => typeMatches(value, type)), `${label} has the wrong type`)
  if (schema.required) {
    for (const field of schema.required) {
      assert(value && Object.hasOwn(value, field), `${label} is missing required field ${field}`)
    }
  }
  if (schema.properties && value && typeof value === 'object') {
    for (const [field, fieldSchema] of Object.entries(schema.properties)) {
      if (Object.hasOwn(value, field)) validateValue(value[field], fieldSchema, `${label}.${field}`)
    }
  }
  return value
}

function validateToolArguments(tool, args, stepId) {
  const schema = tool.inputSchema || {}
  for (const field of schema.required || []) {
    assert(args[field] !== undefined && args[field] !== '', `Step ${stepId} is missing required argument ${field}`)
  }
  validateValue(args, schema, `Step ${stepId} arguments`)
}

export async function executePlan(plan, handlers, initialState = {}, onEvent = () => {}) {
  assert(typeof handlers?.model === 'function', 'A model executor is required')
  assert(typeof handlers?.mcp === 'function', 'An MCP executor is required')
  const state = { input: initialState }
  let modelCalls = 0
  let mcpCalls = 0

  for (const step of plan.steps) {
    const started = performance.now()
    onEvent({ type: 'step_started', step: step.id, executor: step.executor })
    try {
      if (step.executor === 'model') {
        modelCalls += 1
        assert(modelCalls <= plan.limits.maxModelCalls, 'Model-call limit exceeded')
        const output = await handlers.model(step, state)
        state[step.id] = validateValue(output, step.output_schema, `Step ${step.id} output`)
      } else {
        mcpCalls += 1
        assert(mcpCalls <= plan.limits.maxMcpCalls, 'MCP-call limit exceeded')
        const args = resolveReferences(step.arguments, state)
        for (const name of step.omit_empty_arguments || []) {
          if (args[name] === '' || args[name] === null || args[name] === undefined) delete args[name]
        }
        validateToolArguments(plan.tools.get(step.tool), args, step.id)
        onEvent({ type: 'mcp_call', step: step.id, tool: step.tool, arguments: args })
        state[step.id] = await handlers.mcp(step.tool, args)
      }
      onEvent({ type: 'step_completed', step: step.id, executor: step.executor, durationMs: performance.now() - started })
    } catch (error) {
      onEvent({ type: 'step_failed', step: step.id, executor: step.executor, durationMs: performance.now() - started, message: error.message })
      throw error
    }
  }

  return { result: state[plan.resultStep], state, modelCalls, mcpCalls }
}
