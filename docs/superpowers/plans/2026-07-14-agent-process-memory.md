# 小说 agent 过程记忆 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 main agent 加一份 per-novel 过程记忆(规矩/经验/决策),main 每轮调 `update_memory` 整段重写,常驻注入 systemPrompt,压缩靠 main 推理 + 服务端截断兜底。

**Architecture:** 单表 `NovelProcessMemory`(1:1 Novel,三段 String)+ `ProcessMemoryService`(upsert/get)+ `update_memory` tool(只挂 main,闭包注入 userId/novelId)+ `ContextAssembler.forSession` 读记忆拼 slice 注入。零新中间件,复刻 `write_summary` 软强制模式。

**Tech Stack:** NestJS 11 + Prisma 7 + Jest + langchain tool(zod schema)。Spec: `docs/superpowers/specs/2026-07-14-agent-process-memory-design.md`。

---

## File Structure

**Create:**
- `server/src/memory/process-memory.service.ts` — upsert(merge+截断+ownership) + get(空态返 null)
- `server/src/memory/process-memory.service.spec.ts` — service 单测
- `server/src/agentos/tools/update-memory.tool.ts` — main 的过程记忆写入工具
- `server/src/agentos/tools/update-memory.tool.spec.ts` — 工具单测

**Modify:**
- `server/prisma/schema.prisma` — 加 `NovelProcessMemory` model + `Novel.processMemory` 反向关系
- `server/src/memory/memory.module.ts` — 注册 + 导出 ProcessMemoryService
- `server/src/agentos/agent-registry.ts` — `ToolDeps.processMemory` + `TOOL_REGISTRY['update_memory']`
- `server/src/agentos/agent-tree.config.ts` — `AGENT_TREE.tools` 加 `'update_memory'`
- `server/src/agentos/deep-agent.service.ts` — 构造注入 ProcessMemoryService + deps 传递
- `server/src/agentos/context-assembler.service.ts` — 注入 + forSession 拼 slice
- `server/src/agentos/context-assembler.service.spec.ts` — `make()` helper + 内联构造加第 4 参 stub
- `server/src/agentos/prompts/main.md` — 追加【本书过程记忆】维护节
- `server/src/agentos/agent-prompts.spec.ts` — substring 锁

---

### Task 1: Prisma schema + migration

**Files:**
- Modify: `server/prisma/schema.prisma`(Novel model ~line 86 加反向关系;文件末尾加新 model)

- [ ] **Step 1: 加 Novel 反向关系**

在 `server/prisma/schema.prisma` 的 `model Novel { ... }` 里,`voiceProfile` 行之后加:

```prisma
  processMemory  NovelProcessMemory?
```

- [ ] **Step 2: 文件末尾加 NovelProcessMemory model**

```prisma
/// per-novel 过程记忆:main 维护的规矩/经验/决策,常驻注入 systemPrompt。
model NovelProcessMemory {
  novelId    String   @id @unique
  novel      Novel    @relation(fields: [novelId], references: [id], onDelete: Cascade)
  rules      String   @default("")   // 【本书规矩】markdown
  lessons    String   @default("")   // 【经验教训】markdown
  decisions  String   @default("")   // 【近期决策】markdown,main 维护成 ≤10 条
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([novelId])
}
```

- [ ] **Step 3: migrate + 手动 generate(Prisma 7 坑)**

Run:
```bash
cd server && pnpm prisma migrate dev --name add_novel_process_memory
```
Expected: 生成新 migration SQL,含 `CREATE TABLE "NovelProcessMemory"`。

再手动 regenerate client(migrate dev 不会自动做):
```bash
cd server && pnpm prisma generate
```
Expected: `✔ Generated Prisma Client`.

- [ ] **Step 4: 确认 tsc 能看到新 model**

Run:
```bash
cd server && pnpm typecheck
```
Expected: PASS(此时还没有代码引用 `novelProcessMemory`,typecheck 不受影响,仅确认 schema 语法没错)。

