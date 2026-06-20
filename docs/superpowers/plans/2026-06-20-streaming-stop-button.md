# 流式中断/停止按钮 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让聊天发送按钮在流式输出时变成「停止按钮(方块图标 + loading 脉冲)」,点击后前端 abort fetch、后端监听连接断开并真正中止 LangGraph run(停掉 LLM 与 `write_chapter`),中断后保留部分内容并显示「已停止」徽章。

**Architecture:** 前端 `useAIStreamHandler` 内部用 `useRef` 持有 `AbortController`,暴露 `stopStreaming`;`signal` 经 `useAIResponseStream` 传给 `fetch`。后端 `agentos.controller` 在 run handler 加 `@Req()`,`req.on('close')` 触发自己的 `AbortController.abort()`,signal 透传进 `deep-agent.service.ts` 的 `agent.stream({ signal })`。中断是用户主动行为,走 `manual` 标志静默,不触发红色错误态。

**Tech Stack:** Next.js 15 / React 18(agent-ui,无测试 runner → 用 typecheck + lint + 手动验证);NestJS 11 / jest(server,Task 1 严格 TDD);@langchain/langgraph(deepagents `.stream({ signal })`)。

**测试策略适配:** agent-ui 没有配置任何测试 runner(CLAUDE.md 明确),前端任务以 `pnpm --dir agent-ui typecheck` + `lint` 为静态保障,功能正确性由 Task 9 的端到端手动验证兜底。server 有 jest,Task 1(controller)走完整 TDD;Task 2(service 的 signal 透传)涉及 deepagents/langgraph 的 ESM mock,成本高价值低,以 typecheck + 端到端验证。

**Spec:** [docs/superpowers/specs/2026-06-20-streaming-stop-button-design.md](../specs/2026-06-20-streaming-stop-button-design.md)

---

## File Structure

后端(`server`):
- [src/agentos/agentos.controller.ts](server/src/agentos/agentos.controller.ts) — 加 `@Req()` + `AbortController` + `req.on('close')` + `writeFrame` 防御 + 透传 `signal`
- [src/agentos/deep-agent.service.ts](server/src/agentos/deep-agent.service.ts) — `runTurn` 接收并透传 `signal` 到 `.stream()`
- [src/agentos/agentos.controller.spec.ts](server/src/agentos/agentos.controller.spec.ts) — 新增 abort 测试

前端(`agent-ui`):
- [src/types/os.ts](agent-ui/src/types/os.ts) — `ChatMessage.stopped`
- [src/components/ui/icon/types.ts](agent-ui/src/components/ui/icon/types.ts) + [constants.tsx](agent-ui/src/components/ui/icon/constants.tsx) — 注册 `square` 图标
- [src/hooks/useAIResponseStream.tsx](agent-ui/src/hooks/useAIResponseStream.tsx) — `streamResponse` 支持 `signal`
- [src/hooks/useAIStreamHandler.tsx](agent-ui/src/hooks/useAIStreamHandler.tsx) — `abortRef` + `stopStreaming` + abort 感知的 `onError`
- [src/components/chat/ChatArea/ChatInput/ChatInput.tsx](agent-ui/src/components/chat/ChatArea/ChatInput/ChatInput.tsx) — 按钮分支(send ↔ stop)
- [src/components/chat/ChatArea/Messages/MessageItem.tsx](agent-ui/src/components/chat/ChatArea/Messages/MessageItem.tsx) — 「已停止」徽章

执行顺序:后端(1,2)→ 前端(3–8)→ 端到端验证(9)。

---

## Task 1: 后端 controller — 客户端断开时中止 run(TDD)

**Files:**
- Modify: `server/src/agentos/agentos.controller.ts:1-227`
- Test: `server/src/agentos/agentos.controller.spec.ts`

- [ ] **Step 1: 写失败测试**

