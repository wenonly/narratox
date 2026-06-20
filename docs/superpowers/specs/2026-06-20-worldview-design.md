# 世界观模块设计（类型化条目 / codex）

> 日期：2026-06-20
> 状态：已批准（设计），待实现
> 路线图：[docs/ROADMAP.md](../../ROADMAP.md)（Phase 2 资源；提前到大纲之前——世界观是地基，大纲建其上）
> 参考：[inkos](../../references/inkos-workflow-reference.md)（story_bible 设定 / book_rules 规则禁忌 二分）、[webnovel-writer](../../references/webnovel-writer-workflow-reference.md)（设定集：世界观/力量体系/角色卡分文档）
> 前序：[outline spec](./2026-06-20-outline-design.md)（同属结构化资源层，世界观更简单——无层级无节点，平铺条目）

## 背景与目标

立项信息收集完成后，**首要工作是设计世界观**（用户明确：「先设计整个世界观」），再规划大纲、写章。当前世界观只有立项时一段 `settings.worldviewText` 文本——长篇里会变成无人维护的墙，也无法按需注入。

引入**类型化条目（codex/lorebook）**：世界观 = 一组带类型的设定卡片（地点、势力、力量体系、规则…），可按需注入、UI 可浏览增删、agent 逐条生成。

## 关键决策（已锁定）

| 决策 | 选择 | 理由 |
|---|---|---|
| 结构形态 | **类型化条目**（非纯文本、非全结构） | 世界观本质是「一堆设定条目」，天然卡片化；纯文本长篇必塌，全结构对发散设定太死（题材差异大） |
| writer 消费 | **混合**：核心条目（concept + powerSystem）被动注入 prompt；细节条目主动 `get_world_entry` 查 | 世界观是常驻背景，不像细纲逐章切换；核心被动省事，细节按需省 token |
| 工作流位置 | 立项 → **世界观** → 大纲 → 写 | 世界观是地基，先于大纲；调整 MAIN_AGENT_PROMPT 阶段顺序 |
| 关卡 | **不加写章关卡** | 世界观是基础但不强制；关卡只保留 outline 细纲 + 结算（最小集） |

## 数据模型（Prisma，需迁移）

平铺条目，按 `(novelId, name)` 唯一（一个地点/势力在书内只一条）。

```prisma
model WorldEntry {
  id        String         @id @default(cuid())
  novelId   String
  novel     Novel          @relation(fields: [novelId], references: [id], onDelete: Cascade)
  type      WorldEntryType
  name      String
  content   String         @default("")   // 自由 markdown
  createdAt DateTime       @default(now())
  updatedAt DateTime       @updatedAt

  @@unique([novelId, name])
  @@index([novelId, type])
}

enum WorldEntryType {
  concept      // 设定/背景/总览
  powerSystem  // 力量体系(魔法/科技/修炼)——网文最关键
  location     // 地点
  faction      // 势力/组织/门派/国家
  race         // 种族/生物
  rule         // 规则/禁忌(力量上限、不能做什么)——inkos book_rules 等价
  item         // 物品/资源/经济
  history      // 历史传说/纪年
}

// Novel 增 relation: worldEntries WorldEntry[]
```

content 是自由 markdown（不刚性）；type 提供组织 + 选择性注入。inkos 的「设定 vs 规则」二分用 `concept` 与 `rule` 两个 type 保留。

## 服务层（WorldEntryService）

`server/src/novel/world-entry.service.ts`，user-scoped（`assertOwned`，同 Outline/Chapter 模式）：

- `upsertEntry(userId, novelId, { type, name, content })` — upsert by `(novelId, name)`。
- `listEntries(userId, novelId, type?)` — 按 type 分组返回（FE 面板）；type 省略返回全部。
- `getEntry(userId, novelId, name)` — 单条（writer `get_world_entry` 用）。
- `listCore(userId, novelId)` — `type ∈ {concept, powerSystem}` 的条目（ContextAssembler 被动注入用）。

## 工具（main 写 / writer 读 + main 读）

