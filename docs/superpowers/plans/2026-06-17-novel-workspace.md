# narratox 小说工作台 (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 narratox 从通用 chat 演化为「以小说为中心、聊天驱动写作、资源可插拔」的工作台 —— Phase 1 跑通最小可写闭环：小说库 → 新建小说 → 工作台(聊天提案 → 采纳落章) → 配置页。

**Architecture:** 复用 v0.1.0 全部聊天基建(`Session`/`Message`/流式/LangGraph checkpointer/鉴权)。新增 `Novel`(1:1 复用 `Session` 作聊天线程)与 `Chapter`(稿件)。写入走统一 **mutation 层** `{resource, targetId, op, content}`(P1 只实现 `chapter`);新增 `ContextAssembler` 按小说设定组装 system prompt 喂写作 Agent。前端三栏:左=资源导航 / 中=聊天(恒定) / 右=选中项详情。

**Tech Stack:** 后端 NestJS 11 + Prisma 7 + PostgreSQL + jest(`--experimental-vm-modules`)。前端 Next.js 15 (App Router) + Zustand + nuqs + shadcn/ui(**无测试运行器**，质量门为 `pnpm validate` = lint+format+typecheck)。

**Spec:** [docs/superpowers/specs/2026-06-17-novel-workspace-design.md](../specs/2026-06-17-novel-workspace-design.md)
**Branch:** `feat/novel-workspace` (已建)。

---

## 约定

- **后端任务(TDD)：** 先写失败测试 → 跑测试见失败 → 最小实现 → 跑测试通过 → commit。Prisma 用 typed mock(见 `sessions.service.spec.ts` 的 `makePrismaMock` 模式)。所有命令在 `server/` 下用 `pnpm --dir server <cmd>` 或 `cd server && <cmd>`。
- **前端任务(无单测)：** 实现 → `pnpm --dir agent-ui typecheck` → `pnpm --dir agent-ui validate` → commit。前端没有 jest/vitest，**不要**新增测试框架(YAGNI)。
- **每任务一次 commit**，conventional commits，结尾加 `Co-Authored-By: Claude <noreply@anthropic.com>`。
- **鉴权：** 所有新端点默认受全局 `JwtAuthGuard` 保护，用 `@CurrentUser() user: RequestUser` 取用户、按 `user.id` 隔离。
- **环境：** `server/.env` 已有 `DATABASE_URL` / `JWT_SECRET` / `ZHIPUAI_API_KEY`(gitignored，绝不提交)。

## File Structure

**后端(server/src/)新增**
- `resources/mutation.types.ts` — mutation 接口类型(ResourceType/MutationOp/ResourceMutation/ResourceHandler)
- `resources/resource-registry.ts` + `resource-registry.spec.ts` — handler 注册 + 统一分发
- `novel/dto/create-novel.dto.ts` / `update-novel.dto.ts` / `create-chapter.dto.ts` / `accept.dto.ts`
- `novel/novel.service.ts` + `novel.service.spec.ts` — 小说 CRUD + accept(委托 registry)
- `novel/chapter.service.ts` + `chapter.service.spec.ts` — 章节 CRUD + `ChapterHandler`(implements ResourceHandler)
- `novel/novel.controller.ts` + `novel.controller.spec.ts` — `/novels` 端点
- `novel/novel.module.ts` — 装配
- `agentos/context-assembler.service.ts` + `context-assembler.service.spec.ts` — 按小说拼 system prompt
- 改：`agentos/deep-agent.service.ts`(+spec) — streamTurn 接 systemPrompt，按 prompt 缓存 agent
- 改：`agentos/agentos.controller.ts`(+spec) — 注入 ContextAssembler
- 改：`prisma/schema.prisma` — Novel/Chapter/ChapterStatus + Session/User 反向关系
- 改：`app.module.ts` — 导入 NovelModule

**前端(agent-ui/src/)新增/改**
- `types/novel.ts` — Novel/Chapter/NovelSettings 类型
- `api/novels.ts` — novel/chapter/accept API client
- `api/routes.ts`(改) — 加 novel 路由
- `app/page.tsx`(改) — 落地为「小说库」
- `app/novels/[id]/page.tsx`(新) — 工作台
- `app/settings/page.tsx`(新) — 配置页
- `components/library/NovelLibrary.tsx` / `NovelCard.tsx` / `NewNovelForm.tsx`(新)
- `components/workspace/Workspace.tsx` / `ResourceNav.tsx` / `ChatPanel.tsx` / `ChapterDetail.tsx`(新)
- `components/chat/ChatArea/Messages/Messages.tsx`(改) — 可选 `onAccept` 渲染「采纳」按钮

---

# M0 · 数据模型 + 写入层 + 小说/章节端点

## Task 1: Prisma schema — Novel / Chapter / ChapterStatus + 反向关系

**Files:**
- Modify: `server/prisma/schema.prisma`

- [ ] **Step 1: 改 schema**

在 `User` model 内加反向关系:
```prisma
  novels Novel[]
```
在 `Session` model 内加反向关系:
```prisma
  novel  Novel?
```
新增 model 与 enum(放文件末尾):
```prisma
model Novel {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  sessionId String   @unique
  session   Session  @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  title     String
  genre     String?
  synopsis  String?
  settings  Json     @default("{}")
  createdAt DateTime @default(now())
  updatedAt DateTime @default(now())
  chapters  Chapter[]

  @@index([userId, updatedAt])
}

model Chapter {
  id        String        @id @default(cuid())
  novelId   String
  novel     Novel         @relation(fields: [novelId], references: [id], onDelete: Cascade)
  order     Int
  title     String
  content   String        @default("")
  status    ChapterStatus @default(DRAFT)
  createdAt DateTime      @default(now())
  updatedAt DateTime      @default(now())

  @@unique([novelId, order])
  @@index([novelId, order])
}

enum ChapterStatus {
  DRAFT
  COMMITTED
}
```

- [ ] **Step 2: 生成迁移**

Run: `cd server && pnpm prisma migrate dev --name novel_workspace`
Expected: 迁移创建成功，`prisma/migrations/<ts>_novel_workspace/migration.sql` 生成，`prisma generate` 自动跑。
> 若报 drift(LangGraph checkpoint 表未纳管)，先 `pnpm prisma migrate dev --create-only` 检查 SQL；确实需要重置才 `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION='可以' pnpm prisma migrate reset`(会清库，需用户同意)。

- [ ] **Step 3: 验证 client 类型生成**

Run: `cd server && pnpm prisma generate && pnpm typecheck` (typecheck 全过即可；本任务不写单测，模型由后续 service 测试覆盖)
Expected: 无 Prisma 类型错误。

- [ ] **Step 4: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations
git commit -m "feat(server): add Novel/Chapter models + ChapterStatus enum

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: Mutation 类型 + ResourceRegistry(TDD)

**Files:**
- Create: `server/src/resources/mutation.types.ts`
- Create: `server/src/resources/resource-registry.ts`
- Test: `server/src/resources/resource-registry.spec.ts`

- [ ] **Step 1: 写类型**

`server/src/resources/mutation.types.ts`:
```ts
/**
 * 统一写入层(mutation)。Phase 1 只实现 'chapter'；Phase 2+ 加 'outline' | 'character'
 * | 'worldview' | 'status'。新增资源 = 注册一个 ResourceHandler，不改调用方。
 */
export type ResourceType = 'chapter';
export type MutationOp = 'set' | 'append' | 'patch';

export interface ResourceMutation {
  resource: ResourceType;
  targetId: string;
  op: MutationOp;
  content: string;
}

export interface ResourceHandler {
  readonly resource: ResourceType;
  apply(userId: string, mutation: ResourceMutation): Promise<void>;
}
```

- [ ] **Step 2: 写失败测试**

`server/src/resources/resource-registry.spec.ts`:
```ts
import { ResourceRegistry } from './resource-registry';
import type { ResourceHandler, ResourceMutation } from './mutation.types';

describe('ResourceRegistry', () => {
  it('dispatches a mutation to the registered handler', async () => {
    const registry = new ResourceRegistry();
    const apply = jest.fn().mockResolvedValue(undefined);
    const handler: ResourceHandler = { resource: 'chapter', apply };
    registry.register(handler);

    const mutation: ResourceMutation = {
      resource: 'chapter',
      targetId: 'c1',
      op: 'append',
      content: 'hi',
    };
    await registry.dispatch('u1', mutation);

    expect(apply).toHaveBeenCalledWith('u1', mutation);
  });

  it('throws on an unknown resource (no handler registered)', async () => {
    const registry = new ResourceRegistry();
    await expect(
      registry.dispatch('u1', {
        resource: 'chapter',
        targetId: 'c1',
        op: 'set',
        content: 'x',
      }),
    ).rejects.toThrow(/No handler for resource: chapter/);
  });
});
```

- [ ] **Step 3: 跑测试见失败**

Run: `cd server && pnpm test -- resource-registry.spec.ts`
Expected: FAIL — `ResourceRegistry is not defined`(模块还没建)。

- [ ] **Step 4: 写实现**

`server/src/resources/resource-registry.ts`:
```ts
import { Injectable } from '@nestjs/common';
import type { ResourceHandler, ResourceMutation } from './mutation.types';

@Injectable()
export class ResourceRegistry {
  private readonly handlers = new Map<string, ResourceHandler>();

  register(handler: ResourceHandler): void {
    this.handlers.set(handler.resource, handler);
  }

  async dispatch(userId: string, mutation: ResourceMutation): Promise<void> {
    const handler = this.handlers.get(mutation.resource);
    if (!handler) {
      throw new Error(`No handler for resource: ${mutation.resource}`);
    }
    await handler.apply(userId, mutation);
  }
}
```

- [ ] **Step 5: 跑测试通过**

Run: `cd server && pnpm test -- resource-registry.spec.ts`
Expected: PASS(2 个用例)。

- [ ] **Step 6: Commit**

