# 子代理 - Subagents

> 原文地址: https://docs.langchain.com/oss/javascript/deepagents/subagents

## 概述

Deep Agent 可以创建子代理（Subagents）来委派工作。子代理对于**上下文隔离**（保持主 Agent 的上下文干净）和提供专门的指令非常有用。本章节介绍的是**同步**子代理，主管 Agent 会阻塞等待子代理完成。

---

## 为什么使用子代理？

子代理解决了**上下文膨胀问题**。当 Agent 使用产生大量输出的工具（网络搜索、文件读取、数据库查询）时，上下文窗口会被中间结果快速填满。子代理将这类详细工作隔离起来——主 Agent 只接收最终结果，而不是产生该结果的数十个工具调用。

**适合使用子代理的场景：**
- 会污染主 Agent 上下文的多步骤任务
- 需要自定义指令或工具的专业领域
- 需要不同模型能力的任务
- 希望主 Agent 专注于高层协调

**不适合使用子代理的场景：**
- 简单的单步骤任务
- 需要维护中间上下文的情况
- 开销大于收益的情况

---

## 配置

`subagents` 参数接收一个字典列表或 `CompiledSubAgent` 对象列表。

### 默认子代理

Deep Agents 会自动添加一个名为 `general-purpose` 的同步子代理，除非你已提供了一个同名的同步子代理。该子代理默认拥有文件系统工具。

### 不使用子代理运行

如果不想使用 `task` 工具：
1. 在 harness 配置中禁用通用子代理
2. 不通过 `subagents` 参数传递任何同步子代理

---

## 自定义子代理

### SubAgent（字典方式）

通过 `SubAgent` 字典定义子代理：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `name` | `string` | 必需。子代理的唯一标识符，主 Agent 调用 `task()` 工具时使用此名称 |
| `description` | `string` | 必需。描述子代理的功能，主 Agent 根据此描述决定何时委派任务 |
| `systemPrompt` | `string` | 必需。子代理的指令，不继承主 Agent |
| `tools` | `list[Callable]` | 可选。子代理可用的工具，指定后完全覆盖继承的工具 |
| `model` | `string` 或 `BaseChatModel` | 可选。覆盖主 Agent 的模型 |
| `middleware` | `list[Middleware]` | 可选。额外的中间件，不继承主 Agent |
| `interruptOn` | `dict` | 可选。为特定工具配置人工审批，子代理值覆盖主代理 |
| `skills` | `list[string]` | 可选。技能源路径，不继承主 Agent |
| `responseFormat` | `ResponseFormat` | 可选。结构化输出模式 |

### CompiledSubAgent（编译方式）

对于复杂的工作流，使用预构建的 LangGraph 图：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `name` | `string` | 必需。唯一标识符 |
| `description` | `string` | 必需。子代理的功能描述 |
| `runnable` | `Runnable` | 必需。编译后的 LangGraph 图 |

### 使用 CompiledSubAgent 示例

```typescript
import { createDeepAgent, CompiledSubAgent } from "deepagents";
import { createAgent } from "langchain";

// 创建自定义代理图
const customGraph = createAgent({
  model: yourModel,
  tools: specializedTools,
  prompt: "You are a specialized agent for data analysis...",
});

// 将其作为自定义子代理使用
const customSubagent: CompiledSubAgent = {
  name: "data-analyzer",
  description: "Specialized agent for complex data analysis tasks",
  runnable: customGraph,
};

const subagents = [customSubagent];

const agent = createDeepAgent({
  model: "google_genai:gemini-3.1-pro-preview",
  tools: [internetSearch],
  systemPrompt: researchInstructions,
  subagents: subagents,
});
```

---

## 流式传输

在流式传输中，代理名称可作为元数据中的 `lc_agent_name` 获取。

```typescript
import { createDeepAgent } from "deepagents";

const researchSubagent = {
  name: "research-agent",
  description: "Used to research more in depth questions",
  system_prompt: "You are a great researcher",
  tools: [internetSearch],
  model: "google_genai:gemini-3.1-pro-preview",
};

const subagents = [researchSubagent];

const agent = createDeepAgent({
  model: "google_genai:gemini-3.1-pro-preview",
  subagents: subagents,
  name: "main-agent",
});
```

名为 `"research-agent"` 的子代理在其关联的代理运行元数据中将包含 `{ lc_agent_name: 'research-agent' }`。

---

## 结构化输出

子代理支持结构化输出，父代理可以接收可预测的、可解析的 JSON。

