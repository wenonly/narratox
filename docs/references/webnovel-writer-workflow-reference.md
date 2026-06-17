# webnovel-writer 创作闭环参考

> 参考项目：`~/project/webnovel-writer`（v6.2.0，GPL v3，作者 lingfengQAQ）
> 用途：为 narratox Phase 2/3 的资源扩展（大纲/角色/世界观）与 Phase 3 的事实系统（StoryEvent ledger）提供方法论参考。
> 分析日期：2026-06-17

---

## 0. 一句话定位

webnovel-writer **不是** Web 应用，而是一个 **Claude Code 插件**（Python 3.10+）：作者在 Claude Code 里输入 `/webnovel-*` 命令，由 Claude 作为 LLM 执行 Skill 编排，通过 Bash 调用 Python CLI 完成确定性数据操作。

这与 narratox 的"Next.js + NestJS Web 工作区"形态完全不同，但它的**创作方法论、数据流设计、上下文管理策略**高度可迁移——尤其因为它解决了一个 narratox 即将面对的硬问题：**写到第 200 章如何保持一致性**。

---

## 1. 三层执行架构

| 层 | 目录 | 职责 | narratox 对应 |
|----|------|------|--------------|
| **Skills（编排层）** | `skills/`（8 个 `/webnovel-*` 命令） | 作者面向的流程编排 | 无直接对应；narratox 当前是单一 chat agent |
| **Agents（AI 工具层）** | `agents/`（4 个） | context-agent / data-agent / reviewer / deconstruction-agent | `DeepAgentService`（目前只有"一个写手"角色） |
| **CLI / data_modules（数据层）** | `scripts/data_modules/` | 确定性的状态/索引/RAG/投影/提交 | Prisma + `ResourceRegistry`（目前是直接 CRUD） |

**关键启示**：webnovel-writer 把"AI 推理"和"确定性数据操作"严格分离——LLM 只产出文本/JSON，所有落库由 Python CLI 做。narratox 目前 chapter 的 append/set 是直接走 `ChapterHandler`，没有"事实提取"环节，这是 Phase 3 要补的。

---

## 2. 完整闭环流程（核心）

### 2.1 流水线总览

```
/webnovel-init  →  /webnovel-plan  →  /webnovel-write  →  /webnovel-review
     ↓                  ↓                    ↓                    ↓
  项目骨架           卷纲+章纲          正文+事实提交          质量审查
  MASTER_SETTING     volumes/           commits/              reviews/
                     chapters/          ↓ 五路投影
                                        state.json / index.db /
                                        summaries / memory / vectors.db
                                                ↓
                          /webnovel-query（查）/webnovel-dashboard（看）
                          /webnovel-learn（学）/webnovel-doctor（体检）
```

### 2.2 阶段一：初始化 `/webnovel-init`（7 步交互采集）

分步采集，**每步只问"当前缺失且会阻塞下一步"的信息**：

1. 预检环境、加载参考
2. 灵感来源（可选调用 `deconstruction-agent` 拆参考书）
3. **故事核与商业定位**：书名、题材、规模、一句话故事、核心冲突
4. **角色骨架**：主角姓名 + 欲望 + 缺陷
5. **金手指与兑现机制**
6. **世界观与力量规则**：世界规模 + 力量体系类型
7. **创意约束包**：反套路规则（≥1）+ 硬约束（≥2）—— 这是差异化的核心

**充分性闸门**（`init/SKILL.md:154-163`）：未满足不生成。产物：
```
.story-system/MASTER_SETTING.json    # 写前合同（调性/禁忌）
.webnovel/state.json                 # 兼容读模型
.webnovel/idea_bank.json             # 创意约束包
设定集/{世界观,力量体系,主角卡,反派设计}.md
大纲/总纲.md
```

### 2.3 阶段二：卷纲规划 `/webnovel-plan`

**总纲 → 卷节拍表 → 卷时间线 → 卷详细大纲（含章纲）** 四级细化。章纲以 10 章/批批量生成。

