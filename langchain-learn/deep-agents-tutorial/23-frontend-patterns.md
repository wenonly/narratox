# 前端模式 - Frontend Patterns

> 本章节介绍 Deep Agents 前端的常见 UI 模式和最佳实践。

## 概述

Deep Agents 的前端模式建立在 LangGraph 运行时之上，提供了丰富的 UI 组件模式。这些模式与标准 LangChain 前端模式完全兼容，包括 Markdown 消息渲染、工具调用展示和人机交互（Human-in-the-loop）。

## 核心前端模式

### 1. 消息渲染模式

Deep Agents 前端需要渲染多种类型的消息内容：

```typescript
import { useStream } from "@langchain/react";

function MessageList({ stream }) {
  return (
    <div>
      {stream.messages.map((msg, index) => (
        <div key={index} className={msg.role}>
          {/* 渲染 Markdown 格式的消息内容 */}
          <ReactMarkdown>{msg.content}</ReactMarkdown>
        </div>
      ))}
    </div>
  );
}
```

### 2. 子代理状态展示

实时展示子代理的发现和运行状态：

```typescript
function SubagentStatus({ stream }) {
  // 获取所有子代理的实时状态
  const subagents = [...stream.subagents.values()];

  return (
    <div className="subagent-panel">
      {subagents.map((agent) => (
        <div key={agent.name} className="subagent-card">
          <h3>{agent.name}</h3>
          <span className={`status status-${agent.status}`}>
            {agent.status}
          </span>
          {/* 显示子代理的任务元数据 */}
          {agent.task && <p>{agent.task.description}</p>}
        </div>
      ))}
    </div>
  );
}
```

### 3. 任务进度追踪

使用 `stream.values` 追踪任务进度：

```typescript
function TaskProgress({ stream }) {
  // 从共享状态中获取待办事项列表
  const todos = stream.values?.todos || [];

  return (
    <div className="task-board">
      {todos.map((todo, index) => (
        <div key={index} className={`task task-${todo.status}`}>
          <span className="task-title">{todo.title}</span>
          <span className="task-status">{todo.status}</span>
        </div>
      ))}
    </div>
  );
}
```

### 4. 工具调用卡片

将工具调用渲染为交互式卡片：

```typescript
function ToolCallCard({ toolCall }) {
  return (
    <div className="tool-card">
      <div className="tool-header">
        <span className="tool-name">{toolCall.name}</span>
        <span className="tool-status">{toolCall.status}</span>
      </div>
      {/* 显示工具参数 */}
      <pre className="tool-args">
        {JSON.stringify(toolCall.args, null, 2)}
      </pre>
      {/* 显示工具结果 */}
      {toolCall.result && (
        <div className="tool-result">
          {toolCall.result}
        </div>
      )}
    </div>
  );
}
```

### 5. 中断与审批处理

处理需要用户审批的中断：

```typescript
function InterruptHandler({ stream }) {
  // 检查是否有待处理的中断
  const interrupt = stream.interrupt;

  if (!interrupt) return null;

  return (
    <div className="interrupt-dialog">
      <p>代理请求执行以下操作：</p>
      <pre>{JSON.stringify(interrupt.value, null, 2)}</pre>
      <div className="interrupt-actions">
        <button onClick={() => stream.resume({ decision: "approve" })}>
          批准
        </button>
        <button onClick={() => stream.resume({ decision: "reject" })}>
          拒绝
        </button>
      </div>
    </div>
  );
}
```

## 完整应用示例

```typescript
import { useStream } from "@langchain/react";
import { createDeepAgent } from "deepagents";

// 创建 Deep Agent 实例
const agent = createDeepAgent({
  tools: [],
  systemPrompt: "You are a helpful assistant",
  subagents: [
    { name: "researcher", description: "Research assistant" },
    { name: "writer", description: "Content writer" },
  ],
});

function DeepAgentApp() {
  const stream = useStream<typeof agent>({
    apiUrl: "http://localhost:2024",
    assistantId: "agent",
  });

  return (
    <div className="deep-agent-app">
      {/* 主对话区域 */}
      <main>
        <MessageList stream={stream} />
        <ToolCallCards stream={stream} />
        <InterruptHandler stream={stream} />
      </main>

      {/* 侧边栏 - 子代理状态 */}
      <aside>
        <SubagentStatus stream={stream} />
        <TaskProgress stream={stream} />
      </aside>
    </div>
  );
}
```

## 设计建议

1. **信息分层展示**：不要在一个视图中堆叠所有信息，使用标签页或折叠面板组织内容
2. **实时更新**：利用流式更新提供即时反馈
3. **状态可视化**：使用颜色编码和图标清晰表示不同状态
4. **中断处理友好**：为用户提供清晰的操作选项和解释
5. **响应式设计**：确保在不同屏幕尺寸上都能良好展示

## 小结

- Deep Agents 前端模式与标准 LangChain 前端完全兼容
- 核心模式包括：消息渲染、子代理状态、任务进度、工具调用卡片和中断处理
- 使用 `useStream` Hook 作为连接前端与代理的核心接口
- 建议构建类似 IDE 或任务板的界面，而非简单聊天界面
