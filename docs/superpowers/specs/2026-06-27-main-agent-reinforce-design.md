# 主 agent 固化 + 全树提示词优化设计(Phase 14)

> 日期:2026-06-27 · Phase 14 · 关联 [架构文档](../../architecture/novel-writing-flow.md)(主/子 agent prompt 组装)

## 问题诊断

### A. 主 agent 职责被「稀释」(核心痛点)

`createAgent` 的 systemPrompt(MAIN)一直在消息列表顶部,`createSummarizationMiddleware` 压的是**对话历史**不碰 system prompt——所以职责文本没丢。但**稀释是真的**:几十轮 task 委派 + 工具结果把 MAIN 的相对注意力压下去,主 agent 渐渐偏向「照最近对话的样子做」——开始自己写正文、跳过 onboarding 顺序、忘了委派、忘了用【小说态势】决策。

根因:职责指令只在「最远处」(顶部 system),**没有「最近处」的强化**。

### B. MAIN prompt 结构陈旧

- CONCEPT + ACTIVE 两套指令堆一起,当前轮只一套适用却都要读;
- 「不写正文/自己是编排者」重复 3 遍;
- Phase 9-13 的细纲改写回馈 / 态势 是后贴的,没织进主流水线;
- 没把【小说态势】nextStep 当决策入口(Phase 13 加的 slice 没被主流水线用起来)。

### C. 委派协议不固化

子 agent **不继承 main 的 slice**,只靠 main 的 task 消息当上下文桥。但 MAIN 没规定「每类委派必带什么」→ task 消息质量随机,子 agent 缺关键上下文(如改章没附实际走向、outliner 不知道故事核)。

### D. 子 agent 提示词

- **writer**:最长(网文技法/去AI指纹/作者声音/...);**流程不前置**——「写前先 get_chapter_plan→读相邻章→get_character→get_arcs」该是 step 0,现在散在各段;长文本本身稀释它的核心「正文只走工具」。
- **validator**:12 维,Phase 7 角色一致 + Phase 9 细纲兑现是后贴的;未按重要性重排;step 0(先读 细纲+章+角色+事件)不醒目。
- **chapter 编排器**:writer→settler→validator 链清晰,但「委派 writer 时必传 N + 模式 + 要求」没固化。
- 共性:子 agent 看不到 slice,每个都该有统一醒目的 **step 0「先读什么」**。

## 目标

- **A(核心)**:每轮注入「职责提醒」system 消息,落在历史之后、最近处,固化主 agent 编排职责,对冲稀释。
- **B**:重构 MAIN——状态机驱动、态势优先、织入 Phase 9-13、去重。
- **C**:MAIN 固化「委派协议」(每类 task 消息必带信息)。
- **D**:writer/validator 流程前置 + 统一 step 0;chapter-orch 固化委派消息;轻触 settler/outliner。

## 设计

### A. 每轮职责提醒注入

`agent-prompts.ts` 新增常量 `MAIN_ROLE_REMINDER`(精简,~80 token):

```
【职责提醒】你是小说生成主 agent(编排者)。
- 正文/设定/大纲/角色 一律 task 委派对应子 agent(writer/settler/validator 由 chapter 编排器串;curator/worldbuilder/outliner/character 直接委派),【绝不】自己写。
- 每轮先看背景【小说态势】的 nextStep 决定委派谁:CONCEPT 按 curator→worldbuilder→outliner(含分弧)→character;ACTIVE 写/改章 → 委派 chapter;细纲过时/将尽 → 委派 outliner。
- 等子 agent 结论回来再继续;不要自己串 writer/settler/validator(那是 chapter 的活)。
```

`deep-agent.service.ts` 抽一个**纯函数** `buildTurnMessages(userMessage, userMessageId)` 返回:
```ts
[
  { role: 'system', content: MAIN_ROLE_REMINDER },
  { role: 'user', content: userMessage, id: userMessageId },
]
```
`runTurn` 改用它喂 `agent.stream`。旧的 reminder 进历史后被 summarization 压,不无限堆积;最新的一直在最近处。

### B. MAIN 重构(状态机 + 态势驱动)

