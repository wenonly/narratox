# 参考资料细粒度 Agent Tool 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 `curator` 和 `main` 两个 agent 增加 `add_reference` / `update_reference` / `delete_reference` 三个单条 NovelReference 操作工具,支持写作过程中按 id 微调参考资料,而不必每次走 `set_references` 全量覆写。

**Architecture:** 纯增量,不破坏现有 `set_references`。改动 4 层:① service 层加 `create` + `deleteOne` 方法,并给 `update` 补 title 唯一性校验;② tool 层加 3 个新 tool factory + 在 TOOL_REGISTRY 注册 + 在 `agent-tree.config.ts` 给 curator/main 分发;③ HTTP 层补 POST/DELETE 路由(对齐 PATCH,主要给未来 FE 用);④ 提示词改 curator.md / main.md。FE 一处改动:`useAIStreamHandler.tsx` 给新 tool label 也触发 `bumpReferenceWriteSeq`,右栏 R5 才会自动刷新。

**Tech Stack:** NestJS 11 + Prisma 7 + LangChain `@langchain/core/tools` + zod + class-validator + jest。

**Spec:** [docs/superpowers/specs/2026-07-09-reference-fine-grained-tools-design.md](../specs/2026-07-09-reference-fine-grained-tools-design.md)

---

## 文件清单

### 新建

- `server/src/agentos/tools/add-reference.tool.ts` — `add_reference` tool factory
- `server/src/agentos/tools/add-reference.tool.spec.ts`
- `server/src/agentos/tools/update-reference.tool.ts` — `update_reference` tool factory(字段级 patch)
- `server/src/agentos/tools/update-reference.tool.spec.ts`
- `server/src/agentos/tools/delete-reference.tool.ts` — `delete_reference` tool factory
- `server/src/agentos/tools/delete-reference.tool.spec.ts`
- `server/src/novel/dto/create-novel-reference.dto.ts` — POST 路由 DTO

### 修改

- `server/src/novel/novel-reference.service.ts` — 加 `create` / `deleteOne`;给 `update` 补 title 唯一性校验
- `server/src/novel/novel-reference.service.spec.ts` — 补 create/deleteOne/title 冲突测试
- `server/src/novel/novel.controller.ts` — 加 POST / DELETE 单条 reference 路由(在现有 PATCH 旁)
- `server/src/agentos/agent-registry.ts` — TOOL_REGISTRY 注册 3 个新 key
- `server/src/agentos/agent-tree.config.ts` — curator + main 的 `tools:[]` 各加 3 个 key
- `server/src/agentos/prompts/curator.md` — 加【增量维护】段
- `server/src/agentos/prompts/main.md` — report_review 段补一句
- `server/src/agentos/agent-prompts.spec.ts` — 锁 curator 新段 substring
- `agent-ui/src/hooks/useAIStreamHandler.tsx` — bump 触发条件加 3 个新 tool label
- `server/test/smoke/l1-integration.spec.ts` — 追加 update_reference 断言

---

## Task 1: Service 层 — create / deleteOne + update 补 title 唯一性

**Files:**
- Modify: `server/src/novel/novel-reference.service.ts`
- Test: `server/src/novel/novel-reference.service.spec.ts`

- [ ] **Step 1: 先在 spec 里写 6 个失败测试**

在 `server/src/novel/novel-reference.service.spec.ts` 文件末尾 `});` 之前追加(对照现有 mockPrisma helper,扩展 `create`/`delete` mock 字段):

