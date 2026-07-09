# 大纲细粒度编辑(删除 + 字段级 patch)实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 outline-writer 加 5 个 tool(`delete_chapter_plan` / `delete_volume` / `delete_arc` / `clear_master_outline` / `patch_chapter_plan`),让大纲可删可改;零 DB 迁移、零 FE 改动。

**Architecture:** 服务层在 `OutlineService` / `ArcService` / `MasterOutlineService` 加方法;5 个 tool factory 走现有 `TOOL_REGISTRY` 模式;全部挂 outline-writer;3 处 prompt 编辑补用法纪律。WRITTEN 细纲软护栏(代码不拦、prompt 拦);删卷可选 cascade(默认 false 预检拒绝,true 时事务连删);chapterOrder 不 renumber。

**Tech Stack:** NestJS 11 + Prisma 7 + @langchain/core/tools + zod + jest。

**Spec:** [2026-07-09-outline-fine-grained-edit-design.md](../specs/2026-07-09-outline-fine-grained-edit-design.md)

---

## 文件结构

**修改:**
- `server/src/novel/outline.service.ts` — 加 `deleteChapterPlan` / `deleteVolume` / `patchChapterPlan`
- `server/src/novel/arc.service.ts` — 加 `deleteArc`
- `server/src/novel/master-outline.service.ts` — 加 `clear`
- `server/src/agentos/agent-registry.ts` — 注册 5 个 tool factory
- `server/src/agentos/agent-tree.config.ts` — outline-writer 的 `tools` 数组加 5 个 key
- `server/src/agentos/prompts/outliner-orchestrator.md` — 加「删/改大纲节点」任务类型
- `server/src/agentos/prompts/outline-writer.md` — 加 delete/patch 用法纪律
- `server/src/agentos/prompts/main.md` — 委派协议补一句
- `server/test/smoke/l1-integration.spec.ts` — 加一轮 patch+delete 冒烟

**新建:**
- `server/src/agentos/tools/delete-chapter-plan.tool.ts` + `.spec.ts`
- `server/src/agentos/tools/delete-volume.tool.ts` + `.spec.ts`
- `server/src/agentos/tools/delete-arc.tool.ts` + `.spec.ts`
- `server/src/agentos/tools/clear-master-outline.tool.ts` + `.spec.ts`
- `server/src/agentos/tools/patch-chapter-plan.tool.ts` + `.spec.ts`

---

## Task 1: OutlineService.deleteChapterPlan + 单测

**Files:**
- Modify: `server/src/novel/outline.service.ts`
- Test: `server/src/novel/outline.service.spec.ts`(若不存在则新建;现有位置参考 `server/src/agentos/tools/set-chapter-plan.tool.spec.ts` 的 mock 风格——但 service 层需真 prisma mock)

- [ ] **Step 1: 先查现有 outline.service.spec.ts 是否存在**

Run: `ls server/src/novel/outline.service.spec.ts 2>/dev/null && echo EXISTS || echo MISSING`

若 MISSING,看 `server/src/novel/arc.service.spec.ts` 或任意 `*.service.spec.ts` 找 mock PrismaService 的范式;复用其 setup。

- [ ] **Step 2: 写失败测试 — deleteChapterPlan DRAFT → ok**

加到 outline.service.spec.ts(或新建)。Mock prisma.chapterOutline.findFirst / delete:

```ts
describe('OutlineService.deleteChapterPlan', () => {
  it('DRAFT 细纲 → ok 无 warning', async () => {
    prisma.chapterOutline.findFirst = jest.fn().mockResolvedValue({
      id: 'co1', chapterOrder: 5, status: 'DRAFT',
    });
    prisma.chapterOutline.delete = jest.fn().mockResolvedValue({});
    prisma.novel.findFirst = jest.fn().mockResolvedValue({ id: 'n1' });
    const r = await outlines.deleteChapterPlan('u1', 'n1', 5);
    expect(r).toEqual({ ok: true, chapterOrder: 5, warned: false });
    expect(prisma.chapterOutline.delete).toHaveBeenCalledWith({ where: { id: 'co1' } });
  });

  it('WRITTEN 细纲 → ok 且 warned=true(软护栏)', async () => {
    prisma.chapterOutline.findFirst = jest.fn().mockResolvedValue({
      id: 'co2', chapterOrder: 3, status: 'WRITTEN',
    });
    prisma.chapterOutline.delete = jest.fn().mockResolvedValue({});
    prisma.novel.findFirst = jest.fn().mockResolvedValue({ id: 'n1' });
    const r = await outlines.deleteChapterPlan('u1', 'n1', 3);
    expect(r).toEqual({
      ok: true, chapterOrder: 3, warned: true,
      reason: expect.stringContaining('已写'),
    });
  });

  it('不存在的细纲 → {ok:false, reason:"not_found"}', async () => {
    prisma.chapterOutline.findFirst = jest.fn().mockResolvedValue(null);
    prisma.novel.findFirst = jest.fn().mockResolvedValue({ id: 'n1' });
    const r = await outlines.deleteChapterPlan('u1', 'n1', 99);
    expect(r).toEqual({ ok: false, reason: 'not_found' });
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm --dir server test -- outline.service.spec.ts -t "deleteChapterPlan"`
Expected: FAIL(`deleteChapterPlan is not a function`)

- [ ] **Step 4: 实现 deleteChapterPlan**

加到 `outline.service.ts`:

```ts
/**
 * 删第 chapterOrder 章细纲。WRITTEN 细纲软护栏:代码不拦,返回 warned=true。
 * user-scoped:先 ownership(novel 属 user)+ 行存在校验。
 */
async deleteChapterPlan(
  userId: string,
  novelId: string,
  chapterOrder: number,
): Promise<
  | { ok: true; chapterOrder: number; warned: boolean; reason?: string }
  | { ok: false; reason: 'not_found' }
> {
  await this.assertOwned(userId, novelId);
  const existing = await this.prisma.chapterOutline.findFirst({
    where: { novelId, chapterOrder },
    select: { id: true, status: true },
  });
  if (!existing) return { ok: false, reason: 'not_found' };
  await this.prisma.chapterOutline.delete({ where: { id: existing.id } });
  if (existing.status === 'WRITTEN') {
    return {
      ok: true,
      chapterOrder,
      warned: true,
      reason: '本章已写,删除后 validator dim12「细纲兑现」将失去审计依据',
    };
  }
  return { ok: true, chapterOrder, warned: false };
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm --dir server test -- outline.service.spec.ts -t "deleteChapterPattern"`
Expected: PASS(3 个 case)

