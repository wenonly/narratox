# 投入生产 - Going to Production

## 概述

本指南涵盖了将深度智能体从本地原型推向生产部署的各项考虑事项，包括记忆范围、执行环境配置、安全防护（Guardrails）以及前端连接。

## 生产环境概述

智能体使用来自记忆和执行环境的信息来完成任务。在生产环境中，有几个核心原语决定信息的共享和访问方式：

| 原语 | 说明 | 示例 |
|------|------|------|
| **Thread（线程）** | 单次对话。消息历史和临时文件默认限定在线程内 | 每个新对话都是独立的线程 |
| **User（用户）** | 与智能体交互的人。记忆和文件可以私有于某个用户 | "我偏好简洁的回复" |
| **Assistant（助手）** | 配置好的智能体实例。记忆和文件可以绑定到一个助手 | "帖子限制在280个字符" |

本章节涵盖以下主题：
- LangSmith Deployments 托管基础设施
- 生产环境注意事项（调用、多租户、认证、异步、持久性）
- 记忆持久化
- 执行环境（文件存储和代码执行）
- 安全防护（限流、错误处理、数据隐私）
- 前端连接

## LangSmith Deployments

推荐的上线路径是 **Managed Deep Agents** —— 一种 API 优先的托管运行时。对于需要自定义应用代码、自定义路由、高级认证或完整 Agent Server API 的团队，可以直接配置 LangSmith Deployment。

### 部署配置文件

所有代码示例使用以下 `langgraph.json` 配置：

```jsonc
// langgraph.json - LangGraph 平台配置文件
{
  "dependencies": ["."],        // 安装当前目录作为包
  "graphs": {
    "agent": "./src/agent.ts:agent"  // 图 ID 映射到代码位置
  },
  "env": ".env"                 // 环境变量文件
}
```

配置文件关键字段说明：

| 字段 | 说明 |
|------|------|
| `dependencies` | 要安装的包。`["."]` 安装当前目录（读取 `package.json`） |
| `graphs` | 将图 ID 映射到代码位置。格式：`"<id>": "./<文件>:<变量>"` |
| `env` | 环境变量文件路径（API 密钥、秘密） |

## 生产环境注意事项

### 调用智能体

在生产环境中，每次调用都应携带两个运行级别的参数：

- **`thread_id`**（通过 `config` 传递）：对话的稳定标识符，检查点使用它来持久化和恢复消息历史
- **`context`**：每次运行的数据，如 `user_id`、API 密钥、功能标志等

```typescript
import { Client } from "@langchain/langgraph-sdk";

// 创建客户端
const client = new Client({
  apiUrl: "<DEPLOYMENT_URL>",
  apiKey: "<LANGSMITH_API_KEY>"
});

// 创建新线程
const thread = await client.threads.create();

// 流式调用智能体
for await (const chunk of client.runs.stream(
  thread.thread_id,
  "agent",
  {
    input: {
      messages: [{ role: "user", content: "规划一个三天的东京之旅" }]
    },
    context: { userId: "user-123" },  // 运行时上下文
    streamMode: "updates",
  },
)) {
  console.log(chunk.data);
}
```

### 多租户

当智能体服务多个用户时，需要处理三个问题：验证用户身份、控制访问权限、管理智能体代表用户操作所需的凭据。

#### 用户身份和访问控制

LangSmith Deployments 支持自定义认证和授权处理器：

- 为资源添加所有权元数据（如 `owner: user_id`）
- 返回过滤器使用户只能看到自己的资源
- 对未授权操作返回 HTTP 403

#### 团队访问控制（RBAC）

| 角色 | 权限 |
|------|------|
| Workspace Admin | 完整权限，包括设置和成员管理 |
| Workspace Editor | 创建和修改资源，但不能删除运行或管理成员 |
| Workspace Viewer | 只读访问 |

#### 最终用户凭据

当智能体需要代表用户调用外部 API 时，使用 **Agent Auth** 提供托管的 OAuth 2.0 流程：

```typescript
import { Client } from "@langchain/auth";

const authClient = new Client();

// 在智能体的工具中访问认证用户
const authResult = await authClient.authenticate({
  provider: "github",
  scopes: ["repo", "read:org"],
  userId: runtime.serverInfo.user.identity,
});
// 使用 authResult.token 代表用户调用 GitHub API
```

### 异步编程

LLM 应用是重度 I/O 密集型的。生产环境建议：

- **创建异步工具**：原生 async 避免线程开销
- **使用异步中间件方法**：实现 `abefore_agent` 而非 `before_agent`
- **异步管理外部资源**：沙盒创建、MCP 服务器连接等需要网络调用

### 持久性执行

