# 测试体系 L1-L3 实施计划(Phase 15)

> **For agentic workers:** superpowers:subagent-driven-development / executing-plans.

**Goal:** 四层测试金字塔(L0 已有 + L1 集成冒烟 + L2 实况剧本 + L3 LLM-Judge),共享 harness,L2 像真人(多章/改章/重写/续写)。

**Spec:** [2026-06-27-test-suite-design.md](../specs/2026-06-27-test-suite-design.md)

---

## Task 1:共享 harness

**Files:** Create `server/test/harness/{fixture,assertTrajectory,assertDb,runTurn}.ts`

- [ ] **fixture.ts**:固定概念(青衫客/武侠/查真凶/1500字/古龙式)。
- [ ] **assertTrajectory.ts**:解析活动流,提供 `toolsInOrder` / `assertBefore(a,b)` / `assertToolCount(label,{min,max})` / `assertNoClearWithoutSnapshot` / `assertRunCompleted` / `assertToolCountTotal({max})`。
- [ ] **assertDb.ts**:PrismaService 断言——`assertChapterCommitted(novelId,order,minChars)` / `assertSummaryExists` / `assertEventsExist(novelId,order,minCount)` / `assertNovelActive(novelId)`。
- [ ] **runTurn.ts**(L2 用):HTTP POST → 读 newline-JSON → ActivityFrame[];带超时。

> harness 是纯 TS(无 Nest DI),L1 直接 `new PrismaService()`,L2 用 fetch。

---

## Task 2:L1 集成冒烟(纳入 pnpm test)

**Files:** `test/smoke/l1-*.spec.ts`(4 个)+ jest 配置

- [ ] **l1-write.spec.ts**:建小说+细纲(Volume+ChapterOutline)→ `chapters.appendSection` 写 ch1 → 断言 content/status/CONCEPT→ACTIVE(markActiveIfConcept)。
- [ ] **l1-settle.spec.ts**:→ `write_summary` 工具(makeWriteSummaryTool,固定 extraction:summary+roleChanges+entities+plotEvents+newHooks)→ 断言 ChapterSummary/CharacterChange/Event/StoryEvent 全落库(用 assertDb)。
- [ ] **l1-gate.spec.ts**:断言 `assertHasPlan`(无细纲→reject)+ `assertFrontier`(前驱未结算→reject)真生效(直接调 ChapterService,expect throw)。
- [ ] **l1-snapshot.spec.ts**:`snapshots.snapshot` → 改 → `restore`;`chapters.clearChapter` → 断言 snapshot 在前(clear 自动 snapshot 安全网)→ `snapshots.restore` 恢复。
- [ ] **l1-arc.spec.ts**:写 2 章摘要(SummaryService.upsert)→ `listByChapterRange(arc.from,arc.to)` 返回 2 条。
- [ ] **jest 配置**(package.json 的 jest 段):`testRegex` 纳入 `test/smoke/l1-.*\\.spec\\.ts` + `test/pipeline\\.spec\\.ts`;排除 `scripts/`。
- [ ] 跑 `pnpm test` 确认 L1 全绿(含新 5 套)。

> L1 用真 DB(`new PrismaService()`),无模型;teardown 清理测试 novel(按 title 前缀「L1-test-」)。

---

## Task 3:L2 实况场景(真模型,剧本式)

**Files:** `scripts/smoke/l2-scenario.ts` + `package.json` test:smoke

- [ ] **剧本 7 幕**(每幕 = 1 HTTP turn + 断言):
  1. 立项(give concept)→ 断言 settings 齐 + worldbuilder/outline/character 落库。
  2. 写 ch1 → 轨迹(get_chapter_plan→append→write_summary→report_review)+ 终态(COMMITTED+字数>500+摘要+事件)+ ACTIVE。
  3. 写 ch2 → 同上 + 跨章(get_chapter(N-1) 出现)。
  4. 写 ch3 → 同上。
  5. 改 ch2(「把第2章陆青衫的对话改狠一点」)→ 断言 replace_text/insert_text 出现、clear_chapter **不**出现(或若有则 snapshot 在前)、ch2 仍 COMMITTED + 字数变。
  6. 重写 ch1(「换个开篇」)→ 断言 clear_chapter 前有 snapshot_chapter;ch1 重写后非空。
  7. 续写 ch4 → 断言前驱 ch3 已结算 → 放行;轨迹同写章。
- [ ] 每幕断言用 harness(assertTrajectory + assertDb + runTurn)。
- [ ] 边界断言:每幕 RunCompleted + 工具数 ∈ [10,80] + 无 RunError。
- [ ] 产出:逐幕 PASS/FAIL → `smoke-report.md`(含失败幕的工具轨迹摘要)。
- [ ] `package.json`:`"test:smoke": "tsx scripts/smoke/l2-scenario.ts"`。

> L2 非确定(模型);断言 robust(顺序/范围/边界)。需 server 跑 + 模型 key + DATABASE_URL。

---

## Task 4:L3 LLM-Judge(质量评估)

**Files:** `scripts/smoke/l3-judge.ts` + `package.json` test:eval

- [ ] **judge 客户端**:用 model-factory buildChatModel(judge 模型,可 env `JUDGE_MODEL`)。
- [ ] **章节质量**:judge 读 ch2 正文 + 细纲/角色/世界 → 打分(一致性/不穿帮/爽点/去AI味,0-100)+ 理由。
- [ ] **settler 完整性**:judge 对照 ch2 正文 vs 提取的事件/伏笔 → 查漏提/错提。
- [ ] **validator 抓错(红队)**:对 ch2 `PATCH` 注入不一致(角色用未建立能力/地点穿帮/伏笔矛盾)→ 跑 validator(POST agent run「检查第2章一致性」)→ 断言 blockingIssues 含该问题。多注入几类算 catch-rate。
- [ ] 产出:`eval-report.md`(分数 + 理由 + catch-rate)。
- [ ] `package.json`:`"test:eval": "tsx scripts/smoke/l3-judge.ts"`。

> judge 用同 model-factory;结果依赖 judge 模型质量,报告需人工解读。

---

## Task 5:验证 + CLAUDE.md

- [ ] **harness 抓 bug 验证**:故意回退 clear 安全网(clear-chapter.tool 去掉 snapshot)→ L1-snapshot 应报红;恢复。回退 recursionLimit → L2 工具数超阈应报红(手动验)。
- [ ] **CLAUDE.md** Phase 15 入档(测试金字塔 + harness + L1-L3 + 运行方式)。

---

## Self-Review

- **Spec 覆盖**:harness → T1;L1(数据/关卡/snapshot/弧)→ T2;L2(7幕剧本:写/改/重写/续写 + 轨迹/终态/边界)→ T3;L3(章节质量/settler完整性/validator抓错红队)→ T4;harness 抓 bug 验证 → T5。✅
- **一致性**:L1/L2/L3 共享 harness + fixture;L2 的 assertNoClearWithoutSnapshot 对齐 clear 安全网修复;L2 工具数阈值 80 对齐 recursionLimit 500(500 步 ≈ ~100-200 工具调用;80 工具 ≈ ~200 步,有裕量)。
- **robust**:L2 断言容忍模型抖动(用顺序/范围,非精确序列;字数 >500 非精确值)。

## 验证未覆盖

- L2/L3 依赖模型;模型差→L2 失败不代表代码坏。L2 非 commit-门控(nightly)。
- 长上下文稀释(50+ 轮)未覆盖(L2 只 7 轮)。