| 工具 | 归属 | 作用 |
|---|---|---|
| `set_world_entry(type, name, content)` | main | 创建/更新一条世界观条目（upsert by name） |
| `get_worldview(type?)` | main + writer | 列出条目（可按 type 过滤）；供 main 规划、writer 写前查相关设定 |
| `get_world_entry(name)` | main + writer | 取单条全文（writer 写到某地点/势力时查细节） |

userId/novelId 闭包注入（防越权，同现有工具）。

## ContextAssembler 被动注入（核心条目）

`forSession` 在【前情】/【未回收伏笔】之外，加 **【世界观】slice**：`listCore` 返回的条目（concept + powerSystem）的 `name: content` 拼接。两者皆空则不插（保持旧行为）。这给 writer 常驻背景；细节条目（地点/势力/规则）由 writer 写时主动 `get_world_entry` 查。

> 立项的 `settings.worldviewText` 保留为快速 intro（仍按现状注入）；WorldEntry 的 concept 条目是其结构化深化。若重复，可在生成世界观时把 worldviewText 并入一个 concept「总览」条目（实现期决定，非阻塞）。

## Agent prompts / 工作流

`MAIN_AGENT_PROMPT` 阶段顺序改为：**立项 → 构建世界观 → 规划大纲 → 写章**。

- 新增【构建世界观】阶段（立项后、大纲前）：`set_world_entry` 生成 concept（总览）+ powerSystem（力量体系）+ rule（禁忌）+ 主要 location/faction 等核心条目；告作者「世界观已建好，请在右侧面板过目/改」。
- `WRITER_AGENT_PROMPT`：写到涉及具体地点/势力/规则时，先 `get_world_entry(name)` 查证，别编造与设定冲突的内容；核心背景已在 prompt。
- ContextAssembler CONCEPT 指令更新：信息齐后「先构建世界观，再规划大纲」。

## 前端（WorldView，填 ResourcePanel 'worldview' 占位）

- **WorldView**：按 type 分组的条目卡片（concept/powerSystem/location/faction/...），每卡显示 name + content（markdown）；type 折叠/筛选；可编辑/新增（PATCH）。
- **API**：`GET /novels/:id/worldview`（按 type 分组）、`PATCH /novels/:id/worldview/:name`（改条目）。
- **types/novel.ts**：`WorldEntry`、`WorldEntryType`。
- **自动刷新**：镜像 outlineWriteSeq——store 加 `worldEntryWriteSeq`，`set_world_entry` 落库时 bump，WorldView 订阅刷新。

## 实现阶段（镜像大纲功能）

1. **Schema + WorldEntryService**：WorldEntry 表 + 迁移；service（upsert/list/get/listCore）。
2. **工具**：set_world_entry（main）、get_worldview/get_world_entry（main+writer）；接入 deep-agent.service。
3. **Prompts**：MAIN_AGENT_PROMPT 加【构建世界观】阶段（先于大纲）；WRITER 消费引导；ContextAssembler CONCEPT 指令更新。
4. **被动注入**：ContextAssembler 注入 listCore（concept+powerSystem）。
5. **API + FE**：GET /worldview + WorldView + types + worldEntryWriteSeq 自动刷新。

每阶段独立可测、可提交。

## 非目标（YAGNI / 留后续）

- **不加写章关卡**（世界观是基础非强制；关卡保留 outline 细纲 + 结算最小集）。
- **不做 `pinned` 字段**（v1 核心被动 = 固定 type 集 concept+powerSystem；若需更灵活的「核心条目」标记，后续加 pinned）。
- **不做实体追踪/消歧**（条目→章节提及的自动关联是更后期的事，类比 Stage B2 character_matrix）。
- 全结构化 per-type schema（力量体系={levels,limits}…）留后续按需。

## 与 ROADMAP 的关系

本功能 = ROADMAP Phase 2 资源建模的世界观部分，提前到大纲之前（地基优先）。实现后更新 ROADMAP（世界观资源条目）+ README checkbox。
