# 删除大纲/世界观/角色 agent — 合并能力给 main 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `outliner` / `worldbuilder` / `character` 三棵子树的 orchestrator + writer 共 6 个节点合并进 `main`(main 直接干 + 拿 19 个新工具);三个 critic 各自作为独立子 agent 保留(扁平挂 main 下)。

**Architecture:** AGENT_TREE 减 6 节点(2 orch × 3 + 各自 writer × 3)、加 3 个扁平 critic 节点。`main.tools` 从 16 → 35。三个 critic.md prompt 不动(reviewer 视角与 producer 解耦);三个 writer.md + 三个 orch.md 删除(方法论蒸馏进 main.md)。Phase 9/10/18/20/21 反馈回路与方法论语义保留。

**Tech Stack:** NestJS 11 + TypeScript + jest + 声明式 AGENT_TREE 配置(`agent-tree.config.ts`)+ markdown 驱动 prompt(`agent-prompts.ts` loader)。

**Spec:** [docs/superpowers/specs/2026-07-13-remove-outliner-agent-design.md](../specs/2026-07-13-remove-outliner-agent-design.md)

---

## 文件结构

**测试文件(先改,RED):**
- `server/src/agentos/agent-prompts.spec.ts` — 删 6 个 SUBSTRING 条目 + 4 个独立测试 + import/计数
- `server/src/agentos/agent-tree.config.spec.ts` — 重写 AGENT_TREE 快照 + 删/改 4 个子测试
- `server/src/agentos/agent-tree.roster.spec.ts` — 把 `wb-writer/outline-writer/char-writer` 换成 `wb-critic/outline-critic/char-critic`

**代码文件(再改,GREEN):**
- `server/src/agentos/agent-tree.config.ts` — PROMPTS map 删 6 键、AGENT_TREE 重构、main.tools 加 19
- `server/src/agentos/agent-prompts.ts` — 删 6 个 export

**删除文件:**
- `server/src/agentos/prompts/outliner-orchestrator.md`
- `server/src/agentos/prompts/outline-writer.md`
- `server/src/agentos/prompts/worldbuilder-orchestrator.md`
- `server/src/agentos/prompts/worldbuilder-writer.md`
- `server/src/agentos/prompts/character-orchestrator.md`
- `server/src/agentos/prompts/character-writer.md`

**Prompt 内容(GREEN 后):**
- `server/src/agentos/prompts/main.md` — 大改:加 6 节、改 4 节
- `server/src/agentos/prompts/main-role-reminder.md` — 改 1 行
- `server/src/agentos/prompts/chapter-orchestrator.md` — 微调第 24 行
- `server/src/agentos/prompts/validator.md` — 微调第 33 行

**不动项(验证):**
- `agent-tree.groups.spec.ts` / `agent-model.controller.spec.ts` — 用 `arrayContaining` / 动态调用,自动兼容
- `outline-critic.md` / `worldbuilder-critic.md` / `character-critic.md` — reviewer 视角,内容无 producer 依赖
- `TOOL_REGISTRY` / `describeTree` / `buildAgentGroups` / `buildAgentRoster` — 派生函数,自动跟进

---

### Task 1: 更新 `agent-prompts.spec.ts`(RED — 删 6 条 SUBSTRING + 4 个独立测试)

**Files:**
- Modify: `server/src/agentos/agent-prompts.spec.ts`

- [ ] **Step 1: 改 import 块,删 6 个常量**

把 `server/src/agentos/agent-prompts.spec.ts:1-18` 的 import 替换为(删 `WORLDBUILDER_ORCHESTRATOR_PROMPT` / `WORLDBUILDER_WRITER_PROMPT` / `OUTLINER_ORCHESTRATOR_PROMPT` / `OUTLINE_WRITER_PROMPT` / `CHARACTER_ORCHESTRATOR_PROMPT` / `CHARACTER_WRITER_PROMPT`):

```ts
import {
  WRITER_AGENT_PROMPT,
  MAIN_ROLE_REMINDER,
  MAIN_AGENT_PROMPT,
  CHAPTER_ORCHESTRATOR_PROMPT,
  SETTLER_AGENT_PROMPT,
  VALIDATOR_AGENT_PROMPT,
  CURATOR_AGENT_PROMPT,
  WORLDBUILDER_CRITIC_PROMPT,
  OUTLINE_CRITIC_PROMPT,
  CHARACTER_CRITIC_PROMPT,
} from './agent-prompts';
import { AGENT_TREE, PROMPTS, collectSpecs } from './agent-tree.config';
```

- [ ] **Step 2: 改 ALL 对象,同步删 6 键**

把 `agent-prompts.spec.ts:21-38` 的 `const ALL = {...}` 替换为:

```ts
const ALL = {
  WRITER_AGENT_PROMPT,
  MAIN_ROLE_REMINDER,
  MAIN_AGENT_PROMPT,
  CHAPTER_ORCHESTRATOR_PROMPT,
  SETTLER_AGENT_PROMPT,
  VALIDATOR_AGENT_PROMPT,
  CURATOR_AGENT_PROMPT,
  WORLDBUILDER_CRITIC_PROMPT,
  OUTLINE_CRITIC_PROMPT,
  CHARACTER_CRITIC_PROMPT,
};
```

- [ ] **Step 3: 改"16 个常量"测试为"10 个常量"**

把 `agent-prompts.spec.ts:41` 的 `it('16 个常量都是非空字符串', ...)` 改为 `it('10 个常量都是非空字符串', ...)`,把 `agent-prompts.spec.ts:49` 的 `expect(Object.keys(ALL)).toHaveLength(16);` 改为 `expect(Object.keys(ALL)).toHaveLength(10);`。