每章纲的结构化节点（核心设计）：
- **1 个 CBN**（Chapter Begin Node，开篇节点）
- **2-4 个 CPN**（Chapter Plot Node，情节节点）
- **1 个 CEN**（Chapter End Node，结尾节点）
- 格式：`主体 | 动作/变化 | 对象/结果`
- 相邻章节 **`CEN → 下一章 CBN` 必须逻辑承接**
- 每章还带 `必须覆盖节点`（≤4）和 `本章禁区`（≤5）

规划完成后刷新 Story System 合同（`story-system --emit-runtime-contracts`）。

### 2.4 阶段三：章节写作 `/webnovel-write`（6 步流水线，最核心）

```
Step 0: 预检（preflight + 合同刷新 + write-gate prewrite）
Step 1: [context-agent]   → 五段写作任务书（开篇委托/这章的故事/人物/怎么写/收在哪）
Step 2: 起草正文（围绕 CBN→CPNs→CEN 展开）→ 正文/第NNNN章-标题.md
Step 3: [reviewer]        → 六维审查 JSON（只跑一轮；blocking issue 阻断）
Step 4: 润色（修复非blocking → 风格适配 → 排版 → Anti-AI 终检）
Step 5: [data-agent]      → 提取事实 → CHAPTER_COMMIT → 五路投影
Step 6: Git 备份
```

**充分性闸门**（`write/SKILL.md:324-331`）：正文非空 + 审查落库 + blocking 已处理 + anti_ai_force_check=pass + projection 五项 done/skipped + chapter_status=committed + 三个 write-gate 均通过。

**断点恢复**：每步状态写入 `run_ledger.json`，重复执行同一章时先读断点建议，正文被手改过会停下询问、不覆盖作者修改。

### 2.5 辅助命令

- `/webnovel-review 1-5`：批量审查
- `/webnovel-query 萧炎`：查角色状态/关系/规则（走 SQLite + RAG）
- `/webnovel-dashboard`：可视化面板
- `/webnovel-learn "..."`：记录写作经验到记忆系统
- `/webnovel-doctor`：项目体检（一致性/断点/投影完整性）

---

## 3. 五大核心架构决策

### 3.1 Story System：单向不可变数据流（最重要）

```
.story-system/commits/chapter_NNN.commit.json   ← 唯一的"写后事实"入口
        │  ChapterCommitService.apply_projections()
        ▼
只读投影（永远不直接编辑）：
  state.json · index.db · vectors.db · summaries/ · memory_scratchpad.json
```

- **写前真源**：`MASTER_SETTING.json`、`volumes/`、`chapters/`、`reviews/`
- **写后真源**：accepted `CHAPTER_COMMIT`
- **投影层**：永远只读；`hooks/guard_runtime_write.py` 阻止直接编辑 commit 和投影文件

这是**事件溯源 + CQRS** 模式。AI 写的章节不会直接进库，而是先生成 commit（含审查结果、事实提取、节点完成情况），由 commit 驱动多个投影。投影失败可重放（`projections replay --from-chapter A --to-chapter B`），不影响正文。

### 3.2 多 Agent 分工 + 不越权

| Agent | 读/写权限 | 输出 |
|-------|----------|------|
| context-agent | 只读 | 五段写作任务书 |
| data-agent | 只写 `.webnovel/tmp/` 三份 artifact | events/deltas/scenes |
| reviewer | 只读，只返回 JSON | 六维问题清单（不评分、不建议） |
| deconstruction-agent | 只读 | 可迁移模式 |

编排层用 `SubagentRun` JSON 统一记录每个 agent 的 status/problems/auto_handled。**一个 LLM 调用绝不做完所有事。**

### 3.3 三层记忆 + 预算分配

`memory/orchestrator.py:39-93`：

| 层 | 来源 | 内容 |
|----|------|------|
| **Working Memory** | 当前章纲 + 最近 3 章摘要 + state 导出 | 即时上下文 |
| **Episodic Memory** | index.db 最近状态变更 + 关系变化 + 实体出场 | 近期事件 |
| **Semantic Memory** | scratchpad 的 active items（世界规则/角色状态/伏笔） | 长期事实 |

