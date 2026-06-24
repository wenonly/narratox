# 设计：worldbuilder 子 agent（世界观生成 + 评价/打分/重试 + KB 自动取文）

> 日期：2026-06-24
> 状态：已批准（设计），待实现
> 参考：[review-revise 修订闭环](./2026-06-20-review-revise-design.md)（validator→writer 修订闭环 + `report_review` 结构化打分，本设计镜像其**形态**——生成→评审→修订；**不**镜像其最高分回滚，见决策表）、[worldview 资源](./2026-06-20-worldview-design.md)（WorldEntry 数据模型）、[novel-knowledge-base](./2026-06-23-novel-knowledge-base-design.md)（KB 服务 + list/get 工具）
> KB 方法论依据：[设定三技·人物·世界观·金手指](../../../知识库/创作须知/设定三技人物世界观金手指.md)、[大纲范例集锦·九大构成/力量体系](../../../知识库/公式模板/大纲范例集锦.md)

## 背景与问题

当前世界观由 **main agent 直接 `set_world_entry` 内联构建**（见 `MAIN_AGENT_PROMPT`「构建世界观」一节）：

- **无评价 / 无打分 / 无重试** —— 建完即止，设定是否自洽、是否支撑情节、力量体系是否会崩，全无校验，质量听天由命。
- **不参考知识库** —— KB 已有成熟的「设定三技」方法论（世界观=公理、逻辑自洽、支撑情节；金手指五字诀）与「九大构成 / 力量体系自洽」范例，但建世界观时完全没吃这些知识。
- **建在 main 长线程里** —— 与「写章」已被下沉到 chapter 聚焦上下文的演进方向相悖。

对比章节流程已成熟的 **writer→validator 修订闭环**（`report_review` 打分 + 最多 1 轮修订 + 最高分回滚），世界观是另一块「生成 + 校验」型内容，理应套用同一范式。

## 关键决策（已锁定）

| 决策 | 选择 | 理由 |
|---|---|---|
| 流程结构 | **镜像 `chapter` 编排器** | 新增 `worldbuilder` 编排子 agent（main 用 task 委派），内部再挂 `wb-writer`/`wb-critic` 两个子 agent。生成者与评审分离，与现有章节流程完全一致；聚焦上下文跑完 取文→生成→评审→修订 |
| KB 取文 | **wb-writer 独立直连 KB** | wb-writer 自带 `list_knowledge`+`get_knowledge`（与 curator 同），自主从全局 KB 拉相关设定文档再生成。不依赖 curator 先跑 |
| 重试策略 | **外科式·精简** | critic 标出问题条目→wb-writer 只重写那些条目（`set_world_entry` upsert 覆盖）→复评→最多 1 轮→保留最后结果。**无快照/回滚基础设施**：外科式修订只动被点名条目，未点名的好条目不受影响；被点名条目若改差，风险局限单条且可再编辑 |
| 评审维度 | **6 维，落地 KB 术语** | 不空想，据「设定三技」+「大纲范例集锦」术语订定（见下）。blockingIssues 只收会让设定崩/写不下去的硬伤 |
| main 边界 | **从 main 移除 `set_world_entry`** | 与「main 不写正文（全委派 writer）」一致；worldbuilder 独占世界观创作。main 仍保留 `get_worldview`/`get_world_entry`（只读）。手动改条目仍可走右侧世界观面板 UI |
| 持久化 | **评审瞬态、条目落库** | `report_worldview_review` 不写库（同 `report_review`）；世界观条目经 `set_world_entry` → `WorldEntryService.upsertEntry` 落 `WorldEntry` 表（已有） |

## 审计维度（wb-critic 6 维，KB-grounded）

| # | 维度 | KB 依据 | 评审要点 |
|---|---|---|---|
| 1 | **逻辑自洽** | 设定三技：世界观=公理/题设，要求「逻辑自洽」 | 条目间不自相矛盾（力量等级 ↔ 规则 ↔ 地点 ↔ 势力 ↔ 种族） |
| 2 | **支撑情节·可写性** | 设定三技：「足够支撑一部小说的情节发展」 | 留冲突与升级空间，不把路写死、不后期崩文 |
| 3 | **力量体系/金手指严谨** | 大纲范例集锦「力量体系要自洽，写清原理来源 + 每级差异」；设定三技金手指五字诀（唯一/可升级/有限制/简单） | 原理来源清晰 + 每级获得什么明确；金手指核心是「能升级」而非「多强大」、不能一开始太强 |
| 4 | **代入感·现实微创新** | 设定三技新手 4 原则（基于现实微创新、从细节入手） | 基于现实微创新而非凭空全新世界；概念不堆砌 |
| 5 | **要素完备** | 设定三技世界观两大模块（自然：地理/地形/气候 + 人文：政治/经济/阶层/职业/种族/宗教） | 两大模块按题材覆盖；核心 `concept`+`powerSystem`+`rule` 齐全 |
| 6 | **故事核匹配** | 大纲范例集锦频道差异（男频重力量体系/暗线，女频重人物网/结局） | 设定服务于书名/题材/核心冲突/文风，频道重心对齐 |