```bash
git add server/src/resources
git commit -m "feat(server): uniform mutation layer (types + ResourceRegistry)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: Novel / Chapter / Accept DTOs

**Files:**
- Create: `server/src/novel/dto/create-novel.dto.ts`
- Create: `server/src/novel/dto/update-novel.dto.ts`
- Create: `server/src/novel/dto/create-chapter.dto.ts`
- Create: `server/src/novel/dto/accept.dto.ts`

- [ ] **Step 1: 写 DTOs**

`server/src/novel/dto/create-novel.dto.ts`:
```ts
import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateNovelDto {
  @IsString()
  @MaxLength(120)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  genre?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  synopsis?: string;

  /** 写作设定: { style?, language?, chapterWordTarget?, worldviewText? } */
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}
```

`server/src/novel/dto/update-novel.dto.ts`:
```ts
import { PartialType } from '@nestjs/mapped-types';
import { CreateNovelDto } from './create-novel.dto';

export class UpdateNovelDto extends PartialType(CreateNovelDto) {}
```

`server/src/novel/dto/create-chapter.dto.ts`:
```ts
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateChapterDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;
}
```

`server/src/novel/dto/accept.dto.ts`:
```ts
import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class AcceptDto {
  @IsString()
  @IsNotEmpty()
  chapterId!: string;

  /** 'append' = 接着写(追加到本章末尾);'set' = 重写本章 */
  @IsIn(['set', 'append'])
  op!: 'set' | 'append';

  @IsString()
  @IsNotEmpty()
  content!: string;
}
```

- [ ] **Step 2: typecheck**

Run: `cd server && pnpm typecheck`
Expected: 通过(DTO 尚未被引用，但类型合法)。

- [ ] **Step 3: Commit**

```bash
git add server/src/novel/dto
git commit -m "feat(server): novel/chapter/accept DTOs

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: ChapterService + ChapterHandler(TDD)

**Files:**
- Create: `server/src/novel/chapter.service.ts`
- Test: `server/src/novel/chapter.service.spec.ts`

`ChapterService` 提供章节 CRUD；`ChapterHandler` 实现 `ResourceHandler`(`apply` 做 append/set 写正文 + 置 `COMMITTED`)。两者都按 `userId` 隔离。

- [ ] **Step 1: 写失败测试**

`server/src/novel/chapter.service.spec.ts`:
```ts
import { ChapterService, ChapterHandler } from './chapter.service';
import type { PrismaService } from '../prisma/prisma.service';
import { AGENT_ID } from '../agentos/agentos.constants';

interface PrismaMock {
  novel: { findFirst: jest.Mock };
  chapter: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    aggregate: jest.Mock;
  };
}
function makePrismaMock(): PrismaMock {
  return {
    novel: { findFirst: jest.fn() },
    chapter: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      aggregate: jest.fn(),
    },
  };
}
const EPOCH = new Date('2026-01-01T00:00:00.000Z');

describe('ChapterService', () => {
  describe('list', () => {
    it('returns chapters ordered by `order`, only if novel is owned', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.chapter.findMany.mockResolvedValue([
        { id: 'c1', order: 1, title: '一', content: 'a', status: 'DRAFT' },
      ]);
      const svc = new ChapterService(prisma as unknown as PrismaService);

      const result = await svc.list('u1', 'n1');

      expect(prisma.novel.findFirst).toHaveBeenCalledWith({
        where: { id: 'n1', userId: 'u1' },
      });
      expect(prisma.chapter.findMany).toHaveBeenCalledWith({
        where: { novelId: 'n1' },
        orderBy: { order: 'asc' },
      });
      expect(result).toHaveLength(1);
    });

    it('throws 404 when novel is not owned', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue(null);
      const svc = new ChapterService(prisma as unknown as PrismaService);
      await expect(svc.list('u1', 'n1')).rejects.toThrow();
    });
  });

  describe('create', () => {
    it('creates a chapter with order = max+1', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.chapter.aggregate.mockResolvedValue({ _max: { order: 2 } });
      prisma.chapter.create.mockResolvedValue({ id: 'c3', order: 3 });
      const svc = new ChapterService(prisma as unknown as PrismaService);

      await svc.create('u1', 'n1', { title: '第三章' });

      expect(prisma.chapter.create).toHaveBeenCalledWith({
        data: { novelId: 'n1', order: 3, title: '第三章' },
      });
    });

    it('starts at order 1 when no chapters exist', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      prisma.chapter.aggregate.mockResolvedValue({ _max: { order: null } });
      prisma.chapter.create.mockResolvedValue({ id: 'c1', order: 1 });
      const svc = new ChapterService(prisma as unknown as PrismaService);

      await svc.create('u1', 'n1', {});

      expect(prisma.chapter.create).toHaveBeenCalledWith({
        data: { novelId: 'n1', order: 1, title: '新章节' },
      });
    });
  });
});

describe('ChapterHandler', () => {
  it("append concatenates onto the chapter's content and sets COMMITTED", async () => {
    const prisma = makePrismaMock();
    prisma.chapter.findFirst.mockResolvedValue({
      id: 'c1',
      novelId: 'n1',
      content: '旧',
      novel: { userId: 'u1' },
    });
    const handler = new ChapterHandler(prisma as unknown as PrismaService);

    await handler.apply('u1', {
      resource: 'chapter',
      targetId: 'c1',
      op: 'append',
      content: '新',
    });

    expect(prisma.chapter.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: expect.objectContaining({
        content: '旧新',
        status: 'COMMITTED',
      }),
    });
  });

  it('set replaces content and sets COMMITTED', async () => {
    const prisma = makePrismaMock();
    prisma.chapter.findFirst.mockResolvedValue({
      id: 'c1',
      novelId: 'n1',
      content: '旧',
      novel: { userId: 'u1' },
    });
    const handler = new ChapterHandler(prisma as unknown as PrismaService);

    await handler.apply('u1', {
      resource: 'chapter',
      targetId: 'c1',
      op: 'set',
      content: '全新',
    });

    expect(prisma.chapter.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: expect.objectContaining({ content: '全新', status: 'COMMITTED' }),
    });
  });

  it('is a no-op when the chapter is not owned by the user', async () => {
    const prisma = makePrismaMock();
    prisma.chapter.findFirst.mockResolvedValue(null);
    const handler = new ChapterHandler(prisma as unknown as PrismaService);

    await handler.apply('u1', {
      resource: 'chapter',
      targetId: 'c1',
      op: 'set',
      content: 'x',
    });

    expect(prisma.chapter.update).not.toHaveBeenCalled();
  });

  it('registers itself as the chapter handler', () => {
    expect(new ChapterHandler(makePrismaMock() as unknown as PrismaService).resource)
      .toBe('chapter');
  });
});

// silence unused import in some tsconfigs
void AGENT_ID;
void EPOCH;
```

- [ ] **Step 2: 跑测试见失败**

Run: `cd server && pnpm test -- chapter.service.spec.ts`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 写实现**

`server/src/novel/chapter.service.ts`:
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import {
  ResourceHandler,
  type ResourceMutation,
} from '../resources/mutation.types';

/** 章节名缺省值。 */
const DEFAULT_CHAPTER_TITLE = '新章节';

@Injectable()
export class ChapterService {
  constructor(private readonly prisma: PrismaService) {}

  /** 列出小说的章节(仅当小说归属本用户)，按 order 升序。 */
  async list(userId: string, novelId: string) {
    await this.assertOwned(userId, novelId);
    return this.prisma.chapter.findMany({
      where: { novelId },
      orderBy: { order: 'asc' },
    });
  }

  /** 新建一章，order = 当前最大 order + 1。 */
  async create(
    userId: string,
    novelId: string,
    dto: { title?: string },
  ) {
    await this.assertOwned(userId, novelId);
    const max = await this.prisma.chapter.aggregate({
      where: { novelId },
      _max: { order: true },
    });
    const nextOrder = (max._max.order ?? 0) + 1;
    return this.prisma.chapter.create({
      data: {
        novelId,
        order: nextOrder,
        title: dto.title?.trim() || `第${nextOrder}章`,
      },
    });
  }

  private async assertOwned(userId: string, novelId: string): Promise<void> {
    const owned = await this.prisma.novel.findFirst({
      where: { id: novelId, userId },
      select: { id: true },
    });
    if (!owned) throw new NotFoundException('Novel not found');
  }
}

/**
 * mutation 层的 chapter handler:「采纳」把内容写入章节正文并置 COMMITTED。
 * 按 userId 隔离(findFirst 带 novel.userId)，所以无论是「采纳」UI 还是未来的
 * agent 工具调用，都走同一套所有权校验。
 */
@Injectable()
export class ChapterHandler implements ResourceHandler {
  readonly resource = 'chapter';
  constructor(private readonly prisma: PrismaService) {}

  async apply(userId: string, mutation: ResourceMutation): Promise<void> {
    // 连带取出 novel 以校验归属;不归属本用户(或不存在)→ no-op。
    const chapter = await this.prisma.chapter.findFirst({
      where: { id: mutation.targetId, novel: { userId } },
      select: { id: true, content: true },
    });
    if (!chapter) return;

    const content =
      mutation.op === 'append'
        ? (chapter.content ?? '') + mutation.content
        : mutation.content;

    await this.prisma.chapter.update({
      where: { id: chapter.id },
      data: { content, status: 'COMMITTED' },
    });
  }
}
```

- [ ] **Step 4: 跑测试通过**

Run: `cd server && pnpm test -- chapter.service.spec.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add server/src/novel/chapter.service.ts server/src/novel/chapter.service.spec.ts
git commit -m "feat(server): ChapterService CRUD + ChapterHandler (mutation layer)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: NovelService(TDD)

**Files:**
- Create: `server/src/novel/novel.service.ts`
- Test: `server/src/novel/novel.service.spec.ts`

`create` 在事务里先建 `Session`(randomUUID 作 id) 再建 `Novel`(1:1)，并种第一章。`accept` 委托 `ResourceRegistry`。

- [ ] **Step 1: 写失败测试**

