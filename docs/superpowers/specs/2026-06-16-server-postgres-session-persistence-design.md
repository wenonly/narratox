# Server: PostgreSQL + Real Session Persistence — Design

**Date:** 2026-06-16
**Phase:** 1 (UI-accessible streaming agent proxy → now with durable, isolated, multi-session memory)
**Status:** Approved spine (dual storage; respect incoming `session_id`); remaining sections standard.

## 1. Goal & Scope

Add a PostgreSQL layer to `server/` so that:

1. The DeepAgent persists conversation state per session and **uses its built-in compression** (SummarizationMiddleware) instead of replaying a growing message array.
2. Sessions are **truly isolated** and **persisted** across requests/restarts, keyed by `session_id`.
3. The agent-ui can **list past sessions and resume one** with full transcript (the Sessions sidebar is already built; we feed it server endpoints).

**In scope:** Postgres-backed LangGraph checkpointer; Prisma-managed `sessions` + `messages` tables serving the UI read model; 4 endpoints (run / list / history / delete); local Postgres via docker-compose; session lifecycle rules.

**Out of scope (YAGNI, deferred):** user accounts/auth (sessions are `session_id`-isolated only); the cross-thread `store`/long-term memory; deleting the checkpointer's internal rows on session delete (see §10); multi-agent (single `deep-agent` only).

## 2. Background — what DeepAgent provides natively

`deepagents@1.10.2` `createDeepAgent` accepts (evidence: `server/node_modules/deepagents/dist/index.d.ts:3085-3088`):

