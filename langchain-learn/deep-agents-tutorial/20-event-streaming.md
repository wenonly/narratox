# 事件流 (Event Streaming)

> 流式传输子 Agent、消息、工具调用和最终输出，实时跟踪 Deep Agents 的执行进度。

## 概述

本页涵盖了 Deep Agents 特定的流式传输问题——最重要的是通过 `stream.subagents` 从委托的子 Agent 进行流式传输。对于一般的 Agent 流式传输（`stream.messages`、`stream.values`、工具调用、自定义更新），请参阅 LangChain 事件流文档。

Deep Agents 在 LangGraph 流式基础设施之上添加了**子 Agent 投影**，提供了一流的子 Agent 流式支持。

## 流式传输子 Agent

Deep Agents 在 LangGraph 流式传输之上添加了子 Agent 投影。当你想要为每个委托的 `task` 调用使用一个流句柄时，使用 `stream.subagents`。该投影是轻量级的：它首先发现子 Agent 任务，消息、工具调用和值流仅在你访问子 Agent 句柄上的对应属性时才打开。

```typescript
// 创建事件流
const stream = await agent.streamEvents(
  { messages: [{ role: "user", content: "Write me a haiku about the sea" }] },
  { version: "v3" }
);

// 遍历每个子 Agent
for await (const subagent of stream.subagents) {
  console.log(subagent.name);                    // 子 Agent 名称
  console.log(await subagent.taskInput);         // 传递给 task 工具的提示

  // 遍历子 Agent 的消息
  for await (const message of subagent.messages) {
    console.log(await message.text);
  }
}
```

## 子 Agent 流字段

每个子 Agent 流暴露与父运行相同类型的投影。TypeScript 使用驼峰命名（如 `toolCalls` 和 `taskInput`）。

| 字段 | 描述 |
| --- | --- |
| `name` | 子 Agent 名称 |
| `messages` | 子 Agent 发出的消息 |
| `subagents` | 嵌套的子 Agent 调用 |
| `output` | 最终子 Agent 状态，或委托任务的完成信号 |
| `taskInput` | 传递给 task 工具的提示的 Promise |
| `toolCalls` | 限定在子 Agent 范围内的工具调用 |

## 跟踪子 Agent 生命周期

当你只需要显示哪些子 Agent 已启动和完成时，使用 `stream.subagents`。你不需要订阅消息或值流，除非你访问子 Agent 上的这些投影。

```typescript
const stream = await agent.streamEvents(input, { version: "v3" });

let running = 0;    // 运行中的子 Agent 数量
let completed = 0;  // 已完成的子 Agent 数量
let failed = 0;     // 失败的子 Agent 数量
const watchers: Promise<void>[] = [];

for await (const subagent of stream.subagents) {
  running += 1;
  console.log(`${subagent.name}: started`);

  // 监听每个子 Agent 的完成状态
  watchers.push(
    subagent.output.then(
      () => {
        running -= 1;
        completed += 1;
        console.log(`${subagent.name}: completed`);
      },
      () => {
        running -= 1;
        failed += 1;
        console.log(`${subagent.name}: failed`);
      }
    )
  );
}

// 等待所有监听器完成
await Promise.all(watchers);
console.log({ running, completed, failed });
```

## 流式传输消息

Deep Agents 可以从协调器 Agent 和委托的子 Agent 发出消息。使用 `stream.messages` 获取顶级消息，使用 `subagent.messages` 获取每个委托的子 Agent。

### 分别获取协调器和子 Agent 消息

```typescript
const stream = await agent.streamEvents(input, { version: "v3" });

// 获取协调器（主 Agent）的消息
for await (const message of stream.messages) {
  console.log("[coordinator]", await message.text);
}

// 获取每个子 Agent 的消息
for await (const subagent of stream.subagents) {
  for await (const message of subagent.messages) {
    console.log(`[${subagent.name}]`, await message.text);
  }
}
```

