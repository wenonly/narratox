# ChaptersView 三态重做规范

> **设计稿权威来源**：`design/narratox.pen` 三帧 —— R-TOC=`Bcz70` / R-Reading=`UUCpA` / R-Writing=`GMp9L`（y=5000 一排，从左到右）。导出 PNG 在 `design/_exports/`。

**目标**：把工作区右侧资源面板的「章节」模块从「内嵌 TOC 挤压正文」重做为「三态互斥全屏切换」（列表态 / 正文态 / 写作中骨架屏态），并补齐长篇场景下的搜索 + 卷折叠能力。

**适用范围**：仅 `agent-ui` 工作区右侧 `ChaptersView`。无 server / DB / agent 改动（数据模型已支持）。

---

## 1. Context

### 1.1 痛点

用户反馈两个问题：

1. **章节列表展开时把正文挤下去**。当前 [ChaptersView.tsx:215-222](../../../agent-ui/src/components/workspace/views/ChaptersView.tsx#L215-L222) 是 `{tocOpen && <ChapterToc/>}` 内嵌在工具栏和正文之间（`max-h-64 overflow-y-auto`）—— TOC 展开后，正文被推到下方，视觉上「工具栏 + 一截 TOC + 挤扁的正文」同时挤在一屏，主次混乱。
2. **章节多时没有快速定位能力**。当前 TOC 只是一个无序长列表（按 order 排），几十上百章时只能向下滚动找，无搜索 / 无卷分组折叠 / 无状态过滤。

### 1.2 现状对照

| 维度 | 设计稿（Pencil） | FE 代码 | 一致性 |
|---|---|---|---|
| 章节列表态 | `Bcz70` 是 440×900 **全帧列表态**（点目录 → 整个资源面板切换为列表） | 内嵌 `max-h-64` 列表，挤压正文 | ❌ 代码偏离设计 |
| 章节正文态（默认） | **缺失**（之前没画） | `ChaptersView` 默认渲染 | ❌ 设计缺失 |
| 写作中骨架屏态 | **缺失**（资源面板侧没画；聊天侧 B3=`ZkM0J` 有） | `ChapterSkeleton` + `isWritingThis && content<20` 触发 | ❌ 设计缺失 |
| 搜索 / 卷折叠 / 状态过滤 | 设计稿原本有按卷分组 + Filters pills（但 Filters 是「全部/卷一/卷二」，跟卷分组重复） | 无 | ⚠️ 部分有，需重做 |

### 1.3 代码已有的状态枚举（数据层零改动）

[schema.prisma:98,106-108](../../../server/prisma/schema.prisma#L98)：
```prisma
status ChapterStatus @default(DRAFT)
enum ChapterStatus { DRAFT  COMMITTED }
```

- `DRAFT`（草稿）—— 默认态；`clear_chapter` 工具清空正文后也回 DRAFT
- `COMMITTED`（已写入）—— writer agent 写入正文（append_section/replace_text/insert_text/delete_text）后翻成 COMMITTED

外加一个**临时态**「写作中」—— 不是 DB 字段，是 `writingChapterOrder` 信号（[ChaptersView.tsx:107-114](../../../agent-ui/src/components/workspace/views/ChaptersView.tsx#L107-L114)）：`writingChapterOrder === currentChapterOrder && content.length < 20` → 显示骨架屏。

---

## 2. 关键约束（已验证）

- **资源面板宽度 440px** —— 双栏（列表 + 正文并列）不可行，单章正文已经很挤，再切双栏两边都憋屈。**已选定：全屏切换**（互斥，单栏占满 440px）。
- **`ChapterToc` 当前 max-h-64** —— 切到全屏切换后，列表高度 = `Body` fill_container（≈820px），可容纳 ~18 章可见，超出走滚动。
- **章节总量预估** —— 成熟长篇 70-150 章（Phase A 虚拟滚动 spec 数据）。client-side filter 足够（无需 server 分页，章节数据已在 `novel.chapters` 里）。
- **`writingChapterOrder` 已存在**于 Zustand store（[ChaptersView.tsx:108](../../../agent-ui/src/components/workspace/views/ChaptersView.tsx#L108)），无需新增。
- **`ChapterSkeleton` 组件已实现**（[ChaptersView.tsx:247-263](../../../agent-ui/src/components/workspace/views/ChaptersView.tsx#L247-L263)）—— spinner + 5 行灰条 `['90%','76%','82%','60%','70%']`，本期只补对应设计帧，组件逻辑不动。
- **Pencil layout bug**：直接 `Insert` 新帧会触发 Head 在帧内 `y=50` 偏移（导致 Body 总高 950 超出 900 被 clip）。**已验证 `Copy("Bcz70")` 不触发** —— 因为 Bcz70 是已存在的正确 layout 帧，Copy 复用其 layout 上下文。本期三帧中的 UUCpA / GMp9L 均已用 Copy 模板方式创建。

---

## 3. 设计：三态互斥全屏切换

### 3.1 状态机

```
                   点目录按钮
   R-Reading ───────────────────► R-TOC
   (默认正文态)                    (列表态)
        ▲                            │
        │                            │ 点章节
        │  ┌─────────────────────────┘
        │  │
        │  └─► R-Reading（currentChapterOrder = 选中章）
        │
   writingChapterOrder === currentChapterOrder
   && content.length < 20
        │
        ▼
   R-Writing（骨架屏态，正文流到位后自动切回 R-Reading）
```

**三态互斥**：同一时刻只显示一帧。切换由两个信号驱动：
- `tocOpen: boolean`（local state）—— 列表态 vs (正文态/写作中态)
- `writingChapterOrder + content.length`（store 信号）—— 写作中态 vs 正文态

### 3.2 切换优先级

当 `tocOpen=true` 时，即使正在写作，也显示列表态（用户主动切到列表，不被写作打断）；点章节回到正文态后，若正在写该章则进写作中态。

```
renderDecision():
  if tocOpen: return <R-TOC/>
  if isWritingThis && content<20: return <R-Writing/>
  return <R-Reading/>
```

---

## 4. 设计：R-TOC 列表态（重做）

**Pencil 帧**：`Bcz70`（440×900）。

### 4.1 结构

```
R-TOC (Bcz70)
├── Head（资源面板 tab icon 列表，跨视图共用）
└── Body
    ├── ChapBar：「章节目录 · 3 / 60」+ ✕ 关闭
    ├── SearchBar ← 【新增】
    ├── Filters：「全部 / 已写 / 草稿」← 【改：原「全部/卷一/卷二」】
    ├── V 卷一·初入宗门（▼ 展开，5 章）
    │   ├── 卷标题：chevron-down + 「卷一 · 初入宗门」+ 章数「5 章」← 【改：加 chevron + 章数】
    │   ├── C1 当前章（accent fill + ● 在读）
    │   ├── C2-C4 普通章（cardElev + ✓ 已写）
    │   └── C5 草稿章（cardElev + 草稿）← 【新增演示草稿态】
    └── V 卷二·修炼突破（▶ 折叠，12 章）← 【改：演示折叠态】
        └── 卷标题：chevron-right + 「卷二 · 修炼突破」+ 「12 章」
```

### 4.2 搜索框

- 占位「搜索章名 / 章号」
- 右侧 `/` kbd 提示（暗示快捷键聚焦，FE 可选实现）
- **过滤逻辑（client-side，输入即过滤，无 debounce）**：
  - 纯数字 → 按 `order` 精确匹配（输入 `35` → 高亮第 35 章）
  - 非纯数字 → 按 `title` 模糊匹配（包含子串）
  - 命中卷组全部被过滤掉时，整个卷组隐藏（不留空标题）
- 搜索期间临时禁用卷折叠（展开所有卷让命中项可见），退出搜索恢复折叠态

### 4.3 Filters 语义化

原设计 `全部/卷一/卷二` 与卷分组重复 —— 改成状态正交维度：

| Filter | 筛选 | 视觉 |
|---|---|---|
| 全部（默认选中） | 显示所有章 | accent fill + indigoLight 文字 |
| 已写 | `status === 'COMMITTED'` | `#ffffff0a` fill |
| 草稿 | `status === 'DRAFT'` | `#ffffff0a` fill |

「写作中」临时态归到「全部」+ 列表里用 indigo 文字 + 「写作中」标记（不单独给 pill，因为写作中是瞬态，给它单独 pill 用户点了大概率立刻就过去了）。

### 4.4 卷分组折叠

- 卷标题加 `chevron-down`（展开）/ `chevron-right`（折叠）+ 章数徽章
- **默认折叠策略**：当前卷（`currentChapterOrder` 所在卷）展开，其他卷折叠
- 折叠状态用 local state（`Set<volumeOrder>` 或类似），不进 store（组件 unmount 丢失可接受）
- 卷展开/折叠是用户行为，**不被搜索/筛选覆盖**（除了 4.2 的搜索期间临时展开）

---

## 5. 设计：R-Reading 正文态（补缺）

**Pencil 帧**：`UUCpA`（440×900，Copy 自 Bcz70）。

### 5.1 结构

```
R-Reading (UUCpA)
├── Head（章节 tab 高亮 = book-open + accent fill）
└── Body
    ├── ChapterBar：
    │   ├── Pager（fill_container）：‹ + 「第 3 章 · 初战告捷」+ ›
    │   ├── Btn-copy（复制本章）
    │   ├── Btn-list（切到 R-TOC）← 等价于「点目录按钮」
    │   └── Btn-pencil（编辑正文）
    ├── Meta：Badge「✓ 已写入」+「2,156 字」+ spacer +「卷一 · 第 3 章」
    └── Article：正文区（fill_container + clip，溢出滚动）
```

### 5.2 与代码映射

| 设计元素 | FE 现状 | 改动 |
|---|---|---|
| ChapterBar Pager | [ChaptersView.tsx:130-160](../../../agent-ui/src/components/workspace/views/ChaptersView.tsx#L130-L160) 已有翻页 pill | 无需改 |
| Btn-copy / Btn-list / Btn-pencil | [ChaptersView.tsx:161-198](../../../agent-ui/src/components/workspace/views/ChaptersView.tsx#L161-L198) 已有三连按钮 | 无需改 |
| Meta badge + 字数 | [ChaptersView.tsx:199-213](../../../agent-ui/src/components/workspace/views/ChaptersView.tsx#L199-L213) 已有 | 加「卷位」文字（卷一 · 第 N 章） |
| Article 正文 | [ChaptersView.tsx:235-238](../../../agent-ui/src/components/workspace/views/ChaptersView.tsx#L235-L238) MarkdownRenderer | 无需改 |

**结论**：R-Reading 帧的元素 FE 全部已有，本期只是「画出来当参考」+ 加一个「卷位」meta 文字。代码改动极小。

---

## 6. 设计：R-Writing 写作中骨架屏态（补缺）

**Pencil 帧**：`GMp9L`（440×900，Copy 自 UUCpA）。

### 6.1 结构（与 R-Reading 的差异）

```
R-Writing (GMp9L)
├── Head（同 R-Reading）
└── Body
    ├── ChapterBar（同 R-Reading，但 Btn-pencil 应 disabled）
    ├── Meta：
    │   ├── Badge「✍ 写作中」（pencil-line icon + indigo）← 替代「✓ 已写入」
    │   ├── 「生成中 · 312 字」← 替代「2,156 字」（字数短表示刚起步）
    │   └── 「卷一 · 第 3 章」
    └── Article：← 替换为骨架屏
        ├── SkeletonHead：loader-circle（violet）+「第 3 章 · 正文生成中…」
        └── 6 行不等宽灰条 [364, 307, 331, 242, 283, 348]px
            （模拟 [90, 76, 82, 60, 70, 86]%，比代码多一行更丰满）
```

### 6.2 与代码映射

设计帧对应 [ChapterSkeleton 组件](../../../agent-ui/src/components/workspace/views/ChaptersView.tsx#L247-L263) + 触发逻辑 [isWritingThis && content<20](../../../agent-ui/src/components/workspace/views/ChaptersView.tsx#L110)。**组件已实现，本期只补设计帧**，组件逻辑不动（除非要加「写作中」badge 替换，见下）。

### 6.3 当前代码差异（待 FE 实现时对齐）

代码当前在写作中时，Meta 行的 badge 是 [ChapterSkeleton 之外的独立 badge 逻辑](../../../agent-ui/src/components/workspace/views/ChaptersView.tsx#L201-L211)：

```tsx
{isWritingThis ? (
  <span className="rounded-full bg-accent-primarySoft ...">写作中</span>
) : (
  <Badge variant={...}>{chapter.status === 'COMMITTED' ? '已写入' : '草稿'}</Badge>
)}
```

设计稿与此一致（写作中 → 靛色「写作中」badge）。**无需改代码**。

---

## 7. WritingPill 处理（不画独立帧）

**WritingPill**（[ChaptersView.tsx:266-284](../../../agent-ui/src/components/workspace/views/ChaptersView.tsx#L266-L284)）：AI 在写第 N 章 + 用户在看别章时，R-Reading 顶部出现的「✍ AI 正写第 N 章  跳转›」靛色 pill。

**决策：不画独立帧**。理由：
- 它是 R-Reading 的 overlay（顶部多一个 pill），不是独立态
- FE 已实现，逻辑明确（`manualLock && writingChapterOrder !== currentChapterOrder`）
- 画独立帧收益低（用户看一眼就懂 pill 怎么放）

FE 实现时直接复用现有 `WritingPill` 组件，在 R-Reading 帧的 ChapterBar 上方插入即可。设计稿不补帧。

---

## 8. FE 实现映射

### 8.1 状态管理

```ts
// ChaptersView.tsx
const [tocOpen, setTocOpen] = useState(false)           // 已有，保留 local state
const [searchQuery, setSearchQuery] = useState('')      // 新增：搜索词
const [activeFilter, setActiveFilter] = useState<'all'|'committed'|'draft'>('all')  // 新增
const [collapsedVolumes, setCollapsedVolumes] = useState<Set<number>>(...)          // 新增：默认非当前卷折叠
```

**不进 Zustand store**：这些是列表视图的本地状态，不属于聊天/小说状态机。组件 unmount 丢失可接受（重新打开目录默认状态合理）。

### 8.2 渲染决策

```tsx
function ChaptersView() {
  if (tocOpen) return <ChapterListPage ... />        // R-TOC
  if (isWritingThis && content<20) return <ChapterReadingPage skeleton />  // R-Writing
  return <ChapterReadingPage />                      // R-Reading
}
```

把现有的 inline 渲染拆成 3 个子组件（或 2 个，因为 R-Writing 是 R-Reading 的变体）：`ChapterListPage` / `ChapterReadingPage`。

### 8.3 搜索逻辑（client-side）

```ts
function filterChapters(chapters: Chapter[], query: string, filter: StatusFilter): Chapter[] {
  let result = chapters
  if (/^\d+$/.test(query.trim())) {
    result = result.filter(c => c.order === parseInt(query.trim(), 10))
  } else if (query.trim()) {
    result = result.filter(c => c.title?.includes(query.trim()))
  }
  if (filter !== 'all') result = result.filter(c => c.status === filter.toUpperCase())
  return result
}
```

### 8.4 卷分组

`Volume` / `Arc` / `ChapterOutline` 数据均已存在（schema）。**`Chapter` 本身没有 `volumeId`**，卷-章映射三层优先级（与 [OutlineView 现有 helper](../../../agent-ui/src/components/workspace/views/OutlineView.tsx#L253-L280) 一致，复用）：

1. **ChapterOutline.volumeId**（Phase 12 后真源）—— 章有细纲时，直接读 `outline.volumeId`
2. **Arc.fromChapter ≤ order ≤ Arc.toChapter**（反查 `arc.volumeId`）—— 章无细纲但落在某弧范围内
3. **「未分卷」组**（兜底）—— 章既无细纲又不在任何弧内（如刚创建的 CONCEPT 占位章），显示在列表末尾

FE 实现时复用 OutlineView 的 `arcsForVolume` / `plansByVolume` / `orphanPlansForVolume` 三个 helper（必要时抽到 `lib/volume-grouping.ts` 共享）。

---

## 9. Pencil 帧清单

| 帧 | ID | 位置 | 用途 |
|---|---|---|---|
| R-TOC 章节列表 | `Bcz70` | x=4192, y=5000 | 重做：加 SearchBar + Filters 语义化 + 卷折叠 |
| R-Reading 章节正文 | `UUCpA` | x=5624, y=5000 | 新建：补设计缺失（默认正文态） |
| R-Writing 写作中骨架屏 | `GMp9L` | x=6144, y=5000 | 新建：补设计缺失（写作中态） |

PNG 导出：`design/_exports/{Bcz70,UUCpA,GMp9L}.png`。

---

## 10. 不在范围内

- **聊天侧 B3 写作跟随帧（`ZkM0J`）** —— 是聊天消息流里的写作跟随展示，跟资源面板章节模块无关，不动。
- **server / DB / agent 改动** —— 数据模型已支持（ChapterStatus DRAFT/COMMITTED + writingChapterOrder 信号），零改动。
- **章节数据分页** —— 章节数据已在 `novel.chapters`，client-side filter 足够，无需 server 分页（区别于聊天历史的 react-virtuoso 分页）。
- **向量搜索 / 语义搜索** —— 章名/章号精确 + 模糊匹配已够用，不做语义搜索。
- **批量章节操作**（多选删除/移动）—— 当前 agent 是章节唯一作者，无手动 CRUD（与 Phase 6 决策一致），不做。
- **章节拖拽重排** —— 同上，agent 负责 order，FE 不做拖拽。
- **ReadingPill（写作完成提示）** —— 当前写作完成直接显示正文即可，无需额外提示帧。

---

## 11. 验证（手动）

1. **默认态**：进工作区 → 资源面板章节 tab → 显示 R-Reading（正文态），ChapterBar + Meta + Article 正常。
2. **切列表态**：点 Btn-list → 整个资源面板切换为 R-TOC（正文不再可见，不挤压）。
3. **搜索**：在 R-TOC 输入「觉醒」→ 列表过滤到只含「觉醒」的章；输入 `35` → 高亮第 35 章；清空 → 恢复全列表。
4. **Filters**：点「已写」→ 只显 COMMITTED 章；点「草稿」→ 只显 DRAFT 章；点「全部」→ 恢复。
5. **卷折叠**：当前卷默认展开，其他卷默认折叠；点卷标题 chevron → 切换折叠；折叠态显章数。
6. **回正文**：在 R-TOC 点任一章 → 切回 R-Reading，currentChapterOrder = 选中章。
7. **写作中态**：触发 agent 写当前章 → R-Reading 自动切到 R-Writing（骨架屏 + 写作中 badge）；正文流到位（content≥20）→ 自动切回 R-Reading。
8. **WritingPill**：触发 agent 写第 N 章 + 用户手动切到第 M 章（M≠N）→ R-Reading 顶部显 WritingPill；点 pill → 跳到第 N 章 + 进 R-Writing。
9. **质量门**：`pnpm --dir agent-ui validate`（lint + format + typecheck）过。
