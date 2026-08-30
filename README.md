# MCP Purpose Compiler — Boston 311 reference application

Sundai Hack 138: **Small Models, Big Applications**.

This project demonstrates that a very small on-device model can complete a
real MCP-backed task more reliably when the application's purpose is compiled
into a constrained workflow instead of asking the model to reason about the
protocol and choose every tool itself.

The application is read-only. It never files Boston 311 requests.

## What it demonstrates

The browser runs SmolLM2-135M-Instruct locally with Transformers.js. It connects
to an existing MCP server that exposes two tools backed by Boston's live Open311
API:

- `lookup_service({ category })`
- `query_recent({ category, location? })`

The MCP server is unchanged by the Purpose Compiler. All new orchestration is
client-side and uses only standard `initialize`, `tools/list`, and `tools/call`
requests.

Two strategies are available in the UI:

1. **Purpose compiled** — a local Purpose Pack declares the validated workflow.
   The small model performs one narrow language task; deterministic code owns
   category rules, MCP routing, argument validation, call limits, and result
   handling.
2. **Direct MCP agent** — the same model receives raw `tools/list` descriptions
   and chooses tool calls itself. This is the comparison baseline.

Every run records wall time, model time, model calls, MCP calls, status, and
location fallback behavior in browser-local storage. Complaint text is not
stored.

## Architecture

```text
Existing MCP server (unchanged)
  initialize + tools/list + tools/call
                    |
                    v
       Client-side Purpose Pack
                    |
                    v
       Workflow compiler + validator
                    |
          +---------+----------+
          |                    |
          v                    v
   on-device model      deterministic MCP calls
          |                    |
          +---------+----------+
                    v
          live Boston 311 results
```

The portable policy is
[`purpose-packs/boston-311-related-reports.json`](purpose-packs/boston-311-related-reports.json).
The generic compiler is [`purpose-compiler.js`](purpose-compiler.js).

## Prerequisites

- Node.js 18 or newer
- Python 3 (used only as a no-build static file server)
- `curl`
- Chrome or another browser with WebGPU preferred; WASM is the fallback
- About 200 MB of disk space for browser model assets

## First-time setup

The model and Transformers.js assets are intentionally ignored by Git. Download
the pinned public artifacts once:

```bash
cd /workspace/boston-311-hack
npm run setup:assets
```

The script is idempotent and pins Transformers.js, ONNX Runtime Web, and the
model repository revision. Browser inference makes no model-host request after
these assets are installed.

## Start locally

Terminal 1 — existing MCP server:

```bash
cd /workspace/boston-311-hack/mcp-server
npm install
npm start
```

The server listens on port `8311` by default. Verify it with:

```bash
curl http://localhost:8311/health
```

Terminal 2 — static PWA:

```bash
cd /workspace/boston-311-hack
npm run serve
```

Open <http://localhost:8899>. The first page load reads the model from the local
static server and caches the application shell. Allow microphone access only if
you want speech input.

The app probes for a usable WebGPU adapter before creating the model pipeline
and selects local WASM inference when no adapter is available. To force the
portable path, open <http://localhost:8899/?backend=wasm>.

The PWA defaults to `http://localhost:8311/mcp`. A deployment can set
`window.MCP_SERVER_URL` before the module script executes.

## Compare the strategies

Use the same complaint with both selections, for example:

```text
There's a car blocking the bike lane on Main and Second.
```

The run history compares observable execution results. Purpose-compiled mode is
the reliable demo path; direct-agent mode is intentionally allowed to fail when
the 135M model cannot produce a valid tool decision.

For reproducibility, deterministic category and location behavior is checked
against [`tests/fixtures/civic-issues.json`](tests/fixtures/civic-issues.json).
Live report contents are not used as fixed assertions because Boston's public
data changes continuously.

## Tests

```bash
cd /workspace/boston-311-hack
npm test
```

The tests cover:

- Purpose Pack compatibility with `tools/list`
- Fail-closed behavior for missing tools and incompatible arguments
- Workflow reference resolution and call limits
- Direct-agent output parsing
- Deterministic civic-routing benchmark cases

## Repository layout

```text
index.html                         PWA and comparison interface
mcp-client.js                      Minimal streamable-HTTP MCP client
purpose-compiler.js                Generic client-side compiler/executor
direct-agent.js                    Raw tools/list comparison baseline
civic-normalizer.js                Testable Boston-specific normalization
run-metrics.js                     Browser-local execution measurements
purpose-packs/                     Portable application policy
mcp-server/                        Existing read-only Boston 311 MCP server
scripts/setup-assets.sh            Reproducible ignored-asset download
tests/                              Compiler and benchmark-fixture tests
```

## Scope and claims

- The local model does language processing; application code performs MCP calls.
- Purpose Packs are client-side policy. MCP servers do not need new endpoints or
  code to support them.
- The live demo uses real Boston Open311 data. A clearly labeled cached example
  is shown only when a live MCP call times out.
- The project measures orchestration quality; it does not claim the 135M model
  has native or generally reliable MCP tool-calling ability.