### 流式传输工具调用

Deep Agents 在 Agent 树的每个层级暴露工具调用。使用顶级 `stream.toolCalls` 获取协调器工具，使用每个 `subagent.toolCalls` 获取委托的工作。

```typescript
const stream = await agent.streamEvents(input, { version: "v3" });

// 协调器的工具调用
for await (const call of stream.toolCalls) {
  console.log("[coordinator tool]", call.name, call.input);
  console.log(await call.status);
}

// 子 Agent 的工具调用
for await (const subagent of stream.subagents) {
  for await (const call of subagent.toolCalls) {
    console.log(`[${subagent.name} tool]`, call.name, call.input);

    const status = await call.status;
    if (status === "finished") {
      console.log(await call.output);
    } else if (status === "error") {
      console.error(await call.error);
    }
  }
}
```

## 流式传输嵌套工作

你可以递归进入子 Agent 流以观察嵌套的子 Agent、消息和工具调用。

```typescript
const stream = await agent.streamEvents(input, { version: "v3" });

for await (const subagent of stream.subagents) {
  console.log(`subagent ${subagent.name}: started`);

  // 子 Agent 的工具调用
  for await (const toolCall of subagent.toolCalls) {
    console.log(`${toolCall.name}(${JSON.stringify(toolCall.input)})`);

    const status = await toolCall.status;
    if (status === "finished") {
      console.log(await toolCall.output);
    } else if (status === "error") {
      console.error(await toolCall.error);
    }
  }

  // 嵌套的子 Agent（子 Agent 的子 Agent）
  for await (const nested of subagent.subagents) {
    console.log(`nested subagent ${nested.name}: started`);
  }
}
```

## 并发消费

协调器和子 Agent 的输出通常交错出现。当你需要实时 UI 更新时，并发消费各个投影。

### 使用 Promise.all 并发消费

```typescript
const stream = await agent.streamEvents(input, { version: "v3" });

await Promise.all([
  // 并发任务 1：消费协调器消息
  (async () => {
    for await (const message of stream.messages) {
      console.log("[coordinator]", await message.text);
    }
  })(),
  // 并发任务 2：消费子 Agent 消息
  (async () => {
    for await (const subagent of stream.subagents) {
      void (async () => {
        for await (const message of subagent.messages) {
          console.log(`[${subagent.name}]`, await message.text);
        }
      })();
    }
  })(),
]);
```

### 保持精确的到达顺序

当你需要协调器和所有子 Agent 之间的精确到达顺序时，迭代原始协议事件并使用 `namespace` 标识来源：

```typescript
const stream = await agent.streamEvents(input, { version: "v3" });

for await (const event of stream) {
  if (event.method !== "messages") continue;

  const data = event.params.data;
  if (data.event !== "content-block-delta") continue;

  const block = data.delta ?? {};
  if (block.type === "text-delta") {
    // 通过命名空间判断是子 Agent 还是协调器
    const isSubagent = event.params.namespace.some((seg) => seg.startsWith("tools:"));
    const source = isSubagent ? "subagent" : "coordinator";
    console.log(`[${source}] ${block.text}`);
  }
}
```

## 子 Agent 与子图

- `stream.subgraphs` 显示图执行结构
- `stream.subagents` 显示产品级的 Deep Agents 任务委托

对于面向用户的 UI，使用 `stream.subagents`，因为它隐藏了内部图节点并直接暴露子 Agent 概念。

## 关键要点

- **`stream.subagents`** 是 Deep Agents 的核心流式 API，为每个委托的子任务提供独立的流句柄
- 每个子 Agent 流可以暴露 `.messages`、`.toolCalls`、`.values`、`.subagents` 和 `.output`
- 使用 **并发消费者** 实现实时 UI 更新
- 使用 **原始事件迭代** 保持精确的消息到达顺序
- 子 Agent 流是轻量级的——消息和工具调用流仅在访问时才打开
