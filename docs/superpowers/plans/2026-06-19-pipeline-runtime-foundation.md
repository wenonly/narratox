# narratox 流水线运行时(基石)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace langgraph-swarm with a two-layer runtime — a stateful **conversational agent** (single, with checkpointer = Deep Agent memory) that routes to **stateless specialist pipelines** (writer→settler, DB-curated memory, no shared thread). Stream everything as a **flat activity timeline** (think/tool/stage/content, each expandable) including GLM's `reasoning_content` (kills the choppiness). Drop the swarm → eliminates the `400 Role empty` source. First pipeline = write-chapter (writer→sync settler, replacing async Analyst).

**Architecture:** Conversational agent (createReactAgent + checkpointer, state-aware prompt, `run_pipeline` tool) → on write intent, triggers `PipelineRunner` which runs stateless `StatelessAgent`s (writer, settler) each with an ephemeral tool-loop + a `Composer`-built context (read fresh from DB). All activity streams as flat `Act*` events (think from reasoning_content, tool calls, stage markers, content) to the FE, rendered as an expandable timeline. Memory: conversational (checkpointer) + novel-state (DB).

**Tech Stack:** NestJS 11 + Prisma 7 + `@langchain/openai` (ChatOpenAI) + `@langchain/langgraph/prebuilt` (createReactAgent, NO swarm, NO checkpointer for specialists). FE: Next.js 15 + Zustand. Gates: server `pnpm typecheck && pnpm lint && pnpm test && pnpm build`; FE `pnpm validate && pnpm build`.

**Spec:** [docs/superpowers/specs/2026-06-19-pipeline-runtime-foundation-design.md](../specs/2026-06-19-pipeline-runtime-foundation-design.md)
**Branch:** `feat/pipeline-runtime` (off `feat/granular-chapter-tools`).

---

## File Structure (new + changed)

**Backend:**
- Create `server/src/pipeline/activity.types.ts` — the flat `ActivityEvent` union (Act/ActDelta/ActTool/ActResult/ActEnd) + helpers.
- Create `server/src/pipeline/composer.ts` — `buildWriterContext` / `buildSettlerContext` (DB→prompt; extracted from ContextAssembler/AnalystService).
- Create `server/src/pipeline/stateless-agent.ts` — `StatelessAgent` interface + a `runToolLoop` helper (createReactAgent w/o checkpointer, ephemeral).
- Create `server/src/pipeline/writer.agent.ts` / `settler.agent.ts` — the two specialists.
- Create `server/src/pipeline/pipeline-runner.ts` — `PipelineRunner` (sequential stages, streams activity).
- Create `server/src/pipeline/conversational.agent.ts` — single stateful agent (checkpointer) + `run_pipeline` tool + state-aware prompt.
- Create `server/src/pipeline/pipeline.module.ts` — wires it.
- Modify `server/src/agentos/agentos.controller.ts` — chat → conversational agent → pipeline; emit flat activity events; remove swarm framing.
- Delete/retire `server/src/agentos/workspace-swarm.service.ts` (swarm) — after migration.
- Retire async Analyst settle path in controller (replaced by sync settler stage).
- Modify `server/src/agentos/agentos.module.ts` — swap providers.

**Frontend:**
- Modify `agent-ui/src/types/os.ts` — `Activity` type + the `Act*` events.
- Modify `agent-ui/src/hooks/useAIStreamHandler.tsx` — handle `Act*` events → flat activity array.
- Create `agent-ui/src/components/chat/ChatArea/Activity/ActivityTimeline.tsx` (+ `ActivityItem.tsx`) — the flat expandable timeline.
- Modify `agent-ui/src/components/chat/ChatArea/Messages/MessageItem.tsx` — render `<ActivityTimeline>` under agent messages.

---

## Notes for the implementer

