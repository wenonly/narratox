# CLAUDE.md

Guidance for Claude Code working in this repo.

## Repository Layout

`narratox` is a multi-project repo. The **root `package.json` only orchestrates** sub-projects in parallel via `npm-run-all2` — **not a pnpm workspace**, each sub-project needs its own `pnpm install` (root needs one too, for `npm-run-all2`). Package manager is **pnpm** everywhere.

- **`agent-ui/`** — Next.js 15 (App Router) + React 18 + TypeScript **AI novel-writing workspace** (the dedicated client for `server`). Novel library, 3-zone writing workspace, 拆解小说 (dissection) module, 写作知识库 browser, login/register, settings.
- **`server/`** — NestJS 11 + TypeScript + Prisma 7 (PostgreSQL) API. JWT auth, two agent runtimes (`deep-agent` writing agent + separate `dissect` agent), per-user/per-agent multi-provider models (Vendor/Model two-tier), novel/chapter CRUD, publishing, global 写作知识库.
- **`design/`** — **Pencil design source of truth for the whole UI.** Holds `narratox.pen` (encrypted — 38 screen frames + 2 reusable components) and `_exports/` (HTML/PNG snapshots). **Modified ONLY via Pencil MCP tools — never `Read`/`Grep`/`cat` the `.pen`** (encrypted binary). Tokens authority: [2026-07-02-ui-redesign-design.md](docs/superpowers/specs/2026-07-02-ui-redesign-design.md).
- **`知识库/`** — Global writing knowledge base (6 categories: 人设档案 / 公式模板 / 创作须知 / 拆文案例 / 词汇素材库 / 方法论教程). Read-only markdown served by `KnowledgeService` (path overridable via `KB_DIR` env, default `<repo>/知识库`).

## The two app projects ARE connected

`agent-ui` is the locked front-end for `server`:

- Endpoint defaults to `http://localhost:3001` ([store.ts](agent-ui/src/store.ts)). JWT token in Zustand store, sent as `Authorization: Bearer <token>`.
- **Ports:** agent-ui dev `:3000` (`next dev -p 3000`); server defaults `PORT ?? 3000` but root `dev:server` pins `PORT=3001`, so `pnpm dev` runs both collision-free.
- `server/.env` (gitignored) must define `DATABASE_URL`, `JWT_SECRET`. **Model API keys are NOT in `.env`** — configured per-user in `/settings` UI under `Vendor`→`Model`; key never leaves server. See `server/.env.example`.

## Common Commands

### root (orchestration only)
```sh
pnpm install            # once: npm-run-all2 at root
pnpm dev                # agent-ui (:3000) + server (:3001) in parallel
pnpm build              # both builds in parallel
pnpm dev:agent-ui       # just agent-ui
pnpm dev:server         # just the server
```

### agent-ui (`cd agent-ui`)
```sh
pnpm dev                # next dev -p 3000 → http://localhost:3000
pnpm build / start      # build / production
pnpm lint / lint:fix    # next lint
pnpm typecheck          # tsc --noEmit
pnpm format / format:fix
pnpm validate           # lint && format && typecheck  (CI-style gate)
```
**No test runner** (no Jest/Vitest/Playwright). Quality gate is `pnpm validate`.

### server (`cd server`)
```sh
pnpm start:dev          # nest start --watch (root dev:server pins PORT=3001)
pnpm build              # nest build -> dist/
pnpm start:prod         # node dist/main
pnpm test               # jest unit (NODE_OPTIONS=--experimental-vm-modules for ESM deepagents mocks)
pnpm typecheck          # tsc --noEmit
pnpm test:cov / lint / format
pnpm test -- novel.service.spec.ts      # single file
pnpm test -- -t "should return ..."     # by test name
```
**No e2e runner** — only jest unit suite (`src/**/*.spec.ts`). Specs use constructor injection with `jest.fn()` doubles. **Prisma 7 is config-driven** ([prisma.config.ts](server/prisma.config.ts)) — CLI takes no `--schema` flag.

## Architecture

### agent-ui (Next.js — novel workspace)
App Router. Path alias `@/*` → `agent-ui/src/*`.