- [ ] **Step 6: 提交**

```bash
git add server/src/novel/outline.service.ts server/src/novel/outline.service.spec.ts
git commit -m "feat(outline): OutlineService.deleteChapterPlan(DRAFT/WRITTEN 软护栏)"
```

---

## Task 2: OutlineService.deleteVolume(可选 cascade)+ 单测

**Files:**
- Modify: `server/src/novel/outline.service.ts`
- Test: `server/src/novel/outline.service.spec.ts`

- [ ] **Step 1: 写失败测试**

```ts
describe('OutlineService.deleteVolume', () => {
  it('cascade=false 且无下属 → ok', async () => {
    prisma.novel.findFirst = jest.fn().mockResolvedValue({ id: 'n1' });
    prisma.volume.findFirst = jest.fn().mockResolvedValue({ id: 'v1', order: 2 });
    prisma.arc.count = jest.fn().mockResolvedValue(0);
    prisma.chapterOutline.count = jest.fn().mockResolvedValue(0);
    prisma.volume.delete = jest.fn().mockResolvedValue({});
    const r = await outlines.deleteVolume('u1', 'n1', 2, false);
    expect(r.ok).toBe(true);
    expect(prisma.volume.delete).toHaveBeenCalledWith({ where: { id: 'v1' } });
  });

  it('cascade=false 且有下属 → HAS_DESCENDANTS 报错清单', async () => {
    prisma.novel.findFirst = jest.fn().mockResolvedValue({ id: 'n1' });
    prisma.volume.findFirst = jest.fn().mockResolvedValue({ id: 'v1', order: 1 });
    prisma.arc.count = jest.fn().mockResolvedValue(2);
    prisma.chapterOutline.count = jest.fn().mockResolvedValue(5);
    const r = await outlines.deleteVolume('u1', 'n1', 1, false);
    expect(r).toEqual({
      ok: false,
      error: 'HAS_DESCENDANTS',
      arcs: 2,
      chapterPlans: 5,
      hint: expect.stringContaining('cascade=true'),
    });
  });

  it('cascade=true → 事务连删 volume+arcs+chapterOutlines', async () => {
    prisma.novel.findFirst = jest.fn().mockResolvedValue({ id: 'n1' });
    prisma.volume.findFirst = jest.fn().mockResolvedValue({ id: 'v1', order: 1 });
    prisma.arc.count = jest.fn().mockResolvedValue(2);
    prisma.chapterOutline.count = jest.fn().mockResolvedValue(5);
    const txMock = {
      arc: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
      chapterOutline: { deleteMany: jest.fn().mockResolvedValue({ count: 5 }) },
      volume: { delete: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction = jest.fn().mockImplementation(async (cb) => cb(txMock));
    const r = await outlines.deleteVolume('u1', 'n1', 1, true);
    expect(r).toEqual({ ok: true, order: 1, deletedArcs: 2, deletedChapterPlans: 5 });
    expect(txMock.arc.deleteMany).toHaveBeenCalled();
    expect(txMock.chapterOutline.deleteMany).toHaveBeenCalled();
    expect(txMock.volume.delete).toHaveBeenCalledWith({ where: { id: 'v1' } });
  });

  it('卷不存在 → {ok:false, reason:"not_found"}', async () => {
    prisma.novel.findFirst = jest.fn().mockResolvedValue({ id: 'n1' });
    prisma.volume.findFirst = jest.fn().mockResolvedValue(null);
    const r = await outlines.deleteVolume('u1', 'n1', 9, false);
    expect(r).toEqual({ ok: false, reason: 'not_found' });
  });
});
```

- [ ] **Step 2: 跑确认失败**

Run: `pnpm --dir server test -- outline.service.spec.ts -t "deleteVolume"`
Expected: FAIL

- [ ] **Step 3: 实现**

加到 `outline.service.ts`(顶部 import `ForbiddenException` 若尚未引入):

```ts
/**
 * 删一卷。cascade=false(默认)且卷下有 arcs/chapterOutlines → 报错返回清单(不偷删)。
 * cascade=true → $transaction 一次性删 volume + 下属 arcs + chapterOutlines。
 * 不依赖 DB 级联(Arc/ChapterOutline 的 volumeId 是 SetNull),预检+显式连删便于精确反馈。
 */
async deleteVolume(
  userId: string,
  novelId: string,
  order: number,
  cascade: boolean,
): Promise<
  | { ok: true; order: number; deletedArcs: number; deletedChapterPlans: number }
  | { ok: false; error: 'HAS_DESCENDANTS'; arcs: number; chapterPlans: number; hint: string }
  | { ok: false; reason: 'not_found' }
> {
  await this.assertOwned(userId, novelId);
  const vol = await this.prisma.volume.findFirst({
    where: { novelId, order, novel: { userId } },
    select: { id: true },
  });
  if (!vol) return { ok: false, reason: 'not_found' };

  const [arcCount, planCount] = await Promise.all([
    this.prisma.arc.count({ where: { volumeId: vol.id } }),
    this.prisma.chapterOutline.count({ where: { volumeId: vol.id } }),
  ]);

  if (!cascade && (arcCount > 0 || planCount > 0)) {
    return {
      ok: false,
      error: 'HAS_DESCENDANTS',
      arcs: arcCount,
      chapterPlans: planCount,
      hint: `卷 ${order} 下属 ${arcCount} 弧 / ${planCount} 细纲,请先删除/移走它们,或传 cascade=true 连带删`,
    };
  }

  const result = await this.prisma.$transaction(async (tx) => {
    const a = await tx.arc.deleteMany({ where: { volumeId: vol.id } });
    const c = await tx.chapterOutline.deleteMany({ where: { volumeId: vol.id } });
    await tx.volume.delete({ where: { id: vol.id } });
    return { deletedArcs: a.count, deletedChapterPlans: c.count };
  });
  return { ok: true, order, ...result };
}
```