在 `server/src/agentos/agentos.controller.spec.ts` 顶部把 express 类型 import 改为同时引入 `Request`:

```ts
import type { Request, Response } from 'express';
```

在文件末尾的 `describe('AgentosController', ...)` 块内(最后一个 `it` 之后、闭合 `});` 之前)新增:

```ts
  it('POST runs passes an AbortSignal to runTurn and aborts it when the client disconnects', async () => {
    const sessions = makeSessionsMock();
    let capturedSignal: AbortSignal | undefined;
    const runTurnMock = jest.fn(
      (args: {
        emit: (ev: ActivityEvent) => void;
        signal?: AbortSignal;
      }) => {
        capturedSignal = args.signal;
        args.emit({ type: 'Act', id: 'c', act: 'content' });
        args.emit({ type: 'ActDelta', id: 'c', text: 'ok' });
        return Promise.resolve();
      },
    );
    const conversational = {
      runTurn: runTurnMock,
    } as unknown as DeepAgentService;
    const assemblerMock = {
      forSession: jest.fn().mockResolvedValue({ prompt: 'P', novelId: 'n-1' }),
    } as unknown as ContextAssembler;
    const c = new AgentosController(
      conversational,
      sessions as unknown as SessionsService,
      assemblerMock,
    );
    const { res } = createFakeRes();

    let closeCb: (() => void) | null = null;
    const req = {
      on: (event: string, cb: () => void) => {
        if (event === 'close') closeCb = cb;
      },
    } as unknown as Request;

    await c.runAgent(
      USER,
      'deep-agent',
      { message: 'hi', session_id: 'sess-1' },
      res,
      req,
    );

    // runTurn 必须收到一个未中止的 signal(供 LangGraph 透传给模型/工具)。
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(capturedSignal?.aborted).toBe(false);

    // 客户端断开 → signal 被 abort → LangGraph stream 真正停掉。
    closeCb?.();
    expect(capturedSignal?.aborted).toBe(true);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --dir server test -- agentos.controller.spec.ts`
Expected: FAIL —— 新测试报错(signal 为 `undefined`,因为 controller 还没传;`req` 第 5 参数当前也不存在)。其余既有测试应仍 PASS。

- [ ] **Step 3: 实现 controller 改动**

在 `server/src/agentos/agentos.controller.ts`:

