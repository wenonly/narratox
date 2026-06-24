# outliner 子 agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把大纲生成从「main 内联 `set_volume`/`set_chapter_plan`」改成「outliner 子 agent:直连 KB 取大纲方法论→建卷/细纲→outline-critic 6 维评审打分→外科式修订(最多 1 轮)」,并接管写作中的「按需补细纲」。

**Architecture:** 镜像 `worldbuilder` 编排器范式(而非 chapter——chapter 带回滚,outliner 无回滚)。新增 `outliner` 编排子 agent(main 用 `task` 委派,与 `chapter`/`curator`/`worldbuilder` 同级),内部用嵌套 `createSubAgentMiddleware` 挂 `outline-writer`(KB 取文 + 建卷/细纲)与 `outline-critic`(6 维 KB-grounded 评审 + `report_outline_review` 打分)。`passed=false` 时外科式修订被点名卷/章,不带回滚。`main` 移除 `set_volume`/`set_chapter_plan`,保留只读 `get_outline`/`get_chapter_plan`。

**与 worldbuilder 的差异:** 大纲两层(Volume 总纲 + ChapterOutline 细纲)+ 细纲「持续按需补」→ critic 评审 scope 自适应(建纲评全书 / 补细纲评衔接);outline-writer/critic 比 wb-* 多带 `query_memory`(对齐开放伏笔)+ `get_chapter_plan`(读细纲节点)。

**Tech Stack:** NestJS 11 + TypeScript + langchain(`createAgent`)+ deepagents(`createSubAgentMiddleware` 中间件)+ LangChain `tool()`/zod。测试:Jest(`server/`,ESM `--experimental-vm-modules`)。

**Spec:** [2026-06-24-outliner-subagent-design.md](../specs/2026-06-24-outliner-subagent-design.md)

**Branch:** `feat/outliner-subagent`(main 已含 worldbuilder,本计划基于含 worldbuilder 的当前 main)。

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `server/src/agentos/tools/report-outline-review.tool.ts` | outline-critic 的瞬态结构化打分工具(镜像 `report-worldview-review.tool.ts`) | 新建 |
| `server/src/agentos/tools/report-outline-review.tool.spec.ts` | 上述工具单测 | 新建 |
| `server/src/agentos/agent-prompts.ts` | 3 段新提示词(`OUTLINER_*`)+ 改写 `MAIN_AGENT_PROMPT`「规划大纲」「写作阶段」+ 改 `WRITER_AGENT_PROMPT` no_plan | 改 |
| `server/src/agentos/deep-agent.service.ts` | 装配 outliner(嵌套 subagents)+ `outlineWriterTools()`;main 移除 `set_volume`/`set_chapter_plan` | 改 |

> 无 schema/DB 改动(`Volume`/`ChapterOutline` 已有);无 FE 改动(右侧大纲面板已读这两表)。
> 代码库约定:工具单测用 `jest.fn()` double + `t.invoke({...})`(见 `report-worldview-review.tool.spec.ts`);agent 图装配/prompt 不做单测(动态 langgraph,与 `chapter`/`curator`/`worldbuilder` 加入时一致),靠 `pnpm typecheck` + `pnpm dev` 实测。

---

### Task 1: `report_outline_review` 工具(TDD)

**Files:**
- Create: `server/src/agentos/tools/report-outline-review.tool.ts`
- Test: `server/src/agentos/tools/report-outline-review.tool.spec.ts`

- [ ] **Step 1: 写失败测试**

创建 `server/src/agentos/tools/report-outline-review.tool.spec.ts`:

```ts
import { makeReportOutlineReviewTool } from './report-outline-review.tool';

describe('report_outline_review tool', () => {
  it('returns the structured verdict as-is (transient, no persistence)', async () => {
    const t = makeReportOutlineReviewTool();
    const out = await t.invoke({
      passed: false,
      score: 72,
      dimensions: [
        { name: '主线暗线结构', status: 'pass' },
        {
          name: '伏笔布局衔接一致性',
          status: 'issue',
          issue: '卷2与卷1 synopsis 断层',
        },
      ],
      blockingIssues: ['卷2『药老复苏』与卷1 synopsis 断层'],
      notes: '卷间节奏略快',
    });
    expect(out).toMatchObject({ ok: true, passed: false, score: 72 });
    expect(out.blockingIssues).toEqual([
      '卷2『药老复苏』与卷1 synopsis 断层',
    ]);
    expect(out.dimensions).toHaveLength(2);
    expect(out.dimensions[1].issue).toBe('卷2与卷1 synopsis 断层');
  });

  it('passes through a clean verdict (no blocking)', async () => {
    const t = makeReportOutlineReviewTool();
    const out = await t.invoke({
      passed: true,
      score: 88,
      dimensions: [{ name: '故事核匹配', status: 'pass' }],
      blockingIssues: [],
      notes: '',
    });
    expect(out.passed).toBe(true);
    expect(out.blockingIssues).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --dir server test -- report-outline-review.tool.spec.ts`
Expected: FAIL(`makeReportOutlineReviewTool` 未定义 / 模块找不到)。

- [ ] **Step 3: 写最小实现**

