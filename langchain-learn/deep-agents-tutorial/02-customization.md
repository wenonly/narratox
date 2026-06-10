# 自定义 Deep Agents - Customization

> `createDeepAgent` 为你提供了一个生产就绪的基础：连接你的数据，塑造其行为，并添加你的用例所需的能力。本文将详细介绍如何通过系统提示词、工具、中间件、后端、技能等参数来自定义你的深度智能体。

---

## 概述

`createDeepAgent` 自带预组装的框架，默认包含：文件系统、摘要、子智能体和提示缓存。以下参数让你能够定义智能体的角色、连接数据和工具，以及扩展默认的中间件栈。

```typescript
import { createDeepAgent } from "deepagents";

// 创建自定义深度智能体
const agent = await createDeepAgent({
  model: "anthropic:claude-sonnet-4-6",   // 使用的模型
  systemPrompt: "You are a helpful assistant.", // 自定义系统提示词
  tools: [search, fetchUrl],                // 自定义工具
  memory: ["./AGENTS.md"],                  // 记忆文件
  skills: ["./skills/"],                    // 技能目录
});
```

### 参数总览

| 参数 | 说明 |
| --- | --- |
| `model` | 使用的模型 |
| `systemPrompt` | 智能体的自定义指令 |
| `tools` | 智能体可以调用的领域工具 |
| `memory` | 启动时加载的 AGENTS.md 文件 |
| `skills` | 按需加载知识的技能目录 |
| `backend` | 文件系统后端（默认为 StateBackend） |
| `permissions` | 文件系统的路径级访问控制 |
| `subagents` | 用于委派任务的自定义子智能体 |
| `middleware` | 附加到默认栈末尾的额外中间件 |
| `interruptOn` | 工具调用前暂停以等待人工审批 |
| `responseFormat` | 结构化输出模式 |

---

## 一、模型配置 - Model

传入 `provider:model` 格式的模型字符串，或传入已初始化的模型实例。

```typescript
import { initChatModel } from "langchain";
import { createDeepAgent } from "deepagents";

// 方式一：使用 initChatModel 初始化模型
const model = await initChatModel("provider:model-name");

// 方式二：直接传入模型字符串
const agent = createDeepAgent({
  model,  // 传入已初始化的模型实例
  // 或者直接传入字符串：model: "openai:gpt-5.4"
});
```

> **提示**：所有支持的提供商和推荐模型请参阅官方文档中的「支持模型」和「推荐模型」页面。

---

## 二、工具 - Tools

除了内置的规划、文件管理和子智能体生成工具外，你还可以提供自定义工具。

### MCP 工具

安装 `@langchain/mcp-adapters` 以连接 MCP（Model Context Protocol）服务器：

```bash
npm install @langchain/mcp-adapters
```

```typescript
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { createDeepAgent } from "deepagents";

// 创建 MCP 客户端，连接到 MCP 服务器
const client = new MultiServerMCPClient({
  my_server: {
    transport: "http",
    url: "http://localhost:8000/mcp",  // MCP 服务器地址
  },
});

// 从 MCP 服务器获取可用工具
const tools = await client.getTools();

// 创建使用 MCP 工具的深度智能体
const agent = await createDeepAgent({
  model: "openai:gpt-5.4",
  tools,  // 传入 MCP 工具
});

// 调用智能体
const result = await agent.invoke({
  messages: [{ role: "user", content: "Use the MCP server to help me." }],
});
```

> **说明**：MCP 协议允许智能体与外部服务交互。详细的配置选项（包括 stdio 服务器、OAuth 认证、工具过滤和有状态会话）请参阅完整的 MCP 指南。

---

## 三、系统提示词 - System Prompt

Deep Agents 自带内置系统提示词。深度智能体的价值来自于 SDK 在模型之上提供的编排层——规划、虚拟文件系统工具和子智能体——模型需要知道这些功能的存在以及何时使用它们。

内置提示词教会智能体如何使用这些基础设施，这样你就不必为每个项目重新编写。你可以通过配置文件（profile）或自己的 `systemPrompt` 参数来调整它。

### 提示词组装机制