`server/src/novel/novel.service.spec.ts`:
```ts
import { NovelService } from './novel.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { ResourceRegistry } from '../resources/resource-registry';

interface PrismaMock {
  novel: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    deleteMany: jest.Mock;
  };
  session: { create: jest.Mock };
  $transaction: jest.Mock;
}
function makePrismaMock(): PrismaMock {
  return {
    novel: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    session: { create: jest.fn() },
    $transaction: jest.fn(),
  };
}

describe('NovelService', () => {
  describe('create', () => {
    it('creates a session + novel (+ seed chapter) in a transaction', async () => {
      const prisma = makePrismaMock();
      const tx = {
        session: { create: jest.fn().mockResolvedValue({ id: 's1' }) },
        novel: {
          create: jest.fn().mockResolvedValue({ id: 'n1', sessionId: 's1' }),
        },
      };
      prisma.$transaction.mockImplementation(async (fn) => fn(tx));
      const svc = new NovelService(prisma as unknown as PrismaService);

      const result = await svc.create('u1', {
        title: '我的书',
        genre: '玄幻',
        synopsis: '一句话',
      });

      expect(tx.session.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId: 'u1', name: '我的书' }),
        }),
      );
      expect(tx.novel.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'u1',
          sessionId: 's1',
          title: '我的书',
          genre: '玄幻',
          chapters: { create: [{ order: 1, title: '第1章' }] },
        }),
      });
      expect(result.id).toBe('n1');
    });
  });

  describe('list', () => {
    it('lists novels by userId newest-first', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findMany.mockResolvedValue([{ id: 'n1' }]);
      const svc = new NovelService(prisma as unknown as PrismaService);
      await svc.list('u1');
      expect(prisma.novel.findMany).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        orderBy: { updatedAt: 'desc' },
      });
    });
  });

  describe('get', () => {
    it('returns novel with chapters, scoped by user', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1', chapters: [] });
      const svc = new NovelService(prisma as unknown as PrismaService);
      await svc.get('u1', 'n1');
      expect(prisma.novel.findFirst).toHaveBeenCalledWith({
        where: { id: 'n1', userId: 'u1' },
        include: { chapters: { orderBy: { order: 'asc' } } },
      });
    });
  });

  describe('delete', () => {
    it('deletes only an owned novel', async () => {
      const prisma = makePrismaMock();
      const svc = new NovelService(prisma as unknown as PrismaService);
      await svc.delete('u1', 'n1');
      expect(prisma.novel.deleteMany).toHaveBeenCalledWith({
        where: { id: 'n1', userId: 'u1' },
      });
    });
  });

  describe('accept', () => {
    it('asserts ownership then dispatches the chapter mutation', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue({ id: 'n1' });
      const dispatch = jest.fn().mockResolvedValue(undefined);
      const registry = { dispatch } as unknown as ResourceRegistry;
      const svc = new NovelService(
        prisma as unknown as PrismaService,
        registry,
      );

      await svc.accept('u1', 'n1', {
        chapterId: 'c1',
        op: 'append',
        content: 'hi',
      });

      expect(dispatch).toHaveBeenCalledWith('u1', {
        resource: 'chapter',
        targetId: 'c1',
        op: 'append',
        content: 'hi',
      });
    });

    it('404s when the novel is not owned', async () => {
      const prisma = makePrismaMock();
      prisma.novel.findFirst.mockResolvedValue(null);
      const registry = { dispatch: jest.fn() } as unknown as ResourceRegistry;
      const svc = new NovelService(
        prisma as unknown as PrismaService,
        registry,
      );
      await expect(
        svc.accept('u1', 'n1', {
          chapterId: 'c1',
          op: 'set',
          content: 'x',
        }),
      ).rejects.toThrow();
      expect(registry.dispatch).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 2: 跑测试见失败**

Run: `cd server && pnpm test -- novel.service.spec.ts`
Expected: FAIL。

- [ ] **Step 3: 写实现**

`server/src/novel/novel.service.ts`:
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../prisma/prisma.service';
import { AGENT_ID } from '../agentos/agentos.constants';
import { ResourceRegistry } from '../resources/resource-registry';
import type { AcceptDto } from './dto/accept.dto';
import type { CreateNovelDto } from './dto/create-novel.dto';
import type { UpdateNovelDto } from './dto/update-novel.dto';

@Injectable()
export class NovelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ResourceRegistry,
  ) {}

  /** 建小说 + 1:1 聊天 Session + 种第一章。 */
  async create(userId: string, dto: CreateNovelDto) {
    const sessionId = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      await tx.session.create({
        data: { id: sessionId, userId, agentId: AGENT_ID, name: dto.title },
      });
      return tx.novel.create({
        data: {
          userId,
          sessionId,
          title: dto.title,
          genre: dto.genre ?? null,
          synopsis: dto.synopsis ?? null,
          settings: (dto.settings ?? {}) as object,
          chapters: { create: [{ order: 1, title: '第1章' }] },
        },
        include: { chapters: { orderBy: { order: 'asc' } } },
      });
    });
  }

  list(userId: string) {
    return this.prisma.novel.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async get(userId: string, id: string) {
    const novel = await this.prisma.novel.findFirst({
      where: { id, userId },
      include: { chapters: { orderBy: { order: 'asc' } } },
    });
    if (!novel) throw new NotFoundException('Novel not found');
    return novel;
  }

  async update(userId: string, id: string, dto: UpdateNovelDto) {
    await this.assertOwned(userId, id);
    return this.prisma.novel.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.genre !== undefined && { genre: dto.genre }),
        ...(dto.synopsis !== undefined && { synopsis: dto.synopsis }),
        ...(dto.settings !== undefined && { settings: dto.settings as object }),
      },
    });
  }

  delete(userId: string, id: string) {
    return this.prisma.novel.deleteMany({ where: { id, userId } });
  }

  /** 「采纳」:校验小说归属后,把变更交给 mutation 层分发。 */
  async accept(userId: string, novelId: string, dto: AcceptDto) {
    await this.assertOwned(userId, novelId);
    await this.registry.dispatch(userId, {
      resource: 'chapter',
      targetId: dto.chapterId,
      op: dto.op,
      content: dto.content,
    });
  }

  private async assertOwned(userId: string, id: string): Promise<void> {
    const owned = await this.prisma.novel.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!owned) throw new NotFoundException('Novel not found');
  }
}
```

- [ ] **Step 4: 跑测试通过**

Run: `cd server && pnpm test -- novel.service.spec.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add server/src/novel/novel.service.ts server/src/novel/novel.service.spec.ts
git commit -m "feat(server): NovelService (CRUD + accept via mutation layer)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: NovelController(TDD)

**Files:**
- Create: `server/src/novel/novel.controller.ts`
- Test: `server/src/novel/novel.controller.spec.ts`

- [ ] **Step 1: 写失败测试**

`server/src/novel/novel.controller.spec.ts`:
```ts
import { NovelController } from './novel.controller';
import type { NovelService } from './novel.service';
import type { ChapterService } from './chapter.service';
import type { RequestUser } from '../auth/current-user.decorator';

const USER: RequestUser = { id: 'u1', email: 'a@b.com' };

function makeNovelService() {
  return {
    create: jest.fn().mockResolvedValue({ id: 'n1' }),
    list: jest.fn().mockResolvedValue([{ id: 'n1' }]),
    get: jest.fn().mockResolvedValue({ id: 'n1', chapters: [] }),
    update: jest.fn().mockResolvedValue({ id: 'n1' }),
    delete: jest.fn().mockResolvedValue({ count: 1 }),
    accept: jest.fn().mockResolvedValue(undefined),
  } as unknown as NovelService;
}
function makeChapterService() {
  return {
    list: jest.fn().mockResolvedValue([{ id: 'c1' }]),
    create: jest.fn().mockResolvedValue({ id: 'c1', order: 1 }),
  } as unknown as ChapterService;
}

describe('NovelController', () => {
  it('POST /novels forwards dto to NovelService.create', async () => {
    const novel = makeNovelService();
    const controller = new NovelController(novel, makeChapterService());
    await controller.create(USER, { title: 'T' });
    expect(novel.create).toHaveBeenCalledWith('u1', { title: 'T' });
  });

  it('GET /novels lists', async () => {
    const novel = makeNovelService();
    const controller = new NovelController(novel, makeChapterService());
    const result = await controller.list(USER);
    expect(novel.list).toHaveBeenCalledWith('u1');
    expect(result).toEqual([{ id: 'n1' }]);
  });

  it('GET /novels/:id returns novel + chapters', async () => {
    const novel = makeNovelService();
    const controller = new NovelController(novel, makeChapterService());
    await controller.get(USER, 'n1');
    expect(novel.get).toHaveBeenCalledWith('u1', 'n1');
  });

  it('POST /novels/:id/accept forwards to NovelService.accept', async () => {
    const novel = makeNovelService();
    const controller = new NovelController(novel, makeChapterService());
    await controller.accept(USER, 'n1', {
      chapterId: 'c1',
      op: 'append',
      content: 'hi',
    });
    expect(novel.accept).toHaveBeenCalledWith('u1', 'n1', {
      chapterId: 'c1',
      op: 'append',
      content: 'hi',
    });
  });

  it('GET /novels/:id/chapters lists chapters', async () => {
    const chapters = makeChapterService();
    const controller = new NovelController(makeNovelService(), chapters);
    await controller.listChapters(USER, 'n1');
    expect(chapters.list).toHaveBeenCalledWith('u1', 'n1');
  });

  it('POST /novels/:id/chapters creates a chapter', async () => {
    const chapters = makeChapterService();
    const controller = new NovelController(makeNovelService(), chapters);
    await controller.createChapter(USER, 'n1', { title: '二' });
    expect(chapters.create).toHaveBeenCalledWith('u1', 'n1', { title: '二' });
  });
});
```

- [ ] **Step 2: 跑测试见失败**

Run: `cd server && pnpm test -- novel.controller.spec.ts`
Expected: FAIL。

- [ ] **Step 3: 写实现**

`server/src/novel/novel.controller.ts`:
```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser, type RequestUser } from '../auth/current-user.decorator';
import { ChapterService } from './chapter.service';
import { NovelService } from './novel.service';
import { AcceptDto } from './dto/accept.dto';
import { CreateChapterDto } from './dto/create-chapter.dto';
import { CreateNovelDto } from './dto/create-novel.dto';
import { UpdateNovelDto } from './dto/update-novel.dto';