- [ ] **Step 4: 跑确认通过**

Run: `pnpm --dir server test -- outline.service.spec.ts -t "deleteVolume"`
Expected: PASS(4 case)

- [ ] **Step 5: typecheck**

Run: `pnpm --dir server typecheck`
Expected: 无错

- [ ] **Step 6: 提交**

```bash
git add server/src/novel/outline.service.ts server/src/novel/outline.service.spec.ts
git commit -m "feat(outline): OutlineService.deleteVolume(可选 cascade,事务连删)"
```

---

## Task 3: OutlineService.patchChapterPlan + 单测

**Files:**
- Modify: `server/src/novel/outline.service.ts`
- Test: `server/src/novel/outline.service.spec.ts`

- [ ] **Step 1: 写失败测试**

```ts
describe('OutlineService.patchChapterPlan', () => {
  it('只传 cen → 仅 cen 更新,其他不动', async () => {
    prisma.novel.findFirst = jest.fn().mockResolvedValue({ id: 'n1' });
    prisma.chapterOutline.findFirst = jest.fn().mockResolvedValue({ id: 'co1' });
    prisma.chapterOutline.update = jest.fn().mockResolvedValue({});
    const cen = { subject: '主角', action: '到达', target: '山门' };
    const r = await outlines.patchChapterPlan('u1', 'n1', 5, { cen });
    expect(r).toEqual({ ok: true, chapterOrder: 5, updatedFields: ['cen'] });
    expect(prisma.chapterOutline.update).toHaveBeenCalledWith({
      where: { id: 'co1' },
      data: { cen },
    });
  });

  it('传 volumeOrder → 解析 volumeId', async () => {
    prisma.novel.findFirst = jest.fn().mockResolvedValue({ id: 'n1' });
    prisma.volume.findFirst = jest.fn().mockResolvedValue({ id: 'v3' }); // findVolumeByOrder
    prisma.chapterOutline.findFirst = jest.fn().mockResolvedValue({ id: 'co1' });
    prisma.chapterOutline.update = jest.fn().mockResolvedValue({});
    const r = await outlines.patchChapterPlan('u1', 'n1', 5, { volumeOrder: 3 });
    expect(r.updatedFields).toContain('volumeId');
    expect(prisma.chapterOutline.update).toHaveBeenCalledWith({
      where: { id: 'co1' },
      data: { volumeId: 'v3' },
    });
  });

  it('不存在的章 → {ok:false, reason:"not_found"}', async () => {
    prisma.novel.findFirst = jest.fn().mockResolvedValue({ id: 'n1' });
    prisma.chapterOutline.findFirst = jest.fn().mockResolvedValue(null);
    const r = await outlines.patchChapterPlan('u1', 'n1', 99, { title: 'x' });
    expect(r).toEqual({ ok: false, reason: 'not_found' });
  });

  it('空 patch(无任何字段)→ {ok:false, reason:"empty_patch"}', async () => {
    prisma.novel.findFirst = jest.fn().mockResolvedValue({ id: 'n1' });
    const r = await outlines.patchChapterPlan('u1', 'n1', 5, {});
    expect(r).toEqual({ ok: false, reason: 'empty_patch' });
  });
});
```

- [ ] **Step 2: 跑确认失败**

Run: `pnpm --dir server test -- outline.service.spec.ts -t "patchChapterPlan"`
Expected: FAIL

- [ ] **Step 3: 实现**

加到 `outline.service.ts`(顶部 import `Prisma` 已存在):

```ts
/** patch_chapter_plan 的部分更新入参。全 optional:只改传了字段。 */
export interface ChapterPlanPatch {
  title?: string;
  cbn?: OutlineNode;
  cpns?: OutlineNode[];
  cen?: OutlineNode;
  mustCover?: string[];
  forbidden?: string[];
  volumeOrder?: number;
}

/**
 * 字段级改细纲。未传字段零变更;数组/对象字段整体替换(不按索引合并)。
 * volumeOrder 会被解析成 volumeId(与 set_chapter_plan 一致);chapterOrder 不可改。
 * patch 不是 upsert:不存在的章返 not_found(要新建走 upsertChapterPlan)。
 */
async patchChapterPlan(
  userId: string,
  novelId: string,
  chapterOrder: number,
  data: ChapterPlanPatch,
): Promise<
  | { ok: true; chapterOrder: number; updatedFields: string[] }
  | { ok: false; reason: 'not_found' | 'empty_patch' }
> {
  await this.assertOwned(userId, novelId);
  const fields: Record<string, unknown> = {};
  if (data.title !== undefined) fields.title = data.title;
  if (data.cbn !== undefined) fields.cbn = data.cbn as unknown as Prisma.InputJsonValue;
  if (data.cpns !== undefined) fields.cpns = data.cpns as unknown as Prisma.InputJsonValue;
  if (data.cen !== undefined) fields.cen = data.cen as unknown as Prisma.InputJsonValue;
  if (data.mustCover !== undefined)
    fields.mustCover = data.mustCover as unknown as Prisma.InputJsonValue;
  if (data.forbidden !== undefined)
    fields.forbidden = data.forbidden as unknown as Prisma.InputJsonValue;
  if (data.volumeOrder !== undefined) {
    const vol = await this.findVolumeByOrder(userId, novelId, data.volumeOrder);
    if (vol) fields.volumeId = vol.id;
  }
  if (Object.keys(fields).length === 0) return { ok: false, reason: 'empty_patch' };

  const existing = await this.prisma.chapterOutline.findFirst({
    where: { novelId, chapterOrder, novel: { userId } },
    select: { id: true },
  });
  if (!existing) return { ok: false, reason: 'not_found' };

  await this.prisma.chapterOutline.update({
    where: { id: existing.id },
    data: fields,
  });
  return { ok: true, chapterOrder, updatedFields: Object.keys(fields) };
}
```

- [ ] **Step 4: 跑确认通过**

Run: `pnpm --dir server test -- outline.service.spec.ts -t "patchChapterPlan"`
Expected: PASS(4 case)

- [ ] **Step 5: 提交**

```bash
git add server/src/novel/outline.service.ts server/src/novel/outline.service.spec.ts
git commit -m "feat(outline): OutlineService.patchChapterPlan(字段级改,数组整体替换)"
```

