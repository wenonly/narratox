# 设计：outliner 子 agent（大纲生成 + 评价/打分/重试 + KB 自动取文）

> 日期：2026-06-24
> 状态：已实现（待 live smoke 验证）
> 参考：[worldbuilder 子 agent](./2026-06-24-worldbuilder-subagent-design.md)（本设计**镜像其形态**——生成→评审→外科式修订；main 移除内联构建工具、改 task 委派编排子 agent；新增瞬态评审工具 + 6 维 KB-grounded 打分）、[review-revise 修订闭环](./2026-06-20-review-revise-design.md)（`report_review` 结构化打分范式）、[outline 资源](./2026-06-20-outline-design.md)（`Volume`/`ChapterOutline` 两层数据模型 + `set_volume`/`set_chapter_plan`/`get_outline`/`get_chapter_plan` 工具）
> KB 方法论依据：[大纲范例集锦·九大构成/四环节/频道差异](../../../知识库/公式模板/大纲范例集锦.md)、[情节伏笔铺垫节奏·七步细纲/伏笔技法](../../../知识库/创作须知/情节伏笔铺垫节奏.md)、[设定三技·金手指五字诀](../../../知识库/创作须知/设定三技人物世界观金手指.md)

## 背景与问题

当前大纲由 **main agent 直接 `set_volume` + `set_chapter_plan` 内联构建**（见 `MAIN_AGENT_PROMPT`「规划大纲」一节）：

- **无评价 / 无打分 / 无重试** —— 卷结构是否覆盖全书、主线暗线是否埋好、伏笔是否布局、细纲节点是否有冲突爽点，全无校验，质量听天由命。
- **不参考知识库** —— KB 已有成熟的「九大构成体系」「四环节构思法」「情节七步细纲（渴望+阻力=冲突+爽点）」「伏笔技法」「频道差异」方法论，但建大纲时完全没吃这些知识。
- **建在 main 长线程里** —— 与「写章」「建世界观」已下沉到聚焦上下文的演进方向相悖。

世界观已下沉到 worldbuilder 子 agent；大纲是最后一块「生成 + 校验」型内容，理应套用同一范式。

### 与 worldbuilder 的本质差异（驱动设计）

| | worldbuilder | outliner |
|---|---|---|
| 产出形态 | **一次性终态**：建完世界观条目即定 | **两层 + 持续增量**：总纲(卷)一次建；细纲「前 N 章」+ 写作中**按需补**（每写到边界补 10-20 章） |
| 数据模型 | `WorldEntry` 单层、`set_world_entry` 逐条 upsert | `Volume`(卷) + `ChapterOutline`(细纲) 两层、`set_volume`/`set_chapter_plan` 分别 upsert |
| 与伏笔关系 | 不涉及已埋伏笔 | **必须对齐开放伏笔** —— 大纲要规划推进/回收节点，需读 `query_memory` |

差异的后果：outliner 的 critic 评审 **scope 必须自适应**（初始建纲评全书结构；补细纲聚焦与既有内容衔接），且 outline-writer/critic 比 wb-* 多带 `query_memory`（看开放伏笔）+ `get_chapter_plan`（读细纲节点）。

## 关键决策（已锁定）

