# 记忆系统 - Memory

> 原文地址: https://docs.langchain.com/oss/javascript/deepagents/memory

## 概述

记忆系统让你的 Agent 能够跨对话学习和改进。Deep Agents 将记忆作为一等公民，通过文件系统支持的内存实现：Agent 以文件形式读写记忆，你通过后端控制这些文件的存储位置和访问权限。

---

## 记忆如何工作

1. **指向记忆文件。** 创建 Agent 时通过 `memory=` 参数传递文件路径。你也可以通过 `skills=` 参数传递技能（可重用的指令，告诉 Agent _如何_ 执行任务）。后端控制文件的存储位置和访问权限。

2. **Agent 读取记忆。** Agent 可以在启动时将记忆文件加载到系统提示中，或在对话过程中按需读取。例如，技能使用按需加载：Agent 在启动时只读取技能描述，只有在匹配到任务时才读取完整的技能文件。这让上下文保持精简，直到需要特定能力。

3. **Agent 更新记忆（可选）。** 当 Agent 学习到新信息时，可以使用内置的 `edit_file` 工具更新记忆文件。更新可以在对话过程中（默认）或通过后台整合在对话之间进行。更改会被持久化并在下一次对话中可用。并非所有记忆都是可写的：开发者定义的技能和组织策略通常是只读的。

---

## 作用域记忆

Agent 记忆可以设置作用域，使同一记忆文件对所有使用 Agent 的用户可访问，或者每个用户拥有独立的记忆文件。

### Agent 级别记忆

给 Agent 自己的持久身份，随时间演进。Agent 级别记忆在所有用户之间共享，因此 Agent 通过每次对话积累自己的角色、累积的知识和学习的偏好。

```typescript
import { createDeepAgent, CompositeBackend, StateBackend, StoreBackend } from "deepagents";

const agent = createDeepAgent({
  memory: ["/memories/AGENTS.md"],
  skills: ["/skills/"],
  backend: new CompositeBackend(
    new StateBackend(),
    {
      "/memories/": new StoreBackend({
        namespace: (rt) => [rt.serverInfo.assistantId],
      }),
      "/skills/": new StoreBackend({
        namespace: (rt) => [rt.serverInfo.assistantId],
      }),
    },
  ),
});
```

#### 完整示例：初始化记忆并调用

```typescript
import { createDeepAgent, CompositeBackend, StateBackend, StoreBackend, createFileData } from "deepagents";
import { InMemoryStore } from "@langchain/langgraph";

const store = new InMemoryStore();  // 部署到 LangSmith 时使用平台存储

// 初始化记忆文件
await store.put(
  ["my-agent"],
  "/memories/AGENTS.md",
  createFileData(`## Response style
- Keep responses concise
- Use code examples where possible
`),
);

// 初始化技能
await store.put(
  ["my-agent"],
  "/skills/langgraph-docs/SKILL.md",
  createFileData(`---
name: langgraph-docs
description: Fetch relevant LangGraph documentation to provide accurate guidance.
---

# langgraph-docs

Use the fetch_url tool to read https://docs.langchain.com/llms.txt, then fetch relevant pages.
`),
);

const agent = createDeepAgent({
  memory: ["/memories/AGENTS.md"],
  skills: ["/skills/"],
  backend: new CompositeBackend(
    new StateBackend(),
    {
      "/memories/": new StoreBackend({
        namespace: () => ["my-agent"],
      }),
      "/skills/": new StoreBackend({
        namespace: () => ["my-agent"],
      }),
    },
  ),
  store,
});

// 线程 1：Agent 学习新偏好并保存到记忆
const config1 = { configurable: { thread_id: crypto.randomUUID() } };
await agent.invoke({
  messages: [{ role: "user", content: "I prefer detailed explanations. Remember that." }],
}, config1);

// 线程 2：Agent 读取记忆并应用偏好
const config2 = { configurable: { thread_id: crypto.randomUUID() } };
await agent.invoke({
  messages: [{ role: "user", content: "Explain how transformers work." }],
}, config2);
```

### 用户级别记忆

每个用户拥有自己的记忆文件。Agent 按用户记住偏好、上下文和历史，同时核心 Agent 指令保持不变。用户还可以拥有按用户划分的技能。

```typescript
import { createDeepAgent, CompositeBackend, StateBackend, StoreBackend } from "deepagents";

const agent = createDeepAgent({
  memory: ["/memories/preferences.md"],
  skills: ["/skills/"],
  backend: new CompositeBackend(
    new StateBackend(),
    {
      "/memories/": new StoreBackend({
        namespace: (rt) => [rt.serverInfo.user.identity],  // 按用户隔离
      }),
      "/skills/": new StoreBackend({
        namespace: (rt) => [rt.serverInfo.user.identity],  // 按用户隔离
      }),
    },
  ),
});
```

#### 完整示例：跨用户的隔离记忆

```typescript
import { createDeepAgent, CompositeBackend, StateBackend, StoreBackend, createFileData } from "deepagents";
import { InMemoryStore } from "@langchain/langgraph";

const store = new InMemoryStore();

// 为两个用户初始化偏好
await store.put(
  ["user-alice"],
  "/memories/preferences.md",
  createFileData(`## Preferences
