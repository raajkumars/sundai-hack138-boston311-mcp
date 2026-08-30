# MCP Purpose Compiler — Boston 311 reference application

Sundai Hack 138: **Small Models, Big Applications**.

This project compares how the same local Ollama model performs on a real
MCP-backed task with and without purpose-compiled orchestration. The model is
selected in the UI from the models installed in the visitor's local Ollama
instance.

The application is read-only. It never files Boston 311 requests. A hosted PWA
shell is available at <https://sundai-hack138-2-gw.route.qwickforge.com/>, but
inference still requires Ollama on the visitor's machine and permission for the
page origin to access it. Running the PWA locally is the simplest demo setup.

## Live URLs

- PWA: <https://sundai-hack138-2-gw.route.qwickforge.com/>
- MCP server (streamable HTTP):
  <https://boston311-mcp-gw.route.qwickforge.com/mcp>
  — `GET .../health` for a liveness check without speaking MCP.

The source and hosted PWA use the public read-only MCP deployment by default.
No local MCP process is required.

## What it demonstrates

The browser discovers installed models through the local Ollama API and sends
inference requests only to that local service. It connects separately to an
existing MCP server that exposes two tools backed by Boston's live Open311 API:

- `lookup_service({ category })`
- `query_recent({ category, location? })`

The MCP server is unchanged by the Purpose Compiler. All new orchestration is
client-side and uses only standard `initialize`, `tools/list`, and `tools/call`
requests.

Two strategies are available in the UI:

1. **Purpose compiled** — a local Purpose Pack declares the validated workflow.
   The selected model performs one narrow language task; deterministic code owns
   category rules, MCP routing, argument validation, call limits, and result
   handling.
2. **Direct MCP agent** — the same selected model receives raw `tools/list`
   descriptions and chooses tool calls itself. Ollama-native tool calls are used
   when the model supplies them. Text output parsing is the first fallback; if
   that is still unusable, the same model retries against a JSON schema whose
   tool enum comes from `tools/list`. Used non-terminal tools are removed from
   the following decision to prevent loops. Tool and argument choices remain
   model outputs, and repair calls are included in the metrics. This is the
   comparison baseline.

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
 local Ollama model     deterministic MCP calls
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
- A running local [Ollama](https://ollama.com/) service
- At least one model installed in Ollama
- A browser allowed to access `http://127.0.0.1:11434`

## First-time setup

Install or choose at least one local model. For example:

```bash
ollama pull llama3.1:8b
```

The app defaults to `llama3.1:8b` when it is installed; otherwise it selects the
first model returned by Ollama. The dropdown exposes every model returned by
`GET /api/tags`. On selection, the app preloads that model and keeps it resident
for ten minutes so the first experiment arm does not pay a cold-load penalty.

## Start locally

The PWA uses the public read-only MCP endpoint by default; no local MCP server
is required:

```text
https://boston311-mcp-gw.route.qwickforge.com/mcp
```

Make sure Ollama is running, then start the static PWA:

```bash
cd /workspace/boston-311-hack
npm run serve
```

Open <http://localhost:8899>. The model dropdown is populated from
<http://127.0.0.1:11434/api/tags>. Allow microphone access only if you want
speech input.

The selected model can also be requested with a query parameter, for example
<http://localhost:8899/?model=llama3.2%3A1b>. A deployment can set
`window.OLLAMA_SERVER_URL` before the module script executes to use a different
local Ollama address.

Ollama permits localhost browser origins by default. A non-local hosted PWA may
require adding its exact origin to `OLLAMA_ORIGINS` and restarting Ollama.

The public deployment permits browser CORS and supports MCP protocol version
`2025-06-18`. A different deployment can still set `window.MCP_SERVER_URL`
before the module script executes.

## Compare the strategies

Use the same complaint with both selections, for example:

```text
There's a car blocking the bike lane on Main and Second.
```

Run history and the A/B cards are filtered to the model currently selected in
the dropdown, preventing accidental comparison of different models. In
addition to wall time and call counts, each run records Ollama prompt and output
token counts. Direct-agent mode remains allowed to fail when the selected model
cannot produce a valid tool decision.

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
- Ollama model discovery, request shaping, tool-call conversion, and metrics
- Deterministic civic-routing benchmark cases

## Repository layout

```text
index.html                         PWA and comparison interface
mcp-client.js                      Minimal streamable-HTTP MCP client
ollama-client.js                   Local model discovery and chat adapter
purpose-compiler.js                Generic client-side compiler/executor
direct-agent.js                    Raw tools/list comparison baseline
civic-normalizer.js                Testable Boston-specific normalization
run-metrics.js                     Browser-local execution measurements
purpose-packs/                     Portable application policy
mcp-server/                        Existing read-only Boston 311 MCP server
tests/                              Compiler and benchmark-fixture tests
```

## Scope and claims

- The selected Ollama model does language processing; application code performs
  MCP calls.
- Purpose Packs are client-side policy. MCP servers do not need new endpoints or
  code to support them.
- The live demo uses real Boston Open311 data. A clearly labeled cached example
  is shown only when a live MCP call times out.
- The project measures orchestration quality across locally installed models;
  it does not assume that every Ollama model supports reliable native tool use.
