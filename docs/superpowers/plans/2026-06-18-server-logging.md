# narratox Server Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured, file-based logging to the NestJS server: every HTTP request, DI/bootstrap event, and uncaught error flows through pino to daily-rotated JSON-line files (`logs/app`, `logs/error`), plus a dedicated `logs/agent` file capturing the GLM/swarm/settle flow with session/novel/chapter correlation — so issues like the "terminated" stream error can be analyzed after the fact with `jq`/`grep`.

**Architecture:** `nestjs-pino` replaces Nest's default logger globally (config in `main.ts`/`AppModule`) with a multi-target transport: pretty console (dev) + `pino-roll` daily-rotated `app.log` (all) + `error.log` (error+). A separate injectable `AgentLoggerService` (its own pino instance → `agent.log`) provides context-child loggers for the agent flow. The 3 scattered `console.error` calls are replaced with the real logger; agent-flow milestones (streamTurn start/end + latency, write_chapter detection, settle start/success/fail + stack) are added.

**Tech Stack:** NestJS 11 + `pino` + `nestjs-pino` + `pino-pretty` (dev console) + `pino-roll` (daily rotation). pnpm. Gate: `cd server && pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

**Spec/design:** confirmed in conversation (pino + nestjs-pino; JSON-lines files; 3 files app/error/agent daily-rotated; server-only; console kept in dev).

---

## File Structure

- Create: `server/src/logging/logging.config.ts` — nestjs-pino options (console + app.log + error.log transports).
- Create: `server/src/logging/agent-logger.service.ts` — `AgentLoggerService` (injectable): pino instance → agent.log; `forContext(ctx)` returns a child logger carrying sessionId/novelId/chapterOrder.
- Create: `server/src/logging/logging.module.ts` — exports `AgentLoggerService`.
- Modify: `server/src/main.ts` — `bufferLogs:true`, `app.useLogger(app.get(LoggerService))`.
- Modify: `server/src/app.module.ts` — import `LoggerModule.forRoot(pinoLoggerOptions)` + `LoggingModule`.
- Modify: `server/src/agentos/workspace-swarm.service.ts` — inject `AgentLoggerService`; log streamTurn start/end + write_chapter detection + settle dispatch; replace `console.error`.
- Modify: `server/src/agentos/analyst.service.ts` — inject `AgentLoggerService`; log settle start/success/fail (+stack); replace `console.error`.
- Modify: `server/src/agentos/agentos.controller.ts` — replace `console.error` (appendTurn) with injected logger.
- Modify: `server/src/agentos/agentos.module.ts` — import `LoggingModule`.
- Modify: `server/src/agentos/analyst.service.spec.ts` — spy `AgentLoggerService` instead of `console.error`.
- Create: `server/logs/.gitkeep`? No — `logs/` already gitignored. No file needed.
- Create: `docs/logging.md` — brief usage/jq cheatsheet.

---

## Notes for the implementer

- **`.gitignore` already covers `logs` + `*.log`** — do NOT change gitignore; logs must stay untracked.
- **Run from `server/`** — `pnpm start:dev` sets cwd to `server/`, so relative paths `logs/app.log` resolve to `server/logs/`. Verify by booting and checking the files appear under `server/logs/`.
- **pino-roll daily rotation:** use `frequency: 'daily'` + `mkdir: true`. Exact suffix format (`app.log.2026-06-18` vs dated dir) is pino-roll's concern — boot, write a log, and confirm a dated file appears under `server/logs/`. If pino-roll's option names differ from the snippets below (API has shifted across versions), adapt to the installed version's README; the INTENT is "daily-rotated file under logs/". Report which naming you got.
- **pino transports run in a worker thread** — fine in Nest CommonJS. nestjs-pino wires this via `pinoHttp.transport`.
- **Error serialization:** pino serializes the `err` property by default (type + message + stack). Always log caught errors as `{ err }` (or `{ error: err }` — but `err` is the conventional pino key that triggers the serializer). Verify the stack lands in `error.log`.
- **`bufferLogs: true`** in `NestFactory.create` so early bootstrap logs (before logger is ready) are replayed — important, else DI errors during boot are lost.
- **Commit after every task.** Gate: `cd server && pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

