# 写小说 Agent 流程缺陷修复清单

> **来源**:2026-07-07 对 narratox 写小说 agent 全链路的三路并行代码核证
> (写章链路 / 建置链路 / 记忆与运行时机制)。
>
> **总体结论**:主干**能跑通**,确定性守卫比预期扎实(未结算章拒绝写下一章 = 真实 DB 关卡,
> 不是 prompt 撒谎);`createSubAgentMiddleware` 的「子 agent 独立聚焦上下文」设计根核证为真
> (`messages` 数组被覆盖为单条 HumanMessage)。问题集中在两处:
> ① Phase 19 重构遗留的「文档声称已做、代码没做」漂移;② agent 之间双向「自然语言散文契约」
> 在模型漂移时脆弱。
>
> **用法**:逐条推进,改状态标记 `⬜ 待办` → `🔄 进行中` → `✅ 已完成`。

## 进度总览

| # | 优先级 | 状态 | 标题 | 工作量 |
|---|---|---|---|---|
| 1 | P0 | ✅ 已完成 | settler 弧线摘要:prompt 与工具实现矛盾 | S |
| 2 | P1 | ✅ 已完成 | 【近期关键事件】slice 是死代码 | S-M |
| 3 | P1 | ✅ 已完成 | listIndex 是死代码(Phase 19 遗留) | S |
| 4 | P2 | ⏸ 暂缓 | 修订闭环无熔断(原步骤不可行,A/B 路径待定) | M-L |
| 5 | P2 | ⬜ 待办 | nextStep 不路由 outline-rewrite | M |
| 6 | P3 | ⬜ 待办 | snapshot 是 in-memory,崩溃丢回滚 | M-L |
| 7 | P3 | ✅ 已完成 | write_summary 无事务 | S-M |
| 8 | P3 | ⬜ 待办 | summarization 全默认,触发太晚 + 英文 prompt | M |
| 9 | P3 | ⬜ 待办 | report_*_review 不落库 | M |
| 10 | P4 | ✅ 已完成 | list_knowledge 无 category/tag filter | S |
| 11 | P4 | ⬜ 待办 | recentPhase 死入参 | S |
| 12 | P4 | ⬜ 可选 | B1/B2 散文契约轻量结构化 | L |

**建议推进顺序**:#1 → #2 → #3(让长篇记忆真正生效)→ #4(防漂移崩)→ #7 → #5 → #8 → #9 → #6 → #10/#11。

工作量量纲:**S**≈1小时内 / **M**≈半天 / **L**≈1天以上。

---

## P0 · #1 settler 弧线摘要:prompt 与工具实现矛盾

- **状态**:✅ 已完成
- **问题**:[settler.md:42](../../../server/src/agentos/prompts/settler.md) 说「弧线/卷进展摘要由系统自动派生,你无需、也不必在 write_summary 里写 currentArcSummary/currentVolumeArcSummary」;但 [write-summary.tool.ts](../../../server/src/agentos/tools/write-summary.tool.ts) 的 zod 接受这俩字段、实现真的调 `arcService.updateProgressSummary`、工具 description 明写「settler 每章必填全部,弧线/卷摘要不写会丢【当前弧线】上下文」。
- **影响**:settler 听 prompt 就不填 → `Arc.summary` / `Volume.arcSummary` 静默为空 → 【当前弧线】slice 永远空 → writer 不知道自己在哪条弧(Phase 12 弧线记忆半瘫痪)。
- **修复步骤**:
  1. 把 [settler.md:42](../../../server/src/agentos/prompts/settler.md) 那段改成「弧线/卷摘要:每章【必填】currentArcSummary(本章所属弧的滚动摘要)+ currentVolumeArcSummary(本卷滚动摘要),服务端按 chapterOrder 解析目标 arc/volume 写入;不填会丢【当前弧线】上下文」。
  2. 在 settler.md 正文新增一节说明「滚动摘要怎么写」(承接本章情节进展 + 更新本弧/本卷当前态)。
