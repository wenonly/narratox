# 大纲改写回馈 实施计划(Phase 10)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 接通「正文偏离 → 大纲改写」回馈闭环(accept-written-as-truth):validator「细纲过时」note → CHAPTER_ORCH 结论带回 → main 委派 outliner 改写 → outline-writer 读实际正文改细纲 + 核查下游。

**Architecture:** 1 个工具补丁(outline-writer += get_chapter,改写模式要读实际正文)+ 4 处 prompt(信号链)。信号走既有 task 委派(prompt-driven),零结构化字段。零 DB / FE / 新 agent / 新工具。

**Tech Stack:** NestJS 11 + TypeScript,deepagents 声明式 agent 树,jest 单测(`pnpm test`,NODE_OPTIONS=--experimental-vm-modules),`pnpm typecheck`。

**Spec:** [2026-06-27-outline-rewrite-feedback-design.md](../specs/2026-06-27-outline-rewrite-feedback-design.md)

---

## File Structure

- 改:`server/src/agentos/agent-tree.config.ts` — outline-writer spec 的 `tools` 加 `get_chapter`。
- 改:`server/src/agentos/agent-prompts.ts` — CHAPTER_ORCH(结论带回信号)+ MAIN(委派改写)+ OUTLINER_ORCH(改写任务类型)+ OUTLINE_WRITER(改写模式)。
- 改:`server/src/agentos/agent-tree.config.spec.ts` — outline-writer 快照 + 正向断言。

不动:DB、FE、新 agent、settler、validator、其它 agent。

---

## Task 1:outline-writer += get_chapter(TDD:先改快照 → 失败 → 改配置 → 通过)

**Files:**
- Modify: `server/src/agentos/agent-tree.config.spec.ts`(outline-writer 快照 + 新增 `it()`)
- Modify: `server/src/agentos/agent-tree.config.ts`(outline-writer spec tools)

- [ ] **Step 1: 先改测试(让它期望新工具,此时应失败)**

在 `server/src/agentos/agent-tree.config.spec.ts` 的防回归快照里,把 outline-writer 的 tools(在 outliner.children 内,约第 222-232 行):

```ts
                tools: [
                  'list_knowledge',
                  'get_knowledge',
                  'set_volume',
                  'set_chapter_plan',
                  'get_outline',
                  'get_chapter_plan',
                  'get_novel_info',
                  'get_worldview',
                  'get_world_entry',
                  'query_memory',
                ],
```

改为(在 `get_chapter_plan` 后插入 `get_chapter`):

```ts
                tools: [
                  'list_knowledge',
                  'get_knowledge',
                  'set_volume',
                  'set_chapter_plan',
                  'get_outline',
                  'get_chapter_plan',
                  'get_chapter',
                  'get_novel_info',
                  'get_worldview',
                  'get_world_entry',
                  'query_memory',
                ],
```

然后在 `describe('AGENT_TREE 结构(防回归快照)')` 块内、现有 validator 断言之后,新增一条正向断言:

```ts
    it('outline-writer 能读实际正文(改写模式 accept-written-as-truth 的数据源)', () => {
      const outliner = AGENT_TREE.subagents!.find((s) => s.name === 'outliner')!;
      const outlineWriter = outliner.subagents!.find(
        (s) => s.name === 'outline-writer',
      )!;
      expect(outlineWriter.tools).toContain('get_chapter');
    });
```

- [ ] **Step 2: 跑测试,确认失败(配置还没改)**

Run: `cd /Users/taowen/project/narratox/server && pnpm test -- agent-tree.config.spec.ts`
Expected: FAIL —— outline-writer 快照不匹配(缺 get_chapter),且新断言 `toContain('get_chapter')` 失败。

- [ ] **Step 3: 改配置,给 outline-writer 加工具**

在 `server/src/agentos/agent-tree.config.ts` 的 outline-writer spec(约第 199-216 行),把 tools 里 `'get_chapter_plan',` 那行之后插入 `'get_chapter',`:

```ts
          tools: [
            'list_knowledge',
            'get_knowledge',
            'set_volume',
            'set_chapter_plan',
            'get_outline',
            'get_chapter_plan',
            'get_chapter',
            'get_novel_info',
            'get_worldview',
            'get_world_entry',
            'query_memory',
          ],
```

- [ ] **Step 4: 跑测试,确认通过**

Run: `cd /Users/taowen/project/narratox/server && pnpm test -- agent-tree.config.spec.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
cd /Users/taowen/project/narratox && git add server/src/agentos/agent-tree.config.ts server/src/agentos/agent-tree.config.spec.ts
git commit -m "feat(agent): outline-writer += get_chapter(改写模式读实际正文)

改写细纲要 accept-written-as-truth:必须能读实际正文,不能只靠
validator 描述经 4 跳中继。快照同步 + 正向断言。"
```

---

## Task 2:接通信号链(4 处 prompt)