```typescript
  // ===== Task 1 新增 =====

  it('create inserts a single reference and returns it', async () => {
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce({ id: 'n1', userId: 'u1' }) // assertOwned
      .mockResolvedValueOnce(null); // title uniqueness ok
    const create = jest.fn().mockResolvedValue({ id: 'r9', title: 'T' });
    const svc = new NovelReferenceService(
      mockPrisma({
        novel: { findFirst },
        novelReference: { create },
      }) as unknown as PrismaService,
    );
    const out = await svc.create('u1', 'n1', {
      title: 'T',
      content: 'C',
      category: '词汇',
      injectTo: 'writer',
    });
    expect(out).toEqual({ id: 'r9', title: 'T' });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        novelId: 'n1',
        userId: 'u1',
        title: 'T',
        content: 'C',
        category: '词汇',
        injectTo: 'writer',
        order: 0,
      }),
    });
  });

  it('create throws TITLE_DUPLICATE when title exists in same novel', async () => {
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce({ id: 'n1', userId: 'u1' }) // assertOwned
      .mockResolvedValueOnce({ id: 'existing' }); // title clash
    const create = jest.fn();
    const svc = new NovelReferenceService(
      mockPrisma({
        novel: { findFirst },
        novelReference: { create },
      }) as unknown as PrismaService,
    );
    await expect(
      svc.create('u1', 'n1', { title: 'dup', content: 'c' }),
    ).rejects.toThrow(/标题.*已存在|TITLE_DUPLICATE/i);
    expect(create).not.toHaveBeenCalled();
  });

  it('create rejects when assertOwned fails (novel not owned)', async () => {
    const svc = new NovelReferenceService(
      mockPrisma({
        novel: { findFirst: jest.fn().mockResolvedValue(null) },
      }) as unknown as PrismaService,
    );
    await expect(
      svc.create('u1', 'other', { title: 't', content: 'c' }),
    ).rejects.toThrow();
  });

  it('deleteOne removes an owned reference by id', async () => {
    const findFirst = jest.fn().mockResolvedValue({ id: 'r1', title: 'T' });
    const deleteFn = jest.fn().mockResolvedValue({ id: 'r1' });
    const svc = new NovelReferenceService(
      mockPrisma({
        novelReference: { findFirst, delete: deleteFn },
      }) as unknown as PrismaService,
    );
    const out = await svc.deleteOne('u1', 'n1', 'r1');
    expect(out).toEqual({ id: 'r1', title: 'T' });
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'r1', novelId: 'n1', novel: { userId: 'u1' } },
      select: { id: true, title: true },
    });
    expect(deleteFn).toHaveBeenCalledWith({ where: { id: 'r1' } });
  });

  it('deleteOne 404s when rid belongs to another novel (cross-tenant)', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const deleteFn = jest.fn();
    const svc = new NovelReferenceService(
      mockPrisma({
        novelReference: { findFirst, delete: deleteFn },
      }) as unknown as PrismaService,
    );
    await expect(svc.deleteOne('u1', 'n1', 'foreign')).rejects.toThrow();
    expect(deleteFn).not.toHaveBeenCalled();
  });

  it('update throws TITLE_DUPLICATE when changing title to a used one', async () => {
    // 拥有验证先通过(rid 属于本 novel),然后 title 唯一性检查发现冲突
    const ownedFindFirst = jest
      .fn()
      .mockResolvedValueOnce({ id: 'r1' }) // rid owned check
      .mockResolvedValueOnce({ id: 'r2' }); // title clash with another row
    const update = jest.fn();
    const svc = new NovelReferenceService(
      mockPrisma({
        novelReference: { findFirst: ownedFindFirst, update },
      }) as unknown as PrismaService,
    );
    await expect(
      svc.update('u1', 'n1', 'r1', { title: 'taken' }),
    ).rejects.toThrow(/标题.*已存在|TITLE_DUPLICATE/i);
    expect(update).not.toHaveBeenCalled();
  });
```

同时把顶部 `mockPrisma` 的 `novelReference` 默认对象补两个字段(整个 mock 默认对象替换):

```typescript
const mockPrisma = (overrides: Record<string, any> = {}) => ({
  novelReference: {
    findMany: jest.fn().mockResolvedValue([]),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    createMany: jest.fn().mockResolvedValue({ count: 0 }),
    create: jest.fn(),
    delete: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  novel: { findFirst: jest.fn().mockResolvedValue({ id: 'n1', userId: 'u1' }) },
  ...overrides,
});
```

- [ ] **Step 2: 运行测试,确认全部 FAIL**

```bash
cd server && pnpm test -- novel-reference.service.spec.ts
```
Expected: 6 个新 it 全 FAIL(方法不存在 / throw 语义未实现 / title 冲突未抛)。原有的 6 个旧 case 仍 PASS。

- [ ] **Step 3: 修改 `novel-reference.service.ts` 实现**

在 `NovelReferenceService` 类里追加两个方法,并改写 `update` 加 title 唯一性校验。完整替换文件内容:

