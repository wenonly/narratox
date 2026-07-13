---
date: 2026-07-13
title: 删除大纲/世界观 orchestrator + writer,能力合并给 main,critic 保留为独立子 agent
status: draft
---

# 删除大纲 + 世界观 agent — 设计

## 背景

当前 `AGENT_TREE` 的 `outliner` 和 `worldbuilder` 两棵子树结构完全平行:各有一个 orchestrator(只做路由 + 委派,价值薄)+ writer(产)+ critic(审)。`main` 通过 `task` 委派建大纲/建世界观。

问题:① 结构过度嵌套,orch 节点几乎只是转发;② main 作为编排者反而无法直接控制大纲(长篇北极星)和世界观(故事公理)这两件最关键的事——这两件应该 main 亲自抓;③ prompt 方法论分散在 writer/critic 两个文件里,维护成本高。

Phase 9/10/18/20 在 outline-writer/critic 沉淀了大量方法论(结局先定 / 力量曲线 / 暗线 reveal / 三幕灵魂黑夜 / 单元循环 5 拍 / 弧-卷范围约束 / 6 维质检),worldbuilder-writer/critic 沉淀了力量体系五字诀 + 核心 N 件套 + 6 维 KB-grounded 评审——都不能丢。

## 目标

1. **删除 outliner orchestrator + outline-writer + worldbuilder orchestrator + worldbuilder-writer** 四个节点(共 4 个 prompt + 4 个 export + 4 条 spec)
2. **能力合并给 main** —— 写/删/patch 工具 + KB 拉取 + query_memory 全部下沉到 main.tools
3. **outline-critic + wb-critic 各自作为独立子 agent 保留** —— 直接挂 main 下(不再有父 orch),保留各自 6 维结构化质检 + `report_outline_review` / `report_worldview_review`,作为长篇结构硬闭环
4. **方法论保留** —— 蒸馏进 main.md(producer 视角);两个 critic.md 文件基本不动(reviewer 视角,与 producer 解耦)
5. **零 DB 迁移 / 零 FE 改动** —— `describeTree` / `buildAgentGroups` 自动派生

## 非目标

- 不动 curator / character 两棵子树(本期只动 outline + worldbuilder)
- 不动 DISSECT_TREE
- 不动 FE
- 不动 schema
- 不动 TOOL_REGISTRY(所有工具仍注册,只是路由变)

## 架构

### AGENT_TREE 变化

**删**:`AGENT_TREE.subagents` 里的 `outliner` 子树(含 outline-writer / outline-critic)和 `worldbuilder` 子树(含 wb-writer / wb-critic)。

**加**:两个独立 subagent 直接挂 main 下 —— `outline-critic` + `wb-critic`。

```
main
  ├─ chapter (writer → settler → validator)
  ├─ curator
  ├─ outline-critic   ← 新位置:独立子 agent,无父 orch
  ├─ wb-critic        ← 新位置:独立子 agent,无父 orch
  └─ character (char-writer → char-critic)
```

### main.tools 新增(共 15 个)

```
大纲写:set_master_outline, set_volume, set_arc, set_chapter_plan, patch_chapter_plan
大纲删:delete_chapter_plan, delete_volume, delete_arc, clear_master_outline
世界观写:set_world_entry
KB:list_knowledge, get_knowledge
复盘:query_memory, report_outline_review, report_worldview_review
```

`report_outline_review` / `report_worldview_review` 保留在 main.tools —— 极少数场景下 main 可主动跑结构化自检(常态走 critic 子 agent)。

### outline-critic 节点定义(不变)

```ts
{
  name: 'outline-critic',
  description: '大纲质检员(6 维结构化评审 + 总纲自检)。建大纲后 main 自动委派;改大纲后作者可选委派;作者主动要审也可委派。调 report_outline_review 给 passed/score/blockingIssues。',
  promptKey: 'OUTLINE_CRITIC',
  modelTier: 'short',
  recommendedTier: 'strong',
  tools: ['get_outline', 'get_chapter_plan', 'get_novel_info', 'get_worldview', 'get_world_entry', 'query_memory', 'report_outline_review'],
}
```