@Controller('novels')
export class NovelController {
  constructor(
    private readonly novels: NovelService,
    private readonly chapters: ChapterService,
  ) {}

  @Post()
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateNovelDto) {
    return this.novels.create(user.id, dto);
  }

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.novels.list(user.id);
  }

  @Get(':id')
  get(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.novels.get(user.id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: UpdateNovelDto,
  ) {
    return this.novels.update(user.id, id, dto);
  }

  @Delete(':id')
  async delete(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    await this.novels.delete(user.id, id);
    return { ok: true };
  }

  @Get(':id/chapters')
  listChapters(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.chapters.list(user.id, id);
  }

  @Post(':id/chapters')
  createChapter(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: CreateChapterDto,
  ) {
    return this.chapters.create(user.id, id, dto);
  }

  /** 采纳 AI 提案到章节(op: append 接着写 / set 重写本章)。 */
  @Post(':id/accept')
  async accept(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: AcceptDto,
  ): Promise<{ ok: true }> {
    await this.novels.accept(user.id, id, dto);
    return { ok: true };
  }
}
```

- [ ] **Step 4: 跑测试通过**

Run: `cd server && pnpm test -- novel.controller.spec.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add server/src/novel/novel.controller.ts server/src/novel/novel.controller.spec.ts
git commit -m "feat(server): NovelController (/novels + chapters + accept)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: NovelModule + 装配 + 全量验证

**Files:**
- Create: `server/src/novel/novel.module.ts`
- Modify: `server/src/app.module.ts`

- [ ] **Step 1: 写 NovelModule(注册 ChapterHandler 进 registry)**

`server/src/novel/novel.module.ts`:
```ts
import { Module, OnModuleInit } from '@nestjs/common';
import { ResourceRegistry } from '../resources/resource-registry';
import { ChapterHandler, ChapterService } from './chapter.service';
import { NovelController } from './novel.controller';
import { NovelService } from './novel.service';

/**
 * 把 ChapterHandler 注册进 ResourceRegistry。用一个 OnModuleInit provider
 * 完成注册，避免在服务构造函数里互相注入造成循环依赖。
 */
@Module({
  controllers: [NovelController],
  providers: [
    NovelService,
    ChapterService,
    ChapterHandler,
    ResourceRegistry,
    {
      provide: 'HANDLER_REGISTRAR',
      useFactory: (registry: ResourceRegistry, chapter: ChapterHandler) => {
        return {
          onModuleInit() {
            registry.register(chapter);
          },
        };
      },
      inject: [ResourceRegistry, ChapterHandler],
    },
  ],
})
export class NovelModule implements OnModuleInit {
  constructor(private readonly registrar: { onModuleInit(): void }) {}
  onModuleInit() {
    this.registrar.onModuleInit();
  }
}
```

- [ ] **Step 2: 接入 AppModule**

`server/src/app.module.ts` —— imports 加 `NovelModule`:
```ts
import { Module } from '@nestjs/common';
import { AgentosModule } from './agentos/agentos.module';
import { AuthModule } from './auth/auth.module';
import { NovelModule } from './novel/novel.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [PrismaModule, AuthModule, AgentosModule, NovelModule],
})
export class AppModule {}
```

- [ ] **Step 3: 全量 server 门禁**

Run: `cd server && pnpm test && pnpm lint && pnpm typecheck && pnpm build`
Expected: 全绿(测试数增加，含新增 spec；lint/tsc/build 无错)。

- [ ] **Step 4: 冒烟(手动,可选)**

Run: `cd server && PORT=3001 node dist/main`(后台)。然后:
```bash
TOKEN=$(curl -s -X POST localhost:3001/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"novel@x.test","password":"password123"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
NOVEL=$(curl -s -X POST localhost:3001/novels -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"title":"测试书","genre":"玄幻"}')
echo "$NOVEL"   # 应含 id + chapters[0]
NID=$(echo "$NOVEL" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
CID=$(echo "$NOVEL" | python3 -c 'import sys,json;print(json.load(sys.stdin)["chapters"][0]["id"])')
curl -s -X POST localhost:3001/novels/$NID/accept -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d "{\"chapterId\":\"$CID\",\"op\":\"append\",\"content\":\"开头。\"}"
curl -s localhost:3001/novels/$NID -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
# chapters[0].content 应为 "开头。"，status 为 COMMITTED
```
停掉 server。

- [ ] **Step 5: Commit**

```bash
git add server/src/novel/novel.module.ts server/src/app.module.ts
git commit -m "feat(server): wire NovelModule (register chapter handler) into AppModule

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# M1 · 上下文组装器 + 每本小说的 Agent system prompt

## Task 8: ContextAssembler(TDD)

**Files:**
- Create: `server/src/agentos/context-assembler.service.ts`
- Test: `server/src/agentos/context-assembler.service.spec.ts`

`buildSystemPrompt(novel)` 纯函数;`forSession(userId, sessionId)` 查 novel 后调用，找不到则回落到通用 prompt。

- [ ] **Step 1: 写失败测试**

`server/src/agentos/context-assembler.service.spec.ts`:
```ts
import { ContextAssembler } from './context-assembler.service';
import type { PrismaService } from '../prisma/prisma.service';

describe('ContextAssembler', () => {
  describe('buildSystemPrompt', () => {
    it('weaves title/genre/synopsis/settings into an author-facing prompt', () => {
      const svc = new ContextAssembler({} as unknown as PrismaService);
      const prompt = svc.buildSystemPrompt({
        title: '剑来',
        genre: '仙侠',
        synopsis: '一个少年的修行路',
        settings: { style: '冷峻', language: 'zh', worldviewText: '九州' },
      });
      expect(prompt).toContain('剑来');
      expect(prompt).toContain('仙侠');
      expect(prompt).toContain('一个少年的修行路');
      expect(prompt).toContain('冷峻');
      expect(prompt).toContain('九州');
    });

    it('works without optional fields', () => {
      const svc = new ContextAssembler({} as unknown as PrismaService);
      const prompt = svc.buildSystemPrompt({
        title: '无题',
        genre: null,
        synopsis: null,
        settings: {},
      });
      expect(prompt).toContain('无题');
    });
  });

  describe('forSession', () => {
    it('returns the novel prompt when the session belongs to the user', async () => {
      const findFirst = jest.fn().mockResolvedValue({
        title: 'T',
        genre: 'g',
        synopsis: 's',
        settings: {},
      });
      const svc = new ContextAssembler({
        novel: { findFirst },
      } as unknown as PrismaService);
      const prompt = await svc.forSession('u1', 's1');
      expect(findFirst).toHaveBeenCalledWith({
        where: { sessionId: 's1', userId: 'u1' },
      });
      expect(prompt).toContain('T');
    });

    it('falls back to the generic prompt when no novel is found', async () => {
      const svc = new ContextAssembler({
        novel: { findFirst: jest.fn().mockResolvedValue(null) },
      } as unknown as PrismaService);
      const prompt = await svc.forSession('u1', 'orphan');
      expect(prompt).not.toContain('undefined');
    });
  });
});
```

- [ ] **Step 2: 跑测试见失败**

Run: `cd server && pnpm test -- context-assembler.service.spec.ts`
Expected: FAIL。

- [ ] **Step 3: 写实现**

`server/src/agentos/context-assembler.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { SYSTEM_PROMPT } from './agentos.constants';
import type { PrismaService } from '../prisma/prisma.service';

interface NovelPromptInput {
  title: string;
  genre: string | null;
  synopsis: string | null;
  settings: { style?: string; language?: string; worldviewText?: string } | unknown;
}

/**
 * 把小说设定组装成写作 Agent 的 system prompt(作者视角的自然语言,非 JSON)。
 * Phase 1 lite:只拼 title/genre/synopsis/settings;Phase 2 再加大纲 slice/角色段。
 */
@Injectable()
export class ContextAssembler {
  constructor(private readonly prisma: PrismaService) {}

  buildSystemPrompt(novel: NovelPromptInput): string {
    const s = (novel.settings ?? {}) as {
      style?: string;
      language?: string;
      worldviewText?: string;
    };
    const lines = [
      '你是一位资深小说写作助手，与作者协作创作一部小说。遵循作者的意图，用自然、连贯的中文正文回复；正文只输出小说内容本身，不要加解说或meta说明。',
      '',
      `【书名】${novel.title}`,
    ];
    if (novel.genre) lines.push(`【类型】${novel.genre}`);
    if (novel.synopsis) lines.push(`【简介】${novel.synopsis}`);
    if (s.worldviewText) lines.push(`【世界观/设定】${s.worldviewText}`);
    if (s.style) lines.push(`【文风】${s.style}`);
    if (s.language) lines.push(`【语言】${s.language}`);
    lines.push('');
    lines.push('规则:不要编造与设定冲突的情节;保持人物与已有内容一致。');
    return lines.join('\n');
  }

  /** 由聊天 session(=novel.sessionId)反查小说并组装 prompt;查不到回落通用 prompt。 */
  async forSession(userId: string, sessionId: string): Promise<string> {
    const novel = await this.prisma.novel.findFirst({
      where: { sessionId, userId },
      select: {
        title: true,
        genre: true,
        synopsis: true,
        settings: true,
      },
    });
    if (!novel) return SYSTEM_PROMPT;
    return this.buildSystemPrompt(novel);
  }
}
```

- [ ] **Step 4: 跑测试通过**

Run: `cd server && pnpm test -- context-assembler.service.spec.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add server/src/agentos/context-assembler.service.ts server/src/agentos/context-assembler.service.spec.ts
git commit -m "feat(server): ContextAssembler (per-novel system prompt, P1 lite)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 9: DeepAgentService 改为按 system prompt 构建/缓存 agent(TDD 改造)

