# Purpose-Compiled MCP Orchestration — brief deck outline

This is the editable content outline for [`project-deck.html`](project-deck.html).
The presentation is intentionally brief and designed for a five-minute project
introduction plus a live demonstration.

## 1. Purpose-Compiled MCP Orchestration

Direct MCP tool use versus purpose-compiled orchestration for the same small
local model.

- Local inference via Ollama
- Live Boston 311 data
- Unchanged MCP server
- Controlled A/B test

## 2. Tool use is more than language generation

Small local models must correctly discover tools, conform to their schemas, and
sequence calls. They can understand a request yet fail at protocol formatting,
routing, or multi-step control.

## 3. Give the model less to get wrong

A client-side Purpose Pack turns an MCP-backed objective into a validated
workflow. The local model performs one narrow rewrite. The Purpose Pack defines
the objective, tools, workflow, references, result, and limits. Deterministic
client code derives category/location, validates live schemas, sequences calls,
and handles results. No MCP server changes are required.

## 4. Architecture

```text
Local Ollama  <->  Browser client  <->  unchanged Boston 311 MCP  ->  Open311
                    | 7-tab UI           lookup_service
                    | editable pack      query_recent
                    | compiler/MCP/metrics
```

## 5. The Purpose Pack is live, editable policy

The current application exposes the active Purpose Pack as editable JSON.

```text
edit locally -> compile against live tools/list -> activate for later Arm B runs
                         |
                         +-> invalid: retain the last valid plan
```

Valid revisions persist locally. `Clear All` restores the bundled pack. The
unchanged MCP server remains unaware of this client policy.

Current application tabs, in order:

1. Experiment
2. Purpose Pack
3. Agent & MCP
4. Boston 311 result
5. A/B summary
6. Metrics
7. Run history

## 6. Controlled A/B experiment

Held constant: selected Ollama model, civic issue, task, tools, and live MCP
server.

- A — Direct baseline: the model sees raw tool descriptions and owns tool
  choice, arguments, sequencing, and stopping.
- B — Purpose compiled: the model performs one constrained extraction; the
  compiled workflow validates and executes two bounded calls.

Measured per run: status, category correctness, wall/model time, model calls,
MCP calls, repair calls, and prompt/output tokens.

## 7. Observed demo runs — quality and reliability

Paired horizontal bars retain the raw A and B values while the badge on each
card reports a normalized A:B ratio (B = 1). This slide separates outcome
quality from resource use:

- Workflow completion rate
- Category accuracy
- Useful end-to-end success (completed and category-correct)
- First-pass success (useful success without a repair call)

In the supplied UI capture, four recent live runs per arm all completed, matched
the expected category, and required no repair. This is descriptive evidence
from one case, not a definitive benchmark.

## 8. Observed demo runs — efficiency

The second results slide compares the cost of the outcome:

- Median and maximum wall time
- Median model/inference time
- Median total tokens
- Total wall time and tokens per useful success, so fast failures do not look
  efficient
- Mean model, MCP, and repair calls per run

For lower-is-better measures, an A:B ratio of `2.4:1` means the direct baseline
used 2.4 times the resources of the purpose-compiled workflow. Maximum wall
time replaces P95 because only four captured runs per arm are available.

Observed context: `qwen2.5:14b`, one civic issue, four runs per arm, live MCP
data, hardware not recorded. From the captured run history:

- Median wall time: A 1,365 ms; B 1,055 ms
- Maximum wall time: A 1,420 ms; B 1,156 ms
- Median model time: A 783.5 ms; B 333 ms
- Median total tokens: A 454; B 114
- Mean model calls: A 1; B 1
- Mean MCP calls: A 1; B 2
- Mean repair calls: A 0; B 0

The `BENCHMARK` object in the HTML drives all raw labels, A:B ratios, bars, and
plain-language readings. Future formal benchmark results can replace these
descriptive values in one place.