### wb-critic 节点定义(不变)

```ts
{
  name: 'wb-critic',
  description: '世界观质检员(6 维 KB-grounded 评审)。建世界观后 main 自动委派;改世界观后作者可选委派;作者主动要审也可委派。调 report_worldview_review 给 passed/score/blockingIssues。',
  promptKey: 'WB_CRITIC',
  modelTier: 'short',
  recommendedTier: 'strong',
  tools: ['get_worldview', 'get_world_entry', 'get_novel_info', 'report_worldview_review'],
}
```

两个 critic 的 tools 与原 AGENT_TREE 里的对应节点**完全一致** —— 只是父节点从 orch 换成 `main`。两个 critic.md prompt 文件**不动**(其内容是 reviewer 视角,对"谁产的"无依赖)。

## critic 三档触发模型(outline-critic + wb-critic 同构)

| 场景 | 触发方式 | 流程 |
|---|---|---|
| **建大纲 / 建世界观**(首次/重建全本) | **自动** | main 跑完 set_* 链 → task 委派对应 critic → critic 调 report_*_review → 若 blocking 非空 → main 修订 1 轮(只改被点名条目/卷/章,set_* upsert)→ 复评 1 次 → 留最后结果(不回滚) |
| **改大纲 / 改世界观**(patch / delete / 局部 set) | **建议** | main 改完停下问作者"要不要让 X-critic 审一下" → 作者确认才委派 → 同上 blocking 闭环 |
| **作者主动要审**(作者说"审一下大纲/世界观") | **手动** | main 直接 task 委派对应 critic |

## Prompt 改动

### 删除

- `server/src/agentos/prompts/outliner-orchestrator.md`
- `server/src/agentos/prompts/outline-writer.md`
- `server/src/agentos/prompts/worldbuilder-orchestrator.md`
- `server/src/agentos/prompts/worldbuilder-writer.md`

### 保留(不动)

- `server/src/agentos/prompts/outline-critic.md` —— reviewer 视角,内容不依赖 producer 是谁
- `server/src/agentos/prompts/worldbuilder-critic.md` —— 同上

### 蒸馏 + 改写:`main.md`

main.md 新增/改动如下节(其余节维持):

**新增【建世界观 SOP】节**(约 15-20 行)。核心要点(蒸馏自 worldbuilder-writer.md):

- 取上下文:`get_novel_info`(故事核) + `list_knowledge`/`get_knowledge`(取"设定三技·人物·世界观·金手指""大纲范例集锦"+ 题材公式)
- 第 1 步 建核心三件 `set_world_entry`:**concept**(总览:世界背景/基调)、**powerSystem**(力量体系:等级/上限/代价/来源 + 每级获得什么)、**rule**(规则/禁忌/铁律/不可为)
- 第 2 步 按题材补 `set_world_entry`:location / faction / race / item / history(每条 content 几百字、有细节、能撑住后续写作,不空泛堆砌)
- 力量体系/金手指遵循 **KB 五字诀**:唯一 / 可升级 / 有限制(不能一开始太强,否则后期崩文)/ 保密(书中无人知)/ 简单明了;核心是「能升级」而非「多强大」
- 第 3 步 **必跑自检**:`task wb-critic` 委派,等其调 `report_worldview_review` 返回 passed/score/blockingIssues
- 第 4 步 修订(最多 1 轮):若 blocking 非空,只 `set_world_entry` 改被点名条目,不全推重建 → 复评一次 → 留最后结果

**新增【建大纲 SOP】节**(取代原"委派 outliner"路径,约 30-40 行)。核心要点(蒸馏自 outline-writer.md):

