# Agent UI ↔ Server 流式对接（第一阶段）

> 日期：2026-06-16
> 范围：仅第一阶段——让 `agent-ui` 能通过流式接口调用 `server` 的 DeepAgent，实现一问一答的对话。
> 不在本阶段范围：多用户、会话持久化、工具/子 Agent、小说写作语义。这些各自后续单独设计。

## 1. 背景与目标

`agent-ui`（Next.js + Agno "Agent UI" 模板）原本连接外部 AgentOS（默认 `http://localhost:7777`）。
目标是在 `server`（NestJS）里用 DeepAgent 提供一个**最小兼容 AgentOS 流式协议**的代理服务，使 UI 几乎不改代码即可对接到 server。

最终愿景（远期，不在本 spec 内）：一个微博式网站，多用户 + 多 Agent 协作写一部小说，复用本 UI 样式。
本阶段只是这条路上的第一块基石：**把流式管道打通**。

### 已确认的决策

| 决策项 | 结论 |
|---|---|
| LLM Provider | 智谱 GLM（OpenAI 兼容协议），`@langchain/openai` 的 `ChatOpenAI` + 智谱 baseURL |
| Agent 复杂度 | 纯对话，无 tools、无 subagents |
| 会话历史 | `session_id` 仅作占位，不维护跨轮上下文（每次新对话无状态） |
| 流式传输机制 | 方案 A：Express 裸 JSON 行流式 `res.write()`（非 `@Sse()`） |

## 2. Agent UI 现有接口盘点与本阶段取舍

UI 实际调用的接口（来自 `agent-ui/src/api/routes.ts`、`os.ts` 及 hooks）：

| 接口 | 方法 | 本阶段处理 |
|---|---|---|
| `/health` | GET | **实现**（200 即激活） |
| `/agents` | GET | **实现**（返回一个写死的 agent） |
| `/agents/{id}/runs` | POST (FormData) | **实现**（核心流式入口） |
| `/sessions`、`/sessions/{id}/runs`、`/sessions/{id}` (DELETE) | GET/DELETE | 不实现（不报错即可，UI 容忍空） |
| `/teams` 系列 | GET/POST | 不实现（`mode` 默认 `'agent'`，不走 team 分支） |

**最小可用集合 = `/health` + `/agents` + `/agents/:id/runs` 这三个。**

## 3. 架构与模块布局

在 `server/src/` 下**新建独立 module `agentos`**，不动现有 `agent/` CRUD scaffold。

```
server/src/
├── main.ts                  # enableCors()；不加全局前缀
├── app.module.ts            # 注册 AgentosModule
├── agent/                   # 原有 scaffold，保持不动
└── agentos/
    ├── agentos.module.ts    # 装配 controller + service
    ├── agentos.controller.ts# 三路由：/health、/agents、/agents/:id/runs
    ├── deep-agent.service.ts# 持有 createDeepAgent 单例；暴露消息流
    ├── stream-adapter.ts    # 格式适配：DeepAgent token → RunResponseContent 帧
    └── agentos.constants.ts # 写死 agent 列表、系统提示词
```

职责切分（单一目的、可独立理解/测试）：

- **AgentosController**：只管 HTTP——解析 FormData、`@Res()` 注入、调 service、管 `res` 生命周期（try/catch/finally）。无业务逻辑。
- **DeepAgentService**：只管 DeepAgent 实例——init 时 `createDeepAgent`（GLM + 系统提示词），暴露把消息喂进去并返回 token 异步流的方法。不碰 HTTP。
- **StreamAdapter**：只管格式翻译——消费 token 流，维护"累积全文"缓冲，产出 `RunResponseContent` 对象序列（`RunStarted → RunContent×N → RunCompleted`）。不碰 HTTP、不碰 DeepAgent。

出问题时可分别定位"模型没通 / 翻译没对 / HTTP 没写对"。

## 4. 接口契约（AgentOS 兼容）

三个路由全部挂根路径，**不加全局前缀**（否则 `/agents`、`/health` 对不上 UI 调用）。

### ① `GET /health`
- 请求：无 body / query。
- 响应：`200 {}`。UI 的 `getStatusAPI` 只看 `status === 200` 判定 endpoint 激活（`agent-ui/src/api/os.ts:42`、`useChatActions.ts:26`）。**必须 200。**

### ② `GET /agents`
- 响应：`200` 一个数组，**至少一个元素**。UI 的 `initialize()` 需要拿到 agent 才能自动选中、发送按钮才有目标（`useChatActions.ts:96`）。
- 形态（对齐 `AgentDetails`，`agent-ui/src/types/os.ts:214`）：
  ```json
  [{ "id": "deep-agent", "name": "Deep Agent", "db_id": "default" }]
  ```
  `db_id` 给固定非空串（UI 会放进 `?db_id=`，本阶段不持久化，值无所谓但须非空）。`model` 可选，省略不影响。