```typescript
import { z } from "zod";
import { createDeepAgent } from "deepagents";

// 定义结构化输出模式
const ResearchFindings = z.object({
  summary: z.string().describe("Summary of findings"),
  confidence: z.number().describe("Confidence score from 0 to 1"),
  sources: z.array(z.string()).describe("List of source URLs"),
});

const researchSubagent = {
  name: "researcher",
  description: "Researches topics and returns structured findings",
  systemPrompt: "Research the given topic thoroughly. Return your findings.",
  tools: [webSearch],
  responseFormat: ResearchFindings,  // 设置结构化输出
};

const agent = createDeepAgent({
  model: "claude-sonnet-4-6",
  subagents: [researchSubagent],
});

const result = await agent.invoke({
  messages: [{ role: "user", content: "Research recent advances in quantum computing" }],
});

// 父代理的 ToolMessage 包含 JSON 序列化的结构化数据：
// '{"summary": "...", "confidence": 0.87, "sources": ["https://..."]}'
```

---

## 通用子代理

每个 Deep Agent 都有一个 `general-purpose` 子代理：
- 与主 Agent 拥有相同的系统提示
- 访问所有相同的工具
- 使用相同的模型（除非覆盖）
- 继承主 Agent 的技能

### 覆盖通用子代理

```typescript
import { createDeepAgent } from "deepagents";

// 主 Agent 使用 Gemini；通用子代理使用 GPT
const agent = await createDeepAgent({
  model: "google_genai:gemini-3.1-pro-preview",
  tools: [internetSearch],
  subagents: [
    {
      name: "general-purpose",
      description: "General-purpose agent for research and multi-step tasks",
      systemPrompt: "You are a general-purpose assistant.",
      tools: [internetSearch],
      model: "openai:gpt-5.4",  // 为委派任务使用不同的模型
    },
  ],
});
```

### 技能继承

- **通用子代理**：自动从主 Agent 继承技能
- **自定义子代理**：默认不继承技能——使用 `skills` 参数为其指定技能

```typescript
import { createDeepAgent, SubAgent } from "deepagents";

// 带有自己技能的研究子代理
const researchSubagent: SubAgent = {
  name: "researcher",
  description: "Research assistant with specialized skills",
  systemPrompt: "You are a researcher.",
  tools: [webSearch],
  skills: ["/skills/research/", "/skills/web-search/"],  // 子代理专属技能
};

const agent = createDeepAgent({
  model: "google_genai:gemini-3.1-pro-preview",
  skills: ["/skills/main/"],  // 主 Agent 和通用子代理获得这些技能
  subagents: [researchSubagent],  // 只获得 /skills/research/ 和 /skills/web-search/
});
```

---

## 上下文管理

运行时上下文会自动传播到所有子代理。

```typescript
import { createDeepAgent } from "deepagents";
import { tool } from "langchain";
import type { ToolRuntime } from "@langchain/core/tools";
import { z } from "zod";

// 定义上下文模式
const contextSchema = z.object({
  userId: z.string(),
  sessionId: z.string(),
});

// 工具可以访问上下文
const getUserData = tool(
  async (input, runtime: ToolRuntime<unknown, typeof contextSchema>) => {
    const userId = runtime.context?.userId;
    return `Data for user ${userId}: ${input.query}`;
  },
  {
    name: "get_user_data",
    description: "Fetch data for the current user",
    schema: z.object({ query: z.string() }),
  }
);

const researchSubagent = {
  name: "researcher",
  description: "Conducts research for the current user",
  systemPrompt: "You are a research assistant.",
  tools: [getUserData],
};

const agent = createDeepAgent({
  model: "google_genai:gemini-3.1-pro-preview",
  subagents: [researchSubagent],
  contextSchema,
});

// 上下文自动传递给子代理及其工具
const result = await agent.invoke(
  { messages: [new HumanMessage("Look up my recent activity")] },
  { context: { userId: "user-123", sessionId: "abc" } },
);
```

### 按子代理传递上下文

使用命名空间键为特定子代理传递配置：

```typescript
const result = await agent.invoke(
  { messages: [new HumanMessage("Research this and verify the claims")] },
  {
    context: {
      userId: "user-123",                        // 所有代理共享
      "researcher:maxDepth": 3,                  // 仅给 researcher
      "fact-checker:strictMode": true,           // 仅给 fact-checker
    },
  },
);
```

### 识别调用工具的子代理

```typescript
import { tool } from "langchain";
import type { ToolRuntime } from "@langchain/core/tools";

const sharedLookup = tool(
  async (input, runtime: ToolRuntime) => {
    const agentName = runtime.config?.metadata?.lc_agent_name;
    if (agentName === "fact-checker") {
      return strictLookup(input.query);
    }
    return generalLookup(input.query);
  },
  {
    name: "shared_lookup",
    description: "Look up information from various sources",
    schema: z.object({ query: z.string() }),
  }
);
```

---

## 最佳实践

### 编写清晰的描述

主 Agent 使用描述来决定调用哪个子代理。要具体明确：

