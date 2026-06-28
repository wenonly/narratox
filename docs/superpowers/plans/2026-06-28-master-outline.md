# 总纲 + 弧线暴露 + 卷纲轻量补 实施计划

> **For agentic workers:** superpowers:subagent-driven-development / executing-plans.

**Goal:** 新增全书级 `MasterOutline`(北极星,注入 main+writer)+ 暴露弧线 UI + Volume 加 bridge/mainProgress。一条迁移。

**Spec:** [2026-06-28-master-outline-design.md](../specs/2026-06-28-master-outline-design.md)

**Architecture:** MasterOutline(1:1 Novel)6 字段对应长篇杀手;`buildMasterOutlineSlice` 纯函数(镜像 reference-slice)注入 main(ContextAssembler 首个 slice)+ writer(runTurn augment);outline-writer 增 `set_master_outline` 立总纲(分卷前);get_outline 增返 master+arcs;FE 大纲面板加总纲区 + 弧线区 + 卷头字段。

---

## Task 1:schema 迁移 + prisma generate

**Files:** `server/prisma/schema.prisma`

- [ ] **Step 1: Novel 增 masterOutline 关系**

在 `model Novel` 的关系区(约 `:75-77` arcs/volumes/chapterOutlines 附近)加:
```prisma
  masterOutline MasterOutline?
```

- [ ] **Step 2: User 增反向关系**

在 `model User` 找一处关系区(如 novelReferences 附近)加:
```prisma
  masterOutlines MasterOutline[]
```

- [ ] **Step 3: Volume 加两字段**

在 `model Volume`(`:196-212`)的 `arcSummary` 后、关系前加:
```prisma
  bridge        String           @default("")   // 承上启下(承接上卷 + 为下卷埋线)
  mainProgress  String           @default("")   // 本卷主线推进点
```

- [ ] **Step 4: 新增 MasterOutline 模型**

在 `model Arc` 之前(约 `:214`)加:
```prisma
/// 总纲(全书级蓝图,1:1 Novel):主线/结局/力量进阶曲线/暗线时刻表/卷划分。
/// 长篇最稳定层,每轮注入 main+writer 作北极星,锁战力崩坏 + 暗线遗忘 + 主线漂移。
model MasterOutline {
  id        String   @id @default(cuid())
  novelId   String   @unique
  novel     Novel    @relation(fields: [novelId], references: [id], onDelete: Cascade)
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  theme     String   @default("")    // 故事核 + 主题(一句话定调)
  mainLine  String   @default("")    // 主线脉络(起承转合关键节点/走向)
  ending    String   @default("")    // 结局(先定→倒推铺垫)
  powerProgression Json @default("[]") // [{ volume:Number, level:String, note:String }]
  hiddenLines Json   @default("[]")  // [{ name, type, plant, advance:[], reveal }]
  volumeSplitLogic String @default("") // 卷划分逻辑
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([novelId])
}
```

- [ ] **Step 5: 迁移 + 手动 generate**

```bash
cd /Users/taowen/project/narratox/server
pnpm prisma migrate dev --name add_master_outline_and_volume_fields
pnpm prisma generate   # Prisma 7:migrate dev 不自动 regen client
```
Expected:迁移成功,`MasterOutline` / `Volume.bridge` / `Volume.mainProgress` 进 client 类型。

- [ ] **Step 6: typecheck 确认 client 类型可用**

Run: `pnpm --dir server typecheck`
Expected:通过(尚无引用,仅确认生成)。

- [ ] **Step 7: 提交**

```bash
git -C /Users/taowen/project/narratox add server/prisma/schema.prisma server/prisma/migrations/*/migration.sql
git -C /Users/taowen/project/narratox commit -m "feat(schema): MasterOutline 模型 + Volume.bridge/mainProgress"
```

---

## Task 2:MasterOutlineService + 注册 + 单测

**Files:**
- Create: `server/src/novel/master-outline.service.ts`
- Modify: `server/src/novel/novel.module.ts`(注册 + 导出)
- Test: `server/src/novel/master-outline.service.spec.ts`

- [ ] **Step 1: 写失败测试**

Create `server/src/novel/master-outline.service.spec.ts`:
```ts
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { MasterOutlineService } from './master-outline.service';

const prismaMock = {
  novel: { findFirst: jest.fn() },
  masterOutline: { upsert: jest.fn(), findUnique: jest.fn() },
};
const svc = new MasterOutlineService(prismaMock as unknown as PrismaService);

beforeEach(() => jest.clearAllMocks());

describe('MasterOutlineService', () => {
  it('upsert: 归属校验通过 → upsert by novelId', async () => {
    prismaMock.novel.findFirst.mockResolvedValue({ id: 'n1' });
    prismaMock.masterOutline.upsert.mockResolvedValue({ id: 'm1' });
    const res = await svc.upsert('u1', 'n1', { theme: '核心' });
    expect(prismaMock.masterOutline.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { novelId: 'n1' } }),
    );
    expect(res).toMatchObject({ id: 'm1' });
  });

  it('upsert: 非本人小说 → 抛错', async () => {
    prismaMock.novel.findFirst.mockResolvedValue(null);
    await expect(svc.upsert('u1', 'n1', { theme: 'x' })).rejects.toThrow();
  });

  it('get: 返回总纲或 null', async () => {
    prismaMock.masterOutline.findUnique.mockResolvedValue(null);
    expect(await svc.get('u1', 'n1')).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --dir server test -- master-outline.service.spec.ts`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现**

