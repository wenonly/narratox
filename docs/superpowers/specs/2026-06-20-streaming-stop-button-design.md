# narratox 流式中断/停止按钮 — 设计文档

- 日期:2026-06-20
- 状态:已与用户确认,待 review
- 分支(建议):`feat/streaming-stop-button`
- 范围:为工作台/聊天发送按钮增加「流式中变为停止按钮(带 loading 脉冲)+ 点击中断本次 run」的能力。前端 abort fetch,后端监听连接断开并真正中止 LangGraph run(停掉 LLM 调用与 `write_chapter` 等工具)。中断后保留已生成的部分内容,并标记「已停止」(区别于红色错误态)。
- 前置:v0.4.0(统一 swarm + 工作台 UX 演进)已完成;流式链路 `ChatInput → useAIStreamHandler → useAIResponseStream → fetch`,wire format(`RunStarted` / `RunContent` 累积 / `RunCompleted` / `RunError`,以及 `Act*` 活动流)不变。

---

## 1. 背景与目标

当前流式输出有两个缺口:

1. **前端无中断机制** —— `ChatInput` 的发送按钮在 `isStreaming` 时直接 `disabled`(灰掉),没有任何「停止」入口;`useAIResponseStream` 的 `fetch` 没有传 `signal`,一旦开始流式就只能等服务器关闭连接。
2. **后端无取消能力** —— `agentos.controller` 的 run handler 没有监听 `req.on('close')`,LangGraph 的 `.stream()` 调用也没传 `signal`。结果:**即使客户端断开 fetch,后端 agent run 仍会在后台继续跑完** —— 继续消耗 token,继续执行 `write_chapter`,直至模型自然结束或 120s 超时。

**目标**:点击「停止」能真正中断 —— 前端停止显示,后端停止 LLM/工具执行;且提供清晰的视觉反馈(发送按钮 → 停止按钮 + loading)与中断后的内容处理(保留部分内容 + 「已停止」标记)。

**核心原则**:`AbortController` 的引用用 `useRef` 放在 `useAIStreamHandler` 内部,从该 hook 返回 `stopStreaming`,供 `ChatInput` 绑定 —— 不把命令式对象塞进 Zustand store(唯一调用方是 `ChatInput`,YAGNI)。

---

## 2. 现状(实现依据)

### 2.1 前端流式链路
- `ChatInput`([src/components/chat/ChatArea/ChatInput/ChatInput.tsx](agent-ui/src/components/chat/ChatArea/ChatInput/ChatInput.tsx)):发送按钮 `<Icon type="send" />`,`disabled` 条件含 `|| isStreaming`(第 60 行);`handleSubmit` 调 `handleStreamResponse`。该组件在 `ChatArea` 与 `workspace/ChatPanel` 两处复用。
- `useAIStreamHandler`([src/hooks/useAIStreamHandler.tsx](agent-ui/src/hooks/useAIStreamHandler.tsx)):`handleStreamResponse` 是流的发起者,`setIsStreaming(true)`(第 107 行,唯一置 true 处),`finally` 里 `setIsStreaming(false)`(第 510 行)。
- `useAIResponseStream`([src/hooks/useAIResponseStream.tsx](agent-ui/src/hooks/useAIResponseStream.tsx)):`streamResponse` 做 `fetch` + reader 循环 + JSON buffer 解析。**`fetch` 没有 `signal`(第 202-215 行),reader 循环无 break/abort 路径(第 255-270 行)**。
- store([src/store.ts](agent-ui/src/store.ts)):`isStreaming` 已存在;`logout`/`login` 会重置它。
- 图标注册([src/components/ui/icon/constants.tsx](agent-ui/src/components/ui/icon/constants.tsx)):无 `square`/`stop`/`pause` 图标,需新增。