| 决策 | 选择 | 理由 |
|---|---|---|
| 职责边界 | **outliner 全部接管**（初始建纲 + 按需补细纲） | main 彻底纯编排——不写正文、不建世界观、**不建大纲**。与「main 不碰内容产出」的演进方向一致。main 移除 `set_volume`/`set_chapter_plan`，保留只读 `get_outline`/`get_chapter_plan` |
| 流程结构 | **镜像 `chapter`/`worldbuilder` 编排器** | 新增 `outliner` 编排子 agent（main 用 task 委派），内部挂 `outline-writer`/`outline-critic`。生成者与评审分离；聚焦上下文跑完 取文→生成→评审→修订 |
| 内部流程 | **始终 writer→critic→(修订)→复评** | main 视角统一——只 task 委派，不关心是「建纲」还是「补细纲」。outliner 内部流程不分裂 |
| critic scope | **随任务自适应** | 初始建纲：评全书结构 + 前 N 章细纲（6 维全评）。补细纲：重心放「衔接一致性」(维度 6)，其余维度简评 pass-through |
| KB 取文 | **outline-writer 独立直连 KB** | outline-writer 自带 `list_knowledge`+`get_knowledge`（与 curator/wb-writer 同），自主从全局 KB 拉相关大纲方法论再生成。不依赖 curator 先跑 |
| 重试策略 | **外科式·精简** | critic 标出问题卷/章 → outline-writer 只重写那些（`set_volume`/`set_chapter_plan` upsert 覆盖）→ 复评 → 最多 1 轮 → 保留最后结果。**无快照/回滚**：大纲本就是 add/patch 友好的 upsert，外科式修订只动被点名卷/章，未点名的不受影响 |
| 评审维度 | **6 维，落地 KB 术语** | 不空想，据「九大构成」「四环节」「情节七步细纲」「伏笔技法」「频道差异」订定（见下）。前 4 维重总纲，后 2 维重细纲/衔接。blockingIssues 只收会让结构崩/写不下去的硬伤 |
| 持久化 | **评审瞬态、卷/细纲落库** | `report_outline_review` 不写库（同 `report_review`/`report_worldview_review`）；卷/细纲经现有 `OutlineService` 落 `Volume`/`ChapterOutline` 表（已有） |

## 审计维度（outline-critic 6 维，KB-grounded）

前 4 维侧重**总纲/卷结构**（初始建纲重心），后 2 维侧重**细纲/衔接**（补细纲重心）：

| # | 维度 | KB 依据 | 评审要点 |
|---|---|---|---|
| 1 | **故事核匹配** | 九大构成 §频道差异（男频重力量体系/暗线，女频重人物网/结局） | 卷结构服务于书名/类型/核心冲突/文风，频道重心对齐 |
| 2 | **主线·暗线结构** | 九大构成 §主线暗线/§身世；共性要点「暗线是长篇发动机」 | 主线设关键节点 + 关键的坑；暗线（身世/家族秘密/隐藏身份）前期埋、后期爆 |
| 3 | **力量/金手指节奏** | 四环节构思法（获能是构思重心）+ 金手指五字诀（唯一/可升级/有限制/保密/简单） | 金手指出现节点 + 升级节奏合理；核心是「能升级」而非「多强大」、不一上来太强 |
| 4 | **卷间节奏·起承转合** | 共性要点「结局先定，倒推铺垫」 | 分卷覆盖全书从头到尾；卷间张力递进；结局（尤其女频/悲剧）先定再倒推 |
| 5 | **情节引擎·爽点** | 情节七步细纲（渴望+阻力=冲突+爽点）；情节三注意（围绕人物性格命运、不水情节） | 细纲节点有明确冲突与爽点，围绕人物性格命运展开，不流水账 |
| 6 | **伏笔布局·衔接一致性** | 伏笔技法（人/物/桥段/对话）+ `payoffTiming` 分布 | 开放伏笔有回收计划（核心★必规划）；补细纲时**重心在此**——新批次与既有卷骨架/已写章节状态/开放伏笔无缝衔接，无重复/断层/矛盾 |

`blockingIssues` 必须点名**哪卷/哪章**（如「卷2『药老复苏』与卷1 synopsis 断层」「第8章细纲未回收第3章埋的★伏笔」），驱动 outline-writer 的外科式修订。

## 方案组件

### 1. 新增 `report_outline_review` 工具（outline-critic 结构化输出）

镜像 [report-worldview-review.tool.ts](../../../server/src/agentos/tools/report-worldview-review.tool.ts)，瞬态、不写库、工厂无参（不触 DB）：

```
report_outline_review({
  passed: boolean,              // blockingIssues 为空则 true
  score: number,                // 0-100,全局质量分(用于修订前后比较)
  dimensions: [{ name, status: 'pass'|'issue', issue?: string }],  // 6 维判定(name 用上表维度名)
  blockingIssues: string[],     // 会让结构崩/写不下去、必须修的(主线断裂/伏笔脱节/与故事核矛盾/卷断层),且须点名是哪卷/哪章
  notes: string                 // 非阻塞建议(节奏/偏好)
})
```

`blockingIssues` 必须点名**哪卷/哪章**，驱动 outline-writer 的外科式修订。