优先级：`world_rule(0) > character_state(1) > relationship(2) > story_fact(3) > open_loop(4) > reader_promise(5) > timeline(6)`。通过 `_filter_relevant()` 按章纲关键词过滤，再 `allocate_limits()` 按任务类型分配预算。**这是解决"长篇上下文爆炸"的关键。**

### 3.4 结构化章纲节点（CBN/CPNs/CEN）

每章有可验证的骨架，使：
- 审查可检查"节点是否被覆盖"
- 上下文注入可精确定位"本章必须发生什么"
- 相邻章节逻辑承接可被机器校验

### 3.5 追读力债务系统 + Strand Weave 节奏

- **Strand Weave**：三条情节线 Quest 60% / Fire 20% / Constellation 20%，红线规则（Quest ≤5 连续章，Fire gap ≤10，Constellation gap ≤15），由 `strand_tracker` 持续追踪
- **追读力债务**：`chase_debt` 表追踪"欠读者的爽点"，有利息率、偿还计划、到期章节；`override_contracts` 允许作者"借债"跳过一个微兑现，但必须记录偿还计划

这是网文特有的"爽点工程学"，纯文学向项目可忽略。

---

## 4. 数据模型与事件系统

### 4.1 合同 Schema（Pydantic）

```
MasterSetting     # 全书主设定：route/master_constraints/base_context/override_policy
VolumeBrief       # 卷级合同：volume_goal/selected_tropes/anti_patterns/system_constraints
ChapterBrief      # 章级合同：chapter_directive(goal/must_cover_nodes/forbidden_zones)/dynamic_context
ReviewContract    # 审查合同：must_check/blocking_rules/genre_specific_risks/review_thresholds
```

### 4.2 CHAPTER_COMMIT（写后事实的唯一载体）

```
meta           → schema_version / chapter / status(accepted|rejected)
contract_refs  → master/volume/chapter/review 四层合同引用
provenance     → write_fact_role / projection_role / legacy_state_role
outline_snapshot → planned/covered/missed/extra nodes
review_result / fulfillment_result / disambiguation_result
extraction_result → accepted_events / state_deltas / entity_deltas / scenes / summary_text
projection_status  → state / index / summary / memory / vector 五路
```

自动判定逻辑：`rejected = blocking_count>0 OR missed_nodes OR pending_disambiguation`。

### 4.3 10 种事件类型（`story_event_schema.py`）

```
character_state_changed    relationship_changed       world_rule_revealed
world_rule_broken          power_breakthrough         artifact_obtained
promise_created            promise_paid_off           open_loop_created        open_loop_closed
```

**事件路由表**（`event_projection_router.py`）决定每种事件触发哪些投影：
```
character_state_changed → [state, memory, vector]
relationship_changed    → [index, vector]
world_rule_revealed     → [memory, vector]
open_loop_created       → [memory]
```

### 4.4 SQLite 表（index.db，14 张）

`chapters / scenes / appearances / entities / aliases / state_changes / relationships / relationship_events / override_contracts / chase_debt / debt_events / chapter_reading_power / invalid_facts / review_metrics`。

---

## 5. Prompt 工程：分布式而非集中式

webnovel-writer **没有**一个集中式 system prompt：

- **第一层**：`SKILL.md` 就是编排 prompt（`/webnovel-write 45` 后 Claude 遵循的指令）
- **第二层**：`agents/*.md` 就是 agent 的 system prompt（定义身份 + 工具权限 + 输出契约）
- **第三层**：`references/*.md` 是按需加载的 prompt 附属——**不是预读全部**，而是按 Step/Trigger 区段读取（先 Grep 定位行号，再 Read offset/limit 取段），控制上下文窗口消耗

**数据权重优先级**（context-agent）：`用户要求 > 章纲原文 > MASTER_SETTING > reasoning 裁决 > CHAPTER_COMMIT > CSV 检索`。

**防幻觉三定律**贯穿所有 prompt：
1. **大纲即法律** — context-agent 强制加载章纲
2. **设定即物理** — reviewer 内置一致性审查
3. **发明需识别** — data-agent 自动提取并消歧新发明

