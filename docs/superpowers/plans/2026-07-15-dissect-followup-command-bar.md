# 拆解 follow-up 命令栏 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 拆解完成后(DONE),用户可在结果弹窗底部发指令给 agent 微调/补拆/删除条目。

**Architecture:** 后端复用 `buildDissectGraph` + `runStreamPhase`,新增 `continueDissect` 方法 + `mode: 'followup'` 参数(给已有 `write_benchmark` 的 subagent 追加 `update_benchmark` / `delete_benchmark` 工具)。HTTP 新增 `POST /:id/dissect/message` 路由,流化复用现有 emitter 模式(抽 `attachJobStream` helper)。前端在 ResultBrowser 底部加命令栏,复用 LogDrawer 的 `LogRow` + 活动帧解析模式。

**Tech Stack:** NestJS, Prisma 7, langchain tools (zod), React 18 + TypeScript, Zustand。

**Spec:** `docs/superpowers/specs/2026-07-14-dissect-followup-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `server/src/benchmark/benchmark.service.ts` | 加 `updateEntry` / `deleteEntry` |
| Create | `server/src/agentos/tools/update-benchmark.tool.ts` | `update_benchmark` 工具 |
| Create | `server/src/agentos/tools/delete-benchmark.tool.ts` | `delete_benchmark` 工具 |
| Modify | `server/src/agentos/agent-registry.ts` | 注册 2 个新工具 |
| Modify | `server/src/agentos/dissect-agent.service.ts` | `buildDissectGraph` 加 mode 参数 + `continueDissect` 方法 |
| Modify | `server/src/benchmark/benchmark.controller.ts` | `POST /:id/dissect/message` 路由 + `attachJobStream` 重构 |
| Modify | `agent-ui/src/api/routes.ts` | 加 `BenchmarkDissectMessage` 路由常量 |
| Modify | `agent-ui/src/api/benchmark.ts` | 加 `dissectMessageStream` |
| Modify | `agent-ui/src/components/dissect/DissectPage.tsx` | ResultBrowser 加命令栏 + FollowupActivityPanel |

---

## Task 1: BenchmarkService 加 updateEntry / deleteEntry

**Files:**
- Modify: `server/src/benchmark/benchmark.service.ts:236-244` (在 `markInterruptedOnBoot` 之前插入)

- [ ] **Step 1: 加 updateEntry 方法**

在 `benchmark.service.ts` 的 `markInterruptedOnBoot` 方法之前(约 237 行,`async markInterruptedOnBoot` 之前)插入:

```ts
  /** 修改条目内容/标题。updateMany + bookId 防跨书(id 是 PK 保证唯一,bookId 是额外过滤)。 */
  async updateEntry(
    bookId: string,
    entryId: string,
    opts: { title?: string; content?: string },
  ) {
    const result = await this.prisma.benchmarkEntry.updateMany({
      where: { id: entryId, bookId },
      data: {
        ...(opts.title != null ? { title: opts.title } : {}),
        ...(opts.content != null ? { content: opts.content } : {}),
      },
    });
    if (result.count === 0) throw new NotFoundException('条目不存在');
    return this.prisma.benchmarkEntry.findUniqueOrThrow({ where: { id: entryId } });
  }

  /** 删除条目。deleteMany + bookId 防跨书。 */
  async deleteEntry(bookId: string, entryId: string) {
    const result = await this.prisma.benchmarkEntry.deleteMany({
      where: { id: entryId, bookId },
    });
    if (result.count === 0) throw new NotFoundException('条目不存在');
  }
```

- [ ] **Step 2: typecheck**

Run: `cd /Users/taowen/project/narratox/server && pnpm typecheck`
Expected: PASS (无新错误)

- [ ] **Step 3: Commit**

```bash
cd /Users/taowen/project/narratox
git add server/src/benchmark/benchmark.service.ts
git commit -m "feat(benchmark): 加 updateEntry / deleteEntry 服务方法

updateMany/deleteMany + bookId where 防跨书(id 是 PK 保证唯一,
bookId 是额外安全网)。供 followup 命令栏的 update/delete 工具调用。

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 2: update_benchmark 工具

**Files:**
- Create: `server/src/agentos/tools/update-benchmark.tool.ts`

