# B1 设计：伏笔生命周期（payoffTiming + dependsOn + 状态面板）

> 日期：2026-06-21
> 状态：已批准（设计），待实现
> 路线图：[docs/ROADMAP.md](../../ROADMAP.md) Stage B1
> 参考：[inkos](../../references/inkos-workflow-reference.md) HookRecord（lifecycle/payoffTiming/dependsOn/coreHook/advancedCount）
> 前序：伏笔现状 = `StoryEvent`(OPEN/RESOLVED) + settler create/resolve + 【未回收伏笔】slice

## 背景与目标

长篇网文伏笔回收周期差异巨大（几章 vs 几百章），当前模型太薄：
- **全局陈旧阈值对长篇是错的**——slow-burn 大伏笔会被误报陈旧。
- **伏笔完全孤立**——无法表达「A 回收依赖 B 先回收」。
- **作者看不见**——伏笔只在 agent prompt slice 里，UI 无视图。

B1 把伏笔做成 inkos 式一等公民（务实子集），让长篇伏笔「不遗忘、不误报、有依赖、可见」。

## 关键决策（已锁定）

| 决策 | 选择 | 理由 |
|---|---|---|
| 陈旧判定 | **payoffTiming 分层阈值**（非全局） | slow-burn 不误报；near-term 拖太久会报。长篇必需 |
| 伏笔依赖 | **`dependsOn: String[]`**（伏笔↔伏笔，轻量） | 表达回收顺序；v1 用 id 数组（软依赖），join 表留后续 |
| 状态 | OPEN \| PROGRESSING \| RESOLVED | DEFERRED 需要 author-edit UI 才有 setter，v1 无 UI 故**暂不做**（resolve 代替） |
| 可见性 | **填 📊 状态面板**（方案 B） | 伏笔一等公民，作者必须看见；复用现成死面板 |
| 伏笔↔角色关联 | **defer 到 B2** | 与 character_matrix 同一张关系图，一起做最自然 |

## 数据模型（Prisma，需迁移）

```prisma
model StoryEvent {
  id                String           @id @default(cuid())
  novelId           String
  novel             Novel            @relation(fields: [novelId], references: [id], onDelete: Cascade)
  description       String
  status            EventStatus      @default(OPEN)
  payoffTiming      HookPayoffTiming @default(MID_ARC)   // 回报时机(决定陈旧阈值)
  openedAtChapter   Int?
  resolvedAtChapter Int?
  advancedCount     Int              @default(0)         // 被推进次数
  coreHook          Boolean          @default(false)     // 核心伏笔(全书必须回收)
  lastAdvancedAtChapter Int?                             // 最近一次推进章(null=从未)
  dependsOn         String[]         @default([])        // 依赖的伏笔 id(软依赖)
  createdAt         DateTime         @default(now())
  updatedAt         DateTime         @default(now())

  @@index([novelId, status])
}

enum EventStatus { OPEN  PROGRESSING  RESOLVED }   // 原 OPEN|RESOLVED +PROGRESSING
enum HookPayoffTiming { IMMEDIATE  NEAR_TERM  MID_ARC  SLOW_BURN  ENDGAME }
```

旧 OPEN/RESOLVED 行：枚举加 `PROGRESSING`，旧行不动；新字段默认值（payoffTiming=MID_ARC, advancedCount=0, coreHook=false, dependsOn=[]）。

**陈旧阈值常量**（service 内）：
```typescript
const PAYOFF_STALE_AFTER = { IMMEDIATE: 3, NEAR_TERM: 12, MID_ARC: 40, SLOW_BURN: 120, ENDGAME: Infinity };
// stale = status∈{OPEN,PROGRESSING} && (currentChapter - (lastAdvancedAtChapter ?? openedAtChapter ?? 0) > 阈值[payoffTiming])
```

## StoryEventService 扩展

- `createHooks(userId, novelId, hooks: {description, payoffTiming, core?, dependsOn?}[], openedAtChapter)` —— 建伏笔带时机/核心/依赖。
- `advanceHooks(userId, novelId, ids, chapterOrder)` —— status=PROGRESSING + advancedCount++ + lastAdvancedAtChapter（仅对 OPEN/PROGRESSING 生效）。
- `resolveHooks(...)` —— 不变（status=RESOLVED + resolvedAtChapter）。
- `markCore(userId, novelId, ids, core)` —— coreHook。
- `listOpen(userId, novelId)` —— 返回 enriched 字段（供 slice）。
- `listForStatusView(userId, novelId, currentChapter)` —— 分组（核心 / 进行中 / ⚠️陈旧 / 已回收）+ 每条算 stale + 未满足依赖提示（dependsOn 中存在非 RESOLVED 的）。