**Files:**
- Modify: `server/src/agentos/deep-agent.service.ts`
- Modify: `server/src/agentos/deep-agent.service.spec.ts`

`streamTurn` 增加 `systemPrompt` 入参;`buildAgent(systemPrompt)` 接收 prompt;新增 `getAgent` 按 prompt 缓存。

- [ ] **Step 1: 改 spec 的 streamTurn 测试(用缓存 map 注入 fake agent)**

`server/src/agentos/deep-agent.service.spec.ts` 的 `describe('streamTurn')` 用例改为:
```ts
    it('calls agent.stream with the new user message + thread_id + the given systemPrompt, yields non-empty deltas in order', async () => {
      const service = new DeepAgentService();
      const fakeStream = (async function* () {
        yield [{ text: 'He' }, {}];
        yield [{ foo: 'skip' }, {}];
        yield [{ text: 'llo' }, {}];
        await Promise.resolve();
      })();
      type StreamArgs = [
        { messages: Array<{ role: string; content: string }> },
        { configurable: Record<string, unknown>; streamMode: string },
      ];
      const stream = jest.fn(() =>
        Promise.resolve(fakeStream),
      ) as unknown as jest.Mock<Promise<typeof fakeStream>, StreamArgs>;
      // 新:getAgent 按 systemPrompt 从缓存 map 取;预置一个 prompt 对应的 fake agent。
      (service as unknown as { agents: Map<string, { stream: typeof stream }> })
        .agents.set('PROMPT-X', { stream });

      const out: string[] = [];
      for await (const d of service.streamTurn({
        threadId: 'sess-1',
        userMessage: 'hi',
        systemPrompt: 'PROMPT-X',
      })) {
        out.push(d);
      }

      expect(stream).toHaveBeenCalledTimes(1);
      const [input, options] = stream.mock.calls[0];
      expect(input).toEqual({ messages: [{ role: 'user', content: 'hi' }] });
      expect(options).toMatchObject({
        configurable: { thread_id: 'sess-1' },
        streamMode: 'messages',
      });
      expect(out).toEqual(['He', 'llo']);
    });
```

并把 `buildAgent` 用例里 `).buildAgent()` 改为 `).buildAgent('PROMPT-Y')`(传一个 prompt 参数)。

- [ ] **Step 2: 跑测试见失败**

Run: `cd server && pnpm test -- deep-agent.service.spec.ts`
Expected: FAIL(streamTurn/buildAgent 签名不匹配)。

- [ ] **Step 3: 改实现**

`server/src/agentos/deep-agent.service.ts` —— 改动点:
- `private agent!` → `private agents = new Map<string, StreamableAgent>();`
- 删除 `onModuleInit` 里的 `this.agent = await this.buildAgent();`(改为空体或移除 OnModuleInit)。保留 `OnModuleInit` 接口但 `onModuleInit()` 体为空(惰性构建)。
- 新增 `getAgent`:
```ts
  /** 按 systemPrompt 复用/构建 agent(同一本小说的 prompt 相同 → 命中缓存)。 */
  protected async getAgent(systemPrompt: string): Promise<StreamableAgent> {
    let agent = this.agents.get(systemPrompt);
    if (!agent) {
      agent = await this.buildAgent(systemPrompt);
      this.agents.set(systemPrompt, agent);
    }
    return agent;
  }
```
- `buildAgent(systemPrompt: string)`:`createDeepAgent({ model, systemPrompt, checkpointer: ... })`(用入参替换原 `SYSTEM_PROMPT` 常量)。
- `streamTurn` 签名与体:
```ts
  async *streamTurn({
    threadId,
    userMessage,
    systemPrompt,
  }: {
    threadId: string;
    userMessage: string;
    systemPrompt: string;
  }): AsyncGenerator<string> {
    const agent = await this.getAgent(systemPrompt);
    const stream = await agent.stream(
      { messages: [{ role: 'user', content: userMessage }] },
      { configurable: { thread_id: threadId }, streamMode: 'messages' },
    );
    for await (const chunk of stream) {
      const delta = this.extractDelta(chunk);
      if (delta) yield delta;
    }
  }
```
> 顶部仍 `import { GLM_BASE_URL, GLM_MODEL } from './agentos.constants'`;`SYSTEM_PROMPT` 不再被本文件引用(由 ContextAssembler 兜底用),import 里去掉 `SYSTEM_PROMPT`。

- [ ] **Step 4: 跑测试通过**

Run: `cd server && pnpm test -- deep-agent.service.spec.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add server/src/agentos/deep-agent.service.ts server/src/agentos/deep-agent.service.spec.ts
git commit -m "feat(server): DeepAgentService builds/caches agent per system prompt

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 10: AgentosController 用 ContextAssembler 组装 prompt(改造)

**Files:**
- Modify: `server/src/agentos/agentos.controller.ts`
- Modify: `server/src/agentos/agentos.module.ts`
- Modify: `server/src/agentos/agentos.controller.spec.ts`

注入 `ContextAssembler`，`runAgent` 在 resolveSession 后取 prompt 传给 `streamTurn`。

- [ ] **Step 1: 改 controller**

`server/src/agentos/agentos.controller.ts`:
- 构造函数加 `private readonly contextAssembler: ContextAssembler`(import 之)。
- `runAgent` 里 `resolveSession(...)` 之后、`streamTurn` 之前加:
```ts
      const systemPrompt = await this.contextAssembler.forSession(
        user.id,
        session.id,
      );
```
- `this.deepAgent.streamTurn({ threadId: sessionId, userMessage: message })` 改为
  `this.deepAgent.streamTurn({ threadId: sessionId, userMessage: message, systemPrompt })`。

- [ ] **Step 2: agentos.module 注册 ContextAssembler**

`server/src/agentos/agentos.module.ts` providers 加 `ContextAssembler`(import)。

- [ ] **Step 3: 改 controller spec(注入 fake ContextAssembler + 新签名)**

`server/src/agentos/agentos.controller.spec.ts`:
- `buildController` 增加一个 fake contextAssembler 参数:
```ts
function buildController(
  deltas: (m: string) => AsyncIterable<string>,
  sessions: SessionsMock = makeSessionsMock(),
  systemPrompt = 'PROMPT',
): { controller: AgentosController; sessions: SessionsMock } {
  const fakeService = {
    streamTurn: ({
      userMessage,
    }: {
      threadId: string;
      userMessage: string;
      systemPrompt: string;
    }) => deltas(userMessage),
  } as unknown as DeepAgentService;
  const fakeAssembler = {
    forSession: jest.fn().mockResolvedValue(systemPrompt),
  } as unknown as ContextAssembler;
  return {
    controller: new AgentosController(
      fakeService,
      new StreamAdapter(),
      sessions as unknown as SessionsService,
      fakeAssembler,
    ),
    sessions,
  };
}
```
(import `ContextAssembler` 类型。)现有用例无需改逻辑(fake 忽略 systemPrompt);新增一个断言:
```ts
  it('POST runAgent resolves a per-session system prompt and passes it to streamTurn', async () => {
    const { controller, sessions } = buildController(() => asyncFromChunks(['ok']));
    const { res } = createFakeRes();
    await controller.runAgent(USER, 'deep-agent', { message: 'hi', session_id: 'sess-1' }, res);
    // contextAssembler.forSession 被以 (userId, sessionId) 调用
    expect(
      (controller as unknown as { contextAssembler: { forSession: jest.Mock } })
        .contextAssembler.forSession,
    ).toHaveBeenCalledWith('u1', 'sess-1');
    expect(sessions.resolveSession).toHaveBeenCalled();
  });
```

- [ ] **Step 4: 跑测试通过**

Run: `cd server && pnpm test -- agentos.controller.spec.ts`
Expected: PASS(含新用例)。

- [ ] **Step 5: 全量 server 门禁**

Run: `cd server && pnpm test && pnpm lint && pnpm typecheck && pnpm build`
Expected: 全绿。

- [ ] **Step 6: Commit**

```bash
git add server/src/agentos/agentos.controller.ts server/src/agentos/agentos.module.ts server/src/agentos/agentos.controller.spec.ts
git commit -m "feat(server): agentos run resolves per-novel system prompt via ContextAssembler

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# M2 · 前端 · 小说库

## Task 11: FE 类型 + API client(novels)

**Files:**
- Create: `agent-ui/src/types/novel.ts`
- Create: `agent-ui/src/api/novels.ts`
- Modify: `agent-ui/src/api/routes.ts`

- [ ] **Step 1: 写类型**

`agent-ui/src/types/novel.ts`:
```ts
export interface NovelSettings {
  style?: string
  language?: string
  chapterWordTarget?: number
  worldviewText?: string
}

export interface Chapter {
  id: string
  novelId: string
  order: number
  title: string
  content: string
  status: 'DRAFT' | 'COMMITTED'
  createdAt: string
  updatedAt: string
}

export interface Novel {
  id: string
  userId: string
  sessionId: string
  title: string
  genre: string | null
  synopsis: string | null
  settings: NovelSettings
  createdAt: string
  updatedAt: string
  chapters: Chapter[]
}

export interface CreateNovelInput {
  title: string
  genre?: string
  synopsis?: string
  settings?: NovelSettings
}
```

- [ ] **Step 2: routes.ts 加路由**

`agent-ui/src/api/routes.ts` 末尾的 `APIRoutes` 对象内加:
```ts
  Novels: (base: string) => `${base}/novels`,
  Novel: (base: string, id: string) => `${base}/novels/${id}`,
  NovelChapters: (base: string, id: string) => `${base}/novels/${id}/chapters`,
  NovelAccept: (base: string, id: string) => `${base}/novels/${id}/accept`
```

- [ ] **Step 3: 写 API client**

