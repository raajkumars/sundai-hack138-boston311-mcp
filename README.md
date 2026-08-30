# Sundai Hack 138 — Project 2 (2026-08-30)

Throwaway demo scaffold. Scratch only — not a qwickapps product repo.

**Theme:** "Small Models, Big Applications." **@raaj + Ted (tedschwml@gmail.com).**

## What this is

A PWA with a small local model (Qwen2.5-0.5B-Instruct, transformers.js,
WebGPU/WASM) that extracts a structured civic issue report from typed or
spoken text, then makes a **real MCP tool call** (streamable HTTP, JSON-RPC
2.0) to a small MCP server that looks it up against Boston's live Open311
API. Model does language, deterministic code does protocol — the model
never emits a tool call itself.

## Layout

- `index.html`, `manifest.json`, `sw.js`, `mcp-client.js`, `vendor/`,
  `models/`, `icons/` — the PWA (static, no build step)
- `mcp-server/` — the MCP server (Node/Express, `npm install && npm start`,
  listens on `PORT` env var, default 8311)

## Local run

```
cd mcp-server && npm install && npm start   # :8311
python3 -m http.server 8899                 # PWA, separate terminal
```

Open http://localhost:8899 — the PWA's `MCP_SERVER_URL` defaults to
`http://localhost:8311/mcp`; override via `window.MCP_SERVER_URL` before
`index.html`'s module script runs, or edit the constant, once hosted.

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
