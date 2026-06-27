# 测试体系设计(L1-L3 冒烟 + AI 评估)(Phase 15)

> 日期:2026-06-27 · Phase 15 · 关联 [闭环审计](../../architecture/closed-loop-audit.md)(「零 agent 流程集成测试」隐患)、[E2E 发现](../../architecture/e2e-findings.md)

## 问题诊断

15 个 phase 全靠**单元测试(mock 一切)+ 我手动 E2E** 兜着。`pnpm test`(60 套)查不出 runaway / clear 数据丢失 / settler 漏提 / prompt 改坏流程——这些只能靠「真跑一遍 agent」才能发现。`test/pipeline.spec`(唯一 DB 集成)**不在默认套件**。没有回归网。

业界共识([Confident AI](https://www.confident-ai.com/blog/llm-agent-evaluation-complete-guide)、[LangChain](https://www.langchain.com/resources/llm-evaluation-framework)):agent 评估三层——**轨迹(玻璃盒,看工具调用顺序/选择)+ 终态(DB 确定性断言)+ LLM-as-Judge(质量打分)**。本设计把这三层落地到我们的 NestJS/jest 栈(不依赖 Python eval 框架)。

## 目标

建立**四层测试金字塔** + 一个共享 **harness**,覆盖:数据管道/关卡回归(L1,每次 commit)、agent 流程真跑通(L2,每晚/手动)、AI 输出质量评估(L3,发版前)。L2 要像**真人使用**:多章 + 改章 + 重写 + 续写,全面触发改章节流程。

## 测试金字塔

| 层 | 跑什么 | LLM | 何时 | 抓什么 |
|---|---|---|---|---|
| L0 单元 | service/tool 单测(mock) | ❌ | 每次 commit(已有) | 函数逻辑 |
| **L1 集成冒烟** | 真 DB + **回放固定工具序列**(模拟 agent):建小说→关卡→write_summary→report_review→snapshot/restore | ❌ | **每次 commit**(纳入 pnpm test) | 数据管道 + 关卡 + 持久化 + clear 安全网 |
| **L2 实况场景** | **真模型**,HTTP 驱动,剧本式:立项→写 ch1/2/3→改 ch2→重写 ch1→续写 ch4;每步**轨迹断言 + DB 断言 + 边界** | ✅ | 每晚 / `pnpm test:smoke`(需 server+模型) | 流程真跑通 + 终止 + 有界 + handoff 顺序 + 数据安全 |
| **L3 LLM-Judge** | judge 模型给章节/提取/校验打分;**故意注入不一致测 validator 抓错率** | ✅ | 发版前 / `pnpm test:eval` | 输出质量(一致性/完整性/抓错率) |

## 架构:harness + fixture

**共享 fixture**(L1/L2/L3 复用,保证可复现):一个固定概念——
```
书名《青衫客》/ 武侠 / 简介:落魄剑客陆青衫卷入一桩灭门奇案 / 核心冲突:查真凶 vs 幕后势力灭口 / 每章 1500 字(短,控 L2 成本)/ 世界观:江湖六大门派 / 文风:古龙式短句
```

**harness 共享工具**(`test/harness/`):
- `fixture.ts`:固定概念 + 期望(章数/弧数等)。
- `assertTrajectory.ts`:活动流解析——`toolsInOrder(stream)`、`assertBefore(a,b)`(a 工具先于 b)、`assertToolCount(label, {min,max})`、`assertNoClearWithoutSnapshot`。
- `assertDb.ts`:DB 状态断言(章 COMMITTED/字数/摘要/事件/伏笔/CONCEPT→ACTIVE)。
- `runTurn.ts`(L2 用):HTTP POST /agents/:id/runs,捕获 newline-JSON 流 → ActivityEvent[];带超时 + 重试。

## L1 集成冒烟(无 LLM,默认套件)

`test/smoke/l1-*.spec.ts`(纳入 jest 默认;真 DB,回放无模型):
- **L1-a 写章回放**:建小说+细纲 → `append_section`(写内容)→ 断言 content/status/CONCEPT→ACTIVE。
- **L1-b 结算回放**:→ `write_summary`(固定 extraction:summary+roleChanges+entities+plotEvents+newHooks)→ 断言 ChapterSummary/CharacterChange/Event/StoryEvent 全落库。
- **L1-c 关卡**:断言 `assertHasPlan`(无细纲拒写)、`assertFrontier`(前驱未结算拒写)真生效(直接调 ChapterService 门)。
- **L1-d 修订安全网**:`snapshot_chapter` → 改 → `restore_chapter` 回滚往返;`clear_chapter` 前自动 snapshot(直接验 clear 后 snapshot 存在、可 restore)。
- **L1-e 弧进展派生**:写 2 章后,`SummaryService.listByChapterRange(arc.from,arc.to)` 返回 2 条 → ContextAssembler 拼出弧进展(单测 forSession 含【当前弧线】弧进展)。

> 这些是**确定性**的,抓「改了 ChapterService/EventService/关卡/snapshot/派生 把管道弄断」。

## L2 实况场景(真模型,剧本式,HTTP 驱动)

`scripts/smoke/l2-scenario.ts`(`pnpm test:smoke`;需 server 跑 + 模型配好;输出逐阶段报告)。

**剧本(像真人,全面触发改章流程)**:
1. **立项**(1-2 轮):给齐概念 → 断言 settings 收齐、curator/world/outline(卷+弧+细纲)/character 落库。
2. **写 ch1、ch2、ch3**(各 1 轮,显式「写完就停」):每轮断言 writer→settler→validator 顺序、终止(RunCompleted)、有界(工具数 ≤80)、无 clear-without-snapshot、DB(章 COMMITTED+字数>阈值+摘要+事件)、CONCEPT→ACTIVE。
3. **改 ch2**(「把第2章里陆青衫和证人的对话改得更狠」):断言用 `replace_text/insert_text`(定点修订),**不应** `clear_chapter`;ch2 仍 COMMITTED、字数变化。
4. **重写 ch1**(「重写第1章开篇,换个切入」):断言 `clear_chapter` **前**有 `snapshot_chapter`(安全网生效);ch1 重写后非空。
5. **续写 ch4**(「写第4章」):断言顺序关卡(前驱 ch3 已结算 → 放行)。
6. **跨章召回**:写 ch4 时 writer 应 `get_chapter(N-1)`/`query_memory`(读前文)。

**轨迹断言清单(robust,容忍模型抖动)**:
- 顺序:`get_chapter_plan` 先于 `append_section`;`append_section`→`write_summary`→`report_review`(写章 handoff);改章用 replace/insert 而非 clear。
- 安全:任何 `clear_chapter` 前必有 `snapshot_chapter`(同章)。
- 边界:每轮 `RunCompleted` 存在;工具数 ∈ [10, 80];未报 RunError/超时。
- 终态:每章 COMMITTED + 字数 > 500;ChapterSummary 存在;首章后 ACTIVE。
- 完整性:无重复伏笔(同 description)> 阈值(温和断言,因 settler 可能重复——已知问题)。

**产出**:逐阶段 PASS/FAIL + 失败时的工具轨迹摘要 + DB 快照,写成 `smoke-report.md`。

## L3 LLM-Judge(质量评估)

`scripts/smoke/l3-judge.ts`(`pnpm test:eval`;judge 用同一 model-factory,可指定 judge 模型):
- **章节质量**:judge 读 ch2 正文 + 细纲/角色/世界,按 rubric(一致性/不穿帮/爽点/去AI味)打 0-100 + 理由。
- **settler 提取完整性**:judge 对照 ch2 正文 vs 提取的事件/伏笔,查漏提/错提(「正文有 X 事件但没提取」)。
- **validator 抓错率(红队)**:对 ch2 `PATCH` 注入一个不一致(如角色用了未建立的能力/地点穿帮)→ 跑 validator → 断言 report_review 的 blockingIssues 含该问题;多注入几类(人物OOC/战力越级/伏笔矛盾)算 catch-rate。
- **产出**:`eval-report.md`(各项分数 + 理由 + catch-rate)。

## 运行方式 / CI 集成

- **L0 + L1**:`pnpm test`(默认,每次 commit)。jest 配置把 `test/smoke/l1-*` 纳入;`test/pipeline.spec` 也纳入(改为默认)。
- **L2**:`pnpm test:smoke`(脚本,需 `DATABASE_URL`+模型 key + server 在跑;CI nightly 或手动)。env `SMOKE_NOVEL_ID` 可复用已有小说。
- **L3**:`pnpm test:eval`(脚本,需模型 key;发版前手动)。
- 三者共享 harness + fixture。

## 改动面

| 文件 | 改动 |
|---|---|
| `test/harness/{fixture,assertTrajectory,assertDb,runTurn}.ts`(新) | 共享工具 |
| `test/smoke/l1-write.spec.ts` / `l1-gate.spec.ts` / `l1-snapshot.spec.ts` / `l1-arc.spec.ts`(新) | L1 集成冒烟(纳入默认套件) |
| `jest.config`(package.json 的 jest 段) | 纳入 `test/smoke/l1-*` + `test/pipeline.spec`;排除 `scripts/`(L2/L3) |
| `scripts/smoke/l2-scenario.ts`(新) | L2 实况剧本 |
| `scripts/smoke/l3-judge.ts`(新) | L3 judge 评估 |
| `server/package.json` | `test:smoke` / `test:eval` 脚本 |

## 显式不做(non-goals)

- **不接外部 Python eval 框架**(DeepEval/LangSmith/Promptfoo)——它们 Python/托管,与 NestJS 栈不匹配;我们用自家 jest/脚本实现等价理念。
- **L2 不追求确定性**:live 模型非确定;断言用 robust 的顺序/范围/边界,不用精确序列。
- **L2 不每次 commit 跑**(烧 token + 慢)——nightly/手动。
- **judge 不替代人工评审**:是辅助打分,发版仍需人看。
- **不做性能基准测试**(响应时间/吞吐)——本期只做正确性 + 流程 + 质量。

## 测试 / 验证

- L1 自身是测试(纳入 `pnpm test`)。
- L2/L3 用我手动 E2E 跑通过的场景作基准,验证 harness 断言不误报。
- 验证「harness 能抓到已知 bug」:故意回滚某个修复(如 clear 安全网),看 L1-d 是否报红;回滚 recursionLimit,L2 是否报「工具数超阈」。

## 验证未覆盖

- L2/L3 依赖模型质量——模型差时 judge 分低不代表代码坏;报告需人工解读。
- 真正的长上下文(50+ 轮)稀释仍未覆盖(L2 只 ~7 轮)。