- [ ] **Step 4: 删 SUBSTRINGS 里 6 条 + 删 4 个独立测试**

把 `agent-prompts.spec.ts:68-85` 的 `const SUBSTRINGS` 替换为(删 WB_ORCH / WB_WRITER / OUTLINER_ORCH / OUTLINE_WRITER / CHAR_ORCH / CHAR_WRITER 六键):

```ts
  const SUBSTRINGS: Record<string, string> = {
    WRITER_AGENT_PROMPT: '【写前必读 step 0 — 动笔前一次性把上下文读齐】',
    MAIN_AGENT_PROMPT: '你是【交互式编排者】',
    MAIN_ROLE_REMINDER: '每轮【只做一件事】',
    CHAPTER_ORCHESTRATOR_PROMPT: '写→结算→校验',
    SETTLER_AGENT_PROMPT: '每个必标 payoffTiming',
    VALIDATOR_AGENT_PROMPT: '细纲兑现',
    CURATOR_AGENT_PROMPT: '增量维护',
    WORLDBUILDER_CRITIC_PROMPT: 'report_worldview_review',
    OUTLINE_CRITIC_PROMPT: 'report_outline_review',
    CHARACTER_CRITIC_PROMPT: 'report_character_review',
  };
```

删掉 `agent-prompts.spec.ts:92-112` 这四个 `it(...)` 块:
- `it('outliner-orchestrator 含 4 类路由表与简化路线铁律', ...)`
- `it('outline-writer 含减法任务禁止补全纪律', ...)`
- `it('character-orchestrator 含 4 类路由表与简化路线铁律', ...)`
- `it('character-writer 含减法任务禁止补全纪律', ...)`

保留后面的 `it('PROMPTS 的 key 集合 == AGENT_TREE 所有 promptKey ...')`。

- [ ] **Step 5: 跑测试,确认仍 PASS**

Run: `pnpm --dir server test -- agent-prompts.spec.ts`
Expected: PASS。这一步是"提前清理测试文件对将要删除常量的引用"——被删的 6 个 export 此刻在 agent-prompts.ts 里仍然存在,所以测试不会因为 import 缺失而 fail;只是测试文件里不再引用它们。真正的 RED 来自 Task 2/3(snapshot 与 roster 改动)。

---

### Task 2: 更新 `agent-tree.config.spec.ts`(RED — 重写 AGENT_TREE 快照 + 删/改 4 个子测试)

**Files:**
- Modify: `server/src/agentos/agent-tree.config.spec.ts`

- [ ] **Step 1: 重写 AGENT_TREE 快照(替换 `agent-tree.config.spec.ts:84-312`)**

把 `it('整棵树名字+工具+层级与设计一致', ...)` 整个替换为下面这段(注意 main.tools 从 16 → 35;`worldbuilder`/`outliner`/`character` 三个 orch 子树消失;`outline-critic` / `wb-critic` / `char-critic` 直接挂 main 下):

```ts
    it('整棵树名字+工具+层级与设计一致', () => {
      expect(describeTree(AGENT_TREE)).toEqual({
        name: 'main',
        promptKey: 'MAIN',
        tier: 'long',
        tools: [
          'get_novel_info',
          'update_novel',
          'get_reading_chapter',
          'get_outline',
          'get_chapter_plan',
          'get_worldview',
          'get_world_entry',
          'get_character',
          'get_characters',
          'get_events',
          'get_arcs',
          'get_reference',
          'add_reference',
          'update_reference',
          'delete_reference',
          'get_benchmark',
          'set_master_outline',
          'set_volume',
          'set_arc',
          'set_chapter_plan',
          'patch_chapter_plan',
          'delete_chapter_plan',
          'delete_volume',
          'delete_arc',
          'clear_master_outline',
          'set_world_entry',
          'set_character',
          'delete_character',
          'clear_characters',
          'list_knowledge',
          'get_knowledge',
          'query_memory',
          'report_outline_review',
          'report_worldview_review',
          'report_character_review',
        ],
        children: [
          {
            name: 'chapter',
            promptKey: 'CHAPTER_ORCH',
            tier: 'long',
            tools: ['snapshot_chapter', 'restore_chapter', 'check_prose'],
            children: [
              {
                name: 'writer',
                promptKey: 'WRITER',
                tier: 'long',
                tools: [
                  'append_section',
                  'replace_text',
                  'insert_text',
                  'delete_text',
                  'clear_chapter',
                  'set_chapter_title',
                  'get_chapter',
                  'list_chapters',
                  'query_memory',
                  'get_outline',
                  'get_chapter_plan',
                  'get_worldview',
                  'get_world_entry',
                  'get_character',
                  'get_characters',
                  'get_character_history',
                  'get_events',
                  'get_arcs',
                  'get_reference',
                  'get_benchmark',
                ],
                children: [],
              },
              {
                name: 'settler',
                promptKey: 'SETTLER',
                tier: 'short',
                tools: ['get_chapter', 'write_summary'],
                children: [],
              },
              {
                name: 'validator',
                promptKey: 'VALIDATOR',
                tier: 'short',
                tools: [
                  'get_chapter',
                  'get_chapter_plan',
                  'get_character',
                  'get_characters',
                  'get_character_history',
                  'get_events',
                  'query_memory',
                  'report_review',
                ],
                children: [],
              },
            ],
          },
          {
            name: 'curator',
            promptKey: 'CURATOR',
            tier: 'long',
            tools: [
              'list_knowledge',
              'get_knowledge',
              'set_references',
              'get_reference',
              'add_reference',
              'update_reference',
              'delete_reference',
            ],
            children: [],
          },
          {
            name: 'outline-critic',
            promptKey: 'OUTLINE_CRITIC',
            tier: 'short',
            tools: [
              'get_outline',
              'get_chapter_plan',
              'get_novel_info',
              'get_worldview',
              'get_world_entry',
              'query_memory',
              'report_outline_review',
            ],
            children: [],
          },
          {
            name: 'wb-critic',
            promptKey: 'WB_CRITIC',
            tier: 'short',
            tools: [
              'get_worldview',
              'get_world_entry',
              'get_novel_info',
              'report_worldview_review',
            ],
            children: [],
          },
          {
            name: 'char-critic',
            promptKey: 'CHAR_CRITIC',
            tier: 'short',
            tools: [
              'get_character',
              'get_characters',
              'get_worldview',
              'get_world_entry',
              'get_outline',
              'get_novel_info',
              'query_memory',
              'report_character_review',
            ],
            children: [],
          },
        ],
      });
    });
```

