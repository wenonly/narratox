# B2 设计：角色时间线（event-sourced 角色状态 + 关系演变）

> 日期：2026-06-21
> 状态：已批准（设计），待实现
> 路线图：[docs/ROADMAP.md](../../ROADMAP.md) Stage B2（角色资源）
> 参考：[inkos](../../references/inkos-workflow-reference.md) character_matrix + emotional_arcs + Observer 9 类提取 / [webnovel-writer](../../references/webnovel-writer-workflow-reference.md) 6 表(entities/aliases/appearances/state_changes/relationships/relationship_events) + event-sourcing CQRS
> 前序：[B1 伏笔生命周期](./2026-06-21-hook-lifecycle-design.md)

## 背景与核心理念

角色不是固定定义——角色会**成长**。懒散→沉稳（因恩师被杀）、弱小→强大（因获判官笔）、仇敌→盟友（因并肩作战）。静态字段（`Character.personality = "沉稳"`）被覆盖后丢失历史。

**核心理念（学自 webnovel/inkos）**：角色状态是**事件投影**，不直接 CRUD。每次变化记一条**带时间锚点的事件**——第几章、哪个维度、变成什么、为什么变。当前态 = 每维度最新事件；完整轨迹 = 全部事件按章排列。

webnovel 原文：「角色状态...都是从事件**投影**出来的只读视图，不直接 CRUD。写到 200 章时，角色状态、关系、伏笔都能从事件流重建。直接 CRUD 会累积不一致。」

## 关键决策（已锁定）

| 决策 | 选择 | 理由 |
|---|---|---|
| 角色状态模型 | **事件驱动时间线**（CharacterChange），非静态字段 | webnovel/inkos 都用 delta/事件；角色成长必须可追溯 |
| Character 表存什么 | **仅稳定身份**（名/别名/角色定位/势力/背景） | 易变属性（性格/欲望/能力/情绪/状态/关系）全走时间线 |
| 多维度 field | personality/emotion/ability/status/relationship/appearance/knowledge/other | 学 inkos Observer 分维度提取 |
| settler 记出场 | **field=appearance**（即使无状态变化也记） | webnovel appearances 概念；信息边界的前置 |
| 关系 | **field=relationship:${对方名}**，单边视角 v1 | webnovel 双边更完整但需独立表；v1 从一方记够用 |
| 知情范围矩阵 | **defer**（info-boundary matrix） | 建在角色档案之上更自然；v1 不做 |
| 自动建角色 | settler 遇到未注册角色**自动 find-or-create** | 角色可能在被 set_character 之前就出现在章节里 |

## 数据模型（Prisma，需迁移）

```prisma
model Character {
  id         String         @id @default(cuid())
  novelId    String
  novel      Novel          @relation(fields: [novelId], references: [id], onDelete: Cascade)
  name       String
  aliases    String[]       @default([])
  role       CharacterRole  @default(SUPPORTING)
  faction    String         @default("")
  background String         @default("")
  createdAt  DateTime       @default(now())
  updatedAt  DateTime       @updatedAt
  changes    CharacterChange[]

  @@unique([novelId, name])
  @@index([novelId])
}

model CharacterChange {
  id           String    @id @default(cuid())
  novelId      String
  characterId  String
  character    Character @relation(fields: [characterId], references: [id], onDelete: Cascade)
  chapterOrder Int
  field        String    // personality/emotion/ability/status/relationship:X/appearance/knowledge/other
  value        String
  reason       String    @default("")
  createdAt    DateTime   @default(now())

  @@index([characterId, chapterOrder])
  @@index([novelId])
}

enum CharacterRole { PROTAGONIST  ANTAGONIST  SUPPORTING }
```

## CharacterService

- `upsertCharacter(userId, novelId, {name, role?, aliases?, faction?, background?})` — upsert by name（main agent 建/改角色）。
- `findOrCreateByName(userId, novelId, name)` — settler 自动注册未认识的角色。
- `recordChanges(userId, novelId, chapterOrder, changes: {name, field, value, reason}[])` — 批量记变化（find-or-create 角色 + 建 CharacterChange 行）。
- `getCharacter(userId, novelId, name)` — 返回角色 + **当前态**（每维度最新 change 的 value）+ 最近时间线。
- `listCharacters(userId, novelId, role?)` — 全部角色 + 当前态摘要（供场景规划）。