- 取上下文:`get_novel_info`(故事核) + `get_worldview`/`get_world_entry`(世界观对齐,核心是 powerSystem 锁战力) + `list_knowledge`/`get_knowledge`(取"大纲范例集锦""情节伏笔铺垫节奏"+题材公式)
- 第 1 步 立总纲 `set_master_outline`:theme / mainLine / ending(结局先定,倒推铺垫)/ powerProgression(每卷一档,**必须与世界观 powerSystem 一致**,锁战力崩坏)/ hiddenLines(暗线埋-推-揭时刻表,长篇发动机)/ volumeSplitLogic / threeAct(act1Turn 建立对抗 / act2Turn 灵魂黑夜 / act3Turn 解决,atVolume 单调递增)
- 第 2 步 分卷 `set_volume×N`:全书所有卷(覆盖从头到尾,长篇 3-6 卷),每卷带 bridge / mainProgress;金手指节奏与 powerProgression 一致
- 第 3 步 分弧 `set_arc×N` 逐卷:**严格在本卷 chapter 范围内**分弧,每弧 4-10 章,弧 goal 带幕节奏(派生自 threeAct + 卷);每弧按单元循环 5 拍设计(麻烦→尝试→意外→解决→成长)
- 第 4 步 建细纲 `set_chapter_plan×N`:前 20-30 章,每章 CBN+CPNs+CEN+mustCover+forbidden,单元循环 5 拍对齐(CBN=麻烦/CPNs=尝试+意外/CEN=解决+章末钩)
- 第 5 步 **必跑自检**:`task outline-critic` 委派,等其调 `report_outline_review` 返回 passed/score/blockingIssues
- 第 6 步 修订(最多 1 轮):若 blocking 非空,只改被点名卷/章(`set_volume`/`set_chapter_plan`/`patch_chapter_plan` upsert),不全推重建 → 复评一次 → 留最后结果

**新增【补细纲 / 改写细纲】节**(Phase 9/10 反馈回路):

- **补细纲**(写到边界、某章无细纲):`get_outline` 看卷骨架 + nextChapterOrder → `get_chapter_plan` 读紧邻前几章 CEN → `query_memory` 查开放伏笔 → `set_chapter_plan×N` 批次往下承接 → 改完【建议】作者让 outline-critic 审
- **改写细纲**(正文偏离原细纲,validator dim 12 标 note):先 `get_chapter_plan(N)` 读旧细纲 → `get_chapter(N)` 读实际正文(正文是实)→ `set_chapter_plan(N)` 或 `patch_chapter_plan(N)` 改到与实际一致 → 核查 N+1.. 下游(`get_chapter_plan`),依赖旧走向、现已断层的承接改写 → 改完【建议】作者让 outline-critic 审

**新增【改世界观 / 改大纲】节**(通用指导,配合三档触发模型):

- 微调/字段级改 → `set_world_entry` upsert 或 `patch_chapter_plan` / `set_volume` / `set_arc` 直接改 → 改完停下问作者"要不要让对应 critic 审一下"
- 大改(整条力量体系重做 / 整卷重写)→ 走对应 SOP 第 1-N 步 + 自动 critic 自检
- 删除(`clear_master_outline` / `delete_volume` cascade 等)→ 危险操作,**先问作者确认**;删完按改动幅度决定是否建议 critic 审

**改【委派协议】节**:删掉原 `outliner: ...` 和 `worldbuilder: ...` 两节。保留 chapter / character / curator 三条。

**改【铁律】节**:
- 原:"不自己写正文/设定/大纲/角色;不自己串 writer-settler-validator(那是 chapter 的活)"
- 新:"不自己写正文/角色;**大纲/世界观由你直接建/改**(set_master_outline/set_volume/set_arc/set_chapter_plan/set_world_entry 等);不自己串 writer-settler-validator(那是 chapter 的活)"
- 原:"不要自己 set_world_entry/set_volume/set_chapter_plan/set_arc/set_character——那些是各子 agent 的活"
- 新:"不要自己 set_character——那是 character 的活"