- [ ] **Step 2: 删掉 3 个引用已删子树的子测试**

删除以下三个 `it(...)` 块(它们引用的 `outliner.subagents.find('outline-writer')` / `character.subagents.find('char-writer')` / `character.subagents.find('char-critic')` 路径已不存在):

- `it('outline-writer 能读实际正文(改写模式 accept-written-as-truth 的数据源)', ...)` (about line 327)
- `it('char-writer 拥有 delete_character / clear_characters(角色删除/清空套件)', ...)` (about line 337)
- `it('char-critic 没有删除工具(只读评审,不带删权)', ...)` (about line 349)

- [ ] **Step 3: 改"outline-writer 能建弧线"为"main 能建弧线"**

把 `it('outline-writer 能建弧线(set_arc);writer/main 能读弧线(get_arcs)', ...)` 整个替换为:

```ts
    it('main 能建弧线(set_arc);writer 能读弧线(get_arcs)', () => {
      expect(AGENT_TREE.tools).toContain('get_arcs');
      expect(AGENT_TREE.tools).toContain('set_arc');
      const chapter = AGENT_TREE.subagents!.find((s) => s.name === 'chapter')!;
      expect(
        chapter.subagents!.find((s) => s.name === 'writer')!.tools,
      ).toContain('get_arcs');
    });
```

- [ ] **Step 4: 改"main/writer/outline-writer 都能拉对标"为"main/writer 都能拉对标"**

把 `it('main/writer/outline-writer 都能拉对标(get_benchmark)', ...)` 整个替换为:

```ts
    it('main/writer 都能拉对标(get_benchmark)', () => {
      expect(AGENT_TREE.tools).toContain('get_benchmark');
      const chapter = AGENT_TREE.subagents!.find((s) => s.name === 'chapter')!;
      expect(
        chapter.subagents!.find((s) => s.name === 'writer')!.tools,
      ).toContain('get_benchmark');
    });
```

- [ ] **Step 5: 跑测试,确认 RED**

Run: `pnpm --dir server test -- agent-tree.config.spec.ts`
Expected: FAIL(快照不匹配 + 3 个 deleted subtests 找不到节点)。

---

### Task 3: 更新 `agent-tree.roster.spec.ts`(RED — 替换角色名)

**Files:**
- Modify: `server/src/agentos/agent-tree.roster.spec.ts`

- [ ] **Step 1: 替换 roster 角色名清单**

把 `agent-tree.roster.spec.ts:11-21` 的 `for (const name of [...])` 数组替换为(把 `wb-writer` / `outline-writer` / `char-writer` 换成三个独立 critic):

```ts
    for (const name of [
      'main',
      'writer',
      'validator',
      'settler',
      'outline-critic',
      'wb-critic',
      'char-critic',
    ]) {
      expect(roster).toContain(name);
    }
```

- [ ] **Step 2: 跑测试,确认 RED**

Run: `pnpm --dir server test -- agent-tree.roster.spec.ts`
Expected: FAIL(roster 仍含旧 writer 名,新 critic 名未出现)。

---

### Task 4: 重构 `agent-tree.config.ts`(GREEN — PROMPTS map + AGENT_TREE + main.tools)

**Files:**
- Modify: `server/src/agentos/agent-tree.config.ts`

- [ ] **Step 1: 删 PROMPTS map 里 6 个键**

把 `agent-tree.config.ts:41-57` 的 `export const PROMPTS` 替换为:

```ts
export const PROMPTS: Record<string, string> = {
  MAIN: P.MAIN_AGENT_PROMPT,
  CHAPTER_ORCH: P.CHAPTER_ORCHESTRATOR_PROMPT,
  WRITER: P.WRITER_AGENT_PROMPT,
  SETTLER: P.SETTLER_AGENT_PROMPT,
  VALIDATOR: P.VALIDATOR_AGENT_PROMPT,
  CURATOR: P.CURATOR_AGENT_PROMPT,
  OUTLINE_CRITIC: P.OUTLINE_CRITIC_PROMPT,
  WB_CRITIC: P.WORLDBUILDER_CRITIC_PROMPT,
  CHAR_CRITIC: P.CHARACTER_CRITIC_PROMPT,
};
```

- [ ] **Step 2: 扩 main.tools(加 19 个工具)**

把 `agent-tree.config.ts:86-103` 的 main `tools: [...]` 替换为:

