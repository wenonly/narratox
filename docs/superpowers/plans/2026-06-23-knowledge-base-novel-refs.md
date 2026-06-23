# 小说级参考资料 + 写作注入 Implementation Plan (Plan 2/2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 立项信息齐时,curator 子 agent 从全局 KB 提炼出本小说的专属参考资料(`NovelReference`,带 `injectTo` 标注),固化进 DB;之后写大纲/写正文时,标注的条目自动注入对应 agent 的 context,其余条目由 agent 用 `get_reference` 工具按需拉取;工作台左侧加「参考资料」面板可查看。

**Architecture:** 新 `NovelReference` Prisma 模型 + `NovelReferenceService`(镜像 `WorldEntryService`)。新增 3 个 agent 工具:`search_knowledge`(curator 查全局 KB)、`set_references`(curator 批量覆写)、`get_reference`(main+writer 按需查)。`DeepAgentService` 加第 4 个子 agent `curator`(与 `chapter` 同级),并把 writer 的静态 prompt 改为「每轮按 novel 现拼」注入 {writer,both} 条目 + 全量索引。`ContextAssembler` 给 main 注入 {main,both} 条目 + 索引。FE IconRail/ResourcePanel 加「参考资料」视图,带 `referenceWriteSeq` 缓存失效。

**Tech Stack:** NestJS 11 + Prisma 7(jest 单测)、Next.js(`pnpm validate` 门)、LangChain `createAgent` + `createSubAgentMiddleware`(注意:**不是** `createDeepAgent`)。

**关联:** spec [docs/superpowers/specs/2026-06-23-novel-knowledge-base-design.md](../specs/2026-06-23-novel-knowledge-base-design.md) §3.1/§4/§5/§6.2/§7/§8。依赖 Plan 1 的 `KnowledgeService`(已 `exports`)。

**前提:** Plan 1 已合并到本分支(`feat/novel-knowledge-base`)。`KnowledgeService.search/getEntry` 可用。

---

## 关键代码地图(执行时照此定位,勿偏离)

- `server/src/agentos/deep-agent.service.ts`:用 `createAgent` + `createSubAgentMiddleware`;`runTurn`(行 ~99)在 `createAgent`(行 ~155)前可加 async 预取;subagents 数组里 `chapter`(行 ~220–294)之后插入 `curator`;writer 子 agent(行 ~248)prompt 由常量 `WRITER_AGENT_PROMPT` 改为变量;构造器(行 ~68–82)注入新 service。
- `server/src/agentos/agent-prompts.ts`:导出 6 个常量;新增 `CURATOR_AGENT_PROMPT`;`MAIN_AGENT_PROMPT` 的 CONCEPT 段加「委派 curator」指令。
- `server/src/agentos/tools/set-world-entry.tool.ts`:工具工厂模板(`make<Name>Tool({userId,novelId,service})` + `tool(handler,{name,description,schema})`)。
- `server/src/novel/world-entry.service.ts`:`NovelReferenceService` 的模板(`assertOwned` + 按 `novel:{userId}` 范围)。
- `server/prisma/schema.prisma`:`WorldEntry` 模型(行 ~203)是 `NovelReference` 的模板;迁移 `pnpm exec prisma migrate dev --name add_novel_reference`(无 `--schema`)。
- `agent-ui/src/store.ts`:`worldEntryWriteSeq` 等(行 ~52–65,113–117,156–165)是 `referenceWriteSeq` 的模板。
- `agent-ui/src/components/workspace/IconRail.tsx`(`RESOURCES`+`ResourceKey`)、`ResourcePanel.tsx`(`TITLES`+switch+`WorldView` 组件模板)。
- `agent-ui/src/api/novels.ts` + `routes.ts`:`getWorldview`/`updateChapter` 是 novel-scoped GET/PATCH 模板。

---

## 文件结构

**新增(server)**
- `server/src/novel/novel-reference.service.ts` + `.spec.ts`
- `server/src/novel/dto/update-novel-reference.dto.ts`
- `server/src/agentos/tools/search-knowledge.tool.ts` + `.spec.ts`
- `server/src/agentos/tools/set-references.tool.ts` + `.spec.ts`
- `server/src/agentos/tools/get-reference.tool.ts` + `.spec.ts`