### ③ `POST /agents/:id/runs`（核心流式入口）
- **请求**：`multipart/form-data`（UI 用 FormData，`useAIStreamHandler.ts:106`）。字段：
  - `message`（string，必填）—— 用户输入
  - `stream`（`"true"`）—— UI 固定带，忽略（永远流式）
  - `session_id`（string，可能为 `""`）—— 本阶段忽略语义，仅用于回传占位
  - `Authorization: Bearer <token>`（有 token 时带）—— 本阶段**不校验**，忽略。
- **响应**：`Content-Type: application/json`（UI 不检查此头，只 parse body）。body 为**换行/拼接分隔的 JSON 对象流**，三段（`created_at` 秒级，与 UI 的 `Math.floor(Date.now()/1000)` 对齐）：

  ```
  {"event":"RunStarted","agent_id":"deep-agent","session_id":"<新uuid>","created_at":1718500000}
  {"event":"RunContent","content":"<累积全文>","created_at":1718500000}
  {"event":"RunContent","content":"<更长一点的累积全文>","created_at":1718500000}
  ...
  {"event":"RunCompleted","content":"<最终全文>","created_at":1718500000}
  ```

- **`RunContent.content` 必须是"累积全文"而非增量**。这是最易踩的坑：UI 用 `chunk.content.replace(lastContent, '')` 去重（`useAIStreamHandler.ts:233`）。发增量会让 `replace` 误删后续文本。`StreamAdapter` 内部维护 `accumulated`，每次 `accumulated += delta` 后**整体**推出。
- **`RunStarted` 必须最先发**——它带 `session_id`，UI 靠它建立会话身份（`useAIStreamHandler.ts:183`）。
- **`session_id` 回传**：忽略 UI 传入值，每次 `randomUUID()` 生成新值塞进 `RunStarted.session_id`（对应"占位"决策）。
- **错误**：DeepAgent 抛错 → 发一帧 `{"event":"RunError","content":"<错误信息>","created_at":...}` 再 `res.end()`。UI 会把最后一条 agent 消息标 `streamingError` 并提示（`useAIStreamHandler.ts:326`）。
  若错误发生在能开始写流之前（如模型实例化失败）→ 退化为普通 `500 {"detail":"..."}`（UI 的 catch 认 `detail`，`useAIResponseStream.tsx:245`）。

## 5. 实现要点

### DeepAgent + GLM
- `server` 新增依赖：`deepagents`、`@langchain/openai`、`langchain`。
- `DeepAgentService`：`new ChatOpenAI({ baseURL: 'https://open.bigmodel.cn/api/paas/v4', modelName:'glm-4-plus', apiKey: process.env.ZHIPUAI_API_KEY })`，`createDeepAgent({ systemPrompt })`，纯对话，无 tools/subagents。

### 流式分帧
- `agent.stream({ messages:[{role:'user', content: message}] }, { streamMode:'messages' })`。
- 每个 chunk 取 `chunk[0].text`（增量 delta）→ `accumulated += delta` → 包成 `RunContent` 帧推。
- 迭代前推 `RunStarted`；迭代结束后推 `RunCompleted`；迭代中抛错推 `RunError`。

### CORS / 传输
- `main.ts`：`app.enableCors()`（3000→3001 跨域必须）；不加全局前缀。
- `POST /agents/:id/runs` 用 `@Res() res` 注入，`res.write(JSON.stringify(frame) + '\n')` 逐帧推送；`res.end()` 结束。返回类型用 `void` 以关闭 Nest 默认响应处理。
- `/health`、`/agents` 走 Nest 正常 `@Get` + 返回值即可。

### agent-ui 改动（仅一处）
- `agent-ui/src/store.ts:84`：`selectedEndpoint` 默认值 `'http://localhost:7777'` → `'http://localhost:3001'`。
- 其余 UI 代码（流解析 `useAIResponseStream`、消息渲染、hook 逻辑）**完全不动**。

### 配置
- `server/.env`：`ZHIPUAI_API_KEY=...`，可选 `PORT=3001`（`dev:server` 已固定 3001）。
- 启动时校验 `ZHIPUAI_API_KEY` 存在，缺失则抛错退出。

## 6. 测试

- **单元（`pnpm test`）**：
  - `StreamAdapter`：mock 一段 token 流，断言产出的帧序列正确（`RunStarted` 在前、`RunCompleted` 收尾、`RunContent.content` 为累积全文而非增量）。
  - `DeepAgentService`：mock LangChain，断言以正确参数调用 stream（模型、消息内容）。
- **e2e**：本阶段不做。
- **手动验证（验收标准）**：root `pnpm dev` 起两个进程（agent-ui :3000、server :3001），UI 选 agent、发"你好"，看到**流式逐字打字**回复即通过。若失败，按"模型没通 / 翻译没对 / HTTP 没写对"三层定位。

## 7. 不在本阶段范围（YAGNI）

- 工具、子 Agent、reasoning 事件、tool_call 渲染。
- 会话历史持久化、`/sessions` 系列接口。
- 多用户、鉴权、`Authorization` 校验。
- 小说写作语义（角色/续写等业务逻辑）。
- `mode==='team'` 分支。

这些留给后续各自独立的设计周期。
