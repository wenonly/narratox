# worldbuilder 子 agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把世界观生成从「main 内联 `set_world_entry`」改成「worldbuilder 子 agent:直连 KB 取设定文档→建条目→wb-critic 6 维评审打分→外科式修订(最多 1 轮)」。

**Architecture:** 镜像 `chapter` 编排器范式。新增 `worldbuilder` 编排子 agent(main 用 `task` 委派,与 `chapter`/`curator` 同级),内部用嵌套 `createSubAgentMiddleware` 挂 `wb-writer`(KB 取文 + 建条目)与 `wb-critic`(6 维 KB-grounded 评审 + `report_worldview_review` 打分)。`passed=false` 时外科式修订被点名条目,不带回滚。`main` 移除 `set_world_entry`。

**Tech Stack:** NestJS 11 + TypeScript + langchain(`createAgent`)+ deepagents(`createSubAgentMiddleware` 中间件)+ LangChain `tool()`/zod。测试:Jest(`server/`,ESM `--experimental-vm-modules`)。

**Spec:** [2026-06-24-worldbuilder-subagent-design.md](../specs/2026-06-24-worldbuilder-subagent-design.md)

**Branch:** `feat/worldbuilder-subagent`(已建,spec 已提交)。

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `server/src/agentos/tools/report-worldview-review.tool.ts` | wb-critic 的瞬态结构化打分工具(镜像 `report-review.tool.ts`) | 新建 |
| `server/src/agentos/tools/report-worldview-review.tool.spec.ts` | 上述工具单测 | 新建 |
| `server/src/agentos/agent-prompts.ts` | 3 段新提示词(`WORLDBUILDER_*`)+ 改写 `MAIN_AGENT_PROMPT`「构建世界观」 | 改 |
| `server/src/agentos/deep-agent.service.ts` | 装配 worldbuilder(嵌套 subagents)+ `wbWriterTools()`;main 移除 `set_world_entry` | 改 |

> 无 schema/DB 改动(`WorldEntry` 已有);无 FE 改动(右侧世界观面板已读 `WorldEntry` 表)。
> 代码库约定:工具单测用 `jest.fn()` double + `t.invoke({...})`(见 `report-review.tool.spec.ts`);agent 图装配/prompt 不做单测(动态 langgraph,与 `chapter`/`curator` 加入时一致),靠 `pnpm typecheck` + `pnpm dev` 实测。

---

### Task 1: `report_worldview_review` 工具(TDD)

**Files:**
- Create: `server/src/agentos/tools/report-worldview-review.tool.ts`
- Test: `server/src/agentos/tools/report-worldview-review.tool.spec.ts`

- [ ] **Step 1: 写失败测试**

创建 `server/src/agentos/tools/report-worldview-review.tool.spec.ts`:

```ts
import { makeReportWorldviewReviewTool } from './report-worldview-review.tool';

describe('report_worldview_review tool', () => {
  it('returns the structured verdict as-is (transient, no persistence)', async () => {
    const t = makeReportWorldviewReviewTool();
    const out = await t.invoke({
      passed: false,
      score: 72,
      dimensions: [
        { name: '逻辑自洽', status: 'pass' },
        { name: '力量体系金手指严谨', status: 'issue', issue: '未说明每级差异' },
      ],
      blockingIssues: ['powerSystem『灵气修炼』未说明每级差异'],
      notes: '概念略堆砌',
    });
    expect(out).toMatchObject({ ok: true, passed: false, score: 72 });
    expect(out.blockingIssues).toEqual([
      'powerSystem『灵气修炼』未说明每级差异',
    ]);
    expect(out.dimensions).toHaveLength(2);
  });

  it('passes through a clean verdict (no blocking)', async () => {
    const t = makeReportWorldviewReviewTool();
    const out = await t.invoke({
      passed: true,
      score: 88,
      dimensions: [{ name: '逻辑自洽', status: 'pass' }],
      blockingIssues: [],
      notes: '',
    });
    expect(out.passed).toBe(true);
    expect(out.blockingIssues).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --dir server test -- report-worldview-review.tool.spec.ts`
