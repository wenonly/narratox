# 快速入门 - Quickstart

> 本教程将引导你在几分钟内构建第一个 Deep Agent（深度智能体），包含规划、文件系统工具和子智能体能力。你将构建一个能够进行研究并撰写报告的研究智能体。

---

## 概述

LangChain Deep Agents 是一个用于构建自定义智能体的框架。它提供开箱即用的功能，包括：

- **自动规划**：智能体能够自动分解任务
- **文件系统工具**：读写文件以管理上下文
- **子智能体**：将复杂子任务委派给专门的子智能体
- **内置流式传输**：实时获取智能体执行过程

---

## 前置条件

在开始之前，请确保你拥有一个模型提供商的 API 密钥（例如 Gemini、Anthropic、OpenAI）。

---

## 第一步：安装依赖

```bash
npm install deepagents @langchain/tavily langchain zod
```

---

## 第二步：设置 API 密钥

根据你选择的模型提供商，设置对应的环境变量：

### Google

```bash
export GOOGLE_API_KEY="your-api-key"
export TAVILY_API_KEY="your-tavily-api-key"
```

### OpenAI

```bash
export OPENAI_API_KEY="your-api-key"
export TAVILY_API_KEY="your-tavily-api-key"
```

### Anthropic

```bash
export ANTHROPIC_API_KEY="your-api-key"
export TAVILY_API_KEY="your-tavily-api-key"
```

### OpenRouter

```bash
export OPENROUTER_API_KEY="your-api-key"
export TAVILY_API_KEY="your-tavily-api-key"
```

### Fireworks

```bash
export FIREWORKS_API_KEY="your-api-key"
export TAVILY_API_KEY="your-tavily-api-key"
```

### Baseten

```bash
export BASETEN_API_KEY="your-api-key"
export TAVILY_API_KEY="your-tavily-api-key"
```

### Ollama（本地运行）

```bash
# 本地：Ollama 必须在你的机器上运行
# 云端：设置你的 Ollama API 密钥
export OLLAMA_API_KEY="your-api-key"
export TAVILY_API_KEY="your-tavily-api-key"
```

> **提示**：Deep Agents 兼容任何 LangChain 聊天模型。只需设置你所用提供商的 API 密钥即可。

---

## 第三步：创建搜索工具

以下代码创建一个网络搜索工具，供智能体在执行研究任务时使用：

```typescript
import { tool } from "langchain";
import { TavilySearch } from "@langchain/tavily";
import { z } from "zod";

// 创建一个网络搜索工具
// 使用 Tavily 搜索 API 执行互联网搜索
const internetSearch = tool(
  async ({
    query,
    maxResults = 5,
    topic = "general",
    includeRawContent = false,
  }: {
    query: string;              // 搜索查询关键词
    maxResults?: number;        // 最大返回结果数，默认 5
    topic?: "general" | "news" | "finance";  // 搜索主题类别
    includeRawContent?: boolean; // 是否包含原始内容
  }) => {
    // 初始化 Tavily 搜索实例
    const tavilySearch = new TavilySearch({
      maxResults,
      tavilyApiKey: process.env.TAVILY_API_KEY,
      includeRawContent,
      topic,
    });
    // 执行搜索并返回结果
    return await tavilySearch._call({ query });
  },
  {
    name: "internet_search",
    description: "Run a web search",  // 工具描述：执行网络搜索
    schema: z.object({
      query: z.string().describe("The search query"),
      maxResults: z
        .number()
        .optional()
        .default(5)
        .describe("Maximum number of results to return"),
      topic: z
        .enum(["general", "news", "finance"])
        .optional()
        .default("general")
        .describe("Search topic category"),
      includeRawContent: z
        .boolean()
        .optional()
        .default(false)
        .describe("Whether to include raw content"),
    }),
  },
);
```

**关键概念说明**：

- `tool()` 函数用于定义自定义工具，第一个参数是工具的执行函数，第二个参数是工具的元信息
- `z.object()` 使用 Zod 库定义工具的输入参数模式（schema），用于参数验证
- `description` 字段非常重要，它会帮助智能体理解何时应该调用该工具

---

## 第四步：创建 Deep Agent

使用 `createDeepAgent` 创建深度智能体。可以传入 `provider:model` 格式的模型字符串，或传入已初始化的模型实例：

```typescript
import { createDeepAgent } from "deepagents";

// 创建深度智能体
// model 参数使用 "provider:model" 格式
const agent = await createDeepAgent({
  model: "anthropic:claude-sonnet-4-6",  // 指定模型提供商和模型名称
  tools: [internetSearch],                // 传入自定义工具
});
```

> **支持的模型格式**：`"google_genai:gemini-3.5-flash"`、`"openai:gpt-4o"` 等。完整列表请参阅官方文档中的「支持模型」页面。

---

## 第五步：运行智能体

调用智能体并获取结果：

```typescript
// 调用智能体，传入用户消息
const result = await agent.invoke({
  messages: [{ role: "user", content: "What is langgraph?" }],
});

// 打印智能体的响应（取最后一条消息的内容）
console.log(result.messages[result.messages.length - 1].content);
```

---

## 工作原理

你的 Deep Agent 会自动执行以下步骤：

1. **规划方法**：使用内置的 `write_todos` 工具将研究任务分解为多个子任务
2. **进行研究**：调用 `internet_search` 工具收集信息
3. **管理上下文**：使用文件系统工具（`write_file`、`read_file`）来卸载大量搜索结果，避免上下文窗口溢出
4. **生成子智能体**：根据需要生成子智能体，将复杂子任务委派给专门的智能体处理
5. **综合报告**：将各项发现汇总为连贯的响应

---

## 流式传输（Streaming）

Deep Agents 内置了基于 LangGraph 的流式传输功能，用于获取智能体执行的实时更新。

这使你可以逐步观察输出，并审查和调试智能体及子智能体的工作过程，包括工具调用、工具结果和 LLM 响应。

```typescript
// 流式传输示例
const stream = await agent.stream({
  messages: [{ role: "user", content: "What is langgraph?" }],
});

for await (const event of stream) {
  // 处理每个流式事件
  console.log(event);
}
```

---

## 下一步

完成第一个 Deep Agent 后，你可以继续探索：

- **自定义智能体**：了解自定义选项，包括自定义系统提示词、工具和子智能体
- **添加长期记忆**：启用跨对话的持久化记忆
- **部署到生产环境**：使用 Managed Deep Agents 在 LangSmith 中创建、运行和运维深度智能体
