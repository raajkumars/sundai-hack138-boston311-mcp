# Sundai Hack 138 — Project 2 (2026-08-30)

Throwaway demo scaffold. Scratch only — not a qwickapps product repo.

**Theme:** "Small Models, Big Applications." **@raaj + Ted (tedschwml@gmail.com).**

## What this is

A PWA with a small local model (SmolLM2-135M-Instruct, transformers.js,
WebGPU/WASM) that paraphrases a typed or spoken civic issue report; code
deterministically pulls out a location and a category from the same text,
then makes a **real MCP tool call** (streamable HTTP, JSON-RPC 2.0) to a
small MCP server that looks it up against Boston's live Open311 API. The
model does language, deterministic code does protocol and the structured
fields — it never emits a tool call itself. (The model was originally
Qwen2.5-0.5B-Instruct — swapped down for cold-load time, see "Model
history" below; multi-field model output also proved unreliable at this
size, see "Extraction design".)

## Live URLs

- PWA: https://sundai-hack138-2-gw.route.qwickforge.com/
- MCP server (streamable HTTP): https://boston311-mcp-gw.route.qwickforge.com/mcp
  — `GET .../health` for a liveness check without speaking MCP.

The live PWA has `window.MCP_SERVER_URL` baked in at deploy time, pointing
at the live MCP server above — deploy-time injection, source stays on
`localhost` for local dev (see "Local run").

## Layout

- `index.html`, `manifest.json`, `sw.js`, `mcp-client.js`, `vendor/`,
  `models/`, `icons/` — the PWA (static, no build step)
- `mcp-server/` — the MCP server (Node/Express, `npm install && npm start`,
  listens on `PORT` env var, default 8311)

`vendor/` and `models/` are gitignored (180MB+ of binary weights/library) —
**a fresh clone will be missing both**. Run "Regenerating vendored assets"
below first, or `index.html` will fail to load with a 404 on those paths.

## Regenerating vendored assets (required after a fresh clone)

```bash
BASE="https://huggingface.co/onnx-community/SmolLM2-135M-Instruct-ONNX/resolve/main"
DEST="models/onnx-community/SmolLM2-135M-Instruct-ONNX"
mkdir -p "$DEST/onnx"
for f in config.json generation_config.json merges.txt tokenizer.json tokenizer_config.json vocab.json special_tokens_map.json; do
  curl -sSL "$BASE/$f" -o "$DEST/$f"
done
curl -sSL "$BASE/onnx/model_q4.onnx" -o "$DEST/onnx/model_q4.onnx"   # ~180MB

mkdir -p vendor
curl -sSL "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2" -o vendor/transformers.min.js
```

Verified 2026-08-30: cloned fresh with no local git credentials (same
situation as any collaborator), ran this recipe verbatim, all 9 files
downloaded 200.

## Local run

```
cd mcp-server && npm install && npm start   # :8311
python3 -m http.server 8899                 # PWA, separate terminal
```

Open http://localhost:8899 — the PWA's `MCP_SERVER_URL` defaults to
`http://localhost:8311/mcp`.

**Don't want to run the MCP server locally?** Point the local PWA at the
live one instead — before `index.html` loads, in the browser console or a
tiny inline script: `window.MCP_SERVER_URL = 'https://boston311-mcp-gw.route.qwickforge.com/mcp'`.
CORS on the live server is open (`*`), so this works from `localhost` too.

## Extraction design

The model outputs one thing: a short plain-sentence paraphrase of the
complaint. Earlier attempts had it also emit JSON, then labeled
LOCATION/CATEGORY/DESCRIPTION lines — both drifted between runs at this
model size (copying a few-shot example's text instead of the real input,
occasionally fabricating a detail). Location is pulled from the raw input
with a preposition heuristic (`on/at/near <place>`); category is a
deterministic keyword classifier — see `CATEGORY_RULES` in `index.html`.
Verified across several differently-phrased inputs, not just the
rehearsed line.

## Model history

Qwen2.5-0.5B-Instruct (763MB) -> hit a real cold-load wall through the
gateway (~3.5min at measured throughput) — same class of problem project 1
hit first. Swapped to project 1's already-validated fix,
SmolLM2-135M-Instruct-ONNX (180MB, ~180MB/3.7MBps ≈ 49s cold, then cached
by the service worker).

## MCP server

Two tools, both read-only against Boston 311 (no real tickets filed):
- `lookup_service({ category })` — plain-language category -> real 311
  service code
- `query_recent({ category, location? })` — recent open reports for that
  category; falls back to citywide (not location-filtered) results if the
  location text doesn't match any live address, rather than showing empty

Deploy notes: memory-light (~96MB RSS idle), purely request-driven (no
polling / no busy loop) — verified locally. `GET /health` for health checks.

## Rehearsed categories

Verified live volume just before showtime, not assumed: **Illegal Parking**
is reliably very active (new reports every few minutes). Traffic Signal is
sparse (0 open reports when last checked) — do NOT rehearse on it. Backup
categories confirmed to have live data: Abandoned Vehicle, Damaged Sign
(Sign Repair). Re-check volume close to presentation time; city 311 traffic
shifts through the day.

## Demo script (90s)

1. "Small model on-device, real MCP server, real city data." (10s)
2. Type/speak: "Car blocking the bike lane on Main and Second." (15s)
3. Local model extracts JSON on screen — offline, no API key. (15s)
4. App makes a real MCP call; server calls Boston 311 live; real open
   reports render. (20s)
5. "Only network calls: our MCP server, and its one call to the city.
   Inference never left the browser." (15s)
6. Close: model does language, MCP server does protocol + real tooling,
   against a live municipal system — not a mock. (15s)