`agent-ui/src/api/novels.ts`:
```ts
import { APIRoutes } from './routes'
import type { Chapter, CreateNovelInput, Novel } from '@/types/novel'

const headers = (token: string): HeadersInit => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${token}`
})

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText)
    throw new Error(msg || `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export const listNovels = (base: string, token: string) =>
  asJson<Novel[]>(fetch(APIRoutes.Novels(base), { headers: headers(token) }))

export const getNovel = (base: string, token: string, id: string) =>
  asJson<Novel>(fetch(APIRoutes.Novel(base, id), { headers: headers(token) }))

export const createNovel = (
  base: string,
  token: string,
  input: CreateNovelInput
) =>
  asJson<Novel>(
    fetch(APIRoutes.Novels(base), {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify(input)
    })
  )

export const deleteNovel = (base: string, token: string, id: string) =>
  asJson<{ ok: true }>(
    fetch(APIRoutes.Novel(base, id), { method: 'DELETE', headers: headers(token) })
  )

export const createChapter = (base: string, token: string, novelId: string) =>
  asJson<Chapter>(
    fetch(APIRoutes.NovelChapters(base, novelId), {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify({})
    })
  )

export const listChapters = (base: string, token: string, novelId: string) =>
  asJson<Chapter[]>(fetch(APIRoutes.NovelChapters(base, novelId), { headers: headers(token) }))

export interface AcceptInput {
  chapterId: string
  op: 'set' | 'append'
  content: string
}
export const acceptIntoChapter = (
  base: string,
  token: string,
  novelId: string,
  input: AcceptInput
) =>
  asJson<{ ok: true }>(
    fetch(APIRoutes.NovelAccept(base, novelId), {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify(input)
    })
  )
```

- [ ] **Step 4: typecheck + validate**

Run: `cd agent-ui && pnpm typecheck && pnpm validate`
Expected: 通过。

- [ ] **Step 5: Commit**

```bash
git add agent-ui/src/types/novel.ts agent-ui/src/api/novels.ts agent-ui/src/api/routes.ts
git commit -m "feat(agent-ui): novel/chapter types + API client

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 12: 小说库页 `/`(卡片网格 + 新建小说)

**Files:**
- Create: `agent-ui/src/components/library/NovelCard.tsx`
- Create: `agent-ui/src/components/library/NewNovelForm.tsx`
- Create: `agent-ui/src/components/library/NovelLibrary.tsx`
- Modify: `agent-ui/src/app/page.tsx`

`/` 从旧 chat 工作台改为小说库(旧 chat 后续在 `/novels/[id]` 重建)。

- [ ] **Step 1: NovelCard**

`agent-ui/src/components/library/NovelCard.tsx`:
```tsx
'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { Novel } from '@/types/novel'

const NovelCard = ({ novel }: { novel: Novel }) => (
  <Link
    href={`/novels/${novel.id}`}
    className="flex flex-col gap-2 rounded-2xl border border-primary/10 bg-background-secondary p-5 transition-colors hover:border-brand/40"
  >
    <div className="flex items-center justify-between">
      <h3 className="line-clamp-1 text-base font-semibold text-primary">
        {novel.title}
      </h3>
      {novel.genre && (
        <span className="rounded-md bg-accent px-2 py-0.5 text-xs text-muted">
          {novel.genre}
        </span>
      )}
    </div>
    <p className="line-clamp-2 text-xs text-muted">
      {novel.synopsis || '暂无简介'}
    </p>
    <p className="text-xs text-muted/60">
      {novel.chapters?.length ?? 0} 章
    </p>
  </Link>
)

export default NovelCard
// silence unused import warning in some setups
void cn
```
(若 `cn` 未实际用到，删掉 import 与 `void cn`。)

- [ ] **Step 2: NewNovelForm**

`agent-ui/src/components/library/NewNovelForm.tsx`:
```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useStore } from '@/store'
import { createNovel } from '@/api/novels'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const NewNovelForm = ({ onDone }: { onDone?: () => void }) => {
  const router = useRouter()
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const [title, setTitle] = useState('')
  const [genre, setGenre] = useState('')
  const [synopsis, setSynopsis] = useState('')
  const [worldviewText, setWorldviewText] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    setLoading(true)
    try {
      const novel = await createNovel(endpoint, token, {
        title: title.trim(),
        genre: genre.trim() || undefined,
        synopsis: synopsis.trim() || undefined,
        settings: worldviewText.trim() ? { worldviewText: worldviewText.trim() } : undefined
      })
      onDone?.()
      router.push(`/novels/${novel.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Input placeholder="书名" value={title} onChange={(e) => setTitle(e.target.value)} required />
      <Input placeholder="类型(如 玄幻 / 悬疑)" value={genre} onChange={(e) => setGenre(e.target.value)} />
      <Input placeholder="一句话简介" value={synopsis} onChange={(e) => setSynopsis(e.target.value)} />
      <Input
        placeholder="世界观/设定(可选,会喂给 AI)"
        value={worldviewText}
        onChange={(e) => setWorldviewText(e.target.value)}
      />
      <Button type="submit" disabled={loading} className="h-11 w-full bg-brand text-white hover:bg-brand/90">
        {loading ? '创建中…' : '创建并开始写作'}
      </Button>
    </form>
  )
}

export default NewNovelForm
```

- [ ] **Step 3: NovelLibrary**

`agent-ui/src/components/library/NovelLibrary.tsx`:
```tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useStore } from '@/store'
import { listNovels } from '@/api/novels'
import type { Novel } from '@/types/novel'
import NovelCard from './NovelCard'
import NewNovelForm from './NewNovelForm'
import { Button } from '@/components/ui/button'
import Icon from '@/components/ui/icon'

const NovelLibrary = () => {
  const router = useRouter()
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const logout = useStore((s) => s.logout)
  const [novels, setNovels] = useState<Novel[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setNovels(await listNovels(endpoint, token))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [endpoint, token])

  useEffect(() => {
    refresh()
  }, [refresh])

  return (
    <div className="flex h-screen bg-background/80">
      <aside className="flex w-60 shrink-0 flex-col gap-3 border-r border-primary/10 px-4 py-5 font-dmmono">
        <div className="flex items-center gap-2">
          <Icon type="agno" size="xs" />
          <span className="text-xs font-medium uppercase text-white">narratox</span>
        </div>
        <Button
          onClick={() => setShowForm((v) => !v)}
          className="h-9 rounded-xl bg-primary text-xs font-medium text-background hover:bg-primary/80"
        >
          + 新建小说
        </Button>
        {showForm && <NewNovelForm onDone={() => setShowForm(false)} />}
        <div className="mt-auto">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              logout()
              router.replace('/login')
            }}
            className="text-muted"
          >
            登出
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-8">
        <h1 className="mb-6 text-lg font-semibold text-primary">我的小说</h1>
        {loading ? (
          <p className="text-sm text-muted">加载中…</p>
        ) : novels.length === 0 ? (
          <p className="text-sm text-muted">还没有小说，点击「新建小说」开始。</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {novels.map((n) => (
              <NovelCard key={n.id} novel={n} />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

export default NovelLibrary
```

- [ ] **Step 4: `/` 改为小说库**

`agent-ui/src/app/page.tsx`:
```tsx
'use client'
import { Suspense } from 'react'
import RequireAuth from '@/components/auth/RequireAuth'
import NovelLibrary from '@/components/library/NovelLibrary'

export default function Home() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <RequireAuth>
        <NovelLibrary />
      </RequireAuth>
    </Suspense>
  )
}
```
> 旧的 `Sidebar` + `ChatArea` 组合从 `/` 移除;chat 在 Task 14 的 `/novels/[id]` 重建。`Sidebar`/`ChatArea` 组件文件保留(工作台复用 MessageArea/ChatInput)。

- [ ] **Step 5: typecheck + validate + build**

Run: `cd agent-ui && pnpm typecheck && pnpm validate && pnpm build`
Expected: 通过(`/`、`/login`、`/register` 路由仍在)。

- [ ] **Step 6: Commit**

```bash
git add agent-ui/src/components/library agent-ui/src/app/page.tsx
git commit -m "feat(agent-ui): novel library page at / (grid + new-novel form)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# M3 · 前端 · 工作台(三栏)

## Task 13: 工作台壳 + ResourceNav(左栏)

**Files:**
- Create: `agent-ui/src/components/workspace/ResourceNav.tsx`
- Create: `agent-ui/src/app/novels/[id]/page.tsx`

- [ ] **Step 1: ResourceNav**

`agent-ui/src/components/workspace/ResourceNav.tsx`:
```tsx
'use client'

import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { useStore } from '@/store'
import type { Chapter } from '@/types/novel'
import { cn } from '@/lib/utils'

interface Props {
  novelTitle: string
  chapters: Chapter[]
  selectedChapterId: string | null
  onSelectChapter: (id: string) => void
  onNewChapter: () => void
}

const P2 = ['📝 大纲', '👤 角色', '🌍 世界观'] as const
const P3 = ['📊 状态'] as const

const ResourceNav = ({
  novelTitle,
  chapters,
  selectedChapterId,
  onSelectChapter,
  onNewChapter
}: Props) => {
  const router = useRouter()
  const logout = useStore((s) => s.logout)

  return (
    <aside className="flex w-60 shrink-0 flex-col gap-3 overflow-y-auto border-r border-primary/10 px-3 py-4 font-dmmono">
      <button
        onClick={() => router.push('/')}
        className="text-left text-xs font-medium text-brand"
        type="button"
      >
        ‹ 小说库
      </button>
      <div className="truncate text-sm font-semibold text-primary">{novelTitle}</div>

      <div className="text-xs font-medium uppercase text-muted">📖 章节</div>
      <div className="flex flex-col gap-1">
        {chapters.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelectChapter(c.id)}
            className={cn(
              'truncate rounded-md px-2 py-1 text-left text-xs',
              c.id === selectedChapterId
                ? 'bg-brand text-white'
                : 'text-muted hover:bg-accent'
            )}
          >
            第{c.order}章 · {c.title}
          </button>
        ))}
        <button
          type="button"
          onClick={onNewChapter}
          className="rounded-md px-2 py-1 text-left text-xs text-muted/60 hover:bg-accent"
        >
          + 新章
        </button>
      </div>

      {P2.map((label) => (
        <div key={label} className="text-xs text-muted/40">
          {label} <span className="rounded bg-accent px-1 text-[10px]">P2</span>
        </div>
      ))}
      {P3.map((label) => (
        <div key={label} className="text-xs text-muted/40">
          {label} <span className="rounded bg-accent px-1 text-[10px]">P3</span>
        </div>
      ))}

      <div className="mt-auto">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            logout()
            router.replace('/login')
          }}
          className="text-muted"
        >
          登出
        </Button>
      </div>
    </aside>
  )
}