```ts
  tools: [
    'get_novel_info',
    'update_novel',
    'get_reading_chapter',
    'get_outline',
    'get_chapter_plan',
    'get_worldview',
    'get_world_entry',
    'get_character',
    'get_characters',
    'get_events',
    'get_arcs',
    'get_reference',
    'add_reference',
    'update_reference',
    'delete_reference',
    'get_benchmark',
    'set_master_outline',
    'set_volume',
    'set_arc',
    'set_chapter_plan',
    'patch_chapter_plan',
    'delete_chapter_plan',
    'delete_volume',
    'delete_arc',
    'clear_master_outline',
    'set_world_entry',
    'set_character',
    'delete_character',
    'clear_characters',
    'list_knowledge',
    'get_knowledge',
    'query_memory',
    'report_outline_review',
    'report_worldview_review',
    'report_character_review',
  ],
```

- [ ] **Step 3: 删 worldbuilder + outliner + character 三棵子树,加 3 个扁平 critic**

把 `agent-tree.config.ts:188-333` 的三棵子树(从 `{ name: 'worldbuilder', ... }` 开始到 `character` 子树结束的 `}`)替换为下面三个扁平节点(顺序保持:chapter → curator → outline-critic → wb-critic → char-critic):

```ts
    {
      name: 'outline-critic',
      description:
        '大纲质检员(6 维结构化评审 + 总纲自检)。建大纲后 main 自动委派;改大纲后作者可选委派;作者主动要审也可委派。调 report_outline_review 给 passed/score/blockingIssues。',
      promptKey: 'OUTLINE_CRITIC',
      modelTier: 'short',
      recommendedTier: 'strong',
      tools: [
        'get_outline',
        'get_chapter_plan',
        'get_novel_info',
        'get_worldview',
        'get_world_entry',
        'query_memory',
        'report_outline_review',
      ],
    },
    {
      name: 'wb-critic',
      description:
        '世界观质检员(6 维 KB-grounded 评审)。建世界观后 main 自动委派;改世界观后作者可选委派;作者主动要审也可委派。调 report_worldview_review 给 passed/score/blockingIssues。',
      promptKey: 'WB_CRITIC',
      modelTier: 'short',
      recommendedTier: 'strong',
      tools: [
        'get_worldview',
        'get_world_entry',
        'get_novel_info',
        'report_worldview_review',
      ],
    },
    {
      name: 'char-critic',
      description:
        '角色质检员(7 维评审:区分度/一致性/弧光可行性/语言风格/关系/动机/小传完整度)。建角色后 main 自动委派;改/删角色后作者可选委派;作者主动要审也可委派。调 report_character_review 给 passed/score/blockingIssues。',
      promptKey: 'CHAR_CRITIC',
      modelTier: 'short',
      recommendedTier: 'strong',
      tools: [
        'get_character',
        'get_characters',
        'get_worldview',
        'get_world_entry',
        'get_outline',
        'get_novel_info',
        'query_memory',
        'report_character_review',
      ],
    },
```

- [ ] **Step 4: 跑测试**

Run: `pnpm --dir server test -- agent-tree.config.spec.ts agent-tree.roster.spec.ts`
Expected: PASS。AGENT_TREE 快照与 roster 名单已对齐。agent-prompts.ts 仍导出 6 个未用常量(可正常 load,因为 .md 文件还未删),但没有任何测试引用它们——这是冗余状态,Task 5/6 清理。

---

### Task 5: 删 `agent-prompts.ts` 里 6 个 export(GREEN)

**Files:**
- Modify: `server/src/agentos/agent-prompts.ts`

- [ ] **Step 1: 删 6 行 export**

把 `agent-prompts.ts:56-66` 这段(从 `WORLDBUILDER_ORCHESTRATOR_PROMPT` 到 `CHARACTER_CRITIC_PROMPT` 之前)替换为只保留三个 critic:

```ts
export const CURATOR_AGENT_PROMPT = load('curator');
export const WORLDBUILDER_CRITIC_PROMPT = load('worldbuilder-critic');
export const OUTLINE_CRITIC_PROMPT = load('outline-critic');
export const CHARACTER_CRITIC_PROMPT = load('character-critic');
```

(即删 `WORLDBUILDER_ORCHESTRATOR_PROMPT` / `WORLDBUILDER_WRITER_PROMPT` / `OUTLINER_ORCHESTRATOR_PROMPT` / `OUTLINE_WRITER_PROMPT` / `CHARACTER_ORCHESTRATOR_PROMPT` / `CHARACTER_WRITER_PROMPT` 六行。)

- [ ] **Step 2: 跑全部测试**

Run: `pnpm --dir server test -- agent-prompts.spec.ts agent-tree.config.spec.ts agent-tree.roster.spec.ts`
Expected: PASS。如有失败,根据报错逐项修正。

- [ ] **Step 3: typecheck**

Run: `pnpm --dir server typecheck`
Expected: PASS(无 TS 错误)。

---

### Task 6: 删 6 个 prompt .md 文件

**Files:**
- Delete: `server/src/agentos/prompts/outliner-orchestrator.md`
- Delete: `server/src/agentos/prompts/outline-writer.md`
- Delete: `server/src/agentos/prompts/worldbuilder-orchestrator.md`
- Delete: `server/src/agentos/prompts/worldbuilder-writer.md`
- Delete: `server/src/agentos/prompts/character-orchestrator.md`
- Delete: `server/src/agentos/prompts/character-writer.md`

- [ ] **Step 1: 删 6 个文件**

```sh
rm server/src/agentos/prompts/outliner-orchestrator.md \
   server/src/agentos/prompts/outline-writer.md \
   server/src/agentos/prompts/worldbuilder-orchestrator.md \
   server/src/agentos/prompts/worldbuilder-writer.md \
   server/src/agentos/prompts/character-orchestrator.md \
   server/src/agentos/prompts/character-writer.md
```

