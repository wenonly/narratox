# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

- **Routes** — [src/app/](agent-ui/src/app/): `/` novel library ([page.tsx](agent-ui/src/app/page.tsx) → `components/library/`), `/login` + `/register` (`app/(auth)/`), `/novels/[id]` workspace ([page.tsx](agent-ui/src/app/novels/[id]/page.tsx) → `components/workspace/`), `/settings` ([page.tsx](agent-ui/src/app/settings/page.tsx)). Every protected page is wrapped in [RequireAuth](agent-ui/src/components/auth/RequireAuth.tsx) (probes `/auth/me`; 401 → logout + redirect).
- **Workspace (3-zone, the core)** — `components/workspace/`:
  - `ResourceNav` (left) — back-to-library, novel title, **章节** list (selectable + 新章), and greyed **P2/P3 placeholders** (大纲/角色/世界观/状态). Adding a future resource = a new nav section + a new right-pane view.
  - `ChatPanel` (center, invariant) — **reuses the existing chat infra** (`MessageArea` + `ChatInput` + `useAIStreamHandler`). On mount it sets nuqs `agent=deep-agent` / `session=<novel.sessionId>` / `db_id=default` so the existing streaming hook posts runs to `POST /agents/deep-agent/runs` against the novel's chat thread. AI message bubbles carry **「采纳到本章」** → `POST /novels/:id/accept { chapterId, op:'append'|'set', content }`.
  - `ChapterDetail` (right) — renders the selected chapter's manuscript (MarkdownRenderer) with a plain-text edit mode that saves via `PATCH /novels/:id/chapters/:cid`. Switches view by left-rail selection (Phase 2 will add character/worldview/etc. views here).
