# 三幕式 + 单元循环 → 大纲生成 — 实现计划

> spec: [2026-06-30-three-act-unit-cycle-design.md](../specs/2026-06-30-three-act-unit-cycle-design.md)

**目标:** 总纲加 `threeAct`(三幕转折点,act2Turn=灵魂黑夜);outline-writer/outline-critic 提示词嵌入三幕+单元循环方法论;FE 总纲区显示三幕。

**关键约束:** 三幕与弧不同粒度——卷/弧结构不动,幕成员派生;不动 writer.md / chapter-orchestrator.md;不加 Arc.beats。

---

## Task 1: schema + migration

**Files:** Modify [server/prisma/schema.prisma](../../../server/prisma/schema.prisma) MasterOutline

- [ ] **Step 1: 加 threeAct 字段**

在 `volumeSplitLogic` 行后加:
```prisma
  threeAct   Json     @default("{}")  // 三幕转折点 {act1Turn,act2Turn,act3Turn},各 {atVolume,beat};act2Turn=灵魂黑夜
```

- [ ] **Step 2: 生成 migration**

Run: `pnpm --dir server prisma migrate dev --name add_master_outline_three_act`
Expected: 生成新 migration SQL,applied。

- [ ] **Step 3: 手动 prisma generate(Prisma 7 gotcha — migrate dev 不自动 regenerate)**

Run: `pnpm --dir server prisma generate`
Expected: client 含 threeAct 字段;`MasterOutline` 类型可用。

---

## Task 2: master-outline service

**Files:** Modify [server/src/novel/master-outline.service.ts](../../../server/src/novel/master-outline.service.ts)

- [ ] **Step 1: MasterOutlineInput 加 threeAct**

```ts
export interface MasterOutlineInput {
  theme?: string;
  mainLine?: string;
  ending?: string;
  powerProgression?: unknown;
  hiddenLines?: unknown;
  volumeSplitLogic?: string;
  threeAct?: unknown; // { act1Turn?, act2Turn?, act3Turn? },各 { atVolume, beat }
}
```

- [ ] **Step 2: upsert fields 加 threeAct**(与现有字段同语义——全替换)

在 `fields` 对象加:
```ts
      threeAct: (data.threeAct ?? {}) as unknown as Prisma.InputJsonValue,
```

---

## Task 3: set_master_outline tool

**Files:** Modify [server/src/agentos/tools/set-master-outline.tool.ts](../../../server/src/agentos/tools/set-master-outline.tool.ts)

- [ ] **Step 1: zod schema 加 threeAct**(在 volumeSplitLogic 后)

```ts
        threeAct: z
          .object({
            act1Turn: z
              .object({
                atVolume: z.number().describe('第一幕末落在第几卷'),
                beat: z.string().describe('第一幕末转折:主角下定决心,正式上路'),
              })
              .optional()
              .describe('建立→对抗 转折'),
            act2Turn: z
              .object({
                atVolume: z.number().describe('第二幕末落在第几卷'),
                beat: z.string().describe('第二幕末【灵魂黑夜】:跌入一无所有低谷(全书情绪最低点)'),
              })
              .optional()
              .describe('对抗→解决 转折(灵魂黑夜,必填)'),
            act3Turn: z
              .object({
                atVolume: z.number().describe('第三幕末落在第几卷'),
                beat: z.string().describe('第三幕末:最终决战,主角成为谁'),
              })
              .optional()
              .describe('解决 收束'),
          })
          .optional()
          .describe('三幕转折点(全书宏观骨架);三 atVolume 单调递增且在已规划卷范围'),
```

- [ ] **Step 2: tool description 末尾补一句**

`description` 字符串末尾追加:`/threeAct(三幕转折点 {act1Turn,act2Turn[灵魂黑夜],act3Turn},各{atVolume,beat})`。

---

## Task 4: master-slice

**Files:** Modify [server/src/agentos/master-slice.ts](../../../server/src/agentos/master-slice.ts)

- [ ] **Step 1: MasterOutlineLike 加 threeAct?**

```ts
  threeAct?: {
    act1Turn?: { atVolume: number; beat: string };
    act2Turn?: { atVolume: number; beat: string };
    act3Turn?: { atVolume: number; beat: string };
  };
```

