# 前端概览 - Frontend Overview

> 本章节介绍如何为 Deep Agents 构建实时可视化的前端界面。

## 概述

Deep Agents 的前端模式展示如何实时渲染子代理进度、任务规划、流式内容以及类似 IDE 的沙盒体验。这些前端界面基于 `createDeepAgent` 创建的代理构建。

当 UI 使任务委托过程可见时，Deep Agents 最为有用。LangChain SDK 不再显示单一的不透明助手气泡，而是暴露协调器、子代理发现、自定义状态和沙盒支持的结果，让用户可以检查长时间运行的任务是如何被分解和完成的。

## 架构

Deep Agents 使用**协调器-工作者（coordinator-worker）架构**。主代理规划任务并委派给专门的子代理，每个子代理在隔离环境中运行。在前端，v1 流式处理句柄在根流上显示协调器消息，并为特定子代理视图暴露子代理发现快照。

```typescript
// 导入 Deep Agent 创建函数
import { createDeepAgent } from "deepagents";

// 创建一个带有工具和子代理的 Deep Agent
const agent = createDeepAgent({
  tools: [getWeather],                          // 代理可用的工具列表
  systemPrompt: "You are a helpful assistant",  // 系统提示词
  subagents: [
    {
      name: "researcher",                       // 子代理名称
      description: "Research assistant",        // 子代理描述
    },
  ],
});
```

在前端，使用 `useStream` 连接代理，方式与 `createAgent` 相同。传入类型参数以实现类型安全的流状态。Deep Agent 模式使用 `stream.subagents`、选择器辅助函数（如 `useMessages(stream, subagent)`）以及自定义状态值（如 `stream.values.todos`）来渲染子代理特定的 UI。

```typescript
import { useStream } from "@langchain/react";

function App() {
  // 连接到代理流，使用类型参数确保类型安全
  const stream = useStream<typeof agent>({
    apiUrl: "http://localhost:2024",  // 代理服务端地址
    assistantId: "agent",             // 助手 ID
  });

  // 获取 Deep Agent 的额外状态（不仅仅是消息）
  const todos = stream.values?.todos;           // 任务列表
  const subagents = [...stream.subagents.values()]; // 所有子代理
}
```

## SDK 暴露的数据

Deep Agent UI 通常需要比最终答案更多的数据。前端 SDK 提供了结构化的数据投影，用于渲染用户关心的运行部分：

| 投影（Projection） | 用途 |
|---|---|
| `stream.messages` | 协调器对话和最终综合结果 |
| `stream.subagents` | 专业工作者的实时发现，包括状态和任务元数据 |
| `stream.values` | 共享状态，如待办事项、计划、报告章节、沙盒元数据或代理写入的任何自定义键 |
| 工具调用状态 | 将文件系统、搜索、浏览器或领域工具渲染为带有进度和结果的卡片 |
| 中断（Interrupts） | 暂停委派工作以等待用户批准或缺失输入，而不丢失运行状态 |

这使得您可以构建更接近 IDE、任务板或工作流监控器的界面，而不是简单的聊天记录。

## 兼容性

LangChain 前端模式（包括 Markdown 消息、工具调用和人机交互）都与 Deep Agents 兼容。Deep Agents 构建在相同的 LangGraph 运行时之上，因此 `useStream` 提供了相同的核心 API。

对于更底层的图可视化，请参阅 LangGraph 前端模式，它们展示了如何将图节点和状态键直接映射到 UI 组件。

## 小结

- Deep Agents 前端基于**协调器-工作者架构**，支持实时子代理可视化
- 使用 `useStream` Hook 连接到代理流
- 通过 `stream.subagents`、`stream.values` 等获取丰富的代理状态
- 支持工具调用状态渲染和中断处理
- 完全兼容 LangGraph 运行时的前端模式