- **Two kinds of agents, two memory models.** Conversational agent = `createReactAgent` WITH checkpointer (persists chat memory). Specialists (writer/settler) = `createReactAgent` WITHOUT checkpointer (ephemeral tool-loop, discarded after run; memory = DB via Composer).
- **`as never` boundary cast** on every tool passed to createReactAgent (dual-package .d.ts friction) — mirror existing tools.
- **No swarm, no handoffs.** The conversational agent triggers pipelines via a `run_pipeline` tool, not via swarm transfer.
- **reasoning_content is the choppiness fix.** GLM streams `reasoning_content` (thinking) before/with `content`. Capture it (langgraph message-stream chunks carry `additional_kwargs.reasoning_content` deltas) and emit as `think` activity items — so the UI shows activity during the think gap.
- **Per-event flush.** Controller must write+flush each activity event immediately (no buffering) — `res.write` + rely on Node flushing; verify in smoke that events arrive promptly.
- **Self-heal stays** for the conversational agent's checkpointer (400 trim-edge safety net).
- Commit after every task.

---

# Task 0: De-risk spikes (do first)

**Files:** `server/scripts/spike-pipeline-*.ts` (throwaway).

- [ ] **Step 1: Spike — createReactAgent WITHOUT checkpointer runs a tool-loop to completion.**
Write `server/scripts/spike-no-checkpointer.ts`: build a `createReactAgent` (llm=ChatOpenAI GLM, one tool `append_section` stub, NO checkpointer), `.stream({messages:[{role:'user',...}]}, {streamMode:'messages'})` WITHOUT a thread_id/configurable, confirm it runs the tool-loop and finishes. Run it. If it works → specialists can be ephemeral createReactAgent. If not → fall back to hand-rolled tool-loop (call LLM → if tool_call, exec, append, repeat). Record which works.

