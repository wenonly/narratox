# 角色一致性校验(validator dim 1)设计

> 日期:2026-06-27 · Phase 7 · 关联 [2026-06-27-character-context-and-panel-design.md](./2026-06-27-character-context-and-panel-design.md)

## 问题诊断

Phase 6 让角色对 **writer** 可见了(每轮被动注入【角色档案】slice + writer 自带 `get_character`/`get_characters`)。但负责「抓设定漂移」的 **validator** 是瞎的:

1. **validator 没有角色工具。** [agent-tree.config.ts](../../../server/src/agentos/agent-tree.config.ts) 里 validator 的工具是 `['get_chapter', 'query_memory', 'report_review']`——全家(writer / char-critic)都有 `get_character`/`get_characters`,唯独 validator 没有。它只能靠 `query_memory`(章节摘要这种二手信息)判断人物一致。
2. **角色 slice 不进子 agent。** Phase 6 注入的【角色档案 · 活跃】+【角色名册 · 沉默】slice 只拼进主 agent 的 prompt([deep-agent.service.ts](../../../server/src/agentos/deep-agent.service.ts) 的 `resolvePrompt` 只给 writer/validator 拼 refs/voice slice)。validator 连被动注入那份也看不到。
3. **dim 1 是空话。** validator 本有一维「人物一致——名字/性格/关系不与已有矛盾」([agent-prompts.ts](../../../server/src/agentos/agent-prompts.ts) VALIDATOR dim 1),但没有权威数据源,等于空跑。

净效果:**注入 → 写 →【瞎审】→ 修订**,闭环开着。这正是「长篇丢设定」抓不住的根因——写手飘了,审计员却查无实据。

## 目标

让写完一章后的角色一致性校验**对照权威档案实打实地跑**:给 validator 角色工具,把 dim 1 加深成结构化子检,复用现有 `report_review` + 修订闭环。**不引入新 agent、不动 DB、不动 FE。**

## 设计

### 改动一:给 validator 角色工具

[agent-tree.config.ts](../../../server/src/agentos/agent-tree.config.ts) 的 validator spec,tools 从

```
['get_chapter', 'query_memory', 'report_review']
```

改为

```
['get_chapter', 'get_character', 'get_characters', 'query_memory', 'report_review']
```

(顺序:读正文 → 查角色 → 查记忆 → 出报告。与 writer/char-critic 的角色工具对齐。)

> 不注入角色 slice 到 validator:validator 审的是**特定一章**,它读正文后能确定性枚举出场角色、逐一 `get_character(name)` 拉档案——比被动注入(按「当前章活跃窗口」算,未必匹配刚写的这章卡司)更准,也更省上下文。这是审计场景,按需拉取比 writer 的「怕忘」更合适。

### 改动二:加深 dim 1「人物一致」

把 dim 1 从一行扩成 **5 个结构化子检**。validator 读本章正文后,先 `get_characters` 列全部角色,再对每个出场角色 `get_character(name)` 取 profile + currentState,逐项查:

| 子检 | 数据源 | 判定 |
|---|---|---|
| **出场核对** | `get_characters` 全量 | 正文出现但档案里没有的角色 → **note**(可能笔误,或新角色 writer 未登记→提示 settler/character agent 补) |
| **性格 OOC** | profile `personality` + `currentState.personality` | 核心性格硬反转且本章无催化剂 → **blocking** |
| **能力越级** | profile + `currentState.ability` | 用了未建立的能力且无解释 → **blocking** |
| **语言风格** | `voice` | 对白漂离基线 → **note**(严重且持续才升 blocking) |
| **弧光矛盾** | `arcGoal` | 行为颠覆弧光方向且无铺垫 → **blocking** |

**blocking / notes 划分**(沿用现有 report_review 约定):blocking = 「会让读者出戏/设定崩」的硬伤(OOC、能力越级、弧光矛盾),进 `blockingIssues` 驱动修订闭环;voice 漂移、新角色登记提醒等放 notes,不阻断。

> **与 dim 3(战力·力量体系)的边界**:dim 3 管**世界力量体系**的越级(对齐 powerSystem / rule,「这个境界能不能打赢那个」);dim 1 的能力越级管**这个具体角色**有没有被建立到这个程度(「沈砚还没学过这一招」)。互补,不重复。prompt 里点明分工,避免双重计分。

### validator 如何拿到章号 N

validator 已经在读「本章」(它 `get_chapter(N)` 取正文),N 来自 chapter 编排器的委派消息(现有流程如此,本次不改)。子检里只需 `get_character(name)` 取**当前态**(最新派生)——**不**涉及「第 N-1 章时的状态」(见下方「显式不做」)。

## 改动面

| 文件 | 改动 |
|---|---|
| [server/src/agentos/agent-tree.config.ts](../../../server/src/agentos/agent-tree.config.ts) | validator.tools += `get_character`, `get_characters` |
| [server/src/agentos/agent-prompts.ts](../../../server/src/agentos/agent-prompts.ts) | VALIDATOR dim 1 重写为 5 子检 + 调用指引(先 get_characters 列全,再逐角色 get_character 详查) |
| [server/src/agentos/agent-tree.config.spec.ts](../../../server/src/agentos/agent-tree.config.spec.ts) | 第 154 行防回归快照:validator tools 加两项;另加一条正向断言(validator 必含 get_character/get_characters) |

**不碰**:DB(零迁移)、FE(评审报告已渲染)、CharacterService、get_character 工具本身、不新增 agent、不新增 report 工具。

## 显式不做(non-goals)

- **可变态连续性校验(`asOfChapter`)——本期不做。** 原设计 A+ 曾考虑让 validator 取「第 N-1 章时的状态」查连续性(如「重伤卧床却上阵」)。**用户决定推迟**:章节/状态连续性以后由 writer 侧的「章节连续」功能统一处理,不在 validator 这层做。故 `getCharacter` 不加 `asOfChapter` 参数,`get_character` 工具不改。
- **不新建独立 char-consistency critic 子 agent。** validator 本就是审计员、本就有 dim 1,补数据源即可;再加一个 critic 会让一章跑两个评审,延迟/成本翻倍(YAGNI)。
- **不动 settler。** settler 是记账员(记录发生了什么),validator 是审计员(查一致性),职责分离。settler 照常 recordChanges。
- **不做关系/信息边界矩阵。**(沿用 Phase 6 的 defer。)
- **不做 get_character 的轻量变体。** validator 用短档(6k),拉多个全档案理论上偏重;但与 writer 同源数据、同模式,长篇若真成瓶颈再优化(分页/裁剪时间线),本期不做。

## 测试

1. **agent-tree.config.spec.ts**:更新防回归快照的 validator tools;新增正向断言「validator 含 get_character 与 get_characters」(把意图写进测试,而不只是随快照漂移)。
2. **agent-prompts.ts**:dim 1 无现有内容断言(grep 确认「人物一致」未被任何 spec 断言),可自由重写;无需为 prompt 文本加测试(prompt 文本不稳,快照易碎,项目惯例不测)。
3. **回归**:跑 `pnpm test`(server 单元套)确保 52 套全绿;尤其 agent-tree / agent-registry / context-assembler 不回归。

## 验证未覆盖

- 单元测试只能验证「validator 拿到了工具 + dim 1 prompt 写到位」。**实际能不能抓出 OOC** 取决于模型——需活的 E2E(配好模型 + DB,故意写一章 OOC 看 validator 是否报 blocking)。本期不强制跑;用户需要时可起 `pnpm dev` 实测一轮。
