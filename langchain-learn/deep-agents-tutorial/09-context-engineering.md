# 上下文工程 - Context Engineering

## 概述

上下文工程是为深度智能体提供正确的信息、正确的工具和正确的格式，使其能够可靠地完成任务。深度智能体可以访问多种上下文来源：一些在启动时提供，另一些在运行时动态获取。深度智能体内置了在长时间运行会话中管理上下文的机制。

## 上下文类型总览

| 上下文类型 | 你的控制范围 | 作用范围 |
|------------|-------------|----------|
| **输入上下文** | 启动时进入智能体提示的内容（系统提示、记忆、技能） | 静态，每次运行应用 |
| **运行时上下文** | 调用时传递的静态配置（用户元数据、API 密钥、连接信息） | 每次运行，传播到子智能体 |
| **上下文压缩** | 内置的卸载和摘要机制，保持上下文在窗口限制内 | 自动，当接近限制时触发 |
| **上下文隔离** | 使用子智能体隔离繁重工作，只返回结果给主智能体 | 每个子智能体，委派时 |
| **长期记忆** | 使用虚拟文件系统跨线程持久化存储 | 跨对话持久 |

## 输入上下文

输入上下文是在启动时提供给深度智能体的信息，成为其系统提示的一部分。最终的提示由多个来源组成：

### 系统提示（System Prompt）

你的自定义系统提示会前置到内置系统提示之前。使用它来定义智能体的角色、行为和知识：

```typescript
import { createDeepAgent } from "deepagents";

const agent = await createDeepAgent({
  model: "google_genai:gemini-3.5-flash",
  systemPrompt: `你是一个专门研究科学文献的研究助手。
  始终引用来源。使用子智能体并行研究不同主题。`,
});
```

`systemPrompt` 参数是静态的，每次调用不会改变。如果需要动态提示（如根据用户角色显示 "你有管理员权限" vs "你只有只读权限"），可以使用 `dynamicSystemPromptMiddleware` 构建上下文感知的指令。

> **注意**：当工具本身使用上下文或 `runtime.store` 时，不需要中间件 —— 工具直接接收 `runtime` 对象（包括 `runtime.context` 和 `runtime.store`）。只有当系统提示本身需要随请求变化时才添加中间件。

### 记忆（Memory）

记忆文件（`AGENTS.md`）提供**始终加载**到系统提示中的持久上下文。将记忆用于项目约定、用户偏好和应该适用于每次对话的关键指南：

```typescript
const agent = await createDeepAgent({
  model: "google_genai:gemini-3.5-flash",
  // 记忆文件始终被注入 —— 没有渐进式披露
  memory: ["/project/AGENTS.md", "~/.deepagents/preferences.md"],
});
```

> **最佳实践**：保持记忆精简以避免上下文过载。对于详细的工作流和领域特定内容，使用技能（Skills）。

### 技能（Skills）

技能提供**按需**能力。智能体在启动时读取每个 `SKILL.md` 的前置元数据（frontmatter），只在确定技能相关时才加载完整内容。这减少了令牌使用，同时仍然提供专业化的工作流：

```typescript
const agent = await createDeepAgent({
  model: "google_genai:gemini-3.5-flash",
  // 技能按需加载 —— 渐进式披露
  skills: ["/skills/research/", "/skills/web-search/"],
});
```

> **最佳实践**：
> - 每个技能聚焦于单一工作流或领域
> - 将详细参考材料放在单独的文件中，在技能文件中引用
> - 将始终相关的约定放在记忆中，而不是技能中

### 工具提示（Tool Prompts）

工具提示是指导模型如何使用工具的指令。所有工具都会向模型暴露元数据 —— 通常是 schema 和描述。

**内置工具**：添加内置能力的中间件会自动将工具特定的指令追加到系统提示中：

- **规划提示** —— `write_todos` 的指令
- **文件系统提示** —— `ls`、`read_file`、`write_file` 等的文档
- **子智能体提示** —— 使用 `task` 工具委派工作的指南
- **人机协作提示** —— 在指定工具调用处暂停的用法
- **本地上下文提示** —— 当前目录和项目信息（仅 CLI）

**你提供的工具**：通过 `tools` 参数传递的工具会将其描述（来自工具 schema）发送给模型。确保提供清晰的名称、描述和参数说明：