---

# Task 1: Install deps + global pino logger (nestjs-pino)

**Files:** deps; create `logging.config.ts`; modify `main.ts` + `app.module.ts`.

- [ ] **Step 1: Install dependencies**

Run (from `server/`):
```sh
cd server && pnpm add pino nestjs-pino pino-pretty pino-roll
```
Expected: 4 packages added. Confirm in `package.json`.

- [ ] **Step 2: Create the pino config**

Create `server/src/logging/logging.config.ts`:

```ts
import type { Params } from 'nestjs-pino';

const isDev = process.env.NODE_ENV !== 'production';

/**
 * nestjs-pino 配置。dev:pretty 控制台 + app.log(全量)+ error.log(error+)。
 * prod:仅文件。均经 pino-roll 按天滚动,写到 server/logs/。
 * HTTP 请求自动记录(method/url/statusCode/responseTime)。
 */
export const pinoLoggerOptions: Params = {
  pinoHttp: {
    level: isDev ? 'debug' : 'info',
    autoLogging: {
      ignore: (req) => {
        // 不记录健康检查噪声
        const url = (req as { url?: string }).url ?? '';
        return url.endsWith('/health');
      },
    },
    transport: isDev
      ? {
          targets: [
            {
              target: 'pino-pretty',
              level: 'info',
              options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' },
            },
            {
              target: 'pino-roll',
              level: 'info',
              options: { file: 'logs/app.log', frequency: 'daily', mkdir: true },
            },
            {
              target: 'pino-roll',
              level: 'error',
              options: { file: 'logs/error.log', frequency: 'daily', mkdir: true },
            },
          ],
        }
      : {
          targets: [
            { target: 'pino-roll', level: 'info', options: { file: 'logs/app.log', frequency: 'daily', mkdir: true } },
            { target: 'pino-roll', level: 'error', options: { file: 'logs/error.log', frequency: 'daily', mkdir: true } },
          ],
        },
  },
};
```

> If `nestjs-pino`'s `Params` import path or `pinoHttp` shape differs in the installed version, adapt — the goal is `LoggerModule.forRoot({ pinoHttp: { transport: { targets: [...] } } })`. Boot and confirm files appear.

- [ ] **Step 3: Wire LoggerModule in AppModule**