## 方案组件

### 1. 新增 `report_worldview_review` 工具（wb-critic 结构化输出）

镜像 [report-review.tool.ts](../../../server/src/agentos/tools/report-review.tool.ts)，瞬态、不写库、工厂无参（不触 DB）：

```
report_worldview_review({
  passed: boolean,              // blockingIssues 为空则 true
  score: number,                // 0-100,全局质量分(用于修订前后比较)
  dimensions: [{ name, status: 'pass'|'issue', issue?: string }],  // 6 维判定(name 用上表维度名)
  blockingIssues: string[],     // 会让设定崩/写不下去、必须修的(自洽冲突/体系漏洞/与故事核矛盾/核心条目缺失),且须点名是哪条 entry
  notes: string                 // 非阻塞建议(风格/偏好)
})
```

`blockingIssues` 必须点名是哪条 entry（如「powerSystem『灵气修炼』未说明每级差异」），驱动 wb-writer 的外科式修订。

### 2. Prompts（agent-prompts.ts 新增 3 段）

**`WORLDBUILDER_ORCHESTRATOR_PROMPT`**（镜像 `CHAPTER_ORCHESTRATOR_PROMPT`，纯编排不直接读写）：
```
收到「建/重建世界观」时,在自己的聚焦上下文里【按序跑完】取文→生成→评审(+修订) 全流程:
1. task→wb-writer: 先 list_knowledge+get_knowledge 取相关设定文档,再 set_world_entry 建条目
   (至少 concept+powerSystem+rule,按题材补 location/faction/race/item/history)。
2. task→wb-critic: get_worldview+get_world_entry 读全 + get_novel_info 读故事核,
   调 report_worldview_review 给 passed/score/blockingIssues。
3. 【修订,最多 1 轮】passed=false 时,task→wb-writer 定点修订(把 blockingIssues 传给它,
   只 set_world_entry 改被点名的条目,不要全推重建)。
4. task→wb-critic 复评;保留最后结果（即使复评分更低也不回滚——外科式修订只动被点名条目，风险局限单条且可再编辑）。
5. 回 main 一句结论(如「世界观已建:8 条,score 86,概念=…/力量体系=…」)。
铁律:wb-writer 返回后【绝对不能结束】——必须继续 wb-critic;max 1 轮;passed=true 即完成;
不写角色/大纲/正文(边界,各司其职)。
```

**`WORLDBUILDER_WRITER_PROMPT`**（建世界观 + 吃 KB 方法论）：
```
先 KB:list_knowledge 看索引,挑设定相关条目优先取——
  「设定三技·人物·世界观·金手指」(建世界观总纲:世界观=公理/逻辑自洽/支撑情节/两大模块)、
  「大纲范例集锦」(九大构成 + 力量体系自洽/每级差异)、题材对应的短篇公式(题材范例);
  get_knowledge 取全文,提炼「这个题材怎么把世界观搭好」。
get_novel_info 读故事核(书名/类型/核心冲突/文风)对齐。
建条目(set_world_entry):
  - concept(总览/基调/世界背景)、powerSystem(力量等级/上限/代价/来源/每级差异)、
    rule(禁忌/铁律/不可为)为必建核心;
  - 按题材补 location(地点)、faction(势力/组织)、race(种族/生物)、item(资源/金手指)、history(历史/传说)。
  - 每条 content 写实(几百字、有细节、能撑住写作),不要空泛大段堆砌。
修订时:只重写 critic 点名的条目(upsert 覆盖),别动没问题的。
力量体系/金手指遵循 KB 五字诀:唯一/可升级(拓展性)/有限制(不一开始太强否则后期崩)/简单,核心是「能升级」而非「多强大」。
```

**`WORLDBUILDER_CRITIC_PROMPT`**（6 维审计，镜像 `VALIDATOR_AGENT_PROMPT`）：
```
用 get_worldview 列全、get_world_entry 读核心条目全文、get_novel_info 读故事核。
按 6 维逐项审计(逻辑自洽/支撑情节可写性/力量体系金手指严谨/代入感现实微创新/要素完备/故事核匹配),
每维 pass/issue。
审计完【必须调 report_worldview_review】:blockingIssues 只收「会让设定崩/写不下去」的硬伤
(自洽冲突/力量体系漏洞/与故事核矛盾/核心条目缺失),且须点名是哪条 entry;风格偏好放 notes。
score 严肃,有明显硬伤应 ≤75。passed = blockingIssues 为空。
调完给编排者一句结论(如「score 72,powerSystem『灵气修炼』未说明每级差异」)。
```

**`MAIN_AGENT_PROMPT`「构建世界观」一节改写**：从「main 直接 set_world_entry 建条目」改为「main 用 task 委派 worldbuilder」；等 worldbuilder 回复结论后告诉作者去右侧「世界观」面板过目/修改。

### 3. agent 装配（deep-agent.service.ts）