Deep Agents 从最多四个命名部分构建系统提示词，使得调用者提供的指令、SDK 的内置智能体引导和任何特定模型的配置文件覆盖可以以可预测的优先级共存。

**四个命名部分**（每个都可能不存在）：

| 名称 | 来源 | 说明 |
| --- | --- | --- |
| `USER` | `systemPrompt` 参数 | 字符串或 SystemMessage；未设置时省略 |
| `BASE` | SDK 默认（`BASE_AGENT_PROMPT`） | 始终存在，除非被配置文件的 `CUSTOM` 替换 |
| `CUSTOM` | `HarnessProfile.base_system_prompt` | 当匹配的配置文件设置时，直接替换 `BASE` |
| `SUFFIX` | `HarnessProfile.system_prompt_suffix` | 当匹配的配置文件设置时，最后附加 |

**组装顺序始终是**：`USER` -> (`BASE` 或 `CUSTOM`) -> `SUFFIX`，各部分之间用空行连接。

**两条不变量**：
1. **`USER` 始终在最前面**：调用者的文本在任何 SDK 或配置文件内容之前，确保角色/指令优先
2. **`SUFFIX` 始终在最后面**：配置文件后缀最接近对话历史，模型调优指导最可靠

**实际示例**——内置配置文件（Anthropic、OpenAI）仅附带 `system_prompt_suffix`：

```typescript
// 典型调用会落在 str + - + ✓ 这一组合上
const agent = createDeepAgent({
  model: "anthropic:claude-sonnet-4-6",
  systemPrompt: "You are a customer-support agent for ACME Corp.",
});

// 最终组装结果：
// Final = USER + BASE + SUFFIX
//       = "You are a customer-support agent for ACME Corp."
//         + "\n\n"
//         + BASE_AGENT_PROMPT
//         + "\n\n"
//         + <Claude 特定的指导>
```

---

## 四、中间件 - Middleware

Deep Agents 支持多种中间件，包括内置中间件、LangChain 预构建中间件、提供商特定中间件以及你自己编写的自定义中间件。

通过 `createDeepAgent` 的 `middleware` 参数传入。自定义中间件会附加在默认栈的 `PatchToolCallsMiddleware` 之后。

### 默认中间件栈（主智能体）

从先到后的执行顺序：

| 序号 | 中间件 | 说明 |
| --- | --- | --- |
| 1 | `TodoListMiddleware` | 跟踪和管理待办事项列表，用于组织智能体任务和工作 |
| 2 | `SkillsMiddleware` | 仅在你传入 `skills` 时激活。在 todo 中间件之后、文件系统中间件之前注入，确保技能元数据在文件工具运行前可用 |
| 3 | `FilesystemMiddleware` | 处理文件系统操作（读取、写入、导航目录）。传入 `permissions` 时，文件系统权限强制执行包含在此处 |
| 4 | `SubAgentMiddleware` | 生成和协调子智能体，将任务委派给专门的智能体 |
| 5 | `SummarizationMiddleware` | 压缩消息历史以在对话变长时保持上下文限制内 |
| 6 | `PatchToolCallsMiddleware` | 在运行恢复中断或收到格式错误的工具调用参数时修复消息历史中的悬空工具调用 |
| 7 | `AsyncSubAgentMiddleware` | 仅在你配置异步子智能体时存在 |
| 8 | **你的 middleware 参数** | 可选的自定义中间件，附加在此处（Patch 之后、尾部栈之前） |
| 9 | **配置文件附加项** | 来自已解析模型配置文件的提供商特定中间件（如有） |
| 10 | **排除工具过滤** | 当配置文件列出排除工具时，中间件从智能体中移除这些工具 |
| 11 | `AnthropicPromptCachingMiddleware` | 使用 Anthropic 模型时自动添加。在你的中间件之后运行，确保缓存前缀与实际发送给模型的内容匹配 |
| 12 | `MemoryMiddleware` | 仅在你传入 `memory` 时存在 |
| 13 | `HumanInTheLoopMiddleware` | 仅在你传入 `interruptOn` 时存在。在配置的工具调用处暂停等待人工审批 |

