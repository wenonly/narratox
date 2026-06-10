# 核心能力 - Core Capabilities

## 概述

深度智能体（Deep Agents）内置了一系列核心能力，使其能够处理复杂、长时间运行的任务。这些能力包括规划（Planning）、文件系统操作（Filesystem）、子智能体（Subagents）、上下文管理（Context Management）和人机协作（Human-in-the-Loop）。

这些能力通过中间件栈（Middleware Stack）自动注入到每个深度智能体中，无需手动配置。

## 内置工具概览

每个深度智能体都自带以下内置工具：

| 工具 | 说明 |
|------|------|
| `ls` | 列出目录中的文件 |
| `read_file` | 读取文件内容（支持分页和多模态） |
| `write_file` | 创建新文件 |
| `edit_file` | 在文件中执行精确字符串替换 |
| `glob` | 按 glob 模式查找文件 |
| `grep` | 搜索文件内容 |
| `execute` | 运行 shell 命令（仅沙盒后端） |
| `task` | 生成子智能体处理委派的任务 |
| `write_todos` | 管理结构化的待办事项列表 |

## 规划能力（Planning）

深度智能体使用 `write_todos` 工具来维护结构化的任务列表，帮助它规划和追踪复杂的多步骤任务。

### 工作原理

1. 接收到复杂任务后，智能体首先分解为子任务
2. 使用 `write_todos` 创建待办事项列表
3. 在执行过程中逐步更新任务状态
4. 确保不遗漏任何步骤

### 示例

```typescript
import { createDeepAgent } from "deepagents";

const agent = await createDeepAgent({
  model: "google_genai:gemini-3.5-flash",
  systemPrompt: `你是一个项目管理助手。
  收到任务后，首先用 write_todos 创建详细的任务分解。
  每完成一个步骤后更新待办列表的状态。`,
});

// 智能体会自动使用 write_todos 来规划任务
const result = await agent.invoke({
  messages: [{
    role: "user",
    content: "帮我重构这个项目的所有 API 端点，添加错误处理和日志"
  }],
});
```

## 文件系统操作（Filesystem）

深度智能体拥有完整的虚拟文件系统能力，可以读取、创建、编辑和搜索文件。

### 虚拟文件系统（Virtual Filesystem）

深度智能体的文件系统是虚拟化的，后端可以是：

- **本地文件系统**：开发时直接读写磁盘文件
- **StateBackend**：线程范围的临时文件空间
- **StoreBackend**：跨线程的持久化存储
- **CompositeBackend**：混合使用，部分路径线程范围、部分路径跨线程
- **沙盒后端**：隔离容器中的文件系统（如 Daytona）

### 文件操作示例

```typescript
import { createDeepAgent } from "deepagents";

const agent = await createDeepAgent({
  model: "google_genai:gemini-3.5-flash",
  systemPrompt: `你是一个代码助手。
  使用 ls 和 glob 浏览项目结构。
  使用 read_file 阅读代码。
  使用 write_file 创建新文件。
  使用 edit_file 修改现有文件。`,
});
```

### 文件搜索能力

深度智能体可以使用 `grep` 搜索文件内容，使用 `glob` 按模式匹配文件名：

```typescript
// 智能体可以执行以下操作：
// grep - 在所有文件中搜索 "TODO" 关键字
// glob - 查找所有 *.test.ts 文件
// read_file - 读取搜索到的文件内容
```

## 子智能体（Subagents）

子智能体是深度智能体的关键能力之一。它解决了**上下文膨胀问题** —— 当主智能体使用工具产生大量输出时，上下文窗口会快速填满。

### 工作原理

1. 主智能体使用 `task` 工具委派工作
2. 子智能体在全新的上下文中运行
3. 子智能体自主执行直到完成
4. 子智能体返回单个最终报告给主智能体
5. 主智能体的上下文保持干净

### 配置子智能体

```typescript
import { createDeepAgent } from "deepagents";

const agent = await createDeepAgent({
  model: "google_genai:gemini-3.5-flash",
  systemPrompt: `你是一个研究协调员。
  使用子智能体并行研究不同的主题。
  每个子智能体应该返回简洁的摘要，不要原始数据。`,
  subagents: [
    {
      name: "researcher",
      description: "对特定主题进行研究",
      systemPrompt: `你是一个研究助手。
      重要：只返回必要的摘要（500字以内）。
      不要包含原始搜索结果或详细的工具输出。`,
    },
    {
      name: "coder",
      description: "编写和修改代码",
      systemPrompt: `你是一个编程助手。
      编写代码后运行测试验证。
      返回修改的文件列表和测试结果摘要。`,
    },
  ],
});
```

