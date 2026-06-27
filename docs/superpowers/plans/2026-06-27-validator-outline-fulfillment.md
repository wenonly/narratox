# validator 细纲兑现校验 实施计划(Phase 9)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 validator 读细纲能力(`get_chapter_plan`)+ 第 12 维「细纲兑现」,区分 blocking(章节未兑现)vs note(细纲过时,为 Phase 10 大纲改写回馈埋触发点)。

**Architecture:** 纯配置 + prompt。validator 是写后审计员,补细纲数据源 + 加兑现维度即可。dim 12 追加(不重编号,保护 dim 1 内「归 dim 3」交叉引用)。零 DB / FE / 新 agent / 新工具。

**Tech Stack:** NestJS 11 + TypeScript,deepagents 声明式 agent 树,jest 单测(`pnpm test`,NODE_OPTIONS=--experimental-vm-modules),`pnpm typecheck`。

**Spec:** [2026-06-27-validator-outline-fulfillment-design.md](../specs/2026-06-27-validator-outline-fulfillment-design.md)

---

## File Structure

- 改:`server/src/agentos/agent-tree.config.ts` — validator spec 的 `tools` 加一项。
- 改:`server/src/agentos/agent-prompts.ts` — `VALIDATOR_AGENT_PROMPT` 开篇行 + 「11 维」→「12 维」+ 追加 dim 12。
- 改:`server/src/agentos/agent-tree.config.spec.ts` — 防回归快照同步 + 新增正向断言。

不动:DB、FE、新工具、新 agent、大纲改写闭环(Phase 10)、get_chapter_plan 工具、其它 agent。

---

## Task 1:给 validator 细纲工具(TDD:先改快照测试 → 失败 → 改配置 → 通过)

**Files:**
- Modify: `server/src/agentos/agent-tree.config.spec.ts`(validator 快照 + 新增 `it()`)
- Modify: `server/src/agentos/agent-tree.config.ts`(validator spec tools)

- [ ] **Step 1: 先改测试(让它期望新工具,此时应失败)**

在 `server/src/agentos/agent-tree.config.spec.ts` 的防回归快照里,把 validator 的 tools(约第 154-160 行):

```ts
                tools: [
                  'get_chapter',
                  'get_character',
                  'get_characters',
                  'query_memory',
                  'report_review',
                ],
```

改为:

```ts
                tools: [
                  'get_chapter',
                  'get_chapter_plan',
                  'get_character',
                  'get_characters',
                  'query_memory',
                  'report_review',
                ],
```

然后在 `describe('AGENT_TREE 结构(防回归快照)')` 块内、现有「validator 能查角色档案」断言之后,新增一条正向断言:

```ts
    it('validator 能读细纲(细纲兑现校验的数据源)', () => {
      const chapter = AGENT_TREE.subagents!.find((s) => s.name === 'chapter')!;
      const validator = chapter.subagents!.find((s) => s.name === 'validator')!;
      expect(validator.tools).toContain('get_chapter_plan');
    });
```

- [ ] **Step 2: 跑测试,确认失败(配置还没改)**

Run: `cd /Users/taowen/project/narratox/server && pnpm test -- agent-tree.config.spec.ts`
Expected: FAIL —— 快照 `tools` 不匹配(实际仍 5 项,缺 get_chapter_plan),且新断言 `toContain('get_chapter_plan')` 失败。

- [ ] **Step 3: 改配置,给 validator 加工具**

在 `server/src/agentos/agent-tree.config.ts` 的 validator spec(约第 127-139 行),把:

```ts
          tools: [
            'get_chapter',
            'get_character',
            'get_characters',
            'query_memory',
            'report_review',
          ],
```

改为:

```ts
          tools: [
            'get_chapter',
            'get_chapter_plan',
            'get_character',
            'get_characters',
            'query_memory',
            'report_review',
          ],
```

- [ ] **Step 4: 跑测试,确认通过**

Run: `cd /Users/taowen/project/narratox/server && pnpm test -- agent-tree.config.spec.ts`
Expected: PASS(快照匹配 + 两条正向断言通过)。

- [ ] **Step 5: 提交**

```bash
cd /Users/taowen/project/narratox && git add server/src/agentos/agent-tree.config.ts server/src/agentos/agent-tree.config.spec.ts
git commit -m "feat(agent): validator 获得细纲工具 get_chapter_plan

validator 此前读不到细纲,无法对账「正文是否兑现计划」。补细纲数据源。
快照同步 + 正向断言。"
```

---

## Task 2:加 VALIDATOR dim 12「细纲兑现」

**Files:**
- Modify: `server/src/agentos/agent-prompts.ts`(`VALIDATOR_AGENT_PROMPT`)

> 无 prompt 文本断言;本任务的「测试」是全量 `pnpm test` 不回归 + `pnpm typecheck` 通过。

- [ ] **Step 1: 开篇行加 get_chapter_plan**

把 `VALIDATOR_AGENT_PROMPT` 开篇行(约第 199 行):

```
你是小说质检员。用 get_chapter 读本章正文,用 get_characters/get_character 查角色档案,用 query_memory 查已有设定/伏笔。
```

改为:

```
你是小说质检员。用 get_chapter 读本章正文,用 get_chapter_plan(N) 读本章细纲,用 get_characters/get_character 查角色档案,用 query_memory 查已有设定/伏笔。
```

- [ ] **Step 2: 「11 维」→「12 维」**

把(约第 201 行):

```
按以下 11 维逐项审计(每维 pass / issue;第 11 维仅当上下文含【作者画像】时审计):
```