### 预构建中间件

LangChain 提供额外的预构建中间件，用于添加重试、回退、PII 检测等功能。详见官方文档「Prebuilt middleware」。

### 自定义中间件

你可以提供额外的中间件来扩展功能、添加工具或实现自定义钩子。

### 解释器（Interpreters）

使用解释器可以添加一个 `eval` 工具，在作用域化的 QuickJS 运行时中执行 JavaScript。解释器在智能体需要以编程方式组合工具、批量处理工作、在代码中处理错误或转换结构化数据时非常有用，无需完整的 shell 环境。

---

## 五、子智能体 - Subagents

使用子智能体可以隔离详细工作，避免上下文膨胀：

> 子智能体允许你将复杂任务分解为专门的子任务。每个子智能体可以有自己的一组工具和系统提示词。详见官方文档「Subagents」章节。

---

## 六、后端 - Backends

Deep Agent 的工具可以利用虚拟文件系统来存储、访问和编辑文件。默认使用 `StateBackend`。

如果你使用技能（skills）或记忆（memory），必须在创建智能体之前将预期的技能或记忆文件添加到后端。

### 可用的后端类型

| 后端 | 说明 |
| --- | --- |
| **StateBackend** | 线程作用域的文件系统后端，存储在 LangGraph 状态中。文件在同一线程的轮次间持久化（通过你的检查点），但不跨线程共享 |
| **FilesystemBackend** | 本地机器的文件系统 |
| **LocalShellBackend** | 带有 shell 执行的文件系统，直接在主机上执行。提供文件系统工具加上 `execute` 工具用于运行命令 |
| **StoreBackend** | 提供跨线程持久化的长期存储 |
| **ContextHubBackend** | LangSmith Hub 仓库中的持久文件系统存储 |
| **CompositeBackend** | 灵活的后端，你可以指定文件系统中的不同路由指向不同的后端 |

#### StateBackend 示例

```typescript
import { createDeepAgent, StateBackend } from "deepagents";

// 默认提供 StateBackend
const agent = createDeepAgent();

// 显式指定时写法如下
const agent2 = createDeepAgent({
  backend: new StateBackend(),  // 线程作用域的虚拟文件系统
});
```

### 沙箱 - Sandboxes

沙箱是特殊的后端，在隔离环境中运行智能体代码，拥有自己的文件系统和 `execute` 工具用于 shell 命令。当你希望智能体写文件、安装依赖和运行命令而不影响本地机器时，使用沙箱后端。

```typescript
import { createDeepAgent } from "deepagents";
import { ChatAnthropic } from "@langchain/anthropic";
import { DenoSandbox } from "@langchain/deno";

// 创建并初始化沙箱
const sandbox = await DenoSandbox.create({
  memoryMb: 1024,   // 内存限制：1GB
  lifetime: "10m",  // 生命周期：10分钟
});

try {
  const agent = createDeepAgent({
    model: new ChatAnthropic({ model: "claude-opus-4-6" }),
    systemPrompt: "You are a JavaScript coding assistant with sandbox access.",
    backend: sandbox,  // 使用沙箱作为后端
  });

  const result = await agent.invoke({
    messages: [
      {
        role: "user",
        content: "Create a simple HTTP server using Deno.serve and test it with curl",
      },
    ],
  });
} finally {
  // 使用完毕后关闭沙箱
  await sandbox.close();
}
```

> **说明**：`DenoSandbox` 提供了一个 Deno 运行时环境，智能体可以在其中安全地执行代码。详见「Sandboxes」章节。

---

## 七、人工干预 - Human-in-the-Loop

某些工具操作可能比较敏感，需要在执行前获得人工审批。你可以为每个工具配置审批行为：