把 `@nestjs/common` 的 import 加上 `Req`:

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Post,
  Req,
  Res,
  UseInterceptors,
} from '@nestjs/common';
```

把 express 类型 import 加上 `Request`:

```ts
import type { Request, Response } from 'express';
```

把整个 `runAgent` 方法(当前第 106–227 行)替换为下面这版(新增:`@Req() req?: Request`、`AbortController`、`req?.on('close')`、`writeFrame` 防御、`signal: ac.signal` 透传):

```ts
  @Post('agents/:id/runs')
  @UseInterceptors(NoFilesInterceptor())
  async runAgent(
    // 路由的 :id 为兼容 AgentOS 而保留;实际 agent 由 session 绑定的小说决定。
    @CurrentUser() user: RequestUser,
    @Param('id') _id: string,
    @Body()
    body: {
      message?: string;
      session_id?: string;
      stream?: string;
    },
    @Res() res: Response,
    @Req() req?: Request,
  ): Promise<void> {
    const message = body?.message ?? '';
    res.setHeader('Content-Type', 'application/json');

    // 客户端断开 → abort LangGraph stream(停掉 LLM/工具执行)。正常结束时 stream
    // 已结束,abort 无副作用。req 可选以兼容单测直接调用。
    const ac = new AbortController();
    req?.on('close', () => ac.abort());

    // socket 关闭后 write 会抛 ERR_STREAM_WRITE_AFTER_END —— 统一防御。
    const writeFrame = (payload: Record<string, unknown>): void => {
      if (res.writableEnded || res.destroyed) return;
      res.write(JSON.stringify(payload) + '\n');
    };

    let sessionId = body?.session_id ?? '';
    let contentMarkdown = '';
    let activities: unknown = {};
    let completed = false;
    try {
      const session = await this.sessions.resolveSession(
        user.id,
        body?.session_id,
        AGENT_ID,
        message,
      );
      sessionId = session.id;
      const { prompt, novelId } = await this.contextAssembler.forSession(
        user.id,
        session.id,
      );
      writeFrame({
        event: 'RunStarted',
        agent_id: AGENT_ID,
        session_id: sessionId,
        created_at: now(),
      });

      // 活动帧汇:每个 ActivityEvent 即时写一帧 newline-JSON(不缓冲),同时收进
      // collected。流末 aggregate → { contentMarkdown, activitiesLookup };
      // contentMarkdown 含 ::think/tool/stage 标记(与 FE 流式构建同构),
      // 落 assistant message.content 供刷新时重建交错文档。
      const collected: ActivityEvent[] = [];
      const emit = (ev: ActivityEvent): void => {
        collected.push(ev);
        writeFrame({ event: ev.type, ...ev, created_at: now() });
      };

      if (novelId) {
        await this.deepAgent.runTurn({
          userId: user.id,
          novelId,
          threadId: sessionId,
          userMessage: message,
          systemPrompt: prompt,
          emit,
          signal: ac.signal,
        });
      } else {
        // 防御:工作台 session 必有关联小说;查不到时给一条可读提示而非崩溃。
        const id = nextActId('content');
        const fallback = '（未找到关联的小说,请从书架进入一本小说后再对话。）';
        emit({ type: 'Act', id, act: 'content' });
        emit({ type: 'ActDelta', id, text: fallback });
        emit({ type: 'ActEnd', id, status: 'ok' });
      }

      const aggregated = aggregateActivities(collected);
      contentMarkdown = aggregated.contentMarkdown;
      activities = aggregated.activities;

      writeFrame({
        event: 'RunCompleted',
        content: contentMarkdown,
        created_at: now(),
      });
      completed = true;
    } catch (err) {
      // 记录完整错误(类型/message/stack/cause)—— RunError 帧只带 message,栈会丢。
      this.logger.error(
        err instanceof Error ? err : new Error(String(err)),
        `[agentos] run stream failed (session ${sessionId})`,
      );
      writeFrame({
        event: 'RunError',
        content: err instanceof Error ? err.message : String(err),
        created_at: now(),
      });
    } finally {
      res.end();
      // 流成功且确有用户消息才落库;DB 写失败不回滚已推送的流(best-effort)。
      // 模型可能只调工具(append_section)而不输出聊天文字 → contentMarkdown 为空 → 给占位,
      // 保持 user/assistant 配对且不显示空气泡。activities 供刷新时重建交错活动流。
      if (completed && message) {
        const reply = contentMarkdown.trim() || '（已写入章节正文）';
        try {
          await this.sessions.appendTurn(
            user.id,
            sessionId,
            message,
            reply,
            activities,
          );
        } catch (err) {
          this.logger.error(
            `[agentos] appendTurn failed for session ${sessionId}: ${
              err instanceof Error ? err.message : err
            }`,
          );
        }
      }
    }
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --dir server test -- agentos.controller.spec.ts`
Expected: PASS —— 新测试通过(收到未中止 signal,close 后中止);既有测试全部仍 PASS(它们调用 `runAgent` 时第 5 参数 `req` 缺省为 `undefined`,`req?.on` 短路,不抛错)。

- [ ] **Step 5: 跑 server typecheck**

Run: `pnpm --dir server typecheck`
Expected: PASS(无 TS 错误;`AbortController`/`AbortSignal` 由 `@types/node` 提供,`server/tsconfig.json` 的 `types: ['node','jest']` 已覆盖)。

- [ ] **Step 6: Commit**

```bash
git add server/src/agentos/agentos.controller.ts server/src/agentos/agentos.controller.spec.ts
git commit -m "feat(agentos): abort run on client disconnect (req.on close + signal)"
```

---

## Task 2: 后端 service — `runTurn` 透传 signal 到 `.stream()`

**Files:**
- Modify: `server/src/agentos/deep-agent.service.ts:112-223`

- [ ] **Step 1: 扩展 `runTurn` 签名与解构**

在 `server/src/agentos/deep-agent.service.ts`,把 `runTurn` 的 `args` 类型加一个 `signal?: AbortSignal` 字段,并在解构里取出:

```ts
  async runTurn(args: {
    userId: string;
    novelId: string;
    threadId: string;
    userMessage: string;
    systemPrompt: string;
    emit: (ev: ActivityEvent) => void;
    signal?: AbortSignal;
  }): Promise<void> {
    const {
      userId,
      novelId,
      threadId,
      userMessage,
      systemPrompt,
      emit,
      signal,
    } = args;
```

- [ ] **Step 2: 扩展 `agent.stream` 的手写类型签名**

同一个文件,把 `createDeepAgent` 返回值的结构化类型(约 204–211 行)的 `options` 加 `signal?`:

```ts
    }) as unknown as {
      // deepagents 的 .d.ts 在 nodenext 下判为 error type(同 @langchain/openai 的 dual-package 摩擦);
      // 且 middleware 上的 `as never` 会让 createDeepAgent 的返回类型塌缩 → 给 agent 一个结构化的 .stream 类型。
      stream: (
        input: { messages: Array<{ role: string; content: string }> },
        options: {
          configurable: Record<string, unknown>;
          streamMode: string;
          signal?: AbortSignal;
        },
      ) => Promise<AsyncIterable<unknown>>;
    };