---

## Task 4: ArcService.deleteArc + MasterOutlineService.clear + 单测

**Files:**
- Modify: `server/src/novel/arc.service.ts`
- Modify: `server/src/novel/master-outline.service.ts`
- Test: `server/src/novel/arc.service.spec.ts`(若存在)或新增 case 到合理位置
- Test: `server/src/novel/master-outline.service.spec.ts`(若存在)

- [ ] **Step 1: 先查 spec 文件存在性**

Run: `ls server/src/novel/arc.service.spec.ts server/src/novel/master-outline.service.spec.ts 2>&1`

存在则追加 case;不存在则新建文件,mock 风格参考 Task 1。

- [ ] **Step 2: 写 deleteArc 失败测试**

```ts
describe('ArcService.deleteArc', () => {
  it('存在 → 干净删,无级联', async () => {
    prisma.novel.findFirst = jest.fn().mockResolvedValue({ id: 'n1' });
    prisma.arc.findFirst = jest.fn().mockResolvedValue({ id: 'a1' });
    prisma.arc.delete = jest.fn().mockResolvedValue({});
    const r = await arcs.deleteArc('u1', 'n1', 3);
    expect(r).toEqual({ ok: true, order: 3 });
    expect(prisma.arc.delete).toHaveBeenCalledWith({ where: { id: 'a1' } });
  });

  it('不存在 → {ok:false, reason:"not_found"}', async () => {
    prisma.novel.findFirst = jest.fn().mockResolvedValue({ id: 'n1' });
    prisma.arc.findFirst = jest.fn().mockResolvedValue(null);
    const r = await arcs.deleteArc('u1', 'n1', 99);
    expect(r).toEqual({ ok: false, reason: 'not_found' });
  });
});
```

- [ ] **Step 3: 实现 deleteArc**

加到 `arc.service.ts`:

```ts
/** 删弧线。无级联(ChapterOutline 不引用 Arc FK)。upsert 用 novelId_order unique。 */
async deleteArc(
  userId: string,
  novelId: string,
  order: number,
): Promise<{ ok: true; order: number } | { ok: false; reason: 'not_found' }> {
  const owned = await this.prisma.novel.findFirst({
    where: { id: novelId, userId },
    select: { id: true },
  });
  if (!owned) throw new ForbiddenException('novel not owned by user');
  const existing = await this.prisma.arc.findFirst({
    where: { novelId, order, novel: { userId } },
    select: { id: true },
  });
  if (!existing) return { ok: false, reason: 'not_found' };
  await this.prisma.arc.delete({ where: { id: existing.id } });
  return { ok: true, order };
}
```

- [ ] **Step 4: 跑确认通过**

Run: `pnpm --dir server test -- arc.service.spec.ts`
Expected: PASS

- [ ] **Step 5: 写 clear 失败测试**

```ts
describe('MasterOutlineService.clear', () => {
  it('存在 → 删整行,ACTIVE 返 warning', async () => {
    prisma.novel.findFirst = jest.fn().mockResolvedValue({ id: 'n1', status: 'ACTIVE' });
    prisma.masterOutline.findFirst = jest.fn().mockResolvedValue({ id: 'm1' });
    prisma.masterOutline.delete = jest.fn().mockResolvedValue({});
    const r = await masterOutlines.clear('u1', 'n1');
    expect(r.ok).toBe(true);
    expect(r.warned).toBe(true);
    expect(prisma.masterOutline.delete).toHaveBeenCalledWith({ where: { id: 'm1' } });
  });

  it('CONCEPT → 删,无 warning', async () => {
    prisma.novel.findFirst = jest.fn().mockResolvedValue({ id: 'n1', status: 'CONCEPT' });
    prisma.masterOutline.findFirst = jest.fn().mockResolvedValue({ id: 'm1' });
    prisma.masterOutline.delete = jest.fn().mockResolvedValue({});
    const r = await masterOutlines.clear('u1', 'n1');
    expect(r).toEqual({ ok: true, warned: false });
  });

  it('不存在 → {ok:false, reason:"not_found"}', async () => {
    prisma.novel.findFirst = jest.fn().mockResolvedValue({ id: 'n1', status: 'ACTIVE' });
    prisma.masterOutline.findFirst = jest.fn().mockResolvedValue(null);
    const r = await masterOutlines.clear('u1', 'n1');
    expect(r).toEqual({ ok: false, reason: 'not_found' });
  });
});
```

- [ ] **Step 6: 实现 clear**

加到 `master-outline.service.ts`:

```ts
/**
 * 删总纲整行(1:1 Novel)。ACTIVE 阶段返 warning(总纲是北极星),但不拦。
 * 重建走 upsert。
 */
async clear(
  userId: string,
  novelId: string,
): Promise<
  | { ok: true; warned: boolean; reason?: string }
  | { ok: false; reason: 'not_found' }
> {
  const n = await this.prisma.novel.findFirst({
    where: { id: novelId, userId },
    select: { id: true, status: true },
  });
  if (!n) throw new NotFoundException('Novel not found');
  const existing = await this.prisma.masterOutline.findFirst({
    where: { novelId, novel: { userId } },
    select: { id: true },
  });
  if (!existing) return { ok: false, reason: 'not_found' };
  await this.prisma.masterOutline.delete({ where: { id: existing.id } });
  if (n.status === 'ACTIVE') {
    return {
      ok: true,
      warned: true,
      reason: '总纲是北极星,删除后 writer 将失去战力/主线/三幕锚点',
    };
  }
  return { ok: true, warned: false };
}
```

- [ ] **Step 7: 跑确认通过 + typecheck**

Run: `pnpm --dir server test -- master-outline.service.spec.ts && pnpm --dir server typecheck`
Expected: PASS,无错

- [ ] **Step 8: 提交**

```bash
git add server/src/novel/arc.service.ts server/src/novel/master-outline.service.ts \
        server/src/novel/arc.service.spec.ts server/src/novel/master-outline.service.spec.ts
git commit -m "feat(outline): ArcService.deleteArc + MasterOutlineService.clear"
```

---

## Task 5: 5 个 tool factory + 工具单测

