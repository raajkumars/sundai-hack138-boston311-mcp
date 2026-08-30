# MCP Purpose Compiler — brief deck outline

This is the editable content outline for [`project-deck.html`](project-deck.html).
The presentation is intentionally brief and designed for a five-minute project
introduction plus a live demonstration.

## 1. MCP Purpose Compiler

Can purpose-compiled orchestration make the same local model more reliable at a
real MCP task?

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
workflow. The model handles issue understanding and extraction; deterministic
code handles routing, schemas, limits, results, and verification. No MCP server
changes are required.

## 4. Architecture

```text
Local Ollama  <->  Browser client  <->  unchanged Boston 311 MCP  ->  Open311
                    | Purpose Pack       lookup_service
                    | compiler           query_recent
                    | metrics
```

## 5. Controlled A/B experiment

Held constant: selected Ollama model, civic issue, task, tools, and live MCP
server.

- A — Direct baseline: the model sees raw tool descriptions and owns tool
  choice, arguments, sequencing, and stopping.
- B — Purpose compiled: the model performs one constrained extraction; the
  compiled workflow validates and executes two bounded calls.

Measured per run: status, category correctness, wall/model time, model calls,
MCP calls, repair calls, and prompt/output tokens.

## 6. Results — quality and reliability

Paired horizontal bars retain the raw A and B values while the badge on each
card reports a normalized A:B ratio (B = 1). This slide separates outcome
quality from resource use:

- Workflow completion rate
- Category accuracy
- Useful end-to-end success (completed and category-correct)
- First-pass success (useful success without a repair call)

## 7. Results — efficiency

The second results slide compares the cost of the outcome:

- Median and P95 wall time
- Median model/inference time
- Median total tokens
- Total wall time and tokens per useful success, so fast failures do not look
  efficient
- Mean model, MCP, and repair calls per run

For lower-is-better measures, an A:B ratio of `2.4:1` means the direct baseline
used 2.4 times the resources of the purpose-compiled workflow. P95 wall time is
included so the median does not conceal slow or looping outliers.

The HTML benchmark object is deliberately initialized with `null` values.
Supply:

1. Run context: exact Ollama model, device/hardware, number of test cases, runs
   per case, and whether MCP results were live or replayed.
2. For each arm: passed runs, correct-category runs, runs satisfying both,
   zero-repair successful runs, wall and model times, prompt and output tokens,
   model calls, MCP calls, and repair calls.

The `BENCHMARK` object near the top of the HTML script is the single place to
enter aggregate results; it drives labels, ratios, bars, and plain-language
readings. Rates are entered from 0 to 1 and times in milliseconds. Matched
inputs and the same warmed model should be used for both arms.
