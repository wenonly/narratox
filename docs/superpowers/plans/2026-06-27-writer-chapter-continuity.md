# writer 章节接缝连续性 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 writer 在写/改第 N 章前主动读相邻章全文(写新章读 N-1;改/续/重写既有章再加读 N+1),消除章间接缝穿帮——纯 prompt 改动,复用现有 `get_chapter`。

**Architecture:** 改 2 个 prompt 常量。WRITER_AGENT_PROMPT 加【连续 — 章节接缝不穿帮】节(writer 自身纪律);CHAPTER_ORCHESTRATOR_PROMPT 委派 writer 的指令清单加一条相邻章读取(orchestrator 强化为一步)。统一规则用「第 N 章是否有正文」隐式判写/改模式,不传显式模式信号。零 DB / 零新工具 / 零 settler / 零 FE。

**Tech Stack:** NestJS 11 + TypeScript,deepagents 声明式 agent 树,jest 单测(`pnpm test`,NODE_OPTIONS=--experimental-vm-modules),`pnpm typecheck`。

**Spec:** [2026-06-27-writer-chapter-continuity-design.md](../specs/2026-06-27-writer-chapter-continuity-design.md)

---

## File Structure

- 改:`server/src/agentos/agent-prompts.ts` — `WRITER_AGENT_PROMPT` 加【连续】节;`CHAPTER_ORCHESTRATOR_PROMPT` 委派指令加相邻章读取一条。

不动:DB(零迁移)、FE、新工具、settler、ContextAssembler、CharacterService、AGENT_TREE 结构、其它 agent。

> **关于 TDD**:本期是纯 prompt 文本改动——项目惯例不测 prompt 文本(agent-tree 防回归快照只断言树结构「名/工具/tier」,不含 prompt 内容;`PROMPTS` 仅查 key 存在)。故无「先写失败测试」步骤;「测试」= 全量 `pnpm test` 不回归 + `pnpm typecheck` 过(与 Phase 7 Task 2 同款)。改 prompt 文本不会触发任何现有断言。

---

## Task 1:给两处 prompt 加相邻章读取纪律

**Files:**
- Modify: `server/src/agentos/agent-prompts.ts`(`WRITER_AGENT_PROMPT` 约第 64 行后 + `CHAPTER_ORCHESTRATOR_PROMPT` 约第 129 行后)

- [ ] **Step 1: WRITER_AGENT_PROMPT 加【连续】节**

在 `server/src/agentos/agent-prompts.ts` 的 `WRITER_AGENT_PROMPT`,把【细纲】节末行 + 【世界观】节标题(约第 64-66 行):

```
- 不确定全书进度时调 get_outline 看 nextChapterOrder 定位。若 get_chapter_plan 返回 no_plan,告诉主 agent 委派 outliner 补该章细纲,不要凭空瞎写。

【世界观 — 别编造设定】
```

替换为(中间插入【连续】节):

```
- 不确定全书进度时调 get_outline 看 nextChapterOrder 定位。若 get_chapter_plan 返回 no_plan,告诉主 agent 委派 outliner 补该章细纲,不要凭空瞎写。

【连续 — 章节接缝不穿帮】
- 写/改/续/重写第 N 章前,先读相邻章接缝:
  · 先 get_chapter(N-1) 读上一章【全文,重点结尾】——接住它的地点、在场人、悬而未决的情境、人物情绪;不要人物瞬移、状态重置、场景断裂。(第 1 章无上一章,跳过。)
  · 若第 N 章已有正文(=改/续/重写,不是新写),再 get_chapter(N+1)(若存在)读下一章开头——确保你改完的第 N 章仍能平滑过渡到下一章,接缝不留矛盾。

【世界观 — 别编造设定】
```

- [ ] **Step 2: CHAPTER_ORCHESTRATOR_PROMPT 委派指令加一条**

在 `server/src/agentos/agent-prompts.ts` 的 `CHAPTER_ORCHESTRATOR_PROMPT`,把委派 writer 指令清单的细纲行 + 伏笔行(约第 129-130 行):

```
   - 先 get_chapter_plan(N) 读细纲节点;重写则先 clear_chapter(N) 清空再重写。
   - 先 get_outline / query_memory 查当前开放伏笔
```

替换为(细纲后插入相邻章读取一条):