**Files:**
- Create: `server/src/agentos/tools/delete-chapter-plan.tool.ts` + `.spec.ts`
- Create: `server/src/agentos/tools/delete-volume.tool.ts` + `.spec.ts`
- Create: `server/src/agentos/tools/delete-arc.tool.ts` + `.spec.ts`
- Create: `server/src/agentos/tools/clear-master-outline.tool.ts` + `.spec.ts`
- Create: `server/src/agentos/tools/patch-chapter-plan.tool.ts` + `.spec.ts`

**Pattern:** 全部复用 `makeSetVolumeTool` / `makeSetArcTool` 的 factory 模式(闭包注入 userId/novelId/service,工具体只转发)。

- [ ] **Step 1: delete-chapter-plan.tool.ts**

```ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { OutlineService } from '../../novel/outline.service';

/** outline-writer 的「删第 N 章细纲」工具。userId/novelId 闭包注入。WRITTEN 软护栏。 */
export function makeDeleteChapterPlanTool({
  userId,
  novelId,
  outlines,
}: {
  userId: string;
  novelId: string;
  outlines: OutlineService;
}) {
  return tool(
    async ({ chapterOrder }) => {
      return outlines.deleteChapterPlan(userId, novelId, chapterOrder);
    },
    {
      name: 'delete_chapter_plan',
      description:
        '删第 chapterOrder 章细纲。若该章已写(WRITTEN),返回 warned=true(代码不拦,但删前必须先问作者确认——会失去 validator dim12「细纲兑现」审计依据)。删后该章将无法写章(关卡 assertHasPlan 会拦),需重新 set_chapter_plan 才能写。',
      schema: z.object({
        chapterOrder: z.number().int().describe('章节序号(1-based)'),
      }),
    },
  );
}
```

- [ ] **Step 2: delete-chapter-plan.tool.spec.ts**

```ts
import { makeDeleteChapterPlanTool } from './delete-chapter-plan.tool';
import type { OutlineService } from '../../novel/outline.service';

describe('delete_chapter_plan tool', () => {
  it('转发给 OutlineService.deleteChapterPlan 带 userId/novelId', async () => {
    const deleteChapterPlan = jest.fn().mockResolvedValue({
      ok: true, chapterOrder: 5, warned: false,
    });
    const outlines = { deleteChapterPlan } as unknown as OutlineService;
    const t = makeDeleteChapterPlanTool({ userId: 'u1', novelId: 'n1', outlines });
    const out = await t.invoke({ chapterOrder: 5 });
    expect(deleteChapterPlan).toHaveBeenCalledWith('u1', 'n1', 5);
    expect(out).toMatchObject({ ok: true, chapterOrder: 5 });
  });

  it('WRITTEN 细纲透传 warned=true', async () => {
    const deleteChapterPlan = jest.fn().mockResolvedValue({
      ok: true, chapterOrder: 3, warned: true, reason: '本章已写',
    });
    const outlines = { deleteChapterPlan } as unknown as OutlineService;
    const t = makeDeleteChapterPlanTool({ userId: 'u1', novelId: 'n1', outlines });
    const out: any = await t.invoke({ chapterOrder: 3 });
    expect(out.warned).toBe(true);
  });
});
```

- [ ] **Step 3: 跑确认通过**

Run: `pnpm --dir server test -- delete-chapter-plan.tool.spec.ts`
Expected: PASS

- [ ] **Step 4: delete-volume.tool.ts**

```ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { OutlineService } from '../../novel/outline.service';

/** outline-writer 的「删一卷」工具。cascade 默认 false;true 时事务连删下属。 */
export function makeDeleteVolumeTool({
  userId,
  novelId,
  outlines,
}: {
  userId: string;
  novelId: string;
  outlines: OutlineService;
}) {
  return tool(
    async ({ order, cascade }) => {
      return outlines.deleteVolume(userId, novelId, order, cascade ?? false);
    },
    {
      name: 'delete_volume',
      description:
        '删一卷。cascade 默认 false:若卷下有弧/细纲 → 返回 HAS_DESCENDANTS 清单(请先处理它们,或传 cascade=true)。cascade=true:一次性事务连删卷+下属弧+细纲。删卷前必须问作者:只删卷本体(需先移走下属)还是连下属一起删。',
      schema: z.object({
        order: z.number().int().describe('卷序号(1-based)'),
        cascade: z
          .boolean()
          .optional()
          .describe('true=连删下属弧/细纲;false(默认)=有下属时报错'),
      }),
    },
  );
}
```

- [ ] **Step 5: delete-volume.tool.spec.ts**

```ts
import { makeDeleteVolumeTool } from './delete-volume.tool';
import type { OutlineService } from '../../novel/outline.service';

describe('delete_volume tool', () => {
  it('cascade 未传 → 默认 false', async () => {
    const deleteVolume = jest.fn().mockResolvedValue({
      ok: false, error: 'HAS_DESCENDANTS', arcs: 1, chapterPlans: 2, hint: 'x',
    });
    const outlines = { deleteVolume } as unknown as OutlineService;
    const t = makeDeleteVolumeTool({ userId: 'u1', novelId: 'n1', outlines });
    await t.invoke({ order: 1 });
    expect(deleteVolume).toHaveBeenCalledWith('u1', 'n1', 1, false);
  });

  it('cascade=true 透传', async () => {
    const deleteVolume = jest.fn().mockResolvedValue({
      ok: true, order: 1, deletedArcs: 2, deletedChapterPlans: 5,
    });
    const outlines = { deleteVolume } as unknown as OutlineService;
    const t = makeDeleteVolumeTool({ userId: 'u1', novelId: 'n1', outlines });
    const out: any = await t.invoke({ order: 1, cascade: true });
    expect(deleteVolume).toHaveBeenCalledWith('u1', 'n1', 1, true);
    expect(out.deletedArcs).toBe(2);
  });
});
```

- [ ] **Step 6: delete-arc.tool.ts + spec**

