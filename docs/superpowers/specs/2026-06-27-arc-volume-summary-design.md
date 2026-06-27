# 卷级 + 弧线级摘要设计(Phase 12)

> 日期:2026-06-27 · Phase 12 · 关联 [Phase 8 审视](./2026-06-27-writer-chapter-continuity-design.md)(分层摘要缺口)· 四期长篇连贯性收尾

## 问题诊断

Phase 8 审视核查出**没有分层摘要**:记忆是纯逐章的(`ChapterSummary` 一行 + 注入最近 5 章【前情】)。写第 N 章时 writer 看不到「我现在在哪条弧线、本卷/本弧进展如何」——只有最近 5 章的细节。长篇里卷/弧级的**「我当前在做什么」全局上下文缺失**,writer 容易在弧线内部跑偏(忘了本卷的主线目标、忘了当前弧线要推向哪)。

`Volume.synopsis` 是规划期写的静态卷纲,不随写作回填,不反映已写进展。

## 目标

注入 **【当前弧线】** 让 writer 写章时知道全局位置:当前 **Arc** 的 goal + 滚动 summary + 当前 **Volume** 的 goal + 滚动 arcSummary。两层(卷 + 弧),用户选定。

- **Arc(弧线)**:卷内子段,带 chapter range(`fromChapter`/`toChapter`)——「当前弧」按范围查(currentChapter 落在哪个 arc)。
- **滚动 summary**:settler 每章结算时更新当前 arc + volume 的进展摘要(区别于规划期 synopsis)。

## 设计

### 数据模型

`Volume` 加滚动字段;新增 `Arc` model:

```prisma
// Volume 加:
arcSummary String @default("")   // 滚动:本卷已写进展(区别于规划期 synopsis)

model Arc {
  id          String   @id @default(cuid())
  novelId     String
  novel       Novel    @relation(fields: [novelId], references: [id], onDelete: Cascade)
  volumeId    String?
  volume      Volume?  @relation(fields: [volumeId], references: [id], onDelete: SetNull)
  order       Int
  title       String
  goal        String   @default("")    // 本弧线目标/张力
  fromChapter Int                       // 弧线起章
  toChapter   Int                       // 弧线止章(含)
  summary     String   @default("")    // 滚动:本弧线已写进展
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([novelId, order])
  @@index([novelId, fromChapter])
}
```

`Volume` 加反向 `arcs Arc[]`;`Novel` 加反向 `arcs Arc[]`。

### 谁建 Arc:outliner(set_arc 工具)

新增 `set_arc`(outline-writer):upsert by `(novelId, order)`,入参 `volumeOrder`(解析 volumeId)、`title`、`goal`、`fromChapter`、`toChapter`。OUTLINER_ORCH / OUTLINE_WRITER prompt 加「分弧」:建卷后把每卷切成 2-4 个弧线(每弧一段 chapter range + 目标)。

新增 `get_arcs`(只读,挂 writer/main):列全部弧线,供定位当前弧。

### 谁滚动 summary:settler(write_summary 加参)

`write_summary` 加可选 `currentArcSummary?` + `currentVolumeArcSummary?`(短滚动摘要文本)。settler 每章结算后,据本章 + 近况重写这两段。

**工具按 chapterOrder 解析目标**(settler 不需知道 arc/volume id):
- 当前 arc = `Arc.findFirst({ where: { novelId, fromChapter: { lte: N }, toChapter: { gte: N } } })` → 更新 `summary`。
- 当前 volume = 该 arc 的 `volumeId`,或回落 `ChapterOutline(N).volumeId` → 更新 `arcSummary`。
- 解析不到(arc/volume 未规划)→ 静默跳过(不阻断结算)。

### 注入:ContextAssembler 【当前弧线】

`currentChapter` 复用既有计算。查当前 arc(range)+ 其 volume,注入:

```
【当前弧线】卷1《初入江湖》· 弧2「拜师」(第9-15章,目标:得师父真传)
  弧进展:沈砚入门试炼通过,得长老青眼,尚未见师父真面目…
  卷进展:主角下山入城,结识陆青棠,卷入血书案…
```

无 arc/volume 则不注入(回落到既有 slices)。

### 持久化服务

新增 `ArcService`(memory 或 novel 层):`upsertArc` / `listArcs` / `findArcByChapter(userId, novelId, chapterOrder)` / `updateArcSummary` / `updateVolumeArcSummary`。user scope 走 `novel: { userId }`。

## 改动面

### server
| 文件 | 改动 |
|---|---|
| `prisma/schema.prisma` | `Volume.arcSummary`;新 `Arc` model;Volume/Novel 反向关系 |
| migrate + **手动 generate** | 新表 + 字段 |
| `src/novel/arc.service.ts`(新)+ spec | ArcService |
| `src/novel/novel.module.ts` 或 memory.module | 注册 ArcService |
| `src/agentos/tools/set-arc.tool.ts`(新)+ spec | set_arc 工具 |
| `src/agentos/tools/get-arcs.tool.ts`(新)+ spec | get_arcs 工具 |
| `src/agentos/tools/write-summary.tool.ts` | += currentArcSummary / currentVolumeArcSummary(经 ArcService 按 N 解析) |
| `src/agentos/agent-registry.ts` + `agent-tree.config.ts`(+spec) | 注册 set_arc/get_arcs;挂 set_arc→outline-writer,get_arcs→writer/main |
| `src/agentos/agent-prompts.ts` | OUTLINER_ORCH/OUTLINE_WRITER 加「分弧」;SETTLER 加「滚动 arc/volume summary」;WRITER 提示有【当前弧线】可参考 |
| `src/agentos/context-assembler.service.ts` | 注入 ArcService + 【当前弧线】slice |

### agent-ui
本期**不动 FE**(arc 浏览面板 deferred;注入是用户要的核心)。

## 显式不做(non-goals)

- **不做 FE arc 面板。** 注入是用户要的(写章时知道当前弧);arc 浏览/编辑面板以后加(可挂 OutlineView 下)。
- **不自动划分 arc。** outliner 显式 set_arc(规划概念,不靠启发式)。
- **arc 不跨卷。** `volumeId` 归属单卷;跨卷大弧线用 Volume 表达。
- **不上向量/层级全书摘要。** 本期只滚动 arc/volume 两层;更粗的「全书进展」以后再叠。
- **滚动 summary 每章重写。** settler 每章据本章+近况重生成短摘要(不做 accumulate/追加,避免无界增长);质量靠 settler + 后续优化。

## 测试

1. **ArcService 单测**:upsertArc / listArcs(scope)/ findArcByChapter(range 命中)/ updateArcSummary / updateVolumeArcSummary(按 N 解析 arc+volume)。jest.fn() mock。
2. **set_arc / get_arcs 工具单测**:upsert 生效;get_arcs 返回 JSON 字符串。
3. **write_summary 滚动参数单测**:currentArcSummary 传 → ArcService.updateArcSummary 按本章调用;解析不到不抛错。
4. **agent-tree 快照**:outline-writer += set_arc;writer/main += get_arcs;正向断言。
5. **回归**:`pnpm test` + `pnpm typecheck`。

## 验证未覆盖

- 单测锚定 service/tool/接线;**settler 是否稳定重写 arc/volume summary、注入是否真帮 writer 定位**依赖模型 + DB,需活 E2E(写跨弧线的若干章)。本期不强制。