- Likes concise bullet points
- Prefers Python examples
`),
);
await store.put(
  ["user-bob"],
  "/memories/preferences.md",
  createFileData(`## Preferences
- Likes detailed explanations
- Prefers TypeScript examples
`),
);

// 为 Alice 初始化技能
await store.put(
  ["user-alice"],
  "/skills/langgraph-docs/SKILL.md",
  createFileData(`---
name: langgraph-docs
description: Fetch relevant LangGraph documentation.
---

# langgraph-docs

Use the fetch_url tool to read https://docs.langchain.com/llms.txt.
`),
);

const agent = createDeepAgent({
  memory: ["/memories/preferences.md"],
  skills: ["/skills/"],
  backend: new CompositeBackend(
    new StateBackend(),
    {
      "/memories/": new StoreBackend({
        namespace: (rt) => [rt.serverInfo.user.identity],
      }),
      "/skills/": new StoreBackend({
        namespace: (rt) => [rt.serverInfo.user.identity],
      }),
    },
  ),
  store,
});

// 部署时，每个认证请求会将 rt.serverInfo.user.identity 解析为调用者
// Alice 和 Bob 自动只看到自己的偏好
await agent.invoke(
  { messages: [{ role: "user", content: "How do I read a CSV file?" }] },
  { configurable: { thread_id: crypto.randomUUID() } },
);
```

---

## 高级用法

| 维度 | 回答的问题 | 选项 |
| --- | --- | --- |
| **持续时间** | 记忆持续多久？ | 短期（单次对话）或长期（跨对话） |
| **信息类型** | 什么类型的信息？ | 情景记忆（过去经历）、程序记忆（指令和技能）、语义记忆（事实） |
| **作用域** | 谁能看到和修改？ | 用户、Agent 或组织 |
| **更新策略** | 何时写入记忆？ | 对话期间（默认）或对话之间 |
| **检索方式** | 如何读取记忆？ | 加载到提示（默认）或按需（如技能） |
| **代理权限** | Agent 能写入记忆吗？ | 读写（默认）或只读（用于共享策略） |

---

### 情景记忆

情景记忆存储过去经历的记录：发生了什么、按什么顺序、结果是什么。与语义记忆（文件中存储的事实和偏好）不同，情景记忆保留了完整的对话上下文，让 Agent 能回忆起问题是_如何_解决的，而不仅仅是学到了_什么_。

Deep Agents 已经使用检查点来支持情景记忆：每次对话都作为检查点线程持久化。

让过去的对话可搜索，可以将线程搜索包装在工具中：

```typescript
import { Client } from "@langchain/langgraph-sdk";
import { tool } from "@langchain/core/tools";

const client = new Client({ apiUrl: "<DEPLOYMENT_URL>" });

const searchPastConversations = tool(
  async ({ query }, runtime) => {
    const userId = runtime.serverInfo.user.identity;
    const threads = await client.threads.search({
      metadata: { userId },
      limit: 5,
    });
    const results = [];
    for (const thread of threads) {
      const history = await client.threads.getHistory(thread.threadId);
      results.push(history);
    }
    return JSON.stringify(results);
  },
  {
    name: "search_past_conversations",
    description: "Search past conversations for relevant context.",
  }
);
```

按用户或组织限定线程搜索：

```typescript
// 搜索特定用户的对话
const userThreads = await client.threads.search({
  metadata: { userId },
  limit: 5,
});

// 搜索组织内的对话
const orgThreads = await client.threads.search({
  metadata: { orgId },
  limit: 5,
});
```

---

### 组织级别记忆

组织级别记忆与用户级别记忆模式相同，但使用组织范围的命名空间。用于应该适用于组织内所有用户和 Agent 的策略或知识。

组织记忆通常是**只读**的，以防止通过共享状态进行提示注入。

```typescript
import { createDeepAgent, CompositeBackend, StateBackend, StoreBackend } from "deepagents";

const agent = createDeepAgent({
  memory: [
    "/memories/preferences.md",   // 用户级别（可读写）
    "/policies/compliance.md",    // 组织级别（只读）
  ],
  backend: new CompositeBackend(
    new StateBackend(),
    {
      "/memories/": new StoreBackend({
        namespace: (rt) => [rt.serverInfo.user.identity],  // 按用户隔离
      }),
      "/policies/": new StoreBackend({
        namespace: (rt) => [rt.context.orgId],              // 按组织隔离
      }),
    },
  ),
});
```

从应用程序代码填充组织记忆：

```typescript
import { Client } from "@langchain/langgraph-sdk";
import { createFileData } from "deepagents";

const client = new Client({ apiUrl: "<DEPLOYMENT_URL>" });

await client.store.putItem(
  [orgId],
  "/compliance.md",
  createFileData(`## Compliance policies
- Never disclose internal pricing
- Always include disclaimers on financial advice
`),
);
```

---

### 后台整合