- [ ] **Step 2: `has` 判定含 threeAct**

`has =` 末尾加 `|| (m.threeAct && Object.keys(m.threeAct).length)`。

- [ ] **Step 3: buildMasterOutlineSlice 在卷划分行后加三幕行**

```ts
  const ta = m.threeAct;
  if (ta && Object.keys(ta).length) {
    const turns = [
      ta.act1Turn && `一幕末(卷${ta.act1Turn.atVolume}):${ta.act1Turn.beat}`,
      ta.act2Turn && `二幕末·灵魂黑夜(卷${ta.act2Turn.atVolume}):${ta.act2Turn.beat}`,
      ta.act3Turn && `三幕末(卷${ta.act3Turn.atVolume}):${ta.act3Turn.beat}`,
    ].filter(Boolean);
    if (turns.length) lines.push('三幕:' + turns.join(' / '));
  }
```

---

## Task 5: outline-writer 提示词

**Files:** Modify [server/src/agentos/prompts/outline-writer.md](../../../server/src/agentos/prompts/outline-writer.md)(body,保留 frontmatter)

- [ ] **Step 1: 第二步「立总纲」加 threeAct**(在 volumeSplitLogic 项后,「总纲是全书最稳…」句前)

插入:
```md
- threeAct(三幕转折点,全书宏观骨架):
  · act1Turn(第一幕末·建立→对抗):主角【下定决心干什么】,激励事件收束、正式上路,挂 atVolume(第几卷)。
  · act2Turn(第二幕末·【灵魂黑夜】):主角【跌入一无所有低谷】——全书情绪最低点(盟友背叛/实力尽失/至亲危亡),挂 atVolume。【这是长篇情绪发动机,必填,不可省】。
  · act3Turn(第三幕末·解决):主角【最终成为谁】,挂 atVolume。
  · 三个 atVolume 单调递增(act1<act2<act3),且落在已规划卷范围内。
```

- [ ] **Step 2: 第四步「分弧」加单元循环 + 幕节奏**(在现有弧字段说明后)

插入:
```md
- 每弧按【单元循环 5 拍】设计:遇到麻烦(弧 goal=本弧的麻烦/目标)→ 尝试 → 出现意外 → 解决 → 成长,分布在该弧 fromChapter..toChapter 的章节里。
- 弧 goal 里【带幕节奏】:本弧在第几幕(从 threeAct 边界 + 本弧所属卷派生)→ 一幕短快代入 / 二幕升级+埋长线 / 三幕加速收束。writer 会经 get_arcs 读到这条,据此校准节奏。
```

- [ ] **Step 3: 第五步「建细纲」加 5 拍对齐**(在现有 CBN/CPNs/CEN 说明后)

插入:
```md
- 章即【微循环】,CBN/CPNs/CEN 对齐 5 拍:CBN(开篇)=遇到麻烦;CPNs(情节)=尝试+出现意外;CEN(结尾)=部分解决 + 章末钩子(=「意外」延续,拉下一章)。「成长」是弧级累积,不必每章强行收束。
```

---

## Task 6: outline-critic 提示词

**Files:** Modify [server/src/agentos/prompts/outline-critic.md](../../../server/src/agentos/prompts/outline-critic.md)

- [ ] **Step 1: 总纲自检段扩 threeAct**(在「总纲自检(建纲任务)」块内,现有 hiddenLines 句后加)

```md
- 三幕 threeAct 三槽齐不齐?尤其 **act2Turn 灵魂黑夜有没有**?三个 atVolume 单调递增、落在已规划卷范围?act2Turn 挂的那卷其卷纲/章节真承载了低谷 beat 吗(一致性,非结构冲突)?缺/矛盾 → blockingIssues 点名。
```

- [ ] **Step 2: 新增弧循环完整性检查**(并入维度 6「伏笔布局·衔接一致性」末尾,或维度 5 末尾)

```md
- 弧的【单元循环】完整性:每弧是否构成完整 5 拍(麻烦→尝试→意外→解决→成长)?断环(只有麻烦没解决 / 无意外=平)→ note(严重断环 blocking)。
```

