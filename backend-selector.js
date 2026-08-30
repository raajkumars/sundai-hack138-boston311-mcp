// Backend selector — the narrow, separable module the app's inference
// cascade goes through. Everything downstream (purpose-compiler.js,
// direct-agent.js, index.html) calls chat() and never touches a specific
// backend directly.
//
// Cascade, in order: in-browser WebGPU (no network, no setup) -> local
// Ollama (detected, offered) -> user-supplied API key (Groq/OpenRouter,
// stored in the browser only). There is no LiteLLM tier — a public static
// PWA cannot hold a server credential without exposing it to everyone who
// loads the page, so that tier was dropped rather than shipped with a
// credential-exposure hole. See README "Backend cascade".
//
// Every detection result carries WHY, not just whether — capability
// detection failing silently (works on an 8GB MacBook Air, fails on a
// strictly-better 12GB Lenovo Legion) is the actual problem this exists to
// diagnose, not just work around.

import { chatOllama, listOllamaModels, ollamaTools as toOpenAiTools, DEFAULT_OLLAMA_URL } from './ollama-client.js'

const SETTINGS_KEY = 'sundai-311-backend-settings-v1'
const WEBGPU_MODEL = 'onnx-community/SmolLM2-135M-Instruct-ONNX'

let webgpuGenerator = null // lazily loaded transformers.js pipeline

// ---- settings (tier choice + BYO key) -------------------------------
// localStorage only. A BYO key never leaves the browser except to the
// provider the user chose it for — never logged, never sent to our infra,
// never included in run-metrics payloads (see index.html's metrics.record
// call sites: they pass structured numeric/text fields only, never the
// settings object).

export function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
  } catch (_) {
    return {}
  }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

export const BYOK_PROVIDERS = {
  groq: { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.1-8b-instant' },
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'meta-llama/llama-3.1-8b-instruct' },
}

// ---- detection --------------------------------------------------------
// Each result: { available, reason }. reason is always populated, even
// when available is true (e.g. "adapter granted"), so a caller can log why
// a tier was or was not usable on this specific machine.

export async function detectWebgpu() {
  if (!('gpu' in navigator)) return { available: false, reason: 'navigator.gpu is undefined (no WebGPU support in this browser)' }
  try {
    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter) return { available: false, reason: 'navigator.gpu.requestAdapter() returned null (no compatible GPU adapter)' }
    return { available: true, reason: 'GPU adapter granted' }
  } catch (error) {
    return { available: false, reason: `requestAdapter() threw: ${error.message}` }
  }
}

export async function detectOllama(baseUrl = DEFAULT_OLLAMA_URL) {
  try {
    const models = await listOllamaModels(baseUrl)
    if (!models.length) return { available: false, reason: 'Ollama reachable but has no installed models', models: [] }
    return { available: true, reason: `Ollama reachable, ${models.length} model(s) installed`, models }
  } catch (error) {
    return { available: false, reason: `Ollama unreachable at ${baseUrl}: ${error.message}`, models: [] }
  }
}

export async function detectBackends(ollamaUrl) {
  const [webgpu, ollama] = await Promise.all([detectWebgpu(), detectOllama(ollamaUrl)])
  return { webgpu, ollama }
}

// Auto-pick the best available tier per the cascade order. BYO key is
// never auto-picked — it requires the user to have already entered one.
export function pickTier(detection, settings) {
  if (detection.webgpu.available) return 'webgpu'
  if (detection.ollama.available) return 'ollama'
  if (settings?.byok?.apiKey) return 'byok'
  return null
}

// ---- WebGPU adapter -----------------------------------------------------

async function loadWebgpuGenerator(onProgress) {
  if (webgpuGenerator) return webgpuGenerator
  const { pipeline, env } = await import('./vendor/transformers.min.js')
  env.allowRemoteModels = false
  env.allowLocalModels = true
  env.localModelPath = './models/'
  try {
    webgpuGenerator = await pipeline('text-generation', WEBGPU_MODEL, { dtype: 'q4', device: 'webgpu', progress_callback: onProgress })
  } catch (_) {
    // Adapter probed available but device init still failed (driver-level) — fall back once, same as before.
    webgpuGenerator = await pipeline('text-generation', WEBGPU_MODEL, { dtype: 'q4', device: 'wasm', progress_callback: onProgress })
  }
  return webgpuGenerator
}

async function chatWebgpu({ messages, maxTokens = 60, onProgress }) {
  const generator = await loadWebgpuGenerator(onProgress)
  const started = performance.now()
  const out = await generator(messages, { max_new_tokens: maxTokens, do_sample: false })
  return {
    content: out[0].generated_text.at(-1).content,
    thinking: '',
    toolCalls: [],
    totalDurationMs: Math.round(performance.now() - started),
    loadDurationMs: 0,
    promptTokens: 0,
    outputTokens: 0,
  }
}

// ---- Ollama adapter -----------------------------------------------------
// Thin pass-through to the existing, already-tested ollama-client.js.

async function chatOllamaAdapter({ messages, tools, format, maxTokens = 60, model, ollamaUrl }) {
  if (!model) throw new Error('No Ollama model selected')
  return chatOllama(ollamaUrl || DEFAULT_OLLAMA_URL, {
    model,
    messages,
    tools: tools?.length ? toOpenAiTools(tools) : undefined,
    format,
    options: { num_predict: maxTokens },
    keepAlive: '10m',
  })
}

// ---- BYO-key adapter (Groq / OpenRouter, OpenAI-compatible) -------------
// format (JSON-schema constrained decoding) is Ollama-specific and not
// honored here — same graceful-degrade-to-plain-text the app already
// relies on for direct-agent failures, and it's a real, measured data
// point per the project's own methodology, not a hidden gap.

async function chatByok({ messages, tools, maxTokens = 60, byok }) {
  if (!byok?.apiKey) throw new Error('No API key configured for the selected provider')
  const provider = BYOK_PROVIDERS[byok.provider] || { baseUrl: byok.baseUrl }
  const baseUrl = byok.baseUrl || provider.baseUrl
  const model = byok.model || provider.defaultModel
  const started = performance.now()
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${byok.apiKey}` },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      temperature: 0,
      tools: tools?.length ? toOpenAiTools(tools) : undefined,
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`${provider.label || byok.provider} chat/completions -> HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`)
  }
  const data = await res.json()
  const choice = data.choices?.[0]?.message
  return {
    content: choice?.content || '',
    thinking: '',
    toolCalls: (choice?.tool_calls || []).map((tc) => ({ function: { name: tc.function?.name, arguments: tc.function?.arguments } })),
    totalDurationMs: Math.round(performance.now() - started),
    loadDurationMs: 0,
    promptTokens: data.usage?.prompt_tokens || 0,
    outputTokens: data.usage?.completion_tokens || 0,
  }
}

// ---- unified dispatch -----------------------------------------------------

export async function chat(tier, args) {
  if (tier === 'webgpu') return chatWebgpu(args)
  if (tier === 'ollama') return chatOllamaAdapter(args)
  if (tier === 'byok') return chatByok(args)
  throw new Error(`Unknown or unavailable backend tier: ${tier}`)
}
