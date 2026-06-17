# inkos 创作闭环参考

> 参考项目：`~/project/inkos`（`@actalk/inkos` v1.4.1，MIT，pnpm monorepo：core / cli / studio）
> 用途：为 narratox Phase 2（资源扩展）/ Phase 3（StoryEvent ledger + memory）/ Mutation 层演进提供方法论参考。
> 配套文档：[webnovel-writer-workflow-reference.md](./webnovel-writer-workflow-reference.md)（同样主题、不同形态的对照参考）。
> 分析日期：2026-06-17

---

## 0. 一句话定位

inkos 是一个 **autonomous AI 写小说 agent**——不是"陪作者聊天"的 copilot，而是 **AI 自己把整本书写完**，作者只在 `ready-for-review` 闸口做最终审批。

这与 narratox 当前的定位（**人写、AI 提议、人采纳**）是**两种不同范式**：

| | narratox（Phase 1 现状） | inkos |
|---|---|---|
| 主导者 | 人类作者 | AI |
| AI 角色 | chat copilot（提议） | 自主写手 + 审计员 + 修订员 |
| 人介入点 | 每条消息（采纳/拒绝） | 每章审批（ready-for-review） |
| 一致性机制 | 作者脑 + per-novel system prompt | 7 份真相文件 + Hook ledger + 状态快照 |
| 单 agent / 多 agent | 单 deep-agent | 10-agent 流水线 |

但 inkos 解决的**核心硬问题**——"写到第 200 章如何保持一致性"——正是 narratox Phase 3 必须面对的。它的方法论高度可迁移，**架构不必照搬**。

---

## 1. 项目形态

- **Stack**：pnpm monorepo，TypeScript strict，三包：`@actalk/inkos-core`（流水线引擎）、`@actalk/inkos`（Commander CLI + Ink/React TUI）、`@actalk/inkos-studio`（Vite + React + Hono web）。
- **LLM SDK**：`@mariozechner/pi-ai` + `pi-agent-core`（不是 LangChain）。
- **存储**：文件系统（每本书一个目录）+ SQLite（`memory.db` 时序记忆）+ Zod schema 校验。
- **目标平台**：番茄/起点/飞卢中文网文，也支持英文。

---

## 2. 两条闭环

inkos 内置两条**完全独立**的闭环：

### 2.1 长篇连载（核心闭环）
```
book create (Phase 0 一次性)
    └── Architect 生成 foundation
    └── FoundationReviewer 打分（5 维，阈值 80，最多重试 2 次）
    └── 初始化 control docs（author_intent / current_focus / style_guide）
    └── 快照 chapter 0

write next (Phase 1..N，每章循环)
    1. Planner     —— 生成 ChapterMemo + Intent + 本章 Hook account
    2. Composer    —— 确定性装配上下文 + rule-stack.yaml（无 LLM）
    3. Writer      —— 写正文（内部跑 Observer + Settler）
    4. LengthNorm  —— 仅在字数越界时单次压缩/扩写
    5. Audit ⇄ Revise —— 33 维审计 + 修订，"最高分回滚"
    6. Truth Persist + State Validator —— 落真相文件 + JSON + 快照
    7. Post-checks —— Hook 提升 / 段落漂移 / 长跨度疲劳

review approve（人在 ready-for-review 闸口审批）
```

### 2.2 短篇独立（独立闭环）
不维护真相文件，一次性走完：Outline → OutlineReview → OutlineRevise → Writer 全量 → DraftReview → DraftRevise → Packaging（卖点/简介/封面 prompt）→ 可选封面生成。产物落在 `shorts/<id>/final/`。

> **启示**：narratox 当前只有"长篇 copilot"形态，**短篇闭环**是一个低成本可拓展方向——不需要 Phase 3 的真相系统就能跑通。

---

## 3. 长篇闭环：阶段拆解

### 3.1 Phase 0：Book Initialization（一次性）

入口：`PipelineRunner.initBook()`（`packages/core/src/pipeline/runner.ts:612`）。

1. **Architect 生成 foundation**——`ArchitectAgent.generateFoundation()`（`agents/architect.ts`）产出 5 类基础文件：
   - `story_bible.md`（世界观，legacy shim；canonical 是 `outline/story_frame.md`）
   - `outline/volume_map.md`（卷纲）
   - `book_rules.md`（本书规则：主角、力量上限、禁忌）
   - `outline/story_frame.md`（故事框架，Phase 5 canonical）
   - `roles/主要角色/*.md` + `roles/次要角色/*.md`（角色档案）