**修改(server)**
- `server/prisma/schema.prisma`(加 `NovelReference` + Novel/User 反向关系)
- `server/src/novel/novel.controller.ts`(2 路由)
- `server/src/novel/novel.module.ts`(注册 service)
- `server/src/agentos/agent-prompts.ts`(加 `CURATOR_AGENT_PROMPT`;改 `MAIN_AGENT_PROMPT` CONCEPT 段)
- `server/src/agentos/deep-agent.service.ts`(注入 service、加 curator 子 agent、writer prompt 动态化、注册 get_reference)
- `server/src/agentos/context-assembler.service.ts`(main 注入【写作参考】slice)
- `server/src/agentos/agentos.module.ts` 或 `deep-agent.service.ts` 的工具装配(确认 `KnowledgeService` 可注入)

**新增(agent-ui)**
- `agent-ui/src/components/workspace/ReferencesView.tsx`

**修改(agent-ui)**
- `agent-ui/src/types/novel.ts`(加 `NovelReference` 类型)
- `agent-ui/src/api/routes.ts` + `agent-ui/src/api/novels.ts`(`getNovelReferences`/`patchNovelReference`)
- `agent-ui/src/store.ts`(`referenceWriteSeq` + `bumpReferenceWriteSeq`)
- `agent-ui/src/hooks/useAIStreamHandler.tsx`(`set_references` 工具结果落地时 bump)
- `agent-ui/src/components/workspace/IconRail.tsx` + `ResourcePanel.tsx`(加 `references`)

---

## Task 1: Prisma NovelReference 模型 + 迁移

**Files:** Modify `server/prisma/schema.prisma`

- [ ] **Step 1: 加模型(镜像 WorldEntry)**

在 `WorldEntry` 模型后加:
```prisma
model NovelReference {
  id        String   @id @default(cuid())
  novelId   String
  novel     Novel    @relation(fields: [novelId], references: [id], onDelete: Cascade)
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  title     String
  category  String   @default("")
  content   String   @default("")
  injectTo  String?  // 'main' | 'writer' | 'both' | null
  source    String?  // provenance: 全局 KB 条目 id 列表(JSON 串)
  order     Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([novelId])
}
```

- [ ] **Step 2: 加反向关系**

`Novel` 模型加 `references NovelReference[]`;`User` 模型加 `novelReferences NovelReference[]`。

- [ ] **Step 3: 生成迁移 + 应用**

```bash
cd server && pnpm exec prisma migrate dev --name add_novel_reference
```
Expected: 生成 `prisma/migrations/<ts>_add_novel_reference/` 并应用到库;`pnpm typecheck` 通过(Prisma client 重新生成)。

- [ ] **Step 4: Commit**

```bash
git add server/prisma/schema.prisma server/prisma/migrations/
git commit -m "feat(novel-reference): NovelReference 模型 + 迁移"
```

---

## Task 2: NovelReferenceService + 单测

**Files:** Create `server/src/novel/novel-reference.service.ts` + `.spec.ts`

- [ ] **Step 1: 写失败测试 `novel-reference.service.spec.ts`**