**改【建置流水线】节**:原 curator → worldbuilder → outliner → character 的链条,改为:
- curator 建完 → 停:"参考资料建好了。建议下一步建世界观。"
- **main 自建世界观 → main 委派 wb-critic 自检** → 停:"世界观建好了(N 条,score X)。建议下一步建大纲。"
- **main 自建大纲 → main 委派 outline-critic 自检** → 停:"大纲建好了(N 卷 M 弧 K 章细纲,score X)。建议下一步建角色。"
- character 建完 → 停:"角色档案建好了(N 个,score X)。建议开始写第 1 章。"

**改【写作 ACTIVE】节**:原"第 N 章无细纲先委派 outliner 补,再写。validator 报细纲过时→委派 outliner 改写" 改为:"第 N 章无细纲先自己补(set_chapter_plan),再写。validator 报细纲过时→你自己在下一轮改写(set_chapter_plan/patch_chapter_plan)。"

### 改:`main-role-reminder.md`

原文:
> 正文/设定/大纲/角色 一律 task 委派。

改为:
> 正文/角色 一律 task 委派；**世界观/大纲 你直接建/改,建后必委派对应 critic(wb-critic / outline-critic)自检**。

### 微调:`chapter-orchestrator.md`

第 24 行:
> 让主 agent 据此委派 outliner 改写。

改为:
> 让主 agent 据此在下一轮直接改写细纲。

### 微调:`validator.md`

第 33 行:
> 供编排者决定是否委派 outliner 改写(走改写路线,不在此改)。

改为:
> 供主 agent 决定是否在下一轮直接改写细纲(走改写路线,不在此改)。

## 代码改动清单

| 文件 | 改动 |
|---|---|
| `server/src/agentos/agent-tree.config.ts` | PROMPTS map 删 `OUTLINER_ORCH` / `OUTLINE_WRITER` / `WB_ORCH` / `WB_WRITER` 四键(保留 `OUTLINE_CRITIC` / `WB_CRITIC`);AGENT_TREE 删 `outliner` + `worldbuilder` 两棵子树,在 `subagents` 加 `outline-critic` + `wb-critic` 两个独立节点;main.tools 加 15 个工具 |
| `server/src/agentos/agent-prompts.ts` | 删 `OUTLINER_ORCHESTRATOR_PROMPT` / `OUTLINE_WRITER_PROMPT` / `WORLDBUILDER_ORCHESTRATOR_PROMPT` / `WORLDBUILDER_WRITER_PROMPT` 四个 export(保留 `OUTLINE_CRITIC_PROMPT` / `WORLDBUILDER_CRITIC_PROMPT`) |
| `server/src/agentos/agent-prompts.spec.ts` | 删 OUTLINER_ORCH / OUTLINE_WRITER / WB_ORCH / WB_WRITER 四条 spec 行(保留 OUTLINE_CRITIC / WB_CRITIC) |
| `server/src/agentos/prompts/main.md` | 新增【建世界观 SOP】+【建大纲 SOP】+【补细纲/改写细纲】+【改世界观/改大纲】节;改【委派协议】+【铁律】+【建置流水线】+【写作 ACTIVE】节 |
| `server/src/agentos/prompts/main-role-reminder.md` | 修"一律 task 委派"那行 |
| `server/src/agentos/prompts/chapter-orchestrator.md` | 微调第 24 行 |
| `server/src/agentos/prompts/validator.md` | 微调第 33 行 |
| 删除文件 | `server/src/agentos/prompts/outliner-orchestrator.md` / `outline-writer.md` / `worldbuilder-orchestrator.md` / `worldbuilder-writer.md` |

## 不变项

- `outline-critic.md` + `worldbuilder-critic.md` 文件内容不动(reviewer 视角,无 producer 依赖)
- `TOOL_REGISTRY` 不动(工具仍注册,只是路由变化)
- `describeTree` / `buildAgentGroups` / `buildAgentRoster` 三个派生函数不动(自动跟进)
- DB schema 不动
- FE 不动
- DISSECT_TREE 不动
- curator / character 两棵子树不动

## Phase 兼容性