```ts
// delete-arc.tool.ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { ArcService } from '../../novel/arc.service';

/** outline-writer 的「删一条弧线」工具。无级联(ChapterOutline 不引用 Arc FK)。 */
export function makeDeleteArcTool({
  userId,
  novelId,
  arcs,
}: {
  userId: string;
  novelId: string;
  arcs: ArcService;
}) {
  return tool(
    async ({ order }) => arcs.deleteArc(userId, novelId, order),
    {
      name: 'delete_arc',
      description:
        '删一条弧线(卷内子段)。无级联——ChapterOutline 不引用 Arc,删弧对细纲零影响。',
      schema: z.object({
        order: z.number().int().describe('弧线序号(全书唯一,1-based)'),
      }),
    },
  );
}
```

```ts
// delete-arc.tool.spec.ts
import { makeDeleteArcTool } from './delete-arc.tool';
import type { ArcService } from '../../novel/arc.service';

describe('delete_arc tool', () => {
  it('转发给 ArcService.deleteArc', async () => {
    const deleteArc = jest.fn().mockResolvedValue({ ok: true, order: 3 });
    const arcs = { deleteArc } as unknown as ArcService;
    const t = makeDeleteArcTool({ userId: 'u1', novelId: 'n1', arcs });
    const out = await t.invoke({ order: 3 });
    expect(deleteArc).toHaveBeenCalledWith('u1', 'n1', 3);
    expect(out).toMatchObject({ ok: true, order: 3 });
  });
});
```

- [ ] **Step 7: clear-master-outline.tool.ts + spec**

```ts
// clear-master-outline.tool.ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { MasterOutlineService } from '../../novel/master-outline.service';

/** outline-writer 的「清空总纲」工具。删整行;ACTIVE 返 warning(不拦)。 */
export function makeClearMasterOutlineTool({
  userId,
  novelId,
  masterOutlines,
}: {
  userId: string;
  novelId: string;
  masterOutlines: MasterOutlineService;
}) {
  return tool(
    async () => masterOutlines.clear(userId, novelId),
    {
      name: 'clear_master_outline',
      description:
        '删总纲整行(1:1 Novel)。ACTIVE 小说返 warning(总纲是北极星:writer 将失去战力/主线/三幕锚点),但不拦。仅在作者明确要求重建总纲时调用。重建走 set_master_outline。',
      schema: z.object({}),
    },
  );
}
```

```ts
// clear-master-outline.tool.spec.ts
import { makeClearMasterOutlineTool } from './clear-master-outline.tool';
import type { MasterOutlineService } from '../../novel/master-outline.service';

describe('clear_master_outline tool', () => {
  it('转发给 MasterOutlineService.clear', async () => {
    const clear = jest.fn().mockResolvedValue({ ok: true, warned: false });
    const masterOutlines = { clear } as unknown as MasterOutlineService;
    const t = makeClearMasterOutlineTool({ userId: 'u1', novelId: 'n1', masterOutlines });
    await t.invoke({});
    expect(clear).toHaveBeenCalledWith('u1', 'n1');
  });
});
```

- [ ] **Step 8: patch-chapter-plan.tool.ts + spec**

```ts
// patch-chapter-plan.tool.ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { OutlineService } from '../../novel/outline.service';

const nodeSchema = z.object({
  subject: z.string(),
  action: z.string(),
  target: z.string(),
});

/** outline-writer 的「字段级改细纲」工具。全 optional:只改传了的字段。 */
export function makePatchChapterPlanTool({
  userId,
  novelId,
  outlines,
}: {
  userId: string;
  novelId: string;
  outlines: OutlineService;
}) {
  return tool(
    async (input) => {
      const { chapterOrder, ...patch } = input;
      return outlines.patchChapterPlan(userId, novelId, chapterOrder, patch);
    },
    {
      name: 'patch_chapter_plan',
      description:
        '字段级改第 chapterOrder 章细纲(只传要改的字段,未传不动)。数组字段(cpns/mustCover/forbidden)整体替换。patch 不是 upsert:章不存在返 not_found(新建走 set_chapter_plan)。改字段优先用 patch(省 token、少出错)。',
      schema: z.object({
        chapterOrder: z.number().int().describe('章节序号(1-based,不可改)'),
        title: z.string().optional().describe('章标题'),
        cbn: nodeSchema.optional().describe('开篇节点(整体替换)'),
        cpns: z.array(nodeSchema).min(1).max(6).optional().describe('情节节点数组(整体替换)'),
        cen: nodeSchema.optional().describe('结尾节点(整体替换)'),
        mustCover: z.array(z.string()).optional().describe('必须覆盖点(整体替换)'),
        forbidden: z.array(z.string()).optional().describe('禁区(整体替换)'),
        volumeOrder: z.number().int().optional().describe('所属卷序号(移卷)'),
      }),
    },
  );
}
```

```ts
// patch-chapter-plan.tool.spec.ts
import { makePatchChapterPlanTool } from './patch-chapter-plan.tool';
import type { OutlineService } from '../../novel/outline.service';

describe('patch_chapter_plan tool', () => {
  it('剥出 chapterOrder,把剩余 patch 透传给 service', async () => {
    const patchChapterPlan = jest.fn().mockResolvedValue({
      ok: true, chapterOrder: 5, updatedFields: ['cen'],
    });
    const outlines = { patchChapterPlan } as unknown as OutlineService;
    const t = makePatchChapterPlanTool({ userId: 'u1', novelId: 'n1', outlines });
    const cen = { subject: '主角', action: '到达', target: '山门' };
    await t.invoke({ chapterOrder: 5, cen });
    expect(patchChapterPlan).toHaveBeenCalledWith('u1', 'n1', 5, { cen });
  });

  it('多字段同传', async () => {
    const patchChapterPlan = jest.fn().mockResolvedValue({
      ok: true, chapterOrder: 5, updatedFields: ['title', 'mustCover'],
    });
    const outlines = { patchChapterPlan } as unknown as OutlineService;
    const t = makePatchChapterPlanTool({ userId: 'u1', novelId: 'n1', outlines });
    await t.invoke({
      chapterOrder: 5,
      title: '新标题',
      mustCover: ['点A', '点B'],
    });
    expect(patchChapterPlan).toHaveBeenCalledWith('u1', 'n1', 5, {
      title: '新标题',
      mustCover: ['点A', '点B'],
    });
  });
});
```

- [ ] **Step 9: 跑全部新 spec + typecheck**

Run: `pnpm --dir server test -- delete- patch- clear-master && pnpm --dir server typecheck`
Expected: 全 PASS,无错