```typescript
import { tool } from "langchain";
import { createDeepAgent } from "deepagents";
import { MemorySaver } from "@langchain/langgraph";
import { z } from "zod";

// 删除文件工具（敏感操作，需要审批）
const removeFile = tool(
  async ({ path }: { path: string }) => {
    return `Deleted ${path}`;
  },
  {
    name: "remove_file",
    description: "Delete a file from the filesystem.",
    schema: z.object({
      path: z.string(),
    }),
  },
);

// 获取文件工具（普通操作，无需审批）
const fetchFile = tool(
  async ({ path }: { path: string }) => {
    return `Contents of ${path}`;
  },
  {
    name: "fetch_file",
    description: "Read a file from the filesystem.",
    schema: z.object({
      path: z.string(),
    }),
  },
);

// 发送邮件工具（敏感操作，需要审批）
const notifyEmail = tool(
  async ({
    to,
    subject,
    body,
  }: {
    to: string;
    subject: string;
    body: string;
  }) => {
    return `Sent email to ${to}`;
  },
  {
    name: "notify_email",
    description: "Send an email.",
    schema: z.object({
      to: z.string(),
      subject: z.string(),
      body: z.string(),
    }),
  },
);

// checkpointer 是人工干预功能所必需的！
const checkpointer = new MemorySaver();

const agent = createDeepAgent({
  model: "google_genai:gemini-3.5-flash",
  tools: [removeFile, fetchFile, notifyEmail],
  interruptOn: {
    remove_file: true,  // 需要审批（默认支持：approve、edit、reject、respond）
    fetch_file: false,  // 无需中断
    notify_email: { allowedDecisions: ["approve", "reject"] },  // 只允许批准或拒绝，不允许编辑
  },
  checkpointer,  // 必须传入！
});
```

**关键概念说明**：

- `interruptOn` 参数控制哪些工具在执行前需要人工审批
- `true` 表示启用默认审批流程（approve/edit/reject/respond）
- `false` 表示不需要中断
- `{ allowedDecisions: [...] }` 可以自定义允许的审批操作类型
- **checkpointer 是必需的**，因为中断状态需要持久化

---

## 八、技能 - Skills

技能（Skills）用于为你的深度智能体提供新的能力和专业知识。

工具通常覆盖较低级别的功能（如原生文件系统操作或规划），而技能可以包含关于如何完成任务的详细指令、参考信息和其他资产（如模板）。

这些文件仅在智能体确定技能对当前提示有用时才加载。这种**渐进式披露**减少了智能体启动时需要考虑的 token 数量和上下文。

### StateBackend + Skills 示例

```typescript
import { createCodeInterpreterMiddleware } from "@langchain/quickjs";
import { createDeepAgent, StateBackend, type FileData } from "deepagents";
import { MemorySaver } from "@langchain/langgraph";

const checkpointer = new MemorySaver();
const backend = new StateBackend();

// 辅助函数：创建文件数据对象
function createFileData(content: string): FileData {
  const now = new Date().toISOString();
  return {
    content: content.split("\n"),
    created_at: now,
    modified_at: now,
  };
}

// 从远程加载技能文件
const skillsFiles: Record<string, FileData> = {};
const skillUrl =
  "https://raw.githubusercontent.com/langchain-ai/deepagentsjs/refs/heads/main/examples/skills/langgraph-docs/SKILL.md";
const response = await fetch(skillUrl);
const skillContent = await response.text();

// 将技能文件放入虚拟文件系统
skillsFiles["/skills/langgraph-docs/SKILL.md"] = createFileData(skillContent);

const agent = await createDeepAgent({
  model: "google-genai:gemini-3.1-pro-preview",
  backend,
  checkpointer,  // 必须传入！
  // 重要：deepagents 技能源路径是相对于后端根目录的虚拟（POSIX）路径
  skills: ["/skills/"],
  middleware: [createCodeInterpreterMiddleware({ skillsBackend: backend })],
});

const config = { configurable: { thread_id: `thread-${Date.now()}` } };
const result = await agent.invoke(
  {
    messages: [{ role: "user", content: "what is langraph?" }],
    files: skillsFiles,  // 传入技能文件
  },
  config,
);
```

### FilesystemBackend + Skills 示例

