# writer 章节接缝连续性设计

> 日期:2026-06-27 · Phase 8 · 关联 [2026-06-27-character-consistency-validator-design.md](./2026-06-27-character-consistency-validator-design.md)

## 问题诊断

writer 早就能读任意章(`get_chapter(chapterOrder)` 返回全文),但**从没被教导为了连续性去读相邻章**:

1. WRITER prompt(line 14/22/57)只说「改/续写前先 `get_chapter(N)` 看本章现状」,从没说写新章先读 N-1、改既有章先读 N+1。
2. CHAPTER_ORCH 委派 writer 时(line 128-132)只点名 `get_chapter_plan(N)` / 伏笔 / 字数目标,**不提相邻章**。
3. 净效果:写第 N 章时 writer 看不到第 N-1 章结尾的现场(地点/在场/情境/情绪);改第 N 章时看不到第 N+1 章开头。**章与章的接缝是最容易穿帮的断层**——人物瞬移、状态重置、场景断裂。这正是「长篇丢设定」的高发点,角色档案救不了你,因为问题不是「沈砚是谁」,是「沈砚此刻在哪、上一章发生了什么」。

Phase 7 给 validator 补了 **reactive** 审计(写完抓);本 Phase 给 writer 补 **proactive** 接缝意识——写之前先把相邻章喂给它。

## 目标

让 writer 在写/改第 N 章前**主动读相邻章全文**:写新章读 N-1(接结尾);改/续/重写既有章再加读 N+1(保过渡)。**纯 prompt 改动,零 DB / 零新工具 / 零 settler / 零 FE**——复用现有 `get_chapter`。

## 设计

### 统一规则(无需单独传「写/改」模式)

writer 写第 N 章前先读 N-1;**若第 N 章已有正文**(=改/续/重写,非新写)再加读 N+1。有没有内容 writer 本来就要先 `get_chapter(N)` 看,顺带判出模式。不存在则跳过(第 1 章无 N-1;改末章无 N+1)。

这样不用给委派链加显式「写/改」模式参数——用「第 N 章是否有正文」隐式判定。

### 改动一:WRITER_AGENT_PROMPT 加【连续】节

在 WRITER prompt 加一节(置于【细纲 — 写前必读】之后,属「写前必做」簇):

```
【连续 — 章节接缝不穿帮】
- 写/改/续/重写第 N 章前,先读相邻章接缝:
  · 先 get_chapter(N-1) 读上一章【全文,重点结尾】——接住它的地点、在场人、悬而未决的情境、人物情绪;不要人物瞬移、状态重置、场景断裂。(第 1 章无上一章,跳过。)
  · 若第 N 章已有正文(=改/续/重写,不是新写),再 get_chapter(N+1)(若存在)读下一章开头——确保你改完的第 N 章仍能平滑过渡到下一章,接缝不留矛盾。
```

### 改动二:CHAPTER_ORCHESTRATOR_PROMPT 委派指令加一条

CHAPTER_ORCH 委派 writer 的指令清单(现 line 128-132)加:

```
   - 先 get_chapter(N-1) 读上一章(尤其结尾)接缝;若第 N 章已有正文(改/续/重写),再 get_chapter(N+1)(若存在)读下一章开头——确保两头接得上,不穿帮。
```

两处同款规则(orchestrator 委派时强化为一步;writer 自己 prompt 里也写明,即使被直接调用也照做)。

### 持久化状态(确认无需改动)

角色当前态(`get_character` 的 `currentState`)Phase 6 已接,WRITER prompt line 70-72 已教导「写涉及角色先 get_character 查当前态」。**无需改动**——读到上一章全文后,「章末在哪/谁在场/手里什么」从正文直接可见,故不另建结构化场景态(用户本期确认:角色当前态即可)。

## 改动面

| 文件 | 改动 |
|---|---|
| [server/src/agentos/agent-prompts.ts](../../../server/src/agentos/agent-prompts.ts) | `WRITER_AGENT_PROMPT` 加【连续】节 + `CHAPTER_ORCHESTRATOR_PROMPT` 委派指令加相邻章读取一条 |

**不碰**:DB、FE、新工具、settler、ContextAssembler、CharacterService、AGENT_TREE 结构、其它 agent。

## 显式不做(non-goals)

- **不新增结构化「章末场景态」快照。** 读相邻章全文已覆盖即时接缝的「在哪/谁在场/情境」;远端连续性(超出相邻章)由【前情】摘要 + 角色态承担。用户本期确认只要角色当前态。
- **不改 get_chapter 工具。** 返回全文即所需;不做裁剪/分页(长章 token 成本有界,仅相邻)。
- **不传显式「写/改」模式信号。** 用「第 N 章是否有正文」隐式判定,避免给委派链加新模式参数。
- **不强化 settler 提取。** settler 照常记 CharacterChange/伏笔;连续性靠 writer 读相邻章,不靠 settler 多提字段。
- **不做硬注入(orchestrator 预读塞进委派消息)。** 沿用 prompt 指令拉取(与 writer 现有 get_chapter_plan 同款,可靠性够);省 orchestrator 工具 + 避免每章固定 token 成本。

## 测试

1. **无 prompt 文本断言**(项目惯例:prompt 文本不稳,快照易碎)。agent-tree.config.spec.ts 的防回归快照只断言树结构(名/工具/tier),不含 prompt 文本;PROMPTS 仅查 key 存在(非内容)。改 prompt 文本不破任何测试。
2. **回归**:全量 `pnpm test`(server 单元套)不回归;`pnpm typecheck` 通过。
3. 活 E2E(配模型 + DB,写一章看 writer 是否真读了上一章)本期不强制。

## 验证未覆盖

- 单测只能确认「prompt 文本写到位、测试不回归」。**实际 writer 是否真按指令读了相邻章、接缝是否真不穿帮**取决于模型——需活 E2E。本期不强制;用户需要时可起 `pnpm dev` 实测。
