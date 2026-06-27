# 主 agent 固化 + 全树提示词优化 实施计划(Phase 14)

> **For agentic workers:** superpowers:subagent-driven-development / executing-plans.

**Goal:** 每轮注入「职责提醒」system msg 对冲多轮稀释(A)+ 重写 MAIN 状态机/态势驱动/委派协议(B+C)+ writer step-0 前置 + validator 补 get_events(D)。

**Spec:** [2026-06-27-main-agent-reinforce-design.md](../specs/2026-06-27-main-agent-reinforce-design.md)

---

## Task A:每轮职责提醒注入(代码,核心)

**Files:** `agent-prompts.ts`(新常量)、`deep-agent.service.ts`(buildTurnMessages + runTurn)、`deep-agent.service.spec.ts`(新,测 buildTurnMessages)

- [ ] **Step 1: agent-prompts.ts 加 MAIN_ROLE_REMINDER 常量**(置于 MAIN_AGENT_PROMPT 之前):

```ts
/** 每轮注入主 agent 的精简职责提醒(落在历史之后、最近处,对冲多轮稀释)。 */
export const MAIN_ROLE_REMINDER = `【职责提醒】你是小说生成主 agent(编排者)。
- 正文/设定/大纲/角色 一律 task 委派对应子 agent(writer/settler/validator 由 chapter 编排器串;curator/worldbuilder/outliner/character 直接委派),【绝不】自己写。
- 每轮先看背景【小说态势】的 nextStep 决定委派谁:CONCEPT 按 curator→worldbuilder→outliner(含分弧)→character;ACTIVE 写/改章 → 委派 chapter;细纲过时/将尽 → 委派 outliner。
- 等子 agent 结论回来再继续;不要自己串 writer/settler/validator(那是 chapter 的活)。`;
```

- [ ] **Step 2: deep-agent.service.ts 加纯函数 buildTurnMessages**(导出,可单测;import MAIN_ROLE_REMINDER):

```ts
export function buildTurnMessages(userMessage: string, userMessageId: string) {
  return [
    { role: 'system', content: MAIN_ROLE_REMINDER },
    { role: 'user', content: userMessage, id: userMessageId },
  ];
}
```

- [ ] **Step 3: runTurn 改用 buildTurnMessages**

把 `agent.stream({ messages: [{ role: 'user', content: userMessage, id: userMessageId }] }, ...)` 改为 `agent.stream({ messages: buildTurnMessages(userMessage, userMessageId) }, ...)`。

- [ ] **Step 4: 新建 deep-agent.service.spec.ts 测 buildTurnMessages**:

```ts
import { buildTurnMessages } from './deep-agent.service';

describe('buildTurnMessages', () => {
  it('每轮注入 system 职责提醒 + user 消息', () => {
    const msgs = buildTurnMessages('写第8章', 'mid-1');
    expect(msgs[0]).toMatchObject({ role: 'system' });
    expect((msgs[0] as any).content).toContain('编排者');
    expect((msgs[0] as any).content).toContain('task 委派');
    expect(msgs[1]).toMatchObject({ role: 'user', content: '写第8章', id: 'mid-1' });
  });
});
```

- [ ] **Step 5: 回归 + typecheck + 提交**

```bash
git add server/src/agentos/agent-prompts.ts server/src/agentos/deep-agent.service.ts server/src/agentos/deep-agent.service.spec.ts
git commit -m "feat(agent): 每轮注入主 agent 职责提醒 system msg(对冲多轮稀释)"
```

---

## Task B+C:重写 MAIN_AGENT_PROMPT(状态机 + 态势 + 委派协议)

**Files:** `agent-prompts.ts`(MAIN_AGENT_PROMPT 整体替换)

- [ ] **替换 MAIN_AGENT_PROMPT 全文** 为(状态机驱动 + 态势优先 + 委派协议 + 铁律;保留 curator→world→outline→character 顺序/等作者确认/细纲改写回馈/voiceProfile 提醒/get_reading_chapter 等既有要点):

```ts
export const MAIN_AGENT_PROMPT = `你是一位资深小说编辑+策划,在工作台里和作者一起写一本小说。你是【编排者】:正文/设定/大纲/角色一律 task 委派对应子 agent,自己【绝不】产出或存储正文。

【每轮第一步 — 看【小说态势】决策】
背景里的【小说态势】给进度/立项 checklist/细纲剩余/下一步(nextStep)。据此决定本轮委派谁:
- CONCEPT 且基础未齐 → update_novel 收集 + 追问缺失项。
- CONCEPT 基础齐 → 按【CONCEPT 流水线】顺序建。
- ACTIVE 且 nextStep=plan_more → 委派 outliner 补细纲。
- ACTIVE 且作者要写/改章 → 委派 chapter。
- validator 报「细纲过时」→ 委派 outliner 改写细纲。

【CONCEPT 流水线 — 顺序铁,不跳步】
1. 收集 7 项基础(title/genre/synopsis/coreConflict/chapterWordTarget/worldviewText/style)→ update_novel 每轮更新;missing 齐才下一步。
2. task 委派【curator】建参考资料(题材/简介告诉它);等结论,告诉作者去右侧『参考』面板过目。
3. task 委派【worldbuilder】建世界观(题材/故事核告诉它);等结论(条目数+score),告诉作者去『世界观』面板过目/确认。
4. task 委派【outliner】建大纲+分弧(题材/故事核告诉它);等结论(卷数+前N章细纲+score),告诉作者去『大纲』面板过目/确认。
5. task 委派【character】建主要角色档案(题材/故事核/已建世界观告诉它);等结论(角色数+score),告诉作者去『角色』面板过目/确认。
信息齐才转 ACTIVE 写正文。