- [ ] **Step 2: 跑测试 + typecheck 验证 loader 不报错**

Run: `pnpm --dir server test -- agent-prompts.spec.ts` 然后 `pnpm --dir server typecheck`
Expected: PASS。loader 不再读这 6 个文件(因为 agent-prompts.ts 不再 load 它们)。

- [ ] **Step 3: 跑全量 jest 看有无其他文件误引用**

Run: `pnpm --dir server test 2>&1 | tail -40`
Expected: 全 PASS。如有失败,看是不是某个文件还 import 了已删的 prompt 常量。

- [ ] **Step 4: 提交"代码重构"里程碑**

```sh
git add server/src/agentos/agent-prompts.ts \
        server/src/agentos/agent-prompts.spec.ts \
        server/src/agentos/agent-tree.config.ts \
        server/src/agentos/agent-tree.config.spec.ts \
        server/src/agentos/agent-tree.roster.spec.ts \
        server/src/agentos/prompts/outliner-orchestrator.md \
        server/src/agentos/prompts/outline-writer.md \
        server/src/agentos/prompts/worldbuilder-orchestrator.md \
        server/src/agentos/prompts/worldbuilder-writer.md \
        server/src/agentos/prompts/character-orchestrator.md \
        server/src/agentos/prompts/character-writer.md
git commit -m "$(cat <<'EOF'
refactor(agent-tree): 删 3 棵子树的 orch+writer,合并能力给 main

outliner / worldbuilder / character 三棵子树的 orchestrator + writer
共 6 节点合并进 main(main 直接建/改/删大纲/世界观/角色);
三个 critic 各自作为扁平独立子 agent 保留(挂 main 下,无父 orch)。

main.tools 从 16 → 35(新增大纲写/删/patch + set_world_entry +
set_character/delete/clear + KB + query_memory + 三个 report_*_review);
AGENT_TREE 节点数 14 → 11;6 个 prompt .md 删除,3 个 critic .md 不动。

方法论蒸馏进 main.md 与三 critic.md 解耦(reviewer 视角无 producer
依赖);prompt 内容改动在下一 commit。

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

注意:此时 main.md 还没改,MAIN_AGENT_PROMPT 仍是旧的「不自己写大纲/角色/世界观」版本——agent 行为暂时矛盾。Task 7-10 修这点。

---

### Task 7: 重写 `main.md`(MAIN prompt — 蒸馏 6 节 + 改 4 节)

**Files:**
- Modify: `server/src/agentos/prompts/main.md`

- [ ] **Step 1: 用新内容整体替换 main.md**

把 `server/src/agentos/prompts/main.md` 全文替换为(注意 frontmatter 保留,body 是新内容):

```markdown
---
name: MAIN_AGENT_PROMPT
key: MAIN
title: main · 交互式编排者
description: 主 agent:一步一停,每步给建议+问作者;建世界观/大纲/角色,委派 chapter/curator 与三个 critic。
---

你是资深小说编辑+策划,在工作台里和作者一起写一本小说。你是【交互式编排者】:每一步都跟作者确认+给建议,不自己一口气跑完。

【核心原则 — 一步一停,每步给建议+问作者】
- 每轮【只做一件事】:收集 1-2 项信息 / 建一个建置阶段 / 写一章。做完就回复作者,给建议+问下一步。
- 【绝不】一口气自主跑完多个阶段(如:建完参考直接建世界直接建大纲 = 错!每步都要停)。
- 每步给基于已知信息的建议(如"从你的描述看,适合东方玄幻,要不要试试?")。

【立项(CONCEPT)— 分步收集,每次 1-2 项 + 建议】
- get_novel_info 看 missing。
- 【简介(synopsis)绝不问用户】——它是你从题材+核心冲突(最好还有世界观)综合生成的。当这些明确,你自己 update_novel(synopsis=一两句话概括全书)写进去,继续。
- 其余 missing 每轮只问最重要的 1-2 项,给建议:
  · 缺书名:"叫什么?建议从构想看可以叫《XXX》"
  · 缺类型:"什么类型?建议:东方玄幻/都市/科幻…"
  · 缺核心冲突:"主角想要什么 vs 什么阻碍?建议:…"
  · 缺字数目标:"每章多少字?网文一般 2000-4000"
  · 缺总字数目标:"全书大概多少字?建议:网文长篇 100万-300万,中篇 20-50万,从你的题材看可以 X"
  · 缺世界观:"世界观?建议从题材看…"
  · 缺文风:"什么文风?建议:冷峻/热血/轻松…"
- 用户回答 → update_novel → 再问下一批 1-2 项。
- missing 空(含你已自生成的简介)→ 停下问:"基础信息齐了。建议下一步建参考资料(curator)。要开始吗?"

【建置流水线 — 每步做完停下问,绝不自动连跑】
- curator 建完 → 停:"参考资料建好了(N 条)。建议下一步建世界观。要开始?"
- **main 自建世界观 → 委派 wb-critic 自检** → 停:"世界观建好了(N 条,score X)。建议下一步建大纲。要调整?"
- **main 自建大纲 → 委派 outline-critic 自检** → 停:"大纲建好了(N 卷 M 弧 K 章细纲,score X)。建议下一步建角色。要看大纲?"
- **main 自建角色 → 委派 char-critic 自检** → 停:"角色档案建好了(N 个,score X)。建议开始写第 1 章。要调整角色?"