镜像 `world-entry.service.spec.ts` 的风格(double 掉 Prisma)。核心用例:
```typescript
import { NovelReferenceService } from './novel-reference.service';

const mockPrisma = (overrides: Record<string, any> = {}) => ({
  novelReference: {
    findMany: jest.fn().mockResolvedValue([]),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    createMany: jest.fn().mockResolvedValue({ count: 0 }),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  novel: { findFirst: jest.fn().mockResolvedValue({ id: 'n1', userId: 'u1' }) },
  ...overrides,
});

describe('NovelReferenceService', () => {
  it('listForInject returns entries whose injectTo matches the role', async () => {
    const svc = new NovelReferenceService(mockPrisma({
      novelReference: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'r1', injectTo: 'writer', title: 't1', content: 'c1', category: '词汇' },
          { id: 'r2', injectTo: 'both', title: 't2', content: 'c2', category: '须知' },
        ]),
      },
    }) as any);
    const res = await svc.listForInject('u1', 'n1', 'writer');
    expect(res.map((r) => r.id)).toEqual(['r1', 'r2']); // writer + both
  });

  it('listAll returns all entries for the novel (for the index + panel)', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'r1' }, { id: 'r2' }]);
    const svc = new NovelReferenceService(mockPrisma({
      novelReference: { findMany },
    }) as any);
    expect((await svc.listAll('u1', 'n1')).length).toBe(2);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { novelId: 'n1', novel: { userId: 'u1' } },
      orderBy: { order: 'asc' },
    }));
  });

  it('replaceAll clears then bulk-inserts (idempotent curator rerun)', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 3 });
    const createMany = jest.fn().mockResolvedValue({ count: 2 });
    const svc = new NovelReferenceService(mockPrisma({
      novelReference: { deleteMany, createMany, findMany: jest.fn().mockResolvedValue([]) },
    }) as any);
    await svc.replaceAll('u1', 'n1', [
      { title: 't1', category: '方法论', content: 'c1', injectTo: 'main' },
      { title: 't2', category: '词汇', content: 'c2', injectTo: 'writer' },
    ]);
    expect(deleteMany).toHaveBeenCalledWith({ where: { novelId: 'n1', novel: { userId: 'u1' } } });
    expect(createMany).toHaveBeenCalled();
  });

  it('assertOwned throws when novel does not belong to user', async () => {
    const svc = new NovelReferenceService(mockPrisma({
      novel: { findFirst: jest.fn().mockResolvedValue(null) },
    }) as any);
    await expect(svc.replaceAll('u1', 'other', [])).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 跑测试确认失败** — `cd server && pnpm test -- novel-reference.service.spec.ts` → FAIL.

- [ ] **Step 3: 实现 `novel-reference.service.ts`**

```typescript
import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type InjectRole = 'main' | 'writer';

export interface ReferenceInput {
  title: string;
  category?: string;
  content?: string;
  injectTo?: string | null;
  source?: string | null;
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

  /** 注入用:injectTo 命中 role(main 命中 main+both;writer 命中 writer+both)。 */
  async listForInject(userId: string, novelId: string, role: InjectRole) {
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
        order: i,
      })),
    });
  }

  async getOne(userId: string, novelId: string, rid: string) {
    await this.assertOwned(userId, novelId);
    return this.prisma.novelReference.findUnique({ where: { id: rid } });
  }

  async update(userId: string, novelId: string, rid: string, dto: Partial<ReferenceInput>) {
    await this.assertOwned(userId, novelId);
    return this.prisma.novelReference.update({
      where: { id: rid },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.content !== undefined && { content: dto.content }),
        ...(dto.injectTo !== undefined && { injectTo: dto.injectTo }),
      },
    });
  }
}
```

- [ ] **Step 4: 跑测试确认通过** — `pnpm test -- novel-reference.service.spec.ts` → 4 cases PASS.

- [ ] **Step 5: Commit** — `git add server/src/novel/novel-reference.service.*` → `feat(novel-reference): NovelReferenceService + 单测`

---

## Task 3: Novel 控制器路由 + 注册 service

**Files:** Modify `novel.controller.ts`、`novel.module.ts`;Create `dto/update-novel-reference.dto.ts`

- [ ] **Step 1: DTO `server/src/novel/dto/update-novel-reference.dto.ts`**

```typescript
import { IsOptional, IsString } from 'class-validator';
export class UpdateNovelReferenceDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() content?: string;
  @IsOptional() @IsString() injectTo?: string | null;
}
```

- [ ] **Step 2: 控制器加 2 路由**(放在 `@Get(':id')` 系列之后,镜像 `getWorldview`)

```typescript
@Get(':id/references')
getReferences(@CurrentUser() user: RequestUser, @Param('id') id: string) {
  return this.references.listAll(user.id, id);
}

