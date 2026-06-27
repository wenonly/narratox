# 角色一致性校验(validator dim 1)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让写完一章后的角色一致性校验对照权威档案实打实地跑——给 validator 加 `get_character`/`get_characters` 工具,把 dim 1「人物一致」加深成 5 个结构化子检,复用现有 `report_review` + 修订闭环。

**Architecture:** 纯配置 + prompt 改动。validator 是写后审计员,本就有 dim 1,缺的只是权威数据源(角色档案)。补工具 + 加深维度即可,不引入新 agent / DB / FE。dim 1 由「一行空话」扩成「出场核对 / 性格 OOC / 能力越级 / 语言风格 / 弧光矛盾」5 子检,blocking 驱动修订、notes 不阻断,并与 dim 3(战力)点明分工。

**Tech Stack:** NestJS 11 + TypeScript,deepagents 声明式 agent 树(`AGENT_TREE`),jest 单测(`pnpm test`,NODE_OPTIONS=--experimental-vm-modules),`pnpm typecheck`。

**Spec:** [2026-06-27-character-consistency-validator-design.md](../specs/2026-06-27-character-consistency-validator-design.md)

---

## File Structure

- 改:`server/src/agentos/agent-tree.config.ts` — validator spec 的 `tools` 数组加两项。
- 改:`server/src/agentos/agent-prompts.ts` — `VALIDATOR_AGENT_PROMPT` 的 dim 1 重写为 5 子检 + 开头调用指引补角色工具。
- 改:`server/src/agentos/agent-tree.config.spec.ts` — 防回归快照(validator tools)同步 + 新增正向断言。

不动:DB(零迁移)、FE、CharacterService、get_character 工具、其它 agent。

---

## Task 1:给 validator 角色工具(TDD:先改快照测试 → 失败 → 改配置 → 通过)

**Files:**
- Modify: `server/src/agentos/agent-tree.config.spec.ts:150-156`(validator 快照) + 新增一个 `it()`
- Modify: `server/src/agentos/agent-tree.config.ts`(validator spec tools)

- [ ] **Step 1: 先改测试(让它期望新工具,此时应失败)**

在 `server/src/agentos/agent-tree.config.spec.ts` 的防回归快照里,把 validator 的 tools 行(约第 154 行):

```ts
                tools: ['get_chapter', 'query_memory', 'report_review'],
```

改为:

```ts
                tools: [
                  'get_chapter',
                  'get_character',
                  'get_characters',
                  'query_memory',
                  'report_review',
                ],
```

然后在 `describe('AGENT_TREE 结构(防回归快照)')` 块内(第 291 行 `});` 之前)新增一条正向断言 `it()`:

```ts
    it('validator 能查角色档案(人物一致校验的数据源)', () => {
      const chapter = AGENT_TREE.subagents!.find((s) => s.name === 'chapter')!;
      const validator = chapter.subagents!.find((s) => s.name === 'validator')!;
      expect(validator.tools).toContain('get_character');
      expect(validator.tools).toContain('get_characters');
    });
```

- [ ] **Step 2: 跑测试,确认失败(配置还没改)**

Run: `cd /Users/taowen/project/narratox/server && pnpm test -- agent-tree.config.spec.ts`
Expected: FAIL —— 快照 `tools` 不匹配(实际仍是旧 3 项),且新断言 `toContain('get_character')` 失败。

- [ ] **Step 3: 改配置,给 validator 加工具**

在 `server/src/agentos/agent-tree.config.ts` 的 validator spec(约第 126-133 行),把:

```ts
        {
          name: 'validator',
          description: '校验章节一致性/质量。',
          promptKey: 'VALIDATOR',
          promptAugment: 'validator',
          modelTier: 'short',
          tools: ['get_chapter', 'query_memory', 'report_review'],
        },
```

的 `tools` 行改为:

```ts
          tools: [
            'get_chapter',
            'get_character',
            'get_characters',
            'query_memory',
            'report_review',
          ],
```

- [ ] **Step 4: 跑测试,确认通过**

Run: `cd /Users/taowen/project/narratox/server && pnpm test -- agent-tree.config.spec.ts`
Expected: PASS(快照匹配 + 正向断言通过)。

- [ ] **Step 5: 提交**

