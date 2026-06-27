# validator 细纲兑现校验设计(Phase 9)

> 日期:2026-06-27 · Phase 9 · 关联 [2026-06-27-writer-chapter-continuity-design.md](./2026-06-27-writer-chapter-continuity-design.md) · 为 Phase 10(大纲改写回馈)埋触发点

## 问题诊断

Phase 8 架构审视核查出:大纲写完即冻结,**计划与正文之间没有任何自动对账**。根因有二,都落在 validator:

1. **validator 读不到细纲。** 它的工具是 `[get_chapter, get_character, get_characters, query_memory, report_review]`([agent-tree.config.ts:131-139](../../../server/src/agentos/agent-tree.config.ts#L131))——**没有 `get_chapter_plan`**。全家 main / writer / outline-critic 都有,唯独审计员没有。
2. **11 维里没有「细纲兑现」。** validator 审人物/设定/战力/伏笔/逻辑/文风/长度/爽点/钩子/AI味/作者声音,但**没有一维是「正文是否兑现了本章 CBN/CPNs/CEN/mustCover、是否触碰 forbidden」**。

净效果:writer 写偏了细纲,审计员既看不到计划、也无维度查对账——**大纲冻结、写偏无人查**。这正是「长篇大纲与正文脱节」的根因。

## 目标

给 validator 读细纲的能力 + 加第 12 维「细纲兑现」。兑现校验**区分两类偏离**,为 Phase 10(大纲改写回馈)埋触发点:

- **章节未兑现**(mustCover 遗漏 / 触碰 forbidden / CBN·CPNs·CEN 骨架严重缺失)→ **blocking**(章节问题,驱动既有修订闭环改章)。
- **细纲过时**(正文走向优于原细纲,或原细纲本身有误/过时,但章节本身没问题)→ **note**,并在 issue 里**明确标「细纲过时,建议改写细纲」+ 说明实际走向**,供编排者决定是否委派 outliner 改写(Phase 10 走改写路线,本 Phase 不做改写)。

**纯配置 + prompt 改动,零 DB / 零 FE / 零新 agent / 零新工具**(复用现有 `get_chapter_plan`)。

## 设计

### 改动一:validator 工具 += get_chapter_plan

[agent-tree.config.ts](../../../server/src/agentos/agent-tree.config.ts) 的 validator spec,tools 从

```
['get_chapter', 'get_character', 'get_characters', 'query_memory', 'report_review']
```

改为

```
['get_chapter', 'get_chapter_plan', 'get_character', 'get_characters', 'query_memory', 'report_review']
```

(顺序:读正文 → 读细纲 → 查角色 → 查记忆 → 出报告。与 writer 的细纲工具对齐。)

### 改动二:VALIDATOR 加「细纲兑现」维度(dim 12)

**不重编号**——dim 1 内有「世界力量体系层面的越级归 dim 3」交叉引用([agent-prompts.ts:205](../../../server/src/agentos/agent-prompts.ts#L205)),重编号会打断它。故**追加为 dim 12**,并把「11 维」改「12 维」。

① 开篇行加 `get_chapter_plan`:
```
你是小说质检员。用 get_chapter 读本章正文,用 get_chapter_plan(N) 读本章细纲,用 get_characters/get_character 查角色档案,用 query_memory 查已有设定/伏笔。
```

② 「按以下 11 维」→「按以下 12 维」。

③ 追加 dim 12(置于 dim 11 之后、report_review 指令之前):
```
12. 细纲兑现——【先 get_chapter_plan(N) 读本章细纲(CBN/CPNs/CEN + 必须覆盖/禁区),再对照本章正文逐项核】:
   · 必须覆盖(mustCover)有遗漏 → blocking(章节未兑现计划的核心点)。
   · 触碰禁区(forbidden)→ blocking。
   · CBN/CPNs/CEN 节点严重缺失(开篇/情节/结尾骨架没写)→ blocking。
   · 正文走向优于原细纲、或原细纲本身已过时/有误(计划与实际脱节但章节没问题)→ note,并在 issue 里【明确标「细纲过时,建议改写细纲」+ 说明实际走向】,供编排者决定是否委派 outliner 改写(走改写路线,不在此改)。
```

### 与 Phase 10 的衔接

dim 12 的「细纲过时」note 是 Phase 10(#2 大纲改写回馈)的**触发信号**:validator 不改大纲(那是 outliner 的活),只把「细纲过时 + 实际走向」标清楚;Phase 10 让 CHAPTER_ORCH 把它带回主 agent → 委派 outliner 改写。本 Phase 只埋点,不做改写闭环。

## 改动面

| 文件 | 改动 |
|---|---|
| [server/src/agentos/agent-tree.config.ts](../../../server/src/agentos/agent-tree.config.ts) | validator.tools += `get_chapter_plan` |
| [server/src/agentos/agent-prompts.ts](../../../server/src/agentos/agent-prompts.ts) | VALIDATOR 开篇行加 get_chapter_plan + 「11 维」→「12 维」+ 追加 dim 12「细纲兑现」 |
| [server/src/agentos/agent-tree.config.spec.ts](../../../server/src/agentos/agent-tree.config.spec.ts) | 防回归快照 validator tools 加 `get_chapter_plan` + 新增正向断言 |

**不碰**:DB、FE、新工具、新 agent、大纲改写闭环(Phase 10)、get_chapter_plan 工具本身、其它 agent。

## 显式不做(non-goals)

- **不改大纲。** validator 是审计员不是改纲员;「细纲过时」只标记,改写走 outliner(Phase 10)。本 Phase validator 不触发任何大纲写入。
- **不加 get_outline。** 单章兑现只需 `get_chapter_plan(N)`(CBN/CPNs/CEN/mustCover/forbidden);卷级上下文非兑现所必需,暂不加(后续若 validator 要看卷弧线再补)。
- **不做自动改写闭环。** 「细纲过时 → outliner 改写」的编排是 Phase 10 的事;本 Phase 只把信号产出到位。
- **不重编号 dim 1-11。** 保护 dim 1 内「归 dim 3」交叉引用;新维度追加为 dim 12。

## 测试

1. **agent-tree.config.spec.ts**:更新防回归快照的 validator tools(加 `get_chapter_plan`);新增正向断言「validator 含 get_chapter_plan」(把意图写进测试)。
2. **agent-prompts.ts**:dim 12 无现有内容断言(项目惯例不测 prompt 文本);自由追加。
3. **回归**:全量 `pnpm test`(server 单元套)不回归;`pnpm typecheck` 过。

## 验证未覆盖

- 单测只验证「validator 拿到工具 + dim 12 文本写到位」。**实际能否抓出「写偏细纲」、能否准确区分「章节未兑现」vs「细纲过时」**取决于模型——需活 E2E(配模型 + DB,写一章偏离细纲的看 validator 是否报 blocking / 标细纲过时)。本期不强制。
