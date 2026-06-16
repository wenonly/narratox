# User Auth + Multi-tenancy — Design

**Date:** 2026-06-16
**Phase:** 2 (real user accounts; sessions/messages scoped per user)
**Status:** Approved (approach A: JWT Bearer + localStorage; dedicated client; open registration).

## 1. Goal & Scope

Add real user accounts to the system and make every `session`/`message` belong to a user:

1. **User login state** — register + login pages; a signed token proves identity.
2. **Login & register pages** in agent-ui.
3. **`session` and `message` linked to a `user` table** — every session belongs to exactly one user; users can only see/touch their own sessions (true multi-tenant isolation on top of the existing `session_id` isolation).

**In scope:** `User` model (Prisma) + bcrypt password hashing; JWT issuance/verification on the server; a global auth guard; per-user scoping of all session/message queries; agent-ui login/register pages + client-side auth guard; agent-ui becomes a dedicated client to our server (endpoint fixed, manual token input removed, `/agents`+`/teams` dropped).

**Out of scope (YAGNI, deferred):** email verification / password reset; role-based access control / admin panel; refresh tokens / token rotation; OAuth/social login; httpOnly-cookie hardening of the token (localStorage JWT accepted for now, flagged as future hardening); migrating existing dev sessions (treated as disposable — see §4).

## 2. Background — current auth model

There is **no auth** today. Both projects treat identity as a manually-typed bearer token:

- **server/** — every endpoint is open. `main.ts` calls bare `app.enableCors()`. Sessions/messages have no `userId`.
- **agent-ui/** — a *generic* "connect to any AgentOS" client. A bearer `authToken` is typed into the sidebar ([`AuthToken.tsx`](agent-ui/src/components/chat/Sidebar/AuthToken.tsx), seeded from `NEXT_PUBLIC_OS_SECURITY_KEY`), held in the Zustand store, and threaded into **every** API call through one chokepoint: `createHeaders(authToken)` → `Authorization: Bearer <token>` ([`api/os.ts:8`](agent-ui/src/api/os.ts#L8)). Four call sites read `authToken` from the store: `useChatActions.ts`, `useSessionLoader.tsx`, `useAIStreamHandler.tsx`, `SessionItem.tsx`. The run send path builds the same header at [`useAIStreamHandler.tsx:167`](agent-ui/src/hooks/useAIStreamHandler.tsx#L167). `authToken` is **not** persisted today (only `selectedEndpoint` is, via the store's `partialize`).

This existing Bearer plumbing is the key enabler: real auth slots straight into it with near-zero change — the manual token simply becomes a JWT issued by login.

## 3. Architecture — approach A (JWT Bearer + localStorage)

The **server (NestJS) is the auth authority**: it owns the `User` table, hashes passwords, signs/verifies JWTs, and guards all data endpoints. **agent-ui becomes a dedicated client** to our server: login obtains a JWT, which is persisted to `localStorage` (via the existing Zustand persist) and sent as the existing `Authorization: Bearer` header.

| Layer | Role |
|---|---|
| **`AuthModule`** (new, server) | `User` CRUD + register/login + JWT sign/verify + global guard. |
| **`JwtAuthGuard`** (new, server) | Verifies the Bearer token, attaches `req.user = { id, email }`, else `401`. |
| **`SessionsService`** (server, modified) | Every method takes `userId`; all queries scoped by it. |
| **`AgentosController`** (server, modified) | Reads `req.user.id`, passes to `SessionsService`; `/agents`+`/teams` removed. |
| **`(auth)` route group** (new, agent-ui) | `/login`, `/register` pages. |
| **Client auth guard** (new, agent-ui) | Redirects by `hydrated` + `authToken` presence; `401` anywhere → logout. |
| **Zustand store** (agent-ui, modified) | `authToken` now persisted; add `user` + `logout()`; endpoint fixed to our server. |

**Why JWT + localStorage over the alternatives:**
- *Opaque token + DB session table* — trivially revocable but adds a table + a DB hit per request for little gain; JWT is the NestJS-idiomatic stack (`@nestjs/jwt`).
- *httpOnly cookie* — best XSS resistance, but the token never reaches JS so Next.js middleware (edge/server) would be needed for route guards, and cross-origin cookies across `:3000`↔`:3001` need CORS-credentials/SameSite tuning; it also can't reuse the existing Bearer plumbing. Accepted as a **future hardening** item, not now.

## 4. Data model

New `User` model; `Session` gains a non-null `userId` FK. `Message` is unchanged (cascades from `Session`, transitively belongs to the user).

```prisma
model User {
  id           String   @id @default(cuid())
  email        String   @unique          // normalized to lowercase on register/login
  passwordHash String                    // bcryptjs hash; never plaintext
  username     String?                   // optional display name
  createdAt    DateTime @default(now())
  updatedAt    DateTime @default(now())
  sessions     Session[]
}

model Session {
  id        String   @id                          // == session_id == thread_id (uuid), unchanged
  userId    String                                // NEW: owning user
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  agentId   String   @default("deep-agent")
  name      String
  createdAt DateTime @default(now())
  updatedAt DateTime @default(now())              // bumped manually by appendTurn (unchanged)
  messages  Message[]

  @@index([userId, updatedAt])   // list-by-user + recency; keep @@index([agentId])
}

model Message {
  // unchanged: id, sessionId, role, content, createdAt, @@index([sessionId, createdAt])
}
```

`Session.id` stays externally-supplied (no default) and stays equal to the `thread_id`. The one identity chain — UI `session_id` ↔ our row ↔ checkpointer thread — is untouched; we only add an owner.

**Migration (known impact):** the existing `sessions`/`messages` rows are pre-production dev data with no owner. Adding a non-null `userId` FK to a non-empty table conflicts, so this migration is treated as a **fresh start** — existing dev sessions are discarded (run `pnpm prisma migrate reset` from `server/` or let the migration clear them). Documented and accepted.

## 5. Server: auth module, endpoints, guard, multi-tenancy

**New `server/src/auth/`**: `auth.module.ts`, `auth.controller.ts`, `auth.service.ts`, `jwt-auth.guard.ts`, `dto/`, plus a `@Public()` decorator (or reuse `APP_GUARD`-based global guard with a public-set).

**Deps:** `@nestjs/jwt`, `bcryptjs`; dev `@types/bcryptjs`. `JwtModule.register({ secret: process.env.JWT_SECRET, signOptions: { expiresIn: '7d' } })`.

**AuthService:**
- `register(email, password, username?)` — lowercase email; reject if taken (`409`); `bcrypt.hash` → `passwordHash`; create `User`; sign JWT; return `{ token, user }`.
- `login(email, password)` — find by lowercased email; `bcrypt.compare`; sign JWT; return `{ token, user }`.
- token payload `{ sub: userId, email }`.

**Endpoints:**

| Endpoint | Auth | Body / out |
|---|---|---|
| `GET /health` | public | `{}` (liveness) |
| `POST /auth/register` | public | `{ email, password, username? }` → `{ token, user:{id,email,username?} }` |
| `POST /auth/login` | public | `{ email, password }` → `{ token, user }` |
| `GET /auth/me` | guarded | `{ id, email, username? }` (from `req.user`) |
| `POST /agents/:id/runs` | guarded | streaming chat (unchanged wire format); `:id` is cosmetic single-agent |
| `GET /sessions` | guarded | `{ data: SessionEntry[] }` — scoped to `req.user.id` |
| `GET /sessions/:id/runs` | guarded | `[{ run_input, content, created_at }]` — scoped |
| `DELETE /sessions/:id` | guarded | `{ ok: true }` — scoped |
| ~~`GET /agents`~~, ~~`GET /teams`~~ | — | **removed** |

**Guard:** a global `JwtAuthGuard` (registered via `APP_GUARD`) with a `@Public()` set covering only `/health`, `/auth/register`, `/auth/login`. Everything else requires a valid Bearer token. Logic: read `Authorization: Bearer <token>` → `JwtService.verify` → on success set `req.user = { id, email }`; on missing/invalid → `401 Unauthorized`.

**Multi-tenancy (the core isolation rule):** `SessionsService` gains a `userId` parameter on **every** method, and every `Session` query is filtered by it. The controller extracts `userId` from `req.user.id` and passes it through.

- `resolveSession(userId, maybeId, agentId, name)`:
  - `maybeId` present → `findUnique({ where: { id: maybeId } })`; **reuse only if `existing.userId === userId`**.
  - id exists but belongs to another user → treat as not found (no leak): **create a new session for this user with a fresh uuid**.
  - no id → create new (fresh uuid), owned by `userId`.
- `listSessions(userId, agentId)` → `where: { userId, agentId }`, `orderBy updatedAt desc`.
- `getRuns(userId, sessionId)` / `appendTurn(userId, sessionId, …)` / `deleteSession(userId, sessionId)` → first confirm the session belongs to `userId` (not found / not owned → treat as absent / no-op); never read or mutate another user's session.

**Isolation guarantee:** every Session query carries `userId`; a user can never read or write another user's sessions. `thread_id` (= `session.id`) is a globally unique uuid, so cross-user collisions are impossible regardless.

## 6. agent-ui: routes, guard, store, plumbing reuse

**New route group `src/app/(auth)/`** (shadcn/ui, matches existing aesthetic):
- `login/page.tsx` — email + password form → `loginAPI` → `{ token, user }` into store → `router.replace('/')`.
- `register/page.tsx` — email + password (+ optional username) → `registerAPI` → same. Cross-links ("already have an account? login").

**Client-side auth guard:** the token lives in `localStorage`, which Next.js middleware (edge/server) cannot read, so the guard is client-side, using the store's existing `hydrated` flag:
- Dashboard (`/`): `hydrated && !authToken` → `router.replace('/login')`.
- `/login`, `/register`: `hydrated && authToken` → `router.replace('/')`.
- On `/` mount, if a token is present, call `GET /auth/me`; on `401` clear token + user and redirect to `/login` (handles expired tokens).

**Store changes ([`store.ts`](agent-ui/src/store.ts)):**
- `authToken` — **now persisted** (added to `partialize`, so refresh keeps you logged in).
- New `user: { id, email, username? } | null` + `setUser` + `logout()` (clears `authToken` + `user`).
- `selectedEndpoint` — kept but **fixed** to our server (`http://localhost:3001`); the sidebar endpoint input UI is removed.

**Remove manual token UI:** delete [`AuthToken.tsx`](agent-ui/src/components/chat/Sidebar/AuthToken.tsx); replace with a **current-username + logout** control in the sidebar. Drop the `NEXT_PUBLIC_OS_SECURITY_KEY` seeding in [`page.tsx`](agent-ui/src/app/page.tsx).

**Plumbing reuse (the big win):** `createHeaders(authToken)` and the four call sites are **near-zero change** — they already read `authToken` from the store; that value now comes from login instead of manual entry. Only three new helpers are added in `api/os.ts`: `loginAPI`, `registerAPI`, `meAPI` (hitting `/auth/*`).

**Knock-on simplification (from removing `/agents` + `/teams`):** `useChatActions.initialize()` stops calling `getAgentsAPI` / `getTeamsAPI`; the store's `agentId` is hardcoded to `deep-agent`; the agent/team picker UI is removed. The run URL's `{agent_id}` segment is filled with `deep-agent`. (The nuqs `?agent=` param can stay set to `deep-agent` for minimal churn in the session-load/list effects.)

## 7. Authed run/session data flow

```
POST /agents/:id/runs  Authorization: Bearer <jwt>   body={ message, session_id? }
  ├─ 0. JwtAuthGuard.verify(jwt) → req.user.id  (else 401 before any work)
  ├─ 1. resolveSession(userId, body.session_id, AGENT_ID, message)
  │      → reuse-if-owned / new(uuid); the resolved id is the thread_id
  ├─ 2..6. (unchanged) RunStarted → streamTurn({threadId, userMessage})
  │        → RunContent×N (cumulative) → RunCompleted → appendTurn
  └─ catch → RunError ; 401 mid-stream is handled client-side (logout + redirect)
```

`appendTurn`, `getRuns`, `listSessions`, `deleteSession` all now carry `userId`. The `RunStarted` frame still carries the resolved `session_id` (contract with the UI unchanged).

## 8. Infra & config

- **New server deps:** `@nestjs/jwt`, `bcryptjs`; dev `@types/bcryptjs`.
- **`server/.env`** (gitignored, never committed): add `JWT_SECRET=<long random>`. Keep `ZHIPUAI_API_KEY`, `PORT=3001`, `DATABASE_URL`.
- **`server/.env.example`**: add `JWT_SECRET=` placeholder (no real value).
- **agent-ui:** no new deps (uses `fetch` + the existing stack). The login/register forms reuse shadcn/ui `Input`/`Button`.
- **CORS:** `app.enableCors()` currently allows all origins with no credentials — sufficient for the Bearer-header model (no cookies). No change required for approach A.

## 9. Testing strategy (server, Jest, existing ESM config)

- **AuthService** (mock Prisma + `JwtService` + bcrypt): register (new → create + sign; email taken → `409`); login (found + match → sign; found + mismatch → `401`; not found → `401`); `verifyToken` decodes correctly.
- **AuthController** (mock AuthService): register/login return `{ token, user }`; `/auth/me` returns the user from `req.user`.
- **JwtAuthGuard**: no token / forged token → `401`; valid token → passes and sets `req.user` correctly.
- **SessionsService** (existing tests, all gain a `userId` param): `resolveSession` ownership (own → reuse; foreign id → new own; none → new); `listSessions` / `getRuns` / `appendTurn` / `deleteSession` all filter by `userId`; touching another user's session → treated as absent / no-op.
- **AgentosController** (mock the three services): reads `userId` from `req.user` and forwards to `SessionsService`.
- bcryptjs is pure JS — no test-environment friction.

agent-ui has no test runner; its quality gate remains `pnpm validate`, with behavior verified manually (login → chat persists; second turn agent remembers; session list/history scoped per user; logout clears state; expired token → redirect).

## 10. Error handling, security & known gaps

- Register: email taken → `409`; invalid email/password shape → `400` (class-validator DTO).
- Login: unknown user **or** wrong password → identical `401` (no user enumeration).
- Guarded route missing/expired/forged token → `401`.
- Missing `JWT_SECRET` at boot → AuthService construction throws (fail-fast, like the existing `DATABASE_URL` guard).
- **Client `401` handling:** any `401` (incl. `/auth/me` probe and mid-session expiry) → clear token + user → redirect `/login`. Form failures surface via sonner toast.
- **Known security tradeoff:** JWT in `localStorage` is readable by XSS. Accepted for this stage; httpOnly-cookie hardening is a documented future item.
- **Secrets discipline:** `JWT_SECRET` lives only in gitignored `server/.env`, never in tracked files or commits (same rule as `ZHIPUAI_API_KEY`).
- **Existing checkpointer orphan rows** on session delete remain (carried over from phase 1; harmless since uuids are never reused).
