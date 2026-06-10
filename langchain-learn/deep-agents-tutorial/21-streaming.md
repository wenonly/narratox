# 流式传输 (Streaming)

> 从 Deep Agent 运行和子 Agent 执行中流式传输实时更新。

## 概述

Deep Agents 构建在 LangGraph 的流式基础设施之上，提供一流的子 Agent 流式支持。当 Deep Agent 将工作委托给子 Agent 时，你可以独立地从每个子 Agent 流式传输更新——实时跟踪进度、LLM token 和工具调用。

Deep Agent 流式传输可以实现：

- **流式传输子 Agent 进度**——跟踪每个子 Agent 的并行执行
- **流式传输 LLM token**——从主 Agent 和每个子 Agent 流式传输 token
- **流式传输工具调用**——查看子 Agent 执行中的工具调用和结果
- **流式传输自定义更新**——从子 Agent 节点内部发出用户定义的信号

## 启用子图流式传输

Deep Agents 使用 LangGraph 的子图流式传输来展示子 Agent 执行的事件。要接收子 Agent 事件，在流式传输时启用 `subgraphs` 选项。

```typescript
import { createDeepAgent } from "deepagents";

// 创建带有子 Agent 的 Deep Agent
const agent = createDeepAgent({
  systemPrompt: "You are a helpful research assistant",
  subagents: [
    {
      name: "researcher",
      description: "Researches a topic in depth",
      systemPrompt: "You are a thorough researcher.",
    },
  ],
});

// 使用 stream 方法并启用 subgraphs
for await (const [namespace, chunk] of await agent.stream(
  { messages: [{ role: "user", content: "Research quantum computing advances" }] },
  {
    streamMode: "updates",
    subgraphs: true,  // 启用子图流式传输
  }
)) {
  if (namespace.length > 0) {
    // 子 Agent 事件 - namespace 标识来源
    console.log(`[subagent: ${namespace.join("|")}]`);
  } else {
    // 主 Agent 事件
    console.log("[main agent]");
  }
  console.log(chunk);
}
```

## 命名空间

当启用 `subgraphs` 时，每个流式事件包含一个**命名空间**（namespace），标识哪个 Agent 产生了该事件。命名空间是节点名称和任务 ID 的路径，代表 Agent 层级结构。

| 命名空间 | 来源 |
| --- | --- |
| `()`（空） | 主 Agent |
| `("tools:abc123",)` | 主 Agent 的 `task` 工具调用 `abc123` 产生的子 Agent |
| `("tools:abc123", "model_request:def456")` | 子 Agent 内部的模型请求节点 |

使用命名空间将事件路由到正确的 UI 组件：

```typescript
for await (const [namespace, chunk] of await agent.stream(
  { messages: [{ role: "user", content: "Plan my vacation" }] },
  { streamMode: "updates", subgraphs: true }
)) {
  // 检查事件是否来自子 Agent
  const isSubagent = namespace.some(
    (segment: string) => segment.startsWith("tools:")
  );

  if (isSubagent) {
    // 从命名空间中提取工具调用 ID
    const toolCallId = namespace
      .find((s: string) => s.startsWith("tools:"))
      ?.split(":")[1];
    console.log(`Subagent ${toolCallId}:`, chunk);
  } else {
    console.log("Main agent:", chunk);
  }
}
```

## 子 Agent 进度

使用 `streamMode: "updates"` 跟踪子 Agent 进度，显示每个步骤完成时的状态。

```typescript
import { createDeepAgent } from "deepagents";

const agent = createDeepAgent({
  systemPrompt:
    "You are a project coordinator. Always delegate research tasks " +
    "to your researcher subagent using the task tool. Keep your final response to one sentence.",
  subagents: [
    {
      name: "researcher",
      description: "Researches topics thoroughly",
      systemPrompt:
        "You are a thorough researcher. Research the given topic " +
        "and provide a concise summary in 2-3 sentences.",
    },
  ],
});

// 流式传输更新以跟踪子 Agent 进度
for await (const [namespace, chunk] of await agent.stream(
  {
    messages: [
      { role: "user", content: "Write a short summary about AI safety" },
    ],
  },
  { streamMode: "updates", subgraphs: true },
)) {
  // 主 Agent 更新（空命名空间）
  if (namespace.length === 0) {
    for (const [nodeName, data] of Object.entries(chunk)) {
      if (nodeName === "tools") {
        // 子 Agent 结果返回给主 Agent
        for (const msg of (data as any).messages ?? []) {
          if (msg.type === "tool") {
            console.log(`\nSubagent complete: ${msg.name}`);
            console.log(`  Result: ${String(msg.content).slice(0, 200)}...`);
          }
        }
      } else {
        console.log(`[main agent] step: ${nodeName}`);
      }
    }
  }
  // 子 Agent 更新（非空命名空间）
  else {
    for (const [nodeName] of Object.entries(chunk)) {
      console.log(`  [${namespace[0]}] step: ${nodeName}`);
    }
  }
}
```

输出示例：

```
Main agent step: model_request
  [tools:call_abc123] step: model_request
  [tools:call_abc123] step: tools
  [tools:call_abc123] step: model_request
Subagent complete: task
Result: ## AI Safety Report...
Main agent step: model_request
```

