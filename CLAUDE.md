# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Layout

`narratox` is a multi-project repo. The **root `package.json` only orchestrates** the sub-projects — it runs `frontend` and `server` in parallel via `npm-run-all2` (`run-p dev:*` / `run-p build:*`). It is **not a pnpm workspace** and shares no dependencies with the sub-projects, so each app still needs its own `pnpm install` inside its directory (and the root itself needs `pnpm install` once, for `npm-run-all2`).

- **`frontend/`** — Vue 3 + Vite + TypeScript SPA (Pinia, Vue Router). Currently the default scaffold; template views/components are still present.
- **`server/`** — NestJS + TypeScript API. Currently the scaffold plus a single `agent` resource.
- **`langchain-learn/`** — Reference material only: the `deep-agents-tutorial/` markdown set (LangChain / deep-agents). Not built, not imported by either app. Mine it for patterns when implementing agent/LangChain features on the server.

Package manager is **pnpm** in both app projects (lockfiles committed). Frontend `engines` requires Node `^20.19 || >=22.12`.

## Common Commands

### root (repo root — orchestration only)
```sh
pnpm install            # once: installs npm-run-all2 at the root
pnpm dev                # run-p dev:* → frontend + server dev servers in parallel
pnpm build              # run-p build:* → both builds in parallel
pnpm dev:frontend       # just the frontend dev server
pnpm dev:server         # just the server dev server
```

### server (`cd server`)
```sh
pnpm start:dev          # watch-mode dev server (PORT env, default 3000)
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

### frontend (`cd frontend`)
```sh
pnpm dev                # vite dev server
pnpm build              # vue-tsc type-check + vite build (run-p)
pnpm type-check         # vue-tsc --build, alone
pnpm test:unit          # vitest
pnpm test:e2e           # playwright (first run: npx playwright install)
pnpm lint               # oxlint + eslint, both run with --fix
pnpm format             # prettier on src/

# single test
pnpm test:unit src/components/__tests__/HelloWorld.spec.ts
pnpm test:unit -- -t "..."
```

## Architecture Notes

### Server (NestJS)
Standard Nest modular layout: each feature lives under `src/<feature>/` as a `*.module.ts` + `*.controller.ts` + `*.service.ts` plus `dto/` and `entities/`. Add new features by mirroring this structure, then register the module in the root `AppModule`.

**Current state (the server does not yet build/run):** `src/main.ts` calls `NestFactory.create(AppModule)` and imports it from `./app.module`, but `src/app.module.ts` is **missing** from the tree, and `AgentModule` is not registered anywhere. The first task to make the server runnable is to create `src/app.module.ts` with `@Module({ imports: [AgentModule] })`. Until then `pnpm build` / `pnpm start:dev` will fail on module resolution.

### Frontend (Vue 3)
Vite app with the `@` alias → `frontend/src` (set in `vite.config.ts` and `tsconfig.json`). Routing in `src/router/index.ts`; global state via Pinia in `src/stores/`. Unit tests use Vitest + `@vue/test-utils` (jsdom); E2E uses Playwright with specs under `frontend/e2e/` — note the template README refers to a `tests/` directory, but actual specs live in `e2e/`. Linting runs oxlint first, then ESLint (flat config in `eslint.config.ts`) on top.
