# Server: PostgreSQL + Real Session Persistence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the `server/` DeepAgent a PostgreSQL-backed, per-`session_id` persistent memory that uses LangGraph's native checkpointer + automatic compression, plus UI-readable session list/history/delete endpoints.

**Architecture:** Dual storage in one Postgres DB — a `PostgresSaver` checkpointer (the agent's compressed brain, keyed by `thread_id`) and Prisma-managed `sessions` + `messages` tables (the verbatim UI transcript). `session.id` doubles as `thread_id`. The controller respects the incoming `session_id` (empty → new), passes only the new user message + `thread_id` to the agent each turn, and appends the verbatim turn to the `messages` table after a completed stream.

**Tech Stack:** NestJS 11, TypeScript (CJS, `tsconfig` `module: nodenext`), Prisma 6 + `@prisma/client`, PostgreSQL 16 (docker-compose), `@langchain/langgraph-checkpoint-postgres` (`PostgresSaver`), existing `deepagents@1.10.2` + `@langchain/openai` (GLM via OpenAI-compatible protocol).

**Spec:** `docs/superpowers/specs/2026-06-16-server-postgres-session-persistence-design.md`

**Branch:** `feat/server-postgres-sessions`

---

## File Structure

**Create:**
- `docker-compose.yml` (repo root) — local Postgres 16.
- `server/prisma/schema.prisma` — `Session` + `Message` models.
- `server/src/prisma/prisma.service.ts` — `PrismaClient` lifecycle wrapper (`@Global`).
- `server/src/prisma/prisma.module.ts` — global Prisma module.
- `server/src/agentos/checkpointer.provider.ts` — async factory building `PostgresSaver` via dynamic import + `setup()`, provided under the `'CHECKPOINTER'` string token.
- `server/src/agentos/sessions.service.ts` — Prisma ops: `resolveSession`, `listSessions`, `getRuns`, `appendTurn`, `deleteSession`.
- `server/src/agentos/sessions.service.spec.ts` — unit tests with mocked `PrismaService`.

**Modify:**
- `server/package.json` — add `@prisma/client`, `@langchain/langgraph-checkpoint-postgres`, `pg`; dev: `prisma`, `@types/pg`.
- `server/.env` (gitignored, NOT committed) — add `DATABASE_URL`.
- `server/.env.example` — add `DATABASE_URL` placeholder.
- `server/src/agentos/deep-agent.service.ts` — inject optional `CHECKPOINTER`, pass to `createDeepAgent`, rename `streamDeltas` → `streamTurn({threadId, userMessage})`.
- `server/src/agentos/deep-agent.service.spec.ts` — update for `streamTurn` + checkpointer.
- `server/src/agentos/agentos.controller.ts` — inject `SessionsService`; rewrite `runAgent`; add `GET /sessions`, `GET /sessions/:id/runs`, `DELETE /sessions/:id`.
- `server/src/agentos/agentos.controller.spec.ts` — update for new deps + new endpoints.
- `server/src/agentos/agentos.module.ts` — provide `SessionsService` + `checkpointerProvider`.
- `server/src/app.module.ts` — import `PrismaModule`.

**Unchanged:** `server/src/agentos/stream-adapter.ts` (and its spec), `server/src/agentos/agentos.constants.ts`.

---

## Task 1: Postgres + Prisma foundation

**Files:**
- Create: `docker-compose.yml`
- Create: `server/prisma/schema.prisma`
- Create: `server/src/prisma/prisma.service.ts`
- Create: `server/src/prisma/prisma.module.ts`
- Modify: `server/package.json` (deps)
- Modify: `server/.env`, `server/.env.example`
- Modify: `server/src/app.module.ts`

- [ ] **Step 1: Start a local Postgres via docker-compose**

Create `docker-compose.yml` at the **repo root** (`/Users/taowen/project/narratox/docker-compose.yml`):

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: narratox-postgres
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: narratox
      POSTGRES_PASSWORD: narratox
      POSTGRES_DB: narratox
    volumes:
      - narratox-pgdata:/var/lib/postgresql/data
volumes:
  narratox-pgdata:
```

Run: `docker compose up -d`
Expected: container `narratox-postgres` running, port 5432 listening. Verify with `docker compose ps`.

- [ ] **Step 2: Install dependencies**

From `server/`:

```bash
cd /Users/taowen/project/narratox/server
pnpm add @prisma/client @langchain/langgraph-checkpoint-postgres pg
pnpm add -D prisma @types/pg
```

Expected: packages added to `server/package.json` dependencies/devDependencies.

- [ ] **Step 3: Create the Prisma schema**

Create `server/prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Session {
  id        String    @id
  agentId   String    @default("deep-agent")
  name      String
  createdAt DateTime  @default(now())
  updatedAt DateTime  @default(now())
  messages  Message[]

  @@index([agentId])
}

model Message {
  id        String   @id @default(cuid())
  sessionId String
  role      String
  content   String
  createdAt DateTime @default(now())
  session   Session  @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId, createdAt])
}
```

- [ ] **Step 4: Wire `DATABASE_URL` into env files**

Edit `server/.env` (gitignored — must already exist; it holds `ZHIPUAI_API_KEY`). Append:

```
DATABASE_URL=postgresql://narratox:narratox@localhost:5432/narratox?schema=public
```

Edit `server/.env.example` (committed). Append (placeholder only, never a real value):

```
DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/DBNAME?schema=public
```

- [ ] **Step 5: Run the initial migration**

From `server/`:

```bash
pnpm prisma migrate dev --name init
```

Expected: creates `server/prisma/migrations/<timestamp>_init/migration.sql` and generates the Prisma Client. Verify the SQL contains `CREATE TABLE "Session"` and `CREATE TABLE "Message"`.

- [ ] **Step 6: Create `PrismaService`**

Create `server/src/prisma/prisma.service.ts`:

```ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```

- [ ] **Step 7: Create the global `PrismaModule`**

Create `server/src/prisma/prisma.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

