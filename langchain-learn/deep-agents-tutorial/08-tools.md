# 工具集成 - Tools

## 概述

Deep Agents 可以调用你定义的任何工具、任何 LangChain 工具，以及来自任何 MCP 服务器的工具。通过 `tools` 参数将它们传递给 `createDeepAgent`，与内置的规划、文件管理和子智能体工具一起使用。

## 传递工具

将自定义工具传递给深度智能体：

```typescript
import { createDeepAgent } from "deepagents";

const agent = await createDeepAgent({
  model: "anthropic:claude-sonnet-4-6",
  tools: [search, fetchUrl, runQuery],  // 你的自定义工具
});
```

可以传递任何可调用对象 —— 普通函数、LangChain `@tool` 装饰的函数或工具字典。Deep Agents 会从函数签名和文档字符串推断工具的 schema，大多数情况下不需要单独定义 schema。

## 自定义工具

### 使用 `tool` 函数定义工具

```typescript
import { tool } from "langchain";
import { z } from "zod";
import { createDeepAgent } from "deepagents";

// 定义搜索订单的工具
const searchOrders = tool(
  async ({ userId, status, limit }) => {
    // 实际的业务逻辑
    const orders = await db.query(
      "SELECT * FROM orders WHERE user_id = ? AND status = ? LIMIT ?",
      [userId, status, limit]
    );
    return JSON.stringify(orders);
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

// 将工具添加到智能体
const agent = await createDeepAgent({
  model: "google_genai:gemini-3.5-flash",
  tools: [searchOrders],
});
```

### 工具定义最佳实践

编写工具描述时，确保提供：

1. **清晰的名称**：描述工具的功能
2. **详细的描述**：包括**何时**使用该工具以及每个参数的作用
3. **参数描述**：使用 `.describe()` 为每个参数添加说明

```typescript
// 好的工具描述示例
const fetchWeather = tool(
  async ({ city, unit }) => {
    const response = await fetch(
      `https://api.weather.com/${city}?unit=${unit}`
    );
    return await response.json();
  },
  {
    name: "fetch_weather",
    description: `获取指定城市的当前天气信息。

    当用户询问天气、温度或天气相关问题时使用此工具。
    不要用于历史天气数据。`,
    schema: z.object({
      city: z.string().describe("城市名称，如 'Beijing'、'Shanghai'"),
      unit: z.enum(["celsius", "fahrenheit"]).default("celsius").describe("温度单位"),
    }),
  }
);
```

### 访问运行时上下文

工具可以通过 `runtime` 参数访问运行时上下文，包括用户信息、API 密钥等：

```typescript
import { tool } from "langchain";
import type { ToolRuntime } from "@langchain/core/tools";
import { z } from "zod";

// 定义上下文 schema
const contextSchema = z.object({
  userId: z.string(),
  apiKey: z.string(),
});

// 在工具中访问运行时上下文
const fetchUserData = tool(
  async (input, runtime: ToolRuntime<unknown, typeof contextSchema>) => {
    // 从运行时上下文中获取用户 ID
    const userId = runtime.context?.userId;
    return `用户 ${userId} 的数据: ${input.query}`;
  },
  {
    name: "fetch_user_data",
    description: "获取当前用户的数据",
    schema: z.object({
      query: z.string().describe("查询内容"),
    }),
  }
);
```

## MCP 服务器集成

MCP（Model Context Protocol）是一个开放协议，让智能体通过标准接口连接到不断增长的服务器生态 —— 数据库、API、文件系统、浏览器等。你不需要为每个服务编写自定义集成代码，只需将 Deep Agents 指向一个 MCP 服务器，它就能获得该服务器暴露的所有工具。

### 安装

```bash
npm install @langchain/mcp-adapters
```

### 连接到 MCP 服务器

```typescript
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { createDeepAgent } from "deepagents";

// 创建 MCP 客户端连接到服务器
const client = new MultiServerMCPClient({
  my_server: {
    transport: "http",
    url: "http://localhost:8000/mcp",
  },
});

// 获取服务器提供的所有工具
const tools = await client.getTools();

// 将 MCP 工具传递给深度智能体
const agent = await createDeepAgent({
  model: "openai:gpt-5.4",
  tools,  // MCP 服务器提供的所有工具
});

