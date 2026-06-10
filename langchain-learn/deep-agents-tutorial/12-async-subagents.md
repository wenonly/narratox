# 异步子代理 - Async Subagents

> 原文地址: https://docs.langchain.com/oss/javascript/deepagents/async-subagents

## 概述

异步子代理让主管 Agent 可以启动后台任务并立即返回，这样主管 Agent 可以继续与用户交互，同时子代理并发工作。主管 Agent 可以随时检查进度、发送后续指令或取消任务。

本章节建立在同步子代理的基础上。当任务是长时间运行的、可并行化的、或需要中途调整时，使用异步子代理。

---

## 同步 vs 异步子代理对比

| 维度 | 同步子代理 | 异步子代理 |
| --- | --- | --- |
| **执行模型** | 主管阻塞直到子代理完成 | 立即返回任务 ID，主管继续运行 |
| **并发** | 并行但阻塞 | 并行且非阻塞 |
| **中途更新** | 不支持 | 通过 `update_async_task` 发送后续指令 |
| **取消** | 不支持 | 通过 `cancel_async_task` 取消运行中的任务 |
| **状态性** | 无状态——调用之间无持久状态 | 有状态——在自己的线程上跨交互维护状态 |
| **最佳场景** | Agent 需要等待结果后再继续 | 长时间运行的复杂任务，在聊天中交互式管理 |

---

## 配置异步子代理

将异步子代理定义为 `AsyncSubAgent` 规范列表，每个规范指向一个 Agent Protocol 服务器：

```typescript
import { createDeepAgent, AsyncSubAgent } from "deepagents";

const asyncSubagents: AsyncSubAgent[] = [
  {
    name: "researcher",
    description: "Research agent for information gathering and synthesis",
    graphId: "researcher",
    // 没有 url -> ASGI 传输（在同一部署中共同部署）
  },
  {
    name: "coder",
    description: "Coding agent for code generation and review",
    graphId: "coder",
    // url: "https://coder-deployment.langsmith.dev"  // 可选：HTTP 传输用于远程
  },
];

const agent = createDeepAgent({
  model: "google_genai:gemini-3.5-flash",
  subagents: [...asyncSubagents],
});
```

### 字段说明

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `name` | `string` | 必需。唯一标识符，主管启动任务时使用 |
| `description` | `string` | 必需。描述子代理的功能，主管据此决定委派给哪个代理 |
| `graphId` | `string` | 必需。Agent Protocol 服务器上的图 ID（或助手 ID） |
| `url` | `string` | 可选。省略时使用 ASGI 传输（进程内）；设置时使用 HTTP 传输到远程服务器 |
| `headers` | `Record<string, string>` | 可选。发送到远程服务器的额外请求头，用于自定义认证 |

### 共同部署配置

对于基于 LangGraph 的部署，在同一个 `langgraph.json` 中注册所有图：

```json
{
  "graphs": {
    "supervisor": "./src/supervisor.py:graph",
    "researcher": "./src/researcher.py:graph",
    "coder": "./src/coder.py:graph"
  }
}
```

---

## 提供的工具

`AsyncSubAgentMiddleware` 为主管 Agent 提供五个工具：

| 工具 | 用途 | 返回值 |
| --- | --- | --- |
| `start_async_task` | 启动新的后台任务 | 任务 ID（立即返回） |
| `check_async_task` | 获取任务的当前状态和结果 | 状态 + 结果（如果已完成） |
| `update_async_task` | 向运行中的任务发送新指令 | 确认 + 更新后的状态 |
| `cancel_async_task` | 停止运行中的任务 | 确认 |
| `list_async_tasks` | 列出所有跟踪的任务及其状态 | 所有任务的摘要 |

---

## 理解生命周期

典型的交互遵循以下序列：

1. **启动（Launch）**：在服务器上创建新线程，使用任务描述作为输入启动运行，返回线程 ID 作为任务 ID。主管向用户报告此 ID，**不会**轮询完成状态。
2. **检查（Check）**：获取当前运行状态。如果运行成功，检索线程状态以提取子代理的最终输出。如果仍在运行，向用户报告。
3. **更新（Update）**：在同一线程上创建新运行，使用中断多任务策略。前一次运行被中断，子代理以完整对话历史加上新指令重新启动。任务 ID 保持不变。
4. **取消（Cancel）**：在服务器上调用 `runs.cancel()` 并将任务标记为 `"cancelled"`。
5. **列出（List）**：遍历所有跟踪的任务。对于非终止任务，并行从服务器获取实时状态。终止状态（`success`、`error`、`cancelled`）从缓存返回。

---

## 状态管理

任务元数据存储在主管图上的专用状态通道（`asyncTasks`）中，与消息历史**分离**。这一点很关键，因为 Deep Agents 在上下文窗口填满时会压缩消息历史。如果任务 ID 仅存在于工具消息中，它们会在压缩过程中丢失。专用通道确保主管始终可以通过 `list_async_tasks` 回忆其任务，即使经过多轮摘要。