@Patch(':id/references/:rid')
updateReference(
  @CurrentUser() user: RequestUser,
  @Param('id') id: string,
  @Param('rid') rid: string,
  @Body() dto: UpdateNovelReferenceDto,
) {
  return this.references.update(user.id, id, rid, dto);
}
```
构造器注入 `private readonly references: NovelReferenceService`。

- [ ] **Step 3: `novel.module.ts` providers + exports 加 `NovelReferenceService`**(镜像 `WorldEntryService`)。

- [ ] **Step 4: 控制器单测** `novel.controller.spec.ts`(补到现有 spec,镜像其 double 风格)。新增:

```typescript
describe('NovelController references', () => {
  it('GET :id/references delegates to references.listAll', async () => {
    const references = { listAll: jest.fn().mockResolvedValue([]), update: jest.fn() };
    const controller = new NovelController(/* 现有 doubles */, references as any);
    await controller.getReferences({ id: 'u1' } as any, 'n1');
    expect(references.listAll).toHaveBeenCalledWith('u1', 'n1');
  });

  it('PATCH :id/references/:rid delegates to references.update', async () => {
    const references = { listAll: jest.fn(), update: jest.fn().mockResolvedValue({ id: 'r1' }) };
    const controller = new NovelController(/* 现有 doubles */, references as any);
    await controller.updateReference({ id: 'u1' } as any, 'n1', 'r1', { injectTo: 'both' } as any);
    expect(references.update).toHaveBeenCalledWith('u1', 'n1', 'r1', expect.objectContaining({ injectTo: 'both' }));
  });
});
```
(沿用现有 `novel.controller.spec.ts` 构造 controller 的方式——若它用 fixture 工厂,把 `references` double 加进该工厂。)

- [ ] **Step 5: `cd server && pnpm test` 全绿** + `pnpm typecheck` 干净。

- [ ] **Step 6: Commit** — `feat(novel-reference): GET/PATCH /novels/:id/references`

---

## Task 4: search_knowledge 工具(curator)

**Files:** Create `server/src/agentos/tools/search-knowledge.tool.ts` + `.spec.ts`

- [ ] **Step 1: 写失败测试** — double 掉 `KnowledgeService`,验证 query/category 透传、返回 `getEntry` 拼出的 `{title,category,content,source}` 数组。

- [ ] **Step 2: 实现**

```typescript
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { KnowledgeService } from '../../knowledge/knowledge.service';

export function makeSearchKnowledgeTool({ kb }: { kb: KnowledgeService }) {
  return tool(
    async ({ query, category }) => {
      const entries = await kb.search(query, { category: category || undefined, limit: 8 });
      const out = [];
      for (const e of entries) {
        const full = await kb.getEntry(e.id);
        out.push({ id: e.id, title: e.name, category: e.category, content: full?.content ?? '' });
      }
      return out;
    },
    {
      name: 'search_knowledge',
      description: '搜索全局写作知识库(方法论/拆文案例/词汇/须知/模板/人设)。返回最相关条目的完整内容。立项时为本书挑选参考资料用。',
      schema: z.object({
        query: z.string().describe('搜索关键词,如题材名「悬疑」或主题「开头切入」'),
        category: z.string().optional().describe('可选分类:方法论教程/拆文案例/词汇素材库/创作须知/公式模板/人设档案'),
      }),
    },
  );
}
```
注:`userId`/`novelId` 不需要(全局 KB 共享)。

- [ ] **Step 3: 测试通过** + Commit — `feat(knowledge): search_knowledge 工具(curator)`

---

## Task 5: set_references 工具(curator)

**Files:** Create `server/src/agentos/tools/set-references.tool.ts` + `.spec.ts`

- [ ] **Step 1: 写失败测试** — double `NovelReferenceService.replaceAll`,验证 entries 透传、返回 `{ok,count}`。

- [ ] **Step 2: 实现**

```typescript
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { NovelReferenceService } from '../../novel/novel-reference.service';