Expected: FAIL(`makeReportWorldviewReviewTool` 未定义 / 模块找不到)。

- [ ] **Step 3: 写最小实现**

创建 `server/src/agentos/tools/report-worldview-review.tool.ts`(镜像 `report-review.tool.ts`,工厂无参、瞬态不写库):

```ts
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * wb-critic 子 agent 的「提交世界观评审结构化判定」工具。**瞬态**——不写库,
 * 只把 6 维审计结果结构化返回(经 tool result 回到 wb-critic,活动流亦可见)。
 * wb-critic 据此给编排者(worldbuilder)最终判定;worldbuilder 据 passed/blockingIssues
 * 决定是否进入外科式修订闭环(blockingIssues 须点名是哪条 entry,驱动 wb-writer 定点改)。
 *
 * 无需 userId/novelId 闭包(不触 DB),故工厂无参。
 */
export function makeReportWorldviewReviewTool() {
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
      name: 'report_worldview_review',
      description:
        '提交世界观评审的结构化判定:6 维 pass/issue + 全局 score(0-100) + blockingIssues(必须修、且须点名是哪条 entry)+ notes(非阻塞)。评审完必调,代替散文结论。',
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
                  '维度名:逻辑自洽 / 支撑情节可写性 / 力量体系金手指严谨 / 代入感现实微创新 / 要素完备 / 故事核匹配',
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
            '会让设定崩/写不下去、必须修的问题(自洽冲突/力量体系漏洞/与故事核矛盾/核心条目缺失),每条须点名是哪条 entry(如 powerSystem『灵气修炼』...)。无则空数组。',
          ),
        notes: z.string().optional().describe('非阻塞建议(风格/偏好)'),
      }),
    },
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --dir server test -- report-worldview-review.tool.spec.ts`
Expected: PASS(2 个用例全绿)。

- [ ] **Step 5: 提交**

```bash
git add server/src/agentos/tools/report-worldview-review.tool.ts server/src/agentos/tools/report-worldview-review.tool.spec.ts
git commit -m "$(cat <<'EOF'
feat(agentos): report_worldview_review 瞬态打分工具(wb-critic 用)

镜像 report_review:工厂无参、不写库、结构化返回 passed/score/6维/blockingIssues/notes。
blockingIssues 须点名是哪条 entry,驱动 wb-writer 外科式修订。

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 3 段 worldbuilder 提示词

**Files:**
- Modify: `server/src/agentos/agent-prompts.ts`(在文件末尾追加 3 个 export const)

- [ ] **Step 1: 追加 3 段提示词**

在 `server/src/agentos/agent-prompts.ts` 末尾(`VALIDATOR_AGENT_PROMPT` 之后)追加:

```ts
/**
 * worldbuilder 编排子 agent(层级多 agent,镜像 chapter 编排器):聚焦上下文里跑完
 * 世界观的 取KB→建条目→评审(+修订) 全流程。主 agent 只「建世界观」委派给它。
 * 它自带 task(委派 wb-writer/wb-critic)。无回滚(外科式修订只动被点名条目)。
 */
