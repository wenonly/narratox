# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Repository Layout

`narratox` is a multi-project repo. The **root `package.json` only orchestrates** the sub-projects — it runs them in parallel via `npm-run-all2` (`run-p dev:*` / `run-p build:*`). It is **not a pnpm workspace** and shares no dependencies, so each sub-project still needs its own `pnpm install` (and the root needs `pnpm install` once, for `npm-run-all2`).

- **`agent-ui/`** — A Next.js 15 (App Router) + React 18 + TypeScript **AI novel-writing workspace** (the dedicated client for `server`). Originated from the Agno "Agent UI" template but now repurposed: novel library, a 3-zone writing workspace (resource nav / chat / manuscript), login/register, and a settings page.
- **`server/`** — A NestJS 11 + TypeScript + Prisma 7 (PostgreSQL) API. JWT auth, a `deep-agent` chat agent (deepagents + GLM), novel/chapter CRUD, and a uniform "mutation" write layer.
- **`langchain-learn/`** — Reference material only: the `deep-agents-tutorial/` markdown set (LangChain / deep-agents). Not built, not imported. Consult it when changing the server's deep-agent integration.

Package manager is **pnpm** everywhere.

## The two app projects ARE connected

`agent-ui` is the locked front-end for `server` (no external AgentOS anymore):

- **`agent-ui` talks to `server`.** Its endpoint defaults to `http://localhost:3001` (set as `selectedEndpoint` in [agent-ui/src/store.ts](agent-ui/src/store.ts)). Auth is JWT — the token lives in the same Zustand store and is sent as `Authorization: Bearer <token>`.
- **Ports:** `agent-ui` dev runs on `:3000` (`next dev -p 3000`). `server` defaults to `process.env.PORT ?? 3000`, but the root `dev:server` script pins `PORT=3001`, so `pnpm dev` at the root runs both without collision — agent-ui → `:3000`, server → `:3001`. Running `pnpm --dir server start:dev` directly still uses `:3000`.
- `server/.env` (gitignored) must define `DATABASE_URL`, `JWT_SECRET`, `ZHIPUAI_API_KEY`. See `server/.env.example`.

## Common Commands

### root (repo root — orchestration only)
```sh
pnpm install            # once: installs npm-run-all2 at the root
pnpm dev                # run-p dev:* → agent-ui (:3000) + server (:3001) in parallel
pnpm build              # run-p build:* → both builds in parallel
pnpm dev:agent-ui       # just agent-ui
pnpm dev:server         # just the server
```

### agent-ui (`cd agent-ui`)
```sh
pnpm dev                # next dev -p 3000  → http://localhost:3000
pnpm build              # next build
pnpm start              # next start (production)
pnpm lint               # next lint
pnpm lint:fix           # next lint --fix
pnpm typecheck          # tsc --noEmit
pnpm format             # prettier --check (does NOT write)
pnpm format:fix         # prettier --write
pnpm validate           # lint && format && typecheck  (CI-style gate)
```
There is **no test runner configured** in `agent-ui` (no Jest/Vitest/Playwright). The quality gate is `pnpm validate`.

### server (`cd server`)
```sh
pnpm start:dev          # nest start --watch (root dev:server pins PORT=3001)
pnpm build              # nest build -> dist/
pnpm start:prod         # node dist/main
pnpm test               # jest unit tests (NODE_OPTIONS=--experimental-vm-modules — needed for ESM deepagents mocks)
pnpm typecheck          # tsc --noEmit
pnpm test:cov           # coverage
pnpm lint               # eslint --fix
pnpm format             # prettier --write

# single test
pnpm test -- novel.service.spec.ts      # by file
pnpm test -- -t "should return ..."     # by test name
```
There is **no e2e runner** — only the jest unit suite (`src/**/*.spec.ts`). The deep-agent spec (`agentos/deep-agent.service.spec.ts`) uses `jest.unstable_mockModule` + dynamic `import()` to mock the ESM-only `deepagents` / `@langchain/openai`; mirror that pattern if you add tests that touch those packages. **Prisma 7 is config-driven** (`server/prisma.config.ts`), so prisma CLI commands take no `--schema` flag.

## Architecture

### agent-ui (Next.js — novel workspace)
App Router. Path alias `@/*` → `agent-ui/src/*` (in `tsconfig.json` and `next.config.ts`).