**Files:**
- Modify: `server/src/agentos/agent-prompts.ts`(CHAPTER_ORCH / MAIN / OUTLINER_ORCH / OUTLINE_WRITER)

> 4 处 prompt 改动无文本断言(惯例);本任务的「测试」是全量 `pnpm test` 不回归 + `pnpm typecheck` 过。

- [ ] **Step 1: CHAPTER_ORCH 结论带回「细纲过时」信号**

把 `CHAPTER_ORCHESTRATOR_PROMPT` 的 step 5 + 【铁律】之间(约第 141-143 行):

```
5. 回复主 agent 一句结论(如「第N章已写完+结算+校验,score 88」或「发现X,已修订复校通过」)。

【铁律】
```

替换为(中间插入【细纲过时信号】):

```
5. 回复主 agent 一句结论(如「第N章已写完+结算+校验,score 88」或「发现X,已修订复校通过」)。

【细纲过时信号】
- 若 validator 在 dim 12 标了「细纲过时」note,你的结论里【必须明确带回】:「第 N 章偏离细纲——实际走向 X,原细纲 Y,【建议改写细纲】」,让主 agent 据此委派 outliner 改写。
- 这是 note 不是 blocking,不阻断本章(已写为实),只触发大纲改写。

【铁律】
```

- [ ] **Step 2: MAIN 识别并委派 outliner 改写**

把 `MAIN_AGENT_PROMPT` 写作阶段的细纲行(约第 106 行):

```
- 细纲:第 N 章没细纲时,先 task 委派 outliner「补第 N 章细纲」,等它结论回来,再委派 chapter 写。
```

替换为(追加一条改写回馈):

```
- 细纲:第 N 章没细纲时,先 task 委派 outliner「补第 N 章细纲」,等它结论回来,再委派 chapter 写。
- 细纲改写回馈:若 chapter agent 结论带回「细纲过时,建议改写细纲」(正文偏离了原细纲),用 task 委派 outliner「改写第 N 章(及紧邻下游)细纲——实际走向是 X,请把第 N 章细纲改到与实际一致,并核查下游 N+1.. 是否仍衔接」,等它结论回来再续写下一章。【已写的第 N 章不重写】——已写为实,只改细纲去就实。
```

- [ ] **Step 3: OUTLINER_ORCH 加「改写细纲」任务类型**

把 `OUTLINER_ORCHESTRATOR_PROMPT` 的【任务类型】补细纲行(约第 307 行):

```
- 补细纲:指定批次(如第 21-40 章)的细纲;委派 outline-writer 时让它先读既有卷骨架 + 已写进度 + 开放伏笔,往下承接规划。
```

替换为(追加改写类型):

```
- 补细纲:指定批次(如第 21-40 章)的细纲;委派 outline-writer 时让它先读既有卷骨架 + 已写进度 + 开放伏笔,往下承接规划。
- 改写细纲(因正文偏离):指定章(如第 N 章)正文已偏离原细纲——改细纲去就实。委派 outline-writer 时把实际走向 + 偏离原因传给它,让它先 get_chapter_plan(N) 看旧细纲、get_chapter(N) 看实际正文,再 set_chapter_plan 改到与实际一致,并核查下游 N+1.. 是否仍衔接(断层才改,衔接的别动)。
```

并把流程 step 1 的任务类型枚举(约第 310 行):

```
   - 先 list_knowledge+get_knowledge 取大纲方法论(优先「大纲范例集锦」「情节伏笔铺垫节奏」+ 题材对应公式)。
```

上方那行 `委派时明确指示任务类型(建纲 / 补第 M-N 章)与本书题材/故事核:` 改为:

```
   用 task 委派 outline-writer 子 agent。委派时明确指示任务类型(建纲 / 补第 M-N 章 / 改写第 N 章因偏离)与本书题材/故事核:
```

(即把 `1. 用 task 委派 outline-writer 子 agent。委派时明确指示任务类型(建纲 / 补第 M-N 章)与本书题材/故事核:` 整行替换,任务类型枚举加「改写第 N 章因偏离」。)

- [ ] **Step 4: OUTLINE_WRITER 加「改写模式」**

把 `OUTLINE_WRITER_PROMPT` 的【修订模式】末行 + 【铁律】之间(约第 353-355 行):

```
- 改前可 get_chapter_plan/get_outline 看现状再改。

【铁律】大纲只走 set_volume/set_chapter_plan;不写角色/世界观/正文。
```

替换为(中间插入【改写模式】):