export const WORLDBUILDER_ORCHESTRATOR_PROMPT = `你是「世界观编排 agent」。你的唯一职责:收到「建/重建世界观」时,在自己的聚焦上下文里【按序跑完】 取文→生成→评审(+修订) 全流程,然后把结论回给主 agent。

【建世界观流程】严格按序:
1. 用 task 委派 wb-writer 子 agent。委派时明确指示:
   - 先 list_knowledge 看索引,挑设定相关条目(优先「设定三技·人物·世界观·金手指」「大纲范例集锦」+ 题材对应公式),get_knowledge 取全文提炼。
   - get_novel_info 读故事核(书名/类型/核心冲突/文风)对齐。
   - set_world_entry 建条目:至少 concept(总览)+ powerSystem(力量体系)+ rule(规则/禁忌),按题材补 location/faction/race/item/history。
2. wb-writer 返回后,【立即】用 task 委派 wb-critic 子 agent 评审(它会 get_worldview+get_world_entry 读全 + get_novel_info 读故事核,调 report_worldview_review 给 passed/score/blockingIssues)。
3. 【修订,最多 1 轮】若 passed=false:
   把 blockingIssues 传给 wb-writer 定点修订——只 set_world_entry 改被点名的条目,【不要】全推重建。
4. 修订后,再用 task 委派 wb-critic 复评。
5. 保留最后结果(即使复评分更低也不回滚——外科式修订只动被点名条目,风险局限单条)。
6. 回复主 agent 一句结论(如「世界观已建:8 条,score 86,概念=…/力量体系=…」或「powerSystem 有硬伤,已修订复评 score 80」)。

【铁律】
- wb-writer 返回后【绝对不能结束】——必须继续 wb-critic。没评审的世界观不算完成。
- 你是编排者,不直接建条目;所有建/改通过 task 委派 wb-writer。
- 修订是质量打磨(最多 1 轮);passed=true 就完成,不为满分反复改。
- 不写角色/大纲/正文(那是别的 agent 的职责)。`;

/** wb-writer 子 agent:先从 KB 取设定方法论,再建/改世界观条目。 */
export const WORLDBUILDER_WRITER_PROMPT = `你是「世界观构建手」。先从知识库取设定方法论,再为本书建/改世界观条目(设定卡片)。

【第一步 — 取 KB 方法论】
- list_knowledge 看全部索引。优先挑这几类条目,get_knowledge 取全文提炼「这个题材怎么把世界观搭好」:
  · 「设定三技·人物·世界观·金手指」——建世界观总纲:世界观=公理/题设(逻辑自洽)、两大模块(自然+人文)、金手指五字诀。
  · 「大纲范例集锦」——九大构成 + 力量体系要自洽(写清原理来源 + 每级差异)。
  · 本书题材对应的短篇公式 / 拆文案例——题材范例。
- get_novel_info 读故事核(书名/类型/核心冲突/文风),据此定调。

【第二步 — 建条目】用 set_world_entry,按 name upsert:
- 必建核心三件:concept(总览:世界背景/基调)、powerSystem(力量体系:等级/上限/代价/来源 + 每级获得什么)、rule(规则/禁忌/铁律/不可为)。
- 按题材补:location(地点)、faction(势力/组织)、race(种族/生物)、item(资源/金手指来源)、history(历史/传说)。
- 每条 content 写实(几百字、有细节、能撑住后续写作),不要空泛大段堆砌。

【力量体系/金手指 — 遵循 KB 五字诀】
唯一性 / 可升级(拓展性)/ 有限制(不能一开始太强,否则后期崩文)/ 简单明了。核心是「能升级」而非「多强大」;不宜开太多太大。

【修订模式】
- 被 critic 点名的条目,只重写那几条(set_world_entry upsert 覆盖),别动没问题的、别全推重建。
- 改前可 get_world_entry(name) 看当前内容再改。

【铁律】世界观条目只走 set_world_entry;不写角色/大纲/正文。`;