2. **Foundation 评审循环**——`generateAndReviewFoundation()`（`runner.ts:417`）。`FoundationReviewerAgent` 在 5 个维度打分：核心冲突 / 开篇动能 / 世界一致性 / 角色差异度 / 节奏可行性。阈值 80/100，最多重试 `foundation.reviewRetries` 次（默认 2）。

3. **Control documents**——`StateManager.ensureControlDocumentsAt()`（`state/manager.ts:30`）初始化：
   - `author_intent.md`（**长期**作者愿景，作者随时可改）
   - `current_focus.md`（**近期** 1–3 章焦点，作者随时可改）
   - `style_guide.md`（写作方法论 + 风格指纹）

4. **章节 0 状态快照**——为后续 `rewrite` 提供 rollback 锚点。

> **narratox 启示**：Phase 2 引入资源时，可以借鉴这套"**foundation 一次性生成 + control docs 可编辑**"的分层。control docs 的"作者随时改、planner 每章读"模式，是把作者 steering 权交还的好设计。

### 3.2 Phase 1..N：Per-Chapter Pipeline（每章 7 阶段）

入口：`PipelineRunner.writeNextChapter()`（`runner.ts:1476`）。这是 inkos 最核心的设计。

#### Stage 1 — 输入治理（Plan → Compose）

这是 inkos v2 的"input governance"层，**把"控制输入"与"writer 的 prompt"分离**。

- **Planner**（`agents/planner.ts:76`，temp 0.7）读取：author_intent、current_focus、story_frame、volume_map、chapter_summaries、book_rules、current_state、pending_hooks、memory.db。产出 `ChapterMemo`（YAML frontmatter + 7 段 markdown）和 `ChapterIntent`（goal / mustKeep / mustAvoid / styleEmphasis）。**关键：memo 中显式列出本章的 Hook account——本章要 `open` / `advance` / `resolve` 哪些伏笔**。

- **Composer**（`agents/composer.ts`，**无 LLM，确定性**）读取所有真相文件，做相关性筛选（Hook 债务、POV 过滤、时效），产出：
  - `context.json`（选中的上下文片段 + 原因）
  - `rule-stack.yaml`（4 层规则栈：全局硬事实 > book rules > author intent > current task，带显式 override 边）
  - `trace.json`（哪些文件被读了的审计 trail）

#### Stage 2 — Writer（temp 0.7）

`WriterAgent.writeChapter()`（`agents/writer.ts`）拿到的不是原始真相文件，而是 Composer 装配好的 context package。Writer 内部会输出 pre-write self-check（上下文/资源/Hook/风险），生成正文，产出 post-settlement 表（状态变化），**并在内部串行跑 Observer + Settler**。

#### Stage 3 — 状态结算（Observer → Settler）

- **Observer**（temp 0.5）：从正文中**过提取** 9 类事实（角色/地点/资源/关系/情绪/信息/Hook/时间/物理状态）。
- **Settler/Reflector**（temp 0.3）：产出 JSON `RuntimeStateDelta`（不是完整 markdown 重写）。
- Delta 通过 `applyRuntimeStateDelta()`（`state/state-reducer.ts:25`）应用——**应用前 + 应用后双重 Zod 校验**，非法数据直接拒绝。校验项：章节单调性（不允许回写）、summary 不重复、Hook 准入治理（重复家族合并）。

#### Stage 4 — 长度归一化（条件触发）

仅在字数越过 hard range 时单次压缩/扩写。安全网：修订若砍掉 >75% 原文则拒绝。

#### Stage 5 — Audit ⇄ Revise 循环

`runChapterReviewCycle()`（`pipeline/chapter-review-cycle.ts:44`）。