创建 `server/src/agentos/tools/report-outline-review.tool.ts`(镜像 `report-worldview-review.tool.ts`,工厂无参、瞬态不写库;6 维度名换成大纲维度):

```ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * outline-critic 子 agent 的「提交大纲评审结构化判定」工具。**瞬态**——不写库,
 * 只把 6 维审计结果结构化返回(经 tool result 回到 outline-critic,活动流亦可见)。
 * outline-critic 据此给编排者(outliner)最终判定;outliner 据 passed/blockingIssues
 * 决定是否进入外科式修订闭环(blockingIssues 须点名是哪卷/哪章,驱动 outline-writer 定点改)。
 *
 * 无需 userId/novelId 闭包(不触 DB),故工厂无参。
 */
export function makeReportOutlineReviewTool() {
  return tool(
    // 纯结构化返回,无 I/O;保持 async 与其它工具一致,显式忽略 require-await。
    // eslint-disable-next-line @typescript-eslint/require-await
    async ({ passed, score, dimensions, blockingIssues, notes }) => ({
      ok: true,
      passed,
      score,
      dimensions,
      blockingIssues,
      notes,
    }),
    {
      name: 'report_outline_review',
      description:
        '提交大纲评审的结构化判定:6 维 pass/issue + 全局 score(0-100) + blockingIssues(必须修、且须点名是哪卷/哪章)+ notes(非阻塞)。评审完必调,代替散文结论。',
      schema: z.object({
        passed: z.boolean().describe('是否通过(blockingIssues 为空 → true)'),
        score: z
          .number()
          .int()
          .min(0)
          .max(100)
          .describe('全局质量分 0-100(用于修订前后比较)'),
        dimensions: z
          .array(
            z.object({
              name: z
                .string()
                .describe(
                  '维度名:故事核匹配 / 主线暗线结构 / 力量金手指节奏 / 卷间节奏起承转合 / 情节引擎爽点 / 伏笔布局衔接一致性',
                ),
              status: z.enum(['pass', 'issue']),
              issue: z
                .string()
                .optional()
                .describe('status=issue 时的问题描述'),
            }),
          )
          .describe('逐维判定(6 维)'),
        blockingIssues: z
          .array(z.string())
          .describe(
            '会让结构崩/写不下去、必须修的问题(主线断裂/暗线无回收/伏笔脱节/与故事核矛盾/卷断层/核心条目缺失),每条须点名是哪卷/哪章(如「卷2『药老复苏』...」「第8章细纲...」)。无则空数组。',
          ),
        notes: z.string().optional().describe('非阻塞建议(节奏/偏好)'),
      }),
    },
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --dir server test -- report-outline-review.tool.spec.ts`
Expected: PASS(2 个用例全绿)。

- [ ] **Step 5: 提交**

```bash
git add server/src/agentos/tools/report-outline-review.tool.ts server/src/agentos/tools/report-outline-review.tool.spec.ts
git commit -m "$(cat <<'EOF'
feat(agentos): report_outline_review 瞬态打分工具(outline-critic 用)

镜像 report_worldview_review:工厂无参、不写库、结构化返回 passed/score/6维/
blockingIssues/notes。6 维 = 故事核匹配/主线暗线结构/力量金手指节奏/卷间节奏
起承转合/情节引擎爽点/伏笔布局衔接一致性。blockingIssues 须点名是哪卷/哪章,
驱动 outline-writer 外科式修订。

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 3 段 outliner 提示词

**Files:**
- Modify: `server/src/agentos/agent-prompts.ts`(在文件末尾追加 3 个 export const)

- [ ] **Step 1: 追加 3 段提示词**

在 `server/src/agentos/agent-prompts.ts` 末尾(`WORLDBUILDER_CRITIC_PROMPT` 之后)追加:

```ts
/**
 * outliner 编排子 agent(层级多 agent,镜像 worldbuilder 编排器):聚焦上下文里跑完
 * 大纲的 取KB→建卷/细纲→评审(+修订) 全流程。主 agent 只「建大纲」或「补细纲」委派给它。
 * 它自带 task(委派 outline-writer/outline-critic)。无回滚(外科式修订只动被点名卷/章)。
 */