```typescript
import { tool } from "langchain";
import { z } from "zod";

const searchOrders = tool(
  async ({ userId, status, limit }) => {
    // 搜索逻辑...
  },
  {
    name: "search_orders",
    description: `按状态搜索用户订单。

    当用户询问订单历史或想要检查订单状态时使用此工具。
    始终按提供的状态进行过滤。`,
    schema: z.object({
      userId: z.string().describe("用户的唯一标识符"),
      status: z.enum(["pending", "shipped", "delivered"]).describe("要过滤的订单状态"),
      limit: z.number().default(10).describe("返回结果的最大数量"),
    }),
  }
);
```

### 完整系统提示的组成

深度智能体的系统消息（模型在运行开始时收到的完整系统提示）由以下部分组成：

1. 自定义 `system_prompt`（如果提供）
2. 基础智能体提示
3. 待办事项列表提示
4. 记忆提示：`AGENTS.md` + 记忆使用指南（当提供 `memory` 时）
5. 技能提示：技能位置 + 前置元数据列表 + 使用说明（当提供 `skills` 时）
6. 虚拟文件系统提示
7. 子智能体提示：任务工具使用
8. 用户提供的中间件提示（如果有自定义中间件）
9. 人机协作提示（当设置 `interrupt_on` 时）

## 运行时上下文

运行时上下文是你在调用智能体时传递的每次运行配置。它不会自动包含在模型提示中；模型只在工具、中间件或其他逻辑读取它并将其添加到消息或系统提示时才能看到。

使用运行时上下文传递：用户元数据（ID、偏好、角色）、API 密钥、数据库连接、功能标志等。

```typescript
import { createDeepAgent } from "deepagents";
import { tool } from "langchain";
import type { ToolRuntime } from "@langchain/core/tools";
import { z } from "zod";

// 定义上下文的形状
const contextSchema = z.object({
  userId: z.string(),
  apiKey: z.string(),
});

// 在工具中读取运行时上下文
const fetchUserData = tool(
  async (input, runtime: ToolRuntime<unknown, typeof contextSchema>) => {
    // 访问运行时上下文中的用户 ID
    const userId = runtime.context?.userId;
    return `用户 ${userId} 的数据: ${input.query}`;
  },
  {
    name: "fetch_user_data",
    description: "获取当前用户的数据",
    schema: z.object({ query: z.string() }),
  }
);

const agent = await createDeepAgent({
  model: "google_genai:gemini-3.5-flash",
  tools: [fetchUserData],
  contextSchema,
});

// 调用时传递运行时上下文
const result = await agent.invoke(
  { messages: [{ role: "user", content: "获取我最近的活动" }] },
  { context: { userId: "user-123", apiKey: "sk-..." } },
);
```

**运行时上下文会传播到所有子智能体**。当子智能体运行时，它会接收与父智能体相同的运行时上下文。

## 上下文压缩

长时间运行的任务会产生大量工具输出和很长的对话历史。上下文压缩减少智能体工作记忆中的信息大小，同时保留与任务相关的细节。

### 卸载（Offloading）

当工具调用输入或结果超过令牌阈值（默认 20,000）时自动触发：

**工具调用输入超过 20,000 令牌**：
- 文件写入和编辑操作会在对话历史中留下包含完整文件内容的工具调用
- 由于内容已经持久化到文件系统，通常是冗余的
- 当会话上下文超过模型可用窗口的 85% 时，深度智能体会截断较旧的工具调用，替换为磁盘上的文件指针

**工具调用结果超过 20,000 令牌**：
- 深度智能体将响应卸载到配置的后端
- 替换为文件路径引用和前 10 行预览
- 智能体可以按需重新读取或搜索内容

### 多模态输入处理

深度智能体支持多模态输入（如图片），但内置的上下文管理机制主要面向文本。对于多模态工作负载：

- 将图片、截图和图表存储在文件系统后端或外部对象存储，然后通过消息传递路径或 URL
- 在长时间运行的对话中，优先使用引用而非 base64 编码的图片块
- 如果工具产生图片，让工具保存图片并返回简洁的文本描述加上路径或 URL
- 使用子智能体处理图片密集的检查工作，让主智能体接收紧凑的文本结果

### 摘要压缩（Summarization）

每个 `createDeepAgent` 调用都包含 `SummarizationMiddleware`。当上下文大小超过模型上下文窗口限制（85% 的 `max_input_tokens`），且没有更多上下文可以卸载时，深度智能体会自动摘要消息历史。

摘要过程包含两个组件：

1. **上下文内摘要**：LLM 生成结构化的会话摘要（包括会话意图、创建的工件和下一步），替换工作记忆中的完整对话历史
2. **文件系统保存**：原始对话消息的文本渲染被写入文件系统作为规范记录