Deep Agents 运行在 LangGraph 上，提供开箱即用的持久性执行。持久化层在每个步骤都会创建检查点，所以被故障、超时或人工审核中断的运行可以从上一个记录状态恢复。

检查点还支持：
- **无限期中断**：人工审核工作流可以暂停数分钟或数天
- **时间旅行**：每个检查点都是可回退的快照
- **敏感操作的安全处理**：检查点提供审计追踪和恢复点

## 记忆管理

没有记忆，每次对话都从零开始。记忆让智能体可以跨对话保留信息。

### 范围配置

| 范围 | 命名空间 | 用例 | 示例 |
|------|----------|------|------|
| **用户**（推荐默认） | `(user_id)` | 每用户的偏好和上下文 | "我偏好简洁的回复" |
| **助手** | `(assistant_id)` | 一个助手的共享指令 | "帖子限制在280字符" |
| **全局** | `(org_id)` | 所有用户和助手的只读策略 | "永远不透露内部定价" |

### 配置示例

#### 用户级别记忆（推荐）

```typescript
import {
  createDeepAgent,
  CompositeBackend,
  StateBackend,
  StoreBackend
} from "deepagents";

// 用户级别的记忆：每个用户有独立的私有记忆
export const agent = createDeepAgent({
  backend: new CompositeBackend(
    new StateBackend(),
    {
      "/memories/": new StoreBackend({
        // 按助手 ID 和用户 ID 命名空间隔离
        namespace: (rt) => [
          rt.serverInfo.assistantId,
          rt.serverInfo.user.identity,
        ],
      }),
    },
  ),
  systemPrompt: `你拥有持久记忆，存储在 /memories/ 路径下。
  在每次对话开始时读取 /memories/instructions.txt 获取累积知识和偏好。
  当学到应该持久化的信息时，更新该文件。`,
});
```

#### 助手级别记忆

```typescript
import {
  createDeepAgent,
  CompositeBackend,
  StateBackend,
  StoreBackend
} from "deepagents";

// 助手级别的记忆：同一助手的所有用户共享
export const agent = createDeepAgent({
  backend: new CompositeBackend(
    new StateBackend(),
    {
      "/memories/": new StoreBackend({
        namespace: (rt) => [rt.serverInfo.assistantId],
      }),
    },
  ),
});
```

#### 用户级别（跨助手）

```typescript
import {
  createDeepAgent,
  CompositeBackend,
  StateBackend,
  StoreBackend
} from "deepagents";

// 用户级别的记忆：用户在所有助手之间共享
export const agent = createDeepAgent({
  backend: new CompositeBackend(
    new StateBackend(),
    {
      "/memories/": new StoreBackend({
        namespace: (rt) => [rt.serverInfo.user.identity],
      }),
    },
  ),
});
```

#### 组织级别记忆

```typescript
import {
  createDeepAgent,
  CompositeBackend,
  StateBackend,
  StoreBackend
} from "deepagents";

// 组织级别的记忆：所有用户和助手共享
export const agent = createDeepAgent({
  backend: new CompositeBackend(
    new StateBackend(),
    {
      "/memories/": new StoreBackend({
        namespace: (rt) => [rt.context.orgId],
      }),
    },
  ),
});
```

## 执行环境

### 文件系统后端

| 后端类型 | 说明 | 适用场景 |
|----------|------|----------|
| **StateBackend**（默认） | 线程范围的临时空间 | 文件通过检查点在线程内持久化，不跨线程共享 |
| **StoreBackend** | 跨线程存储 | 通过命名空间工厂配置范围，跨对话持久化 |
| **CompositeBackend** | 混合两者 | 默认线程范围临时空间 + 特定路径的跨线程路由 |

### 沙盒环境

如果智能体需要运行代码（不仅仅是读写文件），需要使用沙盒。沙盒提供文件系统和 `execute` 工具，都在隔离容器内运行。

#### 沙盒生命周期

| 范围 | 生命周期 | 用例 |
|------|----------|------|
| **线程范围** | 每次对话一个新沙盒，TTL 过期清理 | 数据分析机器人，每次对话从干净状态开始 |
| **助手范围** | 所有对话共享一个沙盒 | 编码助手，跨对话维护克隆的代码仓库 |

#### 线程范围沙盒示例

```typescript
import { Daytona } from "@daytonaio/sdk";
import { DaytonaSandbox } from "@langchain/daytona";
import { createDeepAgent } from "deepagents";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";

const client = new Daytona();

// 图工厂函数：每次运行时创建智能体
export async function agent(config: LangGraphRunnableConfig) {
  const threadId = config.configurable?.thread_id as string;
  let sandbox;

  try {
    // 尝试查找已有的沙盒
    sandbox = await client.findOne({ labels: { thread_id: threadId } });
  } catch {
    // 不存在则创建新沙盒
    sandbox = await client.create({
      labels: { thread_id: threadId },
      autoDeleteInterval: 3600,  // TTL: 空闲时自动清理
    });
  }

  return createDeepAgent({
    model: "google_genai:gemini-3.5-flash",
    backend: await DaytonaSandbox.fromId(sandbox.id),
  });
}
```