【建世界观 SOP】(取代委派 worldbuilder)
- 取上下文:get_novel_info(故事核)+ list_knowledge/get_knowledge(取「设定三技·人物·世界观·金手指」「大纲范例集锦」+ 题材公式)。
- 第 1 步 建核心三件 set_world_entry:**concept**(总览:世界背景/基调)、**powerSystem**(力量体系:等级/上限/代价/来源 + 每级获得什么)、**rule**(规则/禁忌/铁律/不可为)。
- 第 2 步 按题材补 set_world_entry:location / faction / race / item / history。每条 content 几百字、有细节、能撑住后续写作,不空泛堆砌。
- 力量体系/金手指遵循 **KB 五字诀**:唯一 / 可升级 / 有限制(不能一开始太强,否则后期崩文)/ 保密(书中无人知)/ 简单明了。核心是「能升级」而非「多强大」。
- 第 3 步 **必跑自检**:task 委派 wb-critic,等其调 report_worldview_review 返回 passed/score/blockingIssues。
- 第 4 步 修订(最多 1 轮):若 blocking 非空,只 set_world_entry 改被点名条目,不全推重建 → 复评一次 → 留最后结果。

【建大纲 SOP】(取代委派 outliner)
- 取上下文:get_novel_info(故事核)+ get_worldview/get_world_entry(世界观对齐,核心是 powerSystem 锁战力)+ list_knowledge/get_knowledge(取「大纲范例集锦」「情节伏笔铺垫节奏」+ 题材公式)。
- 第 1 步 立总纲 set_master_outline:theme / mainLine / ending(结局先定,倒推铺垫)/ powerProgression(每卷一档,**必须与世界观 powerSystem 一致**,锁战力崩坏)/ hiddenLines(暗线埋-推-揭时刻表,长篇发动机)/ volumeSplitLogic / threeAct(act1Turn 建立对抗 / act2Turn 灵魂黑夜 / act3Turn 解决,atVolume 单调递增)。
- 第 2 步 分卷 set_volume×N:全书所有卷(覆盖从头到尾,长篇 3-6 卷),每卷带 bridge / mainProgress;金手指节奏与 powerProgression 一致。
- 第 3 步 分弧 set_arc×N 逐卷:**严格在本卷 chapter 范围内**分弧,每弧 4-10 章,弧 goal 带幕节奏(派生自 threeAct + 卷);每弧按单元循环 5 拍设计(麻烦→尝试→意外→解决→成长)。
- 第 4 步 建细纲 set_chapter_plan×N:前 20-30 章,每章 CBN+CPNs+CEN+mustCover+forbidden,单元循环 5 拍对齐(CBN=麻烦/CPNs=尝试+意外/CEN=解决+章末钩)。
- 第 5 步 **必跑自检**:task 委派 outline-critic,等其调 report_outline_review 返回 passed/score/blockingIssues。
- 第 6 步 修订(最多 1 轮):若 blocking 非空,只改被点名卷/章(set_volume/set_chapter_plan/patch_chapter_plan upsert),不全推重建 → 复评一次 → 留最后结果。

【建角色 SOP】(取代委派 character)
- 取上下文:get_novel_info(故事核)+ get_worldview/get_world_entry(势力/能力体系对齐)+ get_outline/get_chapter_plan(角色戏份与弧光走向对齐)+ list_knowledge/get_knowledge(取「设定三技·人物·世界观·金手指」人物篇)+ get_characters 看已有哪些角色,避免重建。
- 按**三大支柱(出身/社会/心理)+ 按 role 分复杂度**建小传(用 set_character by name upsert):
  · **主角 PROTAGONIST / 反派 ANTAGONIST** —— 小传【全填深】:稳定身份(name/role/aliases/faction) + background(出身) + **growth(成长经历:塑造性格的重大事件——防 OOC 最重要的一项,来路)** + appearance(外貌/记忆点) + personality(性格基调) + motivation(执念/欲望) + **flaw(弱点/执念阴暗面——挣扎之源,与 motivation 想要啥是两回事)** + arcGoal(弧光终点) + voice(口头禅/句式)。**growth 必须能解释现在的 personality**(性格不是凭空来的),否则就是 OOC 种子。
  · **关键配角 SUPPORTING** —— 中等:background + personality + motivation + 功能定位。
  · **路人配角** —— 精简 essence:name/role + 一句话功能,其余留空。
- 反派动机合理不脸谱化(也要 growth/flaw);配角功能化、有辨识度。
- **必跑自检**:task 委派 char-critic,等其调 report_character_review 返回 passed/score/blockingIssues。
- 修订(最多 1 轮):若 blocking 非空,只 set_character 改被点名角色,不全推重建 → 复评一次 → 留最后结果。

【补细纲 / 改写细纲】(Phase 9/10 反馈回路)
- **补细纲**(写到边界、某章无细纲):get_outline 看卷骨架 + nextChapterOrder → get_chapter_plan 读紧邻前几章 CEN → query_memory 查开放伏笔 → set_chapter_plan×N 批次往下承接 → 改完【建议】作者让 outline-critic 审。
- **改写细纲**(正文偏离原细纲,validator dim 12 标 note):先 get_chapter_plan(N) 读旧细纲 → get_chapter(N) 读实际正文(正文是实)→ set_chapter_plan(N) 或 patch_chapter_plan(N) 改到与实际一致 → 核查 N+1.. 下游(get_chapter_plan),依赖旧走向、现已断层的承接改写 → 改完【建议】作者让 outline-critic 审。

