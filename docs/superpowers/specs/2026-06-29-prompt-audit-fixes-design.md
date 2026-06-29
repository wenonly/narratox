# 提示词审查修复:字数目标 + bug + 冗余 + 编号 + 张力

> 日期:2026-06-29 · 关联 [全 agent 提示词审查](.)(本轮审查的产出)

## 问题(审查结论的 6 项)

1. **总字数目标缺失 + 字数目标到不了 writer(bug1)**:writer/chapter-orch 指示 `get_novel_info` 查 chapterWordTarget,但二者均无此工具 → writer 拿不到每章字数目标,「写到目标就停」空转。且无「全书字数目标」。
2. **bug2**:`get_outline 查开放伏笔` 指错工具(get_outline 不返伏笔;query_memory 才覆盖 hooks)。
3. **WRITER 冗余**:step 0 与 细纲/连续/角色/其他 小节重复列举同一组工具调用(~30% 膨胀 + 注意力稀释)。
4. **OUTLINER_WRITER 编号乱**:第一步取KB → 第零步立总纲 → 第一步分卷(重号)→ 分弧(无号)→ 第三步建细纲。
5. **chapter-orch 重复 spec writer 内部流程**(:160-165 把 writer step 0 又嘱托一遍,含 bug1/bug2)。
6. **理论张力**:网文「直白明快/高密度/短句加速」与去AI/作者声音「句长波动/叙述者声音/专属意象」并列无优先级 → 模型拉扯。

## 设计

### #1 totalWordTarget(必问+建议)+ 字数目标到 writer
- `NovelSettings` 加 `totalWordTarget?: number`(settings JSON,**无 DB 迁移**)。
- **必问基础项**:进 `StatusService.NovelOnboardingBasics`(`totalWordTarget: !!settings.totalWordTarget`),`basicsAll` 自动纳入 → main 见 missing 会问。MAIN 立项清单加「缺总字数目标:全书大概多少字?建议:网文长篇 100万-300万,从你的题材看可以 X」(**给建议、用户选**,同其它字段模式)。
- **注入**:
  - writer augment(runTurn 取 settings 拼):`【字数目标】每章 X 字(写到就停)· 全书 Y 字`。**修 bug1**(writer 每轮必见,无工具调用)。
  - main buildSystemPrompt:【每章字数目标】旁加【全书字数目标】。
  - 态势 slice:totalWords 后加 `(Z% of 全书目标)`,若 totalWordTarget 存在。

### #2 bug2
writer[:94](../../server/src/agentos/agent-prompts.ts#L94) + chapter-orch[:163](../../server/src/agentos/agent-prompts.ts#L163):「get_outline 查开放伏笔」→ 「`query_memory`(kind=hook)查开放伏笔」。

### #3 WRITER 冗余清除(不牺牲效果)
step 0 = canonical「读什么」清单;下方小节只留**纪律/why**,删重复的工具调用列举。**实质指导全留**:
- 【细纲】:删「先调 get_chapter_plan」(step0 有),留骨架/必须覆盖/禁区/字数停/no_plan 上报。
- 【连续】:删「先 get_chapter(N-1)」(step0 有),**留接缝反漂移细则**(地点/在场人/情绪,不瞬移/重置/断裂)——精华。
- 【角色】:删「先 get_character」(step0 有),留「查当前态非凭印象/角色会成长」。
- 【其他】(69-72):压成一行(遵循设定、保持一致)。

### #4 OUTLINER_WRITER 重编号
理顺逻辑序:① 取KB方法论 → ② 立总纲 → ③ 分卷 → ④ 分弧 → ⑤ 建细纲。(补细纲/改写为条件任务段,保留。)

### #5 chapter-orch slim(不牺牲效果)
:160-165 委派指示从「re-spec writer step 0」缩为「委派 writer『写/改/续/重写第 N 章』+ 作者要求(+重写附原因)。writer 自行读细纲/相邻章/伏笔/角色(见其 step 0)」。**保留**编排器独有:流程控制(writer→settler→validator→最多1轮修订→复校)、snapshot/restore、细纲过时信号回传。

### #6 优先级桥接(节奏至上)
WRITER「网文技法」与「去AI/作者声音」之间插:
> 【优先级 — 节奏至上】网文卖爽感与节奏,这是命门,优先级最高。下方「去AI/作者声音」是**表层手法,服务于节奏**:句长波动为变速(短句加速/长句点缀)非拖沓;叙述者声音是 sprinkle(短语/半句)非独白;专属意象是点缀复现非堆砌;删金句是删填充非删信息。**冲突时让节奏与信息密度赢。**

## 改动面

| 文件 | 改 |
|---|---|
| `agent-prompts.ts` | WRITER(step0 为准+去冗余+优先级桥接+bug2)、chapter-orch(slim+bug2)、OUTLINER_WRITER(重编号)、MAIN(立项清单加 totalWordTarget) |
| `context-assembler.service.ts` | buildSystemPrompt 加【全书字数目标】;态势 slice 加进度 % |
| `deep-agent.service.ts` | runTurn 取 settings 拼【字数目标】slice 进 writer augment |
| `novel/status.service.ts` | NovelOnboardingBasics 加 totalWordTarget;overview 进度 % |
| `agent-ui/src/types/novel.ts` | NovelSettings 加 totalWordTarget;NovelStatus.basics 加 totalWordTarget |
| 测试 | status.service(basics 含 totalWordTarget)、context-assembler(buildSystemPrompt 含全书字数) |

**无 DB 迁移**(settings JSON)。FE 无 UI 改动(立项走 chat;类型补字段)。

## 显式不做
- 不给 writer 挂 get_novel_info(用 augment 注入更可靠)。
- 不改 validator dim10(它查 pace-neutral 的 AI tell,不逼加声音)。
- 不动总纲/大纲/角色等其它 prompt。

## 测试
- `status.service.spec`:basics 含 totalWordTarget(空→false,有→true);进度 %(totalWordTarget 存在时)。
- `context-assembler.service.spec`:buildSystemPrompt 含【全书字数目标】(当 settings 有)。
- 回归 `pnpm test` + `typecheck`。
