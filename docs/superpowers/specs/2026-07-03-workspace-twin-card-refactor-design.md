# Workspace Twin-Card Refactor — Design Spec

> Source of truth: `design/narratox.pen` (frames v5, R1–R5/R4b, R-TOC, R-Account, R-Empty, A1–A6, B1–B5). This spec is the code-side contract; tokens/structure below are copied from the .pen so implementers don't need to open Pencil.

## Goal
Refactor the novel workspace (`agent-ui/src/app/novels/[id]`) from the old 3-column `[IconRail 200][Chat][ResourcePanel?]` to the Pencil **v5 twin-card** design:

```
┌─────────────────────────────────────────────────┐  (16px outer padding, $bg-base page)
│  ┌── ChatCard (fill) ──┐  ┌── ResourceCard (440) ──┐ │
│  │ ChatHead            │  │ ResHead: 6 nav tabs    │ │
│  │ Messages            │  │ Body: active resource  │ │
│  │ Input capsule       │  │                        │ │
│  └─────────────────────┘  └────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

Both cards **always visible** (resource no longer conditional). `gap: 16` between cards. Cards: `$bg-card` fill + `$overlay-15` stroke + `radius-2xl`(16) + outer shadow `0/6/24 #00000066` + `clip`.

## Design tokens (from `get_variables`, already in `tailwind.config.ts` / `globals.css`)
- bg: `$bg-base` #0a0a0b (page), `$bg-card` #1A1A22 (cards), `$bg-card-elev` #2A2A35 (inputs/bubbles/pills inside cards), `$bg-darkest` #0F0F13, `$bg-dark` #13131a, `$bg-raised` #252530.
- accent: `$accent-primary` #6366f1, `$accent-primary-soft` #6366f126 (≈15% tint), `$accent-indigo-lt` #818CF8, `$accent-violet` #8b5cf6, `$accent-violet-lt` #a78bfa.
- text: `$text-primary` #fff, `$text-secondary` #d4d4d8, `$text-tertiary` #a1a1aa, `$text-label` #71717a.
- overlay: `$overlay-5` #ffffff0a, `$overlay-10` #ffffff0f, `$overlay-15` #ffffff14.
- functional (RGB-channel, support `/NN`): `$success` #22C55E, `$destructive` #E53935.
- radius: `$radius-md` 6, `$radius-lg` 8, `$radius-xl` 12, `$radius-2xl` 16, `$radius-pill` 100, `$radius-input` 10.
- font: `$font-sans` Inter, `$font-mono` JetBrains Mono.

> **Opacity footgun** (still applies): bare `var()` tokens (`$accent-*`, `$text-*`, `$bg-*`) do NOT support Tailwind `/NN`. Use `$accent-primary-soft` for indigo tint, `$overlay-*` for white tints, or literal `bg-[#6366f1XX]`. Functional colors (`$success`/`$destructive`) DO support `/NN`.

## Mapping (code ← Pencil)