```

- [ ] **Step 3: 把 signal 传进 `.stream()`**

把 `.stream(...)` 调用(约 213–216 行)改为:

```ts
    const stream = await agent.stream(
      { messages: [{ role: 'user', content: userMessage }] },
      { configurable: { thread_id: threadId }, streamMode: 'messages', signal },
    );
```

- [ ] **Step 4: 跑 server typecheck + 全量测试**

Run: `pnpm --dir server typecheck && pnpm --dir server test`
Expected: typecheck PASS;测试全绿(Task 1 的 controller 测试已覆盖「signal 传到 runTurn」;此处把 signal 继续传给 langgraph 的真实行为留给 Task 9 端到端验证)。

- [ ] **Step 5: Commit**

```bash
git add server/src/agentos/deep-agent.service.ts
git commit -m "feat(agentos): thread AbortSignal into deep-agent .stream()"
```

---

## Task 3: 前端 — `ChatMessage.stopped` 字段

**Files:**
- Modify: `agent-ui/src/types/os.ts:220-237`

- [ ] **Step 1: 加字段**

在 `agent-ui/src/types/os.ts` 的 `ChatMessage` interface 里,`streamingError?: boolean` 下方加一行:

```ts
export interface ChatMessage {
  role: 'user' | 'agent' | 'system' | 'tool'
  content: string
  streamingError?: boolean
  stopped?: boolean
  created_at: number
  tool_calls?: ToolCall[]
  activities?: ActivityMap
  extra_data?: {
    reasoning_steps?: ReasoningSteps[]
    reasoning_messages?: ReasoningMessage[]
    references?: ReferenceData[]
  }
  images?: ImageData[]
  videos?: VideoData[]
  audio?: AudioData[]
  response_audio?: ResponseAudio
  memory?: MemoryData
}
```

- [ ] **Step 2: 跑 typecheck**

Run: `pnpm --dir agent-ui typecheck`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add agent-ui/src/types/os.ts
git commit -m "feat(agent-ui): add ChatMessage.stopped flag"
```

---

## Task 4: 前端 — 注册 `square` 图标