Open `server/src/app.module.ts`. Add imports and register `LoggerModule.forRoot(pinoLoggerOptions)` in `imports` (place it FIRST so it captures the other modules' init). Add:
```ts
import { LoggerModule } from 'nestjs-pino';
import { pinoLoggerOptions } from './logging/logging.config';
```
`imports: [LoggerModule.forRoot(pinoLoggerOptions), PrismaModule, AuthModule, ... ]` (keep the existing imports, just prepend LoggerModule).

- [ ] **Step 4: Wire the logger in main.ts**

Open `server/src/main.ts`. Full new content:

```ts
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { LoggerService } from 'nestjs-pino';
import { AppModule } from './app.module';

async function bootstrap() {
  // bufferLogs:引导期(logger 就绪前)的日志先缓存,就绪后回放 —— 否则 DI/启动错误会丢。
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(LoggerService));
  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
  );
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
```

- [ ] **Step 5: typecheck + lint + boot-smoke**

Run: `cd server && pnpm typecheck && pnpm lint`
Then boot briefly and confirm files are created:
```sh
(cd server && PORT=3019 node dist/src/main.js &) ; sleep 8 ; ls -la server/logs/ ; curl -s http://localhost:3019/health ; pkill -f "dist/src/main.js"
```
Expected: `server/logs/` contains `app.log*` (and the pretty console output shows the route-mapping + "Nest application successfully started"). Confirm an HTTP request line (the `/health` is ignored, so curl `/sessions` with no auth or just check the bootstrap lines landed in `app.log`). If files don't appear, check cwd (must run from server/) and pino-roll options.

- [ ] **Step 6: Commit**
```sh
git add server/package.json server/pnpm-lock.yaml server/src/logging/logging.config.ts server/src/app.module.ts server/src/main.ts
git commit -m "feat(server): structured pino logging (app/error files, daily-rotated)

nestjs-pino replaces the default logger; HTTP requests + bootstrap + errors flow
to logs/app.log + logs/error.log (pino-roll daily). bufferLogs replays boot logs.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Task 2: AgentLoggerService + agent-flow instrumentation + replace console.error

**Files:** create `agent-logger.service.ts` + `logging.module.ts`; modify `workspace-swarm.service.ts`, `analyst.service.ts`, `agentos.controller.ts`, `agentos.module.ts`, `analyst.service.spec.ts`.

- [ ] **Step 1: Create AgentLoggerService + LoggingModule**

Create `server/src/logging/agent-logger.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import pino from 'pino';

/**
 * 独立 pino 实例 → logs/agent.log(按天滚动),专给 agent 流写结构化事件。
 * forContext 返回带 sessionId/novelId/chapterOrder 的子 logger。
 * 错误用 { err } 触发 pino 默认错误序列化(type+message+stack)。
 */
@Injectable()
export class AgentLoggerService {
  private readonly logger: pino.Logger;

  constructor() {
    this.logger = pino(
      { level: 'info' },
      pino.transport({
        target: 'pino-roll',
        options: { file: 'logs/agent.log', frequency: 'daily', mkdir: true },
      }),
    );
  }

  forContext(ctx: { sessionId?: string; novelId?: string; chapterOrder?: number }): pino.Logger {
    return this.logger.child(ctx);
  }
}
```

Create `server/src/logging/logging.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { AgentLoggerService } from './agent-logger.service';

@Global()
@Module({
  providers: [AgentLoggerService],
  exports: [AgentLoggerService],
})
export class LoggingModule {}
```

(`@Global()` so AgentLoggerService is injectable everywhere without per-module imports.)

- [ ] **Step 2: Register LoggingModule**

`server/src/app.module.ts` — add `import { LoggingModule } from './logging/logging.module';` and add `LoggingModule` to `imports` (after `LoggerModule`).

- [ ] **Step 3: Instrument workspace-swarm.service.ts**

Open `server/src/agentos/workspace-swarm.service.ts`. Inject `AgentLoggerService` in the constructor (add `private readonly agentLog: AgentLoggerService,` to the constructor params; import the type). In `streamTurn`:

- At method start, capture `const startedAt = Date.now();` and create a context logger:
```ts
    const log = this.agentLog.forContext({ sessionId: threadId, novelId });
    log.info({ phase: 'streamTurn.start', userMessageLen: userMessage.length }, 'streamTurn');
```
- Where `settledChapterOrder` is set (write_chapter ToolMessage detected), log:
```ts
            log.info({ phase: 'write_chapter.detected', chapterOrder: parsed.chapterOrder }, 'agent');
```
- At the fire-and-forget settle, log dispatch + chain the catch through the logger:
```ts
    if (settledChapterOrder !== null && this.analyst) {
      log.info({ phase: 'settle.dispatch', chapterOrder: settledChapterOrder }, 'agent');
      void this.analyst
        .settle({ userId, novelId, chapterOrder: settledChapterOrder })
        .catch((e) => {
          log.error({ phase: 'settle.dispatch_failed', chapterOrder: settledChapterOrder, err: e instanceof Error ? e : new Error(String(e)) }, 'agent');
        });
    }
    log.info({ phase: 'streamTurn.end', latencyMs: Date.now() - startedAt }, 'streamTurn');
```
(Remove the previous `console.error('[agentos] analyst settle dispatcher failed:', ...)` — replaced by the `log.error` above.) Place the `streamTurn.end` log as the last statement before the method returns (after the settle block). Read the current method to place these correctly; keep the existing yield logic untouched.

- [ ] **Step 4: Instrument analyst.service.ts**

Open `server/src/agentos/analyst.service.ts`. Inject `AgentLoggerService` (constructor param; import type). In `settle`, add timing + structured logs, and replace the `console.error`:

```ts
  async settle(args: { userId: string; novelId: string; chapterOrder: number }): Promise<void> {
    const { userId, novelId, chapterOrder } = args;
    const log = this.agentLog.forContext({ novelId, chapterOrder });
    if (this.settlingNovels.has(novelId)) {
      log.info({ phase: 'settle.skip_concurrent' }, 'agent');
      return;
    }
    this.settlingNovels.add(novelId);
    const startedAt = Date.now();
    try {
      log.info({ phase: 'settle.start' }, 'agent');
      await this.doSettle(userId, novelId, chapterOrder);
      log.info({ phase: 'settle.success', latencyMs: Date.now() - startedAt }, 'agent');
    } catch (err) {
      log.error(
        { phase: 'settle.failed', latencyMs: Date.now() - startedAt, err: err instanceof Error ? err : new Error(String(err)) },
        'agent',
      );
    } finally {
      this.settlingNovels.delete(novelId);
    }
  }
```
(Remove the old `console.error(...)` block.) Keep `doSettle` unchanged.

- [ ] **Step 5: Replace console.error in agentos.controller.ts**

Open `server/src/agentos/agentos.controller.ts`. It has `console.error('[agentos] appendTurn failed ...', ...)`. Inject the Nest logger into the controller: `constructor(... private readonly logger: LoggerService ...)` — actually use Nest's `Logger` via the injected pino `LoggerService`. Simplest: inject `@InjectPinoLogger`? No — nestjs-pino provides a `Logger` that uses the configured pino. Use the standard Nest `Logger`:
```ts
import { Logger } from '@nestjs/common';
// in constructor:
private readonly logger = new Logger(AgentosController.name);
// replace console.error:
this.logger.error(`[agentos] appendTurn failed for session ${sessionId}: ${err instanceof Error ? err.message : err}`);
```
Nest's `Logger` routes through the configured pino logger (since we did `app.useLogger(...)`), so this lands in app.log + error.log. (Keep it simple — `new Logger(name)` is fine; it picks up the active logger at call time.)

- [ ] **Step 6: Update analyst.service.spec.ts**

The test (line ~49) spies `console.error` because settle used to log via `console.error`. Now settle logs via `AgentLoggerService`. Update: inject a mock `AgentLoggerService` whose `forContext` returns a stub pino-like logger (`{ info: jest.fn(), error: jest.fn() }`). In the "never throws" test, assert the mock's `error` was called instead of `console.error`. Update the `makeMocks`/`makeService` helpers to construct `AnalystService` with the mocked agent logger.

```ts
const agentLog = { forContext: jest.fn().mockReturnValue({ info: jest.fn(), error: jest.fn() }) };
new AnalystService(chapters, novels, summaries, events, agentLog as unknown as AgentLoggerService);
```
For the "never throws" test: `forContext` should return an object whose `.error` you can assert — e.g. make `forContext` return a shared `{ info: jest.fn(), error: jest.fn() }` instance so you can assert `itsErrorSpy` was called.

- [ ] **Step 7: typecheck + lint + test + build**

Run: `cd server && pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: clean + green (the AnalystService test count unchanged; the spy target changed). If lint flags the pino types, fix per the rules (no `eslint-disable`).

- [ ] **Step 8: Commit**
```sh
git add server/src/logging/agent-logger.service.ts server/src/logging/logging.module.ts server/src/app.module.ts server/src/agentos/workspace-swarm.service.ts server/src/agentos/analyst.service.ts server/src/agentos/agentos.controller.ts server/src/agentos/analyst.service.spec.ts
git commit -m "feat(agentos): agent-flow structured logging (agent.log) + replace console.error

AgentLoggerService → logs/agent.log with session/novel/chapter correlation;
log streamTurn start/end+latency, write_chapter detection, settle start/success/fail+stack.
Controller/swarm console.error replaced with the configured logger.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# Task 3: Logging docs + end-to-end verification

**Files:** create `docs/logging.md`.

- [ ] **Step 1: Write the docs/cheatsheet**

Create `docs/logging.md`:

````markdown
# Server Logging

Structured logs via **pino + nestjs-pino**, written to `server/logs/` (gitignored), daily-rotated by `pino-roll`.

## Files

| File | Contents |
|---|---|
| `logs/app.log*` | Everything (info+), JSON lines. Includes HTTP requests (method/url/statusCode/responseTime). |
| `logs/error.log*` | `error` level only, with full stacks. |
| `logs/agent.log*` | Agent flow only: `component=agent`, tagged with `sessionId`/`novelId`/`chapterOrder`. |

Dev also prints pretty to the console; prod writes files only.

## Analysis (jq / grep)

```sh
# All agent-flow events for a session:
jq -c 'select(.sessionId=="3baf846f-...")' server/logs/agent.log*

# Every error with its stack:
jq -c 'select(.level>=50)' server/logs/error.log*

# Find a "terminated" stream error + its surrounding context:
grep -i terminated server/logs/error.log*
jq -c 'select((.err.message // "") | test("terminated"))' server/logs/error.log*

# settle timings:
jq -c 'select(.phase|startswith("settle"))' server/logs/agent.log*

# Slow HTTP requests (>2s):
jq -c 'select(.responseTime > 2000)' server/logs/app.log*
```

## Agent phases logged

`streamTurn.start` / `streamTurn.end` (+latencyMs) · `write_chapter.detected` · `settle.dispatch` / `settle.dispatch_failed` · `settle.start` / `settle.success` / `settle.failed` (+latencyMs, +err stack) · `settle.skip_concurrent`.
````

- [ ] **Step 2: Full gate**

Run: `cd server && pnpm typecheck && pnpm lint && pnpm test && pnpm build`
Expected: clean + green + built.

- [ ] **Step 3: Boot + end-to-end smoke**

```sh
(cd server && PORT=3019 node dist/src/main.js &) ; sleep 8
# confirm all 3 file categories exist:
ls server/logs/
# trigger a (failing-auth) request to generate a log line + an error:
curl -s http://localhost:3019/novels ; echo
# check app.log got the request, error.log got the 401, agent.log exists (may be empty until a real run):
tail -3 server/logs/app.log* ; echo "---" ; tail -3 server/logs/error.log*
pkill -f "dist/src/main.js"
```
Expected: `app.log*` shows the `/novels` request + 401; `error.log*` shows the 401 (if nestjs-pino logs 4xx as warn, it may only be in app.log — acceptable); `agent.log*` exists (empty until an agent run). Confirm dated rotation naming.

- [ ] **Step 4: Commit**
```sh
git add docs/logging.md
git commit -m "docs: server logging cheatsheet (files + jq/grep examples)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

**Coverage:** 3-file structure (app/error/agent) → Task 1 (app/error via nestjs-pino) + Task 2 (agent via AgentLoggerService). HTTP logging → Task 1 `pinoHttp`. Agent milestones (streamTurn/settle/write_chapter) → Task 2. console.error removal (3 sites) → Task 2 Steps 3/4/5 + spec fix. Docs → Task 3. ✓

**Placeholder scan:** pino-roll option names flagged for runtime verification (honest about API drift); all logic code complete. No TBD. ✓

**Type consistency:** `AgentLoggerService.forContext` returns `pino.Logger`; callers use `.info({...}, 'agent')`/`.error({err}, 'agent')` consistently. `LoggerService` from `nestjs-pino` used in main.ts; Nest's `Logger` in the controller (routes to configured pino). AnalystService/WorkspaceSwarmService constructors gain `agentLog: AgentLoggerService` param — spec updated to match. ✓

**No gaps.**