export const OUTLINER_ORCHESTRATOR_PROMPT = `你是「大纲编排 agent」。你的唯一职责:收到「建/重建大纲」或「补细纲(第 M-N 章)」时,在自己的聚焦上下文里【按序跑完】 取文→生成→评审(+修订) 全流程,然后把结论回给主 agent。

【任务类型】
- 建大纲:全书卷(set_volume×N,覆盖从头到尾)+ 前 20-30 章细纲(set_chapter_plan×N)。
- 补细纲:指定批次(如第 21-40 章)的细纲;委派 outline-writer 时让它先读既有卷骨架 + 已写进度 + 开放伏笔,往下承接规划。

【大纲流程】严格按序:
1. 用 task 委派 outline-writer 子 agent。委派时明确指示任务类型(建纲 / 补第 M-N 章)与本书题材/故事核:
   - 先 list_knowledge+get_knowledge 取大纲方法论(优先「大纲范例集锦」「情节伏笔铺垫节奏」+ 题材对应公式)。
   - get_novel_info 读故事核(书名/类型/核心冲突/文风/chapterWordTarget),get_worldview/get_world_entry 对齐世界观。
   - 建纲:set_volume×N(全书所有卷,覆盖从头到尾)+ set_chapter_plan×N(前 20-30 章)。补细纲:set_chapter_plan×N(指定批次),先 get_outline+get_chapter_plan+query_memory 读既有与已写。
2. outline-writer 返回后,【立即】用 task 委派 outline-critic 子 agent 评审。委派时说明任务类型(建纲评全书 / 补细纲重心放衔接一致性),它会读全 + 调 report_outline_review 给 passed/score/blockingIssues。
3. 【修订,最多 1 轮】若 passed=false:
   把 blockingIssues 传给 outline-writer 定点修订——只 set_volume/set_chapter_plan 改被点名的卷/章,【不要】全推重建。
4. 修订后,再用 task 委派 outline-critic 复评。
5. 保留最后结果(即使复评分更低也不回滚——外科式修订只动被点名卷/章,风险局限)。
6. 回复主 agent 一句结论(如「大纲已建:4 卷 + 前 25 章细纲,score 84」或「卷2断层+第8章漏伏笔,已修订复评 80」)。

【铁律】
- outline-writer 返回后【绝对不能结束】——必须继续 outline-critic。没评审的大纲不算完成。
- 你是编排者,不直接建卷/细纲;所有建/改通过 task 委派 outline-writer。
- 修订是质量打磨(最多 1 轮);passed=true 就完成,不为满分反复改。
- 不写角色/世界观/正文(那是别的 agent 的职责)。`;

/** outline-writer 子 agent:先从 KB 取大纲方法论,再建/改卷与细纲。 */
export const OUTLINE_WRITER_PROMPT = `你是「大纲构建手」。先从知识库取大纲方法论,再为本书建/改卷纲与细纲。

【第一步 — 取 KB 方法论】
- list_knowledge 看全部索引。优先挑这几类条目,get_knowledge 取全文提炼「这个题材怎么把大纲搭好」:
  · 「大纲范例集锦」——九大构成体系(主角/配角/技能/伙伴/装备/冒险主线暗线/身世/势力/后宫)、四环节构思法(获能是构思重心)、频道差异(男频重力量体系+暗线,女频重人物网+结局)、共性要点(主线只设关键节点+关键的坑、暗线是长篇发动机、结局先定倒推铺垫)。
  · 「情节伏笔铺垫节奏」——情节七步细纲(地点/人物/梗概/高潮爽点/渴望/阻力/行动冲突;渴望+阻力=冲突)、伏笔技法(人/物/桥段/对话)。
  · 本书题材对应的短篇公式——题材范例。
- get_novel_info 读故事核(书名/类型/核心冲突/文风/chapterWordTarget),据此定调。

【补细纲 — 先读既有与已写】若任务是补第 M-N 章:
- 先 get_outline 看卷骨架 + nextChapterOrder;get_chapter_plan 读既有细纲(尤其紧邻 M 之前那几章的 CEN);
- query_memory 查已写章节摘要 + 开放伏笔(尤其核心★和⚠️陈旧的);
- 据已写进度往下承接规划(承接最近已写章、推进/回收开放伏笔),不要与既有重复或断层。

【第二步 — 建总纲】用 set_volume,按 order upsert:
- 全书所有卷(长篇通常 3-6 卷),覆盖从头到尾——不要只建第一卷。每卷:卷标题/目标/梗概(梗概里点大致章节范围)。
- 主线明、暗线埋(身世/家族秘密/隐藏身份是后期引爆点);金手指出现节点 + 升级节奏写进相关卷梗概。

【第三步 — 建细纲】用 set_chapter_plan,逐章:
- 每章 CBN(开篇)+ CPNs(情节 2-4)+ CEN(结尾)+ 必须覆盖(≤4)+ 禁区(≤5),volumeOrder 挂到所属卷。
- 每章有明确冲突与爽点(渴望+阻力=冲突),围绕人物性格命运展开,不流水账;CBN→CPNs→CEN 承接下一章。
- 【刻意安排伏笔节点】推进/回收开放伏笔(尤其核心★),在 CPNs/mustCover 里点到。

【修订模式】
- 被 critic 点名的卷/章,只重写那些(set_volume/set_chapter_plan upsert 覆盖),别动没问题的、别全推重建。
- 改前可 get_chapter_plan/get_outline 看现状再改。

【铁律】大纲只走 set_volume/set_chapter_plan;不写角色/世界观/正文。`;