---

## Task 7: FE type + 总纲区

**Files:** Modify [agent-ui/src/types/novel.ts](../../../agent-ui/src/types/novel.ts) + [agent-ui/src/components/workspace/ResourcePanel.tsx](../../../agent-ui/src/components/workspace/ResourcePanel.tsx)

- [ ] **Step 1: MasterOutline type 加 threeAct**

```ts
export interface MasterOutline {
  theme: string
  mainLine: string
  ending: string
  powerProgression: { volume: number; level: string; note?: string }[]
  hiddenLines: { name: string; type?: string; plant?: string; advance?: string[]; reveal?: string }[]
  volumeSplitLogic: string
  threeAct?: {
    act1Turn?: { atVolume: number; beat: string }
    act2Turn?: { atVolume: number; beat: string }
    act3Turn?: { atVolume: number; beat: string }
  }
}
```

- [ ] **Step 2: 总纲区加三幕显示**(ResourcePanel.tsx ~L582 hiddenLines 块后)

仿现有 powerProgression/hiddenLines 的 `{data.master.X?.length > 0 && (...)}` 模式,加:
```tsx
{data.master.threeAct &&
  (data.master.threeAct.act1Turn ||
    data.master.threeAct.act2Turn ||
    data.master.threeAct.act3Turn) && (
    <div>
      <span className="...label">三幕</span>
      {[
        data.master.threeAct.act1Turn && `一幕末(卷${data.master.threeAct.act1Turn.atVolume}):${data.master.threeAct.act1Turn.beat}`,
        data.master.threeAct.act2Turn && `二幕末·灵魂黑夜(卷${data.master.threeAct.act2Turn.atVolume}):${data.master.threeAct.act2Turn.beat}`,
        data.master.threeAct.act3Turn && `三幕末(卷${data.master.threeAct.act3Turn.atVolume}):${data.master.threeAct.act3Turn.beat}`,
      ].filter(Boolean).map((t, i) => (
        <span key={i} className="...item">{t}</span>
      ))}
    </div>
  )}
```
(实现时对齐该文件现有 className;act2Turn 视觉上可标红/重点,表示灵魂黑夜。)

---

## Task 8: 测试

**Files:** Modify [master-outline.service.spec.ts](../../../server/src/novel/master-outline.service.spec.ts) + [master-slice.spec.ts](../../../server/src/agentos/master-slice.spec.ts)

- [ ] **Step 1: master-outline.service.spec 加 threeAct 用例**

upsert 带 threeAct:{ act2Turn: { atVolume: 5, beat: '低谷' } } → get 回的字段含 threeAct 且相等。

- [ ] **Step 2: master-slice.spec 加 threeAct 格式化用例**

- 有 threeAct(含 act2Turn)→ slice 含「三幕:」+「灵魂黑夜」。
- threeAct 空 {} → 不含「三幕:」行(不影响其他字段输出 + 不破坏「全空→''」)。

- [ ] **Step 3: 全量验证**

Run: `pnpm --dir server test && pnpm --dir server typecheck && pnpm --dir server build`
Expected: 全绿;`agent-prompts.spec.ts` 锁的 outline-writer「立总纲(全书北极星」+ outline-critic「report_outline_review」仍命中(提示词增量编辑未删)。`agent-ui typecheck` 干净。

---

## Task 9: 提交 + CLAUDE.md

- [ ] **Step 1: 提交**

```
feat(outline): 三幕式 + 单元循环 → 大纲生成

总纲加 threeAct(三幕转折点,act2Turn=灵魂黑夜一等公民);outline-writer
按三幕立总纲 + 弧按单元循环 5 拍 + 章细纲 CBN/CPNs/CEN 对齐 5 拍 + 弧 goal
带幕节奏(writer 经 get_arcs 读到);outline-critic 加审(三幕齐/弧循环完整)。
三幕与弧不同粒度不冲突——卷/弧结构不动,幕成员从 threeAct 派生。FE 总纲区
显示三幕。一条 DB 迁移(手动 prisma generate)。
```

- [ ] **Step 2: CLAUDE.md 记 Phase 20**(三幕+单元循环;MasterOutline.threeAct)