- **ContinuityAuditor**（`agents/continuity.ts`，temp 0.3）：对 7 份真相文件做 LLM 审计，最多 **33 个维度**——OOC、时间线、设定冲突、力量缩放、数值一致性、Hook 核对、节奏、风格、信息边界、词汇疲劳、激励链、配角能力、回报稀释、对话真实性、纪事漂移、POV 一致性、段落均匀度、套路密度、公式化反转、副线停滞、弧线平坦……
- **AI Tells 检测** / **敏感词** / **Post-write validator**（11 条确定性硬规则 + 跨章重复检测 + 段落形状漂移）。
- 通过阈值：score ≥ 85 且无 critical 且字数在区间内。
- 未通过：**Reviser**（`agents/reviser.ts`，temp 0.5）拿 issue 列表修订，5 种模式：`spot-fix` / `polish` / `rewrite` / `rework` / `anti-detect`。默认重试 1 次。
- **最高分回滚**（`chapter-review-cycle.ts:294`）：循环内追踪每轮分数快照，如果修订反而变差，回滚到最高分版本。

#### Stage 6 — 真相持久化 + 校验

`validateChapterTruthPersistence()`（`pipeline/chapter-truth-validation.ts`）让 `StateValidatorAgent` 把 settler 输出与旧真相文件交叉校验。**失败时章节存为 `state-degraded`，不丢弃**，需要 `inkos repair-chapter-state` 重跑 settlement 才能继续——避免数据丢失，同时阻塞错误前传。

`persistChapterArtifacts()`（`pipeline/chapter-persistence.ts`）落：章节 md + 真相文件（md + JSON）+ SQLite memory 索引 + chapter index + 状态快照 + webhook。

#### Stage 7 — 后置检查
Hook 提升扫描（纯 ledger 解析，无 LLM）+ 段落形状漂移 + 长跨度疲劳分析。

### 3.3 人审闸口

`inkos review list / approve / approve-all`。只有 `approved` 章节进 `--approved-only` 导出。

### 3.4 Rewrite / Rollback

`inkos write rewrite <chapter>` 还原该章之前的 snapshot，删除该章及之后所有章节，重跑流水线。Snapshots 在 `story/snapshots/`。

---

## 4. 七份真相文件（核心可迁移设计）

这是 inkos **最值得 narratox 借鉴**的部分。所有"长期一致性"依赖 7 份结构化真相文件作为**唯一事实源**：

| # | 文件 | 内容 | narratox 对应 |
|---|------|------|--------------|
| 1 | `current_state` | 世界事实：谁在哪、谁知道什么 | Phase 3 待建 |
| 2 | `pending_hooks` | **伏笔账本**（生命周期） | Phase 3 待建（已规划为 StoryEvent ledger） |
| 3 | `chapter_summaries` | 每章情节/角色/事件/状态变化摘要 | 无（章节只有 `Chapter.content`） |
| 4 | `character_matrix` | 角色关系 + 信息边界（谁见过谁、谁知道什么） | Phase 2 规划（characters resource） |
| 5 | `particle_ledger` | 资源经济（物品/金钱/力量等级，带衰减公式） | 未规划 |
| 6 | `subplot_board` | A/B/C 副线状态 + 停滞检测 | 未规划 |
| 7 | `emotional_arcs` | 每角色情绪轨迹 | 未规划 |

**关键设计**：JSON 是 authoritative，markdown 是**投影**（regenerated from JSON）。这样既保留人类可读性，又避免 markdown 解析漂移。

> **narratox 启示**：Phase 3 的 `StoryEvent` ledger 不必从零设计，可以直接参考 `HookRecord` schema（见下一节）。但**不要**一上来做 7 份——优先级排序见第 11 节。

---

## 5. Hook 系统（伏笔是一等公民）

伏笔在 inkos 不是"作者脑里的东西"，而是**带生命周期的数据结构**（`models/runtime-state.ts:28`）：

```typescript
// 概念示意（非逐字抄录）
HookRecord {
  hookId, startChapter, type
  status: 'open' | 'progressing' | 'resolved' | 'deferred'
  expectedPayoff, payoffTiming:
    'immediate' | 'near-term' | 'mid-arc' | 'slow-burn' | 'endgame'
  halfLifeChapters    // 多少章后变陈旧
  dependsOn: []       // 依赖链
  coreHook: boolean   // 核心伏笔（不可遗忘）
  advancedCount       // 推进次数
  promoted            // 是否已从 seed 提升为正式
}
```

机制亮点：
- **Planner 每章显式承诺 Hook account**——本章要 open / advance / resolve 哪些 hook，写进 `ChapterMemo`。
- **准入治理**——新 hook 与现有 active hook 重叠时**合并**而非新增（防重复家族）。
- **提升逻辑**——seed 满足 `advancedCount` 阈值后自动 promote 为正式 hook。
- **半衰期**——超过 halfLifeChapters 未推进的 hook 触发告警。