### 2.2 后端 run handler
- `agentos.controller.ts`([server/src/agentos/agentos.controller.ts](server/src/agentos/agentos.controller.ts)):`POST /agents/:id/runs` 用 `@Res() res: Response` 写行分隔 JSON;**没有 `@Req()`,没有 `req.on('close')`/`res.on('close')`**。`emit` 闭包里 `res.write(...)` 无 socket 销毁防御。
- `deep-agent.service.ts`([server/src/agentos/deep-agent.service.ts](server/src/agentos/deep-agent.service.ts)):`runTurn` 里 `agent.stream({ messages }, { configurable: { thread_id }, streamMode: 'messages' })`(约第 213-216 行)。**options 没有 `signal`**。`for await (const chunk of stream)` 循环无取消检查。
- checkpointer(`PostgresSaver`,`agent_memory` schema)只是持久化层,不参与取消。
- 结论:**客户端断开 → `res.write` 开始抛 `ERR_STREAM_WRITE_AFTER_END` → 被 catch → 但 `for await` 循环不知道 socket 关了,LangGraph stream + 底层 GLM HTTP 调用继续跑到自然结束**。

### 2.3 后端协议
`RunEvent` 里已定义 `RunCancelled` / `RunPaused` / `RunContinued`([src/types/os.ts](agent-ui/src/types/os.ts)),但前端除把 `TeamRunCancelled` 当作终态错误处理外,没有用到暂停/取消语义。本次**不引入新的 wire format** —— 中断靠 HTTP 连接层(abort + socket close),复用现有 `RunError`/流自然结束路径。

---

## 3. 目标行为

- **空闲(非流式中)**:发送按钮(纸飞机图标)→ 点击发送。*(现状)*
- **流式中**:发送按钮变为 **停止按钮**(实心方块 `Square` 图标)+ **loading 脉冲动画**(表示正在输出)→ 点击中断本次 run。
- **中断后**:已流式出来的部分 agent 消息**保留**,标记「已停止」(灰色徽章,区别于红色 `streamingError`);`isStreaming` → false;`ChapterPreview` 退出写作骨架态。
- **前端↔后端联动**:客户端 `AbortController` 中断 fetch → 服务端 `req.on('close')` 触发自己的 `AbortController.abort()` → 该 `signal` 传进 LangGraph `.stream()`,真正取消 GLM 调用与工具执行。

---

## 4. 设计

### 4.1 前端改动(`agent-ui`)

**4.1.1 `useAIResponseStream.tsx`**
- `streamResponse` 的 options 增加可选 `signal?: AbortSignal`,直接传进 `fetch(url, { ..., signal })`。
- reader 抛出的 `AbortError` 仍会走到 `catch → onError`(由调用方区分主动中断 vs 真错误);本层不特殊处理。

**4.1.2 `useAIStreamHandler.tsx`(核心接缝)**
- 增加 `const abortRef = useRef<{ controller: AbortController | null; manual: boolean }>({ controller: null, manual: false })`。
- `handleStreamResponse` 开始处:新建 `const controller = new AbortController()`,`abortRef.current = { controller, manual: false }`,把 `controller.signal` 传给 `streamResponse({ signal, ... })`。
- 新增返回方法 **`stopStreaming()`**:
  - `abortRef.current.manual = true`
  - `abortRef.current.controller?.abort()`
  - 把最后一条 agent 消息标记 `stopped: true`(若该消息存在且 `role === 'agent'`)
  - 收尾与 `finally` 一致:`setIsStreaming(false)`、`setWritingChapterOrder(null)`
- `onError`:若 `error.name === 'AbortError' && abortRef.current.manual` → **静默**(`stopStreaming` 已收尾,不显示红色错误、不 `updateMessagesWithErrorState`);否则维持现有错误处理。
- hook 返回值由 `{ handleStreamResponse }` 改为 `{ handleStreamResponse, stopStreaming }`。
- `finally` 已有 `setIsStreaming(false)`;`stopStreaming` 也调一次,幂等无妨。