#### 助手范围沙盒示例

```typescript
import { Daytona } from "@daytonaio/sdk";
import { DaytonaSandbox } from "@langchain/daytona";
import { createDeepAgent } from "deepagents";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";

const client = new Daytona();

// 所有对话共享一个沙盒
export async function agent(config: LangGraphRunnableConfig) {
  const assistantId = config.configurable?.assistant_id as string;
  let sandbox;

  try {
    sandbox = await client.findOne({ labels: { assistant_id: assistantId } });
  } catch {
    sandbox = await client.create({
      labels: { assistant_id: assistantId }
    });
  }

  return createDeepAgent({
    model: "google_genai:gemini-3.5-flash",
    backend: await DaytonaSandbox.fromId(sandbox.id),
  });
}
```

#### 文件传输

沙盒是隔离容器，应用代码无法直接访问沙盒内的文件。使用 `upload_files()` 和 `download_files()` 跨越沙盒边界：

```typescript
// 会话1：安装 pandas 并分析数据
const thread1 = await client.threads.create();
for await (const chunk of client.runs.stream(
  thread1.thread_id,
  "agent",
  {
    input: {
      messages: [{ role: "human", content: "安装 pandas 并分析 sales_data.csv" }]
    }
  },
)) {
  console.log(chunk.data);
}

// 同一会话的后续消息 —— pandas 仍然已安装
for await (const chunk of client.runs.stream(
  thread1.thread_id,
  "agent",
  {
    input: {
      messages: [{ role: "human", content: "现在绘制结果图表" }]
    }
  },
)) {
  console.log(chunk.data);
}

// 会话2：全新沙盒 —— pandas 未安装，没有会话1的文件
const thread2 = await client.threads.create();
for await (const chunk of client.runs.stream(
  thread2.thread_id,
  "agent",
  {
    input: {
      messages: [{ role: "human", content: "安装了哪些包？" }]
    }
  },
)) {
  console.log(chunk.data);
}
```

#### 沙盒同步中间件示例

用于在沙盒和存储之间同步技能脚本和记忆的自定义中间件：

```typescript
import { createMiddleware } from "langchain";
import { createDeepAgent, CompositeBackend, StoreBackend } from "deepagents";
import { DaytonaSandbox } from "@langchain/daytona";

// 安全文件名处理
function safeFilename(key: string): string {
  const name = key.split("/").pop()!;
  if (name.includes("..") || /[*?]/.test(name)) {
    throw new Error(`Invalid key: ${key}`);
  }
  return name;
}

// 创建沙盒同步中间件
const createSandboxSyncMiddleware = (backend: CompositeBackend) => {
  return createMiddleware({
    name: "SandboxSyncMiddleware",
    // 智能体运行前：上传技能脚本和记忆到沙盒
    beforeAgent: async (state, runtime) => {
      const userId = runtime.serverInfo.user.identity;
      const store = runtime.store;
      const encoder = new TextEncoder();
      const files: [string, Uint8Array][] = [];

      // 上传技能文件
      for (const item of await store.search(["skills", userId])) {
        const name = safeFilename(item.key);
        files.push([`/skills/${name}`, encoder.encode(item.value.content)]);
      }

      // 上传记忆文件
      for (const item of await store.search(["memories", userId])) {
        const name = safeFilename(item.key);
        files.push([`/memories/${name}`, encoder.encode(item.value.content)]);
      }

      if (files.length > 0) {
        await backend.uploadFiles(files);
      }
    },
    // 智能体运行后：同步更新的记忆回存储
    afterAgent: async (state, runtime) => {
      const userId = runtime.serverInfo.user.identity;
      const store = runtime.store;
      const items = await store.search(["memories", userId]);

      const results = await backend.downloadFiles(
        items.map((item) => `/memories/${item.key}`),
      );

      const decoder = new TextDecoder();
      for (const result of results) {
        if (result.content) {
          await store.put(
            ["memories", userId],
            result.path.split("/").pop()!,
            { content: decoder.decode(result.content) },
          );
        }
      }
    },
  });
};
```

#### 管理秘密

沙盒是隔离容器，主机的环境变量在沙盒内不可用。有两种方式提供 API 密钥：

**认证代理（推荐）**：拦截沙盒的出站请求，自动注入认证头：

