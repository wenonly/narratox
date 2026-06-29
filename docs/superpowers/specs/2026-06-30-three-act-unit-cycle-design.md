# 三幕式 + 单元循环 → 大纲生成 — 设计

## 目标

把「三幕式(宏观节奏)+ 单元循环(微观填充)」这套网文长篇结构方法论,落到大纲生成 agent(outliner 编排器 / outline-writer / outline-critic),让生成的总纲—弧—细纲自带这套骨架,而不是只靠 vague 的「起承转合关键节点」。

方法论来源(作者提供):
- **三幕式**:建立(激励事件逼上路)→ 对抗(打怪受挫成长,中段转折,结尾**灵魂黑夜/一无所有低谷**)→ 解决(最终决战引爆情绪)。
- **单元循环**(5 拍,重复的最小故事单元):遇到麻烦 → 尝试解决 → 出现意外 → 最终解决 → 获得成长。每循环一次「期待-释放」小过山车。
- **组合**:三幕是大梁(定 3 个里程碑:第一幕末决心 / 第二幕末低谷 / 第三幕末身份);各幕填单元循环,节奏随幕校准(一幕短快 / 二幕升级+埋长线 / 三幕加速);循环积累触发转幕。

## 核心:三幕 ≠ 弧,不冲突(层级不同)

```
三幕 Act(宏观相位,3 个,跨卷)        ← 建立/对抗/解决;挂在【总纲】
  └─ 卷 Volume(全书 3-6)             ← 归属某一幕(从三幕边界派生,不另存)
       └─ 弧 Arc(每卷 2-4,卷内循环)   ← 弧 = 单元循环,原样不动
            └─ 章细纲(CBN/CPNs/CEN)   ← 微循环
```

三幕在最上层(跨卷的宏观情绪相位,就 3 段),弧在卷下层(卷内循环,十几个)。**不同粒度,不竞争同一条轴。** 设计上进一步消冲突:**三幕不做成并列段系统,只给【总纲】加一个 `threeAct` 字段(3 个转折点),卷/弧结构完全不动,某卷属第几幕 = 从 threeAct 边界派生。**

## 唯一 schema 改动:MasterOutline.threeAct

```
threeAct Json @default("{}")   // 三幕转折点(全书宏观骨架)
```

结构(object,3 个命名槽,各可选——书可能还没规划全):
```ts
threeAct: {
  act1Turn?: { atVolume: number; beat: string };  // 建立→对抗:主角下定决心(激励事件收束,正式上路)
  act2Turn?: { atVolume: number; beat: string };  // 灵魂黑夜:跌入一无所有低谷(全书情绪最低点)
  act3Turn?: { atVolume: number; beat: string };  // 解决:最终决战,主角成为谁
}
```
- `atVolume`:该转折在【第几卷】 culminate(挂到卷粒度,与现有卷结构对齐;不细化到章,避免过度精确)。
- `beat`:这个转折发生什么(一句话)。
- **`act2Turn` = 灵魂黑夜一等公民**——这是网文最易漏、最关键的宏观情绪锚点,单独成槽强制规划。
- act 成员派生:volumes ≤ act1Turn.atVolume = 第一幕;act1Turn < v ≤ act2Turn = 第二幕;余 = 第三幕。**不存第二个结构**,无冗余、无冲突。

## 改动清单

| 层 | 文件 | 改动 |
|---|---|---|
| schema | [schema.prisma](../../../server/prisma/schema.prisma) MasterOutline | + `threeAct Json @default("{}")`;一条 migration |
| service | [master-outline.service.ts](../../../server/src/novel/master-outline.service.ts) | `MasterOutlineInput` +threeAct;upsert 读写 |
| tool | [set-master-outline.tool.ts](../../../server/src/agentos/tools/set-master-outline.tool.ts) | zod schema +threeAct(act1/2/3Turn,{atVolume,beat}) |
| slice | [master-slice.ts](../../../server/src/agentos/master-slice.ts) | `MasterOutlineLike` +threeAct;`buildMasterOutlineSlice` 格式化(有三幕则加「三幕:一幕末…/二幕末[灵魂黑夜]…/三幕末…」行) |
| FE type | [types/novel.ts](../../../agent-ui/src/types/novel.ts) MasterOutline | + threeAct |
| FE 视图 | [ResourcePanel.tsx](../../../agent-ui/src/components/workspace/ResourcePanel.tsx) 总纲区(~L568) | 三幕转折点显示(act2Turn 标「灵魂黑夜」) |
| prompt | [prompts/outline-writer.md](../../../server/src/agentos/prompts/outline-writer.md) | 立总纲加 threeAct;分弧按 5 拍;建细纲 CBN/CPNs/CEN 对齐 5 拍;弧 goal 带幕节奏 |
| prompt | [prompts/outline-critic.md](../../../server/src/agentos/prompts/outline-critic.md) | 加审维度:三幕三问齐(尤其低谷)+ 弧循环完整 + 节奏匹配幕 + threeAct↔卷一致 |
| test | master-outline.service.spec / master-slice.spec | threeAct upsert/get + slice 格式化 |