```typescript
import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface ReferenceInput {
  title: string;
  category?: string;
  content?: string;
  injectTo?: string | null;
  source?: string | null;
  order?: number;
}

@Injectable()
export class NovelReferenceService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertOwned(userId: string, novelId: string) {
    const n = await this.prisma.novel.findFirst({
      where: { id: novelId, userId },
      select: { id: true },
    });
    if (!n) throw new ForbiddenException('小说不存在或不属于该用户');
  }

  /** 面板 + 索引用:全部条目。 */
  async listAll(userId: string, novelId: string) {
    await this.assertOwned(userId, novelId);
    return this.prisma.novelReference.findMany({
      where: { novelId, novel: { userId } },
      orderBy: { order: 'asc' },
    });
  }

  /** 注入用:injectTo 命中 role 或 'both'。 */
  async listForInject(userId: string, novelId: string, role: string) {
    await this.assertOwned(userId, novelId);
    return this.prisma.novelReference.findMany({
      where: {
        novelId,
        novel: { userId },
        OR: [{ injectTo: role }, { injectTo: 'both' }],
      },
      orderBy: { order: 'asc' },
    });
  }

  /** curator 批量覆写:先清后插(幂等)。 */
  async replaceAll(userId: string, novelId: string, entries: ReferenceInput[]) {
    await this.assertOwned(userId, novelId);
    await this.prisma.novelReference.deleteMany({
      where: { novelId, novel: { userId } },
    });
    if (!entries.length) return { count: 0 };
    return this.prisma.novelReference.createMany({
      data: entries.map((e, i) => ({
        novelId,
        userId,
        title: e.title,
        category: e.category ?? '',
        content: e.content ?? '',
        injectTo: e.injectTo ?? null,
        source: e.source ?? null,
        order: e.order ?? i,
      })),
    });
  }

  /** 新增单条。title 在 (userId, novelId) 内唯一,冲突抛 BadRequestException。 */
  async create(userId: string, novelId: string, dto: ReferenceInput) {
    await this.assertOwned(userId, novelId);
    await this.assertTitleUnique(userId, novelId, dto.title);
    return this.prisma.novelReference.create({
      data: {
        novelId,
        userId,
        title: dto.title,
        category: dto.category ?? '',
        content: dto.content ?? '',
        injectTo: dto.injectTo ?? null,
        source: dto.source ?? null,
        order: dto.order ?? 0,
      },
    });
  }

  /** 字段级 patch:title 改动时校验唯一性。 */
  async update(
    userId: string,
    novelId: string,
    rid: string,
    dto: Partial<ReferenceInput>,
  ) {
    await this.assertOwned(userId, novelId);
    const owned = await this.prisma.novelReference.findFirst({
      where: { id: rid, novelId, novel: { userId } },
      select: { id: true },
    });
    if (!owned) throw new NotFoundException('Reference not found');
    if (dto.title !== undefined) {
      await this.assertTitleUnique(userId, novelId, dto.title, rid);
    }
    return this.prisma.novelReference.update({
      where: { id: owned.id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.content !== undefined && { content: dto.content }),
        ...(dto.injectTo !== undefined && { injectTo: dto.injectTo }),
        ...(dto.order !== undefined && { order: dto.order }),
      },
    });
  }

  /** 删单条。rid 必须属于本 novel。 */
  async deleteOne(userId: string, novelId: string, rid: string) {
    await this.assertOwned(userId, novelId);
    const owned = await this.prisma.novelReference.findFirst({
      where: { id: rid, novelId, novel: { userId } },
      select: { id: true, title: true },
    });
    if (!owned) throw new NotFoundException('Reference not found');
    await this.prisma.novelReference.delete({ where: { id: owned.id } });
    return { id: owned.id, title: owned.title };
  }

  /** title 唯一性校验:同一 (userId, novelId) 内不能重名。excludeId 用于 update 自身排除。 */
  private async assertTitleUnique(
    userId: string,
    novelId: string,
    title: string,
    excludeId?: string,
  ) {
    const clash = await this.prisma.novelReference.findFirst({
      where: {
        title,
        novelId,
        novel: { userId },
        ...(excludeId && { NOT: { id: excludeId } }),
      },
      select: { id: true },
    });
    if (clash) {
      throw new BadRequestException(`标题「${title}」已存在`);
    }
  }
}
```

- [ ] **Step 4: 运行测试,确认全部 PASS**

```bash
cd server && pnpm test -- novel-reference.service.spec.ts
```
Expected: 全部 12+ 个 case PASS。

- [ ] **Step 5: typecheck**

```bash
cd server && pnpm typecheck
```
Expected: 无 error。(`ReferenceInput` 多了 `order?` 字段,与 `replaceAll` 内 `e.order ?? i` 兼容,旧调用不受影响。)

- [ ] **Step 6: 提交**

```bash
git add server/src/novel/novel-reference.service.ts server/src/novel/novel-reference.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(novel): NovelReferenceService 加 create/deleteOne + update 补 title 唯一性

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Tool 层 — 3 个新 tool factory

**Files:**
- Create: `server/src/agentos/tools/add-reference.tool.ts`
- Create: `server/src/agentos/tools/add-reference.tool.spec.ts`
- Create: `server/src/agentos/tools/update-reference.tool.ts`
- Create: `server/src/agentos/tools/update-reference.tool.spec.ts`
- Create: `server/src/agentos/tools/delete-reference.tool.ts`
- Create: `server/src/agentos/tools/delete-reference.tool.spec.ts`

- [ ] **Step 1: 先写 add-reference.tool.spec.ts**

```typescript
import { makeAddReferenceTool } from './add-reference.tool';
import type { NovelReferenceService } from '../../novel/novel-reference.service';