```
   - 先 get_chapter_plan(N) 读细纲节点;重写则先 clear_chapter(N) 清空再重写。
   - 先 get_chapter(N-1) 读上一章(尤其结尾)接缝;若第 N 章已有正文(改/续/重写),再 get_chapter(N+1)(若存在)读下一章开头——确保两头接得上,不穿帮。
   - 先 get_outline / query_memory 查当前开放伏笔
```

- [ ] **Step 3: 跑全量单测,确认无回归**

Run: `cd /Users/taowen/project/narratox/server && pnpm test`
Expected: 全绿(52 套)。prompt 文本无断言;唯一相关快照(agent-tree 结构)不含 prompt 内容,应仍通过。

- [ ] **Step 4: typecheck**

Run: `cd /Users/taowen/project/narratox/server && pnpm typecheck`
Expected: 通过(prompt 是字符串,改动不影响类型;按惯例确认)。

- [ ] **Step 5: 提交**

```bash
cd /Users/taowen/project/narratox && git add server/src/agentos/agent-prompts.ts
git commit -m "feat(writer): 写/改第 N 章前先读相邻章接缝

WRITER 加【连续】节 + CHAPTER_ORCH 委派指令加一条:写新章先读 N-1
(接结尾);改/续/重写既有章再加读 N+1(保过渡)。复用 get_chapter,
零新工具。proactive 补 Phase 7 reactive 审计的写前盲区。"
```

---

## Task 2:同步 CLAUDE.md(Phase 8 入档)

**Files:**
- Modify: `CLAUDE.md`(Phase 7 标题去「current」+ Phase status 加 Phase 8 条)

- [ ] **Step 1: Phase 7 标题去掉「, current」**

`CLAUDE.md` 的 Phase 7 行,把:

```
- **Phase 7 (character-consistency validation in validator, current):**
```

改为:

```
- **Phase 7 (character-consistency validation in validator):**
```

- [ ] **Step 2: 在 Phase 7 条之后、`**Deferred:**` 之前插入 Phase 8 条**

插入:

```
- **Phase 8 (writer chapter-continuity, current):** closes the proactive gap Phase 7 left — the writer could read any chapter (`get_chapter`) but was never told to read *neighboring* chapters for continuity, so chapter-boundary handoffs were the drift-prone seam. WRITER prompt gained a 【连续 — 章节接缝不穿帮】 section + CHAPTER_ORCH delegation gained a neighbor-read step: before writing chapter N, read N-1 (catch its ending — location/present characters/situation/emotion); if chapter N already has content (= revise/continue/rewrite, not new), also read N+1 (preserve the forward handoff). Mode inferred from "does chapter N have content" — no explicit mode signal. **No DB / FE / new tool / settler change** — reuses `get_chapter`. Structured 章末场景态 was explicitly deferred (reading the full neighbor covers the immediate seam; character currentState already injected since Phase 6). Spec: [2026-06-27-writer-chapter-continuity-design.md](docs/superpowers/specs/2026-06-27-writer-chapter-continuity-design.md). Plan: [2026-06-27-writer-chapter-continuity.md](docs/superpowers/plans/2026-06-27-writer-chapter-continuity.md).
```

- [ ] **Step 3: 提交**

```bash
cd /Users/taowen/project/narratox && git add CLAUDE.md
git commit -m "docs: CLAUDE.md 更新 Phase 8(writer 章节接缝连续性)"
```

---

## Self-Review(写完后自检)

- **Spec 覆盖**:① WRITER 加【连续】节 → Task 1 Step 1;② CHAPTER_ORCH 委派加相邻章读取 → Task 1 Step 2;③ 持久化状态(角色态)无需改 → 本计划无相关任务(显式不碰,spec 已确认);④ 统一规则(用「N 是否有正文」判模式)→ 两段 prompt 文本均体现;⑤ 不碰 DB/FE/settler/新工具 → 本计划无相关任务。✅ 无遗漏。
- **占位符扫描**:无 TBD/TODO;每个改步骤都有逐字代码。✅
- **一致性**:两处 prompt 用同一规则表述、同一 `get_chapter` 调用;CLAUDE.md Phase 8 条目与 spec 一致。✅

---

## 验证未覆盖(执行后告知用户)

- 单测只验证「prompt 文本写到位、测试不回归」。**实际 writer 是否真按指令读了相邻章、接缝是否真不穿帮**依赖模型,需活 E2E(配模型 + DB,写一章看 writer 是否调 get_chapter(N-1))。本期不强制;用户要时可起 `pnpm dev` 实测。