## LLM Token

使用 `streamMode: "messages"` 从主 Agent 和子 Agent 流式传输单个 token。每个消息事件包含标识来源 Agent 的元数据。

```typescript
let currentSource = "";

for await (const [namespace, chunk] of await agent.stream(
  {
    messages: [
      {
        role: "user",
        content: "Research quantum computing advances",
      },
    ],
  },
  { streamMode: "messages", subgraphs: true },
)) {
  const [message] = chunk;

  // 检查是否来自子 Agent
  const isSubagent = namespace.some((s: string) => s.startsWith("tools:"));

  if (isSubagent) {
    // 来自子 Agent 的 token
    const subagentNs = namespace.find((s: string) => s.startsWith("tools:"))!;
    if (subagentNs !== currentSource) {
      process.stdout.write(`\n\n--- [subagent: ${subagentNs}] ---\n`);
      currentSource = subagentNs;
    }
    if (message.text) {
      process.stdout.write(message.text);
    }
  } else {
    // 来自主 Agent 的 token
    if ("main" !== currentSource) {
      process.stdout.write(`\n\n--- [main agent] ---\n`);
      currentSource = "main";
    }
    if (message.text) {
      process.stdout.write(message.text);
    }
  }
}

process.stdout.write("\n");
```

### 流式传输工具调用

当子 Agent 使用工具时，你可以流式传输工具调用事件来显示每个子 Agent 在做什么：

```typescript
import { AIMessageChunk, ToolMessage } from "langchain";

for await (const [namespace, chunk] of await agent.stream(
  {
    messages: [
      {
        role: "user",
        content: "Research recent quantum computing advances",
      },
    ],
  },
  { streamMode: "messages", subgraphs: true },
)) {
  const [message] = chunk;

  // 标识来源："main" 或子 Agent 命名空间段
  const isSubagent = namespace.some((s: string) => s.startsWith("tools:"));
  const source = isSubagent
    ? namespace.find((s: string) => s.startsWith("tools:"))!
    : "main";

  // 工具调用块（流式工具调用）
  if (AIMessageChunk.isInstance(message) && message.tool_call_chunks?.length) {
    for (const tc of message.tool_call_chunks) {
      if (tc.name) {
        console.log(`\n[${source}] Tool call: ${tc.name}`);
      }
      // 参数分块流式传输 - 增量写入
      if (tc.args) {
        process.stdout.write(tc.args);
      }
    }
  }

  // 工具结果
  if (ToolMessage.isInstance(message)) {
    console.log(
      `\n[${source}] Tool result [${message.name}]: ${message.text?.slice(0, 150)}`,
    );
  }

  // 常规 AI 内容（跳过工具调用消息）
  if (
    AIMessageChunk.isInstance(message) &&
    message.text &&
    !message.tool_call_chunks?.length
  ) {
    process.stdout.write(message.text);
  }
}

process.stdout.write("\n");
```

## 自定义更新

使用 `config.writer` 在子 Agent 工具内部发出自定义进度事件：

```typescript
import { createDeepAgent } from "deepagents";
import { tool, type ToolRuntime } from "langchain";
import { z } from "zod";

/**
 * 通过 config.writer 发出自定义进度事件的工具。
 * writer 将数据发送到 "custom" 流模式。
 */
const analyzeData = tool(
  async ({ topic }: { topic: string }, config: ToolRuntime) => {
    const writer = config.writer;

    // 发出进度事件
    writer?.({ status: "starting", topic, progress: 0 });
    await new Promise((r) => setTimeout(r, 500));

    writer?.({ status: "analyzing", progress: 50 });
    await new Promise((r) => setTimeout(r, 500));

    writer?.({ status: "complete", progress: 100 });
    return `Analysis of "${topic}": Customer sentiment is 85% positive, driven by product quality and support response times.`;
  },
  {
    name: "analyze_data",
    description:
      "Run a data analysis on a given topic. " +
      "This tool performs the actual analysis and emits progress updates. " +
      "You MUST call this tool for any analysis request.",
    schema: z.object({
      topic: z.string().describe("The topic or subject to analyze"),
    }),
  },
);

// 创建带有自定义工具的 Agent
const agent = createDeepAgent({
  systemPrompt:
    "You are a coordinator. For any analysis request, you MUST delegate " +
    "to the analyst subagent using the task tool. Never try to answer directly. " +
    "After receiving the result, summarize it in one sentence.",
  subagents: [
    {
      name: "analyst",
      description: "Performs data analysis with real-time progress tracking",
      systemPrompt:
        "You are a data analyst. You MUST call the analyze_data tool " +
        "for every analysis request. Do not use any other tools. " +
        "After the analysis completes, report the result.",
      tools: [analyzeData],
    },
  ],
});

// 使用 custom 模式流式传输自定义事件
for await (const [namespace, chunk] of await agent.stream(
  {
    messages: [
      {
        role: "user",
        content: "Analyze customer satisfaction trends",
      },
    ],
  },
  { streamMode: "custom", subgraphs: true },
)) {
  const isSubagent = namespace.some((s: string) => s.startsWith("tools:"));
  if (isSubagent) {
    const subagentNs = namespace.find((s: string) => s.startsWith("tools:"))!;
    console.log(`[${subagentNs}]`, chunk);
  } else {
    console.log("[main]", chunk);
  }
}
```

