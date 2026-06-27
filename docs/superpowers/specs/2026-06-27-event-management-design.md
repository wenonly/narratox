# 事件管理设计(Phase 11)

> 日期:2026-06-27 · Phase 11 · 关联 [Phase 8 审视](./2026-06-27-writer-chapter-continuity-design.md)(剧情断层诊断)· Event 独立于 [StoryEvent(伏笔)](./2026-06-27-character-consistency-validator-design.md),relatedHookId 链接

## 问题诊断

Phase 8 架构审视核查出**剧情记忆断层**——这是「长篇丢剧情」的根因:

- 普通情节事件被压成 `ChapterSummary.summary` 一行自由文本,前情窗口写死 5 章([context-assembler.service.ts:115](../../../server/src/agentos/context-assembler.service.ts#L115))。
- 超过 5 章的**具体情节**(不是角色态、不是开放伏笔)从被动上下文里消失,只能靠 `query_memory` **关键词 contains** 召回([query-memory.tool.ts:28-66](../../../server/src/agentos/tools/query-memory.tool.ts#L28))——LLM 猜不对关键词就召不回。「主角第 12 章已见过这 NPC」「第 30 章麦高芬被毁」这类长篇最该记的,反而最易丢。
- 没有结构化「事件」概念:伏笔(StoryEvent)是带 payoff 的钩子,不是「发生了什么」的账本;`ChapterSummary.entities` 是本章局部 JSON,不跨章检索。

净效果:**角色档案 + 伏笔有持久记忆,普通情节没有**。长篇一旦超过 5 章,早期情节事实遗忘。

## 目标

新增 **Event(故事事件)** —— 离散、可检索的「这章发生了什么」结构化账本,作为**一等资源**(像角色/世界/伏笔一样可浏览),并**交叉链接**章/角色/地点/伏笔/细纲。修「超 5 章遗忘剧情」:最近关键事件常驻上下文 + 全量事件可结构化召回。

**独立于 StoryEvent(伏笔)**(用户决定):Event 是「发生了什么」;伏笔是「带 payoff 的钩子」。Event 用 `relatedHookId` 链伏笔(本事件埋/推进/回收了哪个钩子)。

## 设计

### Event 数据模型

新增 Prisma model(独立表)+ 枚举。章节沿用 memory 层惯例 `chapterOrder: Int` 软引用(与 StoryEvent/CharacterChange 一致;便于按章分组/检索,无需 join)。

```prisma
model Event {
  id                String            @id @default(cuid())
  novelId           String
  novel             Novel             @relation(fields: [novelId], references: [id], onDelete: Cascade)
  chapterOrder      Int               // 软引用:在哪章发生(与 StoryEvent/CharacterChange 同模式)
  description       String            // 发生了什么(如「沈砚在密室发现血书」)
  kind              String?           // 可选自由分类标签(revelation/confrontation/death/meeting...),供面板分组
  significance      EventSignificance @default(MINOR)  // MAJOR | MINOR —— 控量阀门
  involvedCharacters String[]         @default([])    // 涉及角色名(软引用,与 roleChanges 用名一致)
  location          String?           // 地点名(软引用 WorldEntry 名)或自由文本
  causedById        String?           // 自引用:导致本事件的事件(因果链,单父)
  causedBy          Event?            @relation("EventCausality", fields: [causedById], references: [id], onDelete: SetNull)
  leadsTo           Event[]           @relation("EventCausality")
  relatedHookId     String?           // 链 StoryEvent(伏笔)——独立+链接
  relatedHook       StoryEvent?       @relation(fields: [relatedHookId], references: [id], onDelete: SetNull)
  relatedHookAction String?           // "planted" | "advanced" | "resolved"(本事件与伏笔的关系)
  createdAt         DateTime          @default(now())
  updatedAt         DateTime          @updatedAt

  @@index([novelId, chapterOrder])
  @@index([novelId, significance])
}

enum EventSignificance {
  MAJOR
  MINOR
}
```

**StoryEvent 加反向关系**:`events Event[]`(供 relatedHook FK)。Novel 加反向关系:`events Event[]`。

**字段决策**:
- `involvedCharacters: String[]`(名字数组,非 M:N 关联表)——系统别处都用名字引用角色(roleChanges/Character 按 name unique),M:N 表是过度设计(MVP 不做)。
- `causedById` 单父自引用(非 M:N 图)——「因为 A 发生 B」;多因/双向图 defer。`onDelete: SetNull`(因果父事件删了不级联删子)。
- `significance` 是**控量阀门**:MAJOR 才注入/重点召回;MINOR 仅可查。防 200 章小说事件爆炸。default MINOR(settler 漏标也保守)。

### 创建:settler 提取第 5 类

settler 现提取 4 类(摘要/角色变化/物品地点/伏笔)。加第 5 类「关键事件」:`write_summary` 新增参数 **`plotEvents`**(避开 `events` 名字与 StoryEventService 注入冲突)。

`plotEvents: array<{ description, significance: 'MAJOR'|'MINOR', kind?, involvedCharacters?: string[], location?, causedById?, relatedHookId?, relatedHookAction? }>` —— settler 每章提取 1-3 个 MAJOR + 若干 MINOR,MAJOR = 剧情转折/揭示/重大冲突,MINOR = 次要推进。新 EventService.createEvents(userId, novelId, plotEvents, chapterOrder) 批量写入。

SETTLER prompt 加【关键事件】段:提取本章关键事件、判 significance、链涉及角色/地点/伏笔/因果实例。

### 召回:get_events 工具

新增 `get_events`(只读查询工厂,照 `get_characters` 模板;**返回 `JSON.stringify`** 防数组被供应商当多模态块)。参数:`chapterFrom?` / `chapterTo?` / `character?`(名)/ `significance?` / `keyword?`。EventService.listEvents(userId, novelId, filters) 查询。

挂给 **writer + validator + main**(召回过往情节:writer 避免与旧情节矛盾;validator 查证;main 编排感知)。`get_events` 是 `query_memory`(关键词)的**结构化补充**——按章/角色/重要性精确查。

### 注入:ContextAssembler 【近期关键事件】 slice

EventService.listRecentMajor(userId, novelId, limit=8) 取最近 8 个 MAJOR 事件(按 chapterOrder desc)。ContextAssembler 在【前情】之后 push:

```
【近期关键事件】第12章:沈砚发现血书 / 第30章:麦高芬被毁 / 第45章:陆青棠叛变 / ...
```

**这是修「遗忘剧情」的核心**:MAJOR 事件常驻上下文,不受 5 章窗口限;更早的靠 get_events 召回。

### FE:EventsView 时间线面板

新增独立 tab `events`(「事件时间线」),照 `WorldView`/`HooksView` 模式 + 复用 `CharactersView` 的「变化时间线」渲染。`ResourceKey` 三处同步(IconRail/ResourcePanel/page.tsx)。

- 取数:`getEvents` client → `GET /novels/:id/events`;刷新触发复用 `summariesWriteSeq`(事件由 settler 经 write_summary 写,与摘要同源,无需新 seq)。
- 渲染:按 chapterOrder 分组(或按 volume),每事件一张卡:`description` + significance 徽标(MAJOR 高亮)+ 涉及角色 chip + 地点 + 关联伏笔链(若有)+ 因果链(causedBy)。折叠=一行;展开=详情 + 跳转(→ 章 / → 角色 / → 伏笔)。

### API

`GET /novels/:id/events` → `EventService.listForPanel(userId, novelId)`(全量,按 chapterOrder)。**只读**(事件由 agent 经 settler 写,与角色同为 agent sole-author,无手动 CRUD 端点)。

## 改动面

### server
| 文件 | 改动 |
|---|---|
| `prisma/schema.prisma` | 新 `Event` model + `EventSignificance` 枚举;StoryEvent/Novel 加反向关系 |
| `prisma migrate dev` + **手动 `prisma generate`** | 新表 migration(Prisma 7 migrate 不自动 regen client) |
| `src/memory/event.service.ts`(新) | EventService:createEvents / listEvents / listRecentMajor / listForPanel |
| `src/memory/memory.module.ts` | 注册 + 导出 EventService |
| `src/novel/novel.controller.ts` | `GET :id/events`(注入 EventService) |
| `src/novel/novel.module.ts` | 导入 MemoryModule(若未导出 EventService) |
| `src/agentos/tools/write-summary.tool.ts` | 加 `plotEvents` 参数 → EventService.createEvents |
| `src/agentos/tools/get-events.tool.ts`(新) | get_events 工具工厂 |
| `src/agentos/agent-registry.ts` | 注册 get_events + ToolDeps 加 EventService |
| `src/agentos/deep-agent.service.ts` | ToolDeps 注入 EventService |
| `src/agentos/agent-tree.config.ts` | writer/validator/main tools += `get_events` |
| `src/agentos/agent-prompts.ts` | SETTLER 加【关键事件】段 |
| `src/agentos/context-assembler.service.ts` | 构造注入 EventService + 【近期关键事件】slice |

### agent-ui
| 文件 | 改动 |
|---|---|
| `src/types/novel.ts` | `EventTimelineItem` 类型 |
| `src/api/routes.ts` | `NovelEvents` 路由 |
| `src/api/novels.ts` | `getEvents` client |
| `src/components/workspace/IconRail.tsx` | `ResourceKey` += `'events'`;RESOURCES 加项 |
| `src/components/workspace/ResourcePanel.tsx` | `ResourceKey`/`TITLES` += events;条件渲染 `<EventsView>` + fallback 兜底;**新增 `EventsView` 组件** |
| `src/app/novels/[id]/page.tsx` | `ResourceKey` += `'events'` |

## 显式不做(non-goals)

- **不统一 Event 与 StoryEvent。** 独立表 + relatedHookId 链接(用户决定);伏笔系统已测已注入,不破坏。
- **不做事件手动 CRUD。** agent(settler)是唯一作者(与角色同);作者纠错走 chat → settler 重提。只读 GET 端点。
- **因果链只做单父(causedById)。** 多因/双向图(M:N leadsTo)defer;MVP 够用。
- **不上向量检索。** get_events 用结构化过滤(章/角色/重要性/关键词 contains);向量召回是后续大基建,本期不碰。
- **不链 ChapterOutline 节点。** 事件链章/角色/地点/伏笔已够;链细纲节点(兑现了哪个 CBN/CPN)defer(Phase 9/10 已管细纲对账)。
- **不强制每章事件数。** settler 判定(1-3 MAJOR + 若干 MINOR);significance 控量。

## 测试

1. **EventService 单测**(照 `story-event.service.spec.ts` 模式):createEvents / listEvents(scope by userId)/ listRecentMajor(MAJOR only,limit)/ listForPanel。jest.fn() mock PrismaService。
2. **get_events 工具单测**(照 `get-reference.tool.spec.ts`):返回 JSON 字符串、过滤生效、scope 正确。
3. **write_summary plotEvents 单测**:plotEvents 传 → createEvents 被调;不传 → 不调。
4. **agent-tree 快照**:writer/validator/main tools += get_events + 正向断言。
5. **回归**:全量 `pnpm test` + `pnpm typecheck`;FE `pnpm validate`(lint+format+typecheck)。

## 验证未覆盖

- 单测验证 service/tool/接线;**实际 settler 是否稳定提取事件、判对 significance、get_events 是否真改善召回**依赖模型 + DB,需活 E2E(写 10+ 章,看早期事件能否被后期 get_events 召回 + 面板渲染)。本期不强制。