### 2. Prompts（agent-prompts.ts 新增 3 段 + 改 2 处）

**`OUTLINER_ORCHESTRATOR_PROMPT`**（镜像 `CHAPTER_ORCHESTRATOR_PROMPT`/`WORLDBUILDER_ORCHESTRATOR_PROMPT`，纯编排不直接读写）：
```
收到「建/重建大纲」或「补细纲」时,在自己的聚焦上下文里【按序跑完】取文→生成→评审(+修订) 全流程:
- 建大纲:全书卷(set_volume×N,覆盖从头到尾)+ 前 20-30 章细纲(set_chapter_plan×N)。
- 补细纲:指定批次(如第 21-40 章)的细纲;outline-writer 先 get_outline+get_chapter_plan+query_memory 读既有+已写。
1. task→outline-writer: list_knowledge+get_knowledge 取大纲方法论 → get_novel_info+get_worldview 对齐故事核/世界观
   → set_volume×N + set_chapter_plan×N。
2. task→outline-critic: get_outline+get_chapter_plan+get_novel_info+get_worldview+query_memory
   → report_outline_review(passed/score/blockingIssues)。补细纲任务时 critic 重心放衔接一致性。
3. 【修订,最多 1 轮】passed=false 时,task→outline-writer 定点修订(把 blockingIssues 传给它,
   只 set_volume/set_chapter_plan 改被点名的卷/章,不要全推重建)。
4. task→outline-critic 复评;保留最后结果(即使复评分更低也不回滚——外科式修订只动被点名卷/章,风险局限)。
5. 回 main 一句结论(如「大纲已建:4 卷 + 前 25 章细纲,score 84」或「卷2断层+第8章漏伏笔,已修订复评 80」)。
铁律:outline-writer 返回后【绝对不能结束】——必须继续 outline-critic;max 1 轮;passed=true 即完成;
不写角色/世界观/正文(边界,各司其职)。
```

**`OUTLINE_WRITER_PROMPT`**（建大纲 + 吃 KB 方法论）：
```
先 KB:list_knowledge 看索引,挑大纲相关条目优先取——
  「大纲范例集锦」(九大构成体系:主角/配角/技能/伙伴/装备/冒险主线暗线/身世/势力/后宫;四环节构思法:获能是重心;
   频道差异:男频重力量体系+暗线,女频重人物网+结局;共性:主线只设关键节点+关键的坑、暗线是发动机、结局先定)、
  「情节伏笔铺垫节奏」(情节七步细纲:地点/人物/梗概/高潮爽点/渴望/阻力/行动冲突;伏笔技法)、题材对应的短篇公式。
  get_knowledge 取全文,提炼「这个题材怎么把大纲搭好」。
补细纲时:先 get_outline 看卷骨架+nextChapterOrder,get_chapter_plan 读既有细纲,query_memory 看已写章节摘要+开放伏笔,
  据已写进度往下规划(承接最近已写章、推进/回收开放伏笔)。
get_novel_info 读故事核(书名/类型/核心冲突/文风/chapterWordTarget),get_worldview/get_world_entry 对齐世界观设定。
建总纲(set_volume):
  - 全书所有卷(长篇通常 3-6 卷),覆盖从头到尾——不要只建第一卷。每卷:卷标题/目标/梗概(梗概里点大致章节范围)。
  - 主线明、暗线埋(身世/家族秘密/隐藏身份是后期引爆点);金手指出现节点 + 升级节奏写进相关卷。
建细纲(set_chapter_plan):每章 CBN(开篇)+ CPNs(情节 2-4)+ CEN(结尾)+ 必须覆盖 + 禁区,volumeOrder 挂到所属卷。
  - 每章有明确冲突与爽点(渴望+阻力=冲突),围绕人物性格命运;CBN→CPNs→CEN 承接下一章。
  - 【刻意安排伏笔节点】推进/回收开放伏笔(尤其核心★和⚠️陈旧的),在 CPNs/mustCover 里点到。
修订时:只重写 critic 点名的卷/章(upsert 覆盖),别动没问题的、别全推重建。改前可 get_chapter_plan/get_outline 看现状。
铁律:大纲只走 set_volume/set_chapter_plan;不写角色/世界观/正文。
```