**Files:**
- Modify: `agent-ui/src/components/ui/icon/types.ts`
- Modify: `agent-ui/src/components/ui/icon/constants.tsx`

- [ ] **Step 1: `IconType` union 加 `'square'`**

在 `agent-ui/src/components/ui/icon/types.ts`,把 `IconType` union 末尾(`| 'trash'` 之后)加一行:

```ts
  | 'trash'
  | 'square'
```

- [ ] **Step 2: import + 注册**

在 `agent-ui/src/components/ui/icon/constants.tsx`,把 lucide-react 的 import 加 `Square`:

```ts
import {
  RefreshCw,
  Edit,
  Save,
  X,
  ArrowDown,
  SendIcon,
  Download,
  HammerIcon,
  Check,
  ChevronDown,
  ChevronUp,
  Trash,
  Square
} from 'lucide-react'
```

在 `ICONS` map 末尾(`trash: Trash` 之后,闭合 `}` 之前)加一条:

```ts
  references: ReferencesIcon,
  trash: Trash,
  square: Square
}
```

- [ ] **Step 3: 跑 typecheck**

Run: `pnpm --dir agent-ui typecheck`
Expected: PASS(`IconTypeMap` 由 `IconType` 映射而来,加了 `'square'` 后 `ICONS` 必须有对应条目,否则 TS 报缺 key —— Step 2 已补,故通过)。

- [ ] **Step 4: Commit**

```bash
git add agent-ui/src/components/ui/icon/types.ts agent-ui/src/components/ui/icon/constants.tsx
git commit -m "feat(agent-ui): register square icon"
```

---

## Task 5: 前端 — `useAIResponseStream` 支持 `signal`

**Files:**
- Modify: `agent-ui/src/hooks/useAIResponseStream.tsx:180-215`

- [ ] **Step 1: options 加 `signal` 并传给 fetch**

在 `agent-ui/src/hooks/useAIResponseStream.tsx`,把 `streamResponse` 的 options 类型和解构、以及 `fetch` 调用改成:

```ts
  const streamResponse = useCallback(
    async (options: {
      apiUrl: string
      headers?: Record<string, string>
      requestBody: FormData | Record<string, unknown>
      signal?: AbortSignal
      onChunk: (chunk: RunResponseContent) => void
      onError: (error: Error) => void
      onComplete: () => void
    }): Promise<void> => {
      const {
        apiUrl,
        headers = {},
        requestBody,
        signal,
        onChunk,
        onError,
        onComplete
      } = options

      // Buffer to accumulate partial JSON data.
      let buffer = ''

      try {
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            // Set content-type only for non-FormData requests.
            ...(!(requestBody instanceof FormData) && {
              'Content-Type': 'application/json'
            }),
            ...headers
          },
          body:
            requestBody instanceof FormData
              ? requestBody
              : JSON.stringify(requestBody),
          signal
        })
```

(改动点:options 类型 + 解构多了 `signal`;`fetch` 配置末尾加了 `signal`。其余文件内容不动。)

- [ ] **Step 2: 跑 typecheck**

Run: `pnpm --dir agent-ui typecheck`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add agent-ui/src/hooks/useAIResponseStream.tsx
git commit -m "feat(agent-ui): support AbortSignal in useAIResponseStream"
```

---

## Task 6: 前端 — `useAIStreamHandler` 加 `stopStreaming` + abort 感知的 onError

**Files:**
- Modify: `agent-ui/src/hooks/useAIStreamHandler.tsx`

- [ ] **Step 1: import `useRef`**

文件顶部第 1 行:

```ts
import { useCallback, useRef } from 'react'
```

- [ ] **Step 2: 加 `abortRef`,并在 `handleStreamResponse` 里创建/透传 controller**

在 hook 内(`const setIsStreaming = useStore(...)` 等一票 selector 之后、`handleStreamResponse` 之前)加:

```ts
  // 当前流的 AbortController + 「是否用户主动停止」标志。controller 用 useRef 持有
  // (命令式副作用,不进 Zustand store);manual 区分「主动停止(静默)」vs「真错误(红色)」。
  const abortRef = useRef<{ controller: AbortController | null; manual: boolean }>(
    { controller: null, manual: false }
  )