> **narratox 启示**：这是 Phase 3 `StoryEvent` ledger 的**直接蓝图**。narratox 当前 chat → 采纳到章节的链路完全没有"伏笔"概念，长篇连载必然崩。建议 Phase 3 第一优先级。

---

## 6. RuntimeStateDelta（不可变状态变更契约）

inkos 的所有"真相变更"不走 CRUD，而走**单一 delta schema**（`models/runtime-state.ts:127`）：

```
RuntimeStateDelta {
  chapter
  currentStatePatch      // 世界状态补丁
  hookOps: []            // upsert / mention / resolve / defer
  newHookCandidates: []
  chapterSummary         // 本章 summary 行
  subplotOps, emotionalArcOps, characterMatrixOps
  notes
}
```

应用入口 `applyRuntimeStateDelta()`（`state/state-reducer.ts:25`）：
- **immutable update**（不原地改）
- **应用前 + 应用后双向 Zod 校验**
- 章节单调性、summary 唯一性、Hook 准入治理全部在这一层强制

> **narratox 启示**：narratox 当前的 `ResourceMutation { resource, targetId, op: 'set'|'append'|'patch', content }` 是这一模式的**原始雏形**。Phase 3 演进方向：
> - 从 untyped `content: string` → typed patches
> - 从单资源 → 跨资源 delta（一次采纳可同时更新 chapter + StoryEvent）
> - 双向校验目前只在 `ChapterHandler` 内部，应上移到 `ResourceRegistry` 层

---

## 7. 多温度分阶段（创作 vs 一致性分离）

不同 agent 跑不同 temperature，简单但有效：

| Agent | Temp | 角色 |
|------|------|------|
| Architect | 0.8 | 创意生成 |
| Writer | 0.7 | 创意生成 |
| Observer | 0.5 | 事实过提取 |
| FoundationReviewer | 0.3 | 评分 |
| Settler/Reflector | 0.3 | JSON delta（要准） |
| ContinuityAuditor | 0.3 | 审计 |
| Reviser | 0.5 | 修订 |

**核心洞察**：**创意环节给温度，一致性环节抢温度**。Writer 允许发散，Settler/Auditor 必须精确。

> **narratox 启示**：narratox 当前 `DeepAgentService` 单 agent 单温度。**不必立刻拆成 10 个 agent**，但 Phase 2/3 可以在 `ContextAssembler` 中为不同子任务（如"提取本章事件"vs"提议下一章情节"）用不同 system prompt + 不同 temperature 调用——用 deepagents 的 multi-step 能力做轻量分阶段。

---

## 8. 输入治理（Plan → Compose → Write）

inkos v2 的 input governance 是它区别于其他 AI 写作工具的关键：

- **Planner** 决定"写什么"（control input）
- **Composer** 决定"writer 看到什么"（context window 编译）
- **Writer** 只看到 composer 装配好的包，**看不到原始真相文件**

`rule-stack.yaml` 用 4 层优先级 + 显式 override 边（`L4 current_task 可覆盖 L3 planning 但不可覆盖 L1 hard_facts`）解决冲突。

> **narratox 启示**：narratox 的 `ContextAssembler` 当前是 Phase 1 lite 版本（只塞 title/genre/synopsis/worldview/style 进 system prompt）。Phase 2 演进方向：
> - 加**相关性筛选**——按当前章节窗口选真相片段，而不是全量塞
> - 加**装配审计**——记录"哪些上下文进了 prompt"，便于调试
> - rule-stack 复杂度**暂不需要**——narratox 是人机协作，冲突由作者裁决

---

## 9. 其他值得借鉴的设计

| 设计 | 价值 | narratox 适用性 |
|------|------|----------------|
| **最高分回滚**（review cycle） | 修订反而变差时回到最高分版本 | 中：Phase 3 审计循环可借鉴 |
| **state-degraded + repair-chapter-state** | 状态结算失败不丢稿，阻塞前传 | 高：Phase 3 必备 |
| **Genre profiles**（15 个） | 每题材一套规则/禁忌/审计维度 | 低：先做 1 个通用 |
| **SQLite temporal memory** | 时序事实查询（"第 5 章时 X 知道什么"） | 中：Postgres + LangGraph checkpointer 已覆盖大部分 |
| **Anti-AI-tells 层** | 检测 LLM 味词汇/句式/段落均匀度 | 中：可作为后续 polish 功能 |
| **Control docs as markdown** | 作者随时改、planner 每章读 | 高：narratox workspace 已有编辑能力 |
| **短篇独立闭环** | 不需要真相系统就能跑通 | 高：低成本功能扩展方向 |

