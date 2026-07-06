# 伏笔 + 事件模块视觉重做(可展开 + 状态语义色 + lifecycle 时间线)

> **For agentic workers:** 配套 plan:[2026-07-06-hooks-events-redesign.md](../plans/2026-07-06-hooks-events-redesign.md)。FE 改动为主 + 2 处 server include(零 schema 迁移)。

## 背景

[HooksView.tsx](agent-ui/src/components/workspace/views/HooksView.tsx) + [EventsView.tsx](agent-ui/src/components/workspace/views/EventsView.tsx) 当前 6 个问题:

1. **伏笔卡完全不展开** ← 用户主诉。`hook.description` truncate 截断,完整叙述看不到,点击无反应。
2. **状态语义色不分** —— `core`(最重要)和 `stale`(该推进了)同 `accent-primarySoft` 底色,含义相反却同色。`payoffTiming`(即时→终局,极重要)只一个灰 pill。
3. **核心伏笔没"长大"** —— ★ 标记 + indigo 底,但卡片高度/密度跟普通伏笔一样。
4. **事件卡也太扁** —— description 截断,涉及人物/地点/关联伏笔挤成一行 emoji 文字。关联伏笔只显 ID 尾号,看不到对方描述。
5. **无概览** —— 一打开就卡列表。
6. **丰富数据全挤在一行 meta** —— `推进X次 · 依赖X个未回收 · 陈久未推进` 挤在 9pt 灰字行,该突出的告警被淹没。

## Pencil 设计(已完成)

| 帧 | ID | 用途 |
|---|---|---|
| R4 伏笔 v2 [展开] | `GIRqK` | roster + 1 核心伏笔展开(完整 lifecycle 竖向轨道) |
| R4b 事件 v2 [展开] | `a6KJNa` | roster + 1 MAJOR 事件展开(人物/地点/关联伏笔 chips) |

## 数据模型核对(已验证)

### Hook(`StoryEvent`,Prisma `server/prisma/schema.prisma`)

**当前 API 返回的(`listForStatusView`):**
- `description` / `status`(OPEN/PROGRESSING/RESOLVED) / `payoffTiming` / `openedAtChapter` / `resolvedAtChapter` / `advancedCount` / `lastAdvancedAtChapter` / `coreHook` / `dependsOn: String[]`(hook ID 数组)/ `stale` / `unmetDeps: String[]`(ID 数组)

**新增 include(本期改):** `events: Event[]` 关系(Prisma 已存在,`Event.relatedHookId` 指向 StoryEvent)。include 后,`hook.events` 是该伏笔的所有关联事件(plant/advance/resolve),每个含 `chapterOrder` + `description` + `kind` + `significance` + `relatedHookAction`。

**`dependsOn` 解析:** IDs 不是描述。HooksView 本地建 `hookById: Map<id, hook>` 把 `dependsOn`/`unmetDeps` 的 ID 解析为描述。已回收(met)= ✓,未回收(unmet)= ⚠。

### Event(`Event`)

**当前 API 返回的(`listForPanel`):**
- `description` / `kind` / `significance` / `chapterOrder` / `involvedCharacters[]` / `location` / `causedById` / `relatedHookId` / `relatedHookAction`

**新增 include(本期改):** `relatedHook: StoryEvent?` 关系。include 后,`event.relatedHook` 含 `{ id, description, status, payoffTiming }`(select 限字段控 payload)。

## 方案

### server include(2 处一行改动,零 schema 迁移)

