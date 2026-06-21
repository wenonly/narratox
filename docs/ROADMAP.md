# narratox 小说 AI 写作演进路线图

> 北极星目标：**让 AI 写长篇网文能真实落地——写到第 200 章一致性不崩、单章质量稳定、作者 steering 顺畅。**
>
> 制定日期：2026-06-20
> 参考实现：[inkos](./references/inkos-workflow-reference.md)（autonomous 写手 + 7 份真相文件）、[webnovel-writer](./references/webnovel-writer-workflow-reference.md)（Claude Code Skill 编排 + 事件溯源）。
>
> 本文档是**方法论迁移**，不是架构照搬。narratox 的定位始终是「**人机协作 copilot**」（作者主导，AI 写章），与 inkos（autonomous writer）、webnovel-writer（Skill 编排）是三种不同范式。

---

## 0. 一句话结论

narratox 已经搭好了「**记忆层骨架**」（ChapterSummary + StoryEvent + settler/validator 子 agent + 前情/伏笔注入）。真正卡住长篇落地的不是缺功能，而是三件事：

1. **立项信息不够** —— 写章前 AI 不知道「写多长、核心冲突是什么、主角是谁、力量上限在哪」，凭感觉写。
2. **流程是 prompt 求出来的，不是代码强制的** —— 提示词里写「调用 run_pipeline 写章」，但 `run_pipeline` 这个工具**根本不存在**（见 [§3.2](#32-把幻影-run_pipeline-变成真流水线p0)）；main→settler→validator 全靠模型自觉，模型一偷懒，本章就不结算，下一章【前情】就空。
3. **伏笔/状态太薄** —— 伏笔只有 OPEN/RESOLVED 两态，没有「推进 / 半衰期 / 核心标记」，慢热伏笔无法表达；没有角色信息边界，长篇必然出现「角色不该知道这件事」的崩坏。

补齐这三件事是 **Stage A + B**，是让 AI 写小说「能用」的门槛。Stage C–E 是「好用」。

---

## 1. 现状盘点（已经做完的，别重复造）

| 能力 | 实现 | 位置 |
|---|---|---|
| 章节摘要（inkos `chapter_summaries`） | ✅ `ChapterSummary` 表 | [schema.prisma:99](../server/prisma/schema.prisma#L99) |
| 伏笔账本（inkos `pending_hooks` lite） | ✅ `StoryEvent` 表（OPEN/RESOLVED） | [schema.prisma:113](../server/prisma/schema.prisma#L113) |
| 状态结算子 agent（inkos Observer+Settler） | ✅ `settler` → `write_summary` 工具 | [write-summary.tool.ts](../server/src/agentos/tools/write-summary.tool.ts) |
| 质检子 agent + 修订闭环（D1） | ✅ `validator` → `report_review`（6-7 维 + score）→ writer 定点修订 → 复校 → `restore_chapter` 回滚 | [report-review.tool.ts](../server/src/agentos/tools/report-review.tool.ts) |
| **层级多 agent / chapter 编排** | ✅ 主 agent → `chapter` 编排子 agent（聚焦上下文）→ 嵌套 writer/settler/validator。解决「主 agent 长线程稀释、写完不结算不校验」的软可靠性（2026-06-21） | [deep-agent.service.ts](../server/src/agentos/deep-agent.service.ts) |
| 被动记忆注入（前情 + 未回收伏笔 + 世界观核心） | ✅ `ContextAssembler.forSession` | [context-assembler.service.ts:99](../server/src/agentos/context-assembler.service.ts#L99) |
| 主动记忆检索 | ✅ `query_memory` 工具（关键词） | [query-memory.tool.ts](../server/src/agentos/tools/query-memory.tool.ts) |
| 多温度分阶段 | ✅ settler/validator 6k 紧上限，main/writer 16k | [deep-agent.service.ts:110](../server/src/agentos/deep-agent.service.ts#L110) |
| 多 provider 模型配置 | ✅ `ModelConfig` + 工厂路由 | [model-factory.ts](../server/src/agentos/model-factory.ts) |

> 结论：inkos 建议里的 P0（summary + hook）和 P2 的多 agent 分阶段，**narratox 已落地**。本路线图只讲真实缺口。

---

## 2. 跨参考的核心洞见（inkos × webnovel-writer）

两个参考项目形态完全不同（autonomous agent vs Claude Code 插件），但解决「长篇一致性」的方法论高度收敛成 **5 根支柱**：

### 支柱 1 — 真相文件是唯一事实源（结构化 authoritative，散文是投影）
- inkos：7 份真相文件，**JSON 是真源，markdown 是投影**（避免解析漂移）。
- webnovel：`CHAPTER_COMMIT` 是唯一「写后事实」入口，单向投影到只读视图（**事件溯源 + CQRS**）。
- **narratox 落点**：`ChapterSummary` / `StoryEvent` 已经是结构化表（比两个参考的文件系统都好）。演进方向是 [Stage D4](#stage-d--质量闭环与安全网)——把角色/状态做成从事件**投影**的只读视图，而非直接 CRUD。

### 支柱 2 — 创作环节与一致性环节分离（温度分层 + 角色分工）
- inkos：Writer 0.7（发散）vs Settler/Auditor 0.3（精确）。
- webnovel：context-agent / data-agent / reviewer / deconstruction-agent 各有明确读/写边界和输出契约，**一个 LLM 调用绝不做完所有事**。
- **narratox 落点**：温度分层已做。角色分工已有 writer/settler/validator。下一步是给 validator 合上闭环（[Stage D1](#stage-d--质量闭环与安全网)）。

### 支柱 3 — 伏笔是一等公民（带生命周期）
- inkos：`HookRecord { status: open/progressing/resolved/deferred, halfLifeChapters, coreHook, advancedCount, dependsOn }`；Planner 每章**显式承诺**本章 open/advance/resolve 哪些伏笔。
- **narratox 落点**：当前 `StoryEvent` 只有 OPEN/RESOLVED，且 `write_summary` 只能 create + resolve，**没有「推进」操作**。这是 [Stage B1](#stage-b--记忆与一致性骨架) 的核心。

### 支柱 4 — 章纲结构化为可验证节点
- webnovel：每章 **CBN（开篇）+ 2-4 CPN（情节）+ CEN（结尾）**，节点格式 `主体 | 动作/变化 | 对象/结果`，相邻章 `CEN → 下章 CBN` 逻辑承接；每章带 `必须覆盖节点` + `本章禁区`。
- inkos：`volume_map`（卷纲）+ Planner 的 `ChapterMemo`。
- **narratox 落点**：当前完全没有大纲层。这是 [Stage C1](#stage-c--结构化大纲与按需上下文)。

### 支柱 5 — 充分性闸门 + 流程代码级强制
- 两个参考都有「充分性闸门」：信息没收集齐不生成、章节没审查完不提交。
- **但实现方式不同**：webnovel 靠 SKILL.md 把流程写在 prompt 里（每次 `/command` 重新加载）；inkos 靠 `PipelineRunner` 在代码里串行强制。
- **narratox 落点**：当前流程靠 `MAIN_AGENT_PROMPT` 文字「请委派 settler」——既不是 webnovel 的可重载 skill，也不是 inkos 的代码强制。**这是最大的可靠性债**（见 [§3.2](#32-把幻影-run_pipeline-变成真流水线p0)）。

---

## 3. 关于「skill 化」的思考与结论（重点回答）

> 用户问题：webnovel-writer 本身就是 Claude Code Skill 编排（`/webnovel-*`），当前项目 deepagents 也能用 skill，能不能把流程和节点都拆成 skill 提供给 agent？

**先厘清两种「skill」：**

| | webnovel 的 skill | narratox 该有的 |
|---|---|---|
| 形态 | `/webnovel-write` 斜杠命令（SKILL.md 是编排 prompt） | ❌ **不要照搬**：narratox 是 Web SaaS + 持续 chat 线程，不是 CLI 斜杠命令 |
| 存在原因 | Claude Code 无持久编排态，每次 `/command` 要从 skill 文件**重新建立流程** | narratox 有 checkpointer + 连续线程，**不需要**斜杠命令的重新发现机制 |
| 真正价值 | 不是「斜杠命令」这个 UX，而是**让流程确定、可审计、有闸门** | ✅ **要的是这个**：让流程代码级强制，而非 prompt 求出来 |

**核心判断：不要把 webnovel 的斜杠命令 skill UX 搬过来；要搬的是它的「流程确定性」方法论。** 证据就在自家代码里——提示词已经在承诺一个**不存在的 `run_pipeline`**，这正是「prompt 求流程」会塌方的铁证。

**narratox 的「skill 化」应该落到三层（不是一个新子系统）：**

### 3.1 层一：把幻影 `run_pipeline` 变成真流水线（P0）
把 `write → settle → validate` 实现为一个**代码级强制的工具**（真正的 `run_pipeline` / `write_chapter`），main agent 一次调用，服务端在代码里串行跑完三步 + 步骤间充分性闸门。不再靠 `MAIN_AGENT_PROMPT` 文字「请委派」。

- **解决了**：[P0-3] pipeline 靠 prompt 求出来的可靠性债。
- **对应 webnovel**：`/webnovel-write` 的 6 步流水线，但 narratox 用「一次工具调用触发服务端编排」代替「斜杠命令重新加载 SKILL.md」。
- **对应 inkos**：`PipelineRunner.writeNextChapter()` 的代码串行。

### 3.2 层二：命名的「阶段/skill」注册表（typed phase registry）
把高层流程定义成**有名字、有前置/后置条件（闸门）、可审计**的过程：

| Skill | 触发 | 前置闸门 | 后置闸门 |
|---|---|---|---|
| `onboard` | CONCEPT 状态 | — | 必填信息齐（[Stage A1](#stage-a--地基与确定性)） |
| `planChapter` | 写章前 | ACTIVE 状态 | 产出本章 hook account + 焦点（[Stage B2](#stage-b--记忆与一致性骨架)） |
| `writeChapter` | 作者要写 | planChapter 已产出 | 章节正文非空 + 已结算 |
| `doctor` | 作者点「体检」 | — | 一致性报告已生成（[Stage E1](#stage-e--体验与扩展)） |

这是 narratox 版的「skill」——不是斜杠命令，而是**编排器分发的类型化过程**。subagent 解决「**谁来做**」（角色 + 工具边界），skill/phase 解决「**做什么/何时做/做没做完**」（流程 + 闸门）。当前 narratox 有前者、缺后者。

### 3.3 层三：模块化按需加载的 prompt（webnovel 的分布式 prompt 教训）
webnovel **没有**单一 system prompt：SKILL.md（编排）+ agents/*.md（角色）+ references/*.md（按 Step/Trigger 区段**按需读取**，先 Grep 定位行号再 Read 取段）。

narratox 当前把所有东西塞进 [agent-prompts.ts](../server/src/agentos/agent-prompts.ts)。随着系统长大（审查维度、结算 schema、题材规则），这个文件会膨胀爆上下文。**演进方向**：把「参考知识」（6 维审查标准、结算提取规则、题材禁忌）拆成**按需加载的 reference 文档**，子 agent 用到时才读，而非常驻 system prompt。这正是 webnovel 这么做的根本原因——**控制上下文窗口成本**。

> **一句话**：narratox 的 skill 化 = **代码强制流水线 + 类型化阶段注册表 + 模块化按需 prompt**。不要建一个通用「skill 加载器」子系统，不要复刻斜杠命令发现机制。
>
> **2026-06-21 更新（已落地）**：第一条「代码强制流水线」实际用 **deepagents 原生的层级多 agent** 实现了，而非手写编排代码——主 agent → `chapter` 编排子 agent（聚焦新上下文，procedure prompt）→ 嵌套 writer/settler/validator。这拿到了 webnovel `/webnovel-write` 式的聚焦可靠性（写→结算→校验链不再被主 agent 长线程稀释），且无需「turn 末代码安全网」。类型化阶段注册表 + 模块化按需 prompt 仍未做（C3）。

---

## 4. 分阶段路线图

> 排序原则：**依赖关系 + 杠杆**。A 是地基（没有规模信息，planner 无锚点；没有强制流水线，结算不可靠）；B 是一致性骨干（A 可靠后才值得深化记忆）；C 建在 B 上（记忆喂给按需上下文）；D 建在 C 上（大纲节点让审查可校验）；E 是体验/扩展。

### Stage A — 地基与确定性（**P0，长篇落地的门槛**）

**目标**：让 AI 写章前「知道写什么、写多长」，且「写→结算→校验」必然发生。

#### A1. 补齐立项信息（用户明确要求）

> **进度（2026-06-20）**：必填 2 项 `coreConflict` + `chapterWordTarget` 已落地（settings JSON 子字段、软闸门、prompt 注入、FE 信息卡显示）。见 [spec](./superpowers/specs/2026-06-20-onboarding-fields-design.md)。下方「推荐」字段拆为 **A1.2**，待后续。

当前 `update_novel` 只收 5 字段（[update-novel.tool.ts:39](../server/src/agentos/tools/update-novel.tool.ts#L39)）。对照 inkos（volume_map 规模 / book_rules / roles）+ webnovel（规模 / 故事核 / 主角骨架 / 金手指 / 创意约束），缺：

| 字段 | 来源 | 为什么重要 | 必填? |
|---|---|---|---|
| `chapterWordTarget`（每章字数目标） | inkos LengthNorm + webnovel 规模 | writer 没长度目标 → 单章字数随机忽长忽短 | **必填** |
| `coreConflict`（核心冲突） | webnovel 故事核 | synopsis 是「讲什么」，冲突是「主角欲望 vs 障碍」，决定全书张力 | **必填** |
| `estimatedChapters` / `targetTotalWords`（总篇幅） | inkos volume_map | 规划与节奏的总锚点 | 推荐 |
| `protagonist`（主角：姓名/欲望/缺陷） | webnovel 角色骨架 + inkos roles | 没主角骨架，人物立不住 | 推荐 |
| `powerSystem`（力量体系 + 上限 + 禁忌） | inkos book_rules + webnovel 金手指 | 区分「设定」与「规则」，防战力崩坏 | 推荐 |
| `creativeConstraints`（反套路 / 硬约束） | webnovel 创意约束包 | 差异化核心，避免套路化 | 推荐 |
| `targetAudience` / `platform`（番茄/起点/飞卢） | webnovel 商业定位 | 平台惯例不同（节奏/爽点密度） | 可选 |
| `pov`（叙事视角） | 通用 | 第一/第三人称、限知/全知 | 可选 |

- **落点**：扩 `update_novel` / `create_novel` schema + `Novel.settings` 子字段；`get_novel_info` 的 `missing` 列表纳入新必填项；立项闸门（`onboard` skill 后置条件）= 必填齐。
- **设计原则**：**不照搬 webnovel 的 7 步强制闸门**。narratox 是人机协作——必填项卡写章，推荐项「缺了提醒、可跳过」。AI 可先生成草稿让作者改。
- **验收**：立项后 writer 拿到 `chapterWordTarget`，单章字数方差显著下降。

#### A2. 结算关卡（✅ 已落地，2026-06-20）

> **进度**：已实现。**方案与最初设想不同**——调查后发现 deepagents 无 pipeline 原语，缺口是「可靠性」（模型可能跳过 settler）而非编排。最终采用「skill 化流程 + 领域前置关卡」，**未**做真 `write_chapter` 工具 / 代码串行 pipeline。详见 [spec](./superpowers/specs/2026-06-20-a2-settlement-gate-design.md)。
>
> **原则**：领域数据不变量 → 领域服务（`ChapterService.assertFrontier`）；agent 行为不变量 → `wrapToolCall` middleware（留给未来如 A3 plan 关卡）。

- `MAIN_AGENT_PROMPT` 写作段改为编号化「写章流程」skill（writer→settler→validator）+ 关卡提示；移除幻影 `run_pipeline`（prompt 不再引用不存在的工具）。
- `ChapterService.assertFrontier` 领域关卡：`appendSection`（advance 路径）写第 N 章前，若第 N-1 章有正文但无 `ChapterSummary`，拒绝推进。DRY（所有 writer 工具都是 ChapterService 薄壳，自动继承）；编辑路径不受影响。
- `append_section` 工具翻译拒绝结果为结构化 model-facing 消息（「请先结算第 N 章」）。
- **验收**：故事永不越过未结算的章前进；测试覆盖关卡通过/拦截两类（server 178/178 绿）。
- **保留**：`wrapToolCall` middleware 选项，留给未来 agent 行为关卡（A3 plan、validator→revise 闭环 D1）。

#### A3. 写章前的轻规划（planner 等价）
- 当前 main agent 直接委派 writer，writer 凭感觉写。
- **落点**：在 writer 之前插入一个轻量规划步（可复用 main agent，不新增子 agent）：产出「本章焦点 + 本章 hook account（要 open/advance/resolve 哪些伏笔）」作为 writer 的 task 输入。
- **验收**：writer 写之前能看到「这章该推进哪个伏笔」，而非事后捡到什么算什么。

---

### Stage B — 记忆与一致性骨架（P0/P1）

**目标**：补齐 inkos 真相文件 #1（current_state）和 #4（character_matrix）的等价物，把伏笔做成完整一等公民。

#### B1. 伏笔生命周期（✅ 已落地，2026-06-21）

> **进度**：完整落地。比原 ROADMAP 扩展了 `payoffTiming`（分层陈旧阈值）+ `dependsOn`（伏笔↔伏笔依赖），是用户基于长篇需求明确的扩展。详见 [spec](./superpowers/specs/2026-06-21-hook-lifecycle-design.md)。

- `StoryEvent` 加 `payoffTiming`(HookPayoffTiming 枚举) + `advancedCount` + `coreHook` + `lastAdvancedAtChapter` + `dependsOn`(String[])；`EventStatus` 加 `PROGRESSING`。
- `PAYOFF_STALE_AFTER` 分层阈值(IMMEDIATE 3 / NEAR_TERM 12 / MID_ARC 40 / SLOW_BURN 120 / ENDGAME ∞)——slow-burn 不误报。
- `write_summary` 升级：newHooks 为对象(timing/core/dependsOn) + advancedHookIds + coreHookIds。
- ContextAssembler【未回收伏笔】slice 按 核心/进行中/⚠️陈旧 分组。
- GET /novels/:id/hooks + 📊状态面板 HooksView(核心/陈旧/进行中/已回收分组) + hookWriteSeq 自动刷新。
- **验收**：✅ server 227/227 绿；伏笔按 payoffTiming 不误报陈旧、有推进追踪、有依赖、作者可见。

#### B2. 角色信息边界（character_matrix）（P1）
- 长篇第一杀手：「角色 A 不可能知道这件事，他当时不在场」。当前只有每章 `roleChanges` 自由文本，无聚合关系/知情范围。
- **落点**：走 mutation 层扩展缝（新 `ResourceHandler` + 左栏 nav + 右栏 pane）。先做「角色↔角色 关系」+「角色↔秘密 知情范围」两张表，settler 顺带维护。
- **验收**：能查「角色 X 在第 N 章时知道哪些秘密」。

#### B3. current_state 聚合（P1）
- 当前【前情】只给章节摘要，无「当前世界状态」快照（谁在哪、谁知道什么）。
- **落点**：从 ChapterSummary 的 entities/roleChanges 聚合出一个滚动 `current_state` 视图，注入 prompt。
- **验收**：长篇后期 prompt 仍能给出「当前谁在哪」的准确快照。

---

### Stage C — 结构化大纲与按需上下文（P1/P2）

**目标**：引入可验证的章纲节点 + 上下文按相关性注入，解决长篇上下文爆炸。

#### C1. 结构化章纲节点（✅ 已落地，2026-06-20）

> **进度**：完整落地（6 phase）。`Volume`（大纲/卷纲）+ `ChapterOutline`（细纲：CBN + 2-4 CPNs + CEN 节点 + mustCover + forbidden）。writer 用 `get_chapter_plan` 主动读（不全量注入，省 token）。按需分批生成。写章双关卡（assertHasPlan + assertFrontier）。FE OutlineView（Option A 单列时间线）。详见 [spec](./superpowers/specs/2026-06-20-outline-design.md)。
>
> **与原设想差异**：原 C1 把 ContextAssembler 按需注入列在此处，实际拆到 C2；大纲用「主动工具」而非被动注入（用户决策）。

- **落点**：`ChapterOutline` 模型（节点 `{subject,action,target}`），AI 生成草稿（`set_volume`/`set_chapter_plan`）+ 作者 UI 编辑（OutlineView）；每章带 `必须覆盖` + `本章禁区`。
- **验收**：✅ writer 写第 N 章前调 `get_chapter_plan(N)` 拿节点；`append_section` 无细纲/前驱未结算则拒绝；面板可视化卷+章节点+进度。server 200/200 绿。

#### C2. ContextAssembler 按相关性 + 预算注入（P1）
- 当前固定「最近 5 章摘要 + 全部 open hooks」（[context-assembler.service.ts:99](../server/src/agentos/context-assembler.service.ts#L99)），200 章时会漏相关早期上下文 / hooks 膨胀。
- **落点**：借鉴 webnovel 三层记忆（Working/Episodic/Semantic）+ 预算分配 + 章纲关键词过滤；open hooks 按 `coreHook` + `lastAdvancedAtChapter` 排序截断。
- **验收**：长篇 prompt token 受控，且关键伏笔回收点不被「最近 5 章」窗口漏掉。

#### C3. 模块化按需 prompt（[§3.3](#33-层三模块化按需加载的promptwebnovel-的分布式-prompt-教训)）
- 把审查维度、结算 schema、题材规则从 [agent-prompts.ts](../server/src/agentos/agent-prompts.ts) 拆成按需加载的 reference 文档。
- **验收**：system prompt 体积不再随功能线性膨胀。

---

### Stage D — 质量闭环与安全网（P1/P2）

**目标**：让 validator 真正能改稿，且写坏了能回滚。

#### D1. validator → writer 修订闭环（✅ 已落地，2026-06-20）

> **进度**：完整落地。对比 inkos（33 维 + 回滚）与 webnovel（6 维 + blocking），取中间：**6-7 维结构化审计 + 最高分回滚**，非散文（太弱）、非 33 维（autonomous 专属过度）。详见 [spec](./superpowers/specs/2026-06-20-review-revise-design.md)。

- `report_review` 工具（validator，瞬态）：`{passed, score(0-100), dimensions[], blockingIssues[], notes}`；6-7 维（人物/设定世界观/战力/伏笔/时间线逻辑/文风视角）逐项 pass/issue。
- 修订闭环（MAIN_AGENT_PROMPT，max 1 轮）：validator 返回 passed=false → `snapshot_chapter` 存原版 → writer 定点修订（传 blockingIssues，小改不重写）→ 复校 → 若新 score < 原 score 则 `restore_chapter` 回滚。
- **原则**：修订是质量打磨 → prompt 驱动（非关卡）；数据完整性才用关卡。瞬态不持久化（活动流可见）。
- **验收**：✅ validator 结构化判定驱动修订；越改越差能回滚；server 223/223 绿。

#### D2. 长度归一化（用 A1 的 `chapterWordTarget`）
- 借鉴 inkos LengthNorm：字数越界时单次压缩/扩写；修订砍掉 >75% 原文则拒绝。
- **验收**：单章字数稳定在目标区间。

#### D3. 章节快照 / 回滚 + state-degraded 安全
- 借鉴 inkos：每章 snapshot 支持 rewrite；结算失败存为 `state-degraded` 不丢稿、阻塞错误前传。
- **落点**：`Chapter` 内容版本历史（DB 快照，非 git）；`ChapterStatus` 加 `STATE_DEGRADED`。
- **验收**：重写不覆盖旧稿；结算失败不丢数据。

#### D4. 事件路由 + 投影（webnovel 事件溯源，长期）
- `ResourceMutation` 从 untyped `content: string` → 类型化事件（参考 webnovel 10 种 event_type）；加事件路由表；角色/状态/伏笔从事件**投影**，不直接 CRUD；双向校验上移到 `ResourceRegistry`。
- **验收**：投影坏了可 replay，不影响正文。

---

### Stage E — 体验与扩展（P2/P3）

#### E1. 项目体检 / Dashboard（webnovel doctor）
- 从 ledger 投影一致性报告：未闭合伏笔、被打破的规则、陈旧 hook、追读力债务（可选）。落在 ResourceNav 的「状态」视图。
- **验收**：作者一眼看到「哪些伏笔没闭合」。

#### E2. 短篇独立闭环（inkos 短篇）
- 不需要真相系统就能跑通：Outline → Write → Review → Packaging。低成本功能扩展。

#### E3. 题材 profiles（inkos 15 个 genre）
- 从 1 个通用 profile 开始，用户多了再做题材分型（玄幻/都市/科幻各有规则与禁忌）。

#### E4. 短期 copilot 增强
- Anti-AI-tells 检测（LLM 味词汇/句式/段落均匀度）作为 polish 功能。
- 加密存储 API key（当前明文，已知限制）。

---

## 5. 明确不做清单（保持 copilot 定位）

| 不做 | 原因 |
|---|---|
| autonomous writer（inkos 全自动 10-agent） | 改 narratox「人机协作」产品定位 |
| 33 维审计 + 5 模式修订 + 最高分回滚 | copilot 不需要这么重；D1 单次 spot-fix 足够 |
| `ready-for-review` 强闸口 | narratox「采纳即审」，作者采纳就是审过 |
| webnovel 斜杠命令 skill UX | 形态不对（Web SaaS ≠ CLI）；用代码强制流水线代替（[§3](#3-关于skill-化的思考与结论重点回答)） |
| rule-stack.yaml 4 层优先级 | 人机协作冲突由作者裁决，不需形式化优先级 |
| SQLite memory.db / 文件系统主存储 | Postgres + 结构化表已更好 |
| 追读力债务 / Strand Weave | 纯网文爽点工程，文学向无意义；可作为题材插件按需启用 |

---

## 6. 度量：怎么知道「真实落地」了

| 指标 | 目标 | 对应阶段 |
|---|---|---|
| 单章字数方差 | 显著下降（writer 有 `chapterWordTarget`） | A1 + D2 |
| 结算覆盖率 | 每章 COMMITTED 必有 ChapterSummary（不靠模型自觉） | A2 |
| 长篇一致性盲测 | 第 50+ 章，validator 检出的「角色不该知道 X」类问题随 B2 上线而下降 | B2 |
| 上下文 token 受控 | 第 100 章时 system prompt 不爆 | C2 + C3 |
| 伏笔闭合率 | 「核心伏笔」最终 RESOLVED 比例可追踪 | B1 + E1 |

---

## 7. 推荐的落地顺序（最小可验证路径）

```
A1 补立项信息  →  A2 真 run_pipeline  →  A3 写前规划
        ↓（地基稳了）
B1 伏笔生命周期  →  B2 角色信息边界  →  B3 current_state
        ↓（记忆骨干稳了）
C1 章纲节点  →  C2 按需上下文  →  C3 模块化 prompt
        ↓（结构稳了）
D1 validator 闭环  →  D2 长度归一化  →  D3 快照回滚
        ↓
E1 体检  →  E2 短篇  →  E3 题材  →  D4 事件投影(长期)
```

**第一个里程碑（A 全做完）**：AI 写章前知道规模与冲突，且写→结算→校验必然发生。这一步做完，narratox 就从「能聊着写」变成「能可靠地写」。
