# Server Logging

Structured logs via **pino + nestjs-pino**, written to `server/logs/` (gitignored), daily-rotated by `pino-roll` 4.x (extension-last naming: active file is `*.1.log`, rotated files get a date segment).

## Files

| File | Contents |
|---|---|
| `logs/app.1.log` (→ `app.<date>.1.log` on rotation) | Everything (info+), JSON lines. Includes HTTP requests (`method`/`url`/`statusCode`/`responseTime`). `/health` is filtered out. |
| `logs/error.1.log` | `error` level only, with full stacks (`err.type`/`err.message`/`err.stack`). |
| `logs/agent.1.log` | Agent flow only: `component=agent`, tagged with `sessionId`/`novelId`/`chapterOrder`. |

Dev also prints pretty to the console; prod writes files only.

## Analysis (jq / grep)

```sh
# All agent-flow events for a session:
jq -c 'select(.sessionId=="3baf846f-...")' server/logs/agent*.log

# Every error with its stack:
jq -c 'select(.level>=50)' server/logs/error*.log

# Find a "terminated" stream error + its surrounding context:
grep -i terminated server/logs/error*.log
jq -c 'select((.err.message // "") | test("terminated"; "i"))' server/logs/error*.log

# Then trace that session through the agent flow:
# (grab the sessionId from the error line, then):
jq -c 'select(.sessionId=="<id>")' server/logs/agent*.log

# settle timings + outcomes:
jq -c 'select(.phase // "" | startswith("settle"))' server/logs/agent*.log

# Slow HTTP requests (>2s):
jq -c 'select(.responseTime > 2000)' server/logs/app*.log
```

> Glob note: files are `*.1.log` (current period), so use `app*.log` / `error*.log` / `agent*.log`, not `app.log`.

## Agent phases logged (`logs/agent*.log`)

| phase | Where | Notes |
|---|---|---|
| `streamTurn.start` | `WorkspaceSwarmService.streamTurn` | + `userMessageLen` |
| `streamTurn.end` | same | + `latencyMs` |
| `write_chapter.detected` | same | when the `write_chapter` ToolMessage returns `ok:true` |
| `settle.dispatch` / `settle.dispatch_failed` | same | fire-and-forget settle kicked off (or its dispatcher rejected) |
| `settle.start` / `settle.success` / `settle.failed` | `AnalystService.settle` | success/failed carry `latencyMs`; failed carries `err` (stack) |
| `settle.skip_concurrent` | `AnalystService.settle` | a settle for the same novel was already in flight (per-novel lock dropped it) |

## What's NOT logged

- LLM prompt/response bodies (only metadata: lengths, latencies, success/fail). Add `redact`/explicit fields if you need content.
- agent-ui (browser) logs — server-only for now.