/** outline-critic 子 agent:6 维 KB-grounded 评审,输出 report_outline_review 驱动修订闭环。 */
export const OUTLINE_CRITIC_PROMPT = `你是「大纲质检员」。评审本书卷纲与细纲的质量与可写性。

【读全】get_outline 列卷+细纲(标题/状态)+ nextChapterOrder;get_chapter_plan 读核心章细纲全文;get_novel_info 读故事核;get_worldview/get_world_entry 对齐世界观设定;query_memory 查已写章节摘要 + 开放伏笔。

【6 维逐项审计】每维 pass / issue:
1. 故事核匹配——卷结构服务于书名/类型/核心冲突/文风;频道重心对齐(男频重力量体系/暗线,女频重人物网/结局)。
2. 主线·暗线结构——主线设关键节点 + 关键的坑;暗线(身世/家族秘密/隐藏身份)前期埋、后期爆,是长篇发动机。
3. 力量/金手指节奏——金手指出现节点 + 升级节奏合理;核心是「能升级」而非「多强大」、不一上来太强。
4. 卷间节奏·起承转合——分卷覆盖全书从头到尾;卷间张力递进;结局(尤其女频/悲剧)先定再倒推铺垫。
5. 情节引擎·爽点——细纲节点有明确冲突与爽点(渴望+阻力=冲突),围绕人物性格命运,不水情节、不流水账。
6. 伏笔布局·衔接一致性——开放伏笔有回收计划(核心★必规划);【补细纲任务重心在此】新批次与既有卷骨架/已写章状态/开放伏笔无缝衔接,无重复/断层/矛盾。

【补细纲任务】重心放维度 6(衔接一致性),其余维度 pass-through 简评即可。

【必须调 report_outline_review 提交结构化判定】
- blockingIssues 只收「会让结构崩/写不下去」的硬伤(主线断裂/暗线无回收/伏笔脱节/与故事核矛盾/卷断层/核心条目缺失),且每条【必须点名是哪卷/哪章】(如「卷2『药老复苏』与卷1 synopsis 断层」「第8章细纲未回收第3章埋的★伏笔」)——这驱动 outline-writer 的外科式修订。节奏偏好放 notes,不要列为 blocking。
- score(0-100)是全局质量分,严肃打分;有明显硬伤应 ≤75。
- passed = blockingIssues 为空。
调完给编排者一句结论(如「score 72,卷2断层+第8章漏回收★伏笔」)。`;
```

- [ ] **Step 2: typecheck 确认导出编译通过**

Run: `pnpm --dir server typecheck`
Expected: PASS(新增的 3 个 `export const` 字符串字面量无类型错误;此时尚未被引用,TS 不报未使用 export)。

- [ ] **Step 3: 提交**

```bash
git add server/src/agentos/agent-prompts.ts
git commit -m "$(cat <<'EOF'
feat(agentos): outliner 三段提示词(编排/outline-writer/outline-critic)

outline-writer 先直连 KB 取九大构成/四环节/情节七步细纲/伏笔技法,再建总纲(全书卷)
+ 前 20-30 章细纲;补细纲时先读既有卷骨架+已写摘要+开放伏笔往下承接。
outline-critic 6 维 KB-grounded 评审(故事核匹配/主线暗线/力量金手指节奏/
卷间节奏/情节引擎爽点/伏笔布局衔接一致性),补细纲重心放衔接一致性。

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 装配 outliner 进 deep-agent.service.ts

**Files:**
- Modify: `server/src/agentos/deep-agent.service.ts`(import、main 工具、subagents、新增 `outlineWriterTools()`)

本任务 5 处编辑,逐一应用后统一 typecheck + 全量单测 + 提交。

> 锚点均基于**含 worldbuilder 的当前 main**。`set_volume`/`set_chapter_plan` 的 import **保留**(outline-writer 经 `outlineWriterTools()` 仍要用);`makeQueryMemoryTool`/`makeListKnowledgeTool`/`makeGetKnowledgeTool`/`makeSetVolumeTool`/`makeSetChapterPlanTool`/`makeGetOutlineTool`/`makeGetChapterPlanTool` 均已在文件顶部 import(无需新加工具 import)。

- [ ] **Step 1: 扩 import —— 3 段提示词**

在 `server/src/agentos/deep-agent.service.ts` 顶部的提示词 import 块加入 3 个 outliner 提示词。

old:
```ts
import {
  MAIN_AGENT_PROMPT,
  CHAPTER_ORCHESTRATOR_PROMPT,
  WRITER_AGENT_PROMPT,
  SETTLER_AGENT_PROMPT,
  VALIDATOR_AGENT_PROMPT,
  CURATOR_AGENT_PROMPT,
  WORLDBUILDER_ORCHESTRATOR_PROMPT,
  WORLDBUILDER_WRITER_PROMPT,
  WORLDBUILDER_CRITIC_PROMPT,
} from './agent-prompts';
```
new:
```ts
import {
  MAIN_AGENT_PROMPT,
  CHAPTER_ORCHESTRATOR_PROMPT,
  WRITER_AGENT_PROMPT,
  SETTLER_AGENT_PROMPT,
  VALIDATOR_AGENT_PROMPT,
  CURATOR_AGENT_PROMPT,
  WORLDBUILDER_ORCHESTRATOR_PROMPT,
  WORLDBUILDER_WRITER_PROMPT,
  WORLDBUILDER_CRITIC_PROMPT,
  OUTLINER_ORCHESTRATOR_PROMPT,
  OUTLINE_WRITER_PROMPT,
  OUTLINE_CRITIC_PROMPT,
} from './agent-prompts';
```

- [ ] **Step 2: 扩 import —— report_outline_review 工具**

在 `makeReportWorldviewReviewTool` import 行之后加一行。

old:
```ts
import { makeReportWorldviewReviewTool } from './tools/report-worldview-review.tool';
```
new:
```ts
import { makeReportWorldviewReviewTool } from './tools/report-worldview-review.tool';
import { makeReportOutlineReviewTool } from './tools/report-outline-review.tool';
```