- **`checkpointer: BaseCheckpointSaver | boolean`** — per-thread persistence. With it set, the agent reloads full history per `config.configurable.thread_id`; you pass **only the new user message** each turn.
- **`store: BaseStore`** — cross-thread long-term memory (NOT used this phase).
- **SummarizationMiddleware** — **auto-attached** by every `createDeepAgent`. Triggers at 85% of `max_input_tokens`, offloads old messages to the configured backend, replaces them with an LLM summary, keeps ~10% recent. For unknown models (GLM-5.2 is not in deepagents' registry) it falls back to **170,000 tokens / 6 messages** — compression still works out of the box. (Source: `dist/index.js:3431-3447`; tutorial `langchain-learn/deep-agents-tutorial/09-context-engineering.md:168-208`.)

Threading is via `config.configurable.thread_id` passed to `.stream()` / `.invoke()` (tutorial `05-going-to-production.md:56-58`, `13-human-in-the-loop.md:337-363`).

**Postgres support is NOT installed** — only in-memory `MemorySaver`/`InMemoryStore` ship transitively. We add `@langchain/langgraph-checkpoint-postgres` (`PostgresSaver`) + `pg`.

## 3. Architecture — dual storage

Two storage mechanisms coexist in **one** Postgres database, serving complementary purposes:

| Store | Owner | Purpose | Managed by |
|---|---|---|---|
| **LangGraph checkpoint tables** (`checkpoints`, `checkpoint_blobs`, `checkpoint_writes`) | agent's "brain" | conversation state + **compressed** memory | `PostgresSaver.setup()` (auto) |
| **`sessions` + `messages`** (Prisma) | UI read model | session list/names + **verbatim** transcript | Prisma migrate |

**Why dual, not single:** compression *replaces* old checkpoint messages with a summary, so reading the checkpoint would lose verbatim history the UI must show. Therefore the agent memory is compressed (saves tokens) while the UI transcript stays complete (full rendering). They never conflict: the agent reads only its checkpoint; it never reads our `messages` table. We append to `messages` purely for display.

`session.id` **is** the `thread_id` — one identity flows through UI ↔ our table ↔ checkpointer.

### Layers (each independently testable)

- **`AgentosController`** — HTTP + orchestration for 4 endpoints. No DB/LLM internals.
- **`SessionsService`** (new, Prisma) — pure DB ops: `resolveSession`, `listSessions`, `getRuns`, `appendTurn`, `deleteSession`.
- **`DeepAgentService`** — pure LLM. Takes an **injected** `checkpointer` (prod = `PostgresSaver`, tests = `MemorySaver`). Method renamed `streamDeltas(message)` → **`streamTurn({ threadId, userMessage })`**: passes only the new message + `thread_id`.
- **`StreamAdapter`** — unchanged (pure format translation).
- **`PrismaService`** (new) — `PrismaClient` lifecycle (`$connect` / `$disconnect`).
- **Checkpointer provider** (new) — builds `PostgresSaver` via dynamic import + `setup()`; provided through DI so the agent service stays DB-agnostic.

## 4. Data model

**Prisma schema** (`server/prisma/schema.prisma`), datasource `postgresql` env `DATABASE_URL`:

```prisma
model Session {
  id        String    @id // == session_id == thread_id (uuid)
  agentId   String    @default("deep-agent")
  name      String    // seeded from first user message (<=30 chars)
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  messages  Message[]

  @@index([agentId])
}

model Message {
  id        String   @id @default(cuid())
  sessionId String
  role      String   // 'user' | 'assistant'
  content   String   // verbatim text
  createdAt DateTime @default(now())
  session   Session  @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId, createdAt])
}
```

**Checkpointer tables** are created by `PostgresSaver.setup()` and are **not** declared in the Prisma schema (disjoint table sets; Prisma never touches them).

## 5. Endpoints & contracts

| Endpoint | Input | Output | Source |
|---|---|---|---|
| `POST /agents/:id/runs` | FormData: `message`, `session_id?` | streaming `RunStarted`→`RunContent×N`→`RunCompleted` (`\n`-separated JSON) | checkpointer |
| `GET /sessions?type=agent` | — | `{ data: SessionEntry[] }` | `sessions` |
| `GET /sessions/:sid/runs?type=agent` | — | `[{ run_input, content, created_at }]` (bare array) | `messages` paired |
| `DELETE /sessions/:sid` | — | `{ ok: true }` | `sessions`+`messages` |

Contracts match agent-ui:
- `SessionEntry = { session_id, session_name, created_at, updated_at? }` (`agent-ui/src/types/os.ts:267`).
- runs endpoint returns a **bare array**; each item's `run_input` (user) + `content` (assistant) become two chat messages (`agent-ui/src/hooks/useSessionLoader.tsx:84`).
- All `created_at` values are **unix seconds** (numbers) — convert Prisma `DateTime` via `Math.floor(date.getTime()/1000)`; consistent with `StreamAdapter.now()`.

## 6. Session lifecycle

`resolveSession(maybeId, agentId, firstNameHint)`:
- `maybeId` **empty/missing** → create a new `Session` with a fresh uuid; `name = truncate(firstNameHint, 30)`.
- `maybeId` **present and row exists** → reuse it.
- `maybeId` **present but missing** → create a row with that exact id (upsert semantics) so the UI's adopted id resolves.

**Critical fix vs. today:** the controller currently generates `randomUUID()` and ignores `body.session_id`. It must instead call `resolveSession(body.session_id, …)` and use the **resolved** id as `thread_id`. `RunStarted` carries the resolved `session_id` so the UI locks it into the URL (contract unchanged).

## 7. Run data flow

```
POST /agents/:id/runs  body={ message, session_id? }
  ├─ 1. resolveSession(body.session_id, AGENT_ID, message)  → { id, name }
  ├─ 2. res.setHeader('Content-Type','application/json')
  ├─ 3. RunStarted(agent_id, session_id=resolvedId)
  ├─ 4. streamTurn({ threadId: resolvedId, userMessage: message })
  │      → agent.stream({ messages:[{role:'user',content:message}] },
  │                       { configurable:{ thread_id: resolvedId }, streamMode:'messages' })
  │      ↑ checkpointer auto-loads history; SummarizationMiddleware auto-compresses
  ├─ 5. RunContent×N (cumulative full text — contract unchanged) → RunCompleted
  ├─ 6. after stream: appendTurn(resolvedId, message, fullReply)  → inserts 2 rows, bumps updatedAt
  └─ catch → RunError(frame) ; finally → res.end()
```

`appendTurn` writes the **verbatim** user + assistant messages to the `messages` table after a successful (completed) stream. On error, nothing is appended (the UI keeps the partial streamed text in-memory only).

## 8. Infra & config

- **New deps:** `@langchain/langgraph-checkpoint-postgres`, `pg`, `@prisma/client`; dev: `prisma`, `@types/pg`.
- **`docker-compose.yml`** (repo root): `postgres:16-alpine`, port `5432`, `POSTGRES_USER=narratox`, `POSTGRES_PASSWORD=narratox`, `POSTGRES_DB=narratox`, named volume.
- **`server/.env`** (gitignored, never committed): add `DATABASE_URL=postgresql://narratox:narratox@localhost:5432/narratox?schema=public`. Keep existing `ZHIPUAI_API_KEY`, `PORT=3001`.
- **`server/.env.example`**: add `DATABASE_URL=` placeholder (no real value).
- **Migration:** from `server/`, `pnpm prisma migrate dev --name init` (generates `server/prisma/migrations/`).
- **Checkpointer provider** builds the saver with a **dynamic** import (`await import('@langchain/langgraph-checkpoint-postgres')`) to keep Jest collection from statically loading the ESM chain — same pattern the agent service already uses.

## 9. Testing strategy

- **`StreamAdapter`** — unchanged existing tests (pure translation).
- **`DeepAgentService`** — inject `MemorySaver`; test `extractDelta` (existing) and that `streamTurn` calls `agent.stream` with `{ configurable: { thread_id }, streamMode: 'messages' }` (mock the agent). `buildAgent` test passes the injected checkpointer through. No Postgres in unit tests.
- **`SessionsService`** — unit tests with a **mocked `PrismaService`**: `resolveSession` (new / existing / missing-id), `listSessions`, `getRuns` (user+assistant pairing), `appendTurn` (bumps `updatedAt`, seeds name only when creating), `deleteSession`.
- **`AgentosController`** — tests with mocked `SessionsService` + `DeepAgentService` + `StreamAdapter` (do **not** import `AgentosModule`, to avoid loading the PostgresSaver provider): run emits correct frames and calls `appendTurn`; GET endpoints return the expected shapes; DELETE returns `{ ok: true }`.
- **`PrismaService` / checkpointer provider** — thin; covered by integration/manual boot verification, not unit tests.

## 10. Error handling & known gaps

- DB/build error during a run → `RunError` frame, `res.end()`.
- `GET /sessions/:sid/runs` for an unknown session → return `[]` (empty chat).
- **Known minor gap:** `DELETE /sessions/:sid` removes our `sessions`+`messages` rows but leaves the checkpointer's per-thread rows orphaned. Harmless (uuid is never reused) and avoids coupling to the saver's internal schema. Acceptable for phase 1.
- GLM-5.2 not being in deepagents' model registry → SummarizationMiddleware uses fallback defaults (170k tokens / 6 messages). Compression still active; no action required.