- **验收**:相关 spec 全 green(`agent-prompts.spec.ts` 字节锁「每个必标 payoffTiming」仍命中,未改 spec;`write-summary.tool.spec.ts` / `arc.service.spec.ts` PASS);DB `Arc.summary` 非空需写章 E2E 验证(留待 L2 / 手测)。注:全套 `pnpm test` 另有 2 个**预存**失败(`get-outline.tool.spec.ts` / `get-novel-info.tool.spec.ts`,Phase 19 加 `totalWordTarget` / outline 字段后 spec 未同步)—— 已 `git stash` 基线证明非本次引入,不计入 #1(建议单列小修)。
- **工作量**:S
- **完成**(2026-07-07):改 [settler.md](../../../server/src/agentos/prompts/settler.md) 开头「提取 4 类」对齐为现状(含 plotEvents + 提末节弧线/卷摘要)+ 替换末段「由系统自动派生、你无需写」的错注为「【弧线/卷滚动摘要 — 每章必填,不填会丢【当前弧线】上下文】」节(说明必填性 / 滚动重写写法 / 不写的后果),与 [write-summary.tool.ts](../../../server/src/agentos/tools/write-summary.tool.ts) 工具 description「settler 每章必填全部,弧线/卷摘要不写会丢【当前弧线】上下文」对齐。

## P1 · #2 【近期关键事件】slice 是死代码

- **状态**:✅ 已完成
- **问题**:CLAUDE.md 多处声称「ContextAssembler 注入最近 8 个 MAJOR 事件」,但 `EventService.listRecentMajor`([event.service.ts:68](../../../server/src/memory/event.service.ts))在 production **零调用点**(只在 spec)。Phase 19 把非【态势/总纲】slice 从 main 移除后,writer augment([deep-agent.service.ts:481](../../../server/src/agentos/deep-agent.service.ts))只拼了 `masterSlice+foreSlice+targetSlice+voiceSlice`,也没事件。
- **影响**:长篇跨 5 章后,事件记忆完全靠 writer 自己判断要不要 `get_events`,无被动常驻。Phase 11 想治的「事件被压进摘要后遗忘」半失效。
- **修复步骤(二选一)**:
  - (a) 恢复注入:新建 `buildEventsSlice(listRecentMajor(8))` 纯函数,挂进 writer augment(与 foreSlice 同级)。工作量 S-M。
  - (b) 确认有意转按需:改 CLAUDE.md / Phase 11 spec 的「注入最近 8 MAJOR」表述为「事件已转纯按需拉取(get_events)」,消除文档误导。工作量 S。