---

## 10. 与 narratox 现状对照

| inkos 概念 | inkos 实现 | narratox 现状 | narratox 落点 |
|-----------|-----------|--------------|--------------|
| Foundation | Architect + FoundationReviewer + 5 类 md | Novel 表 + 用户手填 synopsis/worldview | Phase 2：outline/characters/worldview 资源 |
| Control docs | author_intent.md / current_focus.md | Novel.settings JSON | Phase 2：拆分长期/近期 steering |
| Planner | ChapterMemo + Hook account | 无（chat 直接驱动） | Phase 3：每章规划步骤 |
| Composer | 确定性 context compile + rule-stack | ContextAssembler（lite） | Phase 2/3：扩相关性筛选 |
| Writer | temp 0.7 单独 agent | DeepAgentService（单 agent） | 保持 |
| Settler | temp 0.3 输出 RuntimeStateDelta | 无（采纳即复制文本） | Phase 3：核心补全 |
| Audit ⇄ Revise | 33 维 + 5 模式 + 最高分回滚 | 无 | Phase 3 可选 |
| Truth files | 7 份（JSON authoritative） | 无 | Phase 3：优先 Hook + Chapter summary |
| Hook ledger | HookRecord 完整生命周期 | 无 | Phase 3：StoryEvent ledger 蓝图 |
| Mutation | RuntimeStateDelta（typed patch） | ResourceMutation（untyped content） | Phase 2/3 演进 |
| Human gate | ready-for-review → approved | 采纳即定稿（DRAFT/COMMITTED） | 可选演进 |
| Snapshot / Rollback | 每章 snapshot | 无 | Phase 3 长篇必备 |

---

## 11. 对 narratox 的具体建议（按优先级）

### P0 — Phase 3 之前必做（长篇一致性基础）

**11.1 引入 Chapter Summary 作为第二份真相文件**
- inkos 的 `chapter_summaries.json` 是所有长期一致性的**根**——没有它，后续 Hook ledger、character matrix 都没有 join 锚点。
- narratox 落地：在「采纳到本章」时，**异步**调用一次 LLM 提取本章 summary（角色出场/情节节点/状态变化/埋下的伏笔），存为新表 `ChapterSummary`。
- 不阻塞作者主流程，背后跑。
- 这是 Phase 3 ledger 的前置依赖。

**11.2 把伏笔（Hook）做成一等公民**
- 直接借鉴 inkos `HookRecord` schema（status / payoffTiming / halfLife / dependsOn / coreHook）。
- 数据来源：上一步的 chapter summary 提取 + 作者手动登记。
- UI：Phase 1 workspace 左栏已有 P2/P3 占位的"伏笔"区，可在此处展开为列表视图。
- 不需要 inkos 的"准入治理 / 提升逻辑"等高级特性——先做读模型。

### P1 — Phase 2 资源建模（已在路线图）

**11.3 Outline / Characters / Worldview 资源化**
- **Outline**：借鉴 inkos 的 `volume_map.md` 分卷结构 + webnovel-writer 的 CBN/CPN/CEN 节点设计（见 webnovel-writer 参考文档）。
- **Characters**：参考 inkos `character_matrix` 的"关系 + 信息边界"模型，不止是角色卡。
- **Worldview**：参考 inkos `story_bible` / `book_rules` 二分——世界观是设定，规则是禁忌。
- **接入点**：新增 `ResourceHandler` 实现 + 左栏 nav section + 右栏 detail pane（CLAUDE.md 已写明扩展缝）。

**11.4 Control docs 拆分**
- 当前 `Novel.settings` 是一个 JSON blob。
- 拆为：`author_intent`（长期，少改）+ `current_focus`（近期，常改）+ `style_guide`（写作方法论）。
- Planner 等价的环节（如 ContextAssembler）每次都读 current_focus，每次都把 author_intent 作为基调。

### P2 — 架构演进（按需）

