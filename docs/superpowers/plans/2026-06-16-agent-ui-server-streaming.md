# Agent UI ↔ Server 流式对接 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `agent-ui` 通过流式接口调用 `server` 里的 DeepAgent（智谱 GLM），实现一问一答的逐字流式对话。

**Architecture:** 在 `server` 新建独立 `agentos` module，暴露三个 AgentOS 兼容路由（`/health`、`/agents`、`/agents/:id/runs`）。三层分离：`AgentosController`（HTTP）、`DeepAgentService`（DeepAgent 实例 + token 流）、`StreamAdapter`（把增量 token 翻译成 AgentUI 期望的 `RunResponseContent` JSON 帧，`RunStarted → RunContent×N → RunCompleted`）。agent-ui 仅改默认 endpoint 指向 `:3001`。

**Tech Stack:** NestJS 11（Express）、`deepagents`、`@langchain/openai`（ChatOpenAI 接智谱 GLM）、`langchain`、multer（`AnyFilesInterceptor` 解析 FormData）、dotenv。

---

## File Structure

**Create (server):**
- `server/src/agentos/agentos.constants.ts` — 常量：agent id/name/db_id、系统提示词、GLM baseURL/model。
- `server/src/agentos/stream-adapter.ts` + `stream-adapter.spec.ts` — 纯逻辑：`AsyncIterable<string>`（增量）→ `AgentosFrame` 序列（累积全文）。无 HTTP / 无 DeepAgent 依赖。
- `server/src/agentos/deep-agent.service.ts` + `deep-agent.service.spec.ts` — `createDeepAgent` 单例（GLM），暴露 `streamDeltas(message): AsyncGenerator<string>`。
- `server/src/agentos/agentos.controller.ts` + `agentos.controller.spec.ts` — 三路由，runs 端点用 `@Res()` 推流。
- `server/src/agentos/agentos.module.ts` — 装配。
- `server/.env.example` — 示例环境变量（提交）；真实 `server/.env` 已被 gitignore。

**Modify:**
- `server/package.json` — 新增依赖（经 `pnpm add`）。
- `server/src/main.ts` — `import 'dotenv/config'` + `app.enableCors()`。
- `server/src/app.module.ts` — 注册 `AgentosModule`。
- `agent-ui/src/store.ts:84` — 默认 endpoint `7777` → `3001`。

> **Import 风格约定**：遵循现有 scaffold（如 `agent.module.ts` 的 `import { AgentService } from './agent.service'`）—— 相对导入**不带** `.js` 扩展名。

---

## Task 1: 安装依赖 + 配置 + main.ts

**Files:**
- Modify: `server/package.json`（pnpm add）
- Create: `server/.env.example`
- Modify: `server/src/main.ts`

- [ ] **Step 1: 安装运行时依赖**

Run:
```bash
cd /Users/taowen/project/narratox/server && pnpm add deepagents langchain @langchain/openai dotenv
```
Expected: 依赖写入 `server/package.json` 的 `dependencies`。

- [ ] **Step 2: 安装 multer 类型**

Run:
```bash
cd /Users/taowen/project/narratox/server && pnpm add -D @types/multer
```
Expected: `@types/multer` 写入 `devDependencies`。

- [ ] **Step 3: 创建 .env.example**

Create `server/.env.example`:
```
# 智谱 GLM (OpenAI 兼容) — 在 https://open.bigmodel.cn 获取
ZHIPUAI_API_KEY=your-zhipuai-api-key-here

# 服务端口（dev:server 已固定 3001，可不设）
PORT=3001
```

- [ ] **Step 4: 创建本地 .env（填真实 key，不提交）**

创建 `server/.env`，把 `ZHIPUAI_API_KEY` 填成你的真实智谱 key。确认 `.gitignore` 已含 `.env`（已确认，server 根 `.gitignore` 第 47 行 `# dotenv ...` 段含 `.env`）。

Run（确认被忽略）:
```bash
cd /Users/taowen/project/narratox && git check-ignore server/.env
```
Expected: 输出 `server/.env`（表示已忽略）。若为空，说明未被忽略——检查 `server/.gitignore`。

- [ ] **Step 5: 修改 main.ts（dotenv + CORS）**