- [ ] **Step 1: 创建工具文件**

创建 `server/src/agentos/tools/update-benchmark.tool.ts`,复用 `write-benchmark.tool.ts` 的 `WriteBenchmarkDeps` 接口:

```ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { WriteBenchmarkDeps } from './write-benchmark.tool';

/**
 * 拆解 follow-up 工具:修改一条已有拆解条目的 title/content。
 * entryId 从 get_dissect_entries 获取。只改 title/content,不改 type/bookId/kind/purposes(结构属性)。
 */
export const makeUpdateBenchmarkTool = (d: WriteBenchmarkDeps) =>
  tool(
    async ({ entryId, title, content }) => {
      const updated = await d.benchmark.updateEntry(d.bookId, entryId, {
        ...(title != null ? { title } : {}),
        ...(content != null ? { content } : {}),
      });
      return { ok: true, entry: { id: updated.id, title: updated.title } };
    },
    {
      name: 'update_benchmark',
      description:
        '修改一条已有的拆解条目(标题/内容)。entryId 从 get_dissect_entries 取。至少传 title 或 content 之一。',
      schema: z
        .object({
          entryId: z.string().describe('要修改的 BenchmarkEntry id'),
          title: z.string().optional().describe('新标题(不传则不改)'),
          content: z.string().optional().describe('新内容(不传则不改)'),
        })
        .refine((v) => v.title != null || v.content != null, {
          message: '至少传 title 或 content 之一',
        }),
    },
  );
```

- [ ] **Step 2: typecheck**

Run: `cd /Users/taowen/project/narratox/server && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd /Users/taowen/project/narratox
git add server/src/agentos/tools/update-benchmark.tool.ts
git commit -m "feat(agentos): 加 update_benchmark 工具

follow-up 模式下注入到有 write_benchmark 的 subagent。
闭包注入 bookId/benchmark,LLM 无法跨书。

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 3: delete_benchmark 工具

**Files:**
- Create: `server/src/agentos/tools/delete-benchmark.tool.ts`

- [ ] **Step 1: 创建工具文件**

创建 `server/src/agentos/tools/delete-benchmark.tool.ts`:

```ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { WriteBenchmarkDeps } from './write-benchmark.tool';

/**
 * 拆解 follow-up 工具:删除一条拆解条目(如重复素材、错误条目)。
 * entryId 从 get_dissect_entries 获取。删除不可撤销。
 */
export const makeDeleteBenchmarkTool = (d: WriteBenchmarkDeps) =>
  tool(
    async ({ entryId }) => {
      await d.benchmark.deleteEntry(d.bookId, entryId);
      return { ok: true };
    },
    {
      name: 'delete_benchmark',
      description:
        '删除一条拆解条目(如重复素材、错误条目)。entryId 从 get_dissect_entries 取。删除不可撤销。',
      schema: z.object({
        entryId: z.string().describe('要删除的 BenchmarkEntry id'),
      }),
    },
  );
```

- [ ] **Step 2: typecheck**

Run: `cd /Users/taowen/project/narratox/server && pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
cd /Users/taowen/project/narratox
git add server/src/agentos/tools/delete-benchmark.tool.ts
git commit -m "feat(agentos): 加 delete_benchmark 工具

follow-up 模式下注入到有 write_benchmark 的 subagent。
闭包注入 bookId/benchmark,deleteEntry where 带 bookId 防跨书。

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 4: 注册 2 个新工具到 TOOL_REGISTRY

**Files:**
- Modify: `server/src/agentos/agent-registry.ts:73-79` (import 区) 和 `388-406` (registry 对象末尾)

- [ ] **Step 1: 加 import**

在 `agent-registry.ts` 第 79 行(`import { makeSearchBenchmarkTool }` 之后)加:

```ts
import { makeUpdateBenchmarkTool } from './tools/update-benchmark.tool';
import { makeDeleteBenchmarkTool } from './tools/delete-benchmark.tool';
```

- [ ] **Step 2: 加 registry 条目**

在 `TOOL_REGISTRY` 对象末尾(`search_benchmark` 条目之后,`406` 行的 `}` 之前)加:

```ts
  update_benchmark: (d) =>
    makeUpdateBenchmarkTool({
      userId: d.userId,
      bookId: d.bookId!,
      benchmark: d.benchmark!,
    }),
  delete_benchmark: (d) =>
    makeDeleteBenchmarkTool({
      userId: d.userId,
      bookId: d.bookId!,
      benchmark: d.benchmark!,
    }),
```

- [ ] **Step 3: typecheck**

Run: `cd /Users/taowen/project/narratox/server && pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd /Users/taowen/project/narratox
git add server/src/agentos/agent-registry.ts
git commit -m "feat(agentos): TOOL_REGISTRY 注册 update_benchmark / delete_benchmark

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 5: buildDissectGraph 加 mode 参数 + continueDissect 方法

**Files:**
- Modify: `server/src/agentos/dissect-agent.service.ts:130-176` (buildDissectGraph 签名 + resolveTools)

这是后端核心改动。分 3 步:加 mode 参数、改 resolveTools、加 continueDissect 方法。

- [ ] **Step 1: buildDissectGraph 签名加 mode**

在 `dissect-agent.service.ts:130`,把 `buildDissectGraph` 的 `args` 类型加一个字段:

```ts
  private async buildDissectGraph(args: {
    userId: string;
    bookId: string;
    systemPrompt: string;
    activeConfig: ModelConfigRecord;
    overrideMap: Map<string, AgentOverrideEntry>;
    mode?: 'initial' | 'followup';
  }): Promise<DissectGraph> {
    const { userId, bookId, systemPrompt, activeConfig, overrideMap } = args;
    const mode = args.mode ?? 'initial';
```

- [ ] **Step 2: resolveTools 加 followup 工具注入**

把第 175-176 行的 `resolveTools` 函数替换为:

```ts
    const resolveTools = (keys: string[]) => {
      const result = [...keys];
      if (mode === 'followup' && keys.includes('write_benchmark')) {
        result.push('update_benchmark', 'delete_benchmark');
      }
      return result.map((k) => TOOL_REGISTRY[k](deps) as never);
    };
```

- [ ] **Step 3: 加 continueDissect 方法**

在 `dissect-agent.service.ts` 的 `getJob` 方法之前(约 496 行)插入新方法:

```ts
  /**
   * 微调拆解(后台异步,不 await)。与 startDissect 的区别:
   *  1. 不跑分阶段驱动循环——只跑一条用户消息(runStreamPhase 一次);
   *  2. buildDissectGraph 用 mode:'followup' → subagent 多 update_benchmark/delete_benchmark;
   *  3. 状态:DONE → RUNNING → DONE(失败也回 DONE,初始拆解结果仍有效);
   *  4. thread_id 独立(`dissect-${bookId}-followup-${Date.now()}`),保证 recursion 预算独立。
   */
  async continueDissect(
    userId: string,
    bookId: string,
    message: string,
  ): Promise<void> {
    const activeConfig = await this.modelConfigs.getActive(userId);
    if (!activeConfig) {
      throw new Error('尚未配置模型,请在设置页激活一个模型');
    }
    const config: ModelConfigRecord = {
      id: activeConfig.id,
      provider: activeConfig.provider,
      model: activeConfig.model,
      baseUrl: activeConfig.baseUrl,
      apiKey: activeConfig.apiKey,
      temperature: activeConfig.temperature,
      updatedAt: activeConfig.updatedAt,
    };
    const overrideMap = await this.agentOverrides.listMap(userId);
    const { prompt } = await this.dissectContext.forBook(userId, bookId);

    const book = await this.prisma.benchmarkBook.findUniqueOrThrow({
      where: { id: bookId },
    });
    if (book.userId !== userId) throw new Error('无权限');
    if (book.status === 'RUNNING') {
      throw new Error('正在拆解中,请等待完成');
    }

    const emitter = new EventEmitter();
    const abortController = new AbortController();
    this.jobs.set(bookId, { emitter, abortController });

    await this.prisma.benchmarkBook.update({
      where: { id: bookId },
      data: { status: 'RUNNING' },
    });

    (async () => {
      try {
        const agent = await this.buildDissectGraph({
          userId,
          bookId,
          systemPrompt: prompt,
          activeConfig: config,
          overrideMap,
          mode: 'followup',
        });
        await this.runStreamPhase(
          agent,
          message,
          `dissect-${bookId}-followup-${Date.now()}`,
          emitter,
          abortController.signal,
        );
      } catch (err) {
        this.logger.error(
          `continueDissect ${bookId}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      } finally {
        // 无论成败都回 DONE(初始拆解结果仍有效,不回 FAILED)
        await this.prisma.benchmarkBook.update({
          where: { id: bookId },
          data: { status: 'DONE' },
        });
        emitter.emit('done');
        this.jobs.delete(bookId);
      }
    })();
  }
```

- [ ] **Step 4: typecheck**

Run: `cd /Users/taowen/project/narratox/server && pnpm typecheck`
Expected: PASS

- [ ] **Step 5: 单元测试回归**

Run: `cd /Users/taowen/project/narratox/server && pnpm test`
Expected: 所有现有测试通过(不应回归——continueDissect 是新方法,不改现有路径)

- [ ] **Step 6: Commit**

```bash
cd /Users/taowen/project/narratox
git add server/src/agentos/dissect-agent.service.ts
git commit -m "feat(agentos): buildDissectGraph 加 mode + continueDissect 方法

mode='followup' 给有 write_benchmark 的 subagent 追加 update/delete
工具。continueDissect 复用 runStreamPhase,只跑一条用户消息,独立
thread_id。失败回 DONE(不回 FAILED)。

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 6: HTTP 路由 + attachJobStream 重构

**Files:**
- Modify: `server/src/benchmark/benchmark.controller.ts`

抽公共流化 helper(dissect / stream / dissectMessage 三路由共享),加 `POST :id/dissect/message` 路由。

- [ ] **Step 1: 加 attachJobStream 私有方法**

在 `BenchmarkController` 类内、`dissect` 方法之前(约 83 行,`@Post(':id/dissect')` 装饰器之前)加私有方法:

```ts
  /**
   * 公共流化 helper:heartbeat + activity 帧流化 + done/close 清理。
   * dissect / stream / dissectMessage 三路由共享。
   */
  private attachJobStream(
    res: Response,
    req: Request,
    job: { emitter: EventEmitter } | undefined,
    writeFrame: (p: Record<string, unknown>) => void,
  ): void {
    const heartbeat = setInterval(
      () => writeFrame({ event: 'Heartbeat' }),
      15_000,
    );
    const onActivity = (ev: unknown): void =>
      writeFrame({ event: 'activity', activity: ev });
    job?.emitter.on('activity', onActivity);

    const cleanup = (): void => {
      clearInterval(heartbeat);
      job?.emitter.off('activity', onActivity);
      if (!res.writableEnded) {
        writeFrame({ event: 'RunCompleted', created_at: Date.now() });
        res.end();
      }
    };
    job?.emitter.once('done', cleanup);
    req.on('close', cleanup);
  }
```

- [ ] **Step 2: 重构 dissect 路由用 attachJobStream**

把 `dissect` 方法(约 90-133 行)中从 `const heartbeat` 到 `req.on('close', cleanup)` 的 15 行(115-132 行)替换为一行:

```ts
    this.attachJobStream(res, req, job, writeFrame);
```

即整个 `dissect` 方法变成:

```ts
  @Post(':id/dissect')
  async dissect(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Res() res: Response,
    @Req() req: Request,
  ): Promise<void> {
    res.setHeader('Content-Type', 'application/json');
    const writeFrame = (payload: Record<string, unknown>): void => {
      if (res.writableEnded || res.destroyed) return;
      res.write(JSON.stringify(payload) + '\n');
    };

    const book = await this.benchmarks.get(user.id, id);
    if (book.status === 'RUNNING') {
      writeFrame({ event: 'RunError', content: '该任务正在拆解中' });
      res.end();
      return;
    }

    await this.dissectService.startDissect(user.id, id);
    const job = this.dissectService.getJob(id);

    writeFrame({ event: 'RunStarted', book_id: id, created_at: Date.now() });
    this.attachJobStream(res, req, job, writeFrame);
  }
```

- [ ] **Step 3: 重构 stream 路由用 attachJobStream**

把 `stream` 方法中从 `const heartbeat` 到 `req.on('close', cleanup)` 的部分(160-177 行)替换。

注意 `stream` 路由有特殊逻辑:job 不在时立即回 RunCompleted + status。重构后:

```ts
  @Get(':id/stream')
  async stream(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Res() res: Response,
    @Req() req: Request,
  ): Promise<void> {
    res.setHeader('Content-Type', 'application/json');
    const writeFrame = (payload: Record<string, unknown>): void => {
      if (!res.writableEnded && !res.destroyed) {
        res.write(JSON.stringify(payload) + '\n');
      }
    };

    const job = this.dissectService.getJob(id);
    if (!job) {
      const book = await this.benchmarks.get(user.id, id);
      writeFrame({ event: 'RunCompleted', status: book.status });
      res.end();
      return;
    }

    this.attachJobStream(res, req, job, writeFrame);
  }
```

- [ ] **Step 4: 加 dissectMessage 路由**

在 `stream` 方法之后、`delete` 方法之前加:

```ts
  /**
   * 微调拆解:发一条用户指令给 agent,流化活动帧。
   * 复用 continueDissect(后台 IIFE)+ attachJobStream(流化)。
   * 防 RUNNING:status 非 DONE 时拒绝(初始拆解中或微调中)。
   */
  @Post(':id/dissect/message')
  async dissectMessage(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body('message') message: string,
    @Res() res: Response,
    @Req() req: Request,
  ): Promise<void> {
    res.setHeader('Content-Type', 'application/json');
    const writeFrame = (payload: Record<string, unknown>): void => {
      if (res.writableEnded || res.destroyed) return;
      res.write(JSON.stringify(payload) + '\n');
    };

    const book = await this.benchmarks.get(user.id, id);
    if (book.status === 'RUNNING') {
      writeFrame({ event: 'RunError', content: '该任务正在拆解中' });
      res.end();
      return;
    }
    if (!message || !message.trim()) {
      writeFrame({ event: 'RunError', content: '消息不能为空' });
      res.end();
      return;
    }

    try {
      await this.dissectService.continueDissect(user.id, id, message.trim());
    } catch (err) {
      writeFrame({
        event: 'RunError',
        content: err instanceof Error ? err.message : '启动失败',
      });
      res.end();
      return;
    }
    const job = this.dissectService.getJob(id);

    writeFrame({ event: 'RunStarted', book_id: id, created_at: Date.now() });
    this.attachJobStream(res, req, job, writeFrame);
  }
```

- [ ] **Step 5: typecheck**

Run: `cd /Users/taowen/project/narratox/server && pnpm typecheck`
Expected: PASS

- [ ] **Step 6: 单元测试回归**

Run: `cd /Users/taowen/project/narratox/server && pnpm test`
Expected: 所有现有测试通过

- [ ] **Step 7: Commit**

```bash
cd /Users/taowen/project/narratox
git add server/src/benchmark/benchmark.controller.ts
git commit -m "feat(benchmark): POST /:id/dissect/message 路由 + attachJobStream 重构

抽 attachJobStream 公共 helper(dissect/stream/dissectMessage 三路由共享
heartbeat+activity+cleanup)。新路由接收用户指令消息,调 continueDissect
后台执行,流化活动帧。防 RUNNING + 空 message 校验。

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 7: 前端 API 层

**Files:**
- Modify: `agent-ui/src/api/routes.ts:82` (加路由常量)
- Modify: `agent-ui/src/api/benchmark.ts:116` (加 API 函数)

- [ ] **Step 1: 加路由常量**

在 `routes.ts` 的 `BenchmarkEntryRename` 之后(82 行,在 `}` 之前)加:

```ts
  ,
  BenchmarkDissectMessage: (base: string, id: string) =>
    `${apiBase(base)}/benchmarks/${id}/dissect/message`
```

- [ ] **Step 2: 加 dissectMessageStream 函数**

在 `benchmark.ts` 的 `renameBenchmarkEntry` 之后(116 行,文件末尾)加:

```ts

/** 微调拆解:POST /:id/dissect/message { message },返回 newline-JSON 流。 */
export const dissectMessageStream = (
  base: string,
  token: string,
  id: string,
  message: string
): Promise<Response> =>
  fetch(APIRoutes.BenchmarkDissectMessage(base, id), {
    method: 'POST',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message })
  })
```

- [ ] **Step 3: typecheck**

Run: `cd /Users/taowen/project/narratox/agent-ui && pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
cd /Users/taowen/project/narratox
git add agent-ui/src/api/routes.ts agent-ui/src/api/benchmark.ts
git commit -m "feat(agent-ui): 加 BenchmarkDissectMessage 路由 + dissectMessageStream

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 8: ResultBrowser 命令栏 + 活动面板

**Files:**
- Modify: `agent-ui/src/components/dissect/DissectPage.tsx`

这是前端核心改动。分 5 步:加 import、加 FollowupActivityPanel 子组件、改 ResultBrowser 签名 + 加状态、加 sendFollowup 回调、加命令栏 UI。

- [ ] **Step 1: 加 import + 类型**

在 `DissectPage.tsx` 第 1-50 行的 import 区:

第 2 行(`import { tool } ...` — 不,那是 server 的)。

前端文件第 4-11 行的 lucide import 加 `ArrowUp` 和 `Loader2`:

```tsx
import {
  AlertTriangle,
  ArrowUp,
  Check,
  Loader2,
  Search,
  Sparkles,
  Upload,
  Zap
} from 'lucide-react'
```

第 14-22 行的 benchmark API import 加 `dissectMessageStream`:

```tsx
import {
  deleteBenchmark,
  dissectBenchmarkStream,
  dissectMessageStream,
  getBenchmark,
  listBenchmarks,
  renameBenchmarkEntry,
  streamBenchmark,
  uploadBenchmark
} from '@/api/benchmark'
```

- [ ] **Step 2: 加 FollowupActivityPanel + FollowupRow 子组件**

在 `ResultBrowser` 组件之前(约 796 行,`const ACTIVE_BG` 之前)加:

```tsx
/* ------------------------------------------------------------------ */
/* Followup 活动面板(精简版 LogDrawer 行渲染)                         */
/* ------------------------------------------------------------------ */

const FollowupRow = ({ row }: { row: LogRow }) => {
  if (row.level === 'think') {
    return (
      <div className="flex items-start gap-2 text-text-muted">
        <span className="mt-0.5 text-[10px]">💭</span>
        <span className="flex-1 text-xs italic">{row.text}</span>
      </div>
    )
  }
  if (row.level === 'tool') {
    return (
      <div className="flex items-start gap-2">
        <span
          className="mt-1.5 size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: '#60A5FA' }}
        />
        <span className="flex-1 font-mono text-xs text-text-secondary">
          {row.text}
        </span>
      </div>
    )
  }
  if (row.level === 'error') {
    return (
      <div className="flex items-start gap-2 text-red-400">
        <AlertTriangle className="mt-0.5 size-3 shrink-0" />
        <span className="flex-1 text-xs">{row.text}</span>
      </div>
    )
  }
  // content / stage / info
  return (
    <div className="flex items-start gap-2">
      <span
        className="mt-1.5 size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: '#8b5cf6' }}
      />
      <span className="flex-1 text-xs text-text-secondary">{row.text}</span>
    </div>
  )
}

const FollowupActivityPanel = ({ rows }: { rows: LogRow[] }) => (
  <div className="mb-2 max-h-40 space-y-1.5 overflow-y-auto rounded-md bg-overlay-5 p-3">
    {rows.map((r) => (
      <FollowupRow key={r.id} row={r} />
    ))}
  </div>
)
```

- [ ] **Step 3: 改 ResultBrowser 签名 + 加状态 + 加回调**

改 `ResultBrowser` 组件签名(约 797-805 行),加 `onBookChange` prop:

```tsx
const ResultBrowser = ({
  book,
  onClose,
  onRenameEntry,
  onBookChange
}: {
  book: BenchmarkBook | null
  onClose: () => void
  onRenameEntry: (entryId: string, next: string) => Promise<void>
  onBookChange: (next: BenchmarkBook) => void
}) => {
```

在 `grouped` / `tab` / `query` / `selectedId` state 之后(约 812 行)加 followup 状态:

```tsx
  // ── follow-up 命令栏状态 ──
  const [followupMsg, setFollowupMsg] = useState('')
  const [followupRunning, setFollowupRunning] = useState(false)
  const [followupRows, setFollowupRows] = useState<LogRow[]>([])
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const actTextRef = useRef<Map<string, string>>(new Map())
  const seenIdsRef = useRef<Set<string>>(new Set())
```

在 `review` 变量之前(约 820 行)加 `sendFollowup` 回调 + `handleFollowupActivity`:

```tsx
  const handleFollowupActivity = useCallback(
    (act: ActivityEvent, ts: number, pushRow: (r: LogRow) => void) => {
      if (
        (act.type === 'Act' ||
          act.type === 'ActDelta' ||
          act.type === 'ActTool' ||
          act.type === 'ActResult' ||
          act.type === 'ActEnd') &&
        seenIdsRef.current.has(act.id) &&
        act.type !== 'ActDelta'
      )
        return
      if (act.type === 'Act') {
        seenIdsRef.current.add(act.id)
        const levelMap: Record<string, LogRow['level']> = {
          think: 'think',
          tool: 'tool',
          content: 'content',
          stage: 'stage'
        }
        pushRow({
          id: act.id,
          ts,
          label: act.act,
          text: act.label ?? '',
          level: levelMap[act.act] ?? 'info'
        })
        actTextRef.current.set(act.id, act.label ?? '')
      } else if (act.type === 'ActDelta') {
        const prev = actTextRef.current.get(act.id) ?? ''
        const next = prev + act.text
        actTextRef.current.set(act.id, next)
        setFollowupRows((prevRows) =>
          prevRows.map((r) => (r.id === act.id ? { ...r, text: next } : r))
        )
      } else if (act.type === 'ActTool') {
        setFollowupRows((prevRows) =>
          prevRows.map((r) =>
            r.id === act.id
              ? { ...r, text: `${r.text}\n[args] ${safeJson(act.args)}` }
              : r
          )
        )
      } else if (act.type === 'ActResult') {
        setFollowupRows((prevRows) =>
          prevRows.map((r) =>
            r.id === act.id
              ? { ...r, text: `${r.text}\n[result] ${safeJson(act.result)}` }
              : r
          )
        )
      } else if (act.type === 'ActEnd') {
        setFollowupRows((prevRows) =>
          prevRows.map((r) =>
            r.id === act.id
              ? {
                  ...r,
                  text:
                    act.summary && act.summary !== r.text
                      ? `${r.text}\n[${act.status}] ${act.summary}`
                      : `${r.text}\n[${act.status}]`
                }
              : r
          )
        )
      }
    },
    []
  )

  const sendFollowup = useCallback(async () => {
    const msg = followupMsg.trim()
    if (!msg || followupRunning || !book) return
    setFollowupMsg('')
    setFollowupRunning(true)
    setFollowupRows([])
    actTextRef.current.clear()
    seenIdsRef.current.clear()

    try {
      const res = await dissectMessageStream(endpoint, token, book.id, msg)
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => res.statusText)
        throw new Error(text || `HTTP ${res.status}`)
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let completed = false

      const pushRow = (r: LogRow) =>
        setFollowupRows((prev) => [...prev, r])

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          try {
            const frame = JSON.parse(trimmed) as {
              event?: string
              activity?: ActivityEvent
              content?: string
              status?: BenchmarkStatus
            }
            const ev = frame.event
            const ts = Date.now()
            if (ev === 'RunStarted') {
              pushRow({ id: `rs-${ts}`, ts, label: 'RunStarted', text: '开始处理', level: 'info' })
            } else if (ev === 'RunError') {
              pushRow({ id: `re-${ts}`, ts, label: 'RunError', text: frame.content ?? '错误', level: 'error' })
            } else if (ev === 'RunCompleted') {
              completed = true
            } else if (ev === 'activity' && frame.activity) {
              handleFollowupActivity(frame.activity, ts, pushRow)
            }
          } catch {
            /* 单行 JSON 解析失败跳过 */
          }
        }
      }

      // 完成后刷新 entries(无论成功失败,都可能已有部分写入)
      if (completed) {
        const updated = await getBenchmark(endpoint, token, book.id)
        onBookChange(updated)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '发送失败')
    } finally {
      setFollowupRunning(false)
    }
  }, [
    followupMsg,
    followupRunning,
    book,
    endpoint,
    token,
    onBookChange,
    handleFollowupActivity
  ])
```

- [ ] **Step 4: 加命令栏 UI(在 Body div 之后、DialogContent 闭合之前)**

在 ResultBrowser 的 JSX 中,找到 `{/* Body */}` div 的闭合 `</div>`(约 970 行,`{tab === 'REVIEW' && ...}` 之后),在它之后、`</DialogContent>` 之前插入:

```tsx
        {/* Command bar(follow-up 微调) */}
        <div className="border-t border-overlay-10 px-6 py-3">
          {followupRunning && followupRows.length > 0 && (
            <FollowupActivityPanel rows={followupRows} />
          )}
          <div className="flex items-center gap-3">
            {followupRunning ? (
              <Loader2 className="size-4 shrink-0 animate-spin text-accent-primary" />
            ) : (
              <Sparkles className="size-4 shrink-0 text-accent-primary" />
            )}
            <input
              className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none disabled:opacity-50"
              placeholder="给拆解 agent 发指令…  如:补拆第 30 章 / 重写 PLOT / 删除重复素材"
              value={followupMsg}
              onChange={(e) => setFollowupMsg(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void sendFollowup()
                }
              }}
              disabled={followupRunning}
            />
            <button
              onClick={() => void sendFollowup()}
              disabled={followupRunning || !followupMsg.trim()}
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent-primary to-accent-violet text-text-primary disabled:opacity-40"
            >
              <ArrowUp className="size-4" />
            </button>
          </div>
        </div>
```

- [ ] **Step 5: 传 onBookChange prop 到 ResultBrowser**

在主组件的 `<ResultBrowser>` 调用处(约 397-401 行)加 `onBookChange`:

```tsx
      <ResultBrowser
        book={resultBook}
        onClose={() => setResultBook(null)}
        onRenameEntry={onRenameEntry}
        onBookChange={setResultBook}
      />
```

- [ ] **Step 6: typecheck**

Run: `cd /Users/taowen/project/narratox/agent-ui && pnpm typecheck`
Expected: PASS

- [ ] **Step 7: lint**

Run: `cd /Users/taowen/project/narratox/agent-ui && pnpm lint`
Expected: PASS(可能有 `safeJson` / `LogRow` 已定义无需新 import 的警告,不算错误)

- [ ] **Step 8: Commit**

```bash
cd /Users/taowen/project/narratox
git add agent-ui/src/components/dissect/DissectPage.tsx
git commit -m "feat(agent-ui): ResultBrowser 加 follow-up 命令栏 + 活动面板

弹窗底部加输入栏:Sparkles 图标 + placeholder + 渐变发送按钮。
执行态:Loader2 旋转 + FollowupActivityPanel 展示 think/tool/result 行。
完成后 getBenchmark 刷新 entries。复用 LogRow 模式 + handleActivity 逻辑。

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 9: 全量验证

- [ ] **Step 1: server typecheck + test**

Run: `cd /Users/taowen/project/narratox/server && pnpm typecheck && pnpm test`
Expected: 全部通过

- [ ] **Step 2: agent-ui typecheck + lint**

Run: `cd /Users/taowen/project/narratox/agent-ui && pnpm typecheck && pnpm lint`
Expected: 全部通过

- [ ] **Step 3: 手动验证启动**

Run: `cd /Users/taowen/project/narratox && pnpm dev`

验证步骤(在浏览器中):
1. 上传一本短书 → 点「开始拆解」→ 等待完成(DONE)
2. 打开拆解结果弹窗 → 底部应看到命令栏(Sparkles 图标 + placeholder)
3. 输入「重写 PLOT,补充第 20 章的伏笔」→ 点发送
4. 活动面板展开,显示 think/tool/content 帧
5. 完成后 PLOT 条目内容更新(不是新增重复条目)
6. 输入「删除最后一个素材」→ 素材 tab 少一条
7. 输入「补拆第 30 章」→ CHAPTER tab 多一条
8. RUNNING 中再次输入 → 应被拒(RunError 帧显示)

- [ ] **Step 4: 最终 Commit(如有手动验证修复)**

如果手动验证发现问题并修复,创建新 commit。否则跳过。
