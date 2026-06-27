# 卷级 + 弧线级摘要 实施计划(Phase 12)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 注入【当前弧线】(当前 Arc goal+summary + 当前 Volume goal+arcSummary),让 writer 写章时知道全局位置。新 Arc model(带 chapter range)+ Volume.arcSummary 滚动 + settler 滚动更新 + outliner 分弧。

**Architecture:** Arc 按 chapter range 可查「当前弧」;settler 经 write_summary 出 summary 文本,工具按 chapterOrder 解析目标 arc/volume;ContextAssembler 注入。零 FE。

**Tech Stack:** NestJS + Prisma 7(改 schema 后**手动 generate**)+ deepagents;jest + typecheck。

**Spec:** [2026-06-27-arc-volume-summary-design.md](../specs/2026-06-27-arc-volume-summary-design.md)

---

## Task 1:Prisma Volume.arcSummary + Arc model + migrate + generate

**Files:** `server/prisma/schema.prisma`

- [ ] **Step 1: Volume 加 arcSummary**

`model Volume`(约 schema.prisma:162-176)的 `synopsis` 行后加:
```prisma
  arcSummary String   @default("")   // 滚动:本卷已写进展(区别于规划期 synopsis)
```
并在 Volume model 加反向关系 `arcs Arc[]`。

- [ ] **Step 2: 新增 Arc model**(Volume model 之后):
```prisma
/// 弧线(卷内子段),带 chapter range。「当前弧」按 currentChapter 落点查。
model Arc {
  id          String   @id @default(cuid())
  novelId     String
  novel       Novel    @relation(fields: [novelId], references: [id], onDelete: Cascade)
  volumeId    String?
  volume      Volume?  @relation(fields: [volumeId], references: [id], onDelete: SetNull)
  order       Int
  title       String
  goal        String   @default("")
  fromChapter Int
  toChapter   Int
  summary     String   @default("")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([novelId, order])
  @@index([novelId, fromChapter])
}
```

- [ ] **Step 3: Novel 加反向关系** `arcs Arc[]`(与 `volumes Volume[]` 同区)。

- [ ] **Step 4: migrate + generate**
```bash
cd /Users/taowen/project/narratox/server && pnpm exec prisma migrate dev --name add_arc_volume_summary && pnpm exec prisma generate
```

- [ ] **Step 5: typecheck + 提交**
```bash
git add server/prisma/schema.prisma server/prisma/migrations/
git commit -m "feat(db): Arc model + Volume.arcSummary(Phase 12)"
```

---

## Task 2:ArcService + module + 单测(TDD)

**Files:** Create `server/src/novel/arc.service.ts` + spec;Modify novel.module.ts

- [ ] **Step 1: spec 先行**(照 event.service.spec 模式)。核心用例:
  - `upsertArc` 按 (novelId,order) upsert,带 ownership 校验。
  - `listArcs` scope by userId,按 fromChapter asc。
  - `findArcByChapter(novelId, N)` range 命中(fromChapter≤N≤toChapter)。
  - `updateProgressSummary(userId, novelId, N, arcSummary?, volumeArcSummary?)`:arc 命中 → 更新 arc.summary;volume(arc.volumeId 或回落 ChapterOutline.volumeId)→ 更新 volume.arcSummary;都解析不到 → 不抛错。

- [ ] **Step 2: 跑 spec 确认 fail;Step 3: 实现 ArcService**(照 event.service.ts;user scope `novel: { userId }`):

```ts
@Injectable()
export class ArcService {
  constructor(private readonly prisma: PrismaService) {}

  async upsertArc(userId, novelId, input: { order; volumeId?; title; goal?; fromChapter; toChapter }) {
    const owned = await this.prisma.novel.findFirst({ where: { id: novelId, userId }, select: { id: true } });
    if (!owned) throw new ForbiddenException('novel not owned');
    return this.prisma.arc.upsert({
      where: { novelId_order: { novelId, order: input.order } },
      create: { novelId, ...input },
      update: { ...input },
    });
  }

  async listArcs(userId, novelId) {
    return this.prisma.arc.findMany({
      where: { novelId, novel: { userId } },
      orderBy: { fromChapter: 'asc' },
      select: { id: true, order: true, volumeId: true, title: true, goal: true, fromChapter: true, toChapter: true, summary: true },
    });
  }

  async findArcByChapter(userId, novelId, chapterOrder) {
    return this.prisma.arc.findFirst({
      where: { novelId, fromChapter: { lte: chapterOrder }, toChapter: { gte: chapterOrder }, novel: { userId } },
    });
  }

  async updateProgressSummary(userId, novelId, chapterOrder, arcSummary?, volumeArcSummary?) {
    const arc = await this.findArcByChapter(userId, novelId, chapterOrder);
    if (arcSummary && arc)
      await this.prisma.arc.update({ where: { id: arc.id }, data: { summary: arcSummary } });
    let volumeId = arc?.volumeId ?? null;
    if (!volumeId) {
      const outline = await this.prisma.chapterOutline.findFirst({
        where: { novelId, chapterOrder, novel: { userId } }, select: { volumeId: true } });
      volumeId = outline?.volumeId ?? null;
    }
    if (volumeArcSummary && volumeId)
      await this.prisma.volume.update({ where: { id: volumeId }, data: { arcSummary: volumeArcSummary } });
  }
}
```
> volume.update 的 scope:volumeId 来自已 scope 的 arc/outline,可不再校验。

