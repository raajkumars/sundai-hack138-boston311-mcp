const STORAGE_KEY = 'mcp-purpose-compiler-runs-v1'

export function createRunMetrics(strategy, model) {
  const started = performance.now()
  const events = []
  return {
    strategy,
    model,
    events,
    record(event) { events.push({ atMs: performance.now() - started, ...event }) },
    finish(extra = {}) {
      const completed = {
        id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
        timestamp: new Date().toISOString(),
        strategy,
        model,
        durationMs: Math.round(performance.now() - started),
        modelCalls: events.filter((event) => event.type === 'step_started' && event.executor === 'model').length
          + events.filter((event) => event.type === 'direct_model_call').length,
        mcpCalls: events.filter((event) => event.type === 'mcp_call').length,
        modelDurationMs: Math.round(events
          .filter((event) => (event.type === 'step_completed' && event.executor === 'model') || event.type === 'direct_model_call')
          .reduce((total, event) => total + (event.durationMs || 0), 0)),
        promptTokens: events.filter((event) => event.type === 'model_stats').reduce((total, event) => total + (event.promptTokens || 0), 0),
        outputTokens: events.filter((event) => event.type === 'model_stats').reduce((total, event) => total + (event.outputTokens || 0), 0),
        modelLoadDurationMs: events.filter((event) => event.type === 'model_stats').reduce((total, event) => total + (event.loadDurationMs || 0), 0),
        ...extra,
      }
      saveRun(completed)
      return completed
    },
  }
}

export function loadRuns() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') }
  catch (_) { return [] }
}

export function saveRun(run) {
  const runs = [run, ...loadRuns()].slice(0, 20)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(runs))
}

export function clearRuns() {
  localStorage.removeItem(STORAGE_KEY)
}
