# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Layout

`narratox` is a multi-project repo. The **root `package.json` only orchestrates** the sub-projects — it runs them in parallel via `npm-run-all2` (`run-p dev:*` / `run-p build:*`). It is **not a pnpm workspace** and shares no dependencies, so each sub-project still needs its own `pnpm install` (and the root needs `pnpm install` once, for `npm-run-all2`).

- **`agent-ui/`** — A Next.js 15 (App Router) + React 18 + TypeScript chat UI. This is the **Agno "Agent UI" template** (`agno-agi/agent-ui`): a front-end that connects to an external **AgentOS** instance and chats with agents/teams.
- **`server/`** — A NestJS 11 + TypeScript API. Currently the scaffold with a single `agent` resource (CRUD stubs).
- **`langchain-learn/`** — Reference material only: the `deep-agents-tutorial/` markdown set (LangChain / deep-agents). Not built, not imported. Note this is a *different* agent ecosystem from the Agno-based `agent-ui`; consult it when implementing LangChain-style agents on the server.

Package manager is **pnpm** everywhere.

## ⚠️ The two app projects are not connected (and share a port)

This is the most important thing to know before assuming they form one system:

- **`agent-ui` talks to an external AgentOS, not to `server`.** Its default endpoint is `http://localhost:7777` (AgentOS), set in [agent-ui/src/store.ts](agent-ui/src/store.ts) as `selectedEndpoint`. All API calls go through [agent-ui/src/api/routes.ts](agent-ui/src/api/routes.ts) against that endpoint.
- **Ports:** `agent-ui` dev runs on `:3000` (`next dev -p 3000`). `server` defaults to `process.env.PORT ?? 3000`, but the root `dev:server` script pins `PORT=3001`, so `pnpm dev` at the root runs both without collision — agent-ui → `:3000`, server → `:3001`. Running `pnpm --dir server start:dev` directly still uses `:3000`.

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
pnpm start:dev          # nest start --watch (PORT env, default 3000)
pnpm build              # nest build -> dist/
pnpm start:prod         # node dist/main
pnpm test               # jest unit tests (src/**/*.spec.ts)
pnpm test:e2e           # jest e2e (test/jest-e2e.json)
pnpm test:cov           # coverage
pnpm lint               # eslint --fix
pnpm format             # prettier

# single test
pnpm test -- agent.service.spec.ts      # by file
pnpm test -- -t "should return ..."     # by test name
```

## Architecture

### agent-ui (Next.js / Agno Agent UI template)
App Router single-page chat app. Path alias `@/*` → `agent-ui/src/*` (in `tsconfig.json` and `next.config.ts`).

- **Connection model** — The UI connects to a user-supplied AgentOS endpoint (default `http://localhost:7777`) and authenticates with a bearer token. The endpoint and token are set either in the sidebar UI or via the `NEXT_PUBLIC_OS_SECURITY_KEY` env var (read in [src/app/page.tsx](agent-ui/src/app/page.tsx)). Token is sent as `Authorization: Bearer <token>` by [src/api/os.ts](agent-ui/src/api/os.ts).
- **API layer** — [src/api/routes.ts](agent-ui/src/api/routes.ts) maps each operation to an AgentOS URL (`/agents`, `/agents/{id}/runs`, `/sessions`, `/teams`, `/health`, …). [src/api/os.ts](agent-ui/src/api/os.ts) implements the fetch helpers. URLs are normalized by [src/lib/constructEndpointUrl.ts](agent-ui/src/lib/constructEndpointUrl.ts).
- **Streaming** — Agent runs stream newline/concatenated JSON. [src/hooks/useAIResponseStream.tsx](agent-ui/src/hooks/useAIResponseStream.tsx) contains a custom incremental JSON parser (`parseBuffer`) that handles **two wire formats**: a legacy direct-`RunResponseContent` shape and a newer `{ event, data }` shape (auto-converted to legacy). Event types are the `RunEvent` enum in [src/types/os.ts](agent-ui/src/types/os.ts).
- **State** — Global state is a single Zustand store in [src/store.ts](agent-ui/src/store.ts) (`useStore`), persisted to `localStorage` under key `endpoint-storage` (only `selectedEndpoint` is persisted). It holds endpoint, authToken, messages, agents/teams, mode (`'agent' | 'team'`), sessions, and streaming flags.
- **UI** — [src/components/chat/](agent-ui/src/components/chat/) splits into `Sidebar/` (endpoint/auth/agent/session pickers) and `ChatArea/` (messages + input, including `Multimedia/` for images/video/audio). Primitives are **shadcn/ui** (new-york style, see `components.json`) in `src/components/ui/`; styling via Tailwind + Framer Motion.

### server (NestJS)
Standard Nest modular layout: each feature lives under `src/<feature>/` as `*.module.ts` + `*.controller.ts` + `*.service.ts` plus `dto/` and `entities/`. The root [src/app.module.ts](server/src/app.module.ts) registers feature modules (currently just `AgentModule`). Add features by mirroring this layout and importing the new module into `AppModule`.

The `agent` resource is the Nest CLI scaffold: controller routes exist (`/agent` CRUD) but [agent.service.ts](server/src/agent/agent.service.ts) returns placeholder strings and the DTOs/entity are empty. Wire real logic there.

`server/tsconfig.json` uses `"types": ["node", "jest"]` — `node` must stay so `process.env` (in [src/main.ts](server/src/main.ts)) type-checks under `nest build`.