`get_outline.tool.ts` / `listOutline` 已返回整个 master 对象,threeAct 作为 Json 字段自动随带,无需改。

## outline-writer 提示词增量(在现有 5 步里嵌入,不重写)

立总纲步(第二步)增:
- 除现有 theme/mainLine/ending/powerProgression/hiddenLines/volumeSplitLogic 外,**必填 `threeAct` 三幕转折点**:
  - act1Turn:第一幕末主角【下定决心干什么】(激励事件收束,正式上路),挂 atVolume。
  - act2Turn:【灵魂黑夜——跌入一无所有低谷】(全书情绪最低点;盟友背叛/实力尽失/至亲危亡之类),挂 atVolume。这是长篇情绪发动机,不可省。
  - act3Turn:第三幕末主角【最终成为谁】,挂 atVolume。
  - 三幕 atVolume 必须在已规划卷范围内,且单调递增(act1 < act2 < act3)。

分弧步(第四步)增——**弧 = 单元循环**:
- 每弧按 5 拍设计:遇到麻烦(弧 goal = 本弧的麻烦/目标)→ 尝试 → 出现意外 → 解决 → 成长,分布在该弧 fromChapter..toChapter 的章节里。
- 弧 `goal` 里【带幕节奏提示】:本弧在第几幕(从 threeAct + 本弧所属卷派生)→ 一幕短快代入 / 二幕升级+埋长线 / 三幕加速收束。

建细纲步(第五步)增——**章 = 微循环**:
- CBN(开篇)= 遇到麻烦;CPNs(情节)= 尝试 + 出现意外;CEN(结尾)= 解决(部分)+ 章末钩子 = 「意外」的延续(拉下一章)。
- 「成长」是弧级累积,不必每章强行收束。

## outline-critic 增审维度(并入现有 6 维 + 总纲自检)

总纲自检扩:threeAct 三槽齐不齐?尤其 **act2Turn 灵魂黑夜有没有**?三幕 atVolume 单调递增、且落在已规划卷范围?act2Turn 挂的那卷,其章节/卷纲真的承载了低谷 beat 吗(一致性,非结构冲突)?

新增维度(并入维度 5「情节引擎·爽点」或单列):**弧的单元循环完整性**——每弧是否构成完整 5 拍(麻烦→尝试→意外→解决→成长),还是断环(只有麻烦没解决 / 没意外 = 平)。断环 → blocking 或 note(视严重度)。

## 幕节奏如何到 writer(无需运行时接线)

writer step 0 已 `get_arcs` 读当前弧。outline-writer 把幕节奏写进**弧 goal**(「本弧在第二幕,节奏升级,难度逐章上升,埋长线」),writer 经 get_arcs 自然看到,据此校准本章节奏。**不改 chapter/main 编排器、不加运行时派生**——节奏信息搭便车现有弧 goal → get_arcs 通道。

## 测试

1. `master-outline.service.spec.ts`:upsert 带 threeAct → get 回含 threeAct;多租户隔离仍成立。
2. `master-slice.spec.ts`:有三幕 → slice 含「三幕」行 + act2Turn 含「灵魂黑夜」;空 threeAct → 不加该行(不影响现有「全空→''」)。
3. 现有 `agent-prompts.spec.ts` 锁的 outline-writer/outline-critic 特征子串(「立总纲(全书北极星」「report_outline_review」)必须仍在——提示词是增量编辑,不删这两句。
4. `pnpm test` 全绿;`typecheck` 干净;`build` 过(migration 后 `prisma generate`)。

## 不在本期范围

- **不改 KB 文件**(方法论直接进 outline-writer 提示词,强制可靠;KB 多在仓外,且 agent 拉 KB 是可选深度,不作 mandate)。
- **不加 Arc.beats 字段**(弧 goal + 章 CBN/CPNs/CEN 已承载 5 拍,加 beats 是过度工程)。
- **不加运行时「当前第几幕」派生/态势面板显示幕**(threeAct 已存,派生是未来增强;本期靠弧 goal 携带幕节奏到 writer)。
- **不动 writer.md / chapter-orchestrator.md**(幕节奏经弧 goal 间接传达,不改 writer 提示词;若后续要 writer 显式感知幕,再开一期)。