- [ ] **Step 10: 提交**

```bash
git add server/src/agentos/tools/delete-*.tool.ts server/src/agentos/tools/patch-*.tool.ts \
        server/src/agentos/tools/clear-master-outline.tool.ts \
        server/src/agentos/tools/delete-*.tool.spec.ts \
        server/src/agentos/tools/patch-*.tool.spec.ts \
        server/src/agentos/tools/clear-master-outline.tool.spec.ts
git commit -m "feat(tools): 5 个大纲细粒度编辑 tool(delete_*/patch_*/clear_master_outline)"
```

---

## Task 6: 注册 tool 到 TOOL_REGISTRY + 挂 outline-writer

**Files:**
- Modify: `server/src/agentos/agent-registry.ts`
- Modify: `server/src/agentos/agent-tree.config.ts`

- [ ] **Step 1: agent-registry.ts 加 5 个 import**

在 `import { makeSetMasterOutlineTool } from './tools/set-master-outline.tool';` 之后追加:

```ts
import { makeDeleteChapterPlanTool } from './tools/delete-chapter-plan.tool';
import { makeDeleteVolumeTool } from './tools/delete-volume.tool';
import { makeDeleteArcTool } from './tools/delete-arc.tool';
import { makeClearMasterOutlineTool } from './tools/clear-master-outline.tool';
import { makePatchChapterPlanTool } from './tools/patch-chapter-plan.tool';
```

- [ ] **Step 2: TOOL_REGISTRY 加 5 个条目**

在 `set_master_outline` 条目之后追加(保持大致聚类):

```ts
  delete_chapter_plan: (d) =>
    makeDeleteChapterPlanTool({
      userId: d.userId,
      novelId: d.novelId,
      outlines: d.outlines,
    }),
  delete_volume: (d) =>
    makeDeleteVolumeTool({
      userId: d.userId,
      novelId: d.novelId,
      outlines: d.outlines,
    }),
  delete_arc: (d) =>
    makeDeleteArcTool({
      userId: d.userId,
      novelId: d.novelId,
      arcs: d.arcs,
    }),
  clear_master_outline: (d) =>
    makeClearMasterOutlineTool({
      userId: d.userId,
      novelId: d.novelId,
      masterOutlines: d.masterOutlines,
    }),
  patch_chapter_plan: (d) =>
    makePatchChapterPlanTool({
      userId: d.userId,
      novelId: d.novelId,
      outlines: d.outlines,
    }),
```

- [ ] **Step 3: agent-tree.config.ts outline-writer 的 tools 数组追加 5 个 key**

在 outline-writer 节点的 `tools: [...]` 末尾(即 `'get_benchmark',` 之后)加:

```ts
            'delete_chapter_plan',
            'delete_volume',
            'delete_arc',
            'clear_master_outline',
            'patch_chapter_plan',
```

- [ ] **Step 4: typecheck + 跑 prompt spec(验证 PROMPTS key 集合未受影响)**

Run: `pnpm --dir server typecheck && pnpm --dir server test -- agent-prompts.spec.ts`
Expected: 无错,PASS

- [ ] **Step 5: 提交**

```bash
git add server/src/agentos/agent-registry.ts server/src/agentos/agent-tree.config.ts
git commit -m "feat(agent-tree): 5 个大纲编辑 tool 注册到 outline-writer"
```

---

## Task 7: 编辑 3 处 prompt(.md)

**Files:**
- Modify: `server/src/agentos/prompts/outline-writer.md`
- Modify: `server/src/agentos/prompts/outliner-orchestrator.md`
- Modify: `server/src/agentos/prompts/main.md`

**注意:** `agent-prompts.spec.ts` 锁了以下子串,改时不要破坏:
- OUTLINE_WRITER 必须含 `'立总纲(全书北极星'`(别动第二步标题)
- OUTLINER_ORCH 必须含 `'改写细纲(因正文偏离)'`(别动【任务类型】第三条原句)

- [ ] **Step 1: outline-writer.md — 在【铁律】段之前插入新段**

找到第 69 行 `【铁律】大纲只走 set_volume/set_chapter_plan;...`,在它**之前**插入:

```markdown
【删除/字段级改 — 用法纪律】

- **改字段优先 patch_chapter_plan,别重传整条 set_chapter_plan**:patch 只传要改的字段(省 token、少出错)。cbn/cen 整对象替换,cpns/mustCover/forbidden 整数组替换。
- **删已写章(WRITTEN)细纲前,必须先问作者确认**:delete_chapter_plan 对 WRITTEN 细纲只返 warning 不拦,但删了会失去 validator dim12「细纲兑现」的审计依据,不可逆。
- **删卷前先问作者**:只删卷本体(需先把下属弧/细纲移走或删掉)还是连下属一起删(传 cascade=true)?默认 cascade=false 时若卷下有内容会报 HAS_DESCENDANTS 清单。
- **批量删优先级**:删整卷用 delete_volume(cascade=true),别一条条 delete_arc + delete_chapter_plan(费事)。
- **clear_master_outline 是危险操作**:仅在作者明确要求「重建总纲」时调用;ACTIVE 阶段删了 writer 将失去战力/主线/三幕锚点。
- chapterOrder 不 renumber(永远):删了第 5 章细纲,第 6 章还是 6,留洞;洞可 set_chapter_plan(5,…) 补回。

```

- [ ] **Step 2: outliner-orchestrator.md — 【任务类型】加第 4 条**

找到第 13 行的「- 改写细纲(因正文偏离):...」末尾,在它**之后**加一条:

```markdown
- 删/改大纲节点:作者要删某卷/弧/细纲/总纲,或细纲字段级微调(CEN 写错了、mustCover 加一条)。委派 outline-writer 时明确指示:删什么、是否 cascade、改哪个字段。
```

- [ ] **Step 3: main.md — 委派协议补一句**

在 main.md 里找到 outliner 委派的描述(关键词「建大纲」/「补细纲」),在那段末尾加:「作者要删/改大纲节点 → 同样委派 outliner(它会用 delete_*/patch_* 工具)」。

(若 main.md 里委派协议位置不明确,用 Grep 找 `outliner` 关键词定位:`grep -n outliner server/src/agentos/prompts/main.md`。)