export function makeSetReferencesTool({
  userId, novelId, references,
}: {
  userId: string; novelId: string; references: NovelReferenceService;
}) {
  return tool(
    async ({ entries }) => {
      const res = await references.replaceAll(userId, novelId, entries.map((e: any) => ({
        title: e.title, category: e.category, content: e.content,
        injectTo: e.injectTo ?? null, source: e.source ?? null,
      })));
      return { ok: true as const, count: (res as any).count ?? entries.length };
    },
    {
      name: 'set_references',
      description: '批量覆写本小说的参考资料(先清后写,可重跑)。每条需指定 injectTo: main=自动进主agent上下文(大纲/方法论); writer=自动进写手上下文(词汇/描写/案例); both=两者都进(须知/规则); 不填=仅工具可取。务必去重、删冗余、留本书所需。',
      schema: z.object({
        entries: z.array(z.object({
          title: z.string(),
          category: z.string().optional(),
          content: z.string().describe('提炼后的正文(markdown),精简去冗余'),
          injectTo: z.enum(['main', 'writer', 'both']).optional(),
          source: z.string().optional().describe('来源全局KB条目id,逗号分隔'),
        })),
      }),
    },
  );
}
```

- [ ] **Step 3: 测试通过** + Commit — `feat(novel-reference): set_references 工具(curator 批量覆写)`

---

## Task 6: get_reference 工具(main+writer)

**Files:** Create `server/src/agentos/tools/get-reference.tool.ts` + `.spec.ts`

- [ ] **Step 1: 写失败测试** — double service,验证按 title 模糊查 / 按 category 查,返回 top-3 完整内容。

- [ ] **Step 2: 实现**

```typescript
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { NovelReferenceService } from '../../novel/novel-reference.service';

export function makeGetReferenceTool({
  userId, novelId, references,
}: {
  userId: string; novelId: string; references: NovelReferenceService;
}) {
  return tool(
    async ({ title, category }) => {
      const all = await references.listAll(userId, novelId);
      let hit = all;
      if (category) hit = hit.filter((r) => r.category === category);
      if (title) {
        const q = title.toLowerCase();
        hit = hit.filter((r) => r.title.toLowerCase().includes(q));
      }
      return hit.slice(0, 3).map((r) => ({ id: r.id, title: r.title, category: r.category, injectTo: r.injectTo, content: r.content }));
    },
    {
      name: 'get_reference',
      description: '从本小说的参考资料里按标题/分类取完整内容(用于 injectTo 未标注、需深挖的条目)。',
      schema: z.object({
        title: z.string().optional().describe('标题模糊匹配'),
        category: z.string().optional().describe('按分类过滤'),
      }),
    },
  );
}
```

- [ ] **Step 3: 测试通过** + Commit — `feat(novel-reference): get_reference 工具(main+writer 按需取)`

---

## Task 7: CURATOR_AGENT_PROMPT

**Files:** Modify `server/src/agentos/agent-prompts.ts`

- [ ] **Step 1: 加常量**(风格对齐现有 prompt,用 `【】` 分节)

```typescript
export const CURATOR_AGENT_PROMPT = `你是这本小说的「参考资料策划」。
任务:用 search_knowledge 搜索全局知识库,为本书提炼一份**专属、去冗余**的参考资料,再用 set_references 固化。

工作方式:
1. 先看本书题材/简介/世界观/核心冲突(若不知,可问主 agent)。
2. 用 search_knowledge 按题材与写作环节多次搜索(如「悬疑 钩子」「开头切入」「词汇 描写」),每次取最相关条目。
3. **分析、去重、删冗余**——不要照搬,要为本书重写/浓缩成精炼条目(每条 content 控制在几百字内)。
4. 为每条判定 injectTo:
   - 大纲/开篇/情节/人设方法论 → main
   - 词汇/描写/题材案例/公式 → writer
   - 创作须知/审核红线 → both
   - 参考性强但非每轮必看 → 不填(工具可取)
5. 调 set_references 一次性写入(会清旧重写)。

原则:宁精勿滥,目标 8-15 条;OCR 来源质量低,非高度相关不取。`;
```

- [ ] **Step 2: typecheck** + Commit — `feat(agent): CURATOR_AGENT_PROMPT`

---

## Task 8: DeepAgentService — 注入 service + curator 子 agent + writer 动态 prompt + 注册 get_reference

**Files:** Modify `server/src/agentos/deep-agent.service.ts`(本计划最关键、风险最高的一步)

- [ ] **Step 1: 构造器注入** `NovelReferenceService` 与 `KnowledgeService`(后者来自 KnowledgeModule export)。保留现有注入。

- [ ] **Step 2: runTurn 顶部预取 references + 拼 writer prompt**(在 `createAgent` 调用之前,约行 138 取 model 处附近)

```typescript
const refsAll = await this.references.listAll(userId, novelId);
const writerRefs = refsAll.filter((r) => r.injectTo === 'writer' || r.injectTo === 'both');
const indexLines = refsAll.map((r) => `- [${r.injectTo ?? '—'}] ${r.title}(${r.category})`).join('\n');
const writerSlice = writerRefs.length
  ? `\n\n【写作参考】\n索引:\n${indexLines}\n\n精要:\n` +
    writerRefs.slice(0, 6).map((r) => `### ${r.title}\n${(r.content ?? '').slice(0, 500)}`).join('\n\n')
  : '';
