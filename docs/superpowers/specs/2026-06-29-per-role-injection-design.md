# 按角色重新分配注入:main 瘦身 + writer 补前情

> 日期:2026-06-29 · 关联 [Phase 19 上下文压缩](./2026-06-28-context-compression-design.md)、[工具返回瘦身](./2026-06-29-tool-return-slim-design.md)

## 问题诊断

继续「按角色注入」的一致化。当前两个错配:

1. **main 被严重过度注入**:它是编排者(委派 + 决定下一步 + 跟作者对话),不写正文/设定/大纲/角色。却每轮被动吞 9 个 slice——其中 7 个(当前弧线/世界观/角色索引/前情/近期事件/未回收伏笔/写作参考)它根本用不上,属于「以防万一」的浪费(和已修的反模式同源)。光「写作参考」(精要 6×500+索引)就 ~3-4k tok/轮。
2. **writer 缺中程前景**:writer 只有 N-1 全文(接缝),「3-5 章前发生了啥」得主动 query_memory,没被动近期概览。而 main 倒拿着【前情】(last 5 摘要)却用不上——**前情注错了对象**。

## 目标

按角色实际职责重新分配注入:
- **main**:只留**态势**(下一步路由,每轮必须)+ **总纲**(北极星,编排定调)。其余删——main 有读工具(get_outline/get_worldview/get_characters/get_events),需要时按需拉。
- **writer**:augment 补**【前情】**(last 5 摘要),补上 N-1 全文与 query_memory 之间的中程视野。

## 设计

### 1. ContextAssembler 瘦身(main 只 {态势, 总纲})

`forSession` 只构建 + 注入 2 个 slice:
- 【总纲】(masterSlice,已有)
- 【小说态势】(overview,已有)

**删除**对 main 的注入:【当前弧线】【世界观】【角色索引】【前情】【近期关键事件】【未回收伏笔】【写作参考】,及其 fetch(listRecent/listOpen/listCore/listIndex/listRecentMajor/findArcByChapter/listByChapterRange/listAll)与 helper(buildCharacterIndexSlice)。

**顺带清理依赖**:ContextAssembler 构造器从 10 参瘦身到 **3 参**`(prisma, statusService, masterOutlines)`——其余 7 个服务(summaries/events/world/references/characters/eventService/arcService)main 不再用,移除(前情移给 writer 侧 DeepAgentService,它已注入 summaries)。`buildReferenceSlice` import 移除(main 不再注入参考;DeepAgentService 侧仍用)。

> main 仍有:本书字段(title/genre/synopsis/冲突/字数/worldviewText/style)——在 buildSystemPrompt 里,编排委派要传的「题材+故事核」来自这里。态势告诉它「世界✓大纲✓角色✓ + 下一步」。需要细节 → tool 拉。

### 2. writer 补【前情】

新纯函数 `server/src/agentos/fore-slice.ts`:
```ts
export function buildForeSlice(
  summaries: { chapterOrder: number; summary: string }[],
): string {
  if (!summaries.length) return '';
  // listRecent 返回 desc(最新在前);前情用早→晚,故 reverse。
  const recap = summaries
    .slice()
    .reverse()
    .map((s) => `第${s.chapterOrder}章:${s.summary}`)
    .join(' / ');
  return `【前情】${recap}`;
}
```

`DeepAgentService.runTurn`:`const fore = await this.summaries.listRecent(userId, novelId, 5); const foreSlice = buildForeSlice(fore);` → 作为 `foreSlice` 入参传 `buildAgentGraph`。`resolvePrompt` 的 writer 分支:
```ts
if (spec.promptAugment === 'writer') prompt += masterSlice + foreSlice + voiceSlice;
```
(rewind 入参补 `foreSlice: ''`。)

writer 现有 augment(总纲 + 参考 + voice)不变,仅插前情。

## 改动面

| 文件 | 改动 |
|---|---|
| `server/src/agentos/context-assembler.service.ts` | 构造器 10→3 参;forSession 只 {态势,总纲};删 7 slice 的 fetch/push + buildCharacterIndexSlice + buildReferenceSlice import |
| `server/src/agentos/fore-slice.ts` | **新增**:buildForeSlice 纯函数 |
| `server/src/agentos/deep-agent.service.ts` | runTurn 取 listRecent(5) 建 foreSlice 入参;resolvePrompt writer 追加;rewind 入参补 foreSlice |
| `server/src/agentos/context-assembler.service.spec.ts` | 构造器改 3 参;forSession 断言改为「main 只注入 态势+总纲,不注入 前情/参考/角色/伏笔/世界/事件」 |
| `server/src/agentos/context-assembler.memory.spec.ts` | **删除**(整文件测的是 main 注入 前情/伏笔,main 不再做) |
| `server/src/agentos/fore-slice.spec.ts` | **新增**:有摘要格式化 / 无摘要返 '' / 早→晚顺序 |

**不动**:buildSystemPrompt;DB;FE;subagent(validator/settler/orchestrator 不变);main 的读工具(按需拉)。

## 显式不做

- **不给 writer 注入 事件/伏笔**(场景特定,writer 有 get_events/query_memory 按需拉;前情是每章都要的中程视野,才被动注入)。
- **不删 main 读工具**(get_outline/get_worldview/get_characters/get_events 留着,组委派消息/答作者时按需用)。
- **不动 writer 的 参考/总纲/voice augment**(已对)。

## 测试

- `fore-slice.spec`:有摘要 → `【前情】第1章:… / 第2章:…`(早→晚);空 → ''。
- `context-assembler.service.spec`:3 参构造;main prompt 含 态势+总纲(若 mock 返回),**不含**【前情】【角色】【未回收伏笔】【世界观】【近期关键事件】【写作参考】。
- 删 `context-assembler.memory.spec.ts`。
- 回归:`pnpm test` + `typecheck`(注意:DeepAgentService / 其他 ContextAssembler 引用点同步)。

## 验证未覆盖

- main 瘦身后,组委派消息是否仍够信息(靠本书字段 + 态势 + 按需 tool)——live E2E 验。
- writer 拿到前情后是否真用它衔接——live E2E 验(prompt 行为)。