```jsonc
// 代理配置：自动为出站请求注入凭据
{
  "proxy_config": {
    "rules": [
      {
        "name": "openai-api",
        "match_hosts": ["api.openai.com"],
        "inject_headers": {
          "Authorization": "Bearer ${OPENAI_API_KEY}"
        }
      },
      {
        "name": "anthropic-api",
        "match_hosts": ["api.anthropic.com"],
        "inject_headers": {
          "x-api-key": "${ANTHROPIC_API_KEY}"
        }
      }
    ]
  }
}
```

`${SECRET_KEY}` 引用会解析为 LangSmith 工作区设置中存储的秘密。

## 安全防护（Guardrails）

### 速率限制

限制智能体自身的 LLM 和工具使用，防止失控循环：

```typescript
import {
  createAgent,
  modelCallLimitMiddleware,
  toolCallLimitMiddleware
} from "langchain";

const agent = createAgent({
  model: "google_genai:gemini-3.5-flash",
  middleware: [
    modelCallLimitMiddleware({ runLimit: 50 }),   // 每次调用最多50次模型调用
    toolCallLimitMiddleware({ runLimit: 200 }),    // 每次调用最多200次工具调用
  ],
});
```

- `runLimit`：限制单次调用内的次数（每轮重置）
- `threadLimit`：限制整个对话的次数（需要检查点）

### 错误处理

不同类型的错误需要不同的处理方式：
- **瞬态故障**（网络超时、速率限制）：自动重试
- **LLM 可恢复的错误**（错误工具输出、解析失败）：反馈给模型
- **需要人工输入的错误**：暂停智能体

```typescript
import {
  createAgent,
  modelFallbackMiddleware,
  modelRetryMiddleware,
  toolRetryMiddleware,
} from "langchain";

const agent = createAgent({
  model: "google_genai:gemini-3.5-flash",
  middleware: [
    // 模型调用重试：处理速率限制、超时和 5xx 错误
    modelRetryMiddleware({
      maxRetries: 3,
      backoffFactor: 2.0,
      initialDelayMs: 1000
    }),
    // 主模型完全不可用时，回退到备用模型
    modelFallbackMiddleware("gpt-5.4"),
    // 特定工具的重试（不是所有工具）
    toolRetryMiddleware({
      maxRetries: 2,
      tools: ["search", "fetch_url"],  // 只重试这些工具
      retryOn: [TimeoutError, TypeError],
    }),
  ],
});
```

### 数据隐私

检测和处理用户输入中的 PII（个人身份信息）：

```typescript
import { createAgent, piiMiddleware } from "langchain";

const agent = createAgent({
  model: "google_genai:gemini-3.5-flash",
  middleware: [
    // 电子邮件：编辑策略（替换为 [REDACTED_EMAIL]）
    piiMiddleware("email", { strategy: "redact", applyToInput: true }),
    // 信用卡：遮盖策略（如 ****-****-****-1234）
    piiMiddleware("credit_card", { strategy: "mask", applyToInput: true }),
  ],
});
```

可用策略：
- `redact`：替换为占位符
- `mask`：部分遮盖
- `hash`：确定性哈希
- `block`：抛出错误

## 前端连接

Deep Agents 使用 `useStream` 连接 UI 到智能体后端，支持 React、Vue、Svelte 和 Angular。

```typescript
import { useStream } from "@langchain/react";

function App() {
  const stream = useStream<typeof agent>({
    apiUrl: "https://your-deployment.langsmith.dev",
    assistantId: "agent",
    reconnectOnMount: true,    // 页面刷新后恢复流
    fetchStateHistory: true,   // 加载完整线程历史
  });
}
```

对于产生大量子智能体的深度智能体工作流，设置较高的 `recursionLimit`：

```typescript
stream.submit(
  { messages: [{ type: "human", content: text }] },
  {
    streamSubgraphs: true,
    config: { recursionLimit: 10000 },  // 避免截断长时间运行的执行
  },
);
```

## 小结

| 主题 | 要点 |
|------|------|
| 部署配置 | `langgraph.json` 定义图、依赖和环境变量 |
| 多租户 | 用户身份、RBAC、OAuth 凭据管理 |
| 记忆范围 | 用户级别（推荐）、助手级别、全局 |
| 执行环境 | 文件系统后端 + 沙盒（隔离代码执行） |
| 安全防护 | 速率限制、错误重试/回退、PII 处理 |
| 前端 | `useStream` 实时流式连接 |

## 相关章节

- [托管深度智能体](./04-managed-deep-agents.md) - 部署平台概述
- [上下文工程](./09-context-engineering.md) - 上下文管理详解
- [工具](./08-tools.md) - 自定义工具和 MCP 集成