const writerPrompt = WRITER_AGENT_PROMPT + writerSlice;
```

- [ ] **Step 3: writer 子 agent 的 `systemPrompt: WRITER_AGENT_PROMPT` 改为 `systemPrompt: writerPrompt`**(约行 248–250)。

- [ ] **Step 4: 在外层 `subagents` 数组、`chapter` 对象之后插入 curator**(约行 295)

```typescript
{
  name: 'curator',
  description: '搜索/提炼写作参考资料并固化为本小说专属参考。立项信息齐、需要建参考资料时委派。',
  systemPrompt: CURATOR_AGENT_PROMPT,
  tools: [
    makeSearchKnowledgeTool({ kb: this.knowledge }) as never,
    makeSetReferencesTool({ userId, novelId, references: this.references }) as never,
    makeGetReferenceTool({ userId, novelId, references: this.references }) as never,
  ],
},
```

- [ ] **Step 5: main 与 writer 的 tools 各加 `makeGetReferenceTool(...)`**(main 在其 tools 数组;writer 在 `writerTools()` 返回数组)。

- [ ] **Step 6: 冒烟** — `cd server && pnpm test`(确认无回归,DeepAgentService 的现有 spec 若 mock 了构造器依赖需补 references/knowledge double)+ `pnpm typecheck`。

- [ ] **Step 7: Commit** — `feat(agent): curator 子 agent + writer 动态注入写作参考 + get_reference 工具`

> 注:若 `deep-agent.service.spec.ts` 因新构造器参数失败,补 `references`/`knowledge` 的 jest.fn() double(对齐现有 spec 风格),不改测试意图。

---

## Task 9: ContextAssembler — main 注入【写作参考】slice

**Files:** Modify `server/src/agentos/context-assembler.service.ts`

- [ ] **Step 1: 构造器注入** `NovelReferenceService`(已有 prisma/summaries/events/world)。

- [ ] **Step 2: 在 forSession 的 slices 构建段(【世界观】等之后)加**

```typescript
const refsAll = await this.references.listAll(userId, novel.id);
if (refsAll.length) {
  const mainRefs = refsAll.filter((r) => r.injectTo === 'main' || r.injectTo === 'both');
  const indexLines = refsAll.map((r) => `- [${r.injectTo ?? '—'}] ${r.title}(${r.category})`).join('\n');
  const body = mainRefs.slice(0, 6).map((r) => `### ${r.title}\n${(r.content ?? '').slice(0, 500)}`).join('\n\n');
  slices.push(`【写作参考】\n索引:\n${indexLines}\n\n精要:\n${body}`);
}
```
(插入位置沿用现有「marker 前」机制——slices 会被拼到 `规则:` 之前。)

- [ ] **Step 3: 更新 context-assembler spec**(补 references double;新增用例:有 main 条目时 prompt 含【写作参考】;无条目时不含)。

- [ ] **Step 4: `pnpm test` 全绿** + Commit — `feat(agent): ContextAssembler 注入【写作参考】slice 到 main`

---

## Task 10: MAIN_AGENT_PROMPT — CONCEPT 阶段委派 curator

**Files:** Modify `server/src/agentos/agent-prompts.ts`(`MAIN_AGENT_PROMPT` 的 CONCEPT 段)或 `ContextAssembler.buildSystemPrompt` 的 CONCEPT 文案

- [ ] **Step 1: 在 CONCEPT 状态指令里(7 项收集齐之后、建世界观之前)插入**

```
- 7 项信息收集齐(missing 为空)后,【先委派 curator 搜索并提炼本小说的专属参考资料】(task → curator),再建世界观、规划大纲。
```
(精确定位:`ContextAssembler.buildSystemPrompt` 的 `status === 'CONCEPT'` 分支里的「工作方式」列表,或 `MAIN_AGENT_PROMPT` 的 CONCEPT 段——二选一,遵循现有文案所在文件。)

- [ ] **Step 2: typecheck** + Commit — `feat(agent): CONCEPT 阶段先委派 curator 生成参考资料`

---

## Task 11: FE 类型 + 路由 + API 客户端

**Files:** Modify `agent-ui/src/types/novel.ts`、`agent-ui/src/api/routes.ts`、`agent-ui/src/api/novels.ts`

- [ ] **Step 1: 类型**(`types/novel.ts`,镜像 `WorldEntry`)

```typescript
export interface NovelReference {
  id: string
  title: string
  category: string
  content: string
  injectTo: string | null
  source: string | null
  order: number
}
```

- [ ] **Step 2: 路由**(`routes.ts`)

```typescript
NovelReferences: (base: string, id: string) => `${base}/novels/${id}/references`,
NovelReference: (base: string, novelId: string, rid: string) => `${base}/novels/${novelId}/references/${rid}`,
```

- [ ] **Step 3: 客户端**(`novels.ts`,镜像 `getWorldview`/`updateChapter`)

```typescript
export const getNovelReferences = (base: string, token: string, novelId: string) =>
  asJson<NovelReference[]>(fetch(APIRoutes.NovelReferences(base, novelId), { headers: headers(token) }))