- **API layer** — [src/api/routes.ts](agent-ui/src/api/routes.ts) maps operations to server URLs (`/novels`, `/novels/:id`, `/novels/:id/chapters[/:cid]`, `/novels/:id/accept`, `/agents/:id/runs`, `/sessions/...`, `/auth/...`, `/health`). Clients: [src/api/novels.ts](agent-ui/src/api/novels.ts) (novel/chapter/accept), [src/api/auth.ts](agent-ui/src/api/auth.ts), [src/api/os.ts](agent-ui/src/api/os.ts) (sessions + status). Novel/chapter types in [src/types/novel.ts](agent-ui/src/types/novel.ts) (note: `NovelListItem` vs `Novel` — only the detail/get response includes `chapters`).
- **Streaming** — Agent runs stream newline-delimited JSON. [src/hooks/useAIResponseStream.tsx](agent-ui/src/hooks/useAIResponseStream.tsx) is the incremental JSON parser; [src/hooks/useAIStreamHandler.tsx](agent-ui/src/hooks/useAIStreamHandler.tsx) turns frames into `store.messages`. **RunContent frames carry CUMULATIVE content** (each frame = full text so far); the handler extracts deltas via `chunk.content.replace(lastContent, '')` and sets the clean final text on `RunCompleted`.
- **State** — One Zustand store in [src/store.ts](agent-ui/src/store.ts) (`useStore`), persisted to `localStorage` under `endpoint-storage` (only `selectedEndpoint`, `authToken`, `user` persist). Holds endpoint, authToken, user, messages, sessions, streaming flags. `login()`/`logout()` reset messages+sessions on account switch.
- **UI primitives** — shadcn/ui (new-york) in `src/components/ui/`. **Custom dark Tailwind palette** (`primary` #FAFAFA, `background` #111113, `background.secondary` #27272A, `accent` #27272A, `muted` #A1A1AA, `brand` #FF4017, `border` rgba(255,255,255,0.2)). **No shadcn `input`/`ring`/`muted-foreground`/`primary-foreground` tokens are defined** — use the custom tokens above. Styling via Tailwind + Framer Motion. Note `TextArea` (`ui/textarea`) is an autosizing **chat** input clamped to ~96px — don't reuse it for long-form editing (use a native `<textarea>`).

### server (NestJS)
Standard Nest modular layout: each feature under `src/<feature>/` as `*.module.ts` + `*.controller.ts` + `*.service.ts` + `dto/`. [src/app.module.ts](server/src/app.module.ts) imports `PrismaModule` (global), `AuthModule`, `AgentosModule`, `NovelModule`.

- **Auth** ([src/auth/](server/src/auth/)) — JWT. A **global `JwtAuthGuard`** (`APP_GUARD`) protects everything; `@Public()` opts out (register/login/health). `@CurrentUser()` injects `{id, email}`. `ValidationPipe({ whitelist, forbidNonWhitelisted })` is global in [main.ts](server/src/main.ts). All data access is scoped by `user.id` (multi-tenant isolation).
- **Agentos** ([src/agentos/](server/src/agentos/)) — the chat agent:
  - `DeepAgentService` (`deep-agent.service.ts`) wraps `deepagents.createDeepAgent` + GLM via `@langchain/openai` `ChatOpenAI` (dynamic import to keep jest clean). **Builds/caches one agent per system-prompt string** (so each novel gets its tailored prompt). `streamTurn({threadId, userMessage, systemPrompt})` yields text deltas.
  - `ContextAssembler` (`context-assembler.service.ts`) — `forSession(userId, sessionId)` loads the novel by session and returns an author-facing Chinese system prompt built from title/genre/synopsis/worldview/style (Phase 1 lite; Phase 2 adds outline/character slices). Falls back to `SYSTEM_PROMPT`.
  - `SessionsService` (`sessions.service.ts`) — chat-thread + transcript storage (per-user scoped). `Session.id` == the LangGraph `thread_id`.
  - `StreamAdapter` (`stream-adapter.ts`) — wraps deltas into `RunStarted` / `RunContent` (cumulative) / `RunCompleted` / `RunError` frames.
  - `checkpointer.provider.ts` — `PostgresSaver.fromConnString(url, { schema: 'agent_memory' })`. **LangGraph checkpoint tables live in the `agent_memory` schema; Prisma manages only `public`** — this keeps `prisma migrate dev` drift-free. Do not move them back to `public`.
- **Novel** ([src/novel/](server/src/novel/)) — novel/chapter CRUD + the write path:
  - `NovelController` (`/novels` CRUD, `/novels/:id/chapters[/:cid]`, `/novels/:id/accept`), `NovelService` (creates a Novel + its 1:1 chat `Session` + a seed chapter in one transaction), `ChapterService`.
  - **Mutation layer** ([src/resources/](server/src/resources/)) — the extension seam. `ResourceMutation { resource, targetId, op: 'set'|'append'|'patch', content }`, `ResourceRegistry` (dispatch; throws on duplicate registration), `ChapterHandler` (append/set chapter content → status `COMMITTED`, scoped by user). `HandlerRegistrar` registers the chapter handler at boot. **Adding a Phase 2 resource = new `ResourceHandler` + nav section + detail view + context slice; the chat and write layer don't change.**
- **Data model** (Prisma, [prisma/schema.prisma](server/prisma/schema.prisma)) — `User`, `Session` (chat thread), `Message` (chat history), `Novel` (1:1 `Session`, has `settings` JSON), `Chapter` (manuscript, `status: DRAFT|COMMITTED`). **Chat (`Message`) ≠ manuscript (`Chapter.content`).** 「采纳」 copies an AI chat message's content into a chapter.
- **`server/tsconfig.json`** uses `"types": ["node", "jest"]` — `node` must stay so `process.env` type-checks under `nest build`.

### Phase status
- **Phase 1 (v0.2.0, current):** novel library + workspace (chat propose → accept into chapter) + per-novel prompt + mutation layer + settings. Spec: [docs/superpowers/specs/2026-06-17-novel-workspace-design.md](docs/superpowers/specs/2026-06-17-novel-workspace-design.md). Plan: [docs/superpowers/plans/2026-06-17-novel-workspace.md](docs/superpowers/plans/2026-06-17-novel-workspace.md).
- **Phase 2 (next, designed-for not built):** outline / characters / worldview as new resources (plug into the mutation layer + nav + detail pane). Phase 3: status/foreshadowing (`StoryEvent` ledger, memory). Reference projects consulted: `~/project/inkos`, `~/project/webnovel-writer` (methodology borrowings documented in the spec).
