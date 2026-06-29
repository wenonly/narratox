# 提示词审查修复 实施计划

> **For agentic workers:** superpowers:subagent-driven-development / executing-plans.

**Goal:** totalWordTarget(必问+建议)+ 字数目标注入 writer(修 bug1);get_outline→query_memory(修 bug2);WRITER 去冗余;OUTLINER 重编号;chapter-orch slim;节奏优先级桥接。

**Spec:** [2026-06-29-prompt-audit-fixes-design.md](../specs/2026-06-29-prompt-audit-fixes-design.md)

---

## Task 1:agent-prompts.ts(WRITER / chapter-orch / OUTLINER / MAIN)

**File:** `server/src/agentos/agent-prompts.ts`

- [ ] **Step 1: MAIN 立项清单加 totalWordTarget**

在 MAIN_AGENT_PROMPT 缺项列表(缺字数目标 之后)加一行:
```
  · 缺总字数目标:"全书大概多少字?建议:网文长篇 100万-300万,中篇 20-50万,从你的题材看可以 X"
```

- [ ] **Step 2: WRITER 优先级桥接(#6)**

在【打斗(战斗章)…】段末(去AI指纹段 之前)插:
```

【优先级 — 节奏至上】
- 网文卖爽感与节奏,这是命门,优先级最高。下方「去 AI 指纹/作者声音」是【表层手法,服务于节奏】:句长波动为变速(短句加速/长句点缀)非拖沓;叙述者声音是 sprinkle(短语/半句)非大段独白;专属意象是点缀复现非堆砌;删金句是删填充非删信息。【两者冲突时,让节奏与信息密度赢】。
```

- [ ] **Step 3: WRITER 去冗余(#3)— 替换 【其他】【细纲】【连续】【角色】【伏笔】 五段**

把从【其他】到 prompt 结尾(伏笔段)整段替换为(step0 已是 canonical 清单,这些只留纪律):
```
【其他】
- 遵循小说设定与已有内容,保持人物、世界观一致;不要编造冲突设定。不确定有哪些章时 list_chapters。

【细纲 — 按骨架写】
- 按 step 0 读到的细纲 CBN→CPNs→CEN 骨架写正文,确保「必须覆盖」的点都写到、不碰「禁区」;结尾(CEN)要承接下一章。
- 写到字数目标就停——不注水凑字、不偷工;偏短补情节,偏长精简。

【连续 — 章节接缝不穿帮】
- 按 step 0 读到的上一章结尾接缝:接住它的地点、在场人、悬而未决的情境、人物情绪——不要人物瞬移、状态重置、场景断裂。(第 1 章无上一章,跳过。)
- 改/续/重写时,确保改完的本章仍能平滑过渡到下一章(step 0 已读 N+1),接缝不留矛盾。

【世界观 — 别编造设定】
- 写到具体地点/势力/种族/规则时,先 get_world_entry(name) 查证(step 0 未覆盖的设定项),不要凭空捏造。不确定有没有相关条目时 get_worldview(type?) 列出;涉及新设定可建议主 agent 委派 worldbuilder 补。

【角色 — 查当前态】
- 按 step 0 读到的角色当前态写(性格/能力/关系/状态);角色会成长——查当前态而非凭印象。角色状态由 settler 每章自动追踪,你不需手动记。

【伏笔 — 刻意推进】
- 写前用 query_memory(kind=hook) 查当前开放伏笔(尤其核心★和⚠️陈旧的)。
- 本章【刻意推进或回收至少一个】已有伏笔——不要只顾写新情节、把旧的忘了。推进方式:暗示/发展/部分揭示/侧面提及都算。`
```
> 注:替换含末尾反引号闭合(这段是 prompt 字符串结尾)。step0-2 已含 get_chapter(N±1),故连续段不再列工具;世界观段保留 get_world_entry(step0 未覆盖设定项)。

- [ ] **Step 4: chapter-orch slim(#5)+ bug2**

把【写章流程】step 1 的委派指示(从「用 task 委派 writer 子 agent 写正文。委派时明确指示:」到「一节节 append_section 拼成。」)替换为:
```
1. 用 task 委派 writer 子 agent:「写/改/续/重写第 N 章」+ 作者具体要求(改/重写附原因)。writer 会自行按其 step 0 读细纲/相邻章接缝/伏笔/角色(query_memory kind=hook 查开放伏笔,刻意推进或回收至少一个)并对齐字数目标。你不必重复嘱托这些。
```

- [ ] **Step 5: OUTLINER_WRITER 重编号(#4)**

把【第一步 — 取 KB 方法论】→【第零步 — 立总纲】→【第一步 — 分卷】→【分弧…】→【第三步 — 建细纲】的标题依次改为:
- 【第一步 — 取 KB 方法论】(不变)
- 【第二步 — 立总纲(全书北极星,分卷前先立)】(原第零步)
- 【第三步 — 分卷】(原「第一步 分卷」,去重号)
- 【第四步 — 分弧(卷内子段)】(原无号)
- 【第五步 — 建细纲】(原第三步)
> 内容不动,仅改标题编号。

- [ ] **Step 6: typecheck** `pnpm --dir server typecheck`(prompt 串改,确认反引号/转义无误)。

---

## Task 2:totalWordTarget 接线(status / types / context / writer augment)

- [ ] **Step 1: `agent-ui/src/types/novel.ts`** — NovelSettings 加 `totalWordTarget?: number`;NovelStatus.onboarding.basics 加 `totalWordTarget: boolean`。

- [ ] **Step 2: `server/src/novel/status.service.ts`**
  - `NovelOnboardingBasics` 接口加 `totalWordTarget: boolean`。
  - basics 计算(:110-117)加 `totalWordTarget: !!settings.totalWordTarget && settings.totalWordTarget > 0,`(`basicsAll` 自动纳入)。
  - overview 返回加 `targetTotalWords: typeof settings.totalWordTarget === 'number' ? settings.totalWordTarget : null,`。

- [ ] **Step 3: `server/src/agentos/context-assembler.service.ts`**
  - buildSystemPrompt:【每章字数目标】后加 `if (s.totalWordTarget) lines.push(\`【全书字数目标】${s.totalWordTarget} 字\`);`
  - forSession 态势 slice:totalWords 后加进度 % —— 在态势行 `${overview.totalWords}字` 后插 `${overview.targetTotalWords ? \` ·目标${Math.round(overview.totalWords/overview.targetTotalWords*100)}%\` : ''}`。

- [ ] **Step 4: `server/src/agentos/deep-agent.service.ts`** — runTurn 取 settings 拼 writer 字数 slice:
```ts
// writer 字数目标(每章+全书):writer 无 get_novel_info,注入 augment 让它每轮必见(修 bug1)。
const novelForTargets = await this.novels.findOne?.(userId, novelId);
const ns = (novelForTargets?.settings as { chapterWordTarget?: number; totalWordTarget?: number } | null) ?? {};
const targetParts = [
  ns.chapterWordTarget ? `每章${ns.chapterWordTarget}字(写到就停)` : '',
  ns.totalWordTarget ? `全书${ns.totalWordTarget}字` : '',
].filter(Boolean);
const targetSlice = targetParts.length ? `\n\n【字数目标】${targetParts.join(' · ')}` : '';
```
> 需确认 `NovelService` 有读 novel 的方法(findOne 或类似);若无,改用 `this.prisma.novel.findUnique`。buildAgentGraph 入参加 `targetSlice`;resolvePrompt writer:`prompt += masterSlice + foreSlice + targetSlice + voiceSlice`。rewind 入参补 `targetSlice: ''`。

- [ ] **Step 5: typecheck + test**

---

## Task 3:测试 + 回归 + CLAUDE.md

- [ ] `status.service.spec`:basics 含 totalWordTarget(空→false);overview.targetTotalWords。
- [ ] `context-assembler.service.spec`:buildSystemPrompt 含【全书字数目标】(当 settings 有 totalWordTarget)。
- [ ] 全量 `pnpm --dir server test && pnpm --dir server typecheck && pnpm --dir agent-ui validate`。
- [ ] CLAUDE.md Phase 19 末尾补一句:本轮提示词审查修复(totalWordTarget 必问+建议/注入 writer 修 bug1;get_outline→query_memory 修 bug2;WRITER 去冗余+节奏优先级桥接;OUTLINER 重编号;chapter-orch slim)。链 spec/plan。

---

## Self-Review
- #1 totalWordTarget → Task2(status/types/context/writer);#2 bug → Task1-Step3(伏笔段)+Step4(chapter-orch);#3 冗余 → Task1-Step3;#4 编号 → Task1-Step5;#5 chapter-orch → Task1-Step4;#6 桥接 → Task1-Step2。✅
- 不牺牲效果:step0 保留为 canonical;各小节留纪律/反漂移细则;去的是重复工具列举。✅
- 一致性:totalWordTarget 贯穿 settings→status basics→态势%→buildSystemPrompt→writer augment。✅