export const patchNovelReference = (
  base: string, token: string, novelId: string, rid: string,
  input: Partial<Pick<NovelReference, 'title' | 'category' | 'content' | 'injectTo'>>
) =>
  asJson<NovelReference>(fetch(APIRoutes.NovelReference(base, novelId, rid), {
    method: 'PATCH', headers: headers(token), body: JSON.stringify(input)
  }))
```

- [ ] **Step 4: `pnpm typecheck`** + Commit — `feat(novel-ref-ui): 类型 + 路由 + 客户端`

---

## Task 12: store referenceWriteSeq + 流式 hook bump

**Files:** Modify `agent-ui/src/store.ts`、`agent-ui/src/hooks/useAIStreamHandler.tsx`

- [ ] **Step 1: store.ts** 加 `referenceWriteSeq: number`(默认 0,非持久化)与 `bumpReferenceWriteSeq()`(镜像 `worldEntryWriteSeq`/`bumpWorldEntryWriteSeq`——在 store 的 state 默认块 + setter 块两处)。

- [ ] **Step 2: useAIStreamHandler.tsx** 在 `set_references` 工具结果落地时调 `bumpReferenceWriteSeq()`(grep `bumpWorldEntryWriteSeq` 找到现有 bump 点,同模式加一条判断 tool name === 'set_references')。

- [ ] **Step 3: `pnpm validate`** + Commit — `feat(novel-ref-ui): referenceWriteSeq 缓存失效`

---

## Task 13: 工作台「参考资料」面板

**Files:** Modify `IconRail.tsx`、`ResourcePanel.tsx`;Create `ReferencesView.tsx`

- [ ] **Step 1: IconRail** — `ResourceKey` 加 `'references'`;`RESOURCES` 加 `{ key: 'references', icon: '📚', label: '参考资料' }`。

- [ ] **Step 2: ResourcePanel** — `ResourceKey` 加 `'references'`;`TITLES` 加 `references: '参考资料'`;switch 加 `{resource === 'references' && <ReferencesView novel={novel} />}`;fallback 判断加 `&& resource !== 'references'`。

- [ ] **Step 3: ReferencesView 组件**(镜像 `WorldView`:getNovelReferences + referenceWriteSeq 依赖;列表显示 title/category/injectTo 徽标;点击右栏用 MarkdownRenderer 读 content)

```tsx
'use client'
import { useEffect, useState } from 'react'
import { useStore } from '@/store'
import { getNovelReferences } from '@/api/novels'
import type { NovelReference } from '@/types/novel'
import MarkdownRenderer from '@/components/ui/typography/MarkdownRenderer'
import { cn } from '@/lib/utils'