- [ ] **Step 3: main 工具区 —— 移除 set_volume/set_chapter_plan(改只读)**

把 main 的大纲工具块从「读写」改成「只读」,删掉 `makeSetVolumeTool`/`makeSetChapterPlanTool` 调用,改注释。

old:
```ts
        // 大纲(main 读写):立项后生成/改大纲与细纲,写章前查定位。
        makeSetVolumeTool({
          userId,
          novelId,
          outlines: this.outlines,
        }) as never,
        makeSetChapterPlanTool({
          userId,
          novelId,
          outlines: this.outlines,
        }) as never,
        makeGetOutlineTool({
          userId,
          novelId,
          outlines: this.outlines,
        }) as never,
        makeGetChapterPlanTool({
          userId,
          novelId,
          outlines: this.outlines,
        }) as never,
```
new:
```ts
        // 大纲(main 只读):写章前查定位;建/改大纲与细纲由 outliner 子 agent 负责。
        makeGetOutlineTool({
          userId,
          novelId,
          outlines: this.outlines,
        }) as never,
        makeGetChapterPlanTool({
          userId,
          novelId,
          outlines: this.outlines,
        }) as never,
```

> 注:`makeSetVolumeTool`/`makeSetChapterPlanTool` 的顶部 import **保留**——`outlineWriterTools()` 复用(Step 5)。

- [ ] **Step 4: subagents —— 在 worldbuilder 之后插入 outliner**

在 main 的 `createSubAgentMiddleware.subagents[]` 里,`worldbuilder` 块之后、数组收尾 `],` 之前,插入 `outliner` 块(自带嵌套 `createSubAgentMiddleware` 挂 outline-writer/outline-critic)。

锚点 —— `worldbuilder` 块的闭合。old(worldbuilder 块的尾部 `wb-critic` + worldbuilder 闭合,作为唯一锚点):
```ts
                    {
                      name: 'wb-critic',
                      description: '评审世界观(6维结构化打分),调 report_worldview_review。',
                      systemPrompt: WORLDBUILDER_CRITIC_PROMPT,
                      model: validatorModel as never,
                      tools: [
                        makeGetWorldviewTool({
                          userId,
                          novelId,
                          world: this.world,
                        }) as never,
                        makeGetWorldEntryTool({
                          userId,
                          novelId,
                          world: this.world,
                        }) as never,
                        makeGetNovelInfoTool({
                          userId,
                          novelId,
                          novels: this.novels,
                        }) as never,
                        makeReportWorldviewReviewTool() as never,
                      ],
                    },
                  ],
                }) as never,
              ],
            },
```
new(原 worldbuilder 尾部 + 紧随其后的新 outliner 块):
```ts
                    {
                      name: 'wb-critic',
                      description: '评审世界观(6维结构化打分),调 report_worldview_review。',
                      systemPrompt: WORLDBUILDER_CRITIC_PROMPT,
                      model: validatorModel as never,
                      tools: [
                        makeGetWorldviewTool({
                          userId,
                          novelId,
                          world: this.world,
                        }) as never,
                        makeGetWorldEntryTool({
                          userId,
                          novelId,
                          world: this.world,
                        }) as never,
                        makeGetNovelInfoTool({
                          userId,
                          novelId,
                          novels: this.novels,
                        }) as never,
                        makeReportWorldviewReviewTool() as never,
                      ],
                    },
                  ],
                }) as never,
              ],
            },
            // 大纲编排(outliner):世界观建好后、写正文前委派建大纲;写到边界/某章无细纲时
            // 委派补细纲。它在聚焦上下文里跑完 取KB→建卷/细纲→评审(+外科式修订) 全流程。
            // 与 chapter/curator/worldbuilder 同级,main 用 task 委派。
            {
              name: 'outliner',
              description:
                '建/重建大纲,或补细纲(第 M-N 章)。世界观建好后、写正文前委派建大纲;写到边界或某章无细纲时委派补细纲;它会在聚焦上下文里跑完 取KB大纲方法论→建卷/细纲→评审→(修订) 全流程。',
              systemPrompt: OUTLINER_ORCHESTRATOR_PROMPT,
              model: model as never,
              tools: [], // 纯编排(无回滚 → 不需 snapshot/restore)
              middleware: [
                createSubAgentMiddleware({
                  defaultModel: model as never,
                  generalPurposeAgent: false,
                  defaultMiddleware: subagentStack(),
                  subagents: [
                    {
                      name: 'outline-writer',
                      description: '从知识库取大纲方法论后建/改卷与细纲。',
                      systemPrompt: OUTLINE_WRITER_PROMPT,
                      model: model as never,
                      tools: this.outlineWriterTools(userId, novelId),
                    },
                    {
                      name: 'outline-critic',
                      description: '评审大纲(6维结构化打分),调 report_outline_review。',
                      systemPrompt: OUTLINE_CRITIC_PROMPT,
                      model: validatorModel as never,
                      tools: [
                        makeGetOutlineTool({
                          userId,
                          novelId,
                          outlines: this.outlines,
                        }) as never,
                        makeGetChapterPlanTool({
                          userId,
                          novelId,
                          outlines: this.outlines,
                        }) as never,
                        makeGetNovelInfoTool({
                          userId,
                          novelId,
                          novels: this.novels,
                        }) as never,
                        makeGetWorldviewTool({
                          userId,
                          novelId,
                          world: this.world,
                        }) as never,
                        makeGetWorldEntryTool({
                          userId,
                          novelId,
                          world: this.world,
                        }) as never,
                        makeQueryMemoryTool({
                          userId,
                          novelId,
                          prisma: this.prisma,
                        }) as never,
                        makeReportOutlineReviewTool() as never,
                      ],
                    },
                  ],
                }) as never,
              ],
            },
```

