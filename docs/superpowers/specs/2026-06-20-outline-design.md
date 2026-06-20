# 大纲功能设计（结构化节点 + 按需分批 + 写章关卡）

> 日期：2026-06-20
> 状态：已批准（设计），待实现
> 路线图：[docs/ROADMAP.md](../../ROADMAP.md) Stage C1（提前到 A3 之前——大纲是 writer 写每章前要查的骨架，A3 planner 建立其上）
> 参考：[webnovel-writer](../../references/webnovel-writer-workflow-reference.md)（CBN/CPNs/CEN 节点 + 10 章分批 + 必须覆盖/禁区）、[inkos](../../references/inkos-workflow-reference.md)（volume_map）
> 前序：[A1 立项信息](./2026-06-20-onboarding-fields-design.md)、[A2 结算关卡](./2026-06-20-a2-settlement-gate-design.md)（关卡模式延续）

## 背景与目标

立项信息收集完成后，agent 的工作流应进入「规划大纲 → 按细纲写作」。当前 narratox **完全没有大纲层**——writer 凭感觉写，长篇必然发散。本功能引入**两层结构化大纲**，让 writer 写每章前有明确靶子，作者有可视化骨架与进度。

北极星：**写第 N 章时，writer 拿着第 N 章的结构化细纲写，作者能在右侧面板看到全书骨架与当前位置。**

## 关键决策（已锁定）

| 决策 | 选择 | 理由 |
|---|---|---|
| 细纲结构 | **结构化节点**（CBN + 2-4 CPNs + CEN） | 可视化、可承接校验、writer 拿到精确靶子 |
| writer 获取方式 | **主动工具**（`get_outline`/`get_chapter_plan`），非被动注入 | 200 章大纲全量塞 prompt 会爆 token；按需取当前章细纲，省且灵活（webnovel 按需加载原则） |
| 生成节奏 | **按需分批**（先出大纲 + 首批 ~5-10 章细纲，写到边界再补下一批） | 随写随规划，细纲不过期；人机协作边写边调 |
| 写章关卡 | **第 N 章必须有 ChapterOutline 才能 append_section** | 保证 writer 永不写没有细纲的章；延续 A2 关卡模式 |
| 进度指针 | **派生**（get_outline 算 nextChapterOrder；面板高亮用 FE 已有 writingChapterOrder） | 无需新 DB 字段，进度主要是展示关注点 |
| NovelStatus | **不新增**（保持 CONCEPT\|ACTIVE） | 大纲生成在 CONCEPT 信息齐后进行；per-chapter 关卡已保证顺序 |

## 数据模型（Prisma，需迁移）

两层 + 节点结构。ChapterOutline 按 `(novelId, chapterOrder)` 唯一——**先于 Chapter 行存在**（计划先于写作），不与 Chapter 做 FK。

```prisma
model Volume {
  id        String   @id @default(cuid())
  novelId   String
  novel     Novel    @relation(fields: [novelId], references: [id], onDelete: Cascade)
  order     Int
  title     String
  goal      String   @default("")   // 本卷目标
  synopsis  String   @default("")   // 本卷梗概
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  chapterOutlines ChapterOutline[]
  @@unique([novelId, order])
  @@index([novelId])
}

model ChapterOutline {
  id           String              @id @default(cuid())
  novelId      String
  novel        Novel               @relation(fields: [novelId], references: [id], onDelete: Cascade)
  volumeId     String?
  volume       Volume?             @relation(fields: [volumeId], references: [id], onDelete: SetNull)
  chapterOrder Int                                  // 与 Chapter.order 对齐(1-based)
  title        String              @default("")
  cbn          Json                // 开篇节点 { subject, action, target }
  cpns         Json                // 情节节点 [ {subject,action,target}, ... ] (2-4)
  cen          Json                // 结尾节点 { subject, action, target }
  mustCover    Json                // string[]  必须覆盖(≤4)
  forbidden    Json                // string[]  本章禁区(≤5)
  status       ChapterOutlineStatus @default(DRAFT)
  createdAt    DateTime            @default(now())
  updatedAt    DateTime            @updatedAt
  @@unique([novelId, chapterOrder])
  @@index([novelId])
}

enum ChapterOutlineStatus {
  DRAFT       // agent 生成草稿
  APPROVED    // 作者确认
  WRITTEN     // 该章已写(settler 结算后回填)
}

// Novel 增 relations: volumes Volume[] / chapterOutlines ChapterOutline[]
```