> **Design source of truth is `design/narratox.pen`** (see [design (Pencil MCP)](#design-pencil-mcp)). Workspace layout: `[IconRail ~56px] [ChatPanel flex-1] [ResourcePanel ~420px]`; library/knowledge/settings pages share [AppSidebar.tsx](agent-ui/src/components/layout/AppSidebar.tsx).

- **Routes** ([src/app/](agent-ui/src/app/)): `/` library, `/login`+`/register` (`(auth)/`), `/novels/[id]` workspace, `/dissect` (对标拆解), `/knowledge` (写作知识库), `/settings`. Every protected page wraps [RequireAuth](agent-ui/src/components/auth/RequireAuth.tsx) (probes `/auth/me`; 401 → logout). 「新建小说」calls `POST /novels` (bare CONCEPT novel) → navigates to `/novels/[id]`.
- **API layer** — [routes.ts](agent-ui/src/api/routes.ts) maps ops to server URLs. Clients: [novels.ts](agent-ui/src/api/novels.ts), [auth.ts](agent-ui/src/api/auth.ts), [os.ts](agent-ui/src/api/os.ts), [settings.ts](agent-ui/src/api/settings.ts), [knowledge.ts](agent-ui/src/api/knowledge.ts), [benchmark.ts](agent-ui/src/api/benchmark.ts). Types in [types/novel.ts](agent-ui/src/types/novel.ts) (`NovelListItem` vs `Novel` — only detail response has `chapters`).
- **Streaming** — [useAIResponseStream.tsx](agent-ui/src/hooks/useAIResponseStream.tsx) parses newline-JSON; [useAIStreamHandler.tsx](agent-ui/src/hooks/useAIStreamHandler.tsx) turns frames into `store.messages`. Activity frames: `think`/`content`/`tool`/`ActResult`, closed by `RunCompleted` with `aggregateActivities(...)` output.
- **State** — one Zustand store ([store.ts](agent-ui/src/store.ts)), persisted under `endpoint-storage` (only `selectedEndpoint`/`authToken`/`user` persist).
- **UI primitives** — shadcn/ui (new-york) in `src/components/ui/`. **Custom dark palette** (`primary` #FAFAFA, `background` #111113, `background.secondary` #27272A, `accent` #27272A, `muted` #A1A1AA, `brand` #FF4017, `border` rgba(255,255,255,0.2)). **No shadcn `input`/`ring`/`muted-foreground`/`primary-foreground` tokens defined.** `TextArea` (`ui/textarea`) is an autosizing **chat** input clamped ~96px — don't reuse for long-form editing.

### design (Pencil MCP — the UI source of truth)

`design/` is the **authoritative design source**, modified **exclusively through Pencil MCP**.

- **`design/narratox.pen`** — **NEVER `Read`/`Grep`/`cat`/`git diff --text`** (encrypted binary). Read state via `get_editor_state`, nodes via `batch_get`, structure via `snapshot_layout`, visual via `get_screenshot`, tokens via `get_variables`, all mutations via **`batch_design`**. Exports via `export_nodes`/`export_html`.
- **Contents** — 38 frames @ 1440×900 (every page/state) + 2 reusable components (`AppSidebar`, `IconRail`). Old `.pen` was lost, rebuilt from scratch ([2026-07-02-ui-redesign-design.md](docs/superpowers/specs/2026-07-02-ui-redesign-design.md)).
- **`design/_exports/`** — HTML/PNG snapshots; plain files but **derived** — regenerate via `export_nodes`/`export_html` when `.pen` changes.
- **Tokens** — [2026-07-02-ui-redesign-design.md](docs/superpowers/specs/2026-07-02-ui-redesign-design.md) (dark theme, glass morphism, Indigo→Violet `#6366f1→#8b5cf6`, Inter). **Code may lag design — spec tokens win.**
- **Workflow** — change UI: `get_editor_state` → `batch_get`/`snapshot_layout` → `batch_design` → `get_screenshot` → refresh `_exports/`. Never hand-edit exported HTML.

### server (NestJS)
Standard Nest modular layout: `src/<feature>/` as `*.module.ts` + `*.controller.ts` + `*.service.ts` + `dto/`. [app.module.ts](server/src/app.module.ts) imports `LoggerModule` (nestjs-pino, first), `LoggingModule` (global), `PrismaModule` (global), `AuthModule`, `AgentosModule`, `NovelModule`, `SettingsModule`, `KnowledgeModule`, `BenchmarkModule`.

- **Auth** ([src/auth/](server/src/auth/)) — JWT. **Global `JwtAuthGuard`** (`APP_GUARD`); `@Public()` opts out (register/login/health). `@CurrentUser()` injects `{id, email}`. Global `ValidationPipe({ whitelist, forbidNonWhitelisted })`. All data scoped by `user.id` (multi-tenant).
- **Agentos** ([src/agentos/](server/src/agentos/)) — the agent layer. `POST /agents/:id/runs` ([controller](server/src/agentos/agentos.controller.ts)) → `DeepAgentService`; route `:id` ignored (agent determined by session's novel). Controller walks langgraph stream, emits flat `ActivityEvent` frames, closes with `RunCompleted`.
  - **`DeepAgentService`** ([deep-agent.service.ts](server/src/agentos/deep-agent.service.ts)) — builds graph from **declarative [AGENT_TREE](server/src/agentos/agent-tree.config.ts)**: one main agent + five `task`-delegated orchestrators (`chapter`/`curator`/`worldbuilder`/`outliner`/`character`); `chapter` owns writer→settler→validator. Uses raw `createAgent` + hand-picked middleware (**not** `createDeepAgent`, to avoid filesystem tools). **Adding an agent = adding an `AGENT_TREE` entry, not editing this service.**
  - **Model is per-user + per-agent** — no global "active model". `getModel` reads via `ModelConfigService`, applies optional `AgentModelOverride` (`modelId`+`temperature`, both nullable=inherit). Temperature priority: per-agent > code role default > model default. `buildChatModel` ([model-factory.ts](server/src/agentos/model-factory.ts)) routes by Vendor `provider`: `openai-compatible`→`ChatOpenAI`, `anthropic`→`ChatAnthropic`, `gemini`→`ChatGoogleGenerativeAI`, `deepseek`→`ChatDeepSeek`. GLM not hardcoded. `/settings` agent-model UI driven by `buildAgentGroups()` (walks `AGENT_TREE`+`DISSECT_TREE` — new agent auto-appears).
  - **Middleware** — `createSubAgentMiddleware` (task delegation) + `createSummarizationMiddleware` + `createPatchToolCallsMiddleware`. **No filesystem middleware.** `@langchain/langgraph-swarm` **removed** — do not reintroduce `createSwarm`.
  - **Agent tools** ([tools/](server/src/agentos/tools/)) — declared as keys in `AGENT_TREE`/`DISSECT_TREE`, resolved via [TOOL_REGISTRY](server/src/agentos/agent-registry.ts). **`userId`/`novelId` (writing) and `bookId` (dissection) are closure-injected at build time — never read from LLM input** (security: model cannot address another user's novel/book). Families: chapter write, readers, setters, settlement (`write_summary`), recall (`query_memory`), reviews (`report_*_review`), knowledge/benchmark, deterministic guard `check_prose`.
  - **Prompts** live in [prompts/*.md](server/src/agentos/prompts/) — writing set (`main`/`chapter-orchestrator`/`writer`/`settler`/`validator`/`curator`/critics) loaded by [agent-prompts.ts](server/src/agentos/agent-prompts.ts); dissection set loaded by [dissect-prompts.ts](server/src/agentos/dissect-prompts.ts). Each `.md` has YAML frontmatter + body. **Load into memory at boot — edit then restart dev (not hot-reloaded).** `agent-prompts.spec.ts` locks one substring per prompt.
  - **`DissectAgentService`** ([dissect-agent.service.ts](server/src/agentos/dissect-agent.service.ts)) — SECOND independent runtime for 对标拆解, builds [DISSECT_TREE](server/src/agentos/dissect-tree.config.ts) (`dissect-main` + 5 subagents). **Async background** keyed by `bookId` (fire-and-forget; in-memory `jobs` map; HTTP streams emitter frames; client disconnect stops streaming not the agent; stale `RUNNING`→`INTERRUPTED` on boot). **Adding a dimension = `DISSECT_TREE` entry + prompt + `write_benchmark` type.**
  - **`ContextAssembler`** — `forSession(userId, sessionId)` returns `{ prompt, novelId }`; state-aware (`CONCEPT`→onboarding, `ACTIVE`→writing). Per Phase 19, main only injects **【小说态势】+【总纲】**; everything else pulled on demand via read tools. Writer augment injects 【总纲】【前情】【近期关键事件】【字数目标】【作者声音】.
  - **checkpointer** — `PostgresSaver` in **`agent_memory` schema** (Prisma manages only `public` — keeps `migrate dev` drift-free; do not move to `public`).
- **Novel** ([src/novel/](server/src/novel/)) — `NovelController`/`NovelService`/`ChapterService`. `NovelService` creates Novel + 1:1 chat `Session` + seed chapter in one transaction.
- **Memory** ([src/memory/](server/src/memory/)) — `SummaryService` (前情), `StoryEventService` (伏笔 hooks), `EventService` (plot-event ledger). Scoped by `user.id` + `novelId`/`chapterOrder`.
- **Knowledge** ([src/knowledge/](server/src/knowledge/)) — **global** writing knowledge base. `KnowledgeService` reads markdown from `KB_DIR` at request time. **JWT-protected but NOT user-scoped** (shared corpus). Routes: `GET /knowledge`, `GET /knowledge/:id`.
- **Benchmark** ([src/benchmark/](server/src/benchmark/)) — 对标拆解 persistence + HTTP. `POST /upload` (multipart→切章落库), `GET /`, `GET /:id`, `POST /:id/dissect` (start async agent + stream), `GET /:id/stream` (reconnect), `DELETE /:id`. `BenchmarkEntry.type`: `CHAPTER`/`PLOT`/`RHYTHM`/`EMOTION`/`CHARACTER`/`STYLE`.
- **Logging** ([src/logging/](server/src/logging/)) — nestjs-pino (`LoggerModule` first in `AppModule`) + global `AgentLoggerService`.
- **Settings** ([src/settings/](server/src/settings/)) — **Vendor/Model two-tier**: `Vendor` (provider/baseUrl/apiKey) → `Model` (model/temperature). Routes: `/settings/vendors` (+`/vendors/:vid/models`), `/settings/agent-models` (per-agent `AgentModelOverride`), `/settings/voice-profiles` (per-user 作者画像 library; `Novel.voiceProfileId` picks one). API keys stored plaintext (encryption-at-rest deferred).
- **Data model** ([prisma/schema.prisma](server/prisma/schema.prisma)) — `User`→activeModelId→`Model`; `Vendor`→`Model`; `AgentModelOverride`; `VoiceProfile`; `Session`/`Message`; `Novel` (1:1 Session, **`status: CONCEPT|ACTIVE`**); `Chapter`; `ChapterSummary`; `StoryEvent`; `Event` (`significance MAJOR|MINOR`); `CharacterChange`; `Volume`; `MasterOutline`; `Arc`; `ChapterOutline`; `WorldEntry`; `NovelReference` (`injectTo`=role); `Character` (+`growth`/`flaw`); `BenchmarkBook`/`BenchmarkEntry`. **`Novel.status` lifecycle**: bare novel = `CONCEPT`; first chapter content → `ACTIVE`. **Chat (`Message`) ≠ manuscript (`Chapter.content`)** — writer edits `Chapter.content` directly via tools. **Prisma 7 gotcha**: after editing schema, `migrate dev` does NOT auto-regenerate — run `pnpm --dir server prisma generate` manually.
- **tsconfig** — `server/tsconfig.json` uses `"types": ["node","jest"]` (`node` must stay for `process.env`). [tsconfig.build.json](server/tsconfig.build.json) pins `"rootDir": "./src"` — without it output nested under `dist/src/`, breaking `start:prod`. `postbuild` (`cp -R src/agentos/prompts dist/agentos/`) copies prompts for production (v11 `nest-cli assets` didn't fire).

### Phase history (specs/plans under [docs/superpowers/](docs/superpowers/))

> Detailed specs/plans live in `docs/superpowers/{specs,plans}/`. Phases 1–21 are historical evolution; Phase 27 merged outliner/worldbuilder/character into main, so references to those orchestrators/writers in Phase 5–21 descriptions are **pre-refactor history**, not current code. Current code = architecture above.

- **P1** library+workspace+settings · **P2** swarm skeleton (superseded by P4) · **P3** unified workspace + `Novel.status`. Specs: [P1](docs/superpowers/specs/2026-06-17-novel-workspace-design.md) · [P3](docs/superpowers/specs/2026-06-17-novel-workspace-design.md).
- **P4** swarm→`deepagents` + per-user model config + `AppSidebar`. Specs: [deepagents](docs/superpowers/specs/2026-06-19-deepagents-migration-design.md) · [model-nav](docs/superpowers/specs/2026-06-20-model-config-and-nav-design.md).
- **P5** declarative `AGENT_TREE` + character agent + phase header. **P6** character context injection + panel. **P7** character-consistency in validator. **P8** writer chapter-continuity (neighbor reads). **P9** validator outline-fulfillment (dim 12). **P10** outline-rewrite feedback loop (living outline). Specs under `docs/superpowers/specs/2026-06-2{4,7}-*`.
- **P11** `Event` resource (plot ledger). **P12** `Arc` + `Volume.arcSummary` (layered summary — completes long-novel-coherence P9-P12). **P13** `StatusService`/【小说态势】. **P14** main-agent reinforcement (`MAIN_ROLE_REMINDER` every turn) + prompt rewrite. **P15** test suite L0-L3 (harness in `test/harness/`). **P16** interactive orchestration (一步一停). Specs under `docs/superpowers/specs/2026-06-27/28-*`.
- **P17** curator live references (`buildAgentRoster`/`buildReferenceSlice`). **P18** `MasterOutline` + arc/volume exposure. **P19** context compression (main injects 态势+总纲 only; writer pulls rest). Specs under `docs/superpowers/specs/2026-06-28/29-*`.
- **P20** three-act + unit cycle structure. **P21** character bio (`growth`/`flaw`) + changes slim (`significance`). Specs: [three-act](docs/superpowers/specs/2026-06-30-three-act-unit-cycle-design.md) · [character-bio](docs/superpowers/specs/2026-06-30-character-bio-and-changes-slim-design.md).
- **P22** 拆解小说 agent + global 对标库 + per-agent model config. Spec: [dissection](docs/superpowers/specs/2026-06-30-novel-dissection-design.md).
- **P23** Vendor/Model two-tier restructure + per-agent temperature. Specs: [vendor](docs/superpowers/specs/2026-06-30-model-config-vendor-restructure-design.md) · [nullable](docs/superpowers/specs/2026-06-30-per-agent-modelid-nullable-design.md).
- **P24** deterministic prose guard (`ProseGuardService` + `check_prose`). Spec: [prose-guard](docs/superpowers/specs/2026-06-30-prose-guard-design.md).
- **P25** novel publishing (`POST /novels/:id/publish`). Spec: [publish](docs/superpowers/specs/2026-06-30-novel-publish-design.md).
- **P26 (current)** UI full redesign + `design/` directory (Pencil MCP). Spec: [ui-redesign](docs/superpowers/specs/2026-07-02-ui-redesign-design.md).
- **P27 (current)** merged outliner/worldbuilder/character agents into `main` (AGENT_TREE 14→11 nodes; main.tools 16→36; three critics flattened under main). Spec: [remove-outliner](docs/superpowers/specs/2026-07-13-remove-outliner-agent-design.md).
- **Deferred:** manual character edit/delete UI; relationship/info-boundary matrix; encryption-at-rest for API keys; "test connection" button; thread tool-I/O 堆积治理; vector retrieval (千章级); dissection M:N causality. Reference projects: `~/project/inkos`, `~/project/webnovel-writer` (workflows under [docs/references/](docs/references/)).