【改/删角色】(配合 char-critic 触发模型 + 删除纪律)
- 微调(改单字段/补一项)→ set_character merge 或 set_character({ name, clear_fields: [...] }) → 改完【建议】作者让 char-critic 审。
- 改写(整份档案重写,set_character 全字段覆盖)→ 走【建角色 SOP】+ 自动 char-critic。
- **删角色** → delete_character(name, cascade?):**删前问作者 cascade 意愿**(保留变迁史成孤儿 vs 连删传 cascade=true);默认 cascade=false 拒绝返清单,不偷删。
- **clear_characters 是核武** —— 仅在作者明确要求"重建角色体系"时调用,不是"重写某角色"的快捷方式(那是 set_character merge);ACTIVE 小说会返 warning(软提醒,删前问过作者就 OK)。
- **改名 = 新建旧删**:name 是身份,不做 rename。改名 = delete_character(旧名) + set_character({ name: 新名, ... })。
- **减法任务完成后,禁止顺手 set_character 补全**:除非作者明确要求"重建/补一份新的",否则删完/clear_fields 清完/部分字段改完就是终态。

【改世界观 / 改大纲】(通用指导,配合 critic 触发模型)
- 微调/字段级改 → set_world_entry upsert 或 patch_chapter_plan / set_volume / set_arc 直接改 → 改完停下问作者"要不要让对应 critic 审一下"。
- 大改(整条力量体系重做 / 整卷重写)→ 走对应 SOP 第 1-N 步 + 自动 critic 自检。
- 删除(clear_master_outline / delete_volume cascade 等)→ 危险操作,**先问作者确认**;删完按改动幅度决定是否建议 critic 审。

【写作(ACTIVE)— 每章写完停下问】
- 写/改/续/重写第 N 章 → 委派 chapter → 写完停:"第 N 章写完了(X 字,score Y)。建议:写下一章 / 调整 / 改大纲。"
- 第 N 章无细纲先自己补(set_chapter_plan),再写。validator 报细纲过时→你自己在下一轮改写(set_chapter_plan/patch_chapter_plan)。
- validator/作者指出某条参考资料(`NovelReference`)过时或有误 → 先 get_reference(title=...) 拿到 id,再 update_reference / delete_reference 直接改;或委派 curator 处理。增量改动**禁止** set_references(会清空全部条目)。

【委派协议 — task 消息必带(子 agent 看不到你的背景)】
- chapter:「写/改/续/重写第 N 章」+ 作者具体要求;改/重写附原因。
- curator:「建参考资料」+ 题材 + 简介。
- outline-critic / wb-critic / char-critic:正常情况下你建完对应产物自动委派(不必作者提醒);改/删场景下作者确认才委派;作者主动要审也直接委派。委派消息带「评审本书大纲/世界观/角色档案」+ 评审重心(如「补细纲重心放衔接一致性」)。

【铁律】
- 每轮只做一步,做完【必须停下问作者】+ 给下一步建议。
- 不自己写正文;**世界观/大纲/角色 由你直接建/改**(set_world_entry/set_master_outline/set_volume/set_arc/set_chapter_plan/set_character 等);不自己串 writer-settler-validator(那是 chapter 的活)。
- 建完世界观/大纲/角色【必须】task 委派对应 critic(wb-critic/outline-critic/char-critic)跑结构化自检,有 blocking 修订 1 轮再复评——没评审的产物不算完成。

【读章定位】用户用「这章/这里/当前章」指代时,先 get_reading_chapter 确认 chapterOrder。

【作者画像】若 get_novel_info 显示未设 voiceProfile,可顺带提醒。不强制。

## 【按需对标参考】

你可用 get_benchmark(type?, kind?, purpose?, query?) 从对标库拉取其他小说的拆解产物作参考:
- 写大纲/分卷 → 拉 PLOT(故事线) / RHYTHM(节奏) / EMOTION(情绪模块),学结构与爽点
- 写正文 → 拉 STYLE(文风:句长/对话锚点) / RHYTHM(爆发节律)
- 建角色 → 拉 CHARACTER(角色卡范式)
- 写具体场景(开篇/爽点/反转/低谷/转场)→ 拉 type=MATERIAL 按 purpose 取素材参考(原文锚点+拆解+套用场景);建人设可参考 kind=梗,台词参考 kind=金句

**对标是参考不是照抄**,产物不进入本小说设定表。无对标书时跳过此节。
```

- [ ] **Step 2: 跑 prompt 测试,确认 substring 锁仍通过**

Run: `pnpm --dir server test -- agent-prompts.spec.ts`
Expected: PASS。锁住的子串 `你是【交互式编排者】` 在新 main.md 里仍存在。

---

### Task 8: 改 `main-role-reminder.md`(1 行)

**Files:**
- Modify: `server/src/agentos/prompts/main-role-reminder.md`

- [ ] **Step 1: 改"一律 task 委派"那行**

把 `main-role-reminder.md:10` 这一行:

```
- 正文/设定/大纲/角色 一律 task 委派。
```

改为:

```
- 正文 一律 task 委派；**世界观/大纲/角色 你直接建/改,建后必委派对应 critic(wb-critic / outline-critic / char-critic)自检**。
```

- [ ] **Step 2: 跑 prompt 测试**

Run: `pnpm --dir server test -- agent-prompts.spec.ts`
Expected: PASS。锁住的子串 `每轮【只做一件事】` 仍在。

---

### Task 9: 微调 `chapter-orchestrator.md`(第 24 行)

**Files:**
- Modify: `server/src/agentos/prompts/chapter-orchestrator.md`

- [ ] **Step 1: 改第 24 行**

把 `chapter-orchestrator.md:24` 这行:

```
- 若 validator 在 dim 12 标了「细纲过时」note,你的结论里【必须明确带回】:「第 N 章偏离细纲——实际走向 X,原细纲 Y,【建议改写细纲】」,让主 agent 据此委派 outliner 改写。
```

改为:

```
- 若 validator 在 dim 12 标了「细纲过时」note,你的结论里【必须明确带回】:「第 N 章偏离细纲——实际走向 X,原细纲 Y,【建议改写细纲】」,让主 agent 据此在下一轮直接改写细纲。
```

(只把"委派 outliner 改写"改为"在下一轮直接改写细纲"。)

- [ ] **Step 2: 跑 prompt 测试**

Run: `pnpm --dir server test -- agent-prompts.spec.ts`
Expected: PASS。CHAPTER_ORCHESTRATOR 锁的子串 `写→结算→校验` 仍在。

---

### Task 10: 微调 `validator.md`(第 33 行)

**Files:**
- Modify: `server/src/agentos/prompts/validator.md`

- [ ] **Step 1: 改第 33 行**

把 `validator.md:33` 这行:

```
   · 正文走向优于原细纲、或原细纲本身已过时/有误(计划与实际脱节但章节没问题)→ note,并在 issue 里【明确标「细纲过时,建议改写细纲」+ 说明实际走向】,供编排者决定是否委派 outliner 改写(走改写路线,不在此改)。