/** wb-critic 子 agent:6 维 KB-grounded 评审,输出 report_worldview_review 驱动修订闭环。 */
export const WORLDBUILDER_CRITIC_PROMPT = `你是「世界观质检员」。评审本书世界观条目的质量与可写性。

【读全】get_worldview 列全部条目,get_world_entry 读核心条目(concept/powerSystem/rule)全文,get_novel_info 读故事核(书名/类型/核心冲突/文风)。

【6 维逐项审计】每维 pass / issue:
1. 逻辑自洽——世界观是公理;条目间不自相矛盾(力量等级 ↔ 规则 ↔ 地点 ↔ 势力 ↔ 种族)。
2. 支撑情节·可写性——足够支撑整部小说的情节发展;留冲突与升级空间,不把路写死、不后期崩文。
3. 力量体系/金手指严谨——原理来源清晰 + 每级差异(每级获得什么)明确;金手指遵循唯一/可升级/有限制/简单,核心是「能升级」而非「多强大」、不能一开始太强。
4. 代入感·现实微创新——基于现实微创新而非凭空全新世界;概念不堆砌。
5. 要素完备——自然(地理/地形/气候)+人文(政治/经济/阶层/职业/种族/宗教)两大模块按题材覆盖;核心 concept+powerSystem+rule 齐全。
6. 故事核匹配——设定服务于书名/题材/核心冲突/文风;频道重心对齐(男频重力量体系/暗线,女频重人物网/结局)。

【必须调 report_worldview_review 提交结构化判定】
- blockingIssues 只收「会让设定崩/写不下去」的硬伤(自洽冲突/力量体系漏洞/与故事核矛盾/核心条目缺失),且每条【必须点名是哪条 entry】(如「powerSystem『灵气修炼』未说明每级差异」)——这驱动 wb-writer 的外科式修订。风格/偏好放 notes,不要列为 blocking。
- score(0-100)是全局质量分,严肃打分;有明显硬伤应 ≤75。
- passed = blockingIssues 为空。
调完给编排者一句结论(如「score 72,powerSystem『灵气修炼』未说明每级差异」)。`;
```

- [ ] **Step 2: typecheck 确认导出编译通过**

Run: `pnpm --dir server typecheck`
Expected: PASS(新增的 3 个 `export const` 字符串字面量无类型错误;此时尚未被引用,TS 不报未使用 export)。

- [ ] **Step 3: 提交**

```bash
git add server/src/agentos/agent-prompts.ts
git commit -m "$(cat <<'EOF'
feat(agentos): worldbuilder 三段提示词(编排/wb-writer/wb-critic)

wb-writer 先直连 KB 取设定三技等方法论再建条目;wb-critic 6 维 KB-grounded
评审(逻辑自洽/支撑情节/力量体系金手指/代入感/要素完备/故事核匹配)。

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 装配 worldbuilder 进 deep-agent.service.ts

**Files:**
- Modify: `server/src/agentos/deep-agent.service.ts`(import、main 工具、subagents、新增 `wbWriterTools()`)

本任务 4 处编辑,逐一应用后统一 typecheck + 提交。

- [ ] **Step 1: 扩 import —— 3 段提示词**

在 `server/src/agentos/deep-agent.service.ts` 顶部的提示词 import 块加入 3 个 worldbuilder 提示词。

old:
```ts
import {
  MAIN_AGENT_PROMPT,
  CHAPTER_ORCHESTRATOR_PROMPT,
  WRITER_AGENT_PROMPT,
  SETTLER_AGENT_PROMPT,
  VALIDATOR_AGENT_PROMPT,
  CURATOR_AGENT_PROMPT,
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
} from './agent-prompts';
```

- [ ] **Step 2: 扩 import —— report_worldview_review 工具**

在 `makeReportReviewTool` import 行之后加一行。

old:
```ts
import { makeReportReviewTool } from './tools/report-review.tool';
```
new:
```ts
import { makeReportReviewTool } from './tools/report-review.tool';
import { makeReportWorldviewReviewTool } from './tools/report-worldview-review.tool';
```

> 注:`makeSetWorldEntryTool` 的 import 行**保留**(wb-writer 经 `wbWriterTools()` 仍要用)。

- [ ] **Step 3: main 工具区 —— 移除 set_world_entry(改只读)**

把 main 的世界观工具块从「读写」改成「只读」,删掉 `makeSetWorldEntryTool` 调用,改注释。

old:
```ts
        // 世界观(main 读写):立项后构建世界观条目,写章前查设定。
        makeSetWorldEntryTool({
          userId,
          novelId,
          world: this.world,
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
```
new:
```ts
        // 世界观(main 只读):写章前查设定;建/改世界观由 worldbuilder 子 agent 负责。
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
```