节点统一形状 `{ subject, action, target }`（即 `主体 | 动作/变化 | 对象/结果`）。相邻章 `cen(N) → cbn(N+1)` 可做承接校验（v1 提示性，不强制）。

## 工具（writer 主动读 / main 读写）

| 工具 | 归属 | 作用 |
|---|---|---|
| `set_outline` | main | 生成/改全书大纲总览（可放 Novel 字段或 Volume 聚合；v1 用 Volume 表达） |
| `set_volume(order, title, goal, synopsis)` | main | 创建/更新一卷 |
| `set_chapter_plan(order, title, cbn, cpns, cen, mustCover, forbidden, volumeOrder?)` | main | 创建/更新第 order 章细纲（upsert by chapterOrder） |
| `get_outline()` | main + **writer** | 返回卷列表(目标+梗概) + 各章细纲标题列表 + `nextChapterOrder`（定位） |
| `get_chapter_plan(order)` | main + **writer** | 返回第 order 章细纲全节点（writer 写该章前调） |

- writer 被委派「写第 N 章」→ 自己 `get_chapter_plan(N)` 读节点 → 按 CBN→CPNs→CEN 写；可 `get_outline()` 看大局、peek `get_chapter_plan(N+1).cbn` 保证承接。
- userId/novelId 闭包注入（防越权，同现有工具）。
- `nextChapterOrder` = 第一个 `status≠WRITTEN` 的 ChapterOutline 的 chapterOrder，或 max 已写章+1（让 writer 自定位）。

## 写章关卡（延续 A2 `assertFrontier`）

`ChapterService.appendSection`（advance 路径）现在跑**两个**前置关卡——这正是 A2 spec 预告的「多关卡扩展位」：

```ts
async appendSection(userId, novelId, order, content): Promise<
  | { ok: true }
  | { ok: false; reason: 'predecessor_not_settled'; unsettledOrder: number }   // A2
  | { ok: false; reason: 'no_chapter_plan'; chapterOrder: number }             // 本功能
> {
  const frontier = await this.assertFrontier(userId, novelId, order);
  if (!frontier.ok) return frontier;
  const plan = await this.assertHasPlan(userId, novelId, order);
  if (!plan.ok) return plan;
  // ...原写入逻辑...
  return { ok: true };
}

// 新关卡:第 order 章必须有 ChapterOutline 才能写
async assertHasPlan(userId, novelId, order): Promise<
  | { ok: true }
  | { ok: false; reason: 'no_chapter_plan'; chapterOrder: number }
> {
  const plan = await this.prisma.chapterOutline.findFirst({
    where: { novelId, chapterOrder: order, novel: { userId } },
    select: { id: true },
  });
  return plan ? { ok: true } : { ok: false, reason: 'no_chapter_plan', chapterOrder: order };
}
```

- 工具翻译两种拒绝：`predecessor_not_settled`→「请先结算第 N 章」；`no_chapter_plan`→「请先为第 N 章生成细纲（set_chapter_plan）后再写」。
- **只保证「细纲存在」**，不强制「writer 读了」——后者靠 writer prompt 引导（writer 工具栏已有 get_chapter_plan）。

## 生成流程（按需分批）

