#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TRANSFORMERS_VERSION=3.8.1
ORT_VERSION=1.22.0-dev.20250409-89f8206ba4
MODEL_REVISION=b8a5c0f183b78c55955a5364f610c36668b5e681
MODEL_NAME=onnx-community/SmolLM2-135M-Instruct-ONNX
MODEL_ROOT="$PROJECT_ROOT/models/$MODEL_NAME"
VENDOR_ROOT="$PROJECT_ROOT/vendor"

mkdir -p "$VENDOR_ROOT" "$MODEL_ROOT/onnx"

download() {
  local url=$1
  local destination=$2
  if [[ -s "$destination" ]]; then
    echo "present: ${destination#"$PROJECT_ROOT/"}"
    return
  fi
  local temporary
  temporary=$(mktemp "${destination}.tmp.XXXXXX")
  trap 'rm -f "$temporary"' RETURN
  echo "download: ${destination#"$PROJECT_ROOT/"}"
  curl --fail --location --retry 3 --output "$temporary" "$url"
  mv "$temporary" "$destination"
  trap - RETURN
}

download \
  "https://cdn.jsdelivr.net/npm/@huggingface/transformers@${TRANSFORMERS_VERSION}/dist/transformers.min.js" \
  "$VENDOR_ROOT/transformers.min.js"
download \
  "https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/ort-wasm-simd-threaded.jsep.wasm" \
  "$VENDOR_ROOT/ort-wasm-simd-threaded.jsep.wasm"
download \
  "https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/ort-wasm-simd-threaded.jsep.mjs" \
  "$VENDOR_ROOT/ort-wasm-simd-threaded.jsep.mjs"

MODEL_BASE="https://huggingface.co/$MODEL_NAME/resolve/$MODEL_REVISION"
for filename in config.json generation_config.json merges.txt special_tokens_map.json tokenizer.json tokenizer_config.json vocab.json; do
  download "$MODEL_BASE/$filename" "$MODEL_ROOT/$filename"
done
download "$MODEL_BASE/onnx/model_q4.onnx" "$MODEL_ROOT/onnx/model_q4.onnx"

echo
echo "Local browser assets are ready. Start the PWA with:"
echo "  cd $PROJECT_ROOT && npm run serve"