- [ ] **Step 2: Spike — capture GLM reasoning_content from the message stream.**
Write `server/scripts/spike-reasoning.ts`: `model.stream(prompt)`, for each chunk inspect `chunk.additional_kwargs?.reasoning_content` (and `chunk.content`), print which chunks carry reasoning vs content + timing. Confirm reasoning_content is streamable (it's the think tokens). This validates the think-activity feature.

- [ ] **Step 3: Commit the spikes** (diagnostic artifacts, like the others).
```sh
git add server/scripts/spike-no-checkpointer.ts server/scripts/spike-reasoning.ts
git commit -m "diag(spike): createReactAgent w/o checkpointer + GLM reasoning_content capture

Co-Authored-By: Claude <noreply@anthropic.com>"
```

> If a spike FAILS, stop and adjust the plan (e.g., hand-rolled tool-loop instead of createReactAgent-no-checkpointer) before proceeding.

---

# Task 1: Flat activity event protocol (shared types)

**Files:** Create `server/src/pipeline/activity.types.ts`.

- [ ] **Step 1: Define the activity event union**

```ts
/** 扁平活动流事件(不嵌套)。一次回合 = 一条按时间顺序的活动流。 */
export type ActivityType = 'think' | 'tool' | 'stage' | 'content';

export interface ActStart {
  type: 'Act';
  id: string;
  act: ActivityType;
  label?: string; // stage 名 / tool 名 / 概要
}
export interface ActDelta {
  type: 'ActDelta';
  id: string;
  text: string; // think 的推理 token / content 的正文增量(delta,非累积)
}
export interface ActToolArgs {
  type: 'ActTool';
  id: string;
  args: unknown;
}
export interface ActResult {
  type: 'ActResult';
  id: string;
  result: unknown;
}
export interface ActEnd {
  type: 'ActEnd';
  id: string;
  status: 'ok' | 'error';
  summary?: string;
}
export type ActivityEvent =
  | ActStart | ActDelta | ActToolArgs | ActResult | ActEnd;

/** 生成活动 id(单调)。 */
let _seq = 0;
export const nextActId = (prefix: string) => `${prefix}-${Date.now()}-${_seq++}`;
```

> `Date.now()` is fine here (server runtime, not the workflow sandbox). If typecheck complains in any context, pass a counter only.

- [ ] **Step 2: typecheck** — `cd server && pnpm typecheck`.
- [ ] **Step 3: Commit** — `git add server/src/pipeline/activity.types.ts && git commit -m "feat(pipeline): flat activity event protocol (Act/ActDelta/ActTool/ActResult/ActEnd)"`.

---

# Task 2: Composer (DB→prompt per specialist)

**Files:** Create `server/src/pipeline/composer.ts`.

- [ ] **Step 1: Extract buildContext functions**

Read `server/src/agentos/context-assembler.service.ts` (buildSystemPrompt + the memory slices: recent summaries + open hooks) and `server/src/agentos/analyst.service.ts` (the settle prompt). Extract into:

```ts
import { SummaryService } from '../memory/chapter-summary.service';
import { StoryEventService } from '../memory/story-event.service';
import { NovelService } from '../novel/novel.service';
import { ChapterService } from '../novel/chapter.service';

export interface ComposedPrompt { system: string; user: string }

/** writer 的上下文:设定 + 前情 + 未回收伏笔 + 本章目标。从 DB 现读现拼。 */
export async function buildWriterContext(deps: {
  novels: NovelService; summaries: SummaryService; events: StoryEventService;
  userId: string; novelId: string; chapterOrder: number; userMessage: string;
}): Promise<ComposedPrompt> {
  // 复用 ContextAssembler.buildSystemPrompt 的设定拼装 + 近5章摘要 + OPEN 伏笔
  // (把 context-assembler 里 buildSystemPrompt + forSession 的 memory-slice 逻辑搬来/复用)
  // ... system = 设定+前情+伏笔+写作指令(分节、用 append_section、禁正文走聊天)
  // ... user   = `请写第 ${chapterOrder} 章。作者本轮指示:${userMessage}`
  // 实现时直接调用 ContextAssembler 的方法或复制其拼装逻辑。
}

/** settler 的上下文:本章正文 + OPEN 伏笔。 */
export async function buildSettlerContext(deps: {
  novels: NovelService; chapters: ChapterService; events: StoryEventService; summaries: SummaryService;
  userId: string; novelId: string; chapterOrder: number;
}): Promise<ComposedPrompt> {
  // 复用 AnalystService 的 prompt 构造逻辑(本章正文+设定+OPEN 伏笔 + 结构化输出指令)
}
```

> 实现时把 `ContextAssembler`/`AnalystService` 里已有的 prompt 拼装代码**搬过来**(或让 Composer 调用它们的公共方法),不要重写 prompt 文案。

- [ ] **Step 2: typecheck** — clean.
- [ ] **Step 3: Commit** — `git commit -m "feat(pipeline): Composer — buildWriterContext / buildSettlerContext (DB→prompt)"`.

---

# Task 3: StatelessAgent + writer + settler + PipelineRunner

**Files:** Create `stateless-agent.ts`, `writer.agent.ts`, `settler.agent.ts`, `pipeline-runner.ts`.

- [ ] **Step 1: StatelessAgent + runToolLoop helper** (`stateless-agent.ts`)

```ts
import type { ActivityEvent } from './activity.types';

export interface AgentRunContext {
  userId: string; novelId: string; input: Record<string, unknown>;
}
export interface StatelessAgent {
  name: string;
  run(ctx: AgentRunContext): AsyncGenerator<ActivityEvent>;
}
```
Plus a `runToolLoop({ model, system, user, tools, onReasoning, onContent, onTool })` helper that:
- builds a createReactAgent (NO checkpointer) OR hand-rolled loop (per Task 0 spike result);
- streams it; for each chunk: reasoning_content delta → `onReasoning(delta)`; content delta → `onContent(delta)`; tool_call → `onTool(name,args)`; tool result → `onResult(result).
- (This is where reasoning_content capture lives — the choppiness fix.)

- [ ] **Step 2: writer agent** (`writer.agent.ts`) — uses Composer.buildWriterContext + runToolLoop with tools [append_section, get_chapter, list_chapters, query_memory] (closure-injected userId/novelId). Yields activity events (think from reasoning, tool calls).

- [ ] **Step 3: settler agent** (`settler.agent.ts`) — uses Composer.buildSettlerContext + a single structured-output call (withStructuredOutput method:'functionCalling', per the Analyst spike). On result, writes ChapterSummary + StoryEvents (via SummaryService/StoryEventService — directly, like AnalystService now). Yields activity (think + "提取到 N 项事实").

- [ ] **Step 4: PipelineRunner** (`pipeline-runner.ts`)

```ts
export interface Pipeline { name: string; stages: { name: string; agent: StatelessAgent; input: (ctx: PipelineCtx) => Record<string, unknown> }[] }
export class PipelineRunner {
  async *run(pipeline: Pipeline, base: { userId: string; novelId: string; input: Record<string, unknown> }): AsyncGenerator<ActivityEvent> {
    const ctx: PipelineCtx = { ...base, outputs: {} };
    for (const stage of pipeline.stages) {
      yield { type: 'Act', id: nextActId('stage'), act: 'stage', label: stage.name };
      for await (const ev of stage.agent.run({ userId: base.userId, novelId: base.novelId, input: stage.input(ctx) })) {
        yield ev;
      }
      yield { type: 'ActEnd', id: /*match the stage Act id*/, status: 'ok' };
    }
  }
}
```
(Track stage Act ids to emit matching ActEnd — adjust the helper to manage ids.)

- [ ] **Step 5: typecheck + tests** — unit test PipelineRunner sequencing with stub agents (yields stage markers + agent events in order). `cd server && pnpm typecheck && pnpm test`.
- [ ] **Step 6: Commit** — `git commit -m "feat(pipeline): StatelessAgent + writer/settler + PipelineRunner"`.

---

# Task 4: Conversational agent (single, checkpointer) + run_pipeline

**Files:** Create `conversational.agent.ts`.

- [ ] **Step 1: The conversational agent**

A `createReactAgent` WITH the PostgresSaver checkpointer ( Deep Agent memory). Tools:
- `update_novel`, `get_novel_info` (existing, for onboarding/CONCEPT).
- `run_pipeline({ name: 'write-chapter', chapterOrder })` — a tool that, when called, runs the write-chapter PipelineRunner and **streams its activity events back** (the controller wires this — the tool itself triggers the runner; the controller forwards the runner's events to the FE). 

> Wiring detail: the conversational agent's tool-loop and the pipeline's activity both need to stream to the FE. Cleanest: the controller runs the conversational agent's stream; when it sees a `run_pipeline` tool_call, it runs the PipelineRunner inline (streaming its events) before resuming. OR the `run_pipeline` tool yields activity through a side-channel. The plan/implementer decides the exact plumbing — the KEY is: pipeline activity events reach the FE flat stream. (This is the trickiest wiring; implementer should spike the "tool triggers a sub-stream that surfaces to the outer HTTP stream" pattern.)

State-aware prompt (from ContextAssembler — CONCEPT→collect via update_novel; ACTIVE→suggest run_pipeline to write).

- [ ] **Step 2: typecheck** — clean.
- [ ] **Step 3: Commit** — `git commit -m "feat(pipeline): conversational agent (single + checkpointer) + run_pipeline trigger"`.

---

# Task 5: Controller wiring + emit activity events + remove swarm

**Files:** Modify `agentos.controller.ts`, `agentos.module.ts`; retire `workspace-swarm.service.ts`.

- [ ] **Step 1: Controller routes chat → conversational agent → (pipeline) → flat activity stream**

Replace the swarm-based `streamTurn` iteration with: run the conversational agent's stream; for each activity event (think/tool/stage/content), write a newline-JSON frame `{event:'Act'|'ActDelta'|..., ...}` to the response; flush per frame. When the conversational agent calls `run_pipeline`, the pipeline's activity events flow through the same response (flat). Keep `RunStarted`/`RunCompleted` as wrappers; remove `RunContent`/`WritingChapter` (replaced by `Act*`).

- [ ] **Step 2: Remove swarm + async Analyst settle**

Delete/retire `workspace-swarm.service.ts` (the swarm). Remove the controller's async settle dispatch (settler is now a sync pipeline stage). Remove the `WritingChapter` frame. Keep the self-heal (clear checkpoint + retry on 400 "Role empty") — adapt it to the conversational agent's stream.

- [ ] **Step 3: Module wiring** — `agentos.module.ts` provides PipelineRunner/conversational agent instead of WorkspaceSwarmService.

- [ ] **Step 4: typecheck + lint + test + build** — `cd server && pnpm typecheck && pnpm lint && pnpm test && pnpm build`. Fix broken refs to the removed swarm.
- [ ] **Step 5: Commit** — `git commit -m "feat(agentos): chat → conversational agent → pipeline; flat activity stream; remove swarm"`.

---

# Task 6: FE flat activity timeline

**Files:** `types/os.ts`, `useAIStreamHandler.tsx`, new `ActivityTimeline.tsx` + `ActivityItem.tsx`, `MessageItem.tsx`.

- [ ] **Step 1: Types** — add `Activity` ({ id, act, label, status, text, toolArgs?, toolResult? }) + the `Act*` event types to `types/os.ts`. Add `activities: Activity[]` to the agent message shape.

- [ ] **Step 2: Stream handler** — in `useAIStreamHandler.tsx`, handle `Act/ActDelta/ActTool/ActResult/ActEnd`: accumulate into the last agent message's `activities[]` (by id: ActStart creates, ActDelta appends text, ActTool/ActResult fill tool detail, ActEnd sets status). Keep RunStarted/RunCompleted wrappers.

- [ ] **Step 3: ActivityTimeline UI** — render `message.activities` as a vertical list of expandable items: think 🧠 (collapsed reasoning, expand to full text), tool 🔧 (name + expand for args/result), stage ▶ (divider/label), content 📝 (the output). Dark theme, compact. Each item: click to toggle expand.

- [ ] **Step 4: MessageItem** — render `<ActivityTimeline>` under the agent message (when activities exist); keep the content display.

- [ ] **Step 5: validate + build** — `cd agent-ui && pnpm validate && pnpm build`.
- [ ] **Step 6: Commit** — `git commit -m "feat(agent-ui): flat activity timeline (expandable think/tool/stage/content)"`.

---

# Task 7: Full smoke + verify

**Files:** none (verification).

- [ ] **Step 1: Gates** — server `pnpm typecheck && pnpm lint && pnpm test && pnpm build`; FE `pnpm validate && pnpm build`.
- [ ] **Step 2: Boot + curl** — boot server; curl a write request; confirm the stream is flat `Act*` events (think from reasoning_content → tool → stage → content), no `400 Role empty`, no swarm handoff messages. Confirm events arrive promptly (smooth, per-event flush).
- [ ] **Step 3: Browser** — new novel → onboard → write a chapter; confirm: the flat activity timeline shows (think streaming during the GLM think gap = no more choppiness), writer appends sections (chapter grows in preview), settler runs sync (facts visible as an activity), no 400 across multiple turns.
- [ ] **Step 4: Tag** — `git tag v0.6.0-foundation` if smoke passes.

---

## Self-Review

**Spec coverage:** two-layer memory (conv checkpointer + stateless specialists) → Tasks 3/4; Composer isolation → Task 2; flat activity protocol + reasoning_content (choppiness fix) → Tasks 1/5/6; write-chapter pipeline (writer→sync settler, replaces async Analyst) → Tasks 3/5; remove swarm (400 source) → Task 5; onboarding via conversational agent → Task 4. ✓

**De-risking:** Task 0 spikes the two unknowns (createReactAgent-no-checkpointer; reasoning_content capture) before building — if either fails, the plan adapts (hand-rolled loop / different think source).

**Hardest wiring:** the `run_pipeline` tool triggering a sub-stream that surfaces to the outer HTTP response (Task 4/5). Flagged for the implementer to spike; it's the main integration risk.

**Scope:** foundation only — validator/scorer/reviser (#2), onboarding-pipeline+router (#3), granular Phase2 (#4) explicitly deferred.