## write_summary 升级（settler）

roleChanges 从 `[{name, change}]`（free text）升为结构化：
```
roleChanges: [{ name, field, value, reason }]
// field ∈ personality/emotion/ability/status/relationship:${对方}/appearance/knowledge/other
```
write_summary handler 对每条 roleChange：find-or-create 角色 → 建 CharacterChange 记录。

settler prompt（SETTLER_AGENT_PROMPT）加：
- 每个出场的角色记一条 `field=appearance`（即使没有状态变化）。
- 状态/性格/能力/情绪变化 → 对应 field + value（变成什么）+ reason（故事触发事件）。
- 关系变化 → `field=relationship:${对方名}`。
- **reason 必填**——记清楚是什么故事事件导致的。

## 工具

| 工具 | 归属 | 作用 |
|---|---|---|
| `set_character(name, role?, aliases?, faction?, background?)` | main | 建/改角色稳定身份 |
| `get_character(name)` | writer | 当前态 + 最近时间线 |
| `get_characters(role?)` | writer | 列角色 + 当前态摘要 |

settler 不需新工具——走 write_summary 的 roleChanges（升级后自动写 CharacterChange）。

## Agent prompts

- **MAIN_AGENT_PROMPT**：世界观后、大纲前（或同时），用 set_character 建主要角色（主角/反派/关键配角的稳定身份：名字/定位/背景）。
- **WRITER_AGENT_PROMPT**：写涉及具体角色的场景前，调 get_character(name) 查当前态（性格/能力/关系/状态）；角色是会成长的——检查当前态而非凭印象。
- **SETTLER_AGENT_PROMPT**：roleChanges 升级为结构化（field/value/reason）+ 记出场。

## FE（👤 角色面板）

- **CharactersView**（ResourcePanel 'characters' 现为「即将推出」）：
  - 按角色定位分组（主角 ★ / 配角 / 反派）。
  - 每个角色卡：名字 + 当前态（从时间线最新值派生，如「性格：沉稳果决（第5章，因恩师被杀而蜕变）」）。
  - 可展开**时间线**：全部变化按章排列——角色成长轨迹一目了然。
- **API**：`GET /novels/:id/characters` → listCharacters（含当前态 + 时间线）。
- **自动刷新**：characterWriteSeq（write_summary 落库时 bump，同 hookWriteSeq）。

## 实现阶段

1. **Schema + CharacterService**：Character + CharacterChange + CharacterRole 枚举 + 迁移 + service（upsert/findOrCreate/recordChanges/getCharacter/listCharacters + 当前态派生）。
2. **write_summary 升级 + settler prompt**：roleChanges 结构化 + handler 写 CharacterChange + 出场记录。
3. **工具**：set_character（main）、get_character/get_characters（writer）；接入 deep-agent.service。
4. **Prompts**：MAIN（建角色阶段）、WRITER（读当前态）、SETTLER（结构化变化）。
5. **API + FE**：GET /characters + CharactersView + characterWriteSeq 自动刷新。

## 测试（TDD）

- **CharacterService**：upsertCharacter、findOrCreate（不存在→创建）、recordChanges（批量+find-or-create）、getCharacter（当前态派生——多维度取最新）、listCharacters。
- **write_summary 工具**：roleChanges 结构化 → recordChanges 委派。
- **工具**：set_character/get_character/get_characters 委派 + 闭包注入。
- FE 靠 `pnpm validate`。

## 非目标（YAGNI / 留后续）

- **知情范围矩阵**（info-boundary：谁知道什么秘密）——defer，建在角色档案 + 出场记录之上。
- **双边关系表**（webnovel relationship_events）——v1 单边（field=relationship:X）；双边留后续。
- **角色手编 UI**（作者手动改角色/加变化）——v1 只读视图；手编留后续。
- **情绪弧线独立视图**（inkos emotional_arcs）——v1 通过 field=emotion 过滤实现，不独立建。
- **webnovel 6 表拆分**——narratox 用 Prisma 关系模型，一个 CharacterChange 表 + field 区分够。