把 `server/src/main.ts` 整体替换为：
```ts
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
```
> `import 'dotenv/config'` 必须在最前，保证模块 init 前 `.env` 已加载。

- [ ] **Step 6: 验证能编译**

Run:
```bash
cd /Users/taowen/project/narratox/server && pnpm build
```
Expected: 编译通过，`dist/` 生成。

> ⚠️ **ESM/CJS 风险注意**：`deepagents`/`langchain` 新版偏 ESM，server 是 CJS。若 `pnpm build` 报 "Cannot use import statement outside a module" 或运行时报 ESM 错误，fallback：在 `server/package.json` 顶层加 `"type": "module"`，并把 `nest-cli.json` 的 `compilerOptions` 加 `"builder": "swc"`（需 `pnpm add -D @swc/cli @swc/core`）。先不加，出现问题再处理。

- [ ] **Step 7: Commit**

```bash
cd /Users/taowen/project/narratox && git add server/package.json server/pnpm-lock.yaml server/.env.example server/src/main.ts && git commit -m "$(cat <<'EOF'
chore(server): add deepagents/langchain deps, dotenv, CORS, .env.example

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: StreamAdapter（纯逻辑，TDD）

**Files:**
- Create: `server/src/agentos/stream-adapter.ts`
- Test: `server/src/agentos/stream-adapter.spec.ts`

- [ ] **Step 1: 写失败测试**

Create `server/src/agentos/stream-adapter.spec.ts`:
```ts
import { StreamAdapter, type AgentosFrame } from './stream-adapter';

async function* fromArray(arr: string[]): AsyncIterable<string> {
  for (const s of arr) yield s;
}