**4.1.3 `store.ts` + `types/os.ts`**
- `ChatMessage` 增加可选字段 `stopped?: boolean`。
- **store 不持有 controller**(保持声明式);`isStreaming` 已够用。

**4.1.4 `ChatInput.tsx`**
- 从 `useAIChatStreamHandler()` 解构出 `stopStreaming`。
- 按钮按 `isStreaming` 分支:
  - 流式中 → 停止按钮,`onClick={stopStreaming}`,`disabled` 条件去掉 `|| isStreaming`(停止按钮始终可点)。
  - 空闲 → 现有发送按钮(`disabled` = `!(selectedAgent || teamId) || !inputMessage.trim()`)。
- 图标:流式中用 `<Icon type="square" color="primaryAccent" />`。
- loading 脉冲:停止按钮加 Tailwind 动画(如 `animate-pulse`,或外圈呼吸光环 keyframe),表达「运行中」。
- 输入框流式中仍可打字(现状);Enter 提交仍受 `!isStreaming` 守卫(现状,不改)。

**4.1.5 图标注册 `constants.tsx`**
- 注册 `square` → lucide `Square`。(选实心方块 —— ChatGPT/Claude 通用的「停止生成」图标;本中断不可恢复,stop 语义比 pause ❚❚ 更准确。)

**4.1.6 消息渲染(`MessageArea` / 消息气泡组件)**
- 对 `message.stopped === true` 的 agent 消息,渲染一个**灰色**「已停止」徽章,视觉上明显区别于红色的 `streamingError` 标记。

### 4.2 后端改动(`server`)

**4.2.1 `agentos.controller.ts`**
- run handler 增加 `@Req() req: Request`(Express)。
- `const ac = new AbortController(); req.on('close', () => ac.abort());`(连接断开 → 中止 LangGraph stream)。
- 把 `ac.signal` 透传进 `runTurn`/`runAgent`。
- `emit` 闭包里 `res.write(...)` 加防御:`if (res.writableEnded || res.destroyed) return;`(避免 socket 关闭后 write 抛错)。

**4.2.2 `deep-agent.service.ts`**
- `runTurn` 签名增加 `signal?: AbortSignal`,传入 `agent.stream(input, { configurable: { thread_id }, streamMode: 'messages', signal })`。
- LangGraph 会把 signal 透传给模型调用 + 工具执行,从而真正 abort 底层 GLM HTTP 请求与 `write_chapter` 执行。

**4.2.3 abort 时的收尾**
- `for await (const chunk of stream)` 抛 `AbortError` → 进入 `catch`(write 已防御,不产生 write-after-end)→ `finally` `res.end()`。
- `appendTurn`:现状仅在 turn 到达 `completed` 时才持久化聊天历史。abort 时 turn 未完成,`appendTurn` 自然不触发 —— **无需新增任何阻止逻辑**(保持现状即可;聊天历史不落库,不影响章节)。

### 4.3 中断时序

1. 用户点停止 → `ChatInput.stopStreaming()` → `controller.abort()` + 标记消息 `stopped` + `setIsStreaming(false)`。
2. fetch 因 `signal` 被 reject(`AbortError`)→ `useAIResponseStream` 的 `catch` → `onError(AbortError)`。
3. `onError` 判定为 `manual` 的 `AbortError` → 静默(不显示红色错误)。
4. 同时服务端:客户端 socket 关闭 → `req.on('close')` → `ac.abort()` → LangGraph stream 抛错 → `for await` 结束 → LLM/工具调用停止。
5. `isStreaming` 由 true→false → `ChatPanel` 的 turn-end 订阅触发 `onAccepted()`(刷新小说/章节面板,反映已写入的部分);`Sessions` 的加载守卫恢复。

---

## 5. 范围与非目标