describe('add_reference tool', () => {
  it('转发到 NovelReferenceService.create 并返回 {id,title}', async () => {
    const create = jest
      .fn()
      .mockResolvedValue({ id: 'r1', title: '武器体系' });
    const references = { create } as unknown as NovelReferenceService;
    const t = makeAddReferenceTool({ userId: 'u1', novelId: 'n1', references });
    const out = await t.invoke({
      title: '武器体系',
      content: '冷兵器分阶...',
      category: '世界观',
      injectTo: 'writer',
    });
    expect(create).toHaveBeenCalledWith('u1', 'n1', {
      title: '武器体系',
      content: '冷兵器分阶...',
      category: '世界观',
      injectTo: 'writer',
    });
    expect(out).toEqual({ id: 'r1', title: '武器体系' });
  });

  it('service 抛异常时,异常原样向上抛(让 agent 看到错误)', async () => {
    const create = jest
      .fn()
      .mockRejectedValue(new Error('标题「武器体系」已存在'));
    const references = { create } as unknown as NovelReferenceService;
    const t = makeAddReferenceTool({ userId: 'u1', novelId: 'n1', references });
    await expect(
      t.invoke({ title: '武器体系', content: 'x' }),
    ).rejects.toThrow(/已存在/);
  });
});
```

- [ ] **Step 2: 写 add-reference.tool.ts**

```typescript
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { NovelReferenceService } from '../../novel/novel-reference.service';

/**
 * curator + main:新增一条本小说参考资料。title 在本小说内必须唯一。
 * userId/novelId 闭包注入(同其他 novel 工具)。
 */
export function makeAddReferenceTool({
  userId,
  novelId,
  references,
}: {
  userId: string;
  novelId: string;
  references: NovelReferenceService;
}) {
  return tool(
    async ({ title, content, category, injectTo }) => {
      const out = await references.create(userId, novelId, {
        title,
        content,
        category,
        injectTo: injectTo ?? null,
      });
      return { id: out.id, title: out.title };
    },
    {
      name: 'add_reference',
      description:
        '新增一条本小说参考资料。title 必须在本小说内唯一(冲突会报错)。injectTo 留空=仅工具可取(库原始资料);填角色名(如 main/writer/validator)=自动注入该 agent。',
      schema: z.object({
        title: z.string().describe('标题,本小说内唯一'),
        content: z.string().describe('正文(markdown)'),
        category: z.string().optional().describe('分类,如「世界观」「词汇」'),
        injectTo: z
          .string()
          .nullish()
          .describe(
            '目标 agent 角色名;留空/null=仅工具可取,填角色名=自动注入',
          ),
      }),
    },
  );
}
```

- [ ] **Step 3: 跑 spec 确认 PASS**

```bash
cd server && pnpm test -- add-reference.tool.spec.ts
```
Expected: 2 个 case PASS。

- [ ] **Step 4: 写 update-reference.tool.spec.ts**

```typescript
import { makeUpdateReferenceTool } from './update-reference.tool';
import type { NovelReferenceService } from '../../novel/novel-reference.service';

describe('update_reference tool', () => {
  it('转发到 NovelReferenceService.update,字段级 patch', async () => {
    const update = jest
      .fn()
      .mockResolvedValue({ id: 'r1', title: '新标题', content: '新内容' });
    const references = { update } as unknown as NovelReferenceService;
    const t = makeUpdateReferenceTool({
      userId: 'u1',
      novelId: 'n1',
      references,
    });
    const out = await t.invoke({ id: 'r1', content: '新内容' });
    expect(update).toHaveBeenCalledWith('u1', 'n1', 'r1', {
      content: '新内容',
    });
    expect(out.id).toBe('r1');
  });

  it('id 不传或不存在时,service 抛 NotFound,异常向上抛', async () => {
    const update = jest
      .fn()
      .mockRejectedValue(new Error('Reference not found'));
    const references = { update } as unknown as NovelReferenceService;
    const t = makeUpdateReferenceTool({
      userId: 'u1',
      novelId: 'n1',
      references,
    });
    await expect(t.invoke({ id: 'missing' })).rejects.toThrow(/not found/i);
  });
});
```

- [ ] **Step 5: 写 update-reference.tool.ts**

```typescript
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { NovelReferenceService } from '../../novel/novel-reference.service';

/**
 * curator + main:按 id 字段级 patch 一条参考资料。id 来自 get_reference。
 * 只传要改的字段,其余不动。改 title 时仍受唯一性约束。
 */