- [ ] **Step 5: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/
git commit -m "feat(memory): add NovelProcessMemory model (per-novel process memory)"
```

---

### Task 2: ProcessMemoryService(TDD)

**Files:**
- Create: `server/src/memory/process-memory.service.spec.ts`
- Create: `server/src/memory/process-memory.service.ts`

- [ ] **Step 1: 写失败的单测**

创建 `server/src/memory/process-memory.service.spec.ts`:

```typescript
import {
  ProcessMemoryService,
  MEMORY_LIMITS,
} from './process-memory.service';
import type { PrismaService } from '../prisma/prisma.service';

interface PrismaMock {
  novel: { findFirst: jest.Mock };
  novelProcessMemory: { upsert: jest.Mock; findFirst: jest.Mock };
}
const makePrismaMock = (): PrismaMock => ({
  novel: { findFirst: jest.fn() },
  novelProcessMemory: { upsert: jest.fn(), findFirst: jest.fn() },
});

describe('ProcessMemoryService', () => {
  it('upsert: 只覆盖传了的段(undefined=保留原值)', async () => {
    const prisma = makePrismaMock();
    prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
    prisma.novelProcessMemory.upsert.mockResolvedValue({
      rules: '新规矩',
      lessons: '旧经验',
      decisions: '旧决策',
    });
    const svc = new ProcessMemoryService(prisma as unknown as PrismaService);
    const out = await svc.upsert('u1', 'n1', { rules: '新规矩' });
    expect(prisma.novelProcessMemory.upsert).toHaveBeenCalledWith({
      where: { novelId: 'n1' },
      create: { novelId: 'n1', rules: '新规矩' },
      update: { rules: '新规矩' },
    });
    expect(out).toEqual({
      rules: '新规矩',
      lessons: '旧经验',
      decisions: '旧决策',
    });
  });

  it('upsert: 空串=清空该段(主动删除)', async () => {
    const prisma = makePrismaMock();
    prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
    prisma.novelProcessMemory.upsert.mockResolvedValue({
      rules: '',
      lessons: '保留',
      decisions: '保留',
    });
    const svc = new ProcessMemoryService(prisma as unknown as PrismaService);
    await svc.upsert('u1', 'n1', { rules: '' });
    expect(prisma.novelProcessMemory.upsert).toHaveBeenCalledWith({
      where: { novelId: 'n1' },
      create: { novelId: 'n1', rules: '' },
      update: { rules: '' },
    });
  });

  it('upsert: 超长字段截断到 MEMORY_LIMITS', async () => {
    const prisma = makePrismaMock();
    prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
    prisma.novelProcessMemory.upsert.mockResolvedValue({
      rules: 'x'.repeat(MEMORY_LIMITS.rules),
      lessons: '',
      decisions: '',
    });
    const svc = new ProcessMemoryService(prisma as unknown as PrismaService);
    const longRules = 'x'.repeat(MEMORY_LIMITS.rules + 100);
    await svc.upsert('u1', 'n1', { rules: longRules });
    const call = prisma.novelProcessMemory.upsert.mock.calls[0][0];
    expect(call.update.rules.length).toBe(MEMORY_LIMITS.rules);
  });

  it('upsert: novel 不归属 user → 返回 null(越权)', async () => {
    const prisma = makePrismaMock();
    prisma.novel.findFirst.mockResolvedValue(null);
    const svc = new ProcessMemoryService(prisma as unknown as PrismaService);
    const out = await svc.upsert('u1', 'other-novel', { rules: 'x' });
    expect(out).toBeNull();
    expect(prisma.novelProcessMemory.upsert).not.toHaveBeenCalled();
  });

  it('get: 三段全空 → 返回 null', async () => {
    const prisma = makePrismaMock();
    prisma.novelProcessMemory.findFirst.mockResolvedValue({
      rules: '',
      lessons: '',
      decisions: '',
    });
    const svc = new ProcessMemoryService(prisma as unknown as PrismaService);
    const out = await svc.get('u1', 'n1');
    expect(out).toBeNull();
  });

  it('get: 任一段非空 → 返回三段', async () => {
    const prisma = makePrismaMock();
    prisma.novelProcessMemory.findFirst.mockResolvedValue({
      rules: '规矩',
      lessons: '',
      decisions: '决策',
    });
    const svc = new ProcessMemoryService(prisma as unknown as PrismaService);
    const out = await svc.get('u1', 'n1');
    expect(out).toEqual({ rules: '规矩', lessons: '', decisions: '决策' });
    expect(prisma.novelProcessMemory.findFirst).toHaveBeenCalledWith({
      where: { novelId: 'n1', novel: { userId: 'u1' } },
      select: { rules: true, lessons: true, decisions: true },
    });
  });

  it('get: 无行 → 返回 null', async () => {
    const prisma = makePrismaMock();
    prisma.novelProcessMemory.findFirst.mockResolvedValue(null);
    const svc = new ProcessMemoryService(prisma as unknown as PrismaService);
    const out = await svc.get('u1', 'n1');
    expect(out).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
cd server && pnpm test -- process-memory.service.spec.ts
```
Expected: FAIL(`Cannot find module './process-memory.service'`)。

- [ ] **Step 3: 写最小实现**

创建 `server/src/memory/process-memory.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** 三段字数上限(字符数)。超了服务端截断兜底 + warn。 */
export const MEMORY_LIMITS = {
  rules: 800,
  lessons: 800,
  decisions: 1200,
} as const;

export type MemorySection = 'rules' | 'lessons' | 'decisions';
export interface MemoryDoc {
  rules: string;
  lessons: string;
  decisions: string;
}
export type MemoryUpdate = Partial<Record<MemorySection, string>>;

/**
 * per-novel 过程记忆(规矩/经验/决策)。main 每轮调 update_memory 写;
 * ContextAssembler.forSession 读后常驻注入 main systemPrompt。
 *
 * upsert 字段语义:undefined=保留原值;""=清空该段(主动删除);非空字符串=设新值。
 * 超长截断 + warn(可观测 main 守不守纪律)。novel 不归属 user → 返 null(防越权)。
 */
@Injectable()
export class ProcessMemoryService {
  private readonly logger = new Logger('ProcessMemoryService');

  constructor(private readonly prisma: PrismaService) {}

  private truncate(section: MemorySection, value: string): string {
    const limit = MEMORY_LIMITS[section];
    if (value.length <= limit) return value;
    this.logger.warn(
      `${section} 超 ${limit} 字(${value.length}),已截断兜底 —— main 未守压缩纪律`,
    );
    return value.slice(0, limit);
  }

  async upsert(
    userId: string,
    novelId: string,
    partial: MemoryUpdate,
  ): Promise<MemoryDoc | null> {
    const owned = await this.prisma.novel.findFirst({
      where: { id: novelId, userId },
      select: { id: true },
    });
    if (!owned) return null;

    const updates: Record<string, string> = {};
    (['rules', 'lessons', 'decisions'] as MemorySection[]).forEach((sec) => {
      if (partial[sec] !== undefined) {
        updates[sec] = this.truncate(sec, partial[sec] as string);
      }
    });

    const row = await this.prisma.novelProcessMemory.upsert({
      where: { novelId },
      create: { novelId, ...updates },
      update: updates,
      select: { rules: true, lessons: true, decisions: true },
    });
    return row;
  }

  /** 三段全空或无行 → 返 null(调用方据此不注入 slice)。 */
  async get(userId: string, novelId: string): Promise<MemoryDoc | null> {
    const row = await this.prisma.novelProcessMemory.findFirst({
      where: { novelId, novel: { userId } },
      select: { rules: true, lessons: true, decisions: true },
    });
    if (!row) return null;
    if (!row.rules && !row.lessons && !row.decisions) return null;
    return row;
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
cd server && pnpm test -- process-memory.service.spec.ts
```
Expected: PASS(7 个 it 全过)。

- [ ] **Step 5: Commit**

```bash
git add server/src/memory/process-memory.service.ts server/src/memory/process-memory.service.spec.ts
git commit -m "feat(memory): ProcessMemoryService upsert/get with truncation + ownership scoping"
```

---

### Task 3: MemoryModule 注册

**Files:**
- Modify: `server/src/memory/memory.module.ts`

- [ ] **Step 1: 注册 + 导出 ProcessMemoryService**

把 `server/src/memory/memory.module.ts` 整文件改为:

```typescript
import { Module } from '@nestjs/common';
import { SummaryService } from './chapter-summary.service';
import { StoryEventService } from './story-event.service';
import { EventService } from './event.service';
import { ProcessMemoryService } from './process-memory.service';

@Module({
  providers: [SummaryService, StoryEventService, EventService, ProcessMemoryService],
  exports: [SummaryService, StoryEventService, EventService, ProcessMemoryService],
})
export class MemoryModule {}
```

- [ ] **Step 2: typecheck 确认**

Run:
```bash
cd server && pnpm typecheck
```
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add server/src/memory/memory.module.ts
git commit -m "feat(memory): register ProcessMemoryService in MemoryModule"
```

---

### Task 4: update_memory tool(TDD)

**Files:**
- Create: `server/src/agentos/tools/update-memory.tool.spec.ts`
- Create: `server/src/agentos/tools/update-memory.tool.ts`

- [ ] **Step 1: 写失败的工具单测**

创建 `server/src/agentos/tools/update-memory.tool.spec.ts`:

```typescript
import { makeUpdateMemoryTool } from './update-memory.tool';
import type { ProcessMemoryService } from '../../memory/process-memory.service';

interface InvokableTool {
  invoke: (input: unknown) => Promise<unknown>;
}
const invoke =
  (t: InvokableTool) =>
  (input: unknown): Promise<unknown> =>
    t.invoke(input);

const stubService = (result: unknown) =>
  ({ upsert: jest.fn().mockResolvedValue(result) }) as unknown as ProcessMemoryService;

describe('update_memory tool', () => {
  it('成功:传变化段 → 返回最新三段', async () => {
    const svc = stubService({
      rules: '新规矩',
      lessons: '旧经验',
      decisions: '旧决策',
    });
    const tool = makeUpdateMemoryTool({
      userId: 'u1',
      novelId: 'n1',
      processMemory: svc,
    });
    const out = (await invoke(tool)({ rules: '新规矩' })) as {
      ok: boolean;
      rules: string;
    };
    expect(svc.upsert).toHaveBeenCalledWith('u1', 'n1', { rules: '新规矩' });
    expect(out.ok).toBe(true);
    expect(out.rules).toBe('新规矩');
  });

  it('拒绝:三段全 undefined(至少一段必填)', async () => {
    const svc = stubService(null);
    const tool = makeUpdateMemoryTool({
      userId: 'u1',
      novelId: 'n1',
      processMemory: svc,
    });
    const out = (await invoke(tool)({})) as { ok: boolean; reason: string };
    expect(svc.upsert).not.toHaveBeenCalled();
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('no_fields');
  });

  it('越权:service 返 null → ok:false reason:denied', async () => {
    const svc = stubService(null);
    const tool = makeUpdateMemoryTool({
      userId: 'u1',
      novelId: 'other',
      processMemory: svc,
    });
    const out = (await invoke(tool)({ rules: 'x' })) as {
      ok: boolean;
      reason: string;
    };
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('denied');
  });

  it('空串=主动清空该段(透传给 service)', async () => {
    const svc = stubService({ rules: '', lessons: '', decisions: '' });
    const tool = makeUpdateMemoryTool({
      userId: 'u1',
      novelId: 'n1',
      processMemory: svc,
    });
    await invoke(tool)({ lessons: '' });
    expect(svc.upsert).toHaveBeenCalledWith('u1', 'n1', { lessons: '' });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run:
```bash
cd server && pnpm test -- update-memory.tool.spec.ts
```
Expected: FAIL(`Cannot find module './update-memory.tool'`)。

- [ ] **Step 3: 写工具实现**

创建 `server/src/agentos/tools/update-memory.tool.ts`:

```typescript
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { ProcessMemoryService } from '../../memory/process-memory.service';

/**
 * main 的过程记忆写入工具(只挂 main)。整段重写:main 传完整新内容,不是 append delta。
 * 字段语义:undefined=保留原值;""=清空该段;非空字符串=设新值。
 * userId/novelId 闭包注入(防越权,同所有现有工具)。
 */
export function makeUpdateMemoryTool({
  userId,
  novelId,
  processMemory,
}: {
  userId: string;
  novelId: string;
  processMemory: ProcessMemoryService;
}) {
  return tool(
    async ({ rules, lessons, decisions }) => {
      if (
        rules === undefined &&
        lessons === undefined &&
        decisions === undefined
      ) {
        return { ok: false as const, reason: 'no_fields' as const };
      }
      const result = await processMemory.upsert(userId, novelId, {
        rules,
        lessons,
        decisions,
      });
      if (!result) {
        return { ok: false as const, reason: 'denied' as const };
      }
      return { ok: true as const, ...result };
    },
    {
      name: 'update_memory',
      description:
        '更新本书过程记忆(规矩/经验/决策)。整段重写:把"现有内容(见上方注入)+ 本轮新增"合并压缩后传完整新内容,不要 append。字段语义:不传=保留原值;空串=清空该段;非空=设新值。各段字数上限:规矩/经验 ≤800 字、决策 ≤1200 字 —— 超了合并相似条目/淘汰过时条目/提炼更精炼表述,不要简单截断。【近期决策】超 10 条时把有长期价值的升段进【经验】再从决策段删。只传本轮有变化的段。本轮对话结束前必须调用一次。',
      schema: z.object({
        rules: z
          .string()
          .optional()
          .describe('【本书规矩】完整新内容(本书硬性写作要求,如"不用第一人称")'),
        lessons: z
          .string()
          .optional()
          .describe('【经验教训】完整新内容(提炼出的写作经验,如"本书偏好短章快节奏")'),
        decisions: z
          .string()
          .optional()
          .describe('【近期决策】完整新内容(最近重要决策/尝试,保持≤10条)'),
      }),
    },
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run:
```bash
cd server && pnpm test -- update-memory.tool.spec.ts
```
Expected: PASS(4 个 it 全过)。

- [ ] **Step 5: Commit**

```bash
git add server/src/agentos/tools/update-memory.tool.ts server/src/agentos/tools/update-memory.tool.spec.ts
git commit -m "feat(agentos): update_memory tool for main process memory (whole-section rewrite)"
```

---

### Task 5: TOOL_REGISTRY + ToolDeps wiring

**Files:**
- Modify: `server/src/agentos/agent-registry.ts`

- [ ] **Step 1: 加 import**

在 `server/src/agentos/agent-registry.ts` 顶部 import 区(其他 tool import 附近)加:

```typescript
import type { ProcessMemoryService } from '../memory/process-memory.service';
```

以及工具 import(放在其他 `make*Tool` import 之间,例如 `makeQueryMemoryTool` 那行后):

```typescript
import { makeUpdateMemoryTool } from './tools/update-memory.tool';
```

- [ ] **Step 2: ToolDeps 加 processMemory 字段**

在 `export interface ToolDeps { ... }` 里,`masterOutlines: MasterOutlineService;` 之后、`prisma: PrismaService;` 之前加:

```typescript
  processMemory: ProcessMemoryService;
```

- [ ] **Step 3: TOOL_REGISTRY 注册**

在 `export const TOOL_REGISTRY: Record<string, ToolFactory> = { ... }` 里加一条(放在 `query_memory` 注册之后):

```typescript
  update_memory: (d) =>
    makeUpdateMemoryTool({
      userId: d.userId,
      novelId: d.novelId,
      processMemory: d.processMemory,
    }),
```

- [ ] **Step 4: typecheck 确认(预期失败 —— deps 还没传)**

Run:
```bash
cd server && pnpm typecheck
```
Expected: 此处可能仍 PASS(typecheck 不验 deps 是否被填充,只验类型)。但 `deep-agent.service.ts` 构造的 `deps` 对象缺 `processMemory` 会在下一步修。先确认本文件无语法错。

- [ ] **Step 5: Commit**

```bash
git add server/src/agentos/agent-registry.ts
git commit -m "feat(agentos): register update_memory tool + add processMemory to ToolDeps"
```

---

### Task 6: AGENT_TREE main.tools 加 update_memory

**Files:**
- Modify: `server/src/agentos/agent-tree.config.ts`

- [ ] **Step 1: main.tools 数组加 'update_memory'**

在 `server/src/agentos/agent-tree.config.ts` 第 81-120 行的 `AGENT_TREE.tools` 数组里,在 `'query_memory'`(第 116 行)之后加一行:

```typescript
    'update_memory',
```

(放在 query_memory 后,语义相近:都是 main 的记忆类工具。)

- [ ] **Step 2: 跑 agent-tree groups spec 确认不破**

Run:
```bash
cd server && pnpm test -- agent-tree.groups.spec.ts
```
Expected: PASS(该 spec 不锁 tools 数组长度,只锁分组结构;若锁了长度,更新预期值)。

- [ ] **Step 3: Commit**

```bash
git add server/src/agentos/agent-tree.config.ts
git commit -m "feat(agentos): add update_memory to main tools"
```

---

### Task 7: DeepAgentService 注入 ProcessMemoryService + deps 传递

**Files:**
- Modify: `server/src/agentos/deep-agent.service.ts`

- [ ] **Step 1: 加 import**

在 `server/src/agentos/deep-agent.service.ts` 顶部服务 import 区(其他 `../memory/*` import 附近,如 `EventService` 那行后)加:

```typescript
import { ProcessMemoryService } from '../memory/process-memory.service';
```

- [ ] **Step 2: 构造函数注入**

在 `constructor(...)` 参数列表里,`@Inject(CHECKPOINTER)` 之前加(在 `benchmark: BenchmarkService,` 之后,保持服务注入的顺序整齐):

```typescript
    private readonly processMemory: ProcessMemoryService,
```

- [ ] **Step 3: deps 对象传递**

在 `buildAgentGraph` 方法的 `const deps: ToolDeps = { ... }` 对象里(约第 461-480 行),加一行(`prisma: this.prisma,` 之前或之后均可):

```typescript
      processMemory: this.processMemory,
```

- [ ] **Step 4: typecheck 确认**

Run:
```bash
cd server && pnpm typecheck
```
Expected: PASS(现在 ToolDeps.processMemory 已被填充)。

- [ ] **Step 5: 跑 deep-agent 相关 spec 确认构造不破**

Run:
```bash
cd server && pnpm test -- deep-agent
```
Expected: PASS。若 spec 里手工 `new DeepAgentService(...)` 缺新参数,补一个 stub(`{} as never`)。

- [ ] **Step 6: Commit**

```bash
git add server/src/agentos/deep-agent.service.ts
git commit -m "feat(agentos): inject ProcessMemoryService into DeepAgentService + wire to ToolDeps"
```

---

### Task 8: ContextAssembler 注入过程记忆 slice(TDD)

**Files:**
- Modify: `server/src/agentos/context-assembler.service.spec.ts`
- Modify: `server/src/agentos/context-assembler.service.ts`

- [ ] **Step 1: 更新 spec 的 make() helper + 加新测试**

在 `server/src/agentos/context-assembler.service.spec.ts` 顶部 stub 区,加 processMemory stub:

```typescript
import type { ProcessMemoryService } from '../memory/process-memory.service';
// ... 既有 import
const stubProcessMemory = {
  get: jest.fn().mockResolvedValue(null),
} as unknown as ProcessMemoryService;
```

把 `make` 工厂改为接收第 4 参(默认用 stub):

```typescript
const make = (
  prisma: unknown,
  processMemory: ProcessMemoryService = stubProcessMemory,
) =>
  new ContextAssembler(
    prisma as PrismaService,
    stubStatusService,
    stubMasterOutlines,
    processMemory,
  );
```

把第 176-182 行内联 `new ContextAssembler(...)` 调用(那个带 statusService/masterOutlines 的)补第 4 参 stubProcessMemory:

```typescript
      const svc = new ContextAssembler(
        {
          novel: { findFirst: jest.fn().mockResolvedValue(novelRow()) },
        } as unknown as PrismaService,
        statusService,
        masterOutlines,
        stubProcessMemory,
      );
```

在 `describe('forSession', ...)` 末尾加新 it:

```typescript
    it('注入【本书过程记忆】slice 当记忆非空', async () => {
      const processMemory = {
        get: jest.fn().mockResolvedValue({
          rules: '不用第一人称',
          lessons: '短章快节奏',
          decisions: '第15章主角调硬',
        }),
      } as unknown as ProcessMemoryService;
      const svc = new ContextAssembler(
        { novel: { findFirst: jest.fn().mockResolvedValue(novelRow()) } } as unknown as PrismaService,
        stubStatusService,
        stubMasterOutlines,
        processMemory,
      );
      const { prompt } = await svc.forSession('u1', 's-mem');
      expect(prompt).toContain('【本书过程记忆】');
      expect(prompt).toContain('不用第一人称');
      expect(prompt).toContain('短章快节奏');
      expect(prompt).toContain('第15章主角调硬');
    });

    it('记忆为空/null → 不注入【本书过程记忆】', async () => {
      const processMemory = {
        get: jest.fn().mockResolvedValue(null),
      } as unknown as ProcessMemoryService;
      const svc = make({}, processMemory);
      const { prompt } = await svc.forSession('u1', 's-empty');
      expect(prompt).not.toContain('【本书过程记忆】');
    });
```

- [ ] **Step 2: 跑 spec 确认新测试失败**

Run:
```bash
cd server && pnpm test -- context-assembler.service.spec.ts
```
Expected: FAIL(新 it 报 `processMemory.get is not a function` 或构造参数数量不符;旧 it 因 `make()` 默认 stub 仍过)。

- [ ] **Step 3: 改 ContextAssembler 实现**

`server/src/agentos/context-assembler.service.ts`:

顶部 import 区加:
```typescript
import { ProcessMemoryService } from '../memory/process-memory.service';
```

构造函数加第 4 参:
```typescript
  constructor(
    private readonly prisma: PrismaService,
    private readonly statusService: StatusService,
    private readonly masterOutlines: MasterOutlineService,
    private readonly processMemory: ProcessMemoryService,
  ) {}
```

在 `forSession` 方法里,`const masterSlice = buildMasterOutlineSlice(master as never);` 之后、`const slices: string[] = [];` 之后,加读取 + 拼 slice:

```typescript
    const mem = await this.processMemory.get(userId, novel.id);
    const memSlice = mem
      ? `【本书过程记忆】（main 维护,每轮 update_memory 更新;写作遵守规矩段,参考经验段）\n【规矩】${mem.rules}\n【经验】${mem.lessons}\n【近期决策】${mem.decisions}`
      : null;
```

在 `if (masterSlice) slices.push(masterSlice);` 之后加:
```typescript
    if (memSlice) slices.push(memSlice);
```

(顺序:masterSlice → memSlice → 【小说态势】,与 spec 一致;memSlice 放态势前,因为它更静态。)

- [ ] **Step 4: 跑 spec 确认全过**

Run:
```bash
cd server && pnpm test -- context-assembler.service.spec.ts
```
Expected: PASS(全部 it,含两个新 it)。

- [ ] **Step 5: Commit**

```bash
git add server/src/agentos/context-assembler.service.ts server/src/agentos/context-assembler.service.spec.ts
git commit -m "feat(agentos): inject per-novel process memory slice into main systemPrompt"
```

---

### Task 9: main.md prompt + spec substring 锁

**Files:**
- Modify: `server/src/agentos/prompts/main.md`
- Modify: `server/src/agentos/agent-prompts.spec.ts`

- [ ] **Step 1: main.md 追加维护节**

在 `server/src/agentos/prompts/main.md` 文件末尾追加:

```markdown

## 【本书过程记忆】维护

你有一份 per-novel 过程记忆(见上方注入的【本书过程记忆】段,若尚未建立则注入不出现),三段:
- 【规矩】本书硬性写作要求(作者明确给过的指令,如"不用第一人称""反派不洗白")。
- 【经验】提炼出的写作经验(如"本书读者偏好短章快节奏""多线叙事在此书水土不服")。
- 【近期决策】最近重要的写作决策/尝试(≤10 条,如"第15章把主角性格调硬")。

维护规则:
- **本轮对话结束前必须调用 update_memory**(即使本轮没新内容,也要判断旧内容是否需压缩)。
- 更新某段前,先看上方注入的现有内容;把"现有 + 本轮新增"合并压缩后,传完整新内容(整段重写,不 append)。
- 各段有字数上限(规矩/经验 ≤800 字,决策 ≤1200 字),超了就合并相似条目 / 淘汰过时条目 / 提炼更精炼表述 —— 不要简单截断丢信息。
- 【近期决策】超 10 条时,把有长期价值的升段进【经验】,再从决策段删;纯过时的直接删。
- 只传本轮有变化的段(不传=保留原值);某段要清空就传空串。
- 规矩段是给 writer 的硬约束 —— 委派 chapter 写章时,在 task 消息里把相关规矩显式带给 writer。
```

- [ ] **Step 2: agent-prompts.spec.ts 加 substring 锁**

在 `server/src/agentos/agent-prompts.spec.ts` 的 `describe(...)` 块末尾加一个 it(找现有的 substring 断言模式,在其后追加):

```typescript
  it('MAIN_AGENT_PROMPT 锁 update_memory 维护节', () => {
    expect(MAIN_AGENT_PROMPT).toContain('必须调用 update_memory');
    expect(MAIN_AGENT_PROMPT).toContain('【本书过程记忆】');
  });
```

- [ ] **Step 3: 跑 prompt spec 确认通过**

Run:
```bash
cd server && pnpm test -- agent-prompts.spec.ts
```
Expected: PASS(prompt loader 读到新追加节,substring 命中)。

- [ ] **Step 4: Commit**

```bash
git add server/src/agentos/prompts/main.md server/src/agentos/agent-prompts.spec.ts
git commit -m "feat(prompts): main.md add process-memory maintenance section + spec lock"
```

---

### Task 10: 全量回归 + typecheck

**Files:**
- 无新改动(验证步骤)

- [ ] **Step 1: typecheck**

Run:
```bash
cd server && pnpm typecheck
```
Expected: PASS。

- [ ] **Step 2: 全量 jest**

Run:
```bash
cd server && pnpm test
```
Expected: PASS(无回归。重点看:agent-tree.groups / deep-agent.override / context-assembler / agent-prompts / 新两个 spec)。

- [ ] **Step 3: lint + format**

Run:
```bash
cd server && pnpm lint && pnpm format
```
Expected: PASS(若 format 改了文件,补一个 `git add -A && git commit -m "style: prettier"` )。

- [ ] **Step 4: 手动集成验证(可选但推荐)**

启动 dev server(`cd server && PORT=3001 pnpm start:dev`),用 agent-ui 或 curl 对一本已有小说发起一轮对话,然后:

```bash
# 确认记忆行被创建
psql $DATABASE_URL -c "SELECT novel_id, left(rules,40), left(lessons,40), left(decisions,40), updated_at FROM public.\"NovelProcessMemory\";"
```
Expected: 至少一行,updatedAt 为本轮时间。

再发起第二轮对话,在 server 日志里 grep systemPrompt(或临时 logger)确认含【本书过程记忆】。

- [ ] **Step 5: 最终 commit(若 format 有改动)**

```bash
git status
# 若有未提交的 format 改动:
git add -A && git commit -m "style: prettier after process-memory feature"
```

---

## Self-Review 记录(写完后跑过一遍)

**Spec 覆盖**:schema(T1)✓ / service upsert+get+截断+ownership(T2)✓ / module(T3)✓ / tool 闭包+至少一段必填+空串清空(T4)✓ / TOOL_REGISTRY+ToolDeps(T5)✓ / AGENT_TREE main.tools(T6)✓ / DeepAgentService 注入+deps(T7)✓ / ContextAssembler 注入+空态(T8)✓ / main.md+spec 锁(T9)✓ / 回归(T10)✓。三段压缩策略在 T9 prompt + T4 工具 description + T2 截断兜底三处覆盖。

**Placeholder**:无 TBD/TODO;每个 code step 含完整代码。

**Type 一致性**:`ProcessMemoryService.upsert` 返 `MemoryDoc | null` → tool 消费 `result` 判 null;`get` 返 `MemoryDoc | null` → ContextAssembler 消费 `mem` 判 null;`MemoryUpdate = Partial<Record<MemorySection,string>>` 在 service/tool 一致;`MEMORY_LIMITS` 键名 rules/lessons/decisions 全链路一致。

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-14-agent-process-memory.md`. Two execution options:

1. **Subagent-Driven (recommended)** — 每个 Task 派一个 fresh subagent,任务间我做 review,快速迭代。
2. **Inline Execution** — 在本会话里按 executing-plans 批量执行,带 checkpoint 审查。

选哪种?
