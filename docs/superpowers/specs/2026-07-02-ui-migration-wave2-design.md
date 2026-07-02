# Narratox UI 迁移 — Wave 2 执行设计(workspace)

> **定位**:[迁移策略 spec](./2026-07-02-ui-migration-strategy-design.md) §4 Wave 2 的执行决策增补。Wave 0/1 全部完成并并入 main(auth/library/knowledge/settings + 共享原子全部新设计)。本波攻 workspace(`/novels/[id]`)——最大、最核心路由。tokens 视觉权威仍是 [Token Spec](./2026-07-02-ui-redesign-design.md)。

**前置**:Wave 0(地基)+ Wave 1A/1B-1/1B-2a/1B-2b/1C 全部并入 main。新 token 命名空间 + 全部共享原子(Button/Input/Dialog/Textarea/Skeleton/dropdown-menu/sonner/Icon + Card/Badge/CollapsibleCard/ActivityRow + PageShell)就绪。**workspace 不用 PageShell**(三栏 IconRail+Chat+ResourcePanel 自有布局)。

**决策日期**:2026-07-02。**决策方式**:superpowers brainstorming。**模式**:用户全权委托自主推进,中途免确认(审批由 controller 代决并记录依据)。

---

## 1. 探查结论(Wave 2 表面)

- **~273 处老 token**。最大载体:`ResourcePanel.tsx` **1380 行 / 130 token / 8 个内联 view**(Info/World/Outline/Chapters/Characters/Hooks/Events/Overview)。仅 ReferencesView/VoiceProfileView 是独立文件。
- **chat 树** ~39 token / 12 文件(Messages/MessageItem/ChatInput/MemoryBubble/blank/loader/Multimedia)。活动行内联在 `Messages.tsx` + `MarkdownRenderer/activities.tsx`(未采纳 Wave 0 的 `ActivityRow` 原子)。
- **view 切换**:`page.tsx` 本地 `useState<ResourceKey|null>`(非 URL/nuqs);帧 22 = null 空态(Rail dimmed)。`ResourceKey` union 在 page/IconRail/ResourcePanel **三处重复**(漂移风险)。
- **流式 hook**(`useAIStreamHandler` 569L / `useAIResponseStream` 290L)纯逻辑 → **非 reskin 目标**,不动。
- **MarkdownRenderer**(activities/inlineStyles/styles)被 Wave 1(knowledge/settings)+ Wave 2(chat/workspace)共用 → 本波 rewire,Wave 1 路由的 markdown 跟着变新(一致)。
- **tooltip** 仅 chat(MessageItem/Messages)消费 → 本波 rewire。

Pencil 帧(17-30):Concept `kPvRH` / Active `TokgE` / Streaming `MwIuP` / Skeleton `VxHGc` / Outline `w4Nrq1` / Empty `JTjfa` / RP-Characters `s2DAe` / World `C3eBP` / Hooks `ASiBV` / Events `HKQp3` / Overview `oStTQ` / References `szSPU` / Chapters-TOC `jRYBh` / Voice `pvn8x`。IconRail 组件 `kLUds`。

---

## 2. 子波拆分(3 个,同 1A/1B 节奏)

### Wave 2A — 解构 + shell(最高杠杆,先做)
1. **抽 8 个内联 view → `workspace/views/*.tsx` 独立文件**(InfoView/WorldviewView/OutlineView/ChaptersView/CharactersView/HooksView/EventsView/OverviewView),行为不变。`ResourcePanel.tsx` 变薄(只做 switch + 导入 8 个 + 已有的 ReferencesView/VoiceProfileView)。
2. **统一 `ResourceKey`** 到 `workspace/types.ts`(消除三处重复)。
3. **reskin shell**:`page.tsx`(bg `bg-background/80`→`bg-bg-darkest`、loading)、`IconRail`(tokens + 宽度)、`ChatPanel`(header)、`ResourcePanel` 壳。

### Wave 2B — 聊天树
reskin ChatPanel/Messages/MessageItem/ChatInput/MemoryBubble/ChatBlankState/AgentThinkingLoader/Multimedia + **采纳 `ActivityRow` 原子**(替换 Messages.tsx 内联活动行)+ rewire `MarkdownRenderer/{activities,inlineStyles,styles}` + tooltip。

### Wave 2C — 10 个 view reskin
每个已抽出的 view 对齐 Pencil 帧(Info + 帧 23-30):Characters `s2DAe` / World `C3eBP` / Hooks `ASiBV` / Events `HKQp3` / Overview `oStTQ` / References `szSPU` / Chapters-TOC `jRYBh` / Voice `pvn8x` + Outline/Info。逐 view 帧比对。

---

## 3. 决策(controller 自决,记录依据)

### 3.1 IconRail 宽度:**56px**
Token Spec §3.2 显式 56px;现 `w-12`(48px)→ `w-14`(56px),最小改动。Pencil 帧 `kLUds` 实例宽 200px,但 200px 与 "IconRail"(纯图标轨)命名矛盾、且 §3.2 明确 56 → 判 Pencil 200 为覆盖产物/设计不一致,**取 56**。末尾 review 若要 200,一行可改。

### 3.2 IconRail 图标:**保留 emoji**(本波)
现用 emoji(ℹ️🌍📚…)。Token Spec §1.9 倾向 lucide,但 emoji→lucide 是独立可见改动 + 需逐项挑图标,超出 reskin 范围。**本波只 token-swap + 宽度,emoji 保留**;lucide 迁移作为可选打磨(记入后续)。

### 3.3 采纳 ActivityRow:**是**
chat 内联活动行 → Wave 0 `ActivityRow` 原子(think/tool/content/stage),呼应策略 spec §5.1(聊天 + 拆解日志共用)。在 2B 做。

### 3.4 rewire MarkdownRenderer:**是**(跨波协调)
activities/inlineStyles/styles 迁新 token。Wave 1 的 knowledge 阅读器 / settings voice 预览也消费 → 一起变新(符合迁移方向,无回归)。在 2B 做。

### 3.5 不做(边界)
- **不抽 `useResourceData` 共享 hook**(YAGNI;每 view 自带 useEffect 能跑,reskin 不重构数据层)。
- **不改流式 hook 逻辑**(`useAIStreamHandler`/`useAIResponseStream` 纯逻辑,不动)。
- **view 切换不改成 URL/nuqs**(本地 state 能跑;改架构超范围)。
- 不动业务层(api/store)。

---

## 4. 验证(沿用)

- `pnpm validate` 每步绿。
- 关键帧 Playwright 比对(workspace 需登录 + 数据 → SSR/编译检查为主,全视觉用户末尾 review)。
- **Wave 2 末硬门**:workspace + chat + MarkdownRenderer + tooltip 零老 token;老 token 仅残留在 dissect(Wave 3)。
- 行为不变是硬约束(尤其 2A 的 8-view 抽取 + 2B 的 ActivityRow 采纳):两阶段评审重点验。

---

## 5. 后续

1. `superpowers:writing-plans` 出 **Plan 2A**(解构 + shell)。
2. 执行 2A(子 agent)→ 合并 → 2B → 2C → **Wave 3**(dissect reskin + 老 token **定义**清剿:从 tailwind config + globals 删 `brand`/`background`/`primary` 等)。
3. 全部完成 → 用户统一逐个 review。