```bash
cd /Users/taowen/project/narratox && git add server/src/agentos/agent-tree.config.ts server/src/agentos/agent-tree.config.spec.ts
git commit -m "feat(agent): validator 获得角色工具 get_character/get_characters

dim 1「人物一致」此前靠 query_memory 二手信息空跑;补权威数据源。
快照同步 + 正向断言。"
```

---

## Task 2:加深 validator dim 1 为 5 子检

**Files:**
- Modify: `server/src/agentos/agent-prompts.ts`(`VALIDATOR_AGENT_PROMPT`)

> 无 prompt 文本断言(grep 确认「人物一致」未被任何 spec 引用),项目惯例不测 prompt 文本——本任务的「测试」是全量 `pnpm test` 不回归 + `pnpm typecheck` 通过。

- [ ] **Step 1: 更新 dim 1 + 开头调用指引**

在 `server/src/agentos/agent-prompts.ts` 的 `VALIDATOR_AGENT_PROMPT`,把开头那行(约第 193 行):

```
你是小说质检员。用 get_chapter 读本章正文,用 query_memory 查已有设定/伏笔/角色。
```

改为:

```
你是小说质检员。用 get_chapter 读本章正文,用 get_characters/get_character 查角色档案,用 query_memory 查已有设定/伏笔。
```

然后把 dim 1(约第 196 行,目前是单行):

```
1. 人物一致——名字/性格/关系不与已有矛盾。
```

替换为:

```
1. 人物一致——【先 get_characters 列全部角色核对出场,再对每个出场角色 get_character(name) 取 profile+currentState 逐项查】:
   · 出场核对:正文出现但档案里没有的角色 → note(可能笔误,或新角色 writer 未登记→提示 settler/character agent 补)。
   · 性格 OOC:行为/对白与 personality 基线(或 currentState.personality)核心反转,且本章无催化剂 → blocking。
   · 能力越级:用了 profile/currentState.ability 里未建立的能力且无解释 → blocking。(注:世界力量体系层面的越级归 dim 3;本项只管「这个角色还没被建立到这个程度」。)
   · 语言风格:对白漂离 voice 基线 → note(严重且持续才升 blocking)。
   · 弧光矛盾:行为颠覆 arcGoal 方向且无铺垫 → blocking。
```

- [ ] **Step 2: 跑全量单测,确认无回归**

Run: `cd /Users/taowen/project/narratox/server && pnpm test`
Expected: 全绿(52 套)。dim 1 无文本断言;唯一相关的是 Task 1 已更新的快照——应仍通过。

- [ ] **Step 3: typecheck**

Run: `cd /Users/taowen/project/narratox/server && pnpm typecheck`
Expected: 通过(prompt 是字符串,改动不影响类型;但按惯例确认)。

- [ ] **Step 4: 提交**

```bash
cd /Users/taowen/project/narratox && git add server/src/agentos/agent-prompts.ts
git commit -m "feat(agent): validator dim 1 加深为角色一致性 5 子检

出场核对/性格OOC/能力越级/语言风格/弧光矛盾;前3+弧光 blocking,
voice 漂移 note。点明与 dim 3(战力)分工。闭合 Phase 6 的注入→写→审闭环。"
```

---

## Self-Review(写完后自检)

- **Spec 覆盖**:① validator 获得工具 → Task 1;② dim 1 加深 5 子检 → Task 2;③ 快照同步 + 正向断言 → Task 1 Step 1;④ 与 dim 3 分工 → Task 2 dim 1 文本里点名;⑤ 连续性不做、不动 settler/DB/FE → 本计划无相关任务(显式不碰)。✅ 无遗漏。
- **占位符扫描**:无 TBD/TODO;每个改步骤都有逐字代码。✅
- **类型/命名一致**:`get_character`/`get_characters` 与 TOOL_REGISTRY 现有 key(writer/char-critic 已用)一致;validator tools 顺序与快照逐字对齐。✅

---

## 验证未覆盖(执行后告知用户)

- 单测只验证「validator 拿到工具 + dim 1 文本写到位」。**实际能否抓出 OOC** 依赖模型,需活 E2E(配好模型 + DB,故意写一章 OOC 看 validator 是否报 blocking)。本期不强制;用户要时可起 `pnpm dev` 实测。
