# 模型上下文协议 - Model Context Protocol (MCP)

> MCP 是一种开放协议，标准化了应用程序向 LLM 提供工具和上下文的方式。

## 概述

Model Context Protocol (MCP) 是一种开放协议，标准化了应用程序如何向 LLM 提供工具和上下文。LangChain 代理可以使用 `@langchain/mcp-adapters` 库来使用定义在 MCP 服务器上的工具。

`@langchain/mcp-adapters` 使代理能够使用跨多个 MCP 服务器定义的工具。

## 访问多个 MCP 服务器

```typescript
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { ChatAnthropic } from "@langchain/anthropic";
import { createAgent } from "langchain";

// 创建 MCP 客户端，连接到多个 MCP 服务器
const client = new MultiServerMCPClient({
    math: {
        transport: "stdio",  // 本地子进程通信
        command: "node",
        // 替换为你的 math_server.js 文件的绝对路径
        args: ["/path/to/math_server.js"],
    },
    weather: {
        transport: "http",  // 基于 HTTP 的远程服务器
        // 确保天气服务器在 8000 端口上运行
        url: "http://localhost:8000/mcp",
    },
});

// 获取所有 MCP 服务器提供的工具
const tools = await client.getTools();

// 创建使用这些工具的代理
const agent = createAgent({
    model: "claude-sonnet-4-6",
    tools,
});

// 调用代理执行数学计算
const mathResponse = await agent.invoke({
    messages: [{ role: "user", content: "what's (3 + 5) x 12?" }],
});

// 调用代理查询天气
const weatherResponse = await agent.invoke({
    messages: [{ role: "user", content: "what is the weather in nyc?" }],
});
```

## 创建自定义 MCP 服务器

使用 `@modelcontextprotocol/sdk` 库创建自己的 MCP 服务器。

### 数学服务器（stdio 传输）

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// 创建 MCP 服务器实例
const server = new Server(
    {
        name: "math-server",
        version: "0.1.0",
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

// 注册工具列表处理器
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
        {
            name: "add",         // 加法工具
            description: "Add two numbers",
            inputSchema: {
                type: "object",
                properties: {
                    a: { type: "number", description: "First number" },
                    b: { type: "number", description: "Second number" },
                },
                required: ["a", "b"],
            },
        },
        {
            name: "multiply",    // 乘法工具
            description: "Multiply two numbers",
            inputSchema: {
                type: "object",
                properties: {
                    a: { type: "number", description: "First number" },
                    b: { type: "number", description: "Second number" },
                },
                required: ["a", "b"],
            },
        },
        ],
    };
});

// 注册工具调用处理器
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    switch (request.params.name) {
        case "add": {
            const { a, b } = request.params.arguments as { a: number; b: number };
            return {
                content: [{ type: "text", text: String(a + b) }],
            };
        }
        case "multiply": {
            const { a, b } = request.params.arguments as { a: number; b: number };
            return {
                content: [{ type: "text", text: String(a * b) }],
            };
        }
        default:
            throw new Error(`Unknown tool: ${request.params.name}`);
    }
});

// 启动服务器
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Math MCP server running on stdio");
}

main();
```

### 天气服务器（SSE 传输）

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import express from "express";

const app = express();
app.use(express.json());

// 创建天气 MCP 服务器
const server = new Server(
    { name: "weather-server", version: "0.1.0" },
    { capabilities: { tools: {} } }
);

// 定义可用工具
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
        {
            name: "get_weather",
            description: "Get weather for location",
            inputSchema: {
                type: "object",
                properties: {
                    location: {
                        type: "string",
                        description: "Location to get weather for",
                    },
                },
                required: ["location"],
            },
        },
        ],
    };
});

// 处理工具调用
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    switch (request.params.name) {
        case "get_weather": {
            const { location } = request.params.arguments as { location: string };
            return {
                content: [
                    {
                        type: "text",
                        text: `It's always sunny in ${location}`,
                    },
                ],
            };
        }
        default:
            throw new Error(`Unknown tool: ${request.params.name}`);
    }
});

// 设置 HTTP 端点
app.post("/mcp", async (req, res) => {
    const transport = new SSEServerTransport("/mcp", res);
    await server.connect(transport);
});

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
    console.log(`Weather MCP server running on port ${PORT}`);
});
```

## 传输机制

MCP 支持不同的传输机制用于客户端-服务器通信：

### HTTP 传输（streamable-http）

使用 HTTP 请求进行通信：

```typescript
const client = new MultiServerMCPClient({
    weather: {
        transport: "sse",
        url: "http://localhost:8000/mcp",
    },
});
```

### stdio 传输

客户端启动服务器作为子进程，通过标准输入/输出通信。适合本地工具和简单配置：

```typescript
const client = new MultiServerMCPClient({
    math: {
        transport: "stdio",
        command: "node",
        args: ["/path/to/math_server.js"],
    },
});
```

## 获取和使用工具

工具允许 MCP 服务器暴露 LLM 可以调用的可执行函数。LangChain 将 MCP 工具转换为 LangChain 工具，使其可以在任何 LangChain 代理或工作流中直接使用。

```typescript
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { createAgent } from "langchain";

const client = new MultiServerMCPClient({...});

// 从 MCP 服务器获取工具
const tools = await client.getTools();

// 将工具传递给代理
const agent = createAgent({ model: "claude-sonnet-4-6", tools });
```

### 错误处理

当 MCP 工具执行失败（`CallToolResult` 的 `isError: true`）时，`@langchain/mcp-adapters` 会抛出 `ToolException`。使用 try/catch 包裹工具调用以处理这些错误。与 Python 适配器不同，TypeScript 适配器不会将错误作为失败的工具消息返回给模型。

## 小结

- MCP 协议标准化了 LLM 工具和上下文提供方式
- `@langchain/mcp-adapters` 支持同时连接多个 MCP 服务器
- 支持 stdio（本地子进程）和 HTTP/SSE（远程）两种传输方式
- 可以使用 `@modelcontextprotocol/sdk` 创建自定义 MCP 服务器
- MCP 工具自动转换为 LangChain 工具，可直接用于代理
- 工具执行失败时抛出 `ToolException`，需使用 try/catch 处理