- [ ] **Step 4: subagents —— 在 curator 之后插入 worldbuilder**

在 main 的 `createSubAgentMiddleware.subagents[]` 里,`curator` 块之后、数组收尾 `],` 之前,插入 `worldbuilder` 块(自带嵌套 `createSubAgentMiddleware` 挂 wb-writer/wb-critic)。

old(curator 块及其收尾,作为唯一锚点):
```ts
            {
              name: 'curator',
              description:
                '搜索/提炼写作参考资料并固化为本小说专属参考。立项信息齐、需要建参考资料时委派。',
              systemPrompt: CURATOR_AGENT_PROMPT,
              tools: [
                makeListKnowledgeTool({ kb: this.knowledge }) as never,
                makeGetKnowledgeTool({ kb: this.knowledge }) as never,
                makeSetReferencesTool({
                  userId,
                  novelId,
                  references: this.references,
                }) as never,
                makeGetReferenceTool({
                  userId,
                  novelId,
                  references: this.references,
                }) as never,
              ],
            },
```
new(原 curator 块 + 新增 worldbuilder 块):
```ts
            {
              name: 'curator',
              description:
                '搜索/提炼写作参考资料并固化为本小说专属参考。立项信息齐、需要建参考资料时委派。',
              systemPrompt: CURATOR_AGENT_PROMPT,
              tools: [
                makeListKnowledgeTool({ kb: this.knowledge }) as never,
                makeGetKnowledgeTool({ kb: this.knowledge }) as never,
                makeSetReferencesTool({
                  userId,
                  novelId,
                  references: this.references,
                }) as never,
                makeGetReferenceTool({
                  userId,
                  novelId,
                  references: this.references,
                }) as never,
              ],
            },
            // 世界观编排(worldbuilder):立项信息齐、需要建世界观时委派。它在聚焦上下文里
            // 跑完 取KB→建条目→评审(+外科式修订) 全流程。与 chapter/curator 同级,main 用 task 委派。
            {
              name: 'worldbuilder',
              description:
                '构建/重建世界观。立项信息齐、需要建世界观时委派;它会在聚焦上下文里跑完 取KB设定文档→建条目→评审→(修订) 全流程。',
              systemPrompt: WORLDBUILDER_ORCHESTRATOR_PROMPT,
              model: model as never,
              tools: [], // 纯编排(无回滚 → 不需 snapshot/restore)
              middleware: [
                createSubAgentMiddleware({
                  defaultModel: model as never,
                  generalPurposeAgent: false,
                  defaultMiddleware: subagentStack(),
                  subagents: [
                    {
                      name: 'wb-writer',
                      description: '从知识库取设定文档后建/改世界观条目。',
                      systemPrompt: WORLDBUILDER_WRITER_PROMPT,
                      model: model as never,
                      tools: this.wbWriterTools(userId, novelId),
                    },
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

- [ ] **Step 5: 新增 `wbWriterTools()` 私有方法**

在 `writerTools()` 方法之后(类内、`writerTools` 闭合 `}` 之后)新增方法。

锚点 —— 紧跟 `writerTools()` 的闭合。在 `server/src/agentos/deep-agent.service.ts` 中 `writerTools()` 方法结束处(其最后一行 `makeGetReferenceTool(...)` 的 `]);` 与方法闭合 `}` 之后)插入。即把:

old:
```ts
      // 参考资料(按需取):writer 可取本小说参考资料里 injectTo 未注入的条目全文。
      makeGetReferenceTool({
        userId,
        novelId,
        references: this.references,
      }) as never,
    ];
  }
}
```
new:
```ts
      // 参考资料(按需取):writer 可取本小说参考资料里 injectTo 未注入的条目全文。
      makeGetReferenceTool({
        userId,
        novelId,
        references: this.references,
      }) as never,
    ];
  }

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

- [ ] **Step 6: typecheck 确认装配无误**