- **Phase 9 validator dim 12**:完全保留。validator 仍标 note,只是回路终点从"main→outliner"变成"main 自己干"。
- **Phase 10 outline-rewrite feedback**:语义保留(正文是 ground truth,细纲去就实),执行路径变为 main 直接 set_chapter_plan。
- **Phase 18 MasterOutline**:`set_master_outline` 从 outline-writer 迁到 main,提示词方法论蒸馏进 main.md【建大纲 SOP】第 1 步。
- **Phase 20 三幕/单元循环**:同上,蒸馏进 main.md【建大纲 SOP】第 1 步(threeAct)+ 第 3 步(弧单元循环 5 拍)。
- worldbuilder 部分无独立 Phase 编号(散落在 Phase 4/5 的建置流水线描述里),方法论(五字诀 / 核心 N 件套 / 6 维评审)完整蒸馏进 main.md【建世界观 SOP】+ wb-critic.md(不动)。

## 风险与权衡

- **单轮工具数暴涨**:建一份完整大纲约 30-100 次工具调用落在 main 上下文;建世界观约 5-15 次。`recursionLimit: 500` 够用;summarization middleware 压缩早期 turn;Phase 19 的 get_outline 精简返回继续生效。**可接受**。
- **失去 writer 的聚焦上下文**:原架构 outline-writer / wb-writer 在 task 委派的独立 thread 里跑,产物隔离;合并后 main 上下文累积。**降低**:main 上下文有 Phase 14 MAIN_ROLE_REMINDER 每轮注入对冲 + summarization 自动压缩。
- **critic 不再硬闭环**:原架构 writer 返回后【绝对不能结束,必须 critic】是 prompt 强约束;现合并后靠 main.md SOP 节末"必跑自检"强语气约束。**降低**:用"必须 task 委派 critic 跑结构化自检"硬措辞 + MAIN_ROLE_REMINDER 每轮提醒"建后必委派 critic 自检",保留闭环精神。改场景的"建议"档承认是软约束(改动幅度小,可接受)。
- **建置阶段 main 不能停**:Phase 16 "一步一停" 的"一步"指宏观阶段(建世界观=一步/建大纲=一步),与多次工具调用不冲突;建完才停下问作者。**一致**。
- **世界观 → 大纲 跨阶段依赖**:`set_master_outline` 的 `powerProgression` 必须与 `powerSystem` 一致(【建大纲 SOP】第 1 步已明示"必须与世界观 powerSystem 一致")。原架构 wb-writer 和 outline-writer 在不同 thread 里跑,自然隔离;合并到 main 后,main 同时持有两者上下文,**反而更容易保持一致**(main 不必重新读 worldview,本就在它上下文里)。**改进,非回退**。

## 测试影响

- `agent-prompts.spec.ts`:删 4 条(OUTLINER_ORCH / OUTLINE_WRITER / WB_ORCH / WB_WRITER)
- 如 AGENT_TREE 有结构 snapshot 测试,需更新(检查测试代码确认)
- `buildAgentGroups()` 输出顺序变化(outline-critic 从 outliner 组里搬出、wb-critic 从 worldbuilder 组里搬出,各自成组),如有 snapshot 需更新
- `buildAgentRoster()` 输出变化(curator 的 agent 名单里 outliner / outline-writer / worldbuilder / wb-writer 消失,outline-critic / wb-critic 保留),如有 snapshot 需更新
- L1 集成测试(`test/smoke/l1-integration.spec.ts`):不影响(不涉大纲/世界观建/改路径)
- L2 scenario 脚本(`scripts/smoke/l2-scenario.ts`):onboarding 流程里建世界观 + 建大纲两步从"委派 worldbuilder/outliner"变为"main 直接干",trajectory 断言可能要改(tool 顺序里 no longer 出现 task→worldbuilder/outliner)

## 后续(本期不做)

- main 上下文 token 治理(Phase 19 已做的精简返回继续生效;如需进一步 trimming 留待后续)
- character 是否同样合并(本期明确不动)