```typescript
import { createCodeInterpreterMiddleware } from "@langchain/quickjs";
import { createDeepAgent, FilesystemBackend } from "deepagents";
import { MemorySaver } from "@langchain/langgraph";

const checkpointer = new MemorySaver();
const backend = new FilesystemBackend({ rootDir: process.cwd() });

const agent = await createDeepAgent({
  model: "google-genai:gemini-3.1-pro-preview",
  backend,
  skills: ["./examples/skills/"],  // 本地技能目录
  interruptOn: {
    read_file: true,
    write_file: true,
    delete_file: true,
  },
  checkpointer,  // 必须传入！
  middleware: [createCodeInterpreterMiddleware({ skillsBackend: backend })],
});

const config = { configurable: { thread_id: `thread-${Date.now()}` } };
const result = await agent.invoke(
  { messages: [{ role: "user", content: "what is langraph?" }] },
  config,
);
```

---

## 九、记忆 - Memory

使用 `AGENTS.md` 文件为你的深度智能体提供额外上下文。你可以在创建智能体时传入一个或多个文件路径给 `memory` 参数。

```typescript
const agent = await createDeepAgent({
  model: "anthropic:claude-sonnet-4-6",
  memory: ["./AGENTS.md"],  // 加载记忆文件
});
```

> 记忆文件适用于所有后端类型（StateBackend、StoreBackend、FilesystemBackend）。

---

## 十、结构化输出 - Structured Output

Deep Agents 支持结构化输出。你可以通过 `responseFormat` 参数传入所需的输出模式（schema）。

当模型生成结构化数据时，它会被捕获、验证，并在智能体状态的 `structuredResponse` 键中返回。

```typescript
import { tool } from "langchain";
import { TavilySearch } from "@langchain/tavily";
import { createDeepAgent } from "deepagents";
import { z } from "zod";

// 网络搜索工具
const internetSearch = tool(
  async ({
    query,
    maxResults = 5,
    topic = "general",
    includeRawContent = false,
  }: {
    query: string;
    maxResults?: number;
    topic?: "general" | "news" | "finance";
    includeRawContent?: boolean;
  }) => {
    const tavilySearch = new TavilySearch({
      maxResults,
      tavilyApiKey: process.env.TAVILY_API_KEY,
      includeRawContent,
      topic,
    });
    return await tavilySearch._call({ query });
  },
  {
    name: "internet_search",
    description: "Run a web search",
    schema: z.object({
      query: z.string().describe("The search query"),
      maxResults: z.number().optional().default(5),
      topic: z.enum(["general", "news", "finance"]).optional().default("general"),
      includeRawContent: z.boolean().optional().default(false),
    }),
  },
);

// 定义天气报告的结构化输出模式
const weatherReportSchema = z.object({
  location: z.string().describe("The location for this weather report"),
  temperature: z.number().describe("Current temperature in Celsius"),
  condition: z
    .string()
    .describe("Current weather condition (e.g., sunny, cloudy, rainy)"),
  humidity: z.number().describe("Humidity percentage"),
  windSpeed: z.number().describe("Wind speed in km/h"),
  forecast: z.string().describe("Brief forecast for the next 24 hours"),
});

// 创建使用结构化输出的智能体
const agent = await createDeepAgent({
  responseFormat: weatherReportSchema,  // 传入结构化输出模式
  tools: [internetSearch],
});

const result = await agent.invoke({
  messages: [
    {
      role: "user",
      content: "What's the weather like in San Francisco?",
    },
  ],
});

// 结构化响应在 structuredResponse 键中
console.log(result.structuredResponse);
// 输出示例：
// {
//   location: 'San Francisco, California',
//   temperature: 18.3,
//   condition: 'Sunny',
//   humidity: 48,
//   windSpeed: 7.6,
//   forecast: 'Clear skies with temperatures remaining mild...'
// }
```

**关键概念说明**：

- `responseFormat` 接受一个 Zod schema，定义你期望的输出结构
- 智能体会使用其工具收集信息，然后按照 schema 生成结构化响应
- 结果通过 `result.structuredResponse` 获取，类型安全且经过验证

---

## 高级主题

`createDeepAgent` 在 `createAgent` 之上预组装了中间件栈。如果你想构建完全自定义的智能体——精确选择要包含的功能——请参阅官方文档中的「Configure the harness」章节。