```
// 好的描述
"Analyzes financial data and generates investment insights with confidence scores"

// 差的描述
"Does finance stuff"
```

### 保持系统提示详细

```typescript
const researchSubagent = {
  name: "research-agent",
  description: "Conducts in-depth research using web search and synthesizes findings",
  systemPrompt: `You are a thorough researcher. Your job is to:

  1. Break down the research question into searchable queries
  2. Use internet_search to find relevant information
  3. Synthesize findings into a comprehensive but concise summary
  4. Cite sources when making claims

  Output format:
  - Summary (2-3 paragraphs)
  - Key findings (bullet points)
  - Sources (with URLs)

  Keep your response under 500 words to maintain clean context.`,
  tools: [internetSearch],
};
```

### 最小化工具集

只给子代理所需的工具：

```typescript
// 好的做法：聚焦的工具集
const emailAgent = {
  name: "email-sender",
  tools: [sendEmail, validateEmail],  // 只包含邮件相关的
};

// 差的做法：太多工具
const emailAgentBad = {
  name: "email-sender",
  tools: [sendEmail, webSearch, databaseQuery, fileUpload],  // 不聚焦
};
```

### 按任务选择模型

```typescript
const subagents = [
  {
    name: "contract-reviewer",
    description: "Reviews legal documents and contracts",
    systemPrompt: "You are an expert legal reviewer...",
    tools: [readDocument, analyzeContract],
    model: "google_genai:gemini-3.1-pro-preview",  // 大上下文用于长文档
  },
  {
    name: "financial-analyst",
    description: "Analyzes financial data and market trends",
    systemPrompt: "You are an expert financial analyst...",
    tools: [getStockPrice, analyzeFundamentals],
    model: "gpt-5.4",  // 更擅长数值分析
  },
];
```

### 返回简洁结果

```typescript
const dataAnalyst = {
  systemPrompt: `Analyze the data and return:
  1. Key insights (3-5 bullet points)
  2. Overall confidence score
  3. Recommended next actions

  Do NOT include:
  - Raw data
  - Intermediate calculations
  - Detailed tool outputs

  Keep response under 300 words.`,
};
```

---

## 常见模式

### 多个专业子代理

```typescript
import { createDeepAgent } from "deepagents";

const subagents = [
  {
    name: "data-collector",
    description: "Gathers raw data from various sources",
    systemPrompt: "Collect comprehensive data on the topic",
    tools: [webSearch, apiCall, databaseQuery],
  },
  {
    name: "data-analyzer",
    description: "Analyzes collected data for insights",
    systemPrompt: "Analyze data and extract key insights",
    tools: [statisticalAnalysis],
  },
  {
    name: "report-writer",
    description: "Writes polished reports from analysis",
    systemPrompt: "Create professional reports from insights",
    tools: [formatDocument],
  },
];

const agent = createDeepAgent({
  model: "google_genai:gemini-3.1-pro-preview",
  systemPrompt: "You coordinate data analysis and reporting. Use subagents for specialized tasks.",
  subagents: subagents,
});
```

**工作流程：**
1. 主 Agent 制定高层计划
2. 将数据收集委派给 data-collector
3. 将结果传递给 data-analyzer
4. 将洞察发送给 report-writer
5. 汇编最终输出

---

## 故障排除

### 子代理未被调用

**解决方案：**
1. 使描述更加具体
2. 在系统提示中指示主 Agent 委派任务

```typescript
const agent = createDeepAgent({
  systemPrompt: `...your instructions...

     IMPORTANT: For complex tasks, delegate to your subagents using the task() tool.
     This keeps your context clean and improves results.`,
  subagents: [...]
});
```

### 上下文仍然膨胀

**解决方案：**
1. 指示子代理返回简洁结果
2. 使用文件系统处理大数据

```typescript
systemPrompt: `When you gather large amounts of data:
  1. Save raw data to /data/raw_results.txt
  2. Process and analyze the data
  3. Return only the analysis summary

  This keeps context clean.`
```

### 选择了错误的子代理

**解决方案：** 在描述中明确区分子代理：

```typescript
const subagents = [
  {
    name: "quick-researcher",
    description: "For simple, quick research questions that need 1-2 searches. Use when you need basic facts or definitions.",
  },
  {
    name: "deep-researcher",
    description: "For complex, in-depth research requiring multiple searches, synthesis, and analysis. Use for comprehensive reports.",
  }
];
```

---

## 小结

- 子代理通过上下文隔离解决上下文膨胀问题
- 支持字典定义（`SubAgent`）和编译图定义（`CompiledSubAgent`）两种方式
- 通用子代理默认可用，可被覆盖或禁用
- 结构化输出让父代理获得可预测的 JSON 结果
- 运行时上下文自动传播到所有子代理
- 清晰的描述、详细的提示、最小的工具集是最佳实践的关键