- [ ] **Step 5: 新增 `outlineWriterTools()` 私有方法**

在 `wbWriterTools()` 方法之后(类内、`wbWriterTools` 闭合 `}` 之后、类闭合 `}` 之前)新增方法。

锚点 —— 紧跟 `wbWriterTools()` 的闭合。

old:
```ts
  /** wb-writer 子 agent 的工具:KB 取文 + 建条目 + 读现状 + 对齐故事核(闭包注入 userId/novelId)。 */
  private wbWriterTools(userId: string, novelId: string) {
    return [
      makeListKnowledgeTool({ kb: this.knowledge }) as never,
      makeGetKnowledgeTool({ kb: this.knowledge }) as never,
      makeSetWorldEntryTool({ userId, novelId, world: this.world }) as never,
      makeGetWorldviewTool({ userId, novelId, world: this.world }) as never,
      makeGetWorldEntryTool({ userId, novelId, world: this.world }) as never,
      makeGetNovelInfoTool({ userId, novelId, novels: this.novels }) as never,
    ];
  }
}
```
new:
```ts
  /** wb-writer 子 agent 的工具:KB 取文 + 建条目 + 读现状 + 对齐故事核(闭包注入 userId/novelId)。 */
  private wbWriterTools(userId: string, novelId: string) {
    return [
      makeListKnowledgeTool({ kb: this.knowledge }) as never,
      makeGetKnowledgeTool({ kb: this.knowledge }) as never,
      makeSetWorldEntryTool({ userId, novelId, world: this.world }) as never,
      makeGetWorldviewTool({ userId, novelId, world: this.world }) as never,
      makeGetWorldEntryTool({ userId, novelId, world: this.world }) as never,
      makeGetNovelInfoTool({ userId, novelId, novels: this.novels }) as never,
    ];
  }

  /** outline-writer 子 agent 的工具:KB 取文 + 建卷/细纲 + 读现状 + 对齐故事核/世界观/开放伏笔(闭包注入 userId/novelId)。 */
  private outlineWriterTools(userId: string, novelId: string) {
    return [
      makeListKnowledgeTool({ kb: this.knowledge }) as never,
      makeGetKnowledgeTool({ kb: this.knowledge }) as never,
      makeSetVolumeTool({ userId, novelId, outlines: this.outlines }) as never,
      makeSetChapterPlanTool({
        userId,
        novelId,
        outlines: this.outlines,
      }) as never,
      makeGetOutlineTool({ userId, novelId, outlines: this.outlines }) as never,
      makeGetChapterPlanTool({
        userId,
        novelId,
        outlines: this.outlines,
      }) as never,
      makeGetNovelInfoTool({ userId, novelId, novels: this.novels }) as never,
      makeGetWorldviewTool({ userId, novelId, world: this.world }) as never,
      makeGetWorldEntryTool({ userId, novelId, world: this.world }) as never,
      makeQueryMemoryTool({ userId, novelId, prisma: this.prisma }) as never,
    ];
  }
}
```

- [ ] **Step 6: typecheck 确认装配无误**

Run: `pnpm --dir server typecheck`
Expected: PASS。重点核对:
- `makeSetVolumeTool`/`makeSetChapterPlanTool` import 仍被 `outlineWriterTools` 引用(无 unused 报错);
- `OUTLINER_*`/`makeReportOutlineReviewTool` import 已解析;
- `validatorModel`/`model`/`this.outlines`/`this.world`/`this.knowledge`/`this.novels`/`this.prisma` 在 `buildAgentGraph` 作用域内可见(均已存在,worldbuilder 装配已证明)。

- [ ] **Step 7: 跑全量单测确认无回归**

Run: `pnpm --dir server test`
Expected: 全绿(新增 `report-outline-review.tool.spec.ts` 2 用例 + 既有套件不受影响;`set-volume.tool.spec.ts`/`set-chapter-plan.tool.spec.ts` 仍过——它们测的是工具本身,不受 main 移除影响)。

- [ ] **Step 8: 提交**