- [ ] **Step 4: 跑 prompt spec 验证 substring 锁仍 PASS**

Run: `pnpm --dir server test -- agent-prompts.spec.ts`
Expected: PASS(立总纲/改写细纲 substring 未破坏)

- [ ] **Step 5: 提交**

```bash
git add server/src/agentos/prompts/outline-writer.md \
        server/src/agentos/prompts/outliner-orchestrator.md \
        server/src/agentos/prompts/main.md
git commit -m "docs(prompts): outline-writer/orch/main 补大纲删除+patch 用法纪律"
```

---

## Task 8: L1 smoke 加 patch+delete 一轮

**Files:**
- Modify: `server/test/smoke/l1-integration.spec.ts`

- [ ] **Step 1: 在文件末尾(`}` 前)加新 test case**

```ts
  it('大纲细粒度:patch 部分字段 → delete → assertHasPlan 卡住写章', async () => {
    // 给 ch2 建细纲(原来没有)
    const outlines = new OutlineService(prisma, masterOutlines, arcs);
    const masterOutlines = new MasterOutlineService(prisma);
    const arcs = new ArcService(prisma);
    await outlines.upsertChapterPlan(userId, novelId, 2, {
      title: '第2章原计划',
      cbn: { subject: '主角', action: '到达', target: '山门' },
      cpns: [{ subject: '主角', action: '遇到', target: '对手' }],
      cen: { subject: '主角', action: '离开', target: '山门' },
    });
    // patch 只改 cen
    const r = await outlines.patchChapterPlan(userId, novelId, 2, {
      cen: { subject: '主角', action: '宿夜', target: '山门' },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.updatedFields).toEqual(['cen']);
    const plan = await prisma.chapterOutline.findFirst({
      where: { novelId, chapterOrder: 2 },
    });
    expect(plan?.title).toBe('第2章原计划'); // 未传字段零变更
    // delete 后写章卡住
    await outlines.deleteChapterPlan(userId, novelId, 2);
    const gate = await chapters.assertHasPlan(userId, novelId, 2);
    expect(gate.ok).toBe(false);
  });
```

- [ ] **Step 2: 在文件顶部 import 段补依赖**

若 `OutlineService` / `MasterOutlineService` / `ArcService` 尚未 import,加:

```ts
import { OutlineService } from '../../src/novel/outline.service';
import { MasterOutlineService } from '../../src/novel/master-outline.service';
import { ArcService } from '../../src/novel/arc.service';
```

注意 test case 内不要重复 `new`,应放 beforeAll 或 test 顶部统一构造(上面示例 inline 是为可读性,实际挪到 beforeAll 更干净——自行调整)。

- [ ] **Step 3: 跑 L1 smoke**

Run: `pnpm --dir server test -- l1-integration.spec.ts`
Expected: PASS(需 DB 起着)

若 DB 没起,跳过本地验证但 `pnpm --dir server typecheck` 必须过。

- [ ] **Step 4: 提交**

```bash
git add server/test/smoke/l1-integration.spec.ts
git commit -m "test(l1): 大纲 patch+delete 冒烟(部分字段改 + delete 卡关卡)"
```

---

## Task 9: 最终验收

- [ ] **Step 1: 跑全量 server 测试**

Run: `pnpm --dir server test`
Expected: 全 PASS(原有 61 套 + 新增 5 tool spec + 4 service spec case)

- [ ] **Step 2: typecheck**

Run: `pnpm --dir server typecheck`
Expected: 无错

- [ ] **Step 3: lint**

Run: `pnpm --dir server lint`
Expected: 无错

- [ ] **Step 4: 若 CI 有 lint,也跑一遍 agent-ui 的 typecheck(虽然没改它,保险)**

Run: `pnpm --dir agent-ui typecheck`
Expected: 无错

- [ ] **Step 5: 最终 commit(若有未提交的收尾)**

```bash
git status   # 确认 clean
git log --oneline -10   # 看这一串提交是否清晰
```

---

## Self-Review(写完 plan 后自查)

**Spec 覆盖:**
- 5 个 tool 全部有对应 task ✓(Task 1-4 service 层,Task 5 tool 层)
- 删卷可选 cascade ✓(Task 2)
- WRITTEN 软护栏 ✓(Task 1 service + Task 7 prompt)
- chapterOrder 不 renumber → Task 7 prompt 明确 ✓
- 工具挂 outline-writer → Task 6 ✓
- 零 DB 迁移 → 全程未提 migrate ✓
- FE 零改动 → 全程未碰 agent-ui ✓
- 3 处 prompt 改动 → Task 7 ✓
- L1 smoke → Task 8 ✓
- 单测 → Task 1-5 每个 task 含测试 ✓

**Placeholder 扫描:** 无 TBD/TODO;每个 step 有完整代码或精确命令。✓

**Type 一致性:**
- `ChapterPlanPatch` 在 Task 3 定义,Task 5 patch tool 的 zod schema 与之字段一致 ✓
- `OutlineService.deleteChapterPlan` 返回 `{ok, chapterOrder, warned, reason?}` 与 Task 5 delete-chapter-plan tool 转发签名一致 ✓
- `deleteVolume` 返回 union `{ok:true,...} | {ok:false,error:'HAS_DESCENDANTS',...} | {ok:false,reason:'not_found'}` 与 Task 5 delete-volume tool 透传一致 ✓
- `MasterOutlineService.clear` 返回 `{ok,warned,reason?} | {ok:false,reason:'not_found'}` 与 Task 5 clear tool 一致 ✓
- `ArcService.deleteArc` 返回 `{ok:true,order} | {ok:false,reason:'not_found'}` 与 Task 5 delete-arc tool 一致 ✓

**风险点提示:**
- Task 8 L1 smoke 需要 DB,若 CI/本地无 DB 则 typecheck-only,不影响 main push(遵循现有 L1 规范)
- Task 1-3 OutlineService spec 若原本不存在,新建时需要 mock 整个 PrismaService + MasterOutlineService + ArcService 构造函数(参考 `arc.service.spec.ts` 范式)
- Task 7 prompt 编辑不能破坏锁住的子串(`立总纲(全书北极星` / `改写细纲(因正文偏离)`)