改为:

```
按以下 12 维逐项审计(每维 pass / issue;第 11 维仅当上下文含【作者画像】时审计):
```

- [ ] **Step 3: 追加 dim 12(置于 dim 11 之后、report_review 指令之前)**

把 dim 11 末尾 + report_review 指令开头(约第 217-219 行):

```
命中「要避免」项 = issue。

审计完【必须调 report_review】提交结构化判定:
```

替换为(中间插入 dim 12):

```
命中「要避免」项 = issue。
12. 细纲兑现——【先 get_chapter_plan(N) 读本章细纲(CBN/CPNs/CEN + 必须覆盖/禁区),再对照本章正文逐项核】:
   · 必须覆盖(mustCover)有遗漏 → blocking(章节未兑现计划的核心点)。
   · 触碰禁区(forbidden)→ blocking。
   · CBN/CPNs/CEN 节点严重缺失(开篇/情节/结尾骨架没写)→ blocking。
   · 正文走向优于原细纲、或原细纲本身已过时/有误(计划与实际脱节但章节没问题)→ note,并在 issue 里【明确标「细纲过时,建议改写细纲」+ 说明实际走向】,供编排者决定是否委派 outliner 改写(走改写路线,不在此改)。

审计完【必须调 report_review】提交结构化判定:
```

- [ ] **Step 4: 跑全量单测,确认无回归**

Run: `cd /Users/taowen/project/narratox/server && pnpm test`
Expected: 全绿(52 套)。dim 12 无文本断言;唯一相关快照(Task 1 已更新)应仍通过。

- [ ] **Step 5: typecheck**

Run: `cd /Users/taowen/project/narratox/server && pnpm typecheck`
Expected: 通过。

- [ ] **Step 6: 提交**

```bash
cd /Users/taowen/project/narratox && git add server/src/agentos/agent-prompts.ts
git commit -m "feat(agent): validator dim 12 细纲兑现校验

对照 get_chapter_plan(N) 核 mustCover/forbidden/CBN·CPNs·CEN。
blocking=章节未兑现(改章);note=细纲过时(标实际走向,供 Phase 10
委派 outliner 改写)。闭合 Phase 8 审视的「大纲冻结、写偏无人查」。"
```

---

## Task 3:同步 CLAUDE.md(Phase 9 入档)

**Files:**
- Modify: `CLAUDE.md`(Phase 8 标题去「current」+ Phase status 加 Phase 9 条)

- [ ] **Step 1: Phase 8 标题去掉「, current」**

`CLAUDE.md` 的 Phase 8 行,把:

```
- **Phase 8 (writer chapter-continuity, current):**
```

改为:

```
- **Phase 8 (writer chapter-continuity):**
```

- [ ] **Step 2: 在 Phase 8 条之后、`**Deferred:**` 之前插入 Phase 9 条**

插入:

```
- **Phase 9 (validator outline-fulfillment, current):** closes the outline-coherence gap surfaced by the Phase 8 architecture review — the validator could not read the chapter plan (no `get_chapter_plan`) and had no dimension checking whether the written chapter fulfilled its 细纲, so outlines were frozen and deviations went unchecked. validator gained `get_chapter_plan` + a new dim 12 「细纲兑现」 (appended, not renumbered — protects dim 1's "归 dim 3" cross-reference): check mustCover covered / forbidden avoided / CBN·CPNs·CEN骨架 hit. Deviations split into two classes: **blocking** (chapter failed to fulfill the plan — missed mustCover / hit forbidden / 骨架 missing → drives the existing revision loop) vs **note** (细纲过时 — the chapter went a better direction or the plan itself was wrong → flag 「细纲过时,建议改写细纲」 + actual direction). The note is the trigger point for Phase 10's outline-rewrite feedback (validator only flags; the outliner agent does the rewrite). **No DB / FE / new agent / new tool** — reuses `get_chapter_plan`. Spec: [2026-06-27-validator-outline-fulfillment-design.md](docs/superpowers/specs/2026-06-27-validator-outline-fulfillment-design.md). Plan: [2026-06-27-validator-outline-fulfillment.md](docs/superpowers/plans/2026-06-27-validator-outline-fulfillment.md).
```

- [ ] **Step 3: 提交**

```bash
cd /Users/taowen/project/narratox && git add CLAUDE.md
git commit -m "docs: CLAUDE.md 更新 Phase 9(validator 细纲兑现校验)"
```

---

## Self-Review(写完后自检)

- **Spec 覆盖**:① validator 获 get_chapter_plan → Task 1;② dim 12 兑现维度 → Task 2;③ 快照+正向断言 → Task 1 Step 1;④ 区分 blocking vs note(细纲过时)→ dim 12 文本;⑤ 为 Phase 10 埋触发点 → dim 12 note 文本;⑥ 不改大纲/不加 get_outline/不重编号 → 显式不碰。✅ 无遗漏。
- **占位符扫描**:无 TBD/TODO;每个改步骤都有逐字代码。✅
- **一致性**:`get_chapter_plan` 与 TOOL_REGISTRY 现有 key(writer/main 已用)一致;validator tools 顺序与快照逐字对齐;dim 12 追加不破坏 dim 1「归 dim 3」引用。✅

---

## 验证未覆盖(执行后告知用户)

- 单测只验证「validator 拿到工具 + dim 12 文本写到位」。**实际能否抓出写偏、能否准确区分「章节未兑现」vs「细纲过时」**依赖模型,需活 E2E。本期不强制。