**`OUTLINE_CRITIC_PROMPT`**（6 维 KB-grounded 审计，镜像 `VALIDATOR_AGENT_PROMPT`/`WORLDBUILDER_CRITIC_PROMPT`）：
```
用 get_outline 列卷+细纲、get_chapter_plan 读核心章细纲全文、get_novel_info 读故事核、
get_worldview/get_world_entry 对齐世界观、query_memory 查已写章节摘要+开放伏笔。
按 6 维逐项审计(故事核匹配/主线暗线结构/力量金手指节奏/卷间节奏起承转合/情节引擎爽点/伏笔布局衔接一致性),
每维 pass/issue。
【补细纲任务】重心放维度 6(伏笔布局·衔接一致性):新批次与既有卷骨架/已写章状态/开放伏笔是否衔接,有无重复/断层/矛盾;
 其余维度 pass-through 简评。
审计完【必须调 report_outline_review】:blockingIssues 只收「会让结构崩/写不下去」的硬伤
(主线断裂/暗线无回收/伏笔脱节/与故事核矛盾/卷断层/核心条目缺失),且须点名是哪卷/哪章;节奏偏好放 notes。
score 严肃,有明显硬伤应 ≤75。passed = blockingIssues 为空。
调完给编排者一句结论(如「score 72,卷2与卷1断层+第8章漏回收★伏笔」)。
```

**`MAIN_AGENT_PROMPT`「规划大纲」一节改写**：从「main 直接 set_volume/set_chapter_plan 建纲」改为「main 用 task 委派 outliner」；等 outliner 回复结论后告诉作者去右侧「大纲」面板过目/修改，等确认后再写正文。「按需补细纲」也改为 task 委派 outliner（补一批）。**「写作阶段」补充**：第 N 章无细纲 → 先 task 委派 outliner 补该章/批 → 再 task 委派 chapter 写。

**`WRITER_AGENT_PROMPT` 改一处**：`get_chapter_plan` 返回 `no_plan` 时，从「建议主 agent 先规划该章细纲」改为「建议主 agent 委派 outliner 补该章细纲」（与 worldbuilder 改动同构——main 已不再自己建纲）。

### 3. agent 装配（deep-agent.service.ts）

在 main 的 `createSubAgentMiddleware.subagents[]` 增加 `outliner`（与 `chapter`/`curator`/`worldbuilder` 同级）。`outliner` 自带嵌套 `createSubAgentMiddleware`（`generalPurposeAgent:false`、`defaultMiddleware: subagentStack()`），挂 `outline-writer`/`outline-critic`。

| agent | 工具 | 说明 |
|---|---|---|
| `outliner`（编排） | （无） | 纯委派。无回滚 → 无工具（同 worldbuilder） |
| `outline-writer` | `list_knowledge`, `get_knowledge`, `set_volume`, `set_chapter_plan`, `get_outline`, `get_chapter_plan`, `get_novel_info`, `get_worldview`, `get_world_entry`, `query_memory` | KB 取文 + 建卷/细纲 + 读现状 + 对齐故事核/世界观/开放伏笔 |
| `outline-critic` | `get_outline`, `get_chapter_plan`, `get_novel_info`, `get_worldview`, `get_world_entry`, `query_memory`, `report_outline_review`（新增） | 只读 + 打分 |

> main 的 `set_volume`/`set_chapter_plan` 工具移除；保留只读 `get_outline`/`get_chapter_plan`。
> 新增私有方法 `outlineWriterTools(userId, novelId)` 装配 outline-writer 工具集（类比 `writerTools()`/`wbWriterTools()`）。
> outline-writer 复用 runTurn 已读的同一活动模型实例（main/writer 16k 实例）；outline-critic 用 6k 紧上限实例（与 settler/validator/wb-critic 一致）。

## 数据流

