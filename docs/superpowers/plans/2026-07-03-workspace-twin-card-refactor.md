# Workspace Twin-Card Refactor — Implementation Plan

> Spec: [2026-07-03-workspace-twin-card-refactor-design.md](../specs/2026-07-03-workspace-twin-card-refactor-design.md). Source of truth = Pencil `design/narratox.pen`. Branch: `feat/workspace-twin-card-refactor`.

## Wave 1 — Shell (foundation)
**Goal:** twin-card layout renders; old IconRail gone; chat + a resource card both always visible.

Files:
- `src/app/novels/[id]/page.tsx` — replace `[IconRail][ChatPanel][ResourcePanel?]` with `<div className="flex h-screen gap-4 bg-bg-base p-4"><ChatCard/><ResourceCard/></div>`. Both always rendered. Default `activeResource='chapters'`. Keep all the existing effects (writingChapterOrder follow, refresh on chapterWriteSeq, memory settle, etc.) — only the JSX shell changes.
- **NEW** `src/components/workspace/ChatCard.tsx` (rename/adapt `ChatPanel.tsx`): outer card frame (`rounded-2xl border-overlay-15 bg-bg-card shadow-[...] clip`), `ChatHead` (h-14: `[← 返回] 书名·类型 [phase pill] … [进度 pill] [AccountChip]`), `MessageArea`, `InputCapsule`. Reuse `MessageArea` + the `useAIStreamHandler` wiring from ChatPanel.
- **NEW** `src/components/workspace/ResourceCard.tsx` (adapt `ResourcePanel.tsx`): outer card frame; `ResHead` with 6 nav tabs (centered); body = active view. Width `w-[440px]`.
- **NEW** `src/components/workspace/AccountChip.tsx` — avatar+name+caret; dropdown menu (作者画像/设置/登出) — use shadcn DropdownMenu. (Full menu content can be stubbed; wire logout + link to /settings.)
- **NEW** `src/components/workspace/InputCapsule.tsx` — the unified pill input (replaces `ChatInput`). Keep the `useAIStreamHandler` submit + stop logic; stop state = square icon inside the same capsule.
- **NEW** `src/components/workspace/NavTabs.tsx` — the 6 resource tabs (icon+active highlight), shared by ResourceCard head.
- `src/components/workspace/types.ts` — `ResourceKey` → 6 keys: `'chapters'|'outline'|'characters'|'worldview'|'plotline'|'references'`. (info/overview/voiceProfile/events/status removed from the union; events+status→plotline.)
- `src/components/workspace/ResourcePanel.tsx` + `IconRail.tsx` — **delete** (replaced by ResourceCard/NavTabs/AccountChip). Update imports in page.tsx + anywhere else.
- `src/components/chat/ChatArea/ChatInput/` — keep for now (InputCapsule may reuse `TextArea`); delete only if unused after InputCapsule lands.

ResourceCard body in W1: render the existing views via a temporary map (old views still old-styled — restyle in W2). For removed keys (info/overview/events/status), map: `events`/`status`→PlotlineView stub (W2); `info`→InfoView (temporary, until folded to header in W2); `overview`→OverviewView (temporary). `voiceProfile` tab removed (link from AccountMenu instead).

**Gate:** `pnpm --dir agent-ui typecheck` green; `/novels/[id]` renders twin cards, chat works, switching a couple tabs works. Commit `feat(agent-ui): workspace twin-card shell (W1)`.

## Wave 2 — Resources
- `types.ts`: finalize 6 keys; remove old.
- `ResourceCard`: clean switch over 6 tabs; remove temporary mappings.
- **NEW** `views/PlotlineView.tsx` — sub-tabs `[伏笔|事件]`; renders HooksView / EventsView content under the chosen sub-tab. (Reuse HooksView/EventsView data hooks; restyle to card.)
- **NEW** `StatusPopover.tsx` (B2) — popover from ChatHead `进度 pill`: progress bar + onboarding checklist (from `getStatus` / novel fields) + nextStep. Remove `overview` tab.
- **NEW** `VoiceProfileSelector.tsx` (B5) — current profile card (attributes) + library list (sets `Novel.voiceProfileId` via PATCH). Remove `voiceProfile` from workspace tabs; keep full editor in /settings.
- Fold `info` into ChatHead (`书名·类型` from novel); drop `InfoView` tab (edit → dialog or /settings later).
- Restyle each view to the card aesthetic:
  - `OutlineView` — arcs nested under volumes (left indigo accent + 5-beat dots + chapter plans inside). (R1)
  - `WorldviewView` — collapsible entries (collapsed = title+essence, expanded = text only). (R3)
  - `ReferencesView` — collapsible entries (text only). (R5)
  - `CharactersView` — grouped by role; expanded profile card. (R2)
  - `ChaptersView` — chapter pill toolbar (fill+ellipsis) + `[复制][章节列表][编辑]`.
- `HooksView`/`EventsView` — keep data layer; restyle rows to compact cards.

**Gate:** typecheck; each of 6 tabs renders correct content; 态势 popover opens; 画像 selector sets profile. Commit `feat(agent-ui): workspace 6-tab resources + arcs/collapse/popover/selector (W2)`.

## Wave 3 — Activities (chat bubbles)
- `src/components/ui/typography/MarkdownRenderer/activities/*` — restyle the rendered activity components:
  - think → chip (`思考·Ns ▾`) + expandable muted reasoning block.
  - tool → **single-line rows** (`[✓] tool · summary`); consecutive tools collapse into `工具调用·N次 ▾`. Running = indigo loader; done = green check.
  - stage → handoff card (`↳ 章节主理人` badge + task, indigo left-accent; done = green).
  - content → prose + `▌` cursor while streaming.
  - result → green left-accent result line.
- `MemoryBubble` → violet pill `🧠 记忆已更新 · …`.
- `AgentThinkingLoader` → three dots (keep).
- error/stopped → keep existing paths, restyle to match (red row / 已停止 badge).

**Gate:** typecheck; run a turn, activities render compactly. Commit `feat(agent-ui): compact chat activities (W3)`.

## Wave 4 — States
- `ChatBlankState` (B1) — centered welcome hero (gradient sparkles mark + heading + subtext + 3 suggestion chips that fill the input on click). Show when `messages` empty.
- `ChaptersView` WritingPill (B3) — `✍ AI 正写第 N 章 · 跳转` indigo pill when `writingChapterOrder !== currentChapterOrder`; skeleton bars when on the writing chapter.
- `ChaptersView` edit mode (B4) — edit btn toggles read↔edit; editable `$bg-darkest` + indigo focus border + `▌`; 取消/保存 (existing PATCH save).
- (B2 popover + B5 selector already done in W2.)

**Gate:** typecheck + `pnpm validate`; full review. Commit `feat(agent-ui): workspace states — welcome/writing-follow/edit (W4)`. Merge to main.

## Self-review checklist (per wave)
- typecheck green (`pnpm --dir agent-ui typecheck`).
- No dangling imports of deleted files (IconRail, ResourcePanel, removed views).
- Old token usage = zero (already migrated; don't reintroduce `bg-brand` etc.).
- Behavior preserved: streaming, tool-call→writingChapterOrder follow, memory settle, chapter refresh on write, logout/auth.