export function makeUpdateReferenceTool({
  userId,
  novelId,
  references,
}: {
  userId: string;
  novelId: string;
  references: NovelReferenceService;
}) {
  return tool(
    async ({ id, title, content, category, injectTo, order }) => {
      const dto: Record<string, unknown> = {};
      if (title !== undefined) dto.title = title;
      if (content !== undefined) dto.content = content;
      if (category !== undefined) dto.category = category;
      if (injectTo !== undefined) dto.injectTo = injectTo;
      if (order !== undefined) dto.order = order;
      const out = await references.update(userId, novelId, id, dto);
      const updatedFields = Object.keys(dto);
      return { id: out.id, title: out.title, updatedFields };
    },
    {
      name: 'update_reference',
      description:
        '按 id 字段级修改一条参考资料(只传要改的字段)。id 从 get_reference 取。改 title 时仍受唯一性约束(冲突报错)。',
      schema: z.object({
        id: z.string().describe('参考资料 id,来自 get_reference 返回'),
        title: z.string().optional(),
        content: z.string().optional(),
        category: z.string().optional(),
        injectTo: z
          .string()
          .nullish()
          .describe('改注入目标角色,或传 null 改为仅工具可取'),
        order: z.number().optional(),
      }),
    },
  );
}
```

- [ ] **Step 6: 跑 spec 确认 PASS**

```bash
cd server && pnpm test -- update-reference.tool.spec.ts
```
Expected: 2 个 case PASS。

- [ ] **Step 7: 写 delete-reference.tool.spec.ts**

```typescript
import { makeDeleteReferenceTool } from './delete-reference.tool';
import type { NovelReferenceService } from '../../novel/novel-reference.service';

describe('delete_reference tool', () => {
  it('转发到 NovelReferenceService.deleteOne 并返回 {id,title}', async () => {
    const deleteOne = jest
      .fn()
      .mockResolvedValue({ id: 'r1', title: '武器体系' });
    const references = { deleteOne } as unknown as NovelReferenceService;
    const t = makeDeleteReferenceTool({
      userId: 'u1',
      novelId: 'n1',
      references,
    });
    const out = await t.invoke({ id: 'r1' });
    expect(deleteOne).toHaveBeenCalledWith('u1', 'n1', 'r1');
    expect(out).toEqual({ id: 'r1', title: '武器体系' });
  });

  it('id 不属于本 novel 时,service 抛 NotFound', async () => {
    const deleteOne = jest
      .fn()
      .mockRejectedValue(new Error('Reference not found'));
    const references = { deleteOne } as unknown as NovelReferenceService;
    const t = makeDeleteReferenceTool({
      userId: 'u1',
      novelId: 'n1',
      references,
    });
    await expect(t.invoke({ id: 'foreign' })).rejects.toThrow(/not found/i);
  });
});
```

- [ ] **Step 8: 写 delete-reference.tool.ts**

```typescript
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { NovelReferenceService } from '../../novel/novel-reference.service';

/**
 * curator + main:按 id 删一条参考资料。id 必须属于本 novel(跨租户 404)。
 */
export function makeDeleteReferenceTool({
  userId,
  novelId,
  references,
}: {
  userId: string;
  novelId: string;
  references: NovelReferenceService;
}) {
  return tool(
    async ({ id }) => references.deleteOne(userId, novelId, id),
    {
      name: 'delete_reference',
      description:
        '按 id 删一条参考资料。id 从 get_reference 取。删除后不可恢复,慎用。',
      schema: z.object({
        id: z.string().describe('要删除的参考资料 id'),
      }),
    },
  );
}
```

- [ ] **Step 9: 跑 3 个新 tool spec**

```bash
cd server && pnpm test -- add-reference update-reference delete-reference
```
Expected: 全 PASS(6 个 case)。

- [ ] **Step 10: 提交**

```bash
git add server/src/agentos/tools/add-reference.tool.ts \
        server/src/agentos/tools/add-reference.tool.spec.ts \
        server/src/agentos/tools/update-reference.tool.ts \
        server/src/agentos/tools/update-reference.tool.spec.ts \
        server/src/agentos/tools/delete-reference.tool.ts \
        server/src/agentos/tools/delete-reference.tool.spec.ts
git commit -m "$(cat <<'EOF'
feat(agentos): 加 add/update/delete_reference 三个 tool factory

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 注册 + 分发 — TOOL_REGISTRY + agent-tree.config

**Files:**
- Modify: `server/src/agentos/agent-registry.ts`(在 `set_references` 旁)
- Modify: `server/src/agentos/agent-tree.config.ts`(curator + main 的 `tools:[]`)

- [ ] **Step 1: 在 agent-registry.ts 顶部 import 段追加 3 个 import**

先读 import 段找到现有的 reference 相关 import 位置:

```bash
grep -n "set-references.tool\|get-reference.tool" server/src/agentos/agent-registry.ts
```

期望看到 import 行类似:
```
import { makeSetReferencesTool } from './tools/set-references.tool';
import { makeGetReferenceTool } from './tools/get-reference.tool';
```

在它们下方追加:

```typescript
import { makeAddReferenceTool } from './tools/add-reference.tool';
import { makeUpdateReferenceTool } from './tools/update-reference.tool';
import { makeDeleteReferenceTool } from './tools/delete-reference.tool';
```