- **Routes** — [src/app/](agent-ui/src/app/): `/` novel library ([page.tsx](agent-ui/src/app/page.tsx) → `components/library/`), `/login` + `/register` (`app/(auth)/`), `/novels/[id]` workspace ([page.tsx](agent-ui/src/app/novels/[id]/page.tsx) → `components/workspace/`), `/settings` ([page.tsx](agent-ui/src/app/settings/page.tsx)). Every protected page is wrapped in [RequireAuth](agent-ui/src/components/auth/RequireAuth.tsx) (probes `/auth/me`; 401 → logout + redirect). 「新建小说」in the library calls `POST /novels` (bare CONCEPT novel, title 占位) and navigates to `/novels/[id]` — there is **no more `/novels/new` creation chat** (v0.4.0 merged creation into the workspace swarm; the main Agent state-switches onboarding vs writing).
- **Workspace (3-zone, the core)** — `components/workspace/`:
  - `ResourceNav` (left) — back-to-library, novel title, **小说信息卡** (title / genre / worldviewText / style, refreshed every turn-end so onboarding fills it in live), and greyed **P2/P3 placeholders** (大纲/角色/世界观/状态). The chapter list + 「新章」button are **gone** (v0.4.0) — chapters are AI-driven via `write_chapter`. Adding a future resource = a new nav section + a new right-pane view.
  - `ChatPanel` (center, invariant) — **reuses the existing chat infra** (`MessageArea` + `ChatInput` + `useAIStreamHandler`). On mount it sets nuqs `agent=<workspace-agent>` / `session=<novel.sessionId>` / `db_id=default` so the streaming hook posts runs to `POST /agents/:id/runs` (mode `workspace`) against the novel's chat thread. **No「采纳」button** — the writer Agent auto-writes chapters server-side via the `write_chapter` tool; the manuscript pane refreshes on turn-end.
  - `ChapterPreview` (right, renamed from `ChapterDetail` in v0.4.0) — preview pane for AI-written chapters: a `‹ 第 N 章 ›` switcher (browse any chapter read-only), a **skeleton-loading state** triggered by the `WritingChapter { order:N }` signal (auto-jumps to that chapter while the writer is working), and the rendered manuscript (MarkdownRenderer) once the stream ends. Plain-text edit mode still saves via `PATCH /novels/:id/chapters/:cid`. While the novel is still `CONCEPT` (no chapter content yet) it shows a「立项中」placeholder.