**[story-event.service.ts:179](server/src/memory/story-event.service.ts#L179) `listForStatusView` 的 findMany 加 include:**

```ts
const all = await this.prisma.storyEvent.findMany({
  where: { novelId, novel: { userId } },
  orderBy: [{ coreHook: 'desc' }, { createdAt: 'asc' }],
  include: {
    events: {
      select: {
        id: true,
        chapterOrder: true,
        description: true,
        kind: true,
        significance: true,
        relatedHookAction: true,
        createdAt: true,
      },
      orderBy: { chapterOrder: 'asc' },
    },
  },
});
```

**[event.service.ts:124](server/src/memory/event.service.ts#L124) `listForPanel` 的 findMany 加 include:**

```ts
return this.prisma.event.findMany({
  where: { novelId, novel: { userId } },
  orderBy: { chapterOrder: 'asc' },
  include: {
    relatedHook: {
      select: { id: true, description: true, status: true, payoffTiming: true },
    },
  },
});
```

### FE 类型扩展([agent-ui/src/types/novel.ts](agent-ui/src/types/novel.ts))

```ts
// 加到 StoryEventHook(可选字段,向后兼容):
export interface StoryEventHook {
  // ...现有字段...
  events?: Array<{
    id: string
    chapterOrder: number
    description: string
    kind: string | null
    significance: 'MAJOR' | 'MINOR'
    relatedHookAction: string | null
  }>
}

// 加到 EventTimelineItem(可选字段):
export interface EventTimelineItem {
  // ...现有字段...
  relatedHook?: {
    id: string
    description: string
    status: 'OPEN' | 'PROGRESSING' | 'RESOLVED'
    payoffTiming: HookPayoffTiming
  } | null
}
```

### HooksView 重做([HooksView.tsx](agent-ui/src/components/workspace/views/HooksView.tsx))

**状态色映射** —— 复用 family 三色(零新 token):

| 状态 | 含义 | 色 |
|---|---|---|
| core + 未回收 | 最重要 | indigo(`accent-primary`/`accent-primarySoft`) |
| stale | 该推进了 | amber(`family-power`/`family-powerSoft`) |
| 普通 active | 进行中 | neutral(`bg-bg-cardElevated`) |
| resolved | 已回收 | emerald(`family-world`)+ opacity-60 + line-through |

**HookCard 折叠态:** 状态图标(star/circle-dot/triangle-alert/check)+ description(truncate OK)+ range(`埋chN→揭chM` 或 `埋chN`)+ payoffTiming chip + chevron-right。

**HookCard 展开态:**
1. **Header**:状态色圆形图标 + 完整 description(无 truncate)+ 副标题(可省,若 description 已短)+ chevron-down。
2. **状态 chips 行**:`payoffTiming`(语义色 chip:即时→终局渐变)+ `status`(OPEN/PROGRESSING/RESOLVED)+ `推进 X 次`。
3. **生命周期竖向轨道**(从 `hook.events ?? []` 渲染):
   - 每个 event 一个节点:`●`(MAJOR 实心 indigo)或 `●`(minor 实心 muted)+ 章号 + `relatedHookAction ?? kind` + description(单行)。
   - 末尾若 `status !== 'RESOLVED'`:追加 `◯ 待回收`(空心 indigo 边)。
   - 若 `hook.events` 为空(数据未加载):降级显 `埋 ch{openedAtChapter} · 推进 {advancedCount} 次 · 最近 ch{lastAdvancedAtChapter}`(沿用当前 meta 行格式)。
4. **依赖**(若 `dependsOn.length > 0`):🔗 + chips。每个 dep:`hookById.get(id)?.description ?? '未知'` + 后缀 ✓(met)/ ⚠(unmet,amber)。

**概览条**:`{X} 伏笔 · {Y} open · {Z} stale · {W} resolved`(stale 数 amber,resolved 数 emerald)。

### EventsView 重做([EventsView.tsx](agent-ui/src/components/workspace/views/EventsView.tsx))

**significance 色映射:**
- MAJOR → indigo(`accent-primarySoft` 底 + sparkles 图标)
- minor → neutral(`bg-bg-cardElevated` + circle 图标)

**EventCard 折叠态:** significance 图标 + description(truncate)+ meta line(`· {kind} · 👥{people}`)+ chevron-right。

**EventCard 展开态:**
1. **Header**:significance 圆形图标 + 完整 description + meta(`{MAJOR/minor} · {kind} · 第N章`)+ chevron-down。
2. **完整叙述段**(description 全文,无 truncate)。
3. **涉及人物 chips**(若 `involvedCharacters.length > 0`):每个 chip = user 图标 + name。
4. **地点 chip**(若 `location`):map-pin 图标 + `location`。
5. **关联伏笔 mini-card**(若 `relatedHook`):indigo soft 底,显 `event.relatedHook.description` + `relatedHookAction` + `relatedHook.status` + `relatedHook.payoffTiming`。**替代当前只显 ID 尾号的 `relatedHookId.slice(-4)`。**

**概览条**:`{X} 事件 · {Y} MAJOR · {Z} 章`。

## 不在范围

- **DB / Prisma schema** —— 零迁移(关系已存在,只加 include)。
- **agent / prompt / tool** —— 不动。
- **causedBy 因果链 UI** —— `causedById` 存在但本期不显(单父因果,UI 复杂度高,留作未来)。
- **手动伏笔/事件 CRUD** —— agent 仍为唯一作者。
- **搜索 / 筛选 / 排序** —— 不做(EventsView 已有按章分组;不加 filter)。
- **其它资源面板** —— 不动。

## 验证

1. `pnpm --dir agent-ui validate` + `pnpm --dir server typecheck` 全过。
2. `pnpm --dir agent-ui dev` 打开 `/novels/:id` 右侧伏笔 tab:
   - **概览条**显数,stale/resolved 着色。
   - **4 状态分组**:core indigo / 进行中 neutral / 陈久 amber / 已回收 emerald-muted。
   - **点核心伏笔展开**:显完整 description + chips + **lifecycle 竖向轨道**(per-step 章+动作) + 依赖 chips(ID→desc 解析)。
   - 数据未含 events 时降级显单行 meta(不崩)。
3. 切到事件 tab:
   - 概览条 + 按章分组。
   - **点 MAJOR 事件展开**:完整 description + 人物 chips + 地点 chip + **关联伏笔 mini-card**(显完整 description + status + payoffTiming,非 ID 尾号)。
4. 对比 Pencil:伏笔对 `GIRqK`,事件对 `a6KJNa`。

## Pencil 帧参考

- 伏笔 v2:`GIRqK`(R4 伏笔 v2 [展开])
- 事件 v2:`a6KJNa`(R4b 事件 v2 [展开])