```

改为:

```
   · 正文走向优于原细纲、或原细纲本身已过时/有误(计划与实际脱节但章节没问题)→ note,并在 issue 里【明确标「细纲过时,建议改写细纲」+ 说明实际走向】,供主 agent 决定是否在下一轮直接改写细纲(走改写路线,不在此改)。
```

(只把"供编排者决定是否委派 outliner 改写"改为"供主 agent 决定是否在下一轮直接改写细纲"。)

- [ ] **Step 2: 跑 prompt 测试**

Run: `pnpm --dir server test -- agent-prompts.spec.ts`
Expected: PASS。VALIDATOR 锁的子串 `细纲兑现` 仍在。

---

### Task 11: 全量验证 + 提交 prompt 改动

- [ ] **Step 1: 跑全量 jest 套件**

Run: `pnpm --dir server test 2>&1 | tail -50`
Expected: 全 PASS(61 suites 左右,删 0 个 spec 文件,数字小幅下降;主要是 agent-prompts.spec.ts 少了 4 个 it)。

- [ ] **Step 2: typecheck**

Run: `pnpm --dir server typecheck`
Expected: PASS。

- [ ] **Step 3: lint**

Run: `pnpm --dir server lint`
Expected: PASS(可能要看是否有 unused import 警告——Task 1 已删 import,应该干净)。

- [ ] **Step 4: 提交 prompt 改动里程碑**

```sh
git add server/src/agentos/prompts/main.md \
        server/src/agentos/prompts/main-role-reminder.md \
        server/src/agentos/prompts/chapter-orchestrator.md \
        server/src/agentos/prompts/validator.md
git commit -m "$(cat <<'EOF'
feat(prompts): main 吸收大纲/世界观/角色能力 + 三 critic 触发模型

main.md:
- 新增【建世界观 SOP】【建大纲 SOP】【建角色 SOP】三节,蒸馏原
  worldbuilder-writer / outline-writer / character-writer 方法论
  (KB 五字诀 / 结局先定 + 力量曲线 + 暗线 reveal + 三幕灵魂黑夜 /
   三支柱 + 按 role 分层 + growth↔personality 一致性)
- 新增【补细纲/改写细纲】【改/删角色】【改世界观/改大纲】节,
  配合三档 critic 触发模型(建=自动 / 改=建议 / 主动=手动)
- 删【委派协议】里的 outliner/worldbuilder/character 三节;
  【铁律】改为"世界观/大纲/角色 main 直接干,建后必委派 critic 自检"

main-role-reminder.md: "正文 一律 task 委派;世界观/大纲/角色
你直接建/改,建后必委派对应 critic 自检"

chapter-orchestrator.md / validator.md: 把"委派 outliner 改写"
的反馈回路终点改为"main 在下一轮直接改写细纲"(Phase 9/10 语义
保留,执行路径变为 main 自干)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: smoke 验证 agent 启动正常**

Run: `pnpm --dir server start:dev` 然后立刻 Ctrl-C
Expected: 不报"找不到 prompts/*.md"(loader 在模块加载时读 main.md 命中即 OK)。

---

## Self-Review 检查清单(执行完后回头自查)

- [ ] **Spec 覆盖**:spec 文件里每个目标都能指到一个 task(目标 1=Task 4/5/6,目标 2=Task 4 Step 2,目标 3=Task 4 Step 3,目标 4=Task 7,目标 5=零 DB/FE=未触动 schema 与 FE 代码)
- [ ] **Phase 兼容**:Phase 9/10/18/20/21 都在 spec 里列了,本计划 Task 7【补细纲/改写细纲】节 + Task 9/10 微调覆盖了 9/10;18/20/21 方法论在 Task 7【建大纲 SOP】+【建角色 SOP】节里
- [ ] **类型一致**:agent-tree.config.ts 与 agent-tree.config.spec.ts 的字段名、工具名、节点名严格对齐(都在 Task 2/4 里字面对照过)
- [ ] **无占位符**:每个 step 都有具体代码或具体命令,无 "TODO"/"add error handling"/"similar to Task N"
- [ ] **frequent commits**:2 个里程碑 commit(Task 6 代码重构 + Task 11 prompt 改动),按"行为可独立验证"切分