Create `server/src/novel/master-outline.service.ts`:
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface MasterOutlineInput {
  theme?: string;
  mainLine?: string;
  ending?: string;
  powerProgression?: unknown;
  hiddenLines?: unknown;
  volumeSplitLogic?: string;
}

/**
 * 总纲(全书级蓝图,1:1 Novel)服务。多租户隔离(novel 属 userId)。
 * outline-writer 经 set_master_outline 工具 upsert;ContextAssembler/runTurn get 注入。
 */
@Injectable()
export class MasterOutlineService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertOwned(userId: string, novelId: string) {
    const n = await this.prisma.novel.findFirst({
      where: { id: novelId, userId },
      select: { id: true },
    });
    if (!n) throw new NotFoundException('Novel not found');
  }

  async upsert(userId: string, novelId: string, data: MasterOutlineInput) {
    await this.assertOwned(userId, novelId);
    const fields = {
      userId,
      theme: data.theme ?? '',
      mainLine: data.mainLine ?? '',
      ending: data.ending ?? '',
      powerProgression: (data.powerProgression ?? []) as unknown as Prisma.InputJsonValue,
      hiddenLines: (data.hiddenLines ?? []) as unknown as Prisma.InputJsonValue,
      volumeSplitLogic: data.volumeSplitLogic ?? '',
    };
    return this.prisma.masterOutline.upsert({
      where: { novelId },
      create: { novelId, ...fields },
      update: fields,
    });
  }

  async get(userId: string, novelId: string) {
    await this.assertOwned(userId, novelId);
    return this.prisma.masterOutline.findUnique({
      where: { novelId, novel: { userId } },
    });
  }
}
```

- [ ] **Step 4: 注册 + 导出(为 Task 4/7/8 的注入铺路)**

`novel.module.ts` providers + exports 各加 `MasterOutlineService`,顶部 import:
```ts
import { MasterOutlineService } from './master-outline.service';
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm --dir server test -- master-outline.service.spec.ts`
Expected: PASS(3)。

- [ ] **Step 6: 提交**

```bash
git -C /Users/taowen/project/narratox add server/src/novel/master-outline.service.ts server/src/novel/master-outline.service.spec.ts server/src/novel/novel.module.ts
git -C /Users/taowen/project/narratox commit -m "feat(novel): MasterOutlineService(upsert/get,多租户)"
```

---

## Task 3:buildMasterOutlineSlice 纯函数 + 单测

**Files:**
- Create: `server/src/agentos/master-slice.ts`
- Test: `server/src/agentos/master-slice.spec.ts`

- [ ] **Step 1: 写失败测试**

Create `server/src/agentos/master-slice.spec.ts`:
```ts
import { buildMasterOutlineSlice } from './master-slice';