| Current code | → Target (Pencil) |
|---|---|
| `page.tsx` `[IconRail][ChatPanel][ResourcePanel?]` | `<div p-4 bg-bg-base gap-4 flex> <ChatCard/> <ResourceCard/> </div>` (both always rendered) |
| `IconRail.tsx` (9 items + 返回/画像/登出) | **deleted as a zone**. 6 resource tabs → `ResourceCard` header. 返回/画像/登出 → `ChatCard` header (AccountMenu). |
| `ResourceKey` (9: info/worldview/references/outline/chapters/characters/status/events/overview + voiceProfile) | **6 tabs**: `chapters`(正文) `outline`(大纲) `characters`(角色) `worldview`(世界观) `plotline`(剧情线=伏笔+事件) `references`(参考资料). `info`+`overview` → ChatCard header. `voiceProfile` → AccountMenu / B5 selector. |
| `ResourcePanel.tsx` (420, conditional) | `ResourceCard.tsx` (440, always). Header = 6 nav tabs (centered, active=accent-primary-soft). Body = active view. |
| `HooksView` + `EventsView` (separate) | `PlotlineView.tsx` wrapping both with sub-tabs `[伏笔 \| 事件]` (R4/R4b). |
| `OverviewView` (full tab) | `StatusPopover` — opens from the header `进度 N%` pill (B2): progress bar + onboarding checklist + next-step. |
| `InfoView` (tab) | folded into ChatCard header (`书名·类型` text). Edit-info → click header → dialog (deferred; minimal first). |
| `VoiceProfileView` (workspace tab, library CRUD) | Full editor stays in `/settings`. Workspace gets `VoiceProfileSelector` (B5): current profile card + library list (sets `Novel.voiceProfileId`). |
| `ChatPanel.tsx` | `ChatCard.tsx`: ChatHead (`[←返回] 书名·类型 [phase] … [进度 pill] [AccountChip]`) + MessageArea + Input capsule. |
| `ChatInput.tsx` (field + separate send btn) | Unified **InputCapsule**: one `radius-pill` `$bg-card-elev` pill containing placeholder (fill) + embedded 48-round gradient send button. |
| `MessageItem` agent bubble | `$bg-card-elev` fill, no border, `radius-xl`. User bubble `$accent-primary-soft`, `radius-xl`. |
| Activities (`MarkdownRenderer/activities`: think/tool/stage/content) | Compact styles A1–A6: think=chip+expanded muted text; tool=**single-line rows** (`[✓] tool · summary`, collapsible batch `工具调用·N次 ▾`); stage=handoff card (`↳ 章节主理人` badge, indigo left-accent); content=prose+cursor; result=green left-accent. |
| `MemoryBubble` | violet pill `🧠 记忆已更新 · …`. |
| `ChatBlankState` | B1 centered welcome: gradient sparkles mark (glow) + "和我聊聊你的故事吧" + subtext + 3 suggestion chips. |
| `ChaptersView` toolbar (emoji 📋☰) | `[‹ pill 第N章·标题 ›] [复制][章节列表][编辑]` — pill fills width (`fill_container`, ellipsis on long title), lucide icons. |
| WritingPill (follow indicator) | B3: `✍ AI 正写第 N 章 · 跳转 ›` indigo pill (when viewing ≠ writing chapter). Skeleton bars when on the writing chapter. |
| Chapter edit mode | B4: edit btn toggles; editable `$bg-darkest` block with `$accent-indigo-lt` focus border + `▌`; 取消/保存 actions. |

## Decisions
1. ResourceCard **always visible**; default active = `chapters` (正文). No "empty resource" null state in normal use (the B1 welcome covers the CONCEPT/no-message chat state instead).
2. **6 tabs** (merge伏笔+事件→剧情线; info/态势→header; voiceProfile→account). Old 9-key `ResourceKey` union → new 6-key + the relocated ones handled by ChatCard/AccountMenu.
3. VoiceProfile **full editor stays in `/settings`**; workspace gets a **selector** (B5) that sets `Novel.voiceProfileId`.
4. 态势 (overview) → **popover** from header progress pill (B2), not a tab.
5. Activities restyled in place (`MarkdownRenderer/activities`) — the `::think`/`::tool`/`::stage` directive system is unchanged; only the rendered components' styling changes.
6. Old `IconRail` component + `kLUds` Pencil component become unused → delete after W1.

## Waves (each independently shippable + committed)
- **W1 — Shell**: `page.tsx` twin-card + 16px pad; `ChatCard`/`ResourceCard` shells; nav-tab header (6 tabs, temporary direct mapping, views can stay old-styled); ChatHead with 返回 + 书名·类型 + phase + 进度 pill + AccountChip (dropdown stub ok). InputCapsule. Delete IconRail. **Gate: layout renders, typecheck green.**
- **W2 — Resources**: 6-tab `ResourceKey` + switch; `PlotlineView` (sub-tabs merge Hooks+Events); `StatusPopover` from progress pill; `VoiceProfileSelector` (B5); each view restyled to card (折叠 entries for worldview/references; arcs in outline; chapter pill toolbar).
- **W3 — Activities**: compact think/tool/stage/content/memory/result in `MarkdownRenderer/activities`; MemoryBubble violet pill; tool = single-line rows + batch collapse.
- **W4 — States**: B1 welcome (`ChatBlankState`); B3 WritingPill + skeleton; B4 chapter edit mode; (B2 popover + B5 selector done in W2).

## Out of scope / deferred
- Mobile/responsive layout (design is desktop 1440).
- Toast/tooltip/hover micro-interactions (use existing primitives).
- Full voice-profile editor in workspace (stays in /settings).
- Context-compression indicator (separate initiative).