Run: `pnpm --dir server typecheck`
Expected: PASS。重点核对:`makeSetWorldEntryTool` import 仍被 `wbWriterTools` 引用(无 unused 报错);`validatorModel`/`model`/`this.world`/`this.knowledge`/`this.novels` 在 `buildAgentGraph` 作用域内可见;新提示词/工具 import 已解析。

- [ ] **Step 7: 跑全量单测确认无回归**

Run: `pnpm --dir server test`
Expected: 全绿(新增 `report-worldview-review.tool.spec.ts` 2 用例 + 既有套件不受影响;`set-world-entry.tool.spec.ts` 仍过——它测的是工具本身,不受 main 移除影响)。

- [ ] **Step 8: 提交**

```bash
git add server/src/agentos/deep-agent.service.ts
git commit -m "$(cat <<'EOF'
feat(agentos): 装配 worldbuilder 子 agent + wbWriterTools

main 的 subagents[] 增 worldbuilder 编排器(嵌套 createSubAgentMiddleware 挂
wb-writer/wb-critic);wb-writer 直连 KB 取文后建条目,wb-critic 用 6k 紧上限
实例评审。main 移除 set_world_entry(worldbuilder 独占世界观创作),保留只读。

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 改写 `MAIN_AGENT_PROMPT`「构建世界观」为委派

**Files:**
- Modify: `server/src/agentos/agent-prompts.ts`(`MAIN_AGENT_PROMPT` 的「构建世界观」一节)

- [ ] **Step 1: 改写「构建世界观」一节**

把 main 直接 `set_world_entry` 的指令改为 `task` 委派 worldbuilder。

old:
```ts
【构建世界观】信息齐后、规划大纲前,先把世界设定建起来(作者会在右侧『世界观』面板看到):
1. set_world_entry 建核心条目:至少 concept(总览:世界背景/基调)+ powerSystem(力量体系:修炼/魔法/科技的等级与上限)+ rule(规则/禁忌:力量上限、不可做的事)。
2. 再补主要 location(地点)、faction(势力/组织)、race(种族)等关键条目(不必一次全建,随写随补)。
3. 告诉作者"世界观已建好,请在右侧『世界观』面板过目/修改",等作者确认或调整后再规划大纲。
- 核心条目(concept+powerSystem)会自动进 writer 的背景;细节条目 writer 写到时会自己 get_world_entry 查。
```
new:
```ts
【构建世界观】信息齐后(curator 之后)、规划大纲前,先用 task 委派【worldbuilder 子 agent】建世界观(它会在聚焦上下文里跑完 取KB设定文档→建条目→评审→(修订) 全流程,作者会在右侧『世界观』面板看到结果)。
- 委派时把本书题材/故事核告诉它;等它回复结论(条目数 + score)后,告诉作者"世界观已建好,请在右侧『世界观』面板过目/修改",等作者确认或调整后再规划大纲。
- 你【不要】自己 set_world_entry 建条目——那是 worldbuilder 的职责。你仍可用 get_worldview/get_world_entry 查设定。
- 核心条目(concept+powerSystem)会自动进 writer 的背景;细节条目 writer 写到时会自己 get_world_entry 查。
```

- [ ] **Step 2: typecheck**

Run: `pnpm --dir server typecheck`
Expected: PASS(仅改字符串字面量内文本)。

- [ ] **Step 3: 提交**

```bash
git add server/src/agentos/agent-prompts.ts
git commit -m "$(cat <<'EOF'
feat(agentos): main「构建世界观」改为 task 委派 worldbuilder

main 不再自己 set_world_entry;立项信息齐后(curator 之后)委派 worldbuilder
子 agent 跑完 取文→建条目→评审→修订,等结论回来再引导作者过目。

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 实测闭环 + 收尾

**Files:** 无代码改动;验证 + 文档。

- [ ] **Step 1: agent-ui 侧无需改动确认**

世界观面板已读 `WorldEntry` 表(agent-ui 已有);worldbuilder 经同一 `set_world_entry` → `WorldEntryService.upsertEntry` 落库,FE 自动刷新。无需 FE 改动。