- [ ] **Step 2: 在 TOOL_REGISTRY 的 `set_references` 条目之后追加 3 个条目**

定位:

```bash
grep -n "set_references:" server/src/agentos/agent-registry.ts
```

读该行到下一个 `}` 结束,在 `set_references: (d) => ... })` 之后追加(注意 `references` 字段在 deps 里已有,沿用):

```typescript
  add_reference: (d) =>
    makeAddReferenceTool({
      userId: d.userId,
      novelId: d.novelId,
      references: d.references,
    }),
  update_reference: (d) =>
    makeUpdateReferenceTool({
      userId: d.userId,
      novelId: d.novelId,
      references: d.references,
    }),
  delete_reference: (d) =>
    makeDeleteReferenceTool({
      userId: d.userId,
      novelId: d.novelId,
      references: d.references,
    }),
```

> **验证 deps 已有 `references`:** 跑 `grep -n "references" server/src/agentos/agent-registry.ts | head` 应看到 `references:` 字段在 deps 类型/toolDeps 构造里。若没有,需在 deps 类型补 `references: NovelReferenceService` 字段并从 provider 注入。实际已存在(被 `set_references` 用)。

- [ ] **Step 3: 在 agent-tree.config.ts 给 curator 节点加 3 个 key**

定位(应得 `tools: ['list_knowledge', 'get_knowledge', 'set_references', 'get_reference']`,约 176-181 行):

```bash
grep -n "set_references" server/src/agentos/agent-tree.config.ts
```

把 curator 的 `tools: [...]` 改为:

```typescript
      tools: [
        'list_knowledge',
        'get_knowledge',
        'set_references',
        'get_reference',
        'add_reference',
        'update_reference',
        'delete_reference',
      ],
```

- [ ] **Step 4: 给 main 节点(顶层 AgentSpec,tools 数组约 86-100 行)追加 3 个 key**

定位 `get_reference,` 在 main tools 里(约 98 行),在其下方追加 3 行:

```bash
grep -n "get_reference" server/src/agentos/agent-tree.config.ts
```

把 main 节点的 tools 数组改为(在 `'get_reference',` 后加 3 行,同时 `'get_benchmark',` 保持末尾):

```typescript
  tools: [
    'get_novel_info',
    'update_novel',
    'get_reading_chapter',
    'get_outline',
    'get_chapter_plan',
    'get_worldview',
    'get_world_entry',
    'get_character',
    'get_characters',
    'get_events',
    'get_arcs',
    'get_reference',
    'add_reference',
    'update_reference',
    'delete_reference',
    'get_benchmark',
  ],
```

- [ ] **Step 5: typecheck + 跑全套测试确认无 regression**

```bash
cd server && pnpm typecheck && pnpm test
```
Expected: typecheck 通过,所有 spec PASS(61+ 套现有 + Task 1/2 新增的 9 个 case)。

- [ ] **Step 6: 提交**

```bash
git add server/src/agentos/agent-registry.ts server/src/agentos/agent-tree.config.ts
git commit -m "$(cat <<'EOF'
feat(agentos): 注册 add/update/delete_reference 并分发给 curator + main

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: HTTP 路由 — POST + DELETE

**Files:**
- Create: `server/src/novel/dto/create-novel-reference.dto.ts`
- Modify: `server/src/novel/novel.controller.ts`(现有 PATCH 旁)

- [ ] **Step 1: 写 create-novel-reference.dto.ts**

```typescript
import { IsOptional, IsString, IsInt, Min } from 'class-validator';

export class CreateNovelReferenceDto {
  @IsString()
  title!: string;

  @IsString()
  content!: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  injectTo?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}
```

- [ ] **Step 2: 在 novel.controller.ts 加 POST + DELETE 路由**

先定位现有 PATCH references 路由:

```bash
grep -n "references" server/src/novel/novel.controller.ts
```

期望找到类似:

```typescript
@Patch(':id/references/:rid')
async updateReference(...) { ... }
```

在该路由紧邻位置(同文件内,controller class 里)追加:

```typescript
  @Post(':id/references')
  async createReference(
    @CurrentUser() user: { id: string },
    @Param('id') novelId: string,
    @Body() dto: CreateNovelReferenceDto,
  ) {
    return this.references.create(user.id, novelId, dto);
  }

  @Delete(':id/references/:rid')
  async deleteReference(
    @CurrentUser() user: { id: string },
    @Param('id') novelId: string,
    @Param('rid') rid: string,
  ) {
    return this.references.deleteOne(user.id, novelId, rid);
  }