---

## 6. 对 narratox 的启示与建议

### 6.1 现状对照

| 维度 | webnovel-writer | narratox 当前（Phase 1 v0.2.0） |
|------|-----------------|--------------------------------|
| 形态 | Claude Code 插件 | Web 工作区（chat → 采纳到章节） |
| Agent | 4 个分工 agent | 1 个 `DeepAgentService`（写手） |
| 上下文 | 章纲节点 + 三层记忆 + RAG | `ContextAssembler` 拼 title/genre/synopsis/worldview/style |
| 写入 | CHAPTER_COMMIT → 五路投影 | 「采纳」直接 append/set 到 `Chapter.content` |
| 大纲 | 总纲→卷纲→章纲（CBN/CPNs/CEN） | 无（Phase 2 待建） |
| 角色/世界观 | 设定集 + SQLite 实体表 | 数据模型有字段（`Novel.worldview`），无 UI（Phase 2） |
| 审查 | reviewer 六维 + blocking | 无 |
| 事实系统 | 10 种事件 + 投影 | 无（Phase 3 StoryEvent ledger） |

narratox 的 `ResourceRegistry` / `ResourceMutation` 已经为 Phase 2/3 留好了扩展缝——这与 webnovel-writer 的"事件路由表"思路一致，是好的起点。

### 6.2 建议一：Phase 2 大纲引入"结构化章纲节点"

**不要**把大纲做成纯自由文本。借鉴 CBN/CPNs/CEN：
- 每章大纲存储为结构化节点（开篇/情节×2-4/结尾），而非一段散文
- 节点格式：`主体 | 动作/变化 | 对象/结果`
- 相邻章节 `CEN → 下一章 CBN` 做逻辑承接校验
- 章大纲带 `必须覆盖节点` 和 `本章禁区`

落地到 narratox：在 `Chapter` 模型或新增 `ChapterOutline` 模型上加 `nodes JSON`（或单独表）。`ContextAssembler` 注入 prompt 时直接用节点，比自由文本更可控、更省 token。

**取舍**：narratox 面向"作者 + AI 协作"，不必强制 7 步采集闸门。可以让 AI 先生成结构化章纲草稿，作者在 UI 里编辑/确认。

### 6.3 建议二：Phase 3 事实系统用"事件 + 投影"而非"直接 CRUD"

narratox 的 `ResourceMutation { resource, targetId, op:'set'|'append'|'patch', content }` 已经是个事件雏形，但目前 content 是无类型的文本块。借鉴 webnovel-writer：

- 把 `ResourceMutation` 升级为带类型的事件（参考那 10 种 event_type）
- 加一个"事件路由表"：每种事件触发哪些资源/视图的更新
- 引入 `StoryEvent` ledger（Phase 3 已规划）作为唯一"写后事实"入口
- 角色状态/世界观规则/伏笔都是从事件**投影**出来的只读视图，不直接 CRUD

**好处**：写到 200 章时，角色状态、关系、伏笔都能从事件流重建；投影坏了可以 replay。直接 CRUD 会累积不一致。

### 6.4 建议三：引入"分离的 agent 角色"，但克制

webnovel-writer 的 4 agent 分工很重，narratox 不必照搬全套。建议**分两步**：

- **短期（Phase 2）**：在 `DeepAgentService` 基础上加一个轻量 `reviewer` agent——生成章节后可选触发一轮事实/一致性审查，blocking 才阻断。一个 agent 够用。
- **中期（Phase 3）**：当事实系统建起来后，再加 `data-agent`（从正文提取事件填 ledger）和 `context-agent`（按章纲关键词过滤记忆层）。

**核心原则**：每个 agent 有明确的读/写边界和输出契约（JSON schema），不让一个 LLM 调用做完所有事。

### 6.5 建议四：上下文注入按需加载，而非全量拼接

narratox 当前 `ContextAssembler.forSession()` 全量拼 title/genre/synopsis/worldview/style——短篇没问题，长篇会爆。借鉴：