默认情况下，Agent 在对话过程中写入记忆（热路径）。替代方案是作为后台任务在**对话之间**处理记忆，有时称为**休眠时间计算**。一个单独的 Deep Agent 审查最近的对话，提取关键事实，并与现有记忆合并。

| 方法 | 优点 | 缺点 |
| --- | --- | --- |
| **热路径**（对话期间） | 记忆立即可用，对用户透明 | 增加延迟，Agent 需要多任务处理 |
| **后台**（对话之间） | 无用户面延迟，可跨多个对话综合 | 记忆在下次对话前不可用，需要第二个 Agent |

#### 整合 Agent

整合 Agent 读取最近的对话历史并将关键事实合并到记忆存储中：

```typescript
// src/consolidation-agent.ts
import { createDeepAgent } from "deepagents";
import { Client } from "@langchain/langgraph-sdk";
import { tool } from "@langchain/core/tools";

const sdkClient = new Client({ apiUrl: "<DEPLOYMENT_URL>" });

const searchRecentConversations = tool(
  async ({ query }, runtime) => {
    const userId = runtime.serverInfo.user.identity;

    const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const threads = await sdkClient.threads.search({
      metadata: { userId },
      updatedAfter: since,
      limit: 20,
    });
    const conversations = [];
    for (const thread of threads) {
      const history = await sdkClient.threads.getHistory(thread.threadId);
      conversations.push(history.values.messages);
    }
    return JSON.stringify(conversations);
  },
  {
    name: "search_recent_conversations",
    description: "Search this user's conversations updated in the last 6 hours.",
  }
);

const agent = createDeepAgent({
  model: "google_genai:gemini-3.5-flash",
  systemPrompt: `Review recent conversations and update the user's memory file.
Merge new facts, remove outdated information, and keep it concise.`,
  tools: [searchRecentConversations],
});

export { agent };
```

在 `langgraph.json` 中注册整合 Agent：

```json
{
  "dependencies": ["."],
  "graphs": {
    "agent": "./src/agent.ts:agent",
    "consolidation_agent": "./src/consolidation-agent.ts:agent"
  },
  "env": ".env"
}
```

#### 定时任务

使用定时任务按固定计划运行整合 Agent：

```typescript
import { Client } from "@langchain/langgraph-sdk";

const client = new Client({ apiUrl: "<DEPLOYMENT_URL>" });

const cronJob = await client.crons.create(
  "consolidation_agent",
  {
    schedule: "0 */6 * * *",  // 每 6 小时运行一次
    input: { messages: [{ role: "user", content: "Consolidate recent memories." }] },
  },
);
```

---

### 只读 vs 可写记忆

| 权限 | 用例 | 工作方式 |
| --- | --- | --- |
| **读写**（默认） | 用户偏好、Agent 自我改进、学习的技能 | Agent 通过 `edit_file` 工具更新文件 |
| **只读** | 组织策略、合规规则、共享知识库、开发者定义的技能 | 通过应用代码或 Store API 填充。使用权限拒绝特定路径的写入 |

**安全注意事项：** 如果一个用户可以写入另一个用户读取的记忆，恶意用户可能会向共享状态注入指令。缓解措施：

- 除非有特定理由共享，否则**默认使用用户作用域** `(user_id)`
- 对共享策略使用**只读记忆**（通过应用代码填充，而非 Agent）
- 在 Agent 写入共享记忆前添加**人在回路**验证

使用权限强制只读记忆：

```typescript
const agent = createDeepAgent({
  permissions: [
    {
      operations: ["write"],
      paths: ["/policies/**"],
      mode: "deny",
    },
  ],
});
```

---

### 并发写入

多个线程可以并行写入记忆，但对**同一文件**的并发写入可能导致最后写入获胜冲突。对于用户级别记忆，这很少发生，因为用户通常一次只有一个活跃对话。对于 Agent 级别或组织级别记忆，考虑使用后台整合来序列化写入，或将记忆构建为按主题分离的文件以减少争用。

实际上，如果写入因冲突而失败，LLM 通常足够智能来重试或优雅恢复，因此单次丢失写入不是灾难性的。

---

### 同一部署中的多个 Agent

要在共享部署中为每个 Agent 提供独立的记忆，在命名空间中添加 `assistantId`：

```typescript
new StoreBackend({
  namespace: (rt) => [
    rt.serverInfo.assistantId,
    rt.serverInfo.user.identity,
  ],
})
```

仅使用 `assistantId` 如果你只需要按 Agent 隔离而不需要按用户隔离。

---

## 小结

- 记忆让 Agent 跨对话学习和改进，是 Deep Agents 的一等公民功能
- 两种常见模式：Agent 级别记忆（所有用户共享）和用户级别记忆（按用户隔离）
- 记忆通过后端存储，命名空间控制隔离粒度
- 支持三种记忆类型：情景记忆（过去经历）、程序记忆（技能）、语义记忆（事实）
- 更新策略可以是热路径（对话期间）或后台整合（对话之间）
- 只读记忆用于共享策略和合规规则，防止通过共享状态进行提示注入
- 权限系统可用于强制只读访问
- 后台整合 Agent 可以定时运行，自动综合和更新记忆
