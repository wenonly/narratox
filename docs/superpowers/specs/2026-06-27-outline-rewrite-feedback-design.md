# 大纲改写回馈设计(Phase 10)

> 日期:2026-06-27 · Phase 10 · 关联 [2026-06-27-validator-outline-fulfillment-design.md](./2026-06-27-validator-outline-fulfillment-design.md)(#1 触发点)· 为 [writer-chapter-continuity](./2026-06-27-writer-chapter-continuity-design.md) 审视的「大纲冻结」收尾

## 问题诊断

Phase 9 让 validator 能检测「正文偏离细纲」并标「细纲过时」note,但**这个 note 现在是死信号**——没有任何 agent 接它:

1. CHAPTER_ORCH 跑完 writer→settler→validator 后,结论只回「score N / 已修订」,**不带「细纲过时」信号**给主 agent。
2. MAIN 写作阶段只委派 chapter 写章,**不识别「需改写细纲」**,不会委派 outliner。
3. outliner 只有「建纲 / 补细纲」两种任务类型,**没有「改写(因正文偏离)」模式**;且 outline-writer 有 `get_chapter_plan`(读旧细纲)但**没 `get_chapter`(读实际正文)**——无法「接受已写为实、改大纲去就实」。

净效果:大纲依然冻结——validator 发现写偏了,信号却无人接,大纲不会更新。本 Phase 接通这条回馈链。

## 目标

接通「正文偏离 → 大纲改写」回馈闭环,**accept-written-as-truth**(已写章节是 ground truth,改细纲去就实,不重写已写章节):

validator「细纲过时」note → CHAPTER_ORCH 结论明确带回 → main 委派 **outliner 改写**(走改写路线,outliner 编排)→ outline-writer 读实际正文 + 旧细纲,改 set_chapter_plan 到与实际一致 + 核查下游衔接 → 改后细纲治未来章。

## 设计

### 信号链(全 prompt-driven,沿用既有 task 委派)

```
validator dim 12「细纲过时」note
  → CHAPTER_ORCH 结论带回「第 N 章偏离细纲:实际 X / 原 Y / 建议改写细纲」
    → MAIN 识别 → task 委派 outliner「改写第 N 章(及下游)细纲,实际走向 X」
      → OUTLINER_ORCH 跑「改写细纲」流程(改写模式)
        → outline-writer:get_chapter_plan(N) 读旧细纲 + get_chapter(N) 读实际正文 → set_chapter_plan(N) 改到与实际一致 + 核查下游 → outline-critic 复评
```

### 改动一:outline-writer += get_chapter(唯一工具补丁)

[agent-tree.config.ts](../../../server/src/agentos/agent-tree.config.ts) 的 outline-writer spec,tools 加 `get_chapter`。

理由:revise 模式要「接受已写为实」——必须能读实际正文(`get_chapter(N)`),不能只靠 validator 描述(经 4 跳中继易失真)。BUILD 模式下章节未写,`get_chapter` 返回 not_found,无害(prompt 不在建纲模式调它)。

### 改动二:CHAPTER_ORCH 结论带回信号

[CHAPTER_ORCHESTRATOR_PROMPT](../../../server/src/agentos/agent-prompts.ts) 加【细纲过时信号】:validator 若在 dim 12 标了「细纲过时」note,结论里【必须明确带回】「第 N 章偏离细纲——实际走向 X,原细纲 Y,【建议改写细纲】」。强调:这是 note 不是 blocking,不阻断本章(已写为实),只触发大纲改写。

### 改动三:MAIN 识别并委派 outliner 改写

[MAIN_AGENT_PROMPT](../../../server/src/agentos/agent-prompts.ts) 写作阶段加:若 chapter agent 结论带回「细纲过时,建议改写细纲」,用 task 委派 outliner「改写第 N 章(及紧邻下游)细纲——实际走向 X,把第 N 章细纲改到与实际一致,并核查下游 N+1.. 是否仍衔接」。改完再续写。**已写的第 N 章不重写**(已写为实)。

### 改动四:OUTLINER_ORCH 加「改写细纲」任务类型

[OUTLINER_ORCHESTRATOR_PROMPT](../../../server/src/agentos/agent-prompts.ts) 的【任务类型】加第三种「改写细纲(因正文偏离)」:指定章正文已偏离,改细纲去就实——把第 N 章细纲改到与实际正文一致 + 核查下游。委派 outline-writer 时传实际走向 + 偏离原因,让它先 get_chapter_plan(N) 看旧细纲、get_chapter(N) 看实际正文,再 set_chapter_plan 改写;之后 outline-critic 复评(沿用既有修订闭环)。

### 改动五:OUTLINE_WRITER 加「改写模式」

[OUTLINE_WRITER_PROMPT](../../../server/src/agentos/agent-prompts.ts) 加【改写模式 — 因正文偏离(accept written as truth)】:先 get_chapter_plan(N) 读旧细纲 + get_chapter(N) 读实际正文(【正文是实】,细纲去就它);把 CBN/CPNs/CEN/mustCover/forbidden 改到与实际一致(set_chapter_plan upsert);再 get_chapter_plan(N+1..) 核查下游,依赖旧走向已断层的承接改写,仍衔接的别动;**不重写正文**。

## 改动面

| 文件 | 改动 |
|---|---|
| [server/src/agentos/agent-tree.config.ts](../../../server/src/agentos/agent-tree.config.ts) | outline-writer.tools += `get_chapter` |
| [server/src/agentos/agent-prompts.ts](../../../server/src/agentos/agent-prompts.ts) | CHAPTER_ORCH(结论带回信号)+ MAIN(委派改写)+ OUTLINER_ORCH(改写任务类型)+ OUTLINE_WRITER(改写模式) |
| [server/src/agentos/agent-tree.config.spec.ts](../../../server/src/agentos/agent-tree.config.spec.ts) | outline-writer 快照加 `get_chapter` + 正向断言 |

**不碰**:DB、FE、新 agent、新工具(get_chapter 复用既有)、settler、validator、其它 agent。

## 显式不做(non-goals)

- **不重写已写章节。** accept-written-as-truth:已写第 N 章是实,只改细纲去就实;重写正文是另一回事(由作者显式要求「重写」走 clear_chapter 路径,不在本回馈链)。
- **不做硬触发(结构化字段)。** 信号走自然语言委派链(validator note → 结论 → 委派),与全系统 prompt-driven 委派惯例一致;不为它加结构化字段(report_review 的消费方是 LLM,结构化字段无增益)。
- **不改 validator。** Phase 9 已产出「细纲过时」note,本 Phase 只接信号,不动检测。
- **不自动重评已写章节。** 改完细纲后不回头重 validator 第 N 章(它已写为实);只让未来章按新细纲写。
- **不限定改写下游范围。** 下游改几章由 outline-writer 据衔接判断(N+1.. 视断层而定),不硬编码。

## 测试

1. **agent-tree.config.spec.ts**:outline-writer 快照加 `get_chapter` + 新增正向断言「outline-writer 含 get_chapter」(改写模式的数据源)。
2. **agent-prompts.ts**:4 处 prompt 改动无文本断言(惯例);自由改。
3. **回归**:全量 `pnpm test` 不回归;`pnpm typecheck` 过。

> 信号链本身(prompt-driven 4 跳)无单测——其正确性依赖模型,只能活 E2E 验证。唯一结构改动(outline-writer 工具)有快照+断言锚定。

## 验证未覆盖

- 单测只锚定「outline-writer 拿到 get_chapter + 4 处 prompt 写到位」。**整条回馈链是否真跑通**(validator 真标 → CHAPTER_ORCH 真带回 → main 真委派 → outliner 真改写)依赖模型,需活 E2E:写一章故意偏离细纲,看 validator 是否报细纲过时、outliner 是否被触发并改了 set_chapter_plan。本期不强制。