```

在 `handleStreamResponse` 的 `setIsStreaming(true)` 之后(约第 107 行后)加两行,创建 controller 并存入 ref:

```ts
      setIsStreaming(true)

      const controller = new AbortController()
      abortRef.current = { controller, manual: false }
```

把 `streamResponse({ ... })` 调用(约 175 行)的参数里加上 `signal`:

```ts
        await streamResponse({
          apiUrl: RunUrl,
          headers,
          requestBody: formData,
          signal: controller.signal,
          onChunk: (chunk: RunResponse) => {
            // ... (保持现有 onChunk 完全不变)
```

- [ ] **Step 3: `onError` 区分主动中断**

把 `streamResponse` 的 `onError`(约 472–492 行)开头加一个 manual 短路。修改后的 `onError`:

```ts
          onError: (error) => {
            // 用户主动停止:stopStreaming 已完成收尾(标记 stopped / setIsStreaming(false)),
            // 这里静默,不走红色错误路径。
            if (abortRef.current.manual) return

            updateMessagesWithErrorState()
            // A 401 from the run endpoint means the JWT expired
            // mid-stream: the token was already cleared inside
            // useAIResponseStream (useStore.getState().logout()), so
            // here we only redirect to /login. Other errors keep the
            // existing readable-message behavior.
            if ((error as Error & { status?: number }).status === 401) {
              router.replace('/login')
            } else {
              setStreamingErrorMessage(error.message)
            }
            if (newSessionId) {
              setSessionsData(
                (prevSessionsData) =>
                  prevSessionsData?.filter(
                    (session) => session.session_id !== newSessionId
                  ) ?? null
              )
            }
          },
```

- [ ] **Step 4: 新增 `stopStreaming` 并加入返回值**

在 `handleStreamResponse` 的 `useCallback` 之后(约第 534 行 `]` 之后、`return` 之前)加:

```ts
  const stopStreaming = useCallback(() => {
    const ref = abortRef.current
    if (!ref.controller) return
    ref.manual = true
    ref.controller.abort()
    // 标记最后一条 agent 消息为「已停止」(保留已生成的部分内容)。
    setMessages((prevMessages) => {
      if (prevMessages.length === 0) return prevMessages
      const lastMessage = prevMessages[prevMessages.length - 1]
      if (!lastMessage || lastMessage.role !== 'agent') return prevMessages
      const next = [...prevMessages]
      next[next.length - 1] = { ...lastMessage, stopped: true }
      return next
    })
    setIsStreaming(false)
    useStore.getState().setWritingChapterOrder(null)
  }, [setMessages, setIsStreaming])
```

把 hook 的返回值(最后一行)改为:

```ts
  return { handleStreamResponse, stopStreaming }
```

- [ ] **Step 5: 跑 typecheck + lint**

Run: `pnpm --dir agent-ui typecheck && pnpm --dir agent-ui lint`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add agent-ui/src/hooks/useAIStreamHandler.tsx
git commit -m "feat(agent-ui): add stopStreaming + abort-aware onError in useAIStreamHandler"
```

---

## Task 7: 前端 — `ChatInput` 按钮按 `isStreaming` 分支(send ↔ stop + loading 脉冲)

**Files:**
- Modify: `agent-ui/src/components/chat/ChatArea/ChatInput/ChatInput.tsx`

- [ ] **Step 1: 解构 `stopStreaming`,按钮分支**

把整个 `agent-ui/src/components/chat/ChatArea/ChatInput/ChatInput.tsx` 替换为:

```tsx
'use client'
import { useState } from 'react'
import { toast } from 'sonner'
import { TextArea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { useStore } from '@/store'
import useAIChatStreamHandler from '@/hooks/useAIStreamHandler'
import { useQueryState } from 'nuqs'
import Icon from '@/components/ui/icon'

const ChatInput = () => {
  const { chatInputRef } = useStore()

  const { handleStreamResponse, stopStreaming } = useAIChatStreamHandler()
  const [selectedAgent] = useQueryState('agent')
  const [teamId] = useQueryState('team')
  const [inputMessage, setInputMessage] = useState('')
  const isStreaming = useStore((state) => state.isStreaming)
  const handleSubmit = async () => {
    if (!inputMessage.trim()) return

    const currentMessage = inputMessage
    setInputMessage('')

    try {
      await handleStreamResponse(currentMessage)
    } catch (error) {
      toast.error(
        `Error in handleSubmit: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  return (
    <div className="relative mx-auto mb-1 flex w-full max-w-2xl items-end justify-center gap-x-2 font-geist">
      <TextArea
        placeholder={'Ask anything'}
        value={inputMessage}
        onChange={(e) => setInputMessage(e.target.value)}
        onKeyDown={(e) => {
          if (
            e.key === 'Enter' &&
            !e.nativeEvent.isComposing &&
            !e.shiftKey &&
            !isStreaming
          ) {
            e.preventDefault()
            handleSubmit()
          }
        }}
        className="w-full border border-accent bg-primaryAccent px-4 text-sm text-primary focus:border-accent"
        disabled={!(selectedAgent || teamId)}
        ref={chatInputRef}
      />
      {isStreaming ? (
        <Button
          onClick={stopStreaming}
          size="icon"
          className="rounded-xl bg-primary p-5 text-primaryAccent"
          title="停止生成"
        >
          {/* loading 脉冲:方块图标外一圈呼吸光环,表示正在输出 */}
          <span className="relative flex h-5 w-5 items-center justify-center">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primaryAccent opacity-60" />
            <Icon type="square" color="primaryAccent" />
          </span>
        </Button>
      ) : (
        <Button
          onClick={handleSubmit}
          disabled={!(selectedAgent || teamId) || !inputMessage.trim()}
          size="icon"
          className="rounded-xl bg-primary p-5 text-primaryAccent"
        >
          <Icon type="send" color="primaryAccent" />
        </Button>
      )}
    </div>
  )
}

export default ChatInput
```

- [ ] **Step 2: 跑 typecheck + lint**

Run: `pnpm --dir agent-ui typecheck && pnpm --dir agent-ui lint`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add agent-ui/src/components/chat/ChatArea/ChatInput/ChatInput.tsx
git commit -m "feat(agent-ui): streaming send button morphs into stop button"
```

---

## Task 8: 前端 — `MessageItem` 显示「已停止」徽章

**Files:**
- Modify: `agent-ui/src/components/chat/ChatArea/Messages/MessageItem.tsx:73-85`

- [ ] **Step 1: 在 `AgentMessage` 的 return 里加徽章**

把 `MessageItem.tsx` 里 `AgentMessage` 的 return 块(第 73–85 行)替换为:

```tsx
  return (
    <ActivitiesContext.Provider value={message.activities ?? null}>
      <div className="flex flex-row items-start gap-4 font-geist">
        <div className="flex-shrink-0">
          <Icon type="agent" size="sm" />
        </div>
        <div className="flex w-full flex-col gap-2">
          {messageContent}
          {message.stopped && !message.streamingError && (
            <span className="w-fit rounded-md bg-accent px-2 py-0.5 text-xs text-muted">
              已停止
            </span>
          )}
          {message.memory && <MemoryBubble memory={message.memory} />}
        </div>
      </div>
    </ActivitiesContext.Provider>
  )
```

(徽章用 `bg-accent`(#27272A)+ `text-muted`(#A1A1AA)的灰色,视觉上区别于 `streamingError` 走的红色 `text-destructive`。`!message.streamingError` 防御错误与停止叠加。)

- [ ] **Step 2: 跑 typecheck + lint**

Run: `pnpm --dir agent-ui typecheck && pnpm --dir agent-ui lint`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add agent-ui/src/components/chat/ChatArea/Messages/MessageItem.tsx
git commit -m "feat(agent-ui): show 已停止 badge on stopped agent messages"
```

---

## Task 9: 端到端验证(前端 + 后端联调)

**Files:** 无改动,纯验证。

- [ ] **Step 1: 启动前后端**

Run(在 repo root,新开终端):`pnpm dev`
Expected: agent-ui 在 `:3000`、server 在 `:3001` 同时起来,无编译错误。

- [ ] **Step 2: 静态门禁全绿**

Run: `pnpm --dir agent-ui validate && pnpm --dir server typecheck && pnpm --dir server test`
Expected: 全 PASS。

- [ ] **Step 3: 手动验证「停止按钮」UI**

在浏览器 `http://localhost:3000` 登录 → 进一本小说的工作台(`/novels/[id]`)→ 在聊天框输入一条会**长时输出**的指令(例如「请写一段至少 800 字的开场,详细描写场景」)→ 点发送。验证:

1. 发送瞬间,发送按钮(纸飞机)变为**方块停止图标 + 外圈呼吸脉冲动画**(`animate-ping`)。
2. 流式输出进行中,聊天区持续出现正文。
3. 流式中**再次点击该按钮** → 流式立即停止,按钮变回发送图标。
4. 被中断的 agent 消息**保留已生成的部分正文**,下方出现灰色「已停止」徽章(非红色错误)。
5. 右侧 `ChapterPreview` 退出写作骨架态,回到正文态。

- [ ] **Step 4: 手动验证「后端真正停止」**

在 Task 3 的中断动作发生时,观察 server 终端日志,验证:

1. 中断后**不再**出现新的 `ActDelta` / 工具调用日志(LLM 与 `write_chapter` 被真正中止,而非后台跑完)。
2. 无 `ERR_STREAM_WRITE_AFTER_END` 未处理异常(`writeFrame` 防御生效)。

- [ ] **Step 5: 手动验证「正常错误仍走红色态」**

构造一个错误(例如临时把 server 停掉,或在 `.env` 清空 `ZHIPUAI_API_KEY` 后发消息)→ 验证 agent 消息仍显示**红色**错误态(`streamingError`),而非「已停止」徽章 —— 确认 `manual` 标志没有误吞真错误。

> 已知限制(见 spec §6):若中断恰好发生在 `write_chapter` 执行过程中,章节可能已被部分写入 DB(LangGraph 尽力中断,已提交的 append 保留)。Task 9 不验证此回滚(本次不做)。

---

## Self-Review(写完后自检)

- **Spec 覆盖**:spec §4.1 前端 6 项(useAIResponseStream signal / useAIStreamHandler abortRef+stopStreaming+onError / ChatMessage.stopped / ChatInput 分支 / icon square / MessageItem 徽章)→ Task 3–8 一一对应;spec §4.2 后端 3 项(controller @Req+close+防御 / service signal / appendTurn 现状不改)→ Task 1–2 覆盖;spec §3 目标行为 + §4.3 时序 → Task 9 端到端验证。无遗漏。
- **类型一致性**:`stopStreaming`(Task 6)与 ChatInput(Task 7)解构名一致;`signal` 从 controller(Task 1)→ runTurn args(Task 2)→ .stream options(Task 2)→ fetch(Task 5)链路一致;`stopped` 字段(Task 3 定义)被 stopStreaming(Task 6 写)与 MessageItem(Task 8 读)一致使用;`square` 图标(Task 4 注册)被 ChatInput(Task 7 使用)。
- **无 placeholder**:所有步骤含确切代码与命令。