在 main 的 `createSubAgentMiddleware.subagents[]` 增加 `worldbuilder`（与 `chapter`/`curator` 同级）。`worldbuilder` 自带嵌套 `createSubAgentMiddleware`（`generalPurposeAgent:false`、`defaultMiddleware: subagentStack()`），挂 `wb-writer`/`wb-critic`。

| agent | 工具 | 说明 |
|---|---|---|
| `worldbuilder`（编排） | （无） | 纯委派。chapter 编排器持 snapshot/restore 是为回滚；本设计无回滚 → 无工具 |
| `wb-writer` | `list_knowledge`, `get_knowledge`, `set_world_entry`, `get_worldview`, `get_world_entry`, `get_novel_info` | KB 取文 + 写条目 + 读现状 + 对齐故事核 |
| `wb-critic` | `get_worldview`, `get_world_entry`, `get_novel_info`, `report_worldview_review`（新增） | 只读 + 打分 |

> main 的 `set_world_entry` 工具移除；保留 `get_worldview`/`get_world_entry`。
> 新增私有方法 `wbWriterTools(userId, novelId)` 装配 wb-writer 工具集（类比现有 `writerTools()`）。
> wb-writer/wb-critic 复用 runTurn 已读的同一活动模型实例（main/writer 16k 实例；评审用 6k 紧上限实例，与 settler/validator 一致）。

## 数据流

```
main(CONCEPT 信息齐) ──task──▶ worldbuilder
                                  │
   1. task▶ wb-writer: list_knowledge→get_knowledge(取设定文档)→get_novel_info→set_world_entry×N(建条目)
   2. task▶ wb-critic: get_worldview+get_world_entry+get_novel_info → report_worldview_review(passed/score/blockingIssues)
        ├──[passed] ───────────────────────────────────────────▶ 回 main 结论
        └──[!passed 且 <1 轮]
   3.     task▶ wb-writer: 只 set_world_entry 改被点名条目
   4.     task▶ wb-critic 复评 → 保留最后结果 ──▶ 回 main 结论
```

## 测试（TDD）

- **`report_worldview_review` 工具**：schema 校验、返回 shape（`passed/score/dimensions/blockingIssues/notes`）、不持久化、工厂无参。镜像现有 `report-review` 的测试形态。
- **`wbWriterTools` 装配**：断言 wb-writer 工具集含 6 个工具、含新增 KB/set 工具、闭包注入正确 userId/novelId（类比 writerTools）。
- **deep-agent.service 装配**：断言 main 的 subagents 含 `worldbuilder`、其下含 `wb-writer`/`wb-critic`、main 自身不再含 `set_world_entry`（可选，靠结构断言）。
- prompt 改动无直接单测，靠 `pnpm dev` 实测闭环（建一本 CONCEPT 小说，看是否走 取文→建条目→打分→（修订）→结论）。

## 实现阶段

1. **`report_worldview_review` 工具 + 3 段 prompt**：结构化评审 + 流程编排（可先静态装配，main 暂不接）。
2. **deep-agent.service 装配 worldbuilder**：加 subagent + `wbWriterTools()`；从 main 移除 `set_world_entry`。
3. **改写 `MAIN_AGENT_PROMPT`「构建世界观」**：main 改为 task 委派 worldbuilder。

每阶段独立可测、可提交。

## 文件改动

- **新增** [server/src/agentos/tools/report-worldview-review.tool.ts](../../../server/src/agentos/tools/report-worldview-review.tool.ts)（瞬态打分工具）+ `report-worldview-review.tool.spec.ts`。
- **改** [server/src/agentos/agent-prompts.ts](../../../server/src/agentos/agent-prompts.ts)：新增 `WORLDBUILDER_ORCHESTRATOR_PROMPT` / `WORLDBUILDER_WRITER_PROMPT` / `WORLDBUILDER_CRITIC_PROMPT`；改写 `MAIN_AGENT_PROMPT`「构建世界观」一节。
- **改** [server/src/agentos/deep-agent.service.ts](../../../server/src/agentos/deep-agent.service.ts)：main `subagents[]` 增 `worldbuilder`（嵌套 createSubAgentMiddleware 挂 wb-writer/wb-critic）；新增 `wbWriterTools()`；import 新工具/提示词；main 移除 `set_world_entry`。
- **无 schema/DB 改动**（`WorldEntry` 已有）；**无 FE 改动**（右侧世界观面板已读 `WorldEntry` 表）。

## 非目标（YAGNI / 留后续）

- **不做世界观快照/回滚**（外科式修订 + 保留最后结果已足够；防越改越差的快照服务是 chapter 专属，不为世界观再造一套）。若日后证明单条改差风险高，再加 per-entry snapshot。
- **不持久化评审记录**（`report_worldview_review` 瞬态，同 `report_review`；世界观评审历史/视图留后续）。
- **不做代码级循环强制**（修订是质量打磨，用 prompt 驱动；模型若跳过只是少打磨，不崩）。
- **不建角色/大纲/正文**（worldbuilder 边界仅限 WorldEntry；角色由 set_character、大纲由 set_volume/set_chapter_plan、正文由 chapter）。
- **不接入语义检索/pgvector**（KB 现 63 篇，list_all+精挑足够；语义检索留后续）。