- `references/*.md` 的"按 Step/Trigger 区段读取"策略 → 在 narratox 里对应"按当前章节/场景的相关性加载设定片段"
- 三层记忆的预算分配 → 长篇阶段引入"章纲关键词过滤 + token 预算"，优先级排序注入

**取舍**：narratox 是流式 chat（不是一次性编排），全量拼接在前期可接受。建议在 Phase 3 事实系统建好后，把 `ContextAssembler` 重构为"按相关性 + 预算"组装。

### 6.6 建议五：「采纳」机制保留，但补"事实提取"环节

narratox 的「采纳到本章」（chat → chapter append/set）是个好的轻量闭环，**应保留**作为作者主导的路径。但它缺一个环节：采纳后，章节里出现的新角色/新规则/新伏笔**没有自动进入系统**，后续章节的 AI 不知道。

借鉴 data-agent：采纳时（或章节 status 从 DRAFT→COMMITTED 时）触发一次"事实提取"，把新实体/事件写入 Phase 3 的 ledger，再投影到角色/世界观/状态视图。

### 6.7 建议六：UI 上提供"项目体检"视角

webnovel-writer 的 `/webnovel-doctor` 和 `/webnovel-dashboard` 很有价值——作者需要看到"哪些伏笔没闭合、哪些规则被打破、追读力债务"。narratox 可以在 ResourceNav 里 P3 占位的"状态"视图做这件事：从 Phase 3 ledger 投影出一致性报告。

---

## 7. 不建议照搬的部分

| 设计 | 原因 |
|------|------|
| **7 步采集闸门** | narratox 面向 Web 协作，作者主导；AI 应先生成草稿再让作者改，而非强制问答 |
| **追读力债务 / Strand Weave** | 纯网文爽点工程，文学向项目无意义；可作为"题材插件"按需启用 |
| **Git 每章备份** | narratox 是多租户 SaaS，数据在 Postgres；用 DB 版本/快照更合适 |
| **14 张 SQLite 表** | 过度工程。narratox 用 Prisma + Postgres，几张核心表 + JSON 字段足够起步 |
| **Skill/Agent/CLI 三层物理分离** | 那是 Claude Code 插件的形态约束；narratox 用 NestJS 模块 + ResourceHandler 抽象即可 |

---

## 8. 推荐的 narratox 落地路径（结合现有 Phase 规划）

| 阶段 | 借鉴点 | 落地动作 |
|------|--------|----------|
| **Phase 2 - 大纲** | 结构化章纲节点（CBN/CPNs/CEN） | 新增 `ChapterOutline.nodes`，AI 生成草稿 + 作者编辑；`ContextAssembler` 注入节点 |
| **Phase 2 - 角色/世界观** | 设定集 + 实体表分离 | 角色卡/世界观作为新 Resource 接入 `ResourceRegistry`，独立于章节 |
| **Phase 2 末** | 轻量 reviewer agent | 在 `DeepAgentService` 旁加一个可选审查 agent，blocking 才阻断 |
| **Phase 3 - StoryEvent ledger** | 事件 + 投影 + 路由表 | `ResourceMutation` 升级为类型化事件；新增 `StoryEvent` 表 + 投影机制 |
| **Phase 3 - 记忆** | 三层记忆 + 预算分配 | `ContextAssembler` 重构为按相关性 + token 预算组装；Postgres 物化视图或 Prisma 查询充当"投影" |
| **Phase 3 - 体检** | doctor/dashboard | ResourceNav 的"状态"视图，从 ledger 投影一致性报告 |

---

## 9. 一句话总结

webnovel-writer 的核心可迁移洞见不是它的插件形态，而是这三条：

1. **写后事实只能从一个入口进入系统，再单向投影到只读视图**（事件溯源 + CQRS）
2. **AI 角色分工，每个 agent 有明确读/写边界和输出契约**（不是一个 LLM 做完所有事）
3. **章纲结构化为可验证的节点，上下文按相关性 + 预算注入**（长篇一致性的关键）

narratox 的 `ResourceRegistry` / `ResourceMutation` 已经为这三条留好了缝——Phase 2/3 的工作是把这些抽象填实，而非推倒重来。