### 子智能体的上下文隔离

子智能体隔离大量工作，主智能体只接收最终结果：

- 子智能体有自己独立的上下文窗口
- 工具调用产生的中间结果不会污染主智能体的上下文
- 运行时上下文自动传播到所有子智能体

## 上下文管理（Context Management）

深度智能体内置了多种上下文管理机制，确保在长时间运行的会话中不会超出模型的上下文窗口限制。

### 内容卸载（Offloading）

当工具调用的输入或结果超过令牌阈值（默认 20,000）时：

1. **工具调用输入超过阈值**：大文件写入操作的完整内容会被截断，替换为指向磁盘文件的引用
2. **工具调用结果超过阈值**：大结果会被卸载到后端，替换为文件路径引用和前10行预览

### 摘要压缩（Summarization）

当上下文大小超过模型上下文窗口限制的 85% 时：

1. LLM 生成结构化的会话摘要
2. 原始消息被写入文件系统作为记录
3. 摘要替换完整历史，智能体保持对目标和进度的感知

```typescript
// 摘要压缩配置（自动包含在默认中间件栈中）
// - 在模型 max_input_tokens 的 85% 时触发
// - 保留 10% 的令牌作为近期上下文
// - 回退到 170,000 令牌触发 / 保留6条消息（如果模型配置不可用）
```

### 多模态输入

深度智能体支持多模态输入（如图片），但内置的上下文管理主要面向文本：

```typescript
// 多模态处理的最佳实践：
// - 将图片存储在文件系统后端或外部对象存储，传递路径或 URL
// - 在长时间运行的对话中，优先使用引用而非 base64 编码
// - 如果工具产生图片，让工具保存图片并返回文本描述 + 路径
// - 使用子智能体处理图片密集的工作
```

## 人机协作（Human-in-the-Loop）

深度智能体支持在特定工具调用处暂停执行，等待人工确认后继续。

### 配置中断点

```typescript
import { createDeepAgent } from "deepagents";

const agent = await createDeepAgent({
  model: "google_genai:gemini-3.5-flash",
  interruptOn: ["write_file", "execute"],  // 在这些工具调用前暂停
  systemPrompt: `你是一个需要人工审核的助手。
  在创建或修改文件之前，你会暂停等待确认。`,
});
```

### 检查点支持

得益于 LangGraph 的检查点机制，人机协作可以：
- 暂停数分钟甚至数天，然后从暂停处恢复
- 每个检查点都是可回退的快照
- 提供审计追踪

## 中间件栈（Middleware Stack）

深度智能体的核心能力通过中间件栈组织。每个 `createDeepAgent` 调用包含以下默认中间件：

| 中间件 | 说明 |
|--------|------|
| 文件系统中间件 | 添加 `ls`、`read_file`、`write_file` 等工具 |
| 规划中间件 | 添加 `write_todos` 工具和规划指令 |
| 子智能体中间件 | 添加 `task` 工具和子智能体管理 |
| 摘要中间件 | 自动压缩超出窗口限制的上下文 |
| 人机协作中间件 | 在指定工具调用处中断（当 `interrupt_on` 设置时） |

### 自定义中间件

你可以添加自定义中间件来扩展智能体的能力：

```typescript
import { createMiddleware } from "langchain";
import { createDeepAgent } from "deepagents";

// 自定义中间件：记录每次工具调用
const loggingMiddleware = createMiddleware({
  name: "LoggingMiddleware",
  wrapToolCall: async (request, handler) => {
    console.log(`工具调用: ${request.toolName}`);
    const result = await handler(request);
    console.log(`工具结果: ${JSON.stringify(result).slice(0, 100)}`);
    return result;
  },
});

const agent = await createDeepAgent({
  model: "google_genai:gemini-3.5-flash",
  middleware: [loggingMiddleware],
});
```

## 小结

| 能力 | 要点 |
|------|------|
| 规划 | `write_todos` 创建结构化任务列表 |
| 文件系统 | 虚拟化的文件读写、搜索能力 |
| 子智能体 | 上下文隔离，委派复杂任务 |
| 上下文管理 | 自动卸载和摘要压缩 |
| 人机协作 | 在关键操作前暂停等待确认 |
| 中间件 | 可扩展的钩子系统 |

## 相关章节

- [上下文工程](./09-context-engineering.md) - 详细的上下文管理策略
- [工具](./08-tools.md) - 自定义工具和 MCP 集成
- [投入生产](./05-going-to-production.md) - 安全防护和中间件配置