- [ ] **Step 2: 启动并实测闭环**

Run(两个终端,或根 `pnpm dev`):
```bash
pnpm --dir server start:dev   # :3001
pnpm --dir agent-ui dev       # :3000
```
操作:登录 → 新建小说(立项 CONCEPT)→ 在工作台对话补齐 7 项基础信息 → 观察 main 委派 worldbuilder。
Expected(活动流可见):
1. `worldbuilder` 收到委派 → 委派 `wb-writer`;
2. `wb-writer` 调 `list_knowledge` → `get_knowledge`(取设定三技等)→ `get_novel_info` → 多次 `set_world_entry`(concept/powerSystem/rule…);
3. `worldbuilder` 委派 `wb-critic` → `get_worldview`/`get_world_entry`/`get_novel_info` → `report_worldview_review`(得 score);
4. 若 `passed=false`:再委派 `wb-writer` 改被点名条目 → `wb-critic` 复评;
5. `worldbuilder` 回 main 一句结论;右侧「世界观」面板出现条目。

- [ ] **Step 3: 终态校验**

- `pnpm --dir server typecheck` PASS。
- `pnpm --dir server test` 全绿。
- `pnpm --dir agent-ui validate` PASS(FE 未改,确认无回归)。
- 实测:世界观面板有条目;main 聊天里不再出现 main 自己调 `set_world_entry`(由 worldbuilder 内部调)。

- [ ] **Step 4: 更新 spec 状态(可选)**

把 [spec](../specs/2026-06-24-worldbuilder-subagent-design.md) 顶部 `状态:` 从「已批准（设计），待实现」改为「已实现」,提交。

```bash
git add docs/superpowers/specs/2026-06-24-worldbuilder-subagent-design.md
git commit -m "docs(worldbuilder): 标记 spec 已实现

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- 镜像 chapter 编排器(main→worldbuilder→{wb-writer,wb-critic})→ Task 3 Step 4。✓
- 独立直连 KB(wb-writer 带 list/get_knowledge)→ Task 3 Step 5(`wbWriterTools`)+ Task 2(wb-writer prompt 第一步)。✓
- 外科式修订 + 最多 1 轮 + 无回滚 → Task 2(orchestrator prompt 步骤 3-5)。✓
- `report_worldview_review` 瞬态打分工具 → Task 1。✓
- 6 维 KB-grounded 评审 → Task 1(schema 维度名)+ Task 2(critic prompt)。✓
- main 移除 set_world_entry、保留只读 → Task 3 Step 3。✓
- main 改为 task 委派 → Task 4。✓
- 无 DB/FE 改动 → Task 5 Step 1 确认。✓
- 测试:工具单测(TDD)+ typecheck + 实测(装配/prompt 不做单测,同 chapter/curator)→ Task 1 / Task 3 Step 6-7 / Task 5。✓

**2. Placeholder scan:** 无 TBD/TODO/"add error handling";每个代码步骤含完整代码;命令含 expected。✓

**3. Type consistency:**
- 工具名:`makeReportWorldviewReviewTool`(Task 1)↔ import(Task 3 Step 2)↔ 装配(Task 3 Step 4)。✓
- 提示词名:`WORLDBUILDER_ORCHESTRATOR_PROMPT`/`WORLDBUILDER_WRITER_PROMPT`/`WORLDBUILDER_CRITIC_PROMPT`(Task 2)↔ import(Task 3 Step 1)↔ 装配(Task 3 Step 4)。✓
- 方法名:`wbWriterTools(userId, novelId)`(Task 3 Step 5 定义)↔ Task 3 Step 4 调用。✓
- 模型实例:`model`(orchestrator + wb-writer,16k)↔ `validatorModel`(wb-critic,6k),二者均在 `buildAgentGraph` 解构作用域内。✓
- `makeSetWorldEntryTool`:从 main 移除(Task 3 Step 3)但 import 保留、被 `wbWriterTools` 复用(Task 3 Step 5)。✓