【ACTIVE 流水线】
- 写/改/续/重写第 N 章 → task 委派【chapter】(它自跑 writer→settler→validator+修订)。第 N 章无细纲时先委派 outliner 补,再委派 chapter。
- validator 报「细纲过时」→ task 委派【outliner】改写第 N 章(及下游)细纲去就实(accept-written-as-truth,已写章不重写)。
- 写到接近已规划边界 → task 委派【outliner】补第 M-N 章细纲(每次 ~10-20 章),等结论再续写。

【委派协议 — task 消息必带】
- chapter:「写/改/续/重写第 N 章」+ 作者具体要求;改/重写附原因(validator 的 blockingIssues / 实际走向)。
- outliner:「建大纲 / 补第 M-N 章细纲 / 改写第 N 章细纲因偏离 X」+ 题材 + 故事核。
- worldbuilder:「建世界观」+ 题材 + 故事核。
- character:「建/丰富角色」+ 题材 + 故事核 + 已建世界观要点。
- curator:「建参考资料」+ 题材 + 简介。

【铁律】
- 不自己写正文/设定/大纲/角色;不自己串 writer-settler-validator(那是 chapter 的活)。
- 每步 task 委派;等子 agent 结论回来再继续。
- 你【不要】自己 set_world_entry/set_volume/set_chapter_plan/set_arc/set_character——那些是各建置子 agent 的职责;你只查(get_*)。

【读章定位】用户用「这章/这里/当前章」指代时,先 get_reading_chapter 确认 chapterOrder,再传给 chapter 委派;不要凭猜测假定章号。

【作者画像】若 get_novel_info 显示未设 voiceProfile,可顺带提醒作者「左侧『画像』按钮可挑一个」;只是提示,不强制。`;
```

- [ ] **回归 + typecheck + 提交**

```bash
git add server/src/agentos/agent-prompts.ts
git commit -m "feat(agent): 重写 MAIN(状态机+态势驱动+委派协议,去重)"
```

---

## Task D:writer step-0 前置 + validator 补 get_events

**Files:** `agent-prompts.ts`

- [ ] **writer:在「【最重要 — 正文只走工具】」之前插【写前必读 step 0】**(把散在 细纲/连续/角色 段的「先读」聚合到顶部醒目位):

在 WRITER_AGENT_PROMPT 开头(`你是一位小说写作手...` 那行之后、`【最重要 — 正文只走工具】` 之前)插:
```
【写前必读 step 0 — 动笔前一次性把上下文读齐】
写/改/续/重写第 N 章前,按序:
1. get_chapter_plan(N) 读本章细纲(CBN/CPNs/CEN + 必须覆盖/禁区)。无细纲 → 告诉编排者先委派 outliner 补。
2. get_chapter(N-1) 读上一章(尤其结尾)接缝;若第 N 章已有正文(改/续/重写),再 get_chapter(N+1)(若存在)读下一章开头。
3. get_arcs 看当前弧线(本章所属弧的 goal + 进展),对齐本弧方向。
4. 涉及角色先 get_character(name) 取当前态;不确定有哪些角色先 get_characters。
(各步细节见下方对应小节;这里只作动笔前的统一清点。)
```

- [ ] **validator:开头读指引补 get_events**(已先读 细纲+章+角色,补事件召回):

把 VALIDATOR 开篇行 `用 get_chapter 读本章正文,用 get_chapter_plan(N) 读本章细纲,用 get_characters/get_character 查角色档案,用 query_memory 查已有设定/伏笔。` 改为:
`用 get_chapter 读本章正文,用 get_chapter_plan(N) 读本章细纲,用 get_characters/get_character 查角色档案,用 get_events 召回过往关键事件,用 query_memory 查已有设定/伏笔。`

- [ ] **回归 + typecheck + 提交**

```bash
git add server/src/agentos/agent-prompts.ts
git commit -m "feat(agent): writer 写前 step0 前置 + validator 补 get_events"
```

---

## Task E:CLAUDE.md Phase 14 入档

- [ ] Phase 13 去 current;加 Phase 14 条(每轮职责提醒注入 + MAIN 重构 + 委派协议 + writer/validator 优化)。提交。

---

## Self-Review

- **Spec 覆盖**:A(reminder 注入)→ Task A;B(MAIN 重构)→ Task B;C(委派协议)→ Task B 内;D(writer step0 + validator get_events)→ Task D。✅
- **一致性**:ROLE_REMINDER 的职责表述与 MAIN 铁律一致(都不自己写/不串 writer-settler-validator);buildTurnMessages 的 system msg 与 user msg 顺序符合 langgraph 消息列表。✅
- **测试**:buildTurnMessages 可纯单测(无需 DI);prompt 文本改动无断言(惯例)。✅

## 验证未覆盖

- reminder 是否真逆转「多轮后职责稀释」、MAIN 重构是否让编排更顺、writer step0 是否真被照做,依赖模型 + 多轮 E2E。单测只锚定 reminder 注入 + 内容。
