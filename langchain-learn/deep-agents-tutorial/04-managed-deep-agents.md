# 托管深度智能体 - Managed Deep Agents

## 概述

Managed Deep Agents（托管深度智能体）是 LangSmith 提供的一种 API 优先的托管运行时，用于创建、运行和运维深度智能体。它将你的智能体配置、工具和运行时设置打包，部署到 LangSmith 平台上，让你无需自行搭建基础设施。

> **注意**：Managed Deep Agents 目前处于私有预览阶段，需要加入等待列表。

## 为什么需要托管服务？

在本地开发和原型验证阶段，你直接在本地机器上运行深度智能体即可。但当需要将智能体推向生产环境时，你需要考虑：

- **基础设施管理**：线程、运行、存储、检查点等
- **认证和授权**：用户身份验证、访问控制
- **可观测性**：日志、追踪、监控
- **弹性伸缩**：自动扩缩容、负载均衡
- **持久化存储**：跨对话的记忆、文件系统

Managed Deep Agents 帮你处理这些运维问题，让你专注于智能体本身的逻辑。

## 核心概念

### 智能体部署配置

部署一个托管深度智能体需要创建 `langgraph.json` 配置文件：

```jsonc
// langgraph.json - LangGraph 平台的配置文件
{
  // 依赖项：要安装的包。"." 表示安装当前目录
  "dependencies": ["."],

  // 图定义：将图 ID 映射到代码位置
  // 格式为 "<id>": "./<文件>:<变量>"
  "graphs": {
    "agent": "./src/agent.ts:agent"
  },

  // 环境变量文件路径（API 密钥、秘密等）
  "env": ".env"
}
```

### 智能体的三种范围原语

在生产环境中，有三个核心原语决定信息的共享和访问方式：

| 原语 | 说明 |
|------|------|
| **Thread（线程）** | 单次对话。消息历史和临时文件默认限定在线程内，不会跨线程传递 |
| **User（用户）** | 与你的智能体交互的人。记忆和文件可以私有于某个用户或在用户间共享 |
| **Assistant（助手）** | 配置好的智能体实例。记忆和文件可以绑定到一个助手或在所有助手间共享 |

### 部署方式

LangSmith 提供两种部署路径：

1. **Managed Deep Agents**（推荐）
   - API 优先的托管运行时
   - 最简单的部署方式
   - 自动提供线程、运行、存储和检查点基础设施

2. **传统 LangSmith Deployment**
   - 适合需要自定义应用代码、自定义路由、高级认证或完整 Agent Server API 的团队
   - 提供认证、Webhook、定时任务和可观测性
   - 可通过 MCP 或 A2A 协议暴露你的智能体

## 创建和部署智能体

### 步骤一：编写智能体代码

```typescript
// src/agent.ts
import { createDeepAgent } from "deepagents";

// 创建深度智能体实例
export const agent = await createDeepAgent({
  model: "google_genai:gemini-3.5-flash",
  systemPrompt: `你是一个有帮助的AI助手。
  在回答问题时始终引用来源。使用子智能体并行研究不同主题。`,
});
```

### 步骤二：本地测试

使用 `langgraph dev` 在本地运行和测试智能体：

```bash
# 启动本地开发服务器
langgraph dev
```

### 步骤三：部署到 LangSmith

```bash
# 部署到 LangSmith 平台
langgraph deploy
```

## 使用 SDK 调用已部署的智能体

部署完成后，你可以使用 LangGraph SDK 从应用代码中调用智能体：

```typescript
import { Client } from "@langchain/langgraph-sdk";

// 创建客户端连接到部署的智能体
const client = new Client({
  apiUrl: "<DEPLOYMENT_URL>",
  apiKey: "<LANGSMITH_API_KEY>"
});

// 创建新的对话线程
const thread = await client.threads.create();

// 发送消息并流式获取响应
for await (const chunk of client.runs.stream(
  thread.thread_id,
  "agent",  // 对应 langgraph.json 中定义的图 ID
  {
    input: {
      messages: [{ role: "user", content: "规划一个三天的东京之旅" }]
    },
    context: { userId: "user-123" },  // 传递运行时上下文
    streamMode: "updates",
  },
)) {
  console.log(chunk.data);
}
```

## 关键配置项

### 运行参数

每次调用都应携带两个运行级别的参数：

- **`thread_id`**：通过 `config` 传递，是对话的稳定标识符。检查点使用它来持久化和恢复消息历史
- **`context`**：每次运行的数据，如 `user_id`、API 密钥、功能标志等，通过 `contextSchema` 定义结构

```typescript
// 在调用中传递 thread_id 和 context
const result = await agent.invoke(
  {
    messages: [{ role: "user", content: "你好！" }]
  },
  {
    context: {
      userId: "user-123",
      apiKey: "sk-..."
    },
  },
);
```

### 认证与授权

LangSmith Deployments 支持自定义认证来建立用户身份，以及授权处理器来控制对资源的访问：

- 为资源添加所有权元数据（如 `owner: user_id`）
- 返回过滤器使用户只能看到自己的资源
- 对未授权操作返回 HTTP 403

## 小结

| 主题 | 要点 |
|------|------|
| 托管服务 | Managed Deep Agents 提供即用的基础设施 |
| 配置文件 | `langgraph.json` 定义依赖、图和环境变量 |
| 三大原语 | Thread、User、Assistant 控制数据范围 |
| SDK 调用 | 使用 `@langchain/langgraph-sdk` 调用部署的智能体 |
| 持久化 | 线程、运行、存储和检查点自动管理 |

## 相关章节

- [投入生产](./05-going-to-production.md) - 详细的上线指南
- [核心能力](./06-core-capabilities.md) - 深度智能体的内置能力
- [模型配置](./07-models.md) - 配置模型提供商和参数