- **验收**:events-slice.spec(4 测)+ agent-prompts 字节锁 + 全套(459 passed,4 failed 均为 #1 预存漂移,无新增)全 green;typecheck + prettier clean。写 5+ 章后 writer systemPrompt 含【近期关键事件】需 E2E 验证(留待 L2 / 手测)。
- **工作量**:S-M
- **完成**(2026-07-07):选 **(a) + 提示词增强**(用户决策:「被动常驻 + 主动按需拉取」两条腿)。① 新建 [events-slice.ts](../../../server/src/agentos/events-slice.ts) `buildEventsSlice`(仿 `buildForeSlice`,desc→asc reverse + 「按需 get_events」脚注)+ [events-slice.spec.ts](../../../server/src/agentos/events-slice.spec.ts)(空/格式/无字段/脚注 4 测);② [deep-agent.service.ts](../../../server/src/agentos/deep-agent.service.ts) runTurn 取 `listRecentMajor(8)`(此前死代码,现 production 唯一调用点)→ `buildEventsSlice` → 挂进 writer augment(与 foreSlice 同级,line 497);③ [writer.md](../../../server/src/agentos/prompts/writer.md) step 0 加第 5 条(get_events 按需拉)+ 新增【事件 — 承接近期,别当没发生过】节(承接 + 按需拉 + 区别伏笔)。writer.md 顺手 prettier 格式化(此前非 clean,无 .prettierignore)。

## P1 · #3 listIndex 是死代码(Phase 19 遗留)

- **状态**:✅ 已完成
- **真相**(核证推翻原描述):原描述以为「main 注入【角色索引】slice 但 listIndex 没截断」。核证发现 `listIndex` + `CharacterIndexEntry` 在 production **零调用** —— Phase 19 重构时,角色最终方案是「**从 main 完全移除角色 slice**(main 用 `get_characters` 按需拉,比截断索引更彻底)」,而非原计划的「截断索引」。`listIndex` 是该决策的遗留孤儿(方法 + 类型 + 1 个 spec 块,无运行时消费者);CLAUDE.md 两处过期表述(line 102 ContextAssembler 注入、line 136 Phase 19 角色)也源于此。性质同 #2 的 `listRecentMajor`(死代码)。
- **影响**(真相):不存在「slice 线性膨胀」(main 根本不注入角色索引);危害是死代码 + 文档误导。
- **修复**:删 [character.service.ts](../../../server/src/novel/character.service.ts) 的 `listIndex` 方法 + `CharacterIndexEntry` 接口 + [character.service.spec.ts](../../../server/src/novel/character.service.spec.ts) 的 listIndex describe 块;纠正 CLAUDE.md line 102(ContextAssembler 现 only 注入态势+总纲)+ line 136(Phase 19 角色订正:最终移除非截断)。
- **验收**:`pnpm --dir server test` 79 suites / **462 tests 全 green**(从 463 减 1,删的 listIndex 测试);typecheck + prettier clean。
- **工作量**:S
- **完成**(2026-07-07):方向从「加 take:40」改为「删死代码 + 纠正文档」(核证发现真相后)。

## P2 · #4 修订闭环无熔断,纯靠 prompt

- **状态**:⏸ 暂缓(2026-07-07 核证发现原修复步骤不可行,用户决定暂缓)
- **原描述**:「最多 1 轮」只在 [chapter-orchestrator.md](../../../server/src/agentos/prompts/chapter-orchestrator.md) prompt(line 15/20/30);代码层只有全局 `recursionLimit:500`([deep-agent.service.ts:561](../../../server/src/agentos/deep-agent.service.ts))。
- **核证真相**(2026-07-07,二次核证纠正):原「`buildNode` 里 `.withConfig({ recursionLimit: 120 })`」步骤**不可行** —— `buildNode` 返回的 `SubAgent` config 对象([deep-agent.service.ts:510-539](../../../server/src/agentos/deep-agent.service.ts))无 `recursionLimit` 字段,且非 compiled graph(无 `.withConfig`)。**真实机制(二次核证)**:task 工具([index.js:2283-2290](../../../server/node_modules/deepagents/dist/index.js))invoke subagent 时 `subagentConfig = {...config}` **透传父级 run config**(含 main 的 `recursionLimit:500`)→ 覆盖 createAgent 默认的 1e4。故 subagent 实际跑 **500**(main 的),不是 1e4 —— chapter 漂移有 **500 步硬上限**(超了抛 `GraphRecursionError`),**不是几乎无限**。原「1e4 无限」核证不充分,以此纠正。A 路径(CompiledSubAgent `.withConfig(120)`)同样被 `{...config}` 透传覆盖、**不生效**;真要给 chapter 设 120 只能走 custom middleware(`modifyConfig` 或计步),M-L。
- **可行路径**(未来重做参考):
  - **A**:`createSubAgentMiddleware` 的 `subagents` 也接受 `CompiledSubAgent`(`index.d.ts:2105`)。给 chapter 显式 `createAgent(...).withConfig({ recursionLimit: 120 })` 作为 CompiledSubAgent 传入 —— 需重构 `buildNode` + **核证** createSubAgentMiddleware 是否尊重 CompiledSubAgent 自带 recursionLimit。M,有技术不确定性。
  - **B**:custom 计步 middleware(计 chapter tool calls,超限抛错)。M-L,确定可行但重。
- **影响**:chapter orchestrator 漂移(弱模型 / 不遵 prompt)→ 一章跑超长步数 → 整轮 runTurn 崩。L2 smoke 跑规矩脚本,无法证明漂移时收敛。**规矩模型下不触发**。
- **工作量**:M(A)/ M-L(B)
- **决策**:暂缓。ROI 偏低(防弱模型漂移,规矩模型不触发)+ A 路径技术不确定性。先做更高 ROI 项。

## P2 · #5 nextStep 不路由 outline-rewrite

- **状态**:⬜ 待办
- **问题**:[status.service.ts:259](../../../server/src/novel/status.service.ts) 的 ACTIVE 分支只有 `plan_more`(plannedRemaining≤3)/ `write_next`。
- **影响**:态势 slice「下一步:write_next」可能让 main 跳过 Phase 10 细纲改写。细纲过时信号完全靠 main 自己从 validator 散文 note 里读到「细纲过时」并委派 outliner —— nextStep 不仅不帮忙,反而可能误导。
- **修复步骤(两档)**:
  - 最低限度:在 nextStep 旁/态势 slice 注释说明「若 validator 报细纲过时,优先委派 outliner 改写细纲,再 write_next」。
  - 完整:`getOverview` 增开 `outline_rewrite` 路由 —— 检测最近一次 validator 是否带「细纲过时」note(需把 note 落库或读最近活动帧),命中则 nextStep=`outline_rewrite`。
- **验收**:模拟 validator 报细纲过时后,态势 slice 的下一步指向 outline 改写。
- **工作量**:M

## P3 · #6 snapshot 是 in-memory,崩溃丢回滚

- **状态**:⬜ 待办
- **问题**:[revision-snapshot.service.ts:18](../../../server/src/novel/revision-snapshot.service.ts) 用 `Map<string,string>`,注释自辩「修订闭环在单个 turn 内完成,无需跨重启」。`clear_chapter` 自动 snapshot([clear-chapter.tool.ts:27](../../../server/src/agentos/tools/clear-chapter.tool.ts))也写进这个 Map。
- **影响**:turn 中途进程崩溃 → restore 不可用 → clear 后无回滚。生产环境非零风险。
- **修复步骤**:落 DB(新表 `RevisionSnapshot` 或复用 Chapter 历史表),key=`${novelId}:${order}` + ttl/清理策略。需重新评估「单 turn 内」的设计假设。
- **验收**:clear + 进程重启后 restore 仍可用;L1 `assertNoClearWithoutSnapshot` 仍过。
- **工作量**:M-L

## P3 · #7 write_summary 无事务

- **状态**:✅ 已完成
- **问题**:[write-summary.tool.ts:53-96](../../../server/src/agentos/tools/write-summary.tool.ts) 串行 await 五类写入(ChapterSummary / CharacterChange / StoryEvent / Event / Arc 进展),无 `prisma.$transaction`。
- **影响**:中途某步抛错 → 前面已写的不回滚 → 「半结算」状态(如 ChapterSummary 写了但 Event 没写)。
- **修复步骤**:用 `prisma.$transaction(async (tx) => {...})` 包裹五类写入,服务层方法接受可选 `tx` 参数。
- **验收**:typecheck 干净;`pnpm --dir server test` 79 suites / **463 tests 全 green**(新增事务原子性测试:mock createHooks 抛错 → `ok:false transaction_failed` + 后续步骤不调);8 文件 prettier clean。真 DB 回滚靠 prisma `$transaction` 语义保证(L1 现有断言仍过)。
- **工作量**:S-M
- **完成**(2026-07-07):① 6 个 service 方法加可选 `tx?: Prisma.TransactionClient`([SummaryService.upsert](../../../server/src/memory/chapter-summary.service.ts) / [CharacterService.recordChanges+findOrCreateByName](../../../server/src/novel/character.service.ts) / [StoryEventService](../../../server/src/memory/story-event.service.ts) createHooks/advanceHooks/markCore/resolveHooks / [EventService.createEvents](../../../server/src/memory/event.service.ts) / [ArcService.updateProgressSummary+findArcByChapter](../../../server/src/novel/arc.service.ts)),内部 `const client = tx ?? this.prisma`;② [write-summary.tool.ts](../../../server/src/agentos/tools/write-summary.tool.ts) `prisma.$transaction(async (tx) => {...})` 包裹 8 个写 + try/catch(失败返回 `ok:false transaction_failed`);③ [agent-registry.ts](../../../server/src/agentos/agent-registry.ts) write_summary factory 供给 `prisma`;④ spec 加 `$transaction` mock + 事务原子性测试 + 现有断言加 tx 参数。

## P3 · #8 summarization 全默认,触发太晚 + 英文 prompt

- **状态**:⬜ 待办
- **问题**:[deep-agent.service.ts:538](../../../server/src/agentos/deep-agent.service.ts) 只传 `backend`,其余全默认。deepagents 默认(`index.js:3455`):有 `profile.maxInputTokens` 时 `trigger=0.85 / keep=0.1`,摘要 prompt 是英文通用对话摘要。
- **影响**:GLM-4 128k 下 ~109k token 才压缩(很晚);默认英文摘要抓不住小说写作要点(细纲/角色/伏笔/事件)。CLAUDE.md Phase 26 Deferred 已承认「未做」。
- **修复步骤**:`createSummarizationMiddleware({ backend, model, trigger, keep, summaryPrompt })` 显式配置;`summaryPrompt` 用中文,强调保留【当前章细纲】【活跃角色状态】【开放伏笔】【近期事件】。
- **验收**:长对话压到阈值后,main 仍能正确回答早期设定的角色/伏笔问题。
- **工作量**:M

## P3 · #9 report_*_review 不落库

- **状态**:⬜ 待办
- **问题**:四个评审工具(`report_review`/`report_outline_review`/`report_worldview_review`/`report_character_review`)瞬态返回 `{passed,score,blockingIssues}`,工厂无参,**完全不写库**,只活在 transcript/message.activities。
- **影响**:事后无法追溯「这章为何被修订 / 评分历史」。数据分析只能挖 transcript。
- **修复步骤**:加 `Review` 表(或写活动日志),记录 type/score/passed/blockingIssues/note + chapterOrder/novelId。需 Prisma 迁移 + 手动 `prisma generate`。
- **验收**:写一章后 DB 有 review 行;FE 可查历史评分(本期可只落库,FE 后续)。
- **工作量**:M

## P4 · #10 list_knowledge 无 category/tag filter

- **状态**:✅ 已完成
- **问题**:[list-knowledge.tool.ts:32](../../../server/src/agentos/tools/list-knowledge.tool.ts) schema `z.object({})` 不接受任何过滤,每次返全量索引字符串(63 条)。REST `/knowledge` 有 filter,但 agent 工具层没暴露。
- **影响**:curator/wb-writer/outline-writer/char-writer 每次都吃全量索引,token 浪费。
- **修复步骤**:schema 加可选 `category?`/`tag?`/`keyword?`,service 层复用已有过滤逻辑。
- **验收**:`pnpm --dir server test` 80 suites / **466 tests 全 green**(新增 list-knowledge.tool.spec 3 测:无过滤透传 / category+tag+keyword 透传 / JSON 字符串);typecheck + prettier clean。
- **工作量**:S
- **完成**(2026-07-07):① [list-knowledge.tool.ts](../../../server/src/agentos/tools/list-knowledge.tool.ts) schema 加 `category`(enum 6 分类)/`tag`/`keyword` 可选,复用 `KnowledgeService.list({category,tag,search:keyword})`;tool description 提示「已知要哪类就过滤、别盲目拉全量」;② 4 个 writer 叶子 prompt([curator](../../../server/src/agentos/prompts/curator.md) / [outline-writer](../../../server/src/agentos/prompts/outline-writer.md) / [worldbuilder-writer](../../../server/src/agentos/prompts/worldbuilder-writer.md) / [character-writer](../../../server/src/agentos/prompts/character-writer.md))把「看全部索引」改成「按 category 过滤(各给具体建议)省 token」;③ 新建 list-knowledge.tool.spec。4 个 prompt md 顺手 prettier 格式化(此前非 clean)。

## P4 · #11 recentPhase 死入参

- **状态**:⬜ 待办
- **问题**:[status.service.ts:211](../../../server/src/novel/status.service.ts) 算了 `recentPhase`,但 [context-assembler.service.ts:108-117](../../../server/src/agentos/context-assembler.service.ts) 注入态势 slice 时没用它 → main 决策无受益,只有 FE `/status` 可见。
- **修复步骤**:要么把 recentPhase 注入态势 slice(让 main 知道「上一轮在干嘛」),要么删掉减少困惑。
- **工作量**:S

## P4 · #12(可选)B1/B2 散文契约轻量结构化

- **状态**:⬜ 可选(观察 #4 熔断效果后再定)
- **背景**:核证确认 `createSubAgentMiddleware` 的 `task` 工具(`deepagents/dist/index.js:2282`)直接覆盖 messages 为单条 HumanMessage → 父→子只传 `description` 散文;`returnCommandWithStateUpdate` 只回传子 agent 最后一条 assistant message content → 子→父 `report_review` 的结构化对象不回流,靠 validator 散文复述。
- **影响**:父→子「作者要求」三层转述无 schema;子→父 `blockingIssues` 靠两个 LLM 散文交换,修订闭环正确性 = validator 忠实复述 × orchestrator 可靠解析。
- **修复方向(若做)**:`task` description 与 `report_review` 约定 JSON 前缀(如 `{"authorIntent":"...","task":"..."}` / `{"blockingIssues":[...]}`),减少解析丢损。架构级改动,建议先做 #4 熔断 + 观察 prompt 纪律实效再评估必要性。
- **工作量**:L

---

## 附录 A:核证确认「能跑通」的部分(给修复时信心)

- **未结算守卫真实存在**:[chapter.service.ts:111-135](../../../server/src/novel/chapter.service.ts) `assertFrontier`(N>1 时前驱章有正文无 ChapterSummary → 拒绝)+ `assertHasPlan`(无细纲拒绝)。确定性 DB 关卡,只拦「写下一章」不拦编辑路径,第一章放行。prompt 没撒谎。
- **CONCEPT→ACTIVE**:在 [append-section.tool.ts:49](../../../server/src/agentos/tools/append-section.tool.ts) `novels.activate` 触发。
- **7 个 setter 工具**:全部存在 + 闭包注入 `userId/novelId` + zod 不含越权字段 + service 层 `assertOwned` 前置。多租户隔离硬。
- **`set_master_outline`(Phase18)/`set_arc`(Phase12)**:真实存在并注册。
- **`createSubAgentMiddleware` 子 agent 隔离**:设计根核证为真(`messages` 被覆盖为单条 HumanMessage)。
- **per-agent 模型解析 + 缓存 key**:兜底正确(active 为 null 提前抛;override modelId 空 → 兜底 active;updatedAt 进缓存 key,改 key 自动失效)。
- **checkpointer**:`PostgresSaver` 在独立 `agent_memory` schema,与 Prisma `public` 隔离,无 migration drift。
- **check_prose**:确定性纯 TS(blocking 4 项:复读/截断/拒绝语/工程词泄漏;advisory 7 项)。

## 附录 B:已知限制(代码已有注释,记录但不强制修)

- **rewind 锚点被 summarization 压缩** → 降级为「仅 UI 撤回」,checkpoint 残留语义([deep-agent.service.ts:356-363](../../../server/src/agentos/deep-agent.service.ts))。
- **clear 不清旧 ChapterSummary**([chapter.service.ts:331](../../../server/src/novel/chapter.service.ts)):重写时 settler 第二次 upsert 覆盖,微不一致。
- **`MAIN_ROLE_REMINDER` 落地偏离 Phase 14 原意**:因 GLM「只允许首条 system」约束,改为追加 systemPrompt 末尾一次性下发([deep-agent.service.ts:69-71](../../../server/src/agentos/deep-agent.service.ts)),长历史仍稀释。
- **`findByOrder` 返回形态未钉死**:未来有人给它加 `select` 限制字段,`check-prose`/`write-summary` 会静默写入 `id=undefined`。建议 JSDoc 钉死返回全字段。
- **`appendSection` O(n²) 拼接**([chapter.service.ts:184](../../../server/src/novel/chapter.service.ts)):单章 3-6k 字无碍,仅 LLM 误整章一次 append 才有超时风险(工具描述已禁止,无代码硬限)。

## 附录 C:顺手清理的预存 spec 漂移(2026-07-07)

修复 #1/#2 时发现 2 个**预存** spec 失败(`get-outline.tool.spec.ts` / `get-novel-info.tool.spec.ts`,共 4 测),根因是 Phase 18/19 给工具加了 `totalWordTarget` / arc `volumeOrder` / volume `chapterRange` 字段后,spec 的 `toEqual` 精确匹配没同步(工具逻辑正确,纯 spec 期望过时)。已对齐:`pnpm --dir server test` 现 **79 suites / 463 tests 全 green**。记此条让后续 #3–#12 验证时基线可信 —— 任何红直接归因本次改动,无需再 `git stash` 基线对比。