1. 立项信息齐（CONCEPT，missing 空）→ main agent 调 `set_volume`×M 生成**大纲/卷纲** + `set_chapter_plan`×K 生成**首批细纲**（K≈5-10，可调）→ 告作者「大纲已生成，请过目」。
2. 作者在右侧大纲面板过目/编辑（PATCH 节点）。
3. 写作：main 委派 writer 写第 N 章 → writer `get_chapter_plan(N)` → 写。
4. **补批**：当 `nextChapterOrder` 接近已规划边界（如最后一条细纲的 chapterOrder）→ main agent 提示并生成下一批细纲，保证写章关卡总有细纲可过。

`MAIN_AGENT_PROMPT` 增「大纲阶段」步骤（立项后、写作前）；`WRITER_AGENT_PROMPT` 增「写第 N 章前先 get_chapter_plan(N)」。

## 前端（填 ResourcePanel 'outline' 占位 → OutlineView）

- **OutlineView**（[ResourcePanel.tsx](../../../agent-ui/src/components/workspace/ResourcePanel.tsx) 现 'outline' 渲染「即将推出」）：
  - 顶部：卷列表（可折叠），每卷 goal + 含章。
  - 主体：章节细纲列表，每条展开看 CBN/CPNs/CEN（节点可视化）+ mustCover + forbidden。
  - 进度：当前章高亮（用 `writingChapterOrder`/`currentChapterOrder`）。
  - 联动：点细纲→跳正文；写第 N 章时滚到 N。
  - 编辑：作者直接改节点（PATCH），或聊天让 agent 改。
- **API**：`GET /novels/:id/outline`（卷+细纲聚合）、`PATCH /novels/:id/outline/chapters/:order`（改细纲）、可选 `PATCH /novels/:id/outline/volumes/:order`。
- **types/novel.ts**：`Volume`、`ChapterOutline`、节点类型。

## 测试（TDD）

- **ChapterService**：`assertHasPlan`（有/无 ChapterOutline 两态）；`appendSection` 双关卡（predecessor_not_settled / no_chapter_plan 优先级 + 各自不写）。
- **工具**：set_chapter_plan / get_outline / get_chapter_plan 的归属、闭包注入、返回 shape；append_section 翻译 no_chapter_plan 拒绝。
- **OutlineService**：upsert by chapterOrder、list 聚合、nextChapterOrder 计算。
- FE 无测试运行器，靠 `pnpm validate`。

## 实现阶段（功能大，分批落地）

1. **Schema + OutlineService**：Volume/ChapterOutline 表 + 迁移；OutlineService（upsert/list/nextChapterOrder）。
2. **关卡**：`assertHasPlan` + 接入 `appendSection` 双关卡 + 工具翻译 + 测试。
3. **工具**：set_volume / set_chapter_plan（main）、get_outline / get_chapter_plan（main+writer）；接入 deep-agent.service 的 main/writer 工具集。
4. **Agent prompts**：MAIN_AGENT_PROMPT 大纲阶段；WRITER_AGENT_PROMPT 读细纲引导。
5. **API + FE OutlineView**：GET/PATCH 端点 + OutlineView 视图 + types + 接通 ResourcePanel。
6. **联调**：跑 `pnpm dev` 真实走一遍 立项→生成大纲→写章。

每阶段独立可测、可提交。

## 非目标（YAGNI / 留后续）

- **不**做 cen(N)→cbn(N+1) 强制承接校验（v1 提示性）。
- **不**做细纲「已读」强制（只保证存在；读不读靠 writer prompt）。
- **不**新增 NovelStatus（大纲生成在 CONCEPT 内完成，关卡保序）。
- 大纲总览 v1 用 Volume 表达；若需独立「全书总纲」自由文本，后续加 Novel 字段或 Outline 文档。
- 宏大纲 existence 不单独设关卡（per-chapter 细纲关卡已隐含规划发生）。

## 与 ROADMAP 的关系

本功能 = ROADMAP **Stage C1（结构化章纲节点）**，提前到 A3 之前实施（大纲是 planner 的输入，A3 在其上做 per-chapter hook account）。实现后更新 ROADMAP C1 + README checkbox。