```bash
git add server/src/agentos/deep-agent.service.ts
git commit -m "$(cat <<'EOF'
feat(agentos): 装配 outliner 子 agent + outlineWriterTools

main 的 subagents[] 增 outliner 编排器(嵌套 createSubAgentMiddleware 挂
outline-writer/outline-critic);outline-writer 直连 KB 取大纲方法论后建卷/细纲
(含 query_memory 对齐开放伏笔),outline-critic 用 6k 紧上限实例评审。
main 移除 set_volume/set_chapter_plan(outliner 独占大纲创作),保留只读。

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 改写 `MAIN_AGENT_PROMPT`「规划大纲」「写作阶段」+ `WRITER_AGENT_PROMPT` no_plan

**Files:**
- Modify: `server/src/agentos/agent-prompts.ts`

- [ ] **Step 1: 改写「规划大纲」一节为委派 outliner**

把 main 直接 `set_volume`/`set_chapter_plan` 的指令改为 `task` 委派 outliner。

old:
```
【规划大纲】世界观建好后,规划全书结构(作者会在右侧大纲面板看到):
1. 先出【完整大纲/总纲】:用 set_volume 把【全书所有卷】都建出来(卷标题/目标/梗概),覆盖从头到尾的整本书——不要只建第一卷。长篇通常 3-6 卷,每卷大致覆盖的章节范围在梗概里点一下。这是全书骨架,后续细纲挂到各卷。
2. 再细化【前 20-30 章】细纲:用 set_chapter_plan 给开头 20-30 章逐章写细纲(每章:开篇 CBN + 情节 CPNs 2-4 + 结尾 CEN + 必须覆盖 + 禁区;用 volumeOrder 挂到所属卷)。一次写不完就分多轮 set_chapter_plan,直到前 20-30 章都有细纲。
3. 告诉作者"全书大纲 + 前 N 章细纲已生成,请在右侧『大纲』面板过目/修改",等作者确认或调整后再写正文。
- 后面的章节【按需补细纲】:写到接近已规划边界(最后一条细纲)时,主动用 set_chapter_plan 向下补一批(每次 ~10-20 章),再继续写。卷的总纲已定,补细纲时据此展开。
- 可随时 get_outline 查看现有大纲与下一个该写的章(nextChapterOrder)。
```
new:
```
【规划大纲】世界观建好后,用 task 委派【outliner 子 agent】建大纲(它会在聚焦上下文里跑完 取KB大纲方法论→建卷/细纲→评审→(修订) 全流程,作者会在右侧『大纲』面板看到结果)。
- 委派时把本书题材/故事核告诉它;等它回复结论(卷数 + 前 N 章细纲 + score)后,告诉作者"全书大纲 + 前 N 章细纲已生成,请在右侧『大纲』面板过目/修改",等作者确认或调整后再写正文。
- 你【不要】自己 set_volume/set_chapter_plan 建卷/细纲——那是 outliner 的职责。你仍可用 get_outline/get_chapter_plan 查大纲。
- 后面的章节【按需补细纲】:写到接近已规划边界(最后一条细纲)时,用 task 委派 outliner「补第 M-N 章细纲」(每次 ~10-20 章),等它结论回来再继续写。卷的总纲已定,outliner 据此展开。
- 可随时 get_outline 查看现有大纲与下一个该写的章(nextChapterOrder)。
```

- [ ] **Step 2: 改写「写作阶段」的无细纲处理**

把「第 N 章没细纲时,先 set_chapter_plan(N) 补上」改为「先委派 outliner 补该章细纲」。

old:
```
- 细纲:第 N 章没细纲时,先 set_chapter_plan(N) 补上,再委派 chapter。
```
new:
```
- 细纲:第 N 章没细纲时,先 task 委派 outliner「补第 N 章细纲」,等它结论回来,再委派 chapter 写。
```

- [ ] **Step 3: 改写 `WRITER_AGENT_PROMPT` 的 no_plan 提示**

old:
```
- 不确定全书进度时调 get_outline 看 nextChapterOrder 定位。若 get_chapter_plan 返回 no_plan,告诉主 agent 先规划该章细纲,不要凭空瞎写。
```
new:
```
- 不确定全书进度时调 get_outline 看 nextChapterOrder 定位。若 get_chapter_plan 返回 no_plan,告诉主 agent 委派 outliner 补该章细纲,不要凭空瞎写。
```

- [ ] **Step 4: typecheck**

Run: `pnpm --dir server typecheck`
Expected: PASS(仅改字符串字面量内文本)。

- [ ] **Step 5: 提交**

```bash
git add server/src/agentos/agent-prompts.ts
git commit -m "$(cat <<'EOF'
feat(agentos): main「规划大纲」改为 task 委派 outliner + writer no_plan 对齐

main 不再自己 set_volume/set_chapter_plan;世界观建好后委派 outliner 子 agent
跑完 取文→建卷/细纲→评审→修订。「按需补细纲」与「第 N 章无细纲」也都改为
委派 outliner。writer 的 no_plan 提示同步改为「委派 outliner」(与 main 不再
自己建纲一致)。

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 实测闭环 + 收尾

**Files:** 无代码改动;验证 + 文档。

- [ ] **Step 1: agent-ui 侧无需改动确认**

大纲面板已读 `Volume`/`ChapterOutline` 表(agent-ui 已有);outliner 经同一 `set_volume`/`set_chapter_plan` → `OutlineService` 落库,FE 自动刷新。无需 FE 改动。

- [ ] **Step 2: 启动并实测闭环**