```

并在文件顶部 import 段加:

```typescript
import { CreateNovelReferenceDto } from './dto/create-novel-reference.dto';
```

- [ ] **Step 3: typecheck**

```bash
cd server && pnpm typecheck
```
Expected: 无 error。若报 `CurrentUser` / `Param` / `Body` / `Delete` 未导入,补 import(从 `@nestjs/common`)。

- [ ] **Step 4: 跑现有 controller spec 确认无 regression**

```bash
cd server && pnpm test -- novel.controller.spec.ts
```
Expected: 现有 case PASS。

- [ ] **Step 5: 提交**

```bash
git add server/src/novel/dto/create-novel-reference.dto.ts server/src/novel/novel.controller.ts
git commit -m "$(cat <<'EOF'
feat(novel): 加 POST/DELETE /novels/:id/references 路由(对齐 PATCH)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: 提示词 — curator.md + main.md + spec lock

**Files:**
- Modify: `server/src/agentos/prompts/curator.md`
- Modify: `server/src/agentos/prompts/main.md`
- Modify: `server/src/agentos/agent-prompts.spec.ts`

- [ ] **Step 1: 读 curator.md 找到「set_references 初始化」段**

```bash
grep -n "set_references" server/src/agentos/prompts/curator.md
```

定位到描述"用 `set_references` 写入"的段落。

- [ ] **Step 2: 在该段之后追加【增量维护】段**

在 curator.md 中找到的初始化段后,追加(若已有「增量」相关段,合并而不是重复):

```markdown
### 增量维护

**初始化用 `set_references` 一次批量写入。** 之后若需要微调(改一条、删一条、加一条),**禁止**再次调用 `set_references`——它会清空全部条目后重建,会丢失其他条目。增量场景一律用:

- `add_reference({title, content, ...})` —— 新增单条
- `update_reference({id, ...要改的字段})` —— 字段级 patch(id 从 `get_reference` 取)
- `delete_reference({id})` —— 删单条
```

- [ ] **Step 3: 读 main.md 找到 report_review 处理段**

```bash
grep -n "report_review" server/src/agentos/prompts/main.md
```

- [ ] **Step 4: 在 report_review 处理段中补一句**

在该段合适位置(描述收到 review 报告后如何处理的地方)追加:

```markdown
若 review 指向某条参考资料(`NovelReference`)过时或有误,可先用 `get_reference(title=...)` 拿到 id,再用 `update_reference` / `delete_reference` 直接改;或委托 curator 处理。
```

- [ ] **Step 5: 在 agent-prompts.spec.ts 补 substring 锁**

```bash
grep -n "CURATOR" server/src/agentos/agent-prompts.spec.ts
```

找到 curator 的 substring 锁 case,在该 it 内追加一个 expect(若没有独立 case,加一个新 it)。示例:

```typescript
it('curator prompt 含【增量维护】段', () => {
  expect(PROMPTS.CURATOR).toContain('增量维护');
  expect(PROMPTS.CURATOR).toContain('add_reference');
  expect(PROMPTS.CURATOR).toContain('update_reference');
  expect(PROMPTS.CURATOR).toContain('delete_reference');
});
```

(具体 it 风格对照文件里已有的 case 写。)

- [ ] **Step 6: 跑 spec 确认 PASS**

```bash
cd server && pnpm test -- agent-prompts.spec.ts
```
Expected: PASS(新 it 的 4 个 expect 全通过)。

- [ ] **Step 7: 提交**

```bash
git add server/src/agentos/prompts/curator.md server/src/agentos/prompts/main.md server/src/agentos/agent-prompts.spec.ts
git commit -m "$(cat <<'EOF'
docs(prompt): curator + main 提示词加细粒度参考资料工具指引

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: FE — bumpReferenceWriteSeq 触发条件加 3 个新 label

**Files:**
- Modify: `agent-ui/src/hooks/useAIStreamHandler.tsx`(约 425 行)

- [ ] **Step 1: 定位**

```bash
grep -n "bumpReferenceWriteSeq\|set_references" agent-ui/src/hooks/useAIStreamHandler.tsx
```

找到:

```typescript
// set_references → 刷新参考资料面板(curator 覆写后)
if (activities[a.id].label === 'set_references') {
  useStore.getState().bumpReferenceWriteSeq()
}
```

- [ ] **Step 2: 改为多 label 触发**

替换为:

```typescript
// set_references / add_reference / update_reference / delete_reference
// → 刷新参考资料面板(curator 覆写 + main/curator 增量微调)
if (
  activities[a.id].label === 'set_references' ||
  activities[a.id].label === 'add_reference' ||
  activities[a.id].label === 'update_reference' ||
  activities[a.id].label === 'delete_reference'
) {
  useStore.getState().bumpReferenceWriteSeq()
}
```

- [ ] **Step 3: typecheck + lint**

```bash
cd agent-ui && pnpm typecheck && pnpm lint
```
Expected: 无 error。

- [ ] **Step 4: 提交**

```bash
git add agent-ui/src/hooks/useAIStreamHandler.tsx
git commit -m "$(cat <<'EOF'
feat(agent-ui): 新 reference tool label 也触发参考资料面板刷新

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: L1 集成测试断言 — update_reference 不触发清空