输出示例：

```
[tools:call_abc123] { status: 'fetching', progress: 0 }
[tools:call_abc123] { status: 'analyzing', progress: 50 }
[tools:call_abc123] { status: 'complete', progress: 100 }
```

## 多模式流式传输

组合多种流模式以获取 Agent 执行的完整画面：

```typescript
// 只显示有意义的节点名称
const INTERESTING_NODES = new Set(["model_request", "tools"]);

let lastSource = "";
let midLine = false; // 当已写入 token 但没有尾随换行时为 true

// 同时使用多种流模式
for await (const [namespace, mode, data] of await agent.stream(
  {
    messages: [
      {
        role: "user",
        content: "Analyze the impact of remote work on team productivity",
      },
    ],
  },
  { streamMode: ["updates", "messages", "custom"], subgraphs: true },
)) {
  const isSubagent = namespace.some((s: string) => s.startsWith("tools:"));
  const source = isSubagent ? "subagent" : "main";

  if (mode === "updates") {
    // 处理更新事件
    for (const nodeName of Object.keys(data)) {
      if (!INTERESTING_NODES.has(nodeName)) continue;
      if (midLine) {
        process.stdout.write("\n");
        midLine = false;
      }
      console.log(`[${source}] step: ${nodeName}`);
    }
  } else if (mode === "messages") {
    // 处理消息/token 事件
    const [message] = data;
    if (message.text) {
      // 当来源改变时打印标题
      if (source !== lastSource) {
        if (midLine) {
          process.stdout.write("\n");
          midLine = false;
        }
        process.stdout.write(`\n[${source}] `);
        lastSource = source;
      }
      process.stdout.write(message.text);
      midLine = true;
    }
  } else if (mode === "custom") {
    // 处理自定义事件
    if (midLine) {
      process.stdout.write("\n");
      midLine = false;
    }
    console.log(`[${source}] custom event:`, data);
  }
}

process.stdout.write("\n");
```

## 常见模式：跟踪子 Agent 生命周期

监控子 Agent 何时启动、运行和完成：

```typescript
// 用于跟踪活跃子 Agent 的 Map
const activeSubagents = new Map();

for await (const [namespace, chunk] of await agent.stream(
  {
    messages: [
      { role: "user", content: "Research the latest AI safety developments" },
    ],
  },
  { streamMode: "updates", subgraphs: true },
)) {
  for (const [nodeName, data] of Object.entries(chunk)) {
    // 阶段 1：检测子 Agent 启动
    if (namespace.length === 0 && nodeName === "model_request") {
      for (const msg of (data as any).messages ?? []) {
        for (const tc of msg.tool_calls ?? []) {
          if (tc.name === "task") {
            activeSubagents.set(tc.id, {
              type: tc.args?.subagent_type,
              description: tc.args?.description?.slice(0, 80),
              status: "pending",
            });
            console.log(
              `[lifecycle] PENDING  → subagent "${tc.args?.subagent_type}" (${tc.id})`,
            );
          }
        }
      }
    }

    // 阶段 2：检测子 Agent 运行中
    if (namespace.length > 0 && namespace[0].startsWith("tools:")) {
      const pregelId = namespace[0].split(":")[1];
      for (const [id, sub] of activeSubagents) {
        if (sub.status === "pending") {
          sub.status = "running";
          console.log(
            `[lifecycle] RUNNING  → subagent "${sub.type}" (pregel: ${pregelId})`,
          );
          break;
        }
      }
    }

    // 阶段 3：检测子 Agent 完成
    if (namespace.length === 0 && nodeName === "tools") {
      for (const msg of (data as any).messages ?? []) {
        if (msg.type === "tool") {
          const subagent = activeSubagents.get(msg.tool_call_id);
          if (subagent) {
            subagent.status = "complete";
            console.log(
              `[lifecycle] COMPLETE → subagent "${subagent.type}" (${msg.tool_call_id})`,
            );
            console.log(
              `  Result preview: ${String(msg.content).slice(0, 120)}...`,
            );
          }
        }
      }
    }
  }
}

// 打印最终状态
console.log("\n--- Final subagent states ---");
for (const [id, sub] of activeSubagents) {
  console.log(`  ${sub.type}: ${sub.status}`);
}
```

## 关键要点

- 使用 `subgraphs: true` 启用子 Agent 事件的流式传输
- **命名空间**标识事件来源：空命名空间 = 主 Agent，`tools:` 前缀 = 子 Agent
- `streamMode: "updates"` 跟踪执行步骤，`streamMode: "messages"` 流式传输 token，`streamMode: "custom"` 接收自定义事件
- 可以组合多种流模式：`streamMode: ["updates", "messages", "custom"]`
- 使用 `config.writer` 在工具内部发出自定义进度信号
- 通过跟踪 `task` 工具调用和工具结果消息来监控子 Agent 生命周期