Run(两个终端,或根 `pnpm dev`):
```bash
pnpm --dir server start:dev   # :3001
pnpm --dir agent-ui dev       # :3000
```
操作 A(建大纲):登录 → 新建小说(立项 CONCEPT)→ 在工作台对话补齐 7 项基础信息 → 观察 main 依次委派 curator → worldbuilder → outliner。
Expected(活动流可见):
1. `outliner` 收到委派 → 委派 `outline-writer`;
2. `outline-writer` 调 `list_knowledge` → `get_knowledge`(取大纲范例集锦等)→ `get_novel_info`/`get_worldview` 对齐 → 多次 `set_volume`(全书卷)+ `set_chapter_plan`(前 N 章);
3. `outliner` 委派 `outline-critic` → `get_outline`/`get_chapter_plan`/`get_novel_info`/`get_worldview`/`query_memory` → `report_outline_review`(得 score);
4. 若 `passed=false`:再委派 `outline-writer` 改被点名卷/章 → `outline-critic` 复评;
5. `outliner` 回 main 一句结论;右侧「大纲」面板出现卷 + 细纲。

操作 B(按需补细纲):写到接近最后一条细纲边界 → 观察 main 委派 outliner「补第 M-N 章细纲」。
Expected:`outliner` → `outline-writer`(先 get_outline/get_chapter_plan/query_memory 读既有+已写)→ 建新批次细纲 → `outline-critic`(重心放衔接一致性)→ 结论回 main。

- [ ] **Step 3: 终态校验**

- `pnpm --dir server typecheck` PASS。
- `pnpm --dir server test` 全绿。
- `pnpm --dir agent-ui validate` PASS(FE 未改,确认无回归)。
- 实测:大纲面板有卷+细纲;main 聊天里不再出现 main 自己调 `set_volume`/`set_chapter_plan`(由 outliner 内部调)。

- [ ] **Step 4: 更新 spec 状态**

把 [spec](../specs/2026-06-24-outliner-subagent-design.md) 顶部 `状态:` 从「已批准(实现中)」改为「已实现」,提交。

```bash
git add docs/superpowers/specs/2026-06-24-outliner-subagent-design.md
git commit -m "docs(outliner): 标记 spec 已实现

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- 镜像 worldbuilder 编排器(main→outliner→{outline-writer,outline-critic},无回滚)→ Task 3 Step 4。✓
- 独立直连 KB(outline-writer 带 list/get_knowledge)→ Task 3 Step 5(`outlineWriterTools`)+ Task 2(outline-writer prompt 第一步)。✓
- 外科式修订 + 最多 1 轮 + 无回滚 → Task 2(orchestrator prompt 步骤 3-5)。✓
- `report_outline_review` 瞬态打分工具 → Task 1。✓
- 6 维 KB-grounded 评审 → Task 1(schema 维度名)+ Task 2(critic prompt)。✓
- 全部接管(初始建纲 + 按需补细纲)→ Task 2(orchestrator prompt 任务类型双分支)+ Task 4(规划大纲建纲 + 按需补细纲都委派)。✓
- critic scope 自适应(建纲评全书 / 补细纲评衔接)→ Task 2(orchestrator 委派 critic 时说明任务类型 + critic prompt「补细纲任务重心放维度 6」)。✓
- main 移除 set_volume/set_chapter_plan、保留只读 → Task 3 Step 3。✓
- main 改为 task 委派(建纲 + 按需补 + 第 N 章无细纲)→ Task 4 Step 1-2。✓
- writer no_plan 对齐 → Task 4 Step 3。✓
- 无 DB/FE 改动 → Task 5 Step 1 确认。✓
- 测试:工具单测(TDD)+ typecheck + 实测(装配/prompt 不做单测,同 chapter/curator/worldbuilder)→ Task 1 / Task 3 Step 6-7 / Task 5。✓

**2. Placeholder scan:** 无 TBD/TODO/"add error handling";每个代码步骤含完整代码;命令含 expected。✓

**3. Type consistency:**
- 工具名:`makeReportOutlineReviewTool`(Task 1)↔ import(Task 3 Step 2)↔ 装配(Task 3 Step 4 outline-critic)。✓
- 提示词名:`OUTLINER_ORCHESTRATOR_PROMPT`/`OUTLINE_WRITER_PROMPT`/`OUTLINE_CRITIC_PROMPT`(Task 2)↔ import(Task 3 Step 1)↔ 装配(Task 3 Step 4)。✓
- 方法名:`outlineWriterTools(userId, novelId)`(Task 3 Step 5 定义)↔ Task 3 Step 4 调用。✓
- 模型实例:`model`(orchestrator + outline-writer,16k)↔ `validatorModel`(outline-critic,6k),二者均在 `buildAgentGraph` 解构作用域内(worldbuilder 装配已证明可见)。✓
- `makeSetVolumeTool`/`makeSetChapterPlanTool`:从 main 移除(Task 3 Step 3)但 import 保留、被 `outlineWriterTools` 复用(Task 3 Step 5)。✓
- 工具集一致性:Task 2(orchestrator/writer/critic prompt 提到的工具)+ Task 3 Step 4(critic 内联工具集: get_outline/get_chapter_plan/get_novel_info/get_worldview/get_world_entry/query_memory/report_outline_review)+ Task 3 Step 5(outlineWriterTools: list/get_knowledge/set_volume/set_chapter_plan/get_outline/get_chapter_plan/get_novel_info/get_worldview/get_world_entry/query_memory)三处工具集互相吻合。✓