// 使用 MCP 工具
const result = await agent.invoke({
  messages: [{ role: "user", content: "使用 MCP 服务器帮助我。" }],
});
```

### MCP 配置选项

MCP 集成支持多种配置：

- **传输方式**：HTTP、stdio 等
- **OAuth 认证**：安全的身份验证
- **工具过滤**：选择性暴露特定工具
- **有状态会话**：保持会话状态

## 内置工具

除了你提供的工具，每个深度智能体都自带以下内置工具：

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

### 内置工具详细说明

#### 文件操作工具

```typescript
// ls - 列出目录内容
// 智能体使用示例：列出 /project/src 目录下的所有文件

// read_file - 读取文件内容
// 支持分页读取大文件，支持读取图片等多模态内容

// write_file - 创建新文件
// 智能体使用示例：创建一个新的配置文件

// edit_file - 精确字符串替换
// 在文件中查找并替换特定的文本片段

// glob - 文件名模式匹配
// 智能体使用示例：查找所有 *.test.ts 文件

// grep - 内容搜索
// 智能体使用示例：搜索所有包含 "TODO" 的文件
```

#### 执行工具

```typescript
// execute - 运行 shell 命令
// 注意：仅在沙盒后端中可用
// 智能体使用示例：运行 npm test 执行测试
```

#### 子智能体工具

```typescript
// task - 生成子智能体
// 将复杂任务委派给独立的子智能体
// 子智能体有独立的上下文，不会污染主智能体的上下文
```

#### 规划工具

```typescript
// write_todos - 管理待办事项列表
// 创建结构化的任务分解
// 在执行过程中更新任务状态
```

## 工具设计模式

### 模式一：简单查询工具

```typescript
// 适合简单的数据查询场景
const getUserInfo = tool(
  async ({ userId }) => {
    return await db.users.findById(userId);
  },
  {
    name: "get_user_info",
    description: "根据用户 ID 获取用户基本信息",
    schema: z.object({
      userId: z.string().describe("用户 ID"),
    }),
  }
);
```

### 模式二：带上下文的工具

```typescript
// 适合需要用户身份信息的场景
const queryDatabase = tool(
  async (input, runtime: ToolRuntime) => {
    // 根据用户角色限制查询范围
    const userRole = runtime.context?.role;
    const query = buildSafeQuery(input.sql, userRole);
    return await db.execute(query);
  },
  {
    name: "query_database",
    description: "执行安全的数据库查询",
    schema: z.object({
      sql: z.string().describe("SQL 查询语句"),
    }),
  }
);
```

### 模式三：返回文件引用的工具

```typescript
// 适合产生大量输出的场景
// 工具保存结果到文件，返回文件路径
const generateReport = tool(
  async ({ type, dateRange }) => {
    const data = await fetchData(type, dateRange);
    const report = formatReport(data);

    // 保存到文件系统，返回路径引用
    const filePath = `/reports/${type}_${Date.now()}.md`;
    // 使用虚拟文件系统写入
    return {
      path: filePath,
      summary: `报告已生成，包含 ${data.length} 条记录`,
      preview: report.slice(0, 200),
    };
  },
  {
    name: "generate_report",
    description: "生成指定类型和日期范围的报告",
    schema: z.object({
      type: z.enum(["sales", "inventory", "customers"]),
      dateRange: z.string().describe("日期范围，如 '2024-01-01:2024-12-31'"),
    }),
  }
);
```

## 小结

| 主题 | 要点 |
|------|------|
| 自定义工具 | 使用 `tool()` 函数定义，包含名称、描述和参数 schema |
| 运行时上下文 | 工具通过 `runtime.context` 访问用户信息 |
| MCP 集成 | 通过标准协议连接外部服务，无需自定义集成代码 |
| 内置工具 | 文件操作、执行、子智能体、规划等9个内置工具 |
| 工具描述 | 清晰的名称、描述和参数说明是工具使用效果的关键 |

## 相关章节

- [核心能力](./06-core-capabilities.md) - 内置工具的详细说明
- [上下文工程](./09-context-engineering.md) - 工具提示和上下文管理
- [投入生产](./05-going-to-production.md) - 沙盒环境中的工具使用