每个跟踪的任务记录：任务 ID、代理名称、线程 ID、运行 ID、状态和时间戳（`createdAt`、`checkedAt`、`updatedAt`）。

---

## 选择传输方式

### ASGI 传输（共同部署）

当子代理规范省略 `url` 字段时，LangGraph SDK 使用 ASGI 传输——SDK 调用通过进程内函数调用而非 HTTP 进行路由。

- 消除网络延迟
- 不需要额外的认证配置
- 子代理仍然作为独立线程运行，拥有自己的状态
- **推荐的默认方式**

### HTTP 传输（远程）

添加 `url` 字段切换到 HTTP 传输：

```typescript
{
  name: "researcher",
  description: "Research agent",
  graphId: "researcher",
  url: "https://my-research-deployment.langsmith.dev",
}
```

对于 LangGraph 部署，认证通过 `LANGSMITH_API_KEY`（或 `LANGGRAPH_API_KEY`）环境变量由 LangGraph SDK 自动处理。

**何时使用：** 子代理需要独立扩展、不同的资源配置、或由不同团队维护。

---

## 部署拓扑

### 单一部署

所有代理共同部署在同一服务器上，使用 ASGI 传输。在同一个 `langgraph.json` 中注册所有图。这是推荐的起始方式——一台服务器管理，代理间零网络延迟。

### 分离部署

主管在一个服务器上，子代理通过 HTTP 传输在另一个服务器上。适用于子代理需要不同计算配置或独立扩展的场景。

### 混合部署

部分子代理通过 ASGI 共同部署，其他通过 HTTP 远程部署：

```typescript
const asyncSubagents: AsyncSubAgent[] = [
  {
    name: "researcher",
    description: "Research agent",
    graphId: "researcher",
    // 没有 url -> ASGI（共同部署）
  },
  {
    name: "coder",
    description: "Coding agent",
    graphId: "coder",
    url: "https://coder-deployment.langsmith.dev",
    // 有 url -> HTTP（远程）
  },
];
```

---

## 最佳实践

### 调整工作线程池

本地开发时使用 `langgraph dev`，增加工作线程池以适应并发的子代理运行：

```bash
langgraph dev --n-jobs-per-worker 10
```

每个活跃运行占用一个工作线程槽位。拥有 3 个并发子代理任务的主管需要 4 个槽位（1 个主管 + 3 个子代理）。

### 编写清晰的子代理描述

主管使用描述来决定启动哪个子代理：

```typescript
// 好的描述
{
  name: "researcher",
  description: "Conducts in-depth research using web search. Use for questions requiring multiple searches and synthesis.",
  graphId: "researcher",
}

// 差的描述
{
  name: "helper",
  description: "helps with stuff",
  graphId: "helper",
}
```

### 使用线程 ID 追踪

每个异步子代理运行都是一个标准的 LangGraph 运行，在 LangSmith 中完全可见。主管的追踪显示 `launch`、`check`、`update`、`cancel` 和 `list` 的工具调用。每个子代理运行作为单独的追踪出现，通过线程 ID 关联。

---

## 故障排除

### 主管启动后立即轮询

**问题：** 主管在启动后立即循环调用 `check`，将异步执行变成阻塞式。

**解决方案：** 中间件会注入系统提示规则来防止此行为。如果轮询持续，在系统提示中强化此行为：

```typescript
const agent = createDeepAgent({
  model: "google_genai:gemini-3.5-flash",
  systemPrompt: `...your instructions...

    After launching an async subagent, ALWAYS return control to the user.
    Never call check_async_task immediately after launch.`,
  subagents: [...asyncSubagents],
});
```

### 主管报告过时状态

**问题：** 主管引用对话历史中较早的任务状态，而不是进行新的 `check` 调用。

**解决方案：** 中间件提示指示模型"对话历史中的任务状态总是过时的"。如果仍然发生，添加明确的指令始终在报告状态前调用 `check` 或 `list`。

### 任务 ID 查找失败

**问题：** 主管截断或重新格式化任务 ID，导致 `check` 或 `cancel` 失败。

**解决方案：** 中间件提示指示模型始终使用完整的任务 ID。如果截断持续发生，这通常是模型特定的问题——尝试不同的模型或在系统提示中添加"始终显示完整的 task_id，永远不要截断或缩写它"。

### 子代理启动排队而非运行

**问题：** 启动子代理挂起或需要很长时间才能开始。

**解决方案：** 工作线程池可能已耗尽。使用 `--n-jobs-per-worker` 增加池大小。

---

## 小结

- 异步子代理支持非阻塞的并发后台任务执行
- 主管获得五个工具来管理异步任务：启动、检查、更新、取消、列出
- 任务状态存储在专用通道中，即使消息历史被压缩也不会丢失
- ASGI 传输（共同部署）是推荐的默认方式，HTTP 传输用于远程部署
- 编写清晰的子代理描述对于正确的任务委派至关重要
- 避免主管在启动后立即轮询，确保真正的异步行为