export default ResourceNav
```

- [ ] **Step 2: 工作台页(壳,先放 nav + 占位中/右)**

`agent-ui/src/app/novels/[id]/page.tsx`:
```tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { toast } from 'sonner'
import { useStore } from '@/store'
import { getNovel, createChapter } from '@/api/novels'
import type { Novel } from '@/types/novel'
import RequireAuth from '@/components/auth/RequireAuth'
import ResourceNav from '@/components/workspace/ResourceNav'

export default function NovelWorkspacePage() {
  return (
    <RequireAuth>
      <Workspace />
    </RequireAuth>
  )
}

const Workspace = () => {
  const params = useParams<{ id: string }>()
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const [novel, setNovel] = useState<Novel | null>(null)
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const n = await getNovel(endpoint, token, params.id)
      setNovel(n)
      setSelectedChapterId((prev) => prev ?? n.chapters[0]?.id ?? null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载失败')
    }
  }, [endpoint, token, params.id])

  useEffect(() => {
    refresh()
  }, [refresh])

  const onNewChapter = async () => {
    try {
      await createChapter(endpoint, token, params.id)
      refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '新建失败')
    }
  }

  if (!novel) return <div className="p-8 text-sm text-muted">加载中…</div>

  return (
    <div className="flex h-screen bg-background/80">
      <ResourceNav
        novelTitle={novel.title}
        chapters={novel.chapters}
        selectedChapterId={selectedChapterId}
        onSelectChapter={setSelectedChapterId}
        onNewChapter={onNewChapter}
      />
      <div className="flex flex-1 items-center justify-center text-sm text-muted">
        聊天 + 稿件区(下一任务实现)
      </div>
    </div>
  )
}
```

- [ ] **Step 3: typecheck + validate + build**

Run: `cd agent-ui && pnpm typecheck && pnpm validate && pnpm build`
Expected: 通过(新增 `/novels/[id]` 路由)。

- [ ] **Step 4: Commit**

```bash
git add agent-ui/src/components/workspace/ResourceNav.tsx 'agent-ui/src/app/novels/[id]/page.tsx'
git commit -m "feat(agent-ui): workspace shell + resource nav (left rail)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 14: ChapterDetail(右栏 · 稿件渲染 + 编辑)

**Files:**
- Create: `agent-ui/src/components/workspace/ChapterDetail.tsx`
- Modify: `agent-ui/src/app/novels/[id]/page.tsx`

- [ ] **Step 1: ChapterDetail**

`agent-ui/src/components/workspace/ChapterDetail.tsx`:
```tsx
'use client'

import { useEffect, useState } from 'react'
import MarkdownRenderer from '@/components/ui/typography/MarkdownRenderer'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { Chapter } from '@/types/novel'

const ChapterDetail = ({ chapter }: { chapter: Chapter | undefined }) => {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  useEffect(() => {
    setEditing(false)
    setDraft(chapter?.content ?? '')
  }, [chapter?.id, chapter?.content])

  if (!chapter) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted">
        选择一章查看正文
      </div>
    )
  }

  return (
    <section className="flex flex-1 flex-col overflow-hidden border-l border-primary/10">
      <header className="flex items-center justify-between px-5 py-3">
        <h2 className="text-sm font-semibold text-primary">
          第{chapter.order}章 · {chapter.title}
          <span className="ml-2 text-xs text-muted/60">
            [{chapter.status === 'COMMITTED' ? '已采纳' : '草稿'}]
          </span>
        </h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (editing) setDraft(chapter.content)
            setEditing((v) => !v)
          }}
          className="text-muted"
        >
          {editing ? '预览' : '编辑'}
        </Button>
      </header>
      <div className="flex-1 overflow-y-auto px-5 pb-6">
        {editing ? (
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="min-h-[60vh] w-full bg-background text-sm text-primary"
          />
        ) : (
          <article className="prose prose-invert max-w-none text-sm">
            {chapter.content ? (
              <MarkdownRenderer>{chapter.content}</MarkdownRenderer>
            ) : (
              <p className="text-muted">本章还没有内容。在左侧聊天里让 AI 写，然后「采纳到本章」。</p>
            )}
          </article>
        )}
      </div>
      <footer className="px-5 py-2 text-xs text-muted/50">
        [正文] · 世界观 · 角色 · 状态(P2/P3 占位)
      </footer>
    </section>
  )
}

export default ChapterDetail
```
> Note: 编辑态是纯前端 textarea;保存正文走「重写本章」的 accept(Task 15 的 ChatPanel 不直接存 textarea)。Phase 1 的编辑仅作本地预览/微调入口;真正落库由 accept 承担(spec §13:不做富文本编辑器)。若需保存编辑，可在 footer 加「保存」按钮调用 `acceptIntoChapter(op:'set')`——作为可选增强，本任务先不接。

- [ ] **Step 2: 接进工作台**

`agent-ui/src/app/novels/[id]/page.tsx` 的 `Workspace` 返回里，把占位 div 换成:
```tsx
      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col">{/* ChatPanel 下一任务 */}</div>
        <ChapterDetail
          chapter={novel.chapters.find((c) => c.id === selectedChapterId)}
        />
      </div>
```
并在文件顶部 import `ChapterDetail`。

- [ ] **Step 3: typecheck + validate**

Run: `cd agent-ui && pnpm typecheck && pnpm validate`
Expected: 通过(确认 `Textarea`、`MarkdownRenderer` 路径存在；`Textarea` 在 `@/components/ui/textarea`，`MarkdownRenderer` 在 `@/components/ui/typography/MarkdownRenderer`——若路径不同，按实际调整)。

- [ ] **Step 4: Commit**

```bash
git add agent-ui/src/components/workspace/ChapterDetail.tsx 'agent-ui/src/app/novels/[id]/page.tsx'
git commit -m "feat(agent-ui): ChapterDetail (manuscript render/edit, right pane)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 15: ChatPanel(中栏 · 复用聊天 + 「采纳到本章」)

**Files:**
- Modify: `agent-ui/src/components/chat/ChatArea/Messages/Messages.tsx`(加可选 onAccept)
- Create: `agent-ui/src/components/workspace/ChatPanel.tsx`
- Modify: `agent-ui/src/app/novels/[id]/page.tsx`(挂 ChatPanel)

策略:工作台挂载时把 nuqs `agent=deep-agent`、`session=novel.sessionId`、`db_id=default` 设好，**直接复用现有 `useAIStreamHandler` + `MessageArea` + `ChatInput`**。聊天历史用 `getSessionAPI(novel.sessionId)` 载入 `messages`。「采纳」按钮挂在每条 agent 消息上(Task 内给 `Messages` 加 `onAccept` 可选回调)。

- [ ] **Step 1: 给 Messages 加 onAccept**

`agent-ui/src/components/chat/ChatArea/Messages/Messages.tsx`:
- `MessageListProps` 加 `onAccept?: (content: string) => void`。
- `MessageWrapperProps` 加 `onAccept?: (content: string) => void; canAccept?: boolean`。
- `AgentMessageWrapper` 在 `<AgentMessage ... />` 之后，当 `onAccept && canAccept && message.content` 时渲染按钮:
```tsx
      <AgentMessage message={message} />
      {onAccept && canAccept && message.content && (
        <button
          type="button"
          onClick={() => onAccept(message.content)}
          className="mt-2 self-start rounded-md bg-brand px-3 py-1 text-xs font-medium text-white hover:bg-brand/90"
        >
          采纳到本章 ↗
        </button>
      )}
```
- `Messages` 组件签名改 `({ messages, onAccept, canAccept }: MessageListProps)`，把 `onAccept`、`canAccept` 透传给 `AgentMessageWrapper`。

- [ ] **Step 2: ChatPanel**

`agent-ui/src/components/workspace/ChatPanel.tsx`:
```tsx
'use client'

import { useCallback, useEffect } from 'react'
import { useQueryState } from 'nuqs'
import { toast } from 'sonner'
import { useStore } from '@/store'
import useChatActions from '@/hooks/useChatActions'
import Messages from '@/components/chat/ChatArea/Messages/Messages'
import ChatInput from '@/components/chat/ChatArea/ChatInput'
import { getSessionAPI } from '@/api/os'
import { acceptIntoChapter } from '@/api/novels'
import type { ChatMessage } from '@/types/os'

interface Props {
  novelId: string
  sessionId: string
  selectedChapterId: string | null
  onAccepted: () => void
}