describe('StreamAdapter', () => {
  it('emits RunStarted first, then RunContent with accumulated content, then RunCompleted', async () => {
    const adapter = new StreamAdapter();
    const frames: AgentosFrame[] = [];
    for await (const f of adapter.toFrames('deep-agent', 'sess-1', fromArray(['He', 'llo']))) {
      frames.push(f);
    }
    expect(frames[0].event).toBe('RunStarted');
    expect(frames[0].session_id).toBe('sess-1');
    expect(frames[1]).toMatchObject({ event: 'RunContent', content: 'He' });
    expect(frames[2]).toMatchObject({ event: 'RunContent', content: 'Hello' });
    expect(frames[3]).toMatchObject({ event: 'RunCompleted', content: 'Hello' });
  });

  it('emits RunStarted + RunCompleted even with no deltas', async () => {
    const adapter = new StreamAdapter();
    const frames: AgentosFrame[] = [];
    for await (const f of adapter.toFrames('a', 's', fromArray([]))) frames.push(f);
    expect(frames.map((f) => f.event)).toEqual(['RunStarted', 'RunCompleted']);
    expect(frames[1].content).toBe('');
  });

  it('RunContent content is cumulative full text, not a delta', async () => {
    const adapter = new StreamAdapter();
    const frames: AgentosFrame[] = [];
    for await (const f of adapter.toFrames('a', 's', fromArray(['A', 'B', 'C']))) frames.push(f);
    expect(frames.map((f) => f.content)).toEqual([undefined, 'A', 'AB', 'ABC', 'ABC']);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run:
```bash
cd /Users/taowen/project/narratox/server && pnpm test stream-adapter
```
Expected: FAIL（找不到 `./stream-adapter` 模块）。

- [ ] **Step 3: 实现 StreamAdapter**

Create `server/src/agentos/stream-adapter.ts`:
```ts
export type AgentosEvent =
  | 'RunStarted'
  | 'RunContent'
  | 'RunCompleted'
  | 'RunError';

export interface AgentosFrame {
  event: AgentosEvent;
  content?: string;
  agent_id?: string;
  session_id?: string;
  created_at: number;
}

const now = (): number => Math.floor(Date.now() / 1000);

/**
 * 把 DeepAgent 的增量 token 流翻译成 AgentOS/AgentUI 期望的 RunResponseContent JSON 帧。
 * 关键约定：RunContent.content 必须是「累积全文」，因为 UI 用 chunk.content.replace(lastContent) 去重。
 */
export class StreamAdapter {
  async *toFrames(
    agentId: string,
    sessionId: string,
    deltas: AsyncIterable<string>,
  ): AsyncGenerator<AgentosFrame> {
    yield {
      event: 'RunStarted',
      agent_id: agentId,
      session_id: sessionId,
      created_at: now(),
    };

    let accumulated = '';
    for await (const delta of deltas) {
      accumulated += delta;
      yield { event: 'RunContent', content: accumulated, created_at: now() };
    }

    yield { event: 'RunCompleted', content: accumulated, created_at: now() };
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run:
```bash
cd /Users/taowen/project/narratox/server && pnpm test stream-adapter
```
Expected: PASS（3 个测试通过）。

- [ ] **Step 5: Commit**

```bash
cd /Users/taowen/project/narratox && git add server/src/agentos/stream-adapter.ts server/src/agentos/stream-adapter.spec.ts && git commit -m "$(cat <<'EOF'
feat(server): add StreamAdapter (token deltas -> AgentOS JSON frames)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: DeepAgentService（GLM + token 流，TDD）

**Files:**
- Create: `server/src/agentos/agentos.constants.ts`
- Create: `server/src/agentos/deep-agent.service.ts`
- Test: `server/src/agentos/deep-agent.service.spec.ts`

- [ ] **Step 1: 写常量**

Create `server/src/agentos/agentos.constants.ts`:
```ts
export const AGENT_ID = 'deep-agent';
export const AGENT_NAME = 'Deep Agent';
export const AGENT_DB_ID = 'default';

export const SYSTEM_PROMPT =
  'You are a helpful, concise assistant. Reply in the same language as the user.';

export const GLM_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4';
export const GLM_MODEL = 'glm-4-plus';
```

- [ ] **Step 2: 写失败测试**

Create `server/src/agentos/deep-agent.service.spec.ts`:
```ts
import { DeepAgentService } from './deep-agent.service';

describe('DeepAgentService', () => {
  describe('extractDelta', () => {
    const service = new DeepAgentService();

    it('reads .text from a [message, meta] tuple (messages streamMode shape)', () => {
      expect(service.extractDelta([{ text: 'hi' }, {}])).toBe('hi');
    });

    it('reads string .content when .text is absent', () => {
      expect(service.extractDelta({ content: 'yo' })).toBe('yo');
    });

    it('returns empty string for unrelated / empty chunks', () => {
      expect(service.extractDelta([{ foo: 1 }, {}])).toBe('');
      expect(service.extractDelta(undefined)).toBe('');
      expect(service.extractDelta(null)).toBe('');
    });
  });

  describe('streamDeltas', () => {
    it('yields non-empty deltas in order, skipping empty ones', async () => {
      const service = new DeepAgentService();
      const fakeStream = (async function* () {
        yield [{ text: 'He' }, {}];
        yield [{ foo: 'skip' }, {}]; // extractDelta -> ''
        yield [{ text: 'llo' }, {}];
      })();
      (service as unknown as { agent: unknown }).agent = {
        stream: async () => fakeStream,
      };

      const out: string[] = [];
      for await (const d of service.streamDeltas('hi')) out.push(d);
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
  });
});
```

- [ ] **Step 3: 运行测试，确认失败**

Run:
```bash
cd /Users/taowen/project/narratox/server && pnpm test deep-agent.service
```
Expected: FAIL（找不到 `./deep-agent.service`）。

- [ ] **Step 4: 实现 DeepAgentService**

Create `server/src/agentos/deep-agent.service.ts`:
```ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { createDeepAgent } from 'deepagents';
import { ChatOpenAI } from '@langchain/openai';
import {
  GLM_BASE_URL,
  GLM_MODEL,
  SYSTEM_PROMPT,
} from './agentos.constants';

type DeepAgentInstance = Awaited<ReturnType<typeof createDeepAgent>>;

@Injectable()
export class DeepAgentService implements OnModuleInit {
  private agent!: DeepAgentInstance;

  async onModuleInit(): Promise<void> {
    this.agent = await this.buildAgent();
  }

  // protected 以便单测可访问；构建真实的 DeepAgent（会读 env）
  protected async buildAgent(): Promise<DeepAgentInstance> {
    const apiKey = process.env.ZHIPUAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'ZHIPUAI_API_KEY is not set. Add it to server/.env (see server/.env.example).',
      );
    }
    const model = new ChatOpenAI({
      apiKey,
      baseURL: GLM_BASE_URL,
      modelName: GLM_MODEL,
    });
    return createDeepAgent({ model, systemPrompt: SYSTEM_PROMPT });
  }

  /**
   * 从 deepagents 的 messages 模式流式分块里抽出文本增量。
   * streamMode:'messages'（无 subgraphs）下，每块形如 [message, metadata]，
   * message.text 是增量 delta。同时兼容裸对象 / 缺失字段。
   */
  extractDelta(chunk: unknown): string {
    const msg = (Array.isArray(chunk) ? chunk[0] : chunk) as
      | { text?: string; content?: unknown }
      | undefined;
    if (typeof msg?.text === 'string') return msg.text;
    if (typeof msg?.content === 'string') return msg.content;
    return '';
  }

  /** 把用户消息喂给 DeepAgent，逐块产出文本增量（仅非空）。 */
  async *streamDeltas(message: string): AsyncGenerator<string> {
    const stream = await this.agent.stream(
      { messages: [{ role: 'user', content: message }] },
      { streamMode: 'messages' },
    );
    for await (const chunk of stream) {
      const delta = this.extractDelta(chunk);
      if (delta) yield delta;
    }
  }
}
```

- [ ] **Step 5: 运行测试，确认通过**

Run:
```bash
cd /Users/taowen/project/narratox/server && pnpm test deep-agent.service
```
Expected: PASS（extractDelta 3 + streamDeltas 1 + buildAgent 1 = 5 通过）。

> ⚠️ **运行时形态确认**：`streamMode:'messages'` 下若 `extractDelta` 在真机返回空（token 不出来），在 `extractDelta` 里临时 `console.log(JSON.stringify(chunk))` 看真实结构——可能是 `chunk.content` 为数组（`[{type:'text', text:'...'}]`）。本实现已兼容字符串 `.content`；若为数组，扩展 `extractDelta` 从数组项取 `.text`。**先用 Task 7 真机验证再决定是否扩展。**

- [ ] **Step 6: Commit**

```bash
cd /Users/taowen/project/narratox && git add server/src/agentos/agentos.constants.ts server/src/agentos/deep-agent.service.ts server/src/agentos/deep-agent.service.spec.ts && git commit -m "$(cat <<'EOF'
feat(server): add DeepAgentService (GLM via ChatOpenAI, token stream)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: AgentosController（三路由，TDD）

**Files:**
- Create: `server/src/agentos/agentos.controller.ts`
- Test: `server/src/agentos/agentos.controller.spec.ts`

- [ ] **Step 1: 写失败测试**

Create `server/src/agentos/agentos.controller.spec.ts`:
```ts
import type { Response } from 'express';
import { AgentosController } from './agentos.controller';
import type { DeepAgentService } from './deep-agent.service';
import { StreamAdapter, type AgentosFrame } from './stream-adapter';

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

function buildController(
  deltas: (m: string) => AsyncIterable<string>,
): AgentosController {
  const fakeService = { streamDeltas: deltas } as unknown as DeepAgentService;
  return new AgentosController(fakeService, new StreamAdapter());
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
    expect(agents[0]).toMatchObject({
      id: 'deep-agent',
      name: 'Deep Agent',
      db_id: 'default',
    });
  });

  it('POST runs streams RunStarted -> RunContent x2 -> RunCompleted as newline JSON', async () => {
    const controller = buildController(async function* () {
      yield 'He';
      yield 'llo';
    });
    const { res, chunks } = createFakeRes();
    await controller.runAgent('deep-agent', { message: 'hi' }, res);

    const frames = chunks
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => JSON.parse(c)) as AgentosFrame[];
    expect(frames[0].event).toBe('RunStarted');
    expect(frames[0].session_id).toEqual(expect.any(String));
    expect(frames.map((f) => f.event)).toEqual([
      'RunStarted',
      'RunContent',
      'RunContent',
      'RunCompleted',
    ]);
    expect(frames[frames.length - 1].content).toBe('Hello');
  });

  it('POST runs emits RunError frame when service throws', async () => {
    const controller = buildController(async function* () {
      throw new Error('boom');
    });
    const { res, chunks } = createFakeRes();
    await controller.runAgent('deep-agent', { message: 'hi' }, res);

    const frames = chunks
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => JSON.parse(c)) as AgentosFrame[];
    const last = frames[frames.length - 1];
    expect(last.event).toBe('RunError');
    expect(last.content).toBe('boom');
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run:
```bash
cd /Users/taowen/project/narratox/server && pnpm test agentos.controller
```
Expected: FAIL（找不到 `./agentos.controller`）。

- [ ] **Step 3: 实现 AgentosController**

Create `server/src/agentos/agentos.controller.ts`:
```ts
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { AGENT_DB_ID, AGENT_ID, AGENT_NAME } from './agentos.constants';
import { DeepAgentService } from './deep-agent.service';
import { StreamAdapter, type AgentosFrame } from './stream-adapter';

const now = (): number => Math.floor(Date.now() / 1000);

@Controller()
export class AgentosController {
  constructor(
    private readonly deepAgent: DeepAgentService,
    private readonly adapter: StreamAdapter,
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

  /** 核心流式入口：multipart FormData -> 逐帧 JSON 推流。 */
  @Post('agents/:id/runs')
  @UseInterceptors(AnyFilesInterceptor())
  async runAgent(
    @Param('id') _id: string,
    @Body() body: { message?: string; session_id?: string; stream?: string },
    @Res() res: Response,
  ): Promise<void> {
    const message = body?.message ?? '';
    const sessionId = randomUUID();
    res.setHeader('Content-Type', 'application/json');

    try {
      for await (const frame of this.adapter.toFrames(
        AGENT_ID,
        sessionId,
        this.deepAgent.streamDeltas(message),
      )) {
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
    }
  }
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run:
```bash
cd /Users/taowen/project/narratox/server && pnpm test agentos.controller
```
Expected: PASS（4 个测试通过）。

- [ ] **Step 5: 全量测试 + 编译**

Run:
```bash
cd /Users/taowen/project/narratox/server && pnpm test && pnpm build
```
Expected: 所有测试通过；`pnpm build` 编译成功。

- [ ] **Step 6: Commit**

```bash
cd /Users/taowen/project/narratox && git add server/src/agentos/agentos.controller.ts server/src/agentos/agentos.controller.spec.ts && git commit -m "$(cat <<'EOF'
feat(server): add AgentosController (health/agents/runs streaming)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: 装配 Module + 注册到 AppModule

**Files:**
- Create: `server/src/agentos/agentos.module.ts`
- Modify: `server/src/app.module.ts`

- [ ] **Step 1: 创建 AgentosModule**

Create `server/src/agentos/agentos.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AgentosController } from './agentos.controller';
import { DeepAgentService } from './deep-agent.service';
import { StreamAdapter } from './stream-adapter';

@Module({
  controllers: [AgentosController],
  providers: [DeepAgentService, StreamAdapter],
})
export class AgentosModule {}
```

- [ ] **Step 2: 注册到 AppModule**

把 `server/src/app.module.ts` 整体替换为：
```ts
import { Module } from '@nestjs/common';
import { AgentModule } from './agent/agent.module';
import { AgentosModule } from './agentos/agentos.module';

@Module({
  imports: [AgentModule, AgentosModule],
})
export class AppModule {}
```

- [ ] **Step 3: 编译验证**

Run:
```bash
cd /Users/taowen/project/narratox/server && pnpm build
```
Expected: 编译成功。

- [ ] **Step 4: Commit**

```bash
cd /Users/taowen/project/narratox && git add server/src/agentos/agentos.module.ts server/src/app.module.ts && git commit -m "$(cat <<'EOF'
feat(server): wire AgentosModule into AppModule

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: agent-ui 默认 endpoint 指向 server

**Files:**
- Modify: `agent-ui/src/store.ts:84`

- [ ] **Step 1: 改默认 endpoint**

在 `agent-ui/src/store.ts` 第 84 行，把：
```ts
      selectedEndpoint: 'http://localhost:7777',
```
改为：
```ts
      selectedEndpoint: 'http://localhost:3001',
```

- [ ] **Step 2: 类型检查**

Run:
```bash
cd /Users/taowen/project/narratox/agent-ui && pnpm typecheck
```
Expected: 通过。

- [ ] **Step 3: Commit**

```bash
cd /Users/taowen/project/narratox && git add agent-ui/src/store.ts && git commit -m "$(cat <<'EOF'
feat(agent-ui): point default endpoint at server (:3001)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: 手动端到端验证

**Files:** 无改动（仅运行 + 观察）。

- [ ] **Step 1: 确认 server/.env 已填真实 ZHIPUAI_API_KEY**

```bash
grep ZHIPUAI_API_KEY /Users/taowen/project/narratox/server/.env
```
Expected: 输出非占位的真实 key。若为 `your-...-here`，先填好。

- [ ] **Step 2: 起两个进程（根目录并行）**

Run（根目录，后台或独立终端）:
```bash
cd /Users/taowen/project/narratox && pnpm dev
```
> 这会并行起 agent-ui (:3000) + server (:3001)。等待两者就绪。

- [ ] **Step 3: 验证 server 三个接口**

新终端：
```bash
curl -sS http://localhost:3001/health && echo
curl -sS http://localhost:3001/agents && echo
```
Expected: `{}` 和 `[{"id":"deep-agent","name":"Deep Agent","db_id":"default"}]`。

- [ ] **Step 4: 验证流式接口（curl 直连）**

```bash
curl -sS -X POST http://localhost:3001/agents/deep-agent/runs \
  -F 'message=用一句话介绍你自己' \
  -F 'stream=true' \
  -F 'session_id='
```
Expected: 逐行打印 JSON 帧，`RunStarted` 在最前，多个 `RunContent`（content 逐帧变长），末尾 `RunCompleted`。
> 若没有任何 `RunContent`（只看到 RunStarted/RunCompleted 且 content 为空）：说明 `extractDelta` 没抓到 token。在 `deep-agent.service.ts` 的 `extractDelta` 临时加 `console.log('CHUNK', JSON.stringify(chunk))`，看真实分块结构，按 Task 3 Step 5 的说明扩展取值逻辑（可能是 `content` 为 `[{type:'text',text}]` 数组）。

- [ ] **Step 5: 验证 UI 端到端**

浏览器开 `http://localhost:3000`：
1. 左侧 sidebar 应显示 endpoint 已激活、自动选中 "Deep Agent"。
2. 输入 "你好"，发送。
3. 期望：agent 气泡**逐字流式**打字显示回复（打字机效果），不报错。
4. 刷新页面：历史不恢复（本阶段不持久化，符合预期）。

- [ ] **Step 6: 验收确认**

满足以下即通过：
- [ ] `/health` 返回 200。
- [ ] UI 选中 agent、能发送。
- [ ] 回复逐字流式出现（打字机效果）。
- [ ] 无 console 报错、无 `streamingError`。

若全部通过，第一阶段完成。无新增 commit（本任务仅验证）；若 Step 4/5 触发了 `extractDelta` 的修改，则补一个 commit：
```bash
cd /Users/taowen/project/narratox && git add server/src/agentos/deep-agent.service.ts server/src/agentos/deep-agent.service.spec.ts && git commit -m "fix(server): adapt extractDelta to real streamMode chunk shape

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review 已完成

对照 spec 各节：
- §2 三接口（health/agents/runs）→ Task 4/5 ✓；sessions/teams 不实现 ✓（YAGNI，无对应 task）
- §3 模块布局（controller/deep-agent-service/stream-adapter/constants/module）→ 全部 task 覆盖 ✓
- §4 RunContent=累积全文、RunStarted 先发、session_id 新生成、RunError 帧 → StreamAdapter(Task 2) + Controller(Task 4) + 测试断言 ✓
- §5 GLM/ChatOpenAI/baseURL、streamMode messages、CORS、dotenv、agent-ui store.ts 改动 → Task 1/3/6 ✓
- §6 单元测试 StreamAdapter + DeepAgentService + Controller；手动验证 → Task 2/3/4/7 ✓

类型一致性：`AgentosFrame`、`StreamAdapter.toFrames`、`DeepAgentService.streamDeltas`、`AgentosController.runAgent` 签名在各 task 间一致 ✓。无占位符 ✓。