describe('buildMasterOutlineSlice', () => {
  it('无总纲返空串', () => {
    expect(buildMasterOutlineSlice(null)).toBe('');
  });

  it('格式化各字段 + 力量曲线 + 暗线时刻表', () => {
    const s = buildMasterOutlineSlice({
      theme: '凡人修仙',
      mainLine: '主角从废柴到飞升',
      ending: '破开天界',
      powerProgression: [
        { volume: 1, level: '炼气→筑基', note: '宗门考核' },
      ],
      hiddenLines: [
        { name: '身世', type: '身世', plant: '卷1', advance: ['卷3'], reveal: '卷6' },
      ],
      volumeSplitLogic: '按境界分卷',
    });
    expect(s).toContain('【总纲】');
    expect(s).toContain('凡人修仙');
    expect(s).toContain('炼气→筑基');
    expect(s).toContain('身世');
    expect(s).toContain('卷6');
  });

  it('空总纲(全默认)返空串,不注入噪声', () => {
    expect(
      buildMasterOutlineSlice({
        theme: '', mainLine: '', ending: '',
        powerProgression: [], hiddenLines: [], volumeSplitLogic: '',
      }),
    ).toBe('');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --dir server test -- master-slice.spec.ts`
Expected: FAIL。

- [ ] **Step 3: 实现**

Create `server/src/agentos/master-slice.ts`:
```ts
export interface MasterOutlineLike {
  theme: string;
  mainLine: string;
  ending: string;
  powerProgression: { volume: number; level: string; note?: string }[];
  hiddenLines: {
    name: string;
    type?: string;
    plant?: string;
    advance?: string[];
    reveal?: string;
  }[];
  volumeSplitLogic: string;
}

/**
 * 拼【总纲】slice(全书北极星):故事核/主线/结局 + 力量进阶曲线 + 暗线时刻表 + 卷划分。
 * 全空 → ''(不注入)。纯函数,不带前导换行;调用方自行加间距。
 * main(ContextAssembler 首个 slice)+ writer(runTurn augment)共用。
 */
export function buildMasterOutlineSlice(
  m: MasterOutlineLike | null,
): string {
  if (!m) return '';
  const has =
    m.theme || m.mainLine || m.ending ||
    (m.powerProgression && m.powerProgression.length) ||
    (m.hiddenLines && m.hiddenLines.length) || m.volumeSplitLogic;
  if (!has) return '';
  const lines: string[] = ['【总纲】'];
  if (m.theme) lines.push(`故事核:${m.theme}`);
  if (m.mainLine) lines.push(`主线:${m.mainLine}`);
  if (m.ending) lines.push(`结局:${m.ending}`);
  if (m.powerProgression?.length) {
    lines.push(
      '力量进阶:' +
        m.powerProgression
          .map((p) => `卷${p.volume}:${p.level}${p.note ? `(${p.note})` : ''}`)
          .join(' · '),
    );
  }
  if (m.hiddenLines?.length) {
    lines.push(
      '暗线(计划):' +
        m.hiddenLines
          .map(
            (h) =>
              `${h.name}:埋${h.plant ?? '?'}${h.advance?.length ? `→推${h.advance.join('·')}` : ''}→揭${h.reveal ?? '?'}`,
          )
          .join(' / '),
    );
  }
  if (m.volumeSplitLogic) lines.push(`卷划分:${m.volumeSplitLogic}`);
  return lines.join('\n');
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --dir server test -- master-slice.spec.ts`
Expected: PASS(3)。

- [ ] **Step 5: 提交**

```bash
git -C /Users/taowen/project/narratox add server/src/agentos/master-slice.ts server/src/agentos/master-slice.spec.ts
git -C /Users/taowen/project/narratox commit -m "feat(master-slice): buildMasterOutlineSlice 纯函数(总纲北极星注入)"
```

---

## Task 4:OutlineService 扩展(upsertVolume 卷纲 + listOutline 增返 master/arcs)

**Files:** `server/src/novel/outline.service.ts`

- [ ] **Step 1: 注入 MasterOutlineService + ArcService**

顶部 import:
```ts
import { MasterOutlineService } from './master-outline.service';
import { ArcService } from './arc.service';
```
构造器:
```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly masterOutlines: MasterOutlineService,
    private readonly arcs: ArcService,
  ) {}
```

- [ ] **Step 2: upsertVolume 接收 bridge/mainProgress**

把 `upsertVolume` 的 `data` 类型 + fields 改为:
```ts
  async upsertVolume(
    userId: string,
    novelId: string,
    order: number,
    data: { title: string; goal?: string; synopsis?: string; bridge?: string; mainProgress?: string },
  ) {
    await this.assertOwned(userId, novelId);
    const fields = {
      title: data.title,
      goal: data.goal ?? '',
      synopsis: data.synopsis ?? '',
      bridge: data.bridge ?? '',
      mainProgress: data.mainProgress ?? '',
    };
    return this.prisma.volume.upsert({
      where: { novelId_order: { novelId, order } },
      create: { novelId, order, ...fields },
      update: fields,
    });
  }
```

- [ ] **Step 3: listOutline 增返 master + arcs**

把 `listOutline` 改为:
```ts
  async listOutline(userId: string, novelId: string) {
    const where = { novelId, novel: { userId } };
    const [master, volumes, arcs, chapterOutlines] = await Promise.all([
      this.masterOutlines.get(userId, novelId),
      this.prisma.volume.findMany({ where, orderBy: { order: 'asc' } }),
      this.arcs.listArcs(userId, novelId),
      this.prisma.chapterOutline.findMany({ where, orderBy: { chapterOrder: 'asc' } }),
    ]);
    return { master, volumes, arcs, chapterOutlines };
  }
```
> 确认 `ArcService.listArcs(userId, novelId)` 存在(Phase 12 加的);若签名不同,按实际调整。

- [ ] **Step 4: 更新 OutlineService 的测试 double(若有 spec 注入 prisma 单独)**

Run: `grep -rn "new OutlineService" server/src`(若有单测直接 new,需补两个新构造参数 mock)。补 `masterOutlines`/`arcs` mock。

- [ ] **Step 5: typecheck + test**

Run: `pnpm --dir server typecheck && pnpm --dir server test`
Expected: 通过、不回归。

- [ ] **Step 6: 提交**

```bash
git -C /Users/taowen/project/narratox add server/src/novel/outline.service.ts
git -C /Users/taowen/project/narratox commit -m "feat(outline): upsertVolume 加 bridge/mainProgress + listOutline 返 master/arcs"
```

---

## Task 5:set_master_outline 工具 + 注册 + AGENT_TREE

**Files:**
- Create: `server/src/agentos/tools/set-master-outline.tool.ts`
- Modify: `server/src/agentos/agent-registry.ts`、`server/src/agentos/agent-tree.config.ts`

- [ ] **Step 1: 实现工具**

Create `server/src/agentos/tools/set-master-outline.tool.ts`:
```ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { MasterOutlineService } from '../../novel/master-outline.service';

/**
 * outline-writer 的「立总纲」工具(全书级蓝图,1:1 Novel)。userId/novelId 闭包注入。
 * 在分卷前先立总纲:主线/结局/力量进阶曲线/暗线时刻表/卷划分。锁战力崩坏 + 暗线遗忘。
 */
export function makeSetMasterOutlineTool({
  userId,
  novelId,
  masterOutlines,
}: {
  userId: string;
  novelId: string;
  masterOutlines: MasterOutlineService;
}) {
  return tool(
    async (input) => {
      await masterOutlines.upsert(userId, novelId, input);
      return { ok: true as const };
    },
    {
      name: 'set_master_outline',
      description:
        '立/更新全书总纲(北极星,1:1 Novel,分卷前先立)。含:theme(故事核+主题)/mainLine(主线脉络)/ending(结局,先定倒推)/powerProgression(力量进阶曲线:[{volume,level,note}],锁战力崩坏)/hiddenLines(暗线时刻表:[{name,type,plant,advance[],reveal}],锁长篇发动机)/volumeSplitLogic(卷划分逻辑)。每轮自动注入主 agent + 写手。',
      schema: z.object({
        theme: z.string().optional().describe('故事核 + 主题(一句话定调)'),
        mainLine: z.string().optional().describe('主线脉络(起承转合关键节点/走向)'),
        ending: z.string().optional().describe('结局走向(先定→倒推铺垫)'),
        powerProgression: z
          .array(z.object({
            volume: z.number().describe('卷序号'),
            level: z.string().describe('本卷力量跨度,如 炼气→筑基'),
            note: z.string().optional().describe('备注'),
          }))
          .optional()
          .describe('力量/金手指进阶曲线,每卷一档'),
        hiddenLines: z
          .array(z.object({
            name: z.string().describe('暗线名,如 身世/家族秘密/幕后黑手'),
            type: z.string().optional(),
            plant: z.string().optional().describe('埋设卷(如 卷1)'),
            advance: z.array(z.string()).optional().describe('推进卷'),
            reveal: z.string().optional().describe('揭示/回收卷(如 卷6)'),
          }))
          .optional()
          .describe('暗线/核心伏笔时刻表'),
        volumeSplitLogic: z.string().optional().describe('卷划分逻辑'),
      }),
    },
  );
}
```

- [ ] **Step 2: 注册到 TOOL_REGISTRY**

`agent-registry.ts`:import + ToolDeps 加 `masterOutlines: MasterOutlineService;` + registry 加:
```ts
  set_master_outline: (d) =>
    makeSetMasterOutlineTool({
      userId: d.userId,
      novelId: d.novelId,
      masterOutlines: d.masterOutlines,
    }),
```
顶部加 `import { makeSetMasterOutlineTool } from './tools/set-master-outline.tool';` 与 `import type { MasterOutlineService } from '../novel/master-outline.service';`。

- [ ] **Step 3: AGENT_TREE outline-writer 加工具 + ToolDeps 接线**

`agent-tree.config.ts` 的 outline-writer.tools 数组加 `'set_master_outline'`(放最前)。

- [ ] **Step 4: deep-agent.service.ts 的 ToolDeps 注入 masterOutlines**

`buildAgentGraph` 里 `deps` 对象加 `masterOutlines: this.masterOutlines,`;`DeepAgentService` 构造器注入 `private readonly masterOutlines: MasterOutlineService`,顶部 import。(Task 8 会再改 runTurn;此处先让 deps 编译过。)

- [ ] **Step 5: typecheck**

Run: `pnpm --dir server typecheck`
Expected: 通过。

- [ ] **Step 6: 提交**

```bash
git -C /Users/taowen/project/narratox add server/src/agentos/tools/set-master-outline.tool.ts server/src/agentos/agent-registry.ts server/src/agentos/agent-tree.config.ts server/src/agentos/deep-agent.service.ts
git -C /Users/taowen/project/narratox commit -m "feat(tool): set_master_outline(立总纲)+ 注册 + outline-writer 挂载"
```

---

## Task 6:set_volume 加卷纲字段 + get_outline 增返 master/arcs

**Files:** `server/src/agentos/tools/set-volume.tool.ts`、`server/src/agentos/tools/get-outline.tool.ts`

- [ ] **Step 1: set_volume 加 bridge/mainProgress**

`set-volume.tool.ts` 工具回调 + schema 改:
```ts
    async ({ order, title, goal, synopsis, bridge, mainProgress }) => {
      await outlines.upsertVolume(userId, novelId, order, {
        title, goal, synopsis, bridge, mainProgress,
      });
      return { ok: true as const, order, title };
    },
```
schema 增:
```ts
        bridge: z.string().optional().describe('承上启下(承接上卷 + 为下卷埋线)'),
        mainProgress: z.string().optional().describe('本卷主线推进点'),
```
description 末尾补「+ bridge(承上启下)/mainProgress(主线推进点)」。

- [ ] **Step 2: get_outline 增返 master + arcs**

`get-outline.tool.ts` 回调改:
```ts
    async () => {
      const { master, volumes, arcs, chapterOutlines } = await outlines.listOutline(userId, novelId);
      const nextChapterOrder = await outlines.nextChapterOrder(userId, novelId);
      return {
        master: master
          ? {
              theme: master.theme,
              mainLine: master.mainLine,
              ending: master.ending,
              powerProgression: master.powerProgression,
              hiddenLines: master.hiddenLines,
              volumeSplitLogic: master.volumeSplitLogic,
            }
          : null,
        volumes: volumes.map((v) => ({
          order: v.order, title: v.title, goal: v.goal, synopsis: v.synopsis,
          bridge: v.bridge, mainProgress: v.mainProgress,
        })),
        arcs: arcs.map((a) => ({
          order: a.order, title: a.title, goal: a.goal,
          fromChapter: a.fromChapter, toChapter: a.toChapter, summary: a.summary,
        })),
        chapters: chapterOutlines.map((c) => ({
          chapterOrder: c.chapterOrder, title: c.title, status: c.status,
        })),
        nextChapterOrder,
      };
    },
```
description 补「+ 总纲 + 各卷弧线」。

- [ ] **Step 3: typecheck**

Run: `pnpm --dir server typecheck`
Expected: 通过。

- [ ] **Step 4: 提交**

```bash
git -C /Users/taowen/project/narratox add server/src/agentos/tools/set-volume.tool.ts server/src/agentos/tools/get-outline.tool.ts
git -C /Users/taowen/project/narratox commit -m "feat(tool): set_volume 加卷纲字段 + get_outline 返总纲/弧线/卷纲"
```

---

## Task 7:ContextAssembler 注入【总纲】作首个 slice

**Files:** `server/src/agentos/context-assembler.service.ts`

- [ ] **Step 1: import + 注入 MasterOutlineService**

顶部加 `import { buildMasterOutlineSlice } from './master-slice';` 与 `import { MasterOutlineService } from '../novel/master-outline.service';`。构造器加 `private readonly masterOutlines: MasterOutlineService,`。

- [ ] **Step 2: 取 master + 首个 slice**

在 `forSession` 取 overview 之后(`const overview = ...`)加:
```ts
    const master = await this.masterOutlines.get(userId, novel.id);
    const masterSlice = buildMasterOutlineSlice(master as never);
```
在 `const slices: string[] = [];` 之后、态势 slice 之前插:
```ts
    if (masterSlice) slices.push(masterSlice);
```
(总纲置最前——北极星,高于态势。)

- [ ] **Step 3: typecheck + test**

Run: `pnpm --dir server typecheck && pnpm --dir server test`
Expected: 通过、不回归。

- [ ] **Step 4: 提交**

```bash
git -C /Users/taowen/project/narratox add server/src/agentos/context-assembler.service.ts
git -C /Users/taowen/project/narratox commit -m "feat(context): 注入【总纲】作 main 首个 slice(北极星)"
```

---

## Task 8:deep-agent writer 注入【总纲】

**Files:** `server/src/agentos/deep-agent.service.ts`

- [ ] **Step 1: import buildMasterOutlineSlice**

顶部加 `import { buildMasterOutlineSlice } from './master-slice';`。

- [ ] **Step 2: runTurn 取 master 建 masterSlice**

在 runTurn 取 refsAll 附近加(与 voice/validator slice 同区):
```ts
    const master = await this.masterOutlines.get(userId, novelId);
    const masterSliceRaw = buildMasterOutlineSlice(master as never);
    const masterSlice = masterSliceRaw ? '\n\n' + masterSliceRaw : '';
```
`buildAgentGraph` 入参对象加 `masterSlice,`。

- [ ] **Step 3: buildAgentGraph 签名 + resolvePrompt**

签名 args 类型加 `masterSlice?: string;`;解构加 `masterSlice = '',`;`resolvePrompt` 改 writer 分支:
```ts
      if (spec.promptAugment === 'writer') prompt += masterSlice + voiceSlice;
```
rewind 入参对象加 `masterSlice: '',`。

- [ ] **Step 4: typecheck + test**

Run: `pnpm --dir server typecheck && pnpm --dir server test`
Expected: 通过、不回归(deep-agent.service.spec 测 buildTurnMessages,不受影响)。

- [ ] **Step 5: 提交**

```bash
git -C /Users/taowen/project/narratox add server/src/agentos/deep-agent.service.ts
git -C /Users/taowen/project/narratox commit -m "feat(agent): writer 注入【总纲】(锁战力崩坏/主线漂移于写作源头)"
```

---

## Task 9:OUTLINER prompts 改造

**Files:** `server/src/agentos/agent-prompts.ts`(OUTLINER_WRITER / OUTLINER_ORCH / OUTLINER_CRITIC)

- [ ] **Step 1: OUTLINER_WRITER 加「第零步 立总纲」+ 分卷改名 + 卷纲字段**

把 `【第二步 — 建总纲】用 set_volume...` 段(约 `:391-393`)整段替换,并在其前插入「第零步」:
```ts
【第零步 — 立总纲(全书北极星,分卷前先立)】用 set_master_outline:
- theme(故事核+主题,一句话定调)、mainLine(主线脉络:起承转合关键节点)、ending(结局——【先定结局,倒推铺垫】)。
- powerProgression:全书力量/金手指进阶曲线,每卷一档(如 卷1:炼气→筑基)。【这是锁战力崩坏的根】——写手每轮看到,不会越级。
- hiddenLines:暗线/核心伏笔时刻表(身世/家族秘密/幕后黑手),每条给 埋(plant)→推进(advance)→揭示(reveal)的卷。【长篇发动机——前期埋、后期爆,有 reveal 计划才不会忘/过早揭】。
- volumeSplitLogic:为何这么分卷、每卷在全书中的角色。
- 总纲是全书最稳的一层,凝练可执行;细节靠分卷/细纲承接。

【第一步 — 分卷(原"建总纲"是误称,此步是分卷)】用 set_volume,按 order upsert:
- 全书所有卷(长篇通常 3-6 卷),覆盖从头到尾——不要只建第一卷。每卷:卷标题/目标/梗概 + 【bridge(承上启下:如何承接上卷、为下卷埋什么)】+【mainProgress(本卷主线推进点)】。
- 主线明、暗线埋(身世/家族秘密/隐藏身份是后期引爆点);金手指出现节点 + 升级节奏写进相关卷梗概,且【与 powerProgression 曲线一致】。
```
(后续【分弧】【第三步 建细纲】编号顺延原样保留——原 prompt 里分弧无显式编号、细纲标"第三步",改后语义不变。)

- [ ] **Step 2: OUTLINER_ORCH 建大纲指示加「先立总纲」**

把 `建大纲:set_volume×N...` 那条(约 `:354`)与委派指示(约 `:362`)补「先 set_master_outline 立总纲」:
```ts
- 建大纲:先 set_master_outline(立总纲)→ set_volume×N(全书所有卷)→ 每卷切 2-4 弧线(set_arc×N)→ 前 20-30 章细纲(set_chapter_plan×N)。
```
委派指示那条补:`建纲:先 set_master_outline(总纲:结局先定、力量曲线覆盖全书、暗线有 reveal 计划),再 set_volume×N(...)+ set_chapter_plan×N(前 20-30 章)。`

- [ ] **Step 3: OUTLINER_CRITIC dim1 对齐总纲 + 总纲自检**

dim 1(约 `:421`)末尾补:`——卷/细纲服务于总纲(get_outline 读 master):主线节点落地、力量节奏符合 powerProgression、暗线按 hiddenLines 计划埋推揭。`
在 6 维后、`【补细纲任务】`前插一段总纲自检:
```ts
【总纲自检(建纲任务)】get_outline 读 master:力量曲线是否覆盖全书各卷?每条暗线是否有 reveal 计划?结局是否先定?卷划分逻辑是否支撑主线?缺/矛盾 → blockingIssues 点名。
```

- [ ] **Step 4: typecheck + test**

Run: `pnpm --dir server typecheck && pnpm --dir server test`
Expected: 通过、不回归。

- [ ] **Step 5: 提交**

```bash
git -C /Users/taowen/project/narratox add server/src/agentos/agent-prompts.ts
git -C /Users/taowen/project/narratox commit -m "feat(outliner): 立总纲 step0 + 分卷改名 + 卷纲字段 + critic 总纲自检"
```

---

## Task 10:FE 类型 + api + OutlineView(总纲区/弧线区/卷头字段)

**Files:** `agent-ui/src/types/novel.ts`、`agent-ui/src/api/novels.ts`、`agent-ui/src/components/workspace/ResourcePanel.tsx`

- [ ] **Step 1: types 扩展**

`types/novel.ts`:`Volume` 加 `bridge: string`、`mainProgress: string`;新增 `Arc`、`MasterOutline` 类型;`OutlineData` 改:
```ts
export interface Volume {
  id: string
  novelId: string
  order: number
  title: string
  goal: string
  synopsis: string
  bridge: string
  mainProgress: string
}

/** 弧线(卷内子段,带 chapter range) */
export interface Arc {
  id: string
  order: number
  title: string
  goal: string
  fromChapter: number
  toChapter: number
  summary: string
}

/** 总纲(全书蓝图) */
export interface MasterOutline {
  theme: string
  mainLine: string
  ending: string
  powerProgression: { volume: number; level: string; note?: string }[]
  hiddenLines: {
    name: string
    type?: string
    plant?: string
    advance?: string[]
    reveal?: string
  }[]
  volumeSplitLogic: string
}

export interface OutlineData {
  master: MasterOutline | null
  volumes: Volume[]
  arcs: Arc[]
  chapterOutlines: ChapterOutline[]
}
```

- [ ] **Step 2: 确认 getOutline 映射**

`api/novels.ts` 的 `getOutline` 是 `asJson<OutlineData>(...)`(无手写映射)——类型扩展后自动生效,无需改。

- [ ] **Step 3: OutlineView 顶部加【总纲】区**

`ResourcePanel.tsx` 的 `OutlineView` return 顶部(`data.volumes.map` 之前)插:
```tsx
      {data.master && (
        <details className="rounded border border-brand/20 bg-brand/5 px-2 py-1.5">
          <summary className="cursor-pointer text-sm font-medium text-brand">
            📜 总纲(全书北极星)
          </summary>
          <div className="mt-2 space-y-1 text-xs text-muted">
            {data.master.theme && <p>故事核:{data.master.theme}</p>}
            {data.master.mainLine && <p>主线:{data.master.mainLine}</p>}
            {data.master.ending && <p>结局:{data.master.ending}</p>}
            {data.master.powerProgression?.length > 0 && (
              <p>
                力量进阶:
                {data.master.powerProgression
                  .map((p) => `卷${p.volume}:${p.level}`)
                  .join(' · ')}
              </p>
            )}
            {data.master.hiddenLines?.length > 0 && (
              <p>
                暗线:
                {data.master.hiddenLines
                  .map(
                    (h) =>
                      `${h.name}(埋${h.plant ?? '?'}→揭${h.reveal ?? '?'})`,
                  )
                  .join(' / ')}
              </p>
            )}
            {data.master.volumeSplitLogic && (
              <p>卷划分:{data.master.volumeSplitLogic}</p>
            )}
          </div>
        </details>
      )}
```

- [ ] **Step 4: 每卷展开加「弧线子区 + 卷头字段」**

在每卷 `isOpen` 块内(`{v.goal && ...}` 之后、`{plans.map(...)}` 之前)插:
```tsx
                {v.bridge && <p className="text-xs text-muted">承上启下:{v.bridge}</p>}
                {v.mainProgress && (
                  <p className="text-xs text-muted">主线推进:{v.mainProgress}</p>
                )}
                {data.arcs.filter((a) => a.id && v.id && arcVolumeMatch(a, v.id)).length > 0 && (
                  <div className="space-y-0.5">
                    {data.arcs
                      .filter((a) => arcVolumeMatch(a, v.id))
                      .map((a) => (
                        <p key={a.id ?? a.order} className="text-xs text-muted">
                          🎬 {a.title} · 第{a.fromChapter}-{a.toChapter}章
                          {a.goal ? ` · ${a.goal}` : ''}
                        </p>
                      ))}
                  </div>
                )}
```
> `arcVolumeMatch`:get_outline 工具返回的 arc 没有 volumeId(FE 也不需要精确归卷),弧线暂按章号范围匹配卷内细纲。**简化方案**:直接在每卷下列【全部弧线】一次(置于卷列表之后、未分卷之前),避免范围匹配的复杂度。改用下面 Step 5 的独立弧线区。

- [ ] **Step 5: 改为「独立弧线区」(避免归卷范围匹配复杂度)**

撤销 Step 4 的卷内插入;改为在卷列表之后、`{未挂卷的细纲}` 之前插一个弧线区:
```tsx
      {data.arcs.length > 0 && (
        <div>
          <p className="text-sm font-medium text-muted">弧线</p>
          <div className="mt-1 space-y-1 border-l border-primary/10 pl-2">
            {data.arcs
              .slice()
              .sort((a, b) => a.fromChapter - b.fromChapter)
              .map((a) => (
                <p key={a.id ?? a.order} className="text-xs text-muted">
                  🎬 {a.title} · 第{a.fromChapter}-{a.toChapter}章
                  {a.goal ? ` · ${a.goal}` : ''}
                  {a.summary ? ` · ${a.summary}` : ''}
                </p>
              ))}
          </div>
        </div>
      )}
```
每卷展开只加卷头字段(Step 4 里 bridge/mainProgress 两行保留,删掉 arcs 那段)。

- [ ] **Step 6: lint + format + typecheck**

Run: `pnpm --dir agent-ui validate`
Expected: 全过。

- [ ] **Step 7: 提交**

```bash
git -C /Users/taowen/project/narratox add agent-ui/src/types/novel.ts agent-ui/src/components/workspace/ResourcePanel.tsx
git -C /Users/taowen/project/narratox commit -m "feat(agent-ui): 大纲面板加总纲区 + 弧线区 + 卷纲字段"
```

---

## Task 11:全量回归 + CLAUDE.md

**Files:** `CLAUDE.md`

- [ ] **Step 1: 全量回归**

Run:
```bash
pnpm --dir server test && pnpm --dir server typecheck && pnpm --dir agent-ui validate
```
Expected: 全绿。

- [ ] **Step 2: CLAUDE.md 加 Phase 18**

`### Phase status` 末尾(Deferred 之前)加;Phase 17 条去掉 `(current)`:
```markdown
- **Phase 18 (总纲 + 弧线暴露 + 卷纲补, current):** 补全书级 **`MasterOutline`** 模型(1:1 Novel,6 字段对应长篇杀手:theme/mainLine/ending + `powerProgression`[Json 力量进阶曲线,锁战力崩坏] + `hiddenLines`[Json 暗线时刻表 埋→推进→揭示,锁暗线遗忘] + `volumeSplitLogic`)。`buildMasterOutlineSlice` 纯函数(server/src/agentos/master-slice.ts)注入【总纲】slice —— **main 经 ContextAssembler(首个 slice,北极星)+ writer 经 runTurn augment**(写作源头锁战力/主线)。outline-writer 增 `set_master_outline` 工具,**分卷前先立总纲**;OUTLINER_WRITER 原"建总纲"改名"分卷"(那是 volume-building)。**`get_outline` 增返 master + arcs**;FE 大纲面板加【总纲】区 + 【弧线】区(Phase 12 建了 Arc 却一直没 UI,本期补)。**`Volume` 加 `bridge`(承上启下)+ `mainProgress`(主线推进点)**(卷纲轻量补)。**一条 DB 迁移**(MasterOutline + Volume 两字段,手动 prisma generate)。coreForeshadowing 不单列(与 StoryEvent 重叠,统一进 hiddenLines 计划态);不注入 critic/settler/orchestrator;不拆章纲/细纲。Spec: [2026-06-28-master-outline-design.md](docs/superpowers/specs/2026-06-28-master-outline-design.md). Plan: [2026-06-28-master-outline.md](docs/superpowers/plans/2026-06-28-master-outline.md).
```

- [ ] **Step 3: 提交**

```bash
git -C /Users/taowen/project/narratox add CLAUDE.md
git -C /Users/taowen/project/narratox commit -m "docs: CLAUDE.md Phase 18(总纲+弧线暴露+卷纲补)"
```

---

## Self-Review

- **Spec 覆盖**:
  - MasterOutline 模型 6 字段 → Task 1 ✅
  - MasterOutlineService upsert/get → Task 2 ✅
  - buildMasterOutlineSlice 纯函数 → Task 3 ✅
  - 注入 main+writer → Task 7(main)/ Task 8(writer)✅
  - set_master_outline + outline-writer 挂载 → Task 5 ✅
  - OUTLINER 立总纲 step0 + 改名 + 卷纲 → Task 9 ✅
  - get_outline 增返 master+arcs → Task 6 ✅
  - set_volume 加 bridge/mainProgress → Task 6 ✅
  - FE 总纲区 + 弧线区 + 卷头字段 → Task 10 ✅
  - 卷纲轻量补(Volume 字段)→ Task 1(schema)+ Task 4(service)+ Task 6(tool)+ Task 10(UI)✅
- **一致性**:`buildMasterOutlineSlice` 签名 Task 3/7/8 一致;`listOutline` 返回 `{master,volumes,arcs,chapterOutlines}` 在 Task 4 定义、Task 6(get_outline)消费一致;MasterOutlineService 在 Task 2 注册导出,Task 4/7/8 注入一致。
- **迁移**:Task 1 一条迁移承载 MasterOutline + Volume 两字段;手动 generate。

## 验证未覆盖

- outline-writer(deepseek)是否真在分卷前认真立总纲、力量曲线/暗线是否高质量,依赖模型——L2/活 E2E 实测是唯一手段,可能需多轮调 prompt。
- 总纲注入 main+writer 的 token 成本随字段膨胀——靠 buildMasterOutlineSlice 全空返 '' + 字段精简兜底,实测观察。
- 弧线 UI 用「独立弧线区」(非归卷范围匹配)——若后续要弧线精确归卷,需 get_outline 返回 arc.volumeId(本期 tool 未返,FE 类型留 id 可选)。
