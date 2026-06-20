# Stage A2 — 结算关卡（skill 化流程 + 领域前置关卡）

> 日期：2026-06-20
> 状态：已批准（设计），待实现
> 路线图：[docs/ROADMAP.md](../../ROADMAP.md) Stage A2
> 前序：[A1 立项信息](./2026-06-20-onboarding-fields-design.md)
> 参考：[inkos](../../references/inkos-workflow-reference.md)、[webnovel-writer](../../references/webnovel-writer-workflow-reference.md)、deepagents 源码 + 教程

## 背景与问题

ROADMAP A2 原本设想「实现真正的 `run_pipeline` / `write_chapter` 工具，服务端在代码里串行 writer→settle→validate」。调查后发现这个设想既非必要也非最优：

1. **幻影 `run_pipeline`**：[context-assembler.service.ts](../../../server/src/agentos/context-assembler.service.ts) 的 prompt 告诉 agent「调用 run_pipeline 写章」，但全代码库**没有这个工具**——实际是 main agent 靠 `MAIN_AGENT_PROMPT` 文字委派 writer/settler/validator。
2. **真正的缺口只是「可靠性」**：流式 UX 已经 OK——writer/settler/validator 作为 deepagents subagent 跑在 main agent 的单一 stream 里，[activity-emitter.ts:90](../../../server/src/agentos/activity-emitter.ts#L90) 已发 `▶ writer / ◀ 主 agent` 标记。**唯一问题是模型偶尔跳过 settler** → 本章不结算 → 下一章【前情】为空 → 写盲。

## 调查结论：deepagents 没有 pipeline 原语，也不需要

deepagents 的 `create*` 工厂完整清单里**没有** `createPipeline`/`createSupervisor`/`createWorkflow`（grep 命中仅在 sourcemap）。它的编排模型是**模型驱动委派**：

- `createSubAgentMiddleware`（同步，narratox 现用）：主 agent 调 `task` 委派，靠 prompt。
- `createAsyncSubAgentMiddleware`（异步）：fire-and-forget，且官方特意防「立即轮询变同步」——明确反对确定性流水线。

**关键洞见**：webnovel-writer 也没有代码 pipeline——它的可靠性来自两层：① 显式 procedural skill（SKILL.md 编号步骤）；② **工具/数据层关卡**（工具拒绝非法状态，如 commit 时投影未做完则失败）。纯提示词 ~90%，关卡是硬兜底。

deepagents **确实**提供一个原生关卡机制：自定义 `AgentMiddleware` 的 **`wrapToolCall`** 钩子（栈位 8，[02-customization.md:171](../../../langchain-learn/deep-agents-tutorial/02-customization.md#L171)）——可拦截工具调用、自动覆盖所有工具。但对**本**关卡，领域服务更正确（见下）。

## 决策：skill 化流程 + 领域前置关卡（不写死 pipeline）

### 关键原则：不变量归属决定关卡位置

| 不变量类型 | 归属 | 例子 |
|---|---|---|
| **agent 行为不变量** | middleware（`wrapToolCall`） | 「main agent 写前必须先调 get_novel_info」「委派 writer 前需 plan」 |
| **领域数据不变量** | 领域服务（`ChapterService`） | 「章节不能越过未结算的前驱章前进」 |

本关卡是**领域数据不变量**——「写章节」的属性，不是「agent 写章节」的属性。它应对**所有写入方**生效（今天的 agent 工具、未来的 REST 导入、批处理脚本），不止 agent 工具。放 middleware 会让非 agent 路径静默绕过；且 middleware 按工具名匹配，重命名即失效。故选**领域服务**。

> middleware 选项保留给未来的 **agent 行为关卡**（如 A3「写前需 plan」——那是 agent 流程，不是数据完整性）。

## 方案三件套

### 1. skill 化流程（改 `MAIN_AGENT_PROMPT`）
把模糊的「委派 writer/settler/validator」写成**显式编号流程**，让模型可靠地走 write→settle→validate，并告知关卡存在（解释为何不能跳结算）：

```
【写章流程】作者要写/续写第 N 章时,严格按序:
1. 委派 writer 写正文(task → writer),一节节 append_section 拼成。
2. writer 写完后,【立即】委派 settler 结算(task → settler,调 write_summary)。
3. 结算后,委派 validator 校验(task → validator)。
4. 简短告知作者进展。
注:第 2 步不能跳过——未结算的章,写下一章会被系统拒绝。
```

同时**修复幻影 `run_pipeline`**：`ContextAssembler` 的 CONCEPT/ACTIVE prompt 现写「调用 run_pipeline 写章」（工具不存在）→ 改为描述真实流程（委派 writer→settler→validator）。

### 2. 领域前置关卡（`ChapterService.assertFrontier`）
在 `ChapterService` 加一个纯函数式前置检查 + advance 路径调用它：

```ts
// 写一次,所有 advance 路径共用
async assertFrontier(userId, novelId, order): Promise<
  | { ok: true }
  | { ok: false; reason: 'predecessor_not_settled'; unsettledOrder: number }
> {
  if (order <= 1) return { ok: true };                  // 第 1 章无前驱
  const prev = await this.prisma.chapter.findFirst({ where: { novelId, order: order - 1 } });
  if (!prev?.content) return { ok: true };              // 前驱无正文,没东西可结算
  const settled = await this.prisma.chapterSummary.findFirst({ where: { chapterId: prev.id } });
  return settled ? { ok: true } : { ok: false, reason: 'predecessor_not_settled', unsettledOrder: order - 1 };
}

async appendSection(userId, novelId, order, content) {
  const gate = await this.assertFrontier(userId, novelId, order);   // ← advance 路径
  if (!gate.ok) return gate;                                        // 不写,返回关卡结果
  ...原逻辑(findOrCreateByOrder + append + COMMITTED)
  return { ok: true };
}
```

- **不变量**：故事永远无法越过「有正文但未结算」的章前进。
- **DRY**：逻辑在 `ChapterService` 写一次；所有 writer 工具都是 `ChapterService` 的薄壳（`append_section`→`appendSection` 等），自动继承；新写工具调 `ChapterService` 即覆盖，零重复。
- **范围**：只拦 advance 路径（`appendSection`）。编辑路径（`replaceText`/`insertText`/`deleteText`/`clearChapter`）不动——编辑不推进前沿,不该被拦。
- `ChapterService` 仅依赖 `PrismaService`，关卡查 `chapterSummary` 表直接用现有 prisma（不引入 `SummaryService`，避免耦合）。

### 3. 工具层翻译拒绝结果
`append_section` 工具拿到 `{ ok:false, reason:'predecessor_not_settled', unsettledOrder }` → 返回结构化结果给模型：

```ts
return {
  ok: false,
  reason: 'predecessor_not_settled',
  unsettledOrder: gate.unsettledOrder,
  message: `请先用 settler 结算第 ${gate.unsettledOrder} 章后再写后续章节。`,
};
```

模型看到拒绝理由 → 形成「提示词引导 + 关卡兜底」闭环，无需把检查做成 LLM 可调工具（那会重新依赖提示词、浪费往返）。

## 测试（TDD，纯领域逻辑）

`ChapterService` 已有测试模式（mock prisma）。新增断言：
- `assertFrontier`：order≤1 放行；前驱无正文放行；前驱有正文且有 summary 放行；前驱有正文但无 summary → `{ ok:false, reason:'predecessor_not_settled', unsettledOrder }`。
- `appendSection`：关卡未过时不写（不调 update）、返回关卡结果；关卡通过时正常追加。
- `append-section.tool`：关卡未过时返回结构化拒绝、不调 `novels.activate`；通过时正常。
- `context-assembler.service.spec`：更新——原 `expect(prompt).toContain('run_pipeline')` 断言改为断言真实流程（含 writer/settler/validator 编号步骤）。

## 验收

- 模型写完第 1 章未结算、尝试写第 2 章 → 被 `append_section` 拒绝，理由明确，模型被迫先结算。
- 第 1 章正常增量写作（多次 append_section 到第 1 章）**永不被拦**。
- 编辑已有章不受影响。
- `pnpm --dir server test` 全绿；回归现有 171 测试。
- prompt 不再出现不存在的 `run_pipeline`。

## 非目标（YAGNI / 留后续）

- **不做**真 `run_pipeline` / `write_chapter` 工具、不重构 subagent 为独立 agent（Option C）——调查证明非必要、且大重构有回归风险。
- **不做**轮末安全网——关卡已保证「不能盲写下一章」；「写了永不再推进」的长尾留待实测，YAGNI。
- validator→revise 闭环（[D1](../../ROADMAP.md)）不在本步。
- 多关卡扩展位：当出现第二个领域关卡时，再抽 `ChapterWriteGuard` 聚合；现在单方法足够，不过度抽象。
- agent 行为关卡（如 A3 plan）届时用 `wrapToolCall` middleware——本步在 spec/ROADMAP 留说明。

## 与 ROADMAP 的偏离（需同步更新）

ROADMAP A2 原文「实现真正的 write_chapter(order) 工具…代码串行」→ 实际采用「skill + 领域关卡」。理由见上（deepagents 无 pipeline 原语；缺口是可靠性而非编排；领域关卡更正确且可扩展）。实现后更新 [ROADMAP.md](../../ROADMAP.md) A2 条目标注进度与实际方案，README checkbox 同步。