const ChatPanel = ({ novelId, sessionId, selectedChapterId, onAccepted }: Props) => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const messages = useStore((s) => s.messages)
  const setMessages = useStore((s) => s.setMessages)
  const { initialize } = useChatActions()
  const [, setAgentId] = useQueryState('agent')
  const [, setSessionId] = useQueryState('session')
  const [, setDbId] = useQueryState('db_id')

  // 挂载:设好 nuqs(agent/session/db_id)→ 现有 useAIStreamHandler 即可复用。
  useEffect(() => {
    setAgentId('deep-agent')
    setDbId('default')
    setSessionId(sessionId)
    initialize()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  // 载入这本小说的聊天历史(把 run pairs 还原成 messages)。
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const runs = await getSessionAPI(endpoint, 'agent', sessionId, undefined, token)
        if (cancelled) return
        const history: ChatMessage[] = []
        for (const r of (runs as Array<{ run_input: string; content: string; created_at: number }>) ?? []) {
          history.push({ role: 'user', content: r.run_input, created_at: r.created_at })
          history.push({ role: 'agent', content: r.content, created_at: r.created_at + 1 })
        }
        setMessages(history)
      } catch {
        /* 忽略历史加载错误，空聊天也能用 */
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  const onAccept = useCallback(
    async (content: string) => {
      if (!selectedChapterId) {
        toast.error('先选择一章再采纳')
        return
      }
      try {
        await acceptIntoChapter(endpoint, token, novelId, {
          chapterId: selectedChapterId,
          op: 'append',
          content
        })
        toast.success('已采纳到本章')
        onAccepted()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '采纳失败')
      }
    },
    [endpoint, token, novelId, selectedChapterId, onAccepted]
  )

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center justify-between px-5 py-2 text-xs text-muted">
        <span>💬 聊天 · 一本小说一份记忆</span>
        <span>✍ 目标：{selectedChapterId ? '当前章' : '未选章'}</span>
      </div>
      {/* 用自定义 Messages 渲染(带 onAccept);消息源仍是 store.messages */}
      <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-4 pb-4">
        <Messages messages={messages} onAccept={onAccept} canAccept={!!selectedChapterId} />
      </div>
      <div className="sticky bottom-0 px-4 pb-2">
        <ChatInput />
      </div>
    </div>
  )
}

export default ChatPanel
```
> `getSessionAPI` 来自已存在的 `@/api/os.ts`，签名 `(base, type, sessionId, dbId?, token?)`，返回 run pairs 数组。

- [ ] **Step 3: 挂进工作台**

`agent-ui/src/app/novels/[id]/page.tsx`:`Workspace` 里中栏占位 div 替换为:
```tsx
        <ChatPanel
          novelId={novel.id}
          sessionId={novel.sessionId}
          selectedChapterId={selectedChapterId}
          onAccepted={refresh}
        />
```
并在文件顶部 `import ChatPanel from '@/components/workspace/ChatPanel'`。

- [ ] **Step 4: typecheck + validate + build**

Run: `cd agent-ui && pnpm typecheck && pnpm validate && pnpm build`
Expected: 通过。

- [ ] **Step 5: 手动冒烟**

跑 `pnpm --dir server start:dev`(后台)+ `pnpm --dir agent-ui dev`，浏览器:登录 → `/` 新建小说 → 进入 `/novels/[id]` → 在聊天输入「写一段开头」→ AI 流式回复 → 点「采纳到本章」→ 右侧正文出现内容 → 切换/新建章节正常。

- [ ] **Step 6: Commit**

```bash
git add agent-ui/src/components/workspace/ChatPanel.tsx agent-ui/src/components/chat/ChatArea/Messages/Messages.tsx 'agent-ui/src/app/novels/[id]/page.tsx'
git commit -m "feat(agent-ui): ChatPanel with accept-to-chapter (reuse chat infra)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# M4 · 前端 · 配置页(极简)

## Task 16: `/settings` 配置页

**Files:**
- Create: `agent-ui/src/app/settings/page.tsx`

- [ ] **Step 1: 写配置页(回显模型 + endpoint + 占位)**

`agent-ui/src/app/settings/page.tsx`:
```tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useStore } from '@/store'
import { getStatusAPI } from '@/api/os'
import RequireAuth from '@/components/auth/RequireAuth'
import { Button } from '@/components/ui/button'

// 模型来自 server agentos.constants.GLM_MODEL(Phase 1 只读回显;以后接 /settings 端点)
const CURRENT_MODEL = 'GLM-5.2'

export default function SettingsPage() {
  return (
    <RequireAuth>
      <Settings />
    </RequireAuth>
  )
}

const Settings = () => {
  const router = useRouter()
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const [status, setStatus] = useState<number | null>(null)

  useEffect(() => {
    getStatusAPI(endpoint, token).then(setStatus).catch(() => setStatus(503))
  }, [endpoint, token])

  return (
    <div className="flex h-screen bg-background/80">
      <aside className="flex w-60 shrink-0 flex-col gap-3 border-r border-primary/10 px-4 py-5 font-dmmono">
        <button
          onClick={() => router.push('/')}
          className="text-left text-xs font-medium text-brand"
          type="button"
        >
          ‹ 小说库
        </button>
        <span className="text-xs font-medium uppercase text-white">设置</span>
      </aside>
      <main className="flex-1 overflow-y-auto p-8">
        <h1 className="mb-6 text-lg font-semibold text-primary">应用设置</h1>
        <div className="max-w-md space-y-4 text-sm">
          <Row label="当前模型" value={CURRENT_MODEL} />
          <Row label="后端地址" value={endpoint} />
          <Row
            label="后端状态"
            value={status === 200 ? '在线 ●' : `离线 (${status ?? '—'})`}
          />
          <div className="rounded-xl border border-primary/10 bg-background-secondary p-4 text-xs text-muted">
            <p className="mb-1 font-medium text-primary">以后会支持</p>
            <ul className="list-disc pl-4">
              <li>模型选择 / 各模型参数自定义</li>
              <li>主题切换</li>
            </ul>
          </div>
          <Button variant="ghost" size="sm" className="text-muted">
            (Phase 1 仅只读)
          </Button>
        </div>
      </main>
    </div>
  )
}

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-center justify-between rounded-xl border border-primary/10 bg-background-secondary px-4 py-3">
    <span className="text-xs uppercase text-muted">{label}</span>
    <span className="text-primary">{value}</span>
  </div>
)

export { Settings }
```

- [ ] **Step 2: typecheck + validate + build**

Run: `cd agent-ui && pnpm typecheck && pnpm validate && pnpm build`
Expected: 通过(`/settings` 路由出现)。

- [ ] **Step 3: Commit**

```bash
git add agent-ui/src/app/settings/page.tsx
git commit -m "feat(agent-ui): minimal /settings page (echo model + endpoint)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

# 收尾

## Task 17: 全量验证 + 打 tag

- [ ] **Step 1: server 全门禁**

Run: `cd server && pnpm test && pnpm lint && pnpm format && pnpm typecheck && pnpm build`
Expected: 全绿。

- [ ] **Step 2: agent-ui 全门禁**

Run: `cd agent-ui && pnpm validate && pnpm build`
Expected: 全绿;路由含 `/`、`/login`、`/register`、`/novels/[id]`、`/settings`。

- [ ] **Step 3: 端到端冒烟(手动)**

按 Task 15 Step 5 的流程跑一遍：登录 → 新建小说 → 工作台聊天 → 采纳 → 正文更新 → 新章 → 配置页回显。确认多租户隔离(换号看不到他人的小说)。

- [ ] **Step 4: 更新 CLAUDE.md(反映新结构,可选但推荐)**

在 `agent-ui/` 小节补一句:`/` 为小说库,`/novels/[id]` 为三栏工作台(资源导航/聊天/详情),`/settings` 为配置页。novel/chapter API 走 `/novels`。

- [ ] **Step 5: 合并到 main 并打 tag**

```bash
git checkout main
git merge --no-ff feat/novel-workspace -m "Merge feat/novel-workspace: novel workspace Phase 1"
git tag -a v0.2.0 -m "v0.2.0 — 小说工作台 Phase 1(库 + 工作台 + 配置 + mutation 层 + 上下文组装器)"
git log --oneline -5
```
> 推 origin 需用户确认后再 `git push origin main --tags`。

---

## Self-Review(plan ↔ spec 覆盖核对)

**Spec 覆盖:**
- §2 核心不变量(左资源/中聊天恒定/右多态) → Task 13(ResourceNav)+ Task 15(ChatPanel 中栏恒定)+ Task 14(ChapterDetail 右栏多态之“章节”视图)。
- §3 页面地图(`/`、`/novels/[id]`、`/settings`) → Task 12 / 13 / 16。
- §4 数据模型(Novel/Chapter/ChapterStatus/Session 反向关系) → Task 1。
- §5 mutation 层 + 资源 4 件套 → Task 2(类型+registry)+ Task 4(ChapterHandler)+ Task 5(accept 委托)。4 件套中“apply 服务/导航项/详情视图/上下文 slice”：apply=Task4、导航=Task13、详情=Task14、上下文 slice=Task8(ContextAssembler 目前只读 settings,P2 再加章节 slice——spec §6 已说明 P1 lite)。
- §6 上下文组装器 → Task 8 + Task 9 + Task 10。
- §7 配置页极简 → Task 16;每本小说写作设定采集 → Task 12(NewNovelForm)。
- §8 服务分离(提案/审查/抽取独立;P1 用户即审查) → 代码结构遵守(ContextAssembler 与 DeepAgentService 分离;无 LLM 自审)。
- §9 API 表 → Task 6 + 复用 `/agents/:id/runs`(Task 10 改)。
- §10 M0-M4 → Task 1-16 对应;Task 17 收尾打 tag。
- §11 P2/P3 预留 → ResourceNav 里大纲/角色/世界观/状态占位(Task 13);mutation 接口已定型(Task 2),加资源=注册 handler。
- §13 非目标 → 均未实现(无富文本编辑器、无审查、无 agent 工具、无投影扇出)。

**类型一致性核对:** `ResourceMutation.resource: ResourceType('chapter')` / `ChapterHandler.resource='chapter'` / `NovelService.accept` 构造的 mutation `resource:'chapter'` 一致;`streamTurn({threadId,userMessage,systemPrompt})` 在 service/spec/controller 三处签名一致;`acceptIntoChapter({chapterId,op,content})` ↔ `AcceptDto{chapterId,op,content}` 一致。

**已知简化(已在对应任务注明):**
- ChapterDetail 编辑态为本地 textarea，落库走 accept(Task 14 Note)。
- DeepAgentService 按 systemPrompt 缓存 agent(Task 9)，避免每轮重建。
- 历史载入用现有 `getSessionAPI`(返回 run pairs)→ 还原 messages(Task 15)。

**无占位符:** 所有 step 含可执行命令与完整代码;“以后会支持”仅出现在 `/settings` 的 UI 文案(明确标注 Phase 1 只读)，非实现占位。