**配置**：
- 在模型 `max_input_tokens` 的 85% 时触发
- 保留 10% 的令牌作为近期上下文
- 如果模型配置不可用，回退到 170,000 令牌触发 / 保留 6 条消息
- 如果模型调用引发 `ContextOverflowError`，立即回退到摘要并使用摘要 + 近期保留的消息重试

## 使用子智能体进行上下文隔离

子智能体解决**上下文膨胀问题**。当主智能体使用工具产生大量输出时，上下文窗口会快速填满。子智能体隔离这些工作 —— 主智能体只接收最终结果。

### 工作原理

1. 主智能体使用 `task` 工具委派工作
2. 子智能体在全新的上下文中运行
3. 子智能体自主执行直到完成
4. 子智能体返回单个最终报告给主智能体
5. 主智能体的上下文保持干净

### 最佳实践

1. **委派复杂任务**：使用子智能体处理会使主智能体上下文混乱的多步骤工作
2. **保持子智能体响应简洁**：指示子智能体返回摘要，而非原始数据：

```typescript
const researchSubagent = {
  name: "researcher",
  description: "对特定主题进行研究",
  systemPrompt: `你是一个研究助手。
  重要：只返回必要的摘要（500字以内）。
  不要包含原始搜索结果或详细的工具输出。`,
  tools: [webSearch],
};
```

3. **使用文件系统处理大数据**：子智能体可以将结果写入文件；主智能体按需读取

## 长期记忆

使用默认文件系统时，深度智能体将工作记忆文件存储在智能体状态中，只在线程内持久化。

长期记忆使深度智能体能够跨不同线程和对话持久化信息，如用户偏好、累积知识、研究进度等。

### 配置长期记忆

使用 `CompositeBackend` 将特定路径（通常是 `/memories/`）路由到 LangGraph Store：

```typescript
import {
  createDeepAgent,
  CompositeBackend,
  StateBackend,
  StoreBackend
} from "deepagents";
import { InMemoryStore } from "@langchain/langgraph-checkpoint";

const agent = await createDeepAgent({
  model: "google_genai:gemini-3.5-flash",
  store: new InMemoryStore(),
  backend: new CompositeBackend(
    new StateBackend(),                         // 默认：线程范围的临时空间
    { "/memories/": new StoreBackend() },       // /memories/ 路径跨线程持久化
  ),
  systemPrompt: `当用户告诉你他们的偏好时，保存到 /memories/user_preferences.txt，
  这样你就能在未来的对话中记住它们。`,
});
```

> **注意**：你不需要预先填充 `/memories/`。你提供后端配置、存储和系统提示指令，告诉智能体**保存什么**和**保存到哪里**。路径初始为空，智能体在用户分享值得记住的信息时按需创建文件。

## 最佳实践

1. **从正确的输入上下文开始** —— 保持记忆精简用于始终相关的约定；使用聚焦的技能提供任务特定的能力
2. **利用子智能体处理繁重工作** —— 委派多步骤、输出密集的任务以保持主智能体的上下文干净
3. **在配置中调整子智能体输出** —— 如果在调试时发现子智能体产生长输出，可以在子智能体的 `system_prompt` 中添加摘要指导
4. **使用文件系统** —— 将大量输出持久化到文件（如子智能体写入或自动卸载），使活跃上下文保持小巧；模型可以在需要时通过 `read_file` 和 `grep` 拉取片段
5. **记录长期记忆结构** —— 告诉智能体 `/memories/` 中存放什么以及如何使用
6. **为工具传递运行时上下文** —— 使用 `context` 传递工具需要的用户元数据、API 密钥和其他静态配置

## 小结

| 主题 | 要点 |
|------|------|
| 输入上下文 | 系统提示 + 记忆 + 技能 + 工具提示 |
| 运行时上下文 | 每次调用的配置，传播到子智能体 |
| 卸载 | 超过 20K 令牌的工具输入/结果自动卸载到文件系统 |
| 摘要压缩 | 85% 窗口时自动摘要历史 |
| 子智能体隔离 | 委派繁重工作，保持主上下文干净 |
| 长期记忆 | CompositeBackend + StoreBackend 实现跨对话持久化 |

## 相关章节

- [核心能力](./06-core-capabilities.md) - 内置能力详解
- [工具](./08-tools.md) - 自定义工具定义和 MCP 集成
- [投入生产](./05-going-to-production.md) - 生产环境中的记忆和存储配置