## write_summary 工具 schema 扩展 + settler prompt

```
write_summary({
  chapterOrder, summary, roleChanges, entities,
  newHooks: [{ description, payoffTiming, core?, dependsOn?: string[] }],  // 原 string[] → 对象
  advancedHookIds: string[],   // 本章推进的已有伏笔
  resolvedHookIds: string[],   // 本章回收的
  coreHookIds: string[]        // 本章标记为核心的已有伏笔
})
```

settler prompt（SETTLER_AGENT_PROMPT）加：
- 建伏笔时**判定 payoffTiming**（这伏笔多久后该回收：immediate/near-term/mid-arc/slow-burn/endgame）+ 是否 coreHook（全书大承诺）+ dependsOn（依赖哪些已有伏笔先回收）。
- 本章**蹭到/推进**已有伏笔 → advancedHookIds。
- 本章确认为核心 → coreHookIds。

## ContextAssembler 陈旧 slice

`forSession` 的【未回收伏笔】slice 升级（currentChapter = max 已写章序号）：
```
【未回收伏笔】核心: X、Y · 进行中: Z · ⚠️陈久未推进(>{阈值}): W（payoffTiming, 开始于第N章, 推进{count}次）
```
让 agent 看到**哪些该推进/回收**（尤其⚠️陈旧的）。

## API + FE（填 📊 状态面板）

- `GET /novels/:id/hooks` → `listForStatusView`（服务端算 currentChapter + stale）。
- **HooksView**（ResourcePanel 'status' 现为「即将推出」）：分组卡片——核心 / 进行中 / **⚠️陈旧** / 已回收；每条显示 description + payoffTiming 徽章 + 开始于第N章 + 推进次数 + 依赖数。只读。
- **hookWriteSeq** 信号（镜像 outlineWriteSeq）：settler 调 `write_summary` 时 bump，HooksView 订阅刷新。

## 实现阶段

1. **Schema + service**：StoryEvent 扩展 + EventStatus/HookPayoffTiming 枚举 + 迁移 + service 新方法（create/advance/markCore/listForStatusView + stale 计算）。
2. **write_summary + settler prompt**：新 schema + 推进/核心/依赖引导。
3. **ContextAssembler 陈旧 slice**。
4. **API + FE**：GET /hooks + HooksView + hookWriteSeq 自动刷新。

每阶段独立可测、可提交。

## 测试（TDD）

- **StoryEventService**：createHooks(带 timing/core/dependsOn)、advanceHooks(status+count+lastAdvanced)、markCore、listForStatusView 分组 + stale 计算（各 payoffTiming 边界）+ 未满足依赖。
- **write_summary 工具**：新 schema 委派 service（create/advance/resolve/markCore）。
- **ContextAssembler**：slice 含⚠️陈旧 + payoffTiming（context-assembler spec 更新）。
- FE 无测试运行器，靠 `pnpm validate`。

## 非目标（YAGNI / 留后续）

- **DEFERRED 状态**：需 author-edit UI 才有 setter，v1 不做（resolve 代替），后续随伏笔手编 UI 加。
- **伏笔↔角色/实体关联**：defer 到 B2（character_matrix，同一张关系图）。
- **inkos `promoted`/准入治理/per-hook halfLife**：payoffTiming 分层阈值已覆盖 halfLife 诉求；准入治理过度，不做。
- **dependsOn 用 join 表 + 级联**：v1 用 `String[]` 软依赖；join 表留后续。
- **作者手编伏笔 UI**：v1 只读视图；手编（改 description/手动推进/标记核心）留后续。

## 与 ROADMAP 的关系
本功能 = ROADMAP **Stage B1**。比原 ROADMAP 多了 payoffTiming（长篇陈旧准确性）+ dependsOn（伏笔关联），是用户基于长篇需求明确的扩展。实现后更新 ROADMAP B1 + README checkbox。