**做**:
- 发送按钮 → 停止按钮(square 图标 + loading 脉冲)+ 点击中断。
- 前端 `AbortController` + 后端 `req.on('close')` + LangGraph `.stream(signal)` 真正中止 run。
- 中断后保留部分内容 + 「已停止」灰色徽章(区别于红色错误)。
- `ChatMessage.stopped` 字段;`useAIResponseStream` 支持 `signal`。

**不做(非目标)**:
- 「继续生成」/ resume(中断不可恢复)。
- 显式的服务端取消端点(如 `POST .../runs/:runId/cancel`);本次靠 HTTP 连接层 abort,不新增 wire format。
- 章节回滚:中断发生在 `write_chapter` 执行中时,已提交的 append 可能部分留在 DB(见限制)。
- `RunPaused`/`RunContinued` 协议字段的启用(本次不用)。

---

## 6. 已知限制

- **`write_chapter` 中途中断**:若 abort 恰好发生在 `write_chapter` 工具执行过程中,章节可能已被部分写入 `Chapter` 表。LangGraph 的 signal 会尽力中断工具执行,但**已提交的 append 会保留** —— 本次不做章节回滚。UI 上 `ChapterPreview` 在 turn-end refresh 后会显示已写入的部分。
- **并发限制**:`abortRef` 只记录最近一次的 controller;若用户极快连点(理论上一次只能有一个 run,因 `isStreaming` 期间发送被禁用),不存在并发问题。

---

## 7. 风险

- **后端 signal 透传是否真正停掉 GLM**:依赖 LangGraph 把 `signal` 传到底层 `@langchain/openai` 的 `ChatOpenAI` 调用。需在实现后用一个长回复 + 中断实测验证:确认日志里 GLM 请求被 abort、不再继续 `write_chapter`。若发现工具/模型未响应 signal,作为已知限制记录(至少前端已停显示,且后端不再 write 到已关闭 socket)。
- **`res.write` 防御的边界**:`writableEnded || destroyed` 检查需覆盖 `emit` 与 `catch` 里所有 write 点,否则中断瞬间可能抛 `ERR_STREAM_WRITE_AFTER_END`。
- **「已停止」徽章的渲染位置**:`MessageArea`/消息气泡组件需精确定位(实现时确认组件路径),确保 `stopped` 与 `streamingError` 两态视觉清晰区分。

---

## 8. 涉及文件

前端(`agent-ui`):
- [src/hooks/useAIResponseStream.tsx](agent-ui/src/hooks/useAIResponseStream.tsx) — `streamResponse` 加 `signal`
- [src/hooks/useAIStreamHandler.tsx](agent-ui/src/hooks/useAIStreamHandler.tsx) — `abortRef` + `stopStreaming` + `onError` 区分
- [src/components/chat/ChatArea/ChatInput/ChatInput.tsx](agent-ui/src/components/chat/ChatArea/ChatInput/ChatInput.tsx) — 按钮分支
- [src/store.ts](agent-ui/src/store.ts) — 无需改 controller(`isStreaming` 已有)
- [src/types/os.ts](agent-ui/src/types/os.ts) — `ChatMessage.stopped`
- [src/components/ui/icon/constants.tsx](agent-ui/src/components/ui/icon/constants.tsx) — 注册 `square`
- 消息渲染组件(`MessageArea`/气泡) — 「已停止」徽章(实现时定位)

后端(`server`):
- [src/agentos/agentos.controller.ts](server/src/agentos/agentos.controller.ts) — `@Req()` + `req.on('close')` + `AbortController` + `res.write` 防御
- [src/agentos/deep-agent.service.ts](server/src/agentos/deep-agent.service.ts) — `runTurn` 透传 `signal` 到 `.stream()`

---

## 9. 参考
- v0.4.0 spec/plan(统一 swarm + 工作台 UX,流式链路与 wire format 基础):[2026-06-18-workspace-evolution-design.md](2026-06-18-workspace-evolution-design.md)。
- LangGraph `.stream()` 的 `signal` 选项(AbortSignal 透传至模型调用与工具执行)。