**11.5 Mutation 层从 untyped → typed**
- 当前 `ResourceMutation.content: string` → 演进为联合类型（`ChapterAppendMutation | HookResolveMutation | ...`）。
- 双向校验目前只在 `ChapterHandler`，应**上移到 `ResourceRegistry`**——所有 handler 共享校验。
- 一次"采纳"可以同时触发多资源变更（如：采纳到章节 + 同时 resolve 一个 hook）。

**11.6 单 agent → 轻量分阶段**
- **不要**照搬 inkos 10-agent。
- 但可以借鉴"创作 vs 一致性分离"：用 deepagents 的 multi-step 能力，给"事件提取 / 下章提议 / 风格 polish"用不同 system prompt + 不同 temperature。
- 第一步：在「采纳到本章」之后串一个低温度的"事件提取 step"（对应 inkos Observer + Settler）。

**11.7 Chapter status 演进**
- 当前 `DRAFT | COMMITTED` → 可演进为 `DRAFT | COMMITTED | READY_FOR_REVIEW | APPROVED`。
- 或者保持简单：保持"采纳即审"语义（narratox 是人机协作，作者采纳就是审过）。
- 建议后者——不要为 review 流程增加摩擦。

### P3 — 后续可选

- **短篇独立闭环**：低成本功能扩展，不需要真相系统。
- **Genre profiles**：从通用规则开始，等用户多了再做题材分型。
- **Anti-AI-tells**：作为 polish 功能，低优先级。

---

## 12. 不建议照搬的部分

| inkos 设计 | 不照搬原因 |
|-----------|-----------|
| 完整 10-agent 流水线 | narratox 定位是人机协作 copilot，不是 autonomous writer；照搬会改产品定位 |
| SQLite memory.db | narratox 已用 Postgres + LangGraph checkpointer（agent_memory schema），覆盖了时序需求 |
| 15 个 genre profiles | 从一个通用 profile 开始，等需要再分型 |
| TUI（Ink/React 终端 UI） | narratox 是 Web 工作区 |
| 文件系统作为主存储 | narratox 已用 Prisma + Postgres，关系模型更适合多用户 |
| rule-stack.yaml 4 层优先级 | narratox 是人机协作，冲突由作者裁决，不需要形式化优先级 |

---

## 13. 一页纸总结

narratox 应该向 inkos 学**方法论**，不学**架构**：

1. **真相文件是唯一事实源**（JSON authoritative + markdown 投影）——Phase 3 必备，从 chapter summary + hook ledger 两份开始。
2. **伏笔是一等公民**（HookRecord 生命周期）——直接作为 `StoryEvent` ledger 蓝图。
3. **创作与一致性分离**（温度分层 + prompt 分层）——用 deepagents multi-step 做轻量版本，不必拆 10 agent。
4. **不可变 delta + 双向校验**——`ResourceMutation` 演进方向：untyped → typed，校验上移到 Registry。
5. **作者 steering 通过 control docs**（author_intent / current_focus 二分）——Phase 2 拆 `Novel.settings`。

**但保持 narratox 的"人机协作"定位**：
- 不要做 autonomous writer（那是 inkos）
- 不要做 33 维审计（copilot 不需要）
- 不要做 ready-for-review 强闸口（采纳即审）

把 inkos 当**长篇一致性工程的参考实现**，而非产品范本。

---

## 附：关键文件索引（如需深入查阅 inkos 源码）

- 流水线引擎：`packages/core/src/pipeline/runner.ts`（`initBook:612` / `writeNextChapter:1476`）
- 章 review 循环：`packages/core/src/pipeline/chapter-review-cycle.ts:44`
- 真相持久化：`packages/core/src/pipeline/chapter-persistence.ts`
- Agents：`packages/core/src/agents/{architect,planner,composer,writer,continuity,reviser,foundation-reviewer,post-write-validator}.ts`
- 状态管理：`packages/core/src/state/{manager,state-reducer,state-validator,memory-db}.ts`
- 数据模型：`packages/core/src/models/{book,chapter,runtime-state,input-governance,project}.ts`
- 题材规则：`packages/core/genres/*.md`
- 短篇闭环：`packages/core/src/pipeline/short-fiction-runner.ts:90`
- NL agent 模式：`packages/core/src/agent/{agent-session,agent-tools,agent-system-prompt}.ts`
- 架构文档：`docs/ARCHITECTURE.md`、`CLAUDE.md`、`README.md`