**Files:**
- Modify: `server/test/smoke/l1-integration.spec.ts`

- [ ] **Step 1: 读现有 L1 spec,找到 references 相关 setup**

```bash
grep -n "reference\|set_references" server/test/smoke/l1-integration.spec.ts
```

了解测试如何 setup NovelReference(可能通过直接 prisma 写入或 `set_references` tool)。

- [ ] **Step 2: 追加一个新 it —— update_reference 不清空其他条目**

在 describe 块内合适位置加(若 L1 不依赖真实 agent run,而是直接调 service,参考已有 case 的写法):

```typescript
it('update_reference 改单条,不触发 set_references 的清空行为', async () => {
  // setup: 用 replaceAll 建两条
  await references.replaceAll(user.id, novel.id, [
    { title: 'A', content: 'a-content', injectTo: 'writer' },
    { title: 'B', content: 'b-content', injectTo: 'writer' },
  ]);
  const all = await references.listAll(user.id, novel.id);
  expect(all.length).toBe(2);
  const target = all.find((r) => r.title === 'B')!;

  // 用 update 改 B
  await references.update(user.id, novel.id, target.id, {
    content: 'b-updated',
  });

  // 两条都在,且只有 B 的 content 变了
  const after = await references.listAll(user.id, novel.id);
  expect(after.length).toBe(2);
  const bAfter = after.find((r) => r.id === target.id)!;
  expect(bAfter.content).toBe('b-updated');
  const aAfter = after.find((r) => r.title === 'A')!;
  expect(aAfter.content).toBe('a-content');
});
```

(若 L1 harness 没有 `references` 直接注入,通过 prisma 直接写入 2 条,然后通过 service 方法或 HTTP PATCH 路由调用。参考文件内已有 case 的 setup 风格。)

- [ ] **Step 3: 跑 L1**

```bash
cd server && pnpm test -- l1-integration
```
Expected: PASS(新 it + 原有 it 全过)。若 L1 需要真实 DB,确认本地有 PostgreSQL + `DATABASE_URL` 配好,参考 CLAUDE.md 的 server test 命令。

- [ ] **Step 4: 提交**

```bash
git add server/test/smoke/l1-integration.spec.ts
git commit -m "$(cat <<'EOF'
test(smoke): L1 锁 update_reference 不触发全量清空

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: 全量验证

- [ ] **Step 1: 全量测试**

```bash
cd server && pnpm test
```
Expected: 全部 PASS,套数比改动前 +1(curator prompt 锁)+3(tool spec 3 个新文件)+ L1 +1 ≈ 增加 5-10 个 case。

- [ ] **Step 2: typecheck + lint**

```bash
cd server && pnpm typecheck && pnpm lint
cd .. && cd agent-ui && pnpm typecheck && pnpm lint
```
Expected: 全 clean。

- [ ] **Step 3: agent build 模型解析路径**

手动确认 `AGENT_TREE` 里 curator/main 的 tools 解析无报错(若 server 启动时会跑 `buildAgentGraph`,启动失败说明 TOOL_REGISTRY 缺 key):

```bash
cd server && pnpm start:dev
# 看启动日志,期望无 "Unknown tool key: add_reference" 类报错
# Ctrl-C 停止
```

- [ ] **Step 4: 手动 E2E(可选,需真实模型)**

```
1. 启动 server + agent-ui(pnpm dev)
2. 打开一本已有参考资料的小说(让 curator 先跑过一次 set_references)
3. 在 chat 里对 main 说:"把参考资料里的「XXX」那条精简成两句话"
4. 观察:
   - main 调 get_reference(title=XXX) 拿到 id
   - main 调 update_reference(id, content=...) 而非 set_references
   - 右栏 R5 自动刷新(无需手动刷新页面)
   - 其他参考资料条目仍在(未被清空)
```

---

## Self-Review 检查

**Spec coverage:**
- ✅ 工具契约(add/update/delete,id,字段级 patch)→ Task 1+2
- ✅ 分发(curator + main)→ Task 3
- ✅ 安全约束(多租户 scoped + title 唯一性)→ Task 1
- ✅ HTTP 路由(POST/DELETE)→ Task 4
- ✅ 提示词改动 → Task 5
- ✅ FE 零代码改动(改为"1 处小改动",触发 bump)→ Task 6
- ✅ L0 / L1 测试 → Task 1/2/7
- ✅ 无 DB 迁移 → 全程不动 schema.prisma

**Placeholder scan:** 无 TBD/TODO,每个 step 有完整代码。

**Type consistency:** `ReferenceInput` 增 `order?` 字段,与 `replaceAll`/`create`/`update` 一致;tool schema 与 service DTO 字段名一致(title/content/category/injectTo/order + id)。