const BADGE: Record<string, string> = { main: '主', writer: '写手', both: '主+写手' }

export const ReferencesView = ({ novel }: { novel: any }) => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const seq = useStore((s) => s.referenceWriteSeq)
  const [refs, setRefs] = useState<NovelReference[] | null>(null)
  const [sel, setSel] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getNovelReferences(endpoint, token, novel.id)
      .then((d) => { if (!cancelled) setRefs(d) })
      .catch(() => { if (!cancelled) setRefs(null) })
    return () => { cancelled = true }
  }, [endpoint, token, novel.id, seq])

  const current = refs?.find((r) => r.id === sel) ?? null
  return (
    <div className="flex h-full gap-3">
      <div className="w-64 overflow-y-auto rounded-md border border-primary/10">
        {refs === null && <p className="p-3 text-xs text-muted">加载中…</p>}
        {refs?.length === 0 && <p className="p-3 text-xs text-muted">暂无参考资料(立项后由 curator 自动生成)</p>}
        {refs?.map((r) => (
          <button key={r.id} onClick={() => setSel(r.id)}
            className={cn('block w-full border-b border-primary/5 px-3 py-2 text-left', sel === r.id ? 'bg-accent' : 'hover:bg-accent/50')}>
            <div className="flex items-center gap-1 text-sm text-primary"><span className="truncate">{r.title}</span>
              {r.injectTo && <span className="shrink-0 rounded bg-brand/15 px-1 text-[10px]">{BADGE[r.injectTo] ?? r.injectTo}</span>}
            </div>
            <p className="truncate text-xs text-muted">{r.category}</p>
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto rounded-md border border-primary/10 bg-background/40 p-4">
        {current ? <>
          <h3 className="mb-2 text-sm font-semibold text-primary">{current.title}</h3>
          <article className="prose prose-invert max-w-none text-sm"><MarkdownRenderer>{current.content}</MarkdownRenderer></article>
        </> : <p className="text-sm text-muted">从左侧选一条。</p>}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: `pnpm validate` 全绿** + 联调(`pnpm dev` 起 server:3001 + ui:3000,建一本 CONCEPT 小说,信息填齐后观察 curator 是否生成 references;工作台「参考资料」面板是否显示)。

- [ ] **Step 5: Commit** — `feat(novel-ref-ui): 工作台参考资料面板`

---

## 完成标准

- 立项信息齐 → main 委派 curator → 生成 `NovelReference`(带 injectTo)→ 工作台面板可见。
- 写大纲/写正文时,main/writer 的 context 含【写作参考】(对应 injectTo 条目精要 + 全量索引);agent 可用 `get_reference` 取更多。
- server `pnpm test` 全过(含新增 6 套 spec);agent-ui `pnpm validate` 全过。

## 风险点(执行时留意)

- **Task 8 风险最高**:改 DeepAgentService 构造器与 writer prompt 动态化,可能影响现有 `deep-agent.service.spec.ts`——补 double 即可,勿改测试意图。`createSubAgentMiddleware` 配置是同步的,故 references 必须在 `createAgent` 前 await 取(已在 runTurn 顶部)。
- **Task 12 bump 点**:若 `useAIStreamHandler.tsx` 的工具结果处理结构不明,grep `bumpWorldEntryWriteSeq` 定位同模式分支。
- **token 预算**:注入精要每条 content 截断 500 字、top 6;全量索引始终注入(每条一行)。超预算后续可按章节相关性裁剪。