```
- 改前可 get_chapter_plan/get_outline 看现状再改。

【改写模式 — 因正文偏离(accept written as truth)】若任务是改写第 N 章细纲(正文已偏离原细纲):
- 先 get_chapter_plan(N) 读旧细纲,get_chapter(N) 读实际正文(【正文是实】,细纲去就它,不重写正文)。
- 把第 N 章的 CBN/CPNs/CEN/mustCover/forbidden 改到与实际正文一致(set_chapter_plan upsert 覆盖)——细纲成为「实际发生了什么」的记录。
- 再 get_chapter_plan(N+1..) 核查下游:依赖旧走向、现已断层的,一并改写承接;仍衔接的别动。

【铁律】大纲只走 set_volume/set_chapter_plan;不写角色/世界观/正文。
```

- [ ] **Step 5: 跑全量单测,确认无回归**

Run: `cd /Users/taowen/project/narratox/server && pnpm test`
Expected: 全绿(52 套)。4 处 prompt 无文本断言;唯一相关快照(Task 1 已更新)应仍通过。

- [ ] **Step 6: typecheck**

Run: `cd /Users/taowen/project/narratox/server && pnpm typecheck`
Expected: 通过。

- [ ] **Step 7: 提交**

```bash
cd /Users/taowen/project/narratox && git add server/src/agentos/agent-prompts.ts
git commit -m "feat(agent): 接通大纲改写回馈链(Phase 10)

CHAPTER_ORCH 结论带回「细纲过时」→ MAIN 委派 outliner 改写 →
OUTLINER_ORCH 改写任务类型 → OUTLINE_WRITER 改写模式(读实际正文、
细纲去就实、核查下游)。accept-written-as-truth,不重写已写章节。
闭合 Phase 8 审视的「大纲冻结、写偏无人改」。"
```

---

## Task 3:同步 CLAUDE.md(Phase 10 入档)

**Files:**
- Modify: `CLAUDE.md`(Phase 9 标题去「current」+ Phase status 加 Phase 10 条)

- [ ] **Step 1: Phase 9 标题去掉「, current」**

`CLAUDE.md` 的 Phase 9 行,把 `- **Phase 9 (validator outline-fulfillment, current):**` 改为 `- **Phase 9 (validator outline-fulfillment):**`。

- [ ] **Step 2: 在 Phase 9 条之后、`**Deferred:**` 之前插入 Phase 10 条**

插入:

```
- **Phase 10 (outline-rewrite feedback, current):** closes the outline-freeze problem surfaced by the Phase 8 review — Phase 9's validator「细纲过时」note was a dead signal nothing consumed. The feedback loop is now wired (all prompt-driven over existing `task` delegation, accept-written-as-truth): validator dim 12 flags 细纲过时 → CHAPTER_ORCH conclusion carries「第 N 章偏离细纲,实际 X / 原 Y,建议改写细纲」→ MAIN delegates outliner「改写第 N 章(及下游)细纲」→ OUTLINER_ORCH runs a new「改写细纲」task type → outline-writer (which gained `get_chapter` to read the actual prose) rewrites `set_chapter_plan(N)` to match reality + checks downstream N+1.. for seams, then outline-critic re-reviews. The written chapter is **never rewritten** (it is ground truth; only the plan adapts) — a living outline. **No DB / FE / new agent / new tool** (outline-writer reuses the existing `get_chapter`). Spec: [2026-06-27-outline-rewrite-feedback-design.md](docs/superpowers/specs/2026-06-27-outline-rewrite-feedback-design.md). Plan: [2026-06-27-outline-rewrite-feedback.md](docs/superpowers/plans/2026-06-27-outline-rewrite-feedback.md).
```

- [ ] **Step 3: 提交**

```bash
cd /Users/taowen/project/narratox && git add CLAUDE.md
git commit -m "docs: CLAUDE.md 更新 Phase 10(大纲改写回馈)"
```

---

## Self-Review(写完后自检)

- **Spec 覆盖**:① outline-writer += get_chapter → Task 1;② CHAPTER_ORCH 结论带回信号 → Task 2 Step 1;③ MAIN 委派改写 → Task 2 Step 2;④ OUTLINER_ORCH 改写任务类型 → Task 2 Step 3;⑤ OUTLINE_WRITER 改写模式 → Task 2 Step 4;⑥ accept-written-as-truth(不重写已写)→ OUTLINE_WRITER 改写模式文本 + MAIN 文本;⑦ 不重评已写章/不硬编码下游范围 → 显式不碰。✅ 无遗漏。
- **占位符扫描**:无 TBD/TODO;每个改步骤都有逐字代码。✅
- **一致性**:`get_chapter` 与 TOOL_REGISTRY 既有 key 一致;outline-writer tools 顺序与快照逐字对齐;OUTLINER_ORCH step 1 任务类型枚举与【任务类型】三处一致(建纲/补/改写)。✅

---

## 验证未覆盖(执行后告知用户)

- 单测只锚定 outline-writer 工具 + 4 处 prompt 写到位。**整条回馈链是否真跑通**(validator 真标 → CHAPTER_ORCH 真带回 → main 真委派 → outliner 真改写)依赖模型,需活 E2E。本期不强制。