```
main(CONCEPT, 世界观建好后) ──task──▶ outliner「建大纲」
   1. task▶ outline-writer: list_knowledge→get_knowledge(取大纲方法论)→get_novel_info+get_worldview 对齐
      →set_volume×N(全书卷) + set_chapter_plan×N(前 20-30 章)
   2. task▶ outline-critic: get_outline+get_chapter_plan+get_novel_info+get_worldview+query_memory
      → report_outline_review(passed/score/blockingIssues, 6 维全评)
        ├──[passed] ───────────────────────────────────────────▶ 回 main 结论
        └──[!passed 且 <1 轮]
   3.     task▶ outline-writer: 只 set_volume/set_chapter_plan 改被点名卷/章
   4.     task▶ outline-critic 复评 → 保留最后结果 ──▶ 回 main 结论

main(ACTIVE, 写到边界 / 某章无细纲) ──task──▶ outliner「补细纲(batch)」
   同流程;outline-writer 先 get_outline+get_chapter_plan+query_memory 读既有+已写;
   critic 重心放维度 6(衔接一致性),其余维度简评。
```

## 测试（TDD）

- **`report_outline_review` 工具**：schema 校验、返回 shape（`passed/score/dimensions/blockingIssues/notes`）、不持久化、工厂无参。镜像现有 `report-worldview-review` 的测试形态。
- **`outlineWriterTools` 装配**：断言 outline-writer 工具集含预期工具（含 KB/set/读现状/query_memory）、闭包注入正确 userId/novelId（类比 writerTools/wbWriterTools）。
- **deep-agent.service 装配**：断言 main 的 subagents 含 `outliner`、其下含 `outline-writer`/`outline-critic`、main 自身不再含 `set_volume`/`set_chapter_plan`。
- prompt 改动无直接单测，靠 `pnpm dev` 实测闭环（建一本 CONCEPT 小说走完 curator→worldbuilder→outliner，看是否走 取文→建纲→打分→（修订）→结论；写作中接近边界看是否委派 outliner 补细纲）。

## 实现阶段

1. **`report_outline_review` 工具 + 3 段 prompt**：结构化评审 + 流程编排（可先静态装配，main 暂不接）。
2. **deep-agent.service 装配 outliner**：加 subagent + `outlineWriterTools()`；从 main 移除 `set_volume`/`set_chapter_plan`。
3. **改写 `MAIN_AGENT_PROMPT`「规划大纲」+ writer no_plan**：main 改为 task 委派 outliner；writer no_plan 改为委派 outliner。

每阶段独立可测、可提交。

## 文件改动

- **新增** [server/src/agentos/tools/report-outline-review.tool.ts](../../../server/src/agentos/tools/report-outline-review.tool.ts)（瞬态打分工具）+ `report-outline-review.tool.spec.ts`。
- **改** [server/src/agentos/agent-prompts.ts](../../../server/src/agentos/agent-prompts.ts)：新增 `OUTLINER_ORCHESTRATOR_PROMPT` / `OUTLINE_WRITER_PROMPT` / `OUTLINE_CRITIC_PROMPT`；改写 `MAIN_AGENT_PROMPT`「规划大纲」一节 + 「写作阶段」补无细纲委派；改 `WRITER_AGENT_PROMPT` 的 no_plan 提示。
- **改** [server/src/agentos/deep-agent.service.ts](../../../server/src/agentos/deep-agent.service.ts)：main `subagents[]` 增 `outliner`（嵌套 createSubAgentMiddleware 挂 outline-writer/outline-critic）；新增 `outlineWriterTools()`；import 新工具/提示词；main 移除 `set_volume`/`set_chapter_plan`。
- **无 schema/DB 改动**（`Volume`/`ChapterOutline` 已有）；**无 FE 改动**（右侧大纲面板已读这两表）。

## 非目标（YAGNI / 留后续）

- **不做大纲快照/回滚**（外科式修订 + 保留最后结果已足够；防越改越差的快照服务是 chapter 专属，不为大纲再造一套）。大纲本就是 upsert 友好，定点修订天然可行。
- **不持久化评审记录**（`report_outline_review` 瞬态，同 `report_review`/`report_worldview_review`；大纲评审历史/视图留后续）。
- **不做代码级循环强制**（修订是质量打磨，用 prompt 驱动；模型若跳过只是少打磨，不崩）。
- **不建角色/世界观/正文**（outliner 边界仅限大纲；角色由 set_character、世界观由 worldbuilder、正文由 chapter）。
- **不接入语义检索/pgvector**（KB 现有体量，list_all+精挑足够；语义检索留后续）。