- [ ] **Step 8: Register `PrismaModule` in `AppModule`**

Modify `server/src/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AgentModule } from './agent/agent.module';
import { AgentosModule } from './agentos/agentos.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [PrismaModule, AgentModule, AgentosModule],
})
export class AppModule {}
```

- [ ] **Step 9: Verify it boots and connects**

From `server/`:

```bash
pnpm build
pnpm start:dev
```

Expected: Nest application boots, `PrismaService.onModuleInit` logs no connection error. (If `start:dev` tries port 3001 and it's free, it starts cleanly.) Kill it once boot is confirmed (`Ctrl+C`).

- [ ] **Step 10: Commit**

```bash
cd /Users/taowen/project/narratox
git add docker-compose.yml server/package.json server/pnpm-lock.yaml server/prisma server/src/prisma server/src/app.module.ts server/.env.example
git commit -m "feat(server): add Postgres + Prisma foundation (docker-compose, schema, PrismaService)"
```

> **Do not commit `server/.env`.** Verify with `git status` — `.env` must NOT appear staged.

---

## Task 2: Checkpointer provider (PostgresSaver)

**Files:**
- Create: `server/src/agentos/checkpointer.provider.ts`

- [ ] **Step 1: Create the provider**

Create `server/src/agentos/checkpointer.provider.ts`:

```ts
import type { Provider } from '@nestjs/common';

/**
 * DI token for the LangGraph checkpointer injected into DeepAgentService.
 * String token (not the abstract BaseCheckpointSaver class) so the agent
 * service can keep a type-only import of BaseCheckpointSaver and stay free
 * of any static import of the checkpoint package (keeps Jest collection clean).
 */
export const CHECKPOINTER = 'CHECKPOINTER';

/**
 * 构建一个 Postgres-backed checkpointer：
 * - 动态 import @langchain/langgraph-checkpoint-postgres，避免静态加载仅-ESM 的
 *   传递依赖导致 Jest 在收集阶段崩溃（本文件仅运行时加载，单测不 import 它）。
 * - setup() 建 checkpoints / checkpoint_blobs / checkpoint_writes 三张表。
 * 该 provider 仅在真实运行时实例化；DeepAgentService 在测试里用 @Optional() 注入，
 * 缺省走 checkpointer=false（无持久化）。
 */
export const checkpointerProvider: Provider = {
  provide: CHECKPOINTER,
  useFactory: async () => {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        'DATABASE_URL is not set. Add it to server/.env (see server/.env.example).',
      );
    }
    const { PostgresSaver } = await import(
      '@langchain/langgraph-checkpoint-postgres'
    );
    // fromConnString 在已发布版本里是同步的（返回实例）。若安装到的版本将其改为 async，
    // Task 7 启动会报 saver.setup is not a function —— 届时改成 await 即可：
    const saver = PostgresSaver.fromConnString(url);
    await saver.setup();
    return saver;
  },
};
```

- [ ] **Step 2: Verify type-checks**

From `server/`:

```bash
pnpm build
```

Expected: builds cleanly (no errors). No unit test here — this provider is covered by the end-to-end boot in Task 7.

- [ ] **Step 3: Commit**

```bash
cd /Users/taowen/project/narratox
git add server/src/agentos/checkpointer.provider.ts
git commit -m "feat(server): add PostgresSaver checkpointer provider"
```

---

## Task 3: DeepAgentService — inject checkpointer + `streamTurn`

**Files:**
- Modify: `server/src/agentos/deep-agent.service.ts`
- Test: `server/src/agentos/deep-agent.service.spec.ts`

- [ ] **Step 1: Update the failing tests**

Replace the **entire contents** of `server/src/agentos/deep-agent.service.spec.ts` with:

```ts
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import { DeepAgentService } from './deep-agent.service';

describe('DeepAgentService', () => {
  describe('extractDelta', () => {
    const service = new DeepAgentService();
    const extract = (c: unknown) =>
      (service as unknown as { extractDelta: (c: unknown) => string }).extractDelta(c);

    it('reads .text from a [message, meta] tuple (messages streamMode shape)', () => {
      expect(extract([{ text: 'hi' }, {}])).toBe('hi');
    });

    it('reads string .content when .text is absent', () => {
      expect(extract({ content: 'yo' })).toBe('yo');
    });

    it('returns empty string for unrelated / empty chunks', () => {
      expect(extract([{ foo: 1 }, {}])).toBe('');
      expect(extract(undefined)).toBe('');
      expect(extract(null)).toBe('');
    });

    it('ignores the metadata element of the tuple (only chunk[0] is read)', () => {
      expect(extract([{ text: 'hi' }, { text: 'SHOULD-NOT-LEAK' }])).toBe('hi');
    });
  });

  describe('streamTurn', () => {
    it('calls agent.stream with the new user message + thread_id, yields non-empty deltas in order', async () => {
      const service = new DeepAgentService();
      const fakeStream = (async function* () {
        yield [{ text: 'He' }, {}];
        yield [{ foo: 'skip' }, {}]; // extractDelta -> ''
        yield [{ text: 'llo' }, {}];
      })();
      const stream = jest.fn(async () => fakeStream);
      (service as unknown as { agent: unknown }).agent = { stream };

      const out: string[] = [];
      for await (const d of service.streamTurn({ threadId: 'sess-1', userMessage: 'hi' })) {
        out.push(d);
      }

      // Only the NEW user message is passed; thread scopes the conversation.
      expect(stream).toHaveBeenCalledTimes(1);
      const [input, options] = stream.mock.calls[0];
      expect(input).toEqual({ messages: [{ role: 'user', content: 'hi' }] });
      expect(options).toMatchObject({
        configurable: { thread_id: 'sess-1' },
        streamMode: 'messages',
      });
      expect(out).toEqual(['He', 'llo']);
    });
  });

  describe('buildAgent', () => {
    it('throws a clear error when ZHIPUAI_API_KEY is missing', async () => {
      const old = process.env.ZHIPUAI_API_KEY;
      delete process.env.ZHIPUAI_API_KEY;
      const service = new DeepAgentService();
      await expect(
        (service as unknown as { buildAgent: () => Promise<unknown> }).buildAgent(),
      ).rejects.toThrow(/ZHIPUAI_API_KEY/);
      if (old) process.env.ZHIPUAI_API_KEY = old;
    });

    it('passes the injected checkpointer through to createDeepAgent', async () => {
      const oldKey = process.env.ZHIPUAI_API_KEY;
      process.env.ZHIPUAI_API_KEY = 'fake-key';
      const captured: { checkpointer?: unknown } = {};
      jest.resetModules();
      jest.doMock('@langchain/openai', () => ({
        ChatOpenAI: class {
          constructor() {}
        },
      }));
      jest.doMock('deepagents', () => ({
        createDeepAgent: (params: { checkpointer?: unknown }) => {
          captured.checkpointer = params.checkpointer;
          return { stream: () => async function* () {} };
        },
      }));
      try {
        const { DeepAgentService: FreshService } = await import('./deep-agent.service');
        const fakeSaver = { _isSaver: true } as unknown as BaseCheckpointSaver;
        const service = new FreshService(fakeSaver);
        await (service as unknown as { buildAgent: () => Promise<unknown> }).buildAgent();
        expect(captured.checkpointer).toBe(fakeSaver);
      } finally {
        jest.dontMock('@langchain/openai');
        jest.dontMock('deepagents');
        jest.resetModules();
        if (oldKey) process.env.ZHIPUAI_API_KEY = oldKey;
        else delete process.env.ZHIPUAI_API_KEY;
      }
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

From `server/`:

```bash
pnpm test -- deep-agent.service.spec.ts
```

Expected: FAIL — `streamTurn` does not exist; `DeepAgentService` does not accept a checkpointer constructor arg.

- [ ] **Step 3: Rewrite the service**

Replace the **entire contents** of `server/src/agentos/deep-agent.service.ts` with:

```ts
import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import { CHECKPOINTER } from './checkpointer.provider';
import {
  GLM_BASE_URL,
  GLM_MODEL,
  SYSTEM_PROMPT,
} from './agentos.constants';

/**
 * DeepAgent 暴露的最小接口——只用到 stream()。
 * 用本地接口而非 ReturnType<typeof createDeepAgent> 是为了：
 * 1) 避免在模块顶层静态 import deepagents/@langchain/openai（含仅-ESM 的传递依赖，
 *    会让 Jest 在收集阶段崩溃；动态 import 把加载推迟到真正构建 agent 时）。
 * 2) 让 extractDelta/streamTurn 的单测无需真实加载整条依赖链。
 *
 * streamTurn 只传「新用户消息 + thread_id」：对话历史由 checkpointer 按 thread_id
 * 自动加载，SummarizationMiddleware 自动压缩旧消息（deepagents 对每个 agent 自动挂载）。
 */
interface StreamableAgent {
  stream(
    input: { messages: Array<{ role: string; content: string }> },
    options: {
      configurable: Record<string, unknown>;
      streamMode: 'messages';
    },
  ): Promise<AsyncIterable<unknown>>;
}

@Injectable()
export class DeepAgentService implements OnModuleInit {
  private agent!: StreamableAgent;

  constructor(
    // @Optional：单测里 new DeepAgentService() 不传也能用（走 checkpointer=false）。
    // 生产环境由 checkpointerProvider 注入 PostgresSaver。
    @Optional() @Inject(CHECKPOINTER) private readonly checkpointer?: BaseCheckpointSaver,
  ) {}

  async onModuleInit(): Promise<void> {
    this.agent = await this.buildAgent();
  }

  // protected 以便单测可访问；构建真实 DeepAgent（读 env + 动态加载 deepagents）
  protected async buildAgent(): Promise<StreamableAgent> {
    const apiKey = process.env.ZHIPUAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'ZHIPUAI_API_KEY is not set. Add it to server/.env (see server/.env.example).',
      );
    }
    // 动态 import：避免静态加载仅-ESM 传递依赖导致 Jest 崩溃。
    const { ChatOpenAI } = await import('@langchain/openai');
    const { createDeepAgent } = await import('deepagents');
    // @langchain/openai v1：baseURL 须放进 configuration；模型字段名是 model。
    const model = new ChatOpenAI({
      apiKey,
      model: GLM_MODEL,
      configuration: { baseURL: GLM_BASE_URL },
    });
    return createDeepAgent({
      model,
      systemPrompt: SYSTEM_PROMPT,
      checkpointer: this.checkpointer ?? false,
    });
  }

  /**
   * 从 deepagents 的 messages 模式流式分块里抽出文本增量。
   * streamMode:'messages'（无 subgraphs）下，每块形如 [message, metadata]，
   * message.text 是增量 delta。兼容裸对象 / 缺失字段。
   *
   * 范围说明（phase 1）：本 agent 是纯对话、无工具/无子 agent，content 一律为字符串。
   * 因此数组形态的 content（工具调用 / 多段消息）会被有意跳过（返回 ''）。
   */
  protected extractDelta(chunk: unknown): string {
    const msg = (Array.isArray(chunk) ? chunk[0] : chunk) as
      | { text?: string; content?: unknown }
      | undefined;
    if (typeof msg?.text === 'string') return msg.text;
    if (typeof msg?.content === 'string') return msg.content;
    return '';
  }

  /**
   * 在指定 thread（=session）上推进一轮：只传新的用户消息，历史与压缩由
   * checkpointer + SummarizationMiddleware 自动处理。逐块产出文本增量（仅非空）。
   */
  async *streamTurn({
    threadId,
    userMessage,
  }: {
    threadId: string;
    userMessage: string;
  }): AsyncGenerator<string> {
    const stream = await this.agent.stream(
      { messages: [{ role: 'user', content: userMessage }] },
      { configurable: { thread_id: threadId }, streamMode: 'messages' },
    );
    for await (const chunk of stream) {
      const delta = this.extractDelta(chunk);
      if (delta) yield delta;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test -- deep-agent.service.spec.ts
```

Expected: PASS (4 tests across the three describe blocks).

- [ ] **Step 5: Commit**

```bash
cd /Users/taowen/project/narratox
git add server/src/agentos/deep-agent.service.ts server/src/agentos/deep-agent.service.spec.ts
git commit -m "feat(server): inject checkpointer into DeepAgentService; streamTurn by thread_id"
```

---

## Task 4: SessionsService (Prisma-backed UI read model)

**Files:**
- Create: `server/src/agentos/sessions.service.ts`
- Test: `server/src/agentos/sessions.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `server/src/agentos/sessions.service.spec.ts`:

```ts
import { SessionsService } from './sessions.service';
import type { PrismaService } from '../prisma/prisma.service';

function makePrismaMock() {
  return {
    session: {
      findUnique: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    message: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
  } as unknown as PrismaService;
}

const EPOCH = new Date('2026-01-01T00:00:00.000Z');

describe('SessionsService', () => {
  describe('resolveSession', () => {
    it('creates a new session (uuid + truncated name) when no id given', async () => {
      const prisma = makePrismaMock();
      (prisma.session.create as jest.Mock).mockResolvedValue({
        id: 'new-id',
        agentId: 'deep-agent',
        name: 'short',
        createdAt: EPOCH,
        updatedAt: EPOCH,
      });
      const service = new SessionsService(prisma);

      const result = await service.resolveSession(undefined, 'deep-agent', 'short');

      expect(prisma.session.findUnique).not.toHaveBeenCalled();
      expect(prisma.session.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ agentId: 'deep-agent', name: 'short' }),
      });
      expect(result.id).toBe('new-id');
    });

    it('seeds name from the first message, truncated to 30 chars', async () => {
      const prisma = makePrismaMock();
      (prisma.session.create as jest.Mock).mockResolvedValue({ name: '' });
      const service = new SessionsService(prisma);
      const long = 'x'.repeat(40);

      await service.resolveSession(undefined, 'deep-agent', long);

      const data = (prisma.session.create as jest.Mock).mock.calls[0][0].data;
      expect(data.name).toBe('x'.repeat(30));
      expect(data.name).toHaveLength(30);
    });

    it('reuses an existing session when id is given and found', async () => {
      const prisma = makePrismaMock();
      const existing = { id: 's1', name: 'old', createdAt: EPOCH, updatedAt: EPOCH };
      (prisma.session.findUnique as jest.Mock).mockResolvedValue(existing);
      const service = new SessionsService(prisma);

      const result = await service.resolveSession('s1', 'deep-agent', 'hi');

      expect(prisma.session.findUnique).toHaveBeenCalledWith({ where: { id: 's1' } });
      expect(prisma.session.create).not.toHaveBeenCalled();
      expect(result).toBe(existing);
    });

    it('creates with the given id when id is given but missing (upsert)', async () => {
      const prisma = makePrismaMock();
      (prisma.session.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.session.create as jest.Mock).mockResolvedValue({ id: 's2' });
      const service = new SessionsService(prisma);

      await service.resolveSession('s2', 'deep-agent', 'hi');

      expect(prisma.session.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ id: 's2', name: 'hi' }),
      });
    });
  });

  describe('listSessions', () => {
    it('returns sessions newest-first, mapped to the UI shape', async () => {
      const prisma = makePrismaMock();
      (prisma.session.findMany as jest.Mock).mockResolvedValue([
        { id: 's1', name: 'First', createdAt: EPOCH, updatedAt: EPOCH },
      ]);
      const service = new SessionsService(prisma);

      const result = await service.listSessions('deep-agent');

      expect(prisma.session.findMany).toHaveBeenCalledWith({
        where: { agentId: 'deep-agent' },
        orderBy: { updatedAt: 'desc' },
      });
      expect(result).toEqual([
        { id: 's1', name: 'First', createdAt: EPOCH, updatedAt: EPOCH },
      ]);
    });
  });

  describe('getRuns', () => {
    it('pairs consecutive user+assistant messages into runs, oldest-first', async () => {
      const prisma = makePrismaMock();
      (prisma.message.findMany as jest.Mock).mockResolvedValue([
        { role: 'user', content: 'q1', createdAt: EPOCH },
        { role: 'assistant', content: 'a1', createdAt: EPOCH },
        { role: 'user', content: 'q2', createdAt: EPOCH },
        { role: 'assistant', content: 'a2', createdAt: EPOCH },
      ]);
      const service = new SessionsService(prisma);

      const result = await service.getRuns('s1');

      expect(prisma.message.findMany).toHaveBeenCalledWith({
        where: { sessionId: 's1' },
        orderBy: { createdAt: 'asc' },
      });
      expect(result).toEqual([
        { userContent: 'q1', assistantContent: 'a1', createdAt: EPOCH },
        { userContent: 'q2', assistantContent: 'a2', createdAt: EPOCH },
      ]);
    });
  });

  describe('appendTurn', () => {
    it('writes the user+assistant messages and bumps updatedAt', async () => {
      const prisma = makePrismaMock();
      const service = new SessionsService(prisma);

      await service.appendTurn('s1', 'hi', 'hello');

      expect(prisma.message.create).toHaveBeenCalledTimes(2);
      expect(prisma.message.create).toHaveBeenNthCalledWith(1, {
        data: { sessionId: 's1', role: 'user', content: 'hi' },
      });
      expect(prisma.message.create).toHaveBeenNthCalledWith(2, {
        data: { sessionId: 's1', role: 'assistant', content: 'hello' },
      });
      expect(prisma.session.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { updatedAt: expect.any(Date) },
      });
    });
  });

  describe('deleteSession', () => {
    it('deletes the session row (messages cascade)', async () => {
      const prisma = makePrismaMock();
      const service = new SessionsService(prisma);

      await service.deleteSession('s1');

      expect(prisma.session.delete).toHaveBeenCalledWith({ where: { id: 's1' } });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- sessions.service.spec.ts
```

Expected: FAIL — `SessionsService` is not defined.

- [ ] **Step 3: Implement the service**

Create `server/src/agentos/sessions.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Session } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const MAX_NAME = 30;

function seedName(hint: string): string {
  const trimmed = hint.trim();
  if (!trimmed) return 'New chat';
  return trimmed.length > MAX_NAME ? trimmed.slice(0, MAX_NAME) : trimmed;
}

/** 一轮对话（配对后的 user+assistant），用于 GET /sessions/:id/runs。 */
export interface RunPair {
  userContent: string;
  assistantContent: string;
  createdAt: Date;
}

/**
 * 纯 Prisma 的 UI 只读模型：sessions 列表/命名 + 逐字 transcript。
 * agent 记忆由 checkpointer 管理，不读本服务写入的 messages。
 */
@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 解析会话：无 id→新建(uuid)；有 id 且存在→复用；有 id 但缺失→按该 id 建(upsert)。
   * 新建时用首条用户消息截断 30 字作为 name。
   */
  async resolveSession(
    maybeId: string | undefined,
    agentId: string,
    firstNameHint: string,
  ): Promise<Session> {
    if (maybeId) {
      const existing = await this.prisma.session.findUnique({
        where: { id: maybeId },
      });
      if (existing) return existing;
      return this.prisma.session.create({
        data: { id: maybeId, agentId, name: seedName(firstNameHint) },
      });
    }
    return this.prisma.session.create({
      data: { id: randomUUID(), agentId, name: seedName(firstNameHint) },
    });
  }

  /** 列出某 agent 的所有会话，按 updated_at 倒序。 */
  async listSessions(agentId: string): Promise<Session[]> {
    return this.prisma.session.findMany({
      where: { agentId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /** 把逐字消息配对成 runs（user 在前、紧跟其 assistant），oldest-first。 */
  async getRuns(sessionId: string): Promise<RunPair[]> {
    const messages = await this.prisma.message.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    });
    const runs: RunPair[] = [];
    for (let i = 0; i < messages.length - 1; i++) {
      if (messages[i].role === 'user' && messages[i + 1].role === 'assistant') {
        runs.push({
          userContent: messages[i].content,
          assistantContent: messages[i + 1].content,
          createdAt: messages[i].createdAt,
        });
        i++; // consume the assistant message too
      }
    }
    return runs;
  }

  /** 流结束后落库一轮的逐字 user+assistant，并刷新 updatedAt。 */
  async appendTurn(
    sessionId: string,
    userContent: string,
    assistantContent: string,
  ): Promise<void> {
    await this.prisma.message.create({
      data: { sessionId, role: 'user', content: userContent },
    });
    await this.prisma.message.create({
      data: { sessionId, role: 'assistant', content: assistantContent },
    });
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() },
    });
  }

  /** 删除会话行（messages 随 onDelete:Cascade 一并删除）。 */
  async deleteSession(sessionId: string): Promise<void> {
    await this.prisma.session.delete({ where: { id: sessionId } });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test -- sessions.service.spec.ts
```

Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/taowen/project/narratox
git add server/src/agentos/sessions.service.ts server/src/agentos/sessions.service.spec.ts
git commit -m "feat(server): add SessionsService (Prisma-backed UI read model)"
```

---

## Task 5: Controller — real session isolation + read/delete endpoints

**Files:**
- Modify: `server/src/agentos/agentos.controller.ts`
- Test: `server/src/agentos/agentos.controller.spec.ts`

- [ ] **Step 1: Replace the controller tests**

Replace the **entire contents** of `server/src/agentos/agentos.controller.spec.ts` with:

```ts
import type { Response } from 'express';
import { AgentosController } from './agentos.controller';
import type { DeepAgentService } from './deep-agent.service';
import type { SessionsService } from './sessions.service';
import { StreamAdapter, type AgentosFrame } from './stream-adapter';

const EPOCH = new Date('2026-01-01T00:00:00.000Z');

function createFakeRes(): { res: Response; chunks: string[] } {
  const chunks: string[] = [];
  const res = {
    setHeader: () => {},
    write: (s: string) => {
      chunks.push(s);
      return true;
    },
    end: () => {},
  } as unknown as Response;
  return { res, chunks };
}

function makeSessionsMock(
  overrides: Partial<{
    resolveSession: jest.Mock;
    appendTurn: jest.Mock;
    listSessions: jest.Mock;
    getRuns: jest.Mock;
    deleteSession: jest.Mock;
  }> = {},
) {
  return {
    resolveSession:
      overrides.resolveSession ??
      jest.fn(async () => ({ id: 'sess-1', name: 'n', createdAt: EPOCH, updatedAt: EPOCH })),
    appendTurn: overrides.appendTurn ?? jest.fn(async () => undefined),
    listSessions: overrides.listSessions ?? jest.fn(async () => []),
    getRuns: overrides.getRuns ?? jest.fn(async () => []),
    deleteSession: overrides.deleteSession ?? jest.fn(async () => undefined),
  } as unknown as SessionsService;
}

function buildController(
  deltas: (m: string) => AsyncIterable<string>,
  sessions: SessionsService = makeSessionsMock(),
): AgentosController {
  const fakeService = {
    streamTurn: ({ userMessage }: { threadId: string; userMessage: string }) =>
      deltas(userMessage),
  } as unknown as DeepAgentService;
  return new AgentosController(fakeService, new StreamAdapter(), sessions);
}

function parseFrames(chunks: string[]): AgentosFrame[] {
  return chunks
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => JSON.parse(c)) as AgentosFrame[];
}

describe('AgentosController', () => {
  it('GET /health returns empty object', () => {
    const controller = buildController(async function* () {});
    expect(controller.health()).toEqual({});
  });

  it('GET /agents returns one agent with id/name/db_id', () => {
    const controller = buildController(async function* () {});
    const agents = controller.agents();
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({ id: 'deep-agent', name: 'Deep Agent', db_id: 'default' });
  });

  it('POST runs respects incoming session_id, streams frames, persists the turn', async () => {
    const sessions = makeSessionsMock();
    const controller = buildController(async function* () {
      yield 'He';
      yield 'llo';
    }, sessions);
    const { res, chunks } = createFakeRes();

    await controller.runAgent('deep-agent', { message: 'hi', session_id: 'sess-1' }, res);

    expect(sessions.resolveSession).toHaveBeenCalledWith('sess-1', 'deep-agent', 'hi');
    const frames = parseFrames(chunks);
    expect(frames[0].event).toBe('RunStarted');
    expect(frames[0].session_id).toBe('sess-1'); // resolved id flows back to the UI
    expect(frames.map((f) => f.event)).toEqual([
      'RunStarted',
      'RunContent',
      'RunContent',
      'RunCompleted',
    ]);
    expect(frames[frames.length - 1].content).toBe('Hello');
    expect(sessions.appendTurn).toHaveBeenCalledWith('sess-1', 'hi', 'Hello');
  });

  it('POST runs creates a session when session_id is absent', async () => {
    const sessions = makeSessionsMock({
      resolveSession: jest.fn(async () => ({ id: 'fresh', name: 'hi', createdAt: EPOCH, updatedAt: EPOCH })),
    });
    const controller = buildController(async function* () {
      yield 'ok';
    }, sessions);
    const { res, chunks } = createFakeRes();

    await controller.runAgent('deep-agent', { message: 'hi' }, res);

    expect(sessions.resolveSession).toHaveBeenCalledWith(undefined, 'deep-agent', 'hi');
    expect(parseFrames(chunks)[0].session_id).toBe('fresh');
  });

  it('POST runs emits RunError and does NOT persist when the service throws', async () => {
    const sessions = makeSessionsMock();
    const controller = buildController(async function* () {
      throw new Error('boom');
    }, sessions);
    const { res, chunks } = createFakeRes();

    await controller.runAgent('deep-agent', { message: 'hi', session_id: 'sess-1' }, res);

    const last = parseFrames(chunks).at(-1);
    expect(last?.event).toBe('RunError');
    expect(last?.content).toBe('boom');
    expect(sessions.appendTurn).not.toHaveBeenCalled();
  });

  it('GET /sessions maps rows to the UI SessionEntry shape (unix seconds)', async () => {
    const sessions = makeSessionsMock({
      listSessions: jest.fn(async () => [
        { id: 's1', name: 'First', createdAt: EPOCH, updatedAt: EPOCH },
      ]),
    });
    const controller = buildController(async function* () {}, sessions);

    const result = await controller.listSessions();

    expect(sessions.listSessions).toHaveBeenCalledWith('deep-agent');
    expect(result).toEqual({
      data: [{ session_id: 's1', session_name: 'First', created_at: 1767225600, updated_at: 1767225600 }],
    });
  });

  it('GET /sessions/:id/runs maps run pairs to {run_input, content, created_at}', async () => {
    const sessions = makeSessionsMock({
      getRuns: jest.fn(async () => [
        { userContent: 'hi', assistantContent: 'hello', createdAt: EPOCH },
      ]),
    });
    const controller = buildController(async function* () {}, sessions);

    const result = await controller.getSessionRuns('s1');

    expect(sessions.getRuns).toHaveBeenCalledWith('s1');
    expect(result).toEqual([{ run_input: 'hi', content: 'hello', created_at: 1767225600 }]);
  });

  it('DELETE /sessions/:id removes the session and returns {ok:true}', async () => {
    const sessions = makeSessionsMock({
      deleteSession: jest.fn(async () => undefined),
    });
    const controller = buildController(async function* () {}, sessions);

    const result = await controller.deleteSession('s1');

    expect(sessions.deleteSession).toHaveBeenCalledWith('s1');
    expect(result).toEqual({ ok: true });
  });
});
```

> **Note on the magic number:** `1767225600` = `Math.floor(new Date('2026-01-01T00:00:00.000Z').getTime() / 1000)`. It is the unix-seconds form of the `EPOCH` test date.

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm test -- agentos.controller.spec.ts
```

Expected: FAIL — new endpoints/constructor don't exist yet.

- [ ] **Step 3: Rewrite the controller**

Replace the **entire contents** of `server/src/agentos/agentos.controller.ts` with:

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import { NoFilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AGENT_DB_ID, AGENT_ID, AGENT_NAME } from './agentos.constants';
import { DeepAgentService } from './deep-agent.service';
import { SessionsService } from './sessions.service';
import { StreamAdapter, type AgentosFrame } from './stream-adapter';

const now = (): number => Math.floor(Date.now() / 1000);
const toUnix = (d: Date): number => Math.floor(d.getTime() / 1000);

@Controller()
export class AgentosController {
  constructor(
    private readonly deepAgent: DeepAgentService,
    private readonly adapter: StreamAdapter,
    private readonly sessions: SessionsService,
  ) {}

  /** UI 心跳门：status 200 即标记 endpoint 激活。 */
  @Get('health')
  health(): Record<string, never> {
    return {};
  }

  /** 返回一个写死的 agent，UI 据此自动选中。 */
  @Get('agents')
  agents(): Array<{ id: string; name: string; db_id: string }> {
    return [{ id: AGENT_ID, name: AGENT_NAME, db_id: AGENT_DB_ID }];
  }

  /** 列出会话（UI Sessions 侧边栏）。created_at/updated_at 为 unix 秒。 */
  @Get('sessions')
  async listSessions(): Promise<{
    data: Array<{
      session_id: string;
      session_name: string;
      created_at: number;
      updated_at: number;
    }>;
  }> {
    const rows = await this.sessions.listSessions(AGENT_ID);
    return {
      data: rows.map((s) => ({
        session_id: s.id,
        session_name: s.name,
        created_at: toUnix(s.createdAt),
        updated_at: toUnix(s.updatedAt),
      })),
    };
  }

  /** 某会话的历史 run（UI 点击侧边栏恢复时拉取）。返回裸数组。 */
  @Get('sessions/:id/runs')
  async getSessionRuns(
    @Param('id') id: string,
  ): Promise<Array<{ run_input: string; content: string; created_at: number }>> {
    const runs = await this.sessions.getRuns(id);
    return runs.map((r) => ({
      run_input: r.userContent,
      content: r.assistantContent,
      created_at: toUnix(r.createdAt),
    }));
  }

  /** 删除会话（UI SessionItem 的删除按钮）。 */
  @Delete('sessions/:id')
  async deleteSession(@Param('id') id: string): Promise<{ ok: true }> {
    await this.sessions.deleteSession(id);
    return { ok: true };
  }

  /**
   * 核心流式入口：multipart FormData -> 逐帧 JSON 推流。
   * 尊重入参 session_id（空→新建），用解析后的 id 作 thread_id；
   * 流成功结束后把这一轮逐字写入 messages 表供 UI 渲染。
   */
  @Post('agents/:id/runs')
  @UseInterceptors(NoFilesInterceptor())
  async runAgent(
    // phase 1 单 agent：路由的 :id 为兼容 AgentOS 而保留，实际固定用 AGENT_ID。
    @Param('id') _id: string,
    @Body() body: { message?: string; session_id?: string; stream?: string },
    @Res() res: Response,
  ): Promise<void> {
    const message = body?.message ?? '';
    res.setHeader('Content-Type', 'application/json');

    let sessionId = body?.session_id ?? '';
    let fullReply = '';
    let completed = false;

    try {
      const session = await this.sessions.resolveSession(
        body?.session_id,
        AGENT_ID,
        message,
      );
      sessionId = session.id;

      for await (const frame of this.adapter.toFrames(
        AGENT_ID,
        sessionId,
        this.deepAgent.streamTurn({ threadId: sessionId, userMessage: message }),
      )) {
        if (frame.event === 'RunContent' || frame.event === 'RunCompleted') {
          fullReply = frame.content ?? fullReply;
        }
        if (frame.event === 'RunCompleted') completed = true;
        res.write(JSON.stringify(frame) + '\n');
      }
    } catch (err) {
      const errorFrame: AgentosFrame = {
        event: 'RunError',
        content: err instanceof Error ? err.message : String(err),
        created_at: now(),
      };
      res.write(JSON.stringify(errorFrame) + '\n');
    } finally {
      res.end();
      // 流成功且确有用户消息才落库；DB 写失败不回滚已推送的流（best-effort）。
      if (completed && message) {
        try {
          await this.sessions.appendTurn(sessionId, message, fullReply);
        } catch {
          /* best-effort: UI 已拿到流式回复 */
        }
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test -- agentos.controller.spec.ts
```

Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/taowen/project/narratox
git add server/src/agentos/agentos.controller.ts server/src/agentos/agentos.controller.spec.ts
git commit -m "feat(server): real session isolation + list/history/delete endpoints"
```

---

## Task 6: Module wiring

**Files:**
- Modify: `server/src/agentos/agentos.module.ts`

- [ ] **Step 1: Register the new providers**

Replace `server/src/agentos/agentos.module.ts` with:

```ts
import { Module } from '@nestjs/common';
import { AgentosController } from './agentos.controller';
import { checkpointerProvider } from './checkpointer.provider';
import { DeepAgentService } from './deep-agent.service';
import { SessionsService } from './sessions.service';
import { StreamAdapter } from './stream-adapter';

@Module({
  controllers: [AgentosController],
  providers: [DeepAgentService, StreamAdapter, SessionsService, checkpointerProvider],
})
export class AgentosModule {}
```

(`PrismaModule` is `@Global()` so `SessionsService` resolves `PrismaService` without an explicit import here.)

- [ ] **Step 2: Verify the whole suite + build**

```bash
cd /Users/taowen/project/narratox/server
pnpm test
pnpm build
```

Expected: all tests PASS; build clean.

- [ ] **Step 3: Commit**

```bash
cd /Users/taowen/project/narratox
git add server/src/agentos/agentos.module.ts
git commit -m "feat(server): wire SessionsService + checkpointer provider into AgentosModule"
```

---

## Task 7: End-to-end verification (real GLM + real Postgres)

**Files:** none (verification only; fix-and-commit if something breaks)

- [ ] **Step 1: Ensure Postgres is running**

```bash
cd /Users/taowen/project/narratox
docker compose ps
```

Expected: `narratox-postgres` is `Up`. If not, `docker compose up -d`.

- [ ] **Step 2: Start the server**

```bash
cd /Users/taowen/project/narratox/server
pnpm start:dev
```

Expected: Nest boots, `PostgresSaver.setup()` runs without error, routes log includes `health`, `agents`, `agents/:id/runs`, `sessions`, `sessions/:id/runs`, `DELETE sessions/:id`. Keep it running.

- [ ] **Step 3: Verify health + agents**

In another terminal:

```bash
curl -s http://localhost:3001/health && echo
curl -s http://localhost:3001/agents && echo
```

Expected: `{}` then `[{"id":"deep-agent","name":"Deep Agent","db_id":"default"}]`.

- [ ] **Step 4: Verify a real streaming run creates a persisted session**

```bash
curl -sN -X POST http://localhost:3001/agents/deep-agent/runs \
  -F 'message=用一句话介绍你自己' \
  -F 'stream=true'
echo
```

Expected: newline-separated JSON frames — `RunStarted` (with a `session_id`), one or more `RunContent` (cumulative Chinese text), then `RunCompleted`. Capture the `session_id` from the first frame (call it `$SID`).

- [ ] **Step 5: Verify session isolation + persistence with a second turn**

```bash
SID=<paste the session_id from step 4>
curl -sN -X POST http://localhost:3001/agents/deep-agent/runs \
  -F "message=我上一句问了你什么？" \
  -F "session_id=$SID" \
  -F 'stream=true'
echo
```

Expected: the reply **references the previous turn** (proof the checkpointer reloaded thread history — real isolation, not a fresh context).

- [ ] **Step 6: Verify the UI read endpoints**

```bash
curl -s "http://localhost:3001/sessions" && echo
curl -s "http://localhost:3001/sessions/$SID/runs" && echo
```

Expected: `/sessions` returns `{ "data": [ { "session_id": "$SID", "session_name": "...", "created_at": <num>, "updated_at": <num> } ] }`; `/sessions/$SID/runs` returns a bare array with two entries (the two turns), each `{ "run_input": ..., "content": ..., "created_at": <num> }`.

- [ ] **Step 7: Verify delete**

```bash
curl -s -X DELETE "http://localhost:3001/sessions/$SID" && echo
curl -s "http://localhost:3001/sessions" && echo
```

Expected: `{ "ok": true }` then `{ "data": [] }`.

- [ ] **Step 8: Smoke-test the agent-ui end-to-end (optional but recommended)**

From `agent-ui/` in a third terminal: `pnpm dev` (port 3000). Open `http://localhost:3000`, ensure the endpoint is `http://localhost:3001` (no key needed — the server ignores `Authorization`). Send a message, confirm streamed reply; reload the page, confirm the Sessions sidebar lists the session and clicking it restores the transcript. Send a follow-up in that session and confirm the agent remembers.

- [ ] **Step 9: Stop the server, final commit if any fixes were needed**

If verification surfaced fixes, commit them. Otherwise nothing to commit — Task 6 was the last code commit. Stop the server (`Ctrl+C`).

---

## Self-Review Notes (run after writing)

- **Spec coverage:** §3 layers → Tasks 2/4/5/6. §4 data model → Task 1. §5 endpoints → Task 5 (run/list/history/delete). §6 lifecycle → Task 4 `resolveSession` + Task 5 `runAgent`. §7 run flow → Task 5. §8 infra → Tasks 1–2. §9 testing → Tasks 3/4/5 specs + Task 7 manual. §10 error handling → Task 5 `catch`/`finally`; checkpoint-row cleanup gap intentionally deferred (§10).
- **Placeholders:** none — every code step shows full code; magic number `1767225600` is explained.
- **Type consistency:** `streamTurn({threadId, userMessage})` used identically in service (Task 3), controller (Task 5), and both specs. `RunPair { userContent, assistantContent, createdAt }` defined in Task 4 and consumed in Task 5. `CHECKPOINTER` token defined in Task 2, consumed in Tasks 3 & 6. `resolveSession(maybeId, agentId, firstNameHint)` signature consistent across Task 4 impl + Task 4/5 specs.