- [ ] **Step 4: 跑 spec 确认 pass;Step 5: 注册到 NovelModule(providers+exports);Step 6: typecheck + 提交。**

---

## Task 3:set_arc + get_arcs 工具 + 接线 + agent-tree(TDD)

**Files:** Create `set-arc.tool.ts` + `get-arcs.tool.ts` + specs;Modify agent-registry.ts、agent-tree.config.ts(+spec)、deep-agent.service.ts(ToolDeps += arcService)

- [ ] **set_arc**(outline-writer 用):入参 `order, volumeOrder?(解析 volumeId via outlines.findVolumeByOrder), title, goal?, fromChapter, toChapter` → `arcService.upsertArc`。
- [ ] **get_arcs**(writer/main 用):无参 → `arcService.listArcs` → `JSON.stringify`。
- [ ] **agent-tree**:outline-writer.tools += `set_arc`;writer/main.tools += `get_arcs`。spec 快照同步 + 正向断言。
- [ ] **ToolDeps** += `arcService: ArcService`;deep-agent.service 注入;agent-registry 注册两工具;agent-registry.spec makeDeps += arcService。
- [ ] 跑 test + typecheck + 提交。

---

## Task 4:write_summary += 滚动 arc/volume summary

**Files:** `write-summary.tool.ts`(+spec)、agent-registry(makeWriteSummaryTool += arcService)

- [ ] zod schema 加可选 `currentArcSummary: z.string().optional()` + `currentVolumeArcSummary: z.string().optional()`。
- [ ] 工厂签名 += `arcService: ArcService`;tool body:if 任一有值 → `arcService.updateProgressSummary(userId, novelId, chapterOrder, currentArcSummary, currentVolumeArcSummary)`。
- [ ] agent-registry write_summary 注册 += `arcService: d.arcService`。
- [ ] write-summary.tool.spec 加用例:currentArcSummary 传 → updateProgressSummary 被调(按本章)。
- [ ] 跑 test + typecheck + 提交。

---

## Task 5:ContextAssembler 【当前弧线】 slice

**Files:** `context-assembler.service.ts`(+ spec 构造同步)

- [ ] 构造 += `arcService: ArcService`;forSession 拉:`const currentArc = currentChapter > 0 ? await this.arcService.findArcByChapter(userId, novel.id, currentChapter) : null;` 并按需取 volume。
- [ ] slices push(在前情/事件附近):
```ts
if (currentArc) {
  const vol = currentArc.volumeId ? await this.prisma.volume.findUnique({ where: { id: currentArc.volumeId }, select: { title: true, goal: true, arcSummary: true, synopsis: true } }) : null;
  const lines = [`弧${currentArc.order}「${currentArc.title}」(第${currentArc.fromChapter}-${currentArc.toChapter}章${currentArc.goal ? `,目标:${currentArc.goal}` : ''})`];
  if (currentArc.summary) lines.push(`弧进展:${currentArc.summary}`);
  if (vol?.arcSummary) lines.push(`卷进展:${vol.arcSummary}`);
  slices.push(`【当前弧线】${vol ? `卷《${vol.title}》· ` : ''}${lines.join(' / ')}`);
}
```
- [ ] context-assembler.service.spec + memory.spec 构造 += arcService stub({ findArcByChapter: jest.fn().mockResolvedValue(null) })。
- [ ] pipeline.spec += arcService 实例。
- [ ] 跑 test + typecheck + 提交。

---

## Task 6:prompts(OUTLINER 分弧 + SETTLER 滚动 + WRITER 提示)

**Files:** `agent-prompts.ts`

- [ ] **OUTLINER_ORCH 任务类型 + OUTLINE_WRITER**:建卷后把每卷切 2-4 弧(set_arc:order/title/goal/fromChapter/toChapter,挂 volumeOrder),弧线是卷内主线节拍。
- [ ] **SETTLER**:加【弧线/卷 滚动摘要】——每章结算后,据本章+近况重写 `currentArcSummary`(本弧进展)+ `currentVolumeArcSummary`(本卷进展),各一两句。
- [ ] **WRITER**:【细纲】段附近加一句——【当前弧线】在你背景里(卷/弧目标+进展),写作对齐当前弧线目标。
- [ ] 跑 test(回归)+ typecheck + 提交。

---

## Task 7:CLAUDE.md Phase 12 入档

- [ ] Phase 11 去 current;加 Phase 12 条(Arc model + Volume.arcSummary + settler 滚动 + 注入【当前弧线】 + outliner 分弧 + 无 FE + spec/plan 链接)。提交。

---

## Self-Review

- **Spec 覆盖**:Arc model+Volume.arcSummary → T1;ArcService → T2;set_arc/get_arcs → T3;settler 滚动 → T4;注入 → T5;分弧/滚动/提示 → T6。无 FE / 不自动分弧 / arc 不跨卷 / 每章重写 → 显式不做。✅
- **一致性**:arc by range 查询贯穿(findArcByChapter + updateProgressSummary + 注入);set_arc 经 outlines 解析 volumeOrder(同 set_chapter_plan 模式);ToolDeps += arcService。✅

## 验证未覆盖

- settler 是否稳定重写 arc/volume summary、注入是否真帮 writer 定位,需活 E2E(跨弧线写若干章)。本期不强制。
