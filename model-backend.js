// Choose a backend before creating a Transformers.js pipeline. Attempting a
// WebGPU pipeline and then retrying the same model with WASM can reuse a
// rejected cached session, so adapter detection must happen first.

export async function selectInferenceDevice(gpu, override = '') {
  if (override === 'wasm' || override === 'webgpu') return override
  if (!gpu || typeof gpu.requestAdapter !== 'function') return 'wasm'
  try {
    return await gpu.requestAdapter() ? 'webgpu' : 'wasm'
  } catch (_) {
    return 'wasm'
  }
}