- **API layer** — [src/api/routes.ts](agent-ui/src/api/routes.ts) maps operations to server URLs (`/novels`, `/novels/:id`, `/novels/:id/chapters[/:cid]`, `/agents/:id/runs` (the agent run entry, branched on `mode`), `/sessions/...`, `/auth/...`, `/health`). The legacy `/novels/:id/accept` route still exists server-side but is no longer surfaced by the workspace UI (writer Agent auto-writes). Clients: [src/api/novels.ts](agent-ui/src/api/novels.ts) (novel/chapter), [src/api/auth.ts](agent-ui/src/api/auth.ts), [src/api/os.ts](agent-ui/src/api/os.ts) (sessions + status). Novel/chapter types in [src/types/novel.ts](agent-ui/src/types/novel.ts) (note: `NovelListItem` vs `Novel` — only the detail/get response includes `chapters`).
- **Streaming** — Agent runs stream newline-delimited JSON. [src/hooks/useAIResponseStream.tsx](agent-ui/src/hooks/useAIResponseStream.tsx) is the incremental JSON parser; [src/hooks/useAIStreamHandler.tsx](agent-ui/src/hooks/useAIStreamHandler.tsx) turns frames into `store.messages`. **RunContent frames carry CUMULATIVE content** (each frame = full text so far); the handler extracts deltas via `chunk.content.replace(lastContent, '')` and sets the clean final text on `RunCompleted`. **`WritingChapter { order:N }`** is a side-channel signal frame (v0.4.0) emitted when the writer Agent calls `write_chapter` — the handler uses it to auto-jump `ChapterPreview` to chapter N and show the skeleton while the write streams.
- **State** — One Zustand store in [src/store.ts](agent-ui/src/store.ts) (`useStore`), persisted to `localStorage` under `endpoint-storage` (only `selectedEndpoint`, `authToken`, `user` persist). Holds endpoint, authToken, user, messages, sessions, streaming flags. `login()`/`logout()` reset messages+sessions on account switch.
- **UI primitives** — shadcn/ui (new-york) in `src/components/ui/`. **Custom dark Tailwind palette** (`primary` #FAFAFA, `background` #111113, `background.secondary` #27272A, `accent` #27272A, `muted` #A1A1AA, `brand` #FF4017, `border` rgba(255,255,255,0.2)). **No shadcn `input`/`ring`/`muted-foreground`/`primary-foreground` tokens are defined** — use the custom tokens above. Styling via Tailwind + Framer Motion. Note `TextArea` (`ui/textarea`) is an autosizing **chat** input clamped to ~96px — don't reuse it for long-form editing (use a native `<textarea>`).

### server (NestJS)
Standard Nest modular layout: each feature under `src/<feature>/` as `*.module.ts` + `*.controller.ts` + `*.service.ts` + `dto/`. [src/app.module.ts](server/src/app.module.ts) imports `PrismaModule` (global), `AuthModule`, `AgentosModule`, `NovelModule`.

- **Auth** ([src/auth/](server/src/auth/)) — JWT. A **global `JwtAuthGuard`** (`APP_GUARD`) protects everything; `@Public()` opts out (register/login/health). `@CurrentUser()` injects `{id, email}`. `ValidationPipe({ whitelist, forbidNonWhitelisted })` is global in [main.ts](server/src/main.ts). All data access is scoped by `user.id` (multi-tenant isolation).
- **Agentos** ([src/agentos/](server/src/agentos/)) — the agent layer. `POST /agents/:id/runs` ([agentos.controller.ts](server/src/agentos/agentos.controller.ts)) feeds the single **workspace swarm**; the v0.3.0 standalone Creation Agent + `/novels/new` page were **removed in v0.4.0** (creation merged into the swarm: the main Agent state-switches onboarding vs writing based on `Novel.status`). The wire format (`RunStarted` / `RunContent` cumulative / `RunCompleted` / `RunError`, plus the new side-channel `WritingChapter`) is unchanged.
  - **Workspace swarm** ([workspace-swarm.service.ts](server/src/agentos/workspace-swarm.service.ts)) — `@langchain/langgraph-swarm` `createSwarm` with two agents sharing one thread (`novel.sessionId`):
    - **Main Agent** — per-novel `ContextAssembler` system prompt that is **state-aware**: when the novel is `CONCEPT` (info incomplete) the prompt drives onboarding (call `update_novel` each turn); when `ACTIVE`/info-complete it drives routing (call `transfer_to_writer`). Always holds `update_novel` + `transfer_to_writer`. Hands off via `transfer_to_writer`.
    - **Writer Agent** — owns `write_chapter` (writes by **chapterOrder**, not cuid; **auto-creates the chapter at that order if it doesn't exist** — v0.4.0) and `list_chapters`; hands back via `transfer_to_main`. **Auto-writes** chapters through the tool — there is no manual「采纳」step. `write_chapter` flipping the novel `CONCEPT→ACTIVE` on first content is the lifecycle transition.
    - **Per-novel cached**: `StreamableAgent` stored in a `Map` keyed `${userId}:${novelId}:${systemPrompt}` (see `getSwarm`).
    - **`WritingChapter` signal** — `streamTurn` walks each langgraph message-stream chunk; when it sees an AIMessage carrying a `write_chapter({chapterOrder:N})` tool_call it yields an extra `WritingChapter { order:N }` marker frame (parallel to `RunContent`). FE uses it to auto-jump the preview to chapter N.
  - **Agent tools** ([src/agentos/tools/](server/src/agentos/tools/)) — `update_novel`, `write_chapter`, `list_chapters` are LangChain `tool()` factories wrapping the Phase 1 mutation layer (`NovelService` / `ChapterService`). **`userId`/`novelId` are closure-injected at build time — never read from LLM input** (security: the model cannot address another user's novel or chapter).
  - **Shared helpers** ([agent-tools.ts](server/src/agentos/agent-tools.ts)) — `extractDelta(chunk)` (pulls the text delta out of a langgraph message-stream chunk) and `makeTrimHook(model)` (a `trimMessages` `preModelHook` — replaces deepagents' auto `SummarizationMiddleware`). System prompts live in [agent-prompts.ts](server/src/agentos/agent-prompts.ts).
  - `ContextAssembler` ([context-assembler.service.ts](server/src/agentos/context-assembler.service.ts)) — `forSession(userId, sessionId)` returns **`{ prompt, novelId, status }`**. The prompt is **state-aware** (v0.4.0): it branches on `novel.status` — `CONCEPT` → onboarding instructions (collect title/genre/worldview/style via `update_novel`); `ACTIVE`/info-complete → routing instructions (`transfer_to_writer`). Falls back to `SYSTEM_PROMPT` and `novelId: null`. (Phase 2 adds outline/character slices to the prompt.)
  - `SessionsService` (`sessions.service.ts`) — chat-thread + transcript storage (per-user scoped). `Session.id` == the LangGraph `thread_id`.
  - `StreamAdapter` (`stream-adapter.ts`) — wraps deltas into `RunStarted` / `RunContent` (cumulative) / `RunCompleted` / `RunError` frames.
  - `checkpointer.provider.ts` — `PostgresSaver.fromConnString(url, { schema: 'agent_memory' })`. **LangGraph checkpoint tables live in the `agent_memory` schema; Prisma manages only `public`** — this keeps `prisma migrate dev` drift-free. Do not move them back to `public`. Unchanged from v0.2.0.
  - **Deps:** `@langchain/langgraph` (promoted from transitive) and `@langchain/langgraph-swarm` are direct dependencies. `deepagents` is no longer used.
- **Novel** ([src/novel/](server/src/novel/)) — novel/chapter CRUD + the write path:
  - `NovelController` (`/novels` CRUD, `/novels/:id/chapters[/:cid]`, `/novels/:id/accept`), `NovelService` (creates a Novel + its 1:1 chat `Session` + a seed chapter in one transaction), `ChapterService`.
  - **Mutation layer** ([src/resources/](server/src/resources/)) — the extension seam. `ResourceMutation { resource, targetId, op: 'set'|'append'|'patch', content }`, `ResourceRegistry` (dispatch; throws on duplicate registration), `ChapterHandler` (append/set chapter content → status `COMMITTED`, scoped by user). `HandlerRegistrar` registers the chapter handler at boot. **Adding a Phase 2 resource = new `ResourceHandler` + nav section + detail view + context slice; the chat and write layer don't change.**
- **Data model** (Prisma, [prisma/schema.prisma](server/prisma/schema.prisma)) — `User`, `Session` (chat thread), `Message` (chat history), `Novel` (1:1 `Session`, has `settings` JSON, **`status: CONCEPT|ACTIVE`** — v0.4.0), `Chapter` (manuscript, `status: DRAFT|COMMITTED`). **`Novel.status` lifecycle**: a bare novel created via 「新建小说」starts `CONCEPT` (info incomplete, no chapter content); the first successful `write_chapter` that lands content flips it to `ACTIVE`. Historical rows default to `ACTIVE`. **Chat (`Message`) ≠ manuscript (`Chapter.content`).** The writer Agent writes `Chapter.content` directly via `write_chapter` (no manual copy); the `Chapter.order` integer is the tool's addressing key, and `write_chapter` auto-creates a chapter at that order if missing.
- **`server/tsconfig.json`** uses `"types": ["node", "jest"]` — `node` must stay so `process.env` type-checks under `nest build`.

### Phase status
- **Phase 1 (v0.2.0):** novel library + workspace (chat propose → accept into chapter) + per-novel prompt + mutation layer + settings. Spec: [docs/superpowers/specs/2026-06-17-novel-workspace-design.md](docs/superpowers/specs/2026-06-17-novel-workspace-design.md). Plan: [docs/superpowers/plans/2026-06-17-novel-workspace.md](docs/superpowers/plans/2026-06-17-novel-workspace.md).
- **Phase 2 (v0.3.0):** **multi-agent skeleton.** The single `DeepAgentService` was replaced by a Creation Agent (onboarding chat → `create_novel`) + a Workspace swarm (main + writer agents, `write_chapter`/`list_chapters` tools). The writer Agent auto-writes chapters (no manual「采纳」). Spec: [docs/superpowers/specs/2026-06-17-multi-agent-novel-design.md](docs/superpowers/specs/2026-06-17-multi-agent-novel-design.md). Plan: [docs/superpowers/plans/2026-06-17-multi-agent-novel.md](docs/superpowers/plans/2026-06-17-multi-agent-novel.md).
- **Phase 3 (v0.4.0, current):** **unified swarm + workspace UX evolution.** The standalone Creation Agent + `/novels/new` page were **removed**; creation is now an early-create `POST /novels` (bare CONCEPT novel) → `/novels/[id]`, and the workspace main Agent **state-switches** onboarding vs writing based on `Novel.status`. New: `Novel.status` (`CONCEPT|ACTIVE`) enum + `update_novel` tool (main Agent fills the info card) + `write_chapter` auto-creates by order and flips `CONCEPT→ACTIVE` + **`WritingChapter { order:N }`** stream signal. FE: `ResourceNav` shows a **小说信息卡** (no chapter list); right pane renamed `ChapterDetail → ChapterPreview` (chapter switcher + skeleton + WritingChapter auto-jump). Spec: [docs/superpowers/specs/2026-06-18-workspace-evolution-design.md](docs/superpowers/specs/2026-06-18-workspace-evolution-design.md). Plan: [docs/superpowers/plans/2026-06-18-workspace-evolution.md](docs/superpowers/plans/2026-06-18-workspace-evolution.md). The swarm structure (`createSwarm` + `transfer_*` handoffs) and the tool factory layer remain the extension seams for the remaining agents/resources.
- **Deferred (Phase 4+):** outline / characters / worldview as dedicated swarm agents or resources (plug into the mutation layer + nav + detail pane); status/foreshadowing (`StoryEvent` ledger, memory). Reference projects consulted: `~/project/inkos`, `~/project/webnovel-writer`; their workflows are committed under [docs/references/](docs/references/) (`inkos-workflow-reference.md`, `webnovel-writer-workflow-reference.md`) — cited by the multi-agent spec §11.