新结构(替掉现有 MAIN_AGENT_PROMPT):
1. **角色**(一句):编排者,正文/设定/大纲/角色一律 task 委派,自己不产出。
2. **每轮第一步**:看【小说态势】nextStep → 决定委派谁(把态势 slice 用起来)。
3. **CONCEPT 流水线**(顺序铁):收集 7 项基础 → curator(参考)→ worldbuilder(世界)→ outliner(大纲+分弧)→ character(角色)→ 信息齐才转 ACTIVE 写正文。
4. **ACTIVE 流水线**:写/改/续/重写第 N 章 → 委派 chapter;validator 报「细纲过时」→ 委派 outliner 改写(accept-written-as-truth);【小说态势】显示细纲将尽 → 委派 outliner 补细纲。
5. **委派协议**(见 C)。
6. **铁律**:不自己写正文/设定/大纲/角色;不自己串 writer-settler-validator;每步 task 委派;等结论再续。
7. **读章定位**:用户说「这章/这里」→ get_reading_chapter 确认 chapterOrder 再委派。

### C. 委派协议(MAIN 内一节)

| 委派给 | task 消息必带 |
|---|---|
| chapter | 「写/改/续/重写第 N 章」+ 作者具体要求;改/重写附原因(如 validator 报的 blockingIssues / 实际走向) |
| outliner | 「建大纲 / 补第 M-N 章细纲 / 改写第 N 章细纲因偏离 X」+ 题材 + 故事核 |
| worldbuilder | 「建世界观」+ 题材 + 故事核 |
| character | 「建/丰富角色」+ 题材 + 故事核 + 已建世界观要点 |
| curator | 「建参考资料」+ 题材 + 简介 |

### D. 子 agent 优化

- **writer**:把【写前必读 step 0】提到最前——`get_chapter_plan(N)` → `get_chapter(N-1)`(改/续还读 N+1)→ `get_arcs`(当前弧)→ `get_character`(涉及角色);原 网文技法/去AI指纹/作者声音 各段保留但降为「写作要求」附录式。核心「正文只走工具、禁整章大替换」置顶。
- **validator**:step 0 醒目——`get_chapter_plan(N)` + `get_chapter(N)` + `get_characters` + 必要时 `get_events`;12 维按重要性重排(人物一致/设定·世界观/细纲兑现/战力/伏笔/逻辑 在前;文风/长度/爽点/钩子/AI味/作者声音 在后)。
- **chapter 编排器**:委派 writer 的指令清单显式要求「传 N + 模式(写/改/续/重写)+ 作者要求」;细纲过时信号(Phase 10)保留。
- **settler / outliner**:统一加 step 0(settler 先 get_chapter;outliner-writer 先 get_outline+query_memory),已有则确认醒目。

## 改动面

| 文件 | 改动 |
|---|---|
| `server/src/agentos/agent-prompts.ts` | 新增 `MAIN_ROLE_REMINDER`;重写 `MAIN_AGENT_PROMPT`(B+C);writer/validator 流程前置 + step 0(D);chapter-orch 委派消息固化(D);settler/outliner 轻触 |
| `server/src/agentos/deep-agent.service.ts` | 新增纯函数 `buildTurnMessages`;`runTurn` 改用 |
| `server/src/agentos/deep-agent.service.spec.ts`(新或扩) | 测 `buildTurnMessages` 返回含 system reminder + user msg |

不动:DB、FE、AGENT_TREE 结构、工具、服务。

## 显式不做(non-goals)

- **不每轮重发完整 MAIN**。只发精简 reminder(~80 token);完整 MAIN 仍在 systemPrompt 顶部。
- **不动 writer 的写作技法内容**(网文/去AI/声音)——只重排,不删(那是写手质量核心)。
- **不改子 agent 的工具/AGET_TREE**——纯 prompt + reminder。
- **不强行压缩 writer prompt**——它长是有意(写手质量);只把流程前置。
- **不改 summarization 阈值**——reminder 靠位置(最近处)强化,不靠改压缩。

## 测试

1. **buildTurnMessages 单测**:返回 `[{role:'system', content: MAIN_ROLE_REMINDER}, {role:'user', content, id}]`;reminder 含关键职责词(「task 委派」「态势」)。
2. **MAIN_ROLE_REMINDER 内容断言**:非空、含「编排者」「task 委派」(把固化意图写进测试)。
3. **prompt 文本改动**:无文本断言(惯例),回归 `pnpm test` + `pnpm typecheck`。
4. 活 E2E:多轮对话后看主 agent 是否仍委派(不自己写正文)、是否用态势决策。本期不强制。

## 验证未覆盖

- reminder 是否真逆转「多轮后职责稀释」、MAIN 重构是否让编排更顺,依赖模型 + 多轮 E2E。单测只锚定 reminder 注入 + 内容。
