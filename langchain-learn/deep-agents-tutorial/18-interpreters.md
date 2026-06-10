# 解释器 (Interpreters)

> 在 Deep Agents 内部运行轻量级代码，用于组合工具、编排子 Agent 和转换结构化数据。

## 概述

解释器为 Agent 提供了一个可编程的工作区，它们可以在其中探索数据、协调工具调用，并将中间工作保留在模型上下文之外。Agent 编写代码来表达意图，然后一个**内存中**的运行时执行该代码并返回相关结果。

沙箱是作用于环境（运行命令、安装依赖、编辑文件）的代码优先方式，而**解释器是作用于 Agent 循环内部**的代码优先方式：组合工具、保留状态，以及决定哪些信息应该返回给模型。

## 何时使用解释器

大多数 Agent 工作在模型推理和工具执行之间交替。这对于简单操作很有效，但当 Agent 需要组合多个步骤、推理结构化数据或管理中间状态时就变得笨拙。

解释器为这些工作提供了一个运行时。Agent 可以编写小程序来运行控制流、调用允许列表中的工具、存储变量，并将紧凑的结果返回给模型。

使用解释器的场景：

- **用代码组合多个工具调用**，包括循环、分支、重试和并发
- **通过代码协调子 Agent**，将工作拆分为专注的调用，存储结果并合成最终输出
- **在运行时状态中保留中间值**，而不是将每个临时结果发送回模型上下文
- **确定性地转换结构化数据**，如排序、分组、解析、验证、评分或聚合
- **探索大型变量空间**，仅将选定的证据、摘要或输出返回给模型

解释器通过 **QuickJS** 运行代码，这是一个为嵌入式执行设计的轻量级 JavaScript 运行时。默认情况下，运行时不暴露主机文件系统、网络、Shell、包或时钟 API。

## 选择正确的执行路径

| 需求 | 使用 |
| --- | --- |
| 一两个简单的外部调用 | 普通工具调用 |
| 需要循环、分支、重试或聚合的小程序 | 解释器 |
| 许多需要从代码运行的工具调用 | 带程序化工具调用的解释器 |
| 跨线程复用的辅助函数 | 带解释器技能的解释器 |
| Shell 命令、包安装、测试或完整 OS 文件系统访问 | 沙箱 |

## 添加解释器到 Agent

安装 QuickJS 中间件包，然后在创建 Agent 时添加中间件：

```typescript
import { createDeepAgent } from "deepagents";
import { createCodeInterpreterMiddleware } from "@langchain/quickjs";

// 创建带有解释器中间件的 Agent
const agent = createDeepAgent({
  model: "openai:gpt-5.4",
  middleware: [createCodeInterpreterMiddleware()],
});
```

## 在解释器中运行代码

中间件向 Agent 添加一个 `eval` 工具。该工具在持久化上下文中运行 TypeScript，捕获 `console.log`，并返回最后一个表达式的结果。

Agent 可以编写如下代码：

```typescript
const rows = [
  { team: "alpha", score: 8 },
  { team: "beta", score: 13 },
  { team: "alpha", score: 21 },
];

// 按团队汇总分数
const totals = rows.reduce((acc, row) => {
  acc[row.team] = (acc[row.team] ?? 0) + row.score;
  console.log(`${row.team} score: ${acc[row.team]}`)
  return acc;
}, {} as Record<string, number>);

totals;
```

## 程序化工具调用 (PTC)

程序化工具调用（PTC）在解释器内的全局 `tools` 命名空间中公开选定的 Agent 工具。Agent 可以编写代码，在循环、分支、重试或并行批处理中调用工具。

### 工作原理

1. 你通过 `ptc` 允许列表选择解释器可以调用的工具
2. 中间件将这些工具作为异步 JavaScript 函数暴露在 `tools` 下
3. Agent 编写使用 `await` 调用这些函数的解释器代码
4. 解释器运行工具桥接，接收工具结果并继续执行代码
5. 模型接收最终的解释器输出，而不是每个中间值

每个允许列表中的工具变成一个异步函数。工具名称转换为驼峰命名，输入对象遵循工具的 schema：

```typescript
// 调用 web_search 工具
const result: string = await tools.webSearch({
  query: "deepagents interpreters",
});
```

### 有用的模式

| **模式** | **解释器可以做什么** |
| --- | --- |
| 批量处理 | 循环遍历多个输入并为每个调用工具 |
| 并行工作 | 对独立调用使用 `Promise.all` |
| 条件逻辑 | 根据之前的结果选择下一个工具调用 |
| 提前终止 | 一旦满足成功条件就停止调用工具 |
| 数据过滤 | 仅将相关行、摘要或错误返回给模型 |
| 递归编排 | 重复调用 `task`，然后在代码中组合子 Agent 结果 |

### 启用 PTC

```typescript
import { createDeepAgent } from "deepagents";
import { createCodeInterpreterMiddleware } from "@langchain/quickjs";

// 启用 PTC，允许列表中包含 "task" 工具
const agent = createDeepAgent({
  model: "openai:gpt-5.4",
  middleware: [createCodeInterpreterMiddleware({ ptc: ["task"] })],
});
```

启用 PTC 后，Agent 可以并行启动多个子 Agent 并合并结果：

```typescript
// 并行研究多个主题
const topics = ["retrieval", "memory", "evaluation"];

const reports = await Promise.all(
  topics.map((topic) =>
    tools.task({
      description: `Research ${topic} in Deep Agents and return three concise findings.`,
      subagent_type: "general-purpose",
    }),
  ),
);

reports.join("\n\n");
```

Agent 还可以在代码中局部处理失败：

```typescript
try {
  const report = await tools.task({
    description: "Check the migration notes and return breaking changes.",
    subagent_type: "general-purpose",
  });
  console.log(report);
} catch (error) {
  console.log(`Subagent failed: ${(error as Error).message}`);
}
```

## 递归语言模型

递归语言模型使用解释器作为分解的工作区。模型在运行时变量中保留大型输入或工作集，编写代码检查和拆分它，在更小的片段上调用子 Agent 或其他模型工具，然后在代码中将返回的结果拼接在一起。

在 Deep Agents 中，递归调用通常是暴露给程序化工具调用的 `task` 工具：

```typescript
// 从笔记中筛选与迁移相关的条目
const candidates = notes
  .filter((note: string) => note.includes("migration"))
  .slice(0, 5);

// 并行分析每个候选条目的发布风险
const riskReports = await Promise.all(
  candidates.map((note: string) =>
    tools.task({
      description: `Analyze this migration note for release risk. Return risks, affected users, and recommended follow-up:\n\n${note}`,
      subagent_type: "general-purpose",
    }),
  ),
);

// 合并所有风险报告
const releaseSummary = riskReports
  .map((report, index) => `## Candidate ${index + 1}\n${report}`)
  .join("\n\n");

releaseSummary;
```

## 解释器技能

解释器技能是将代码模块暴露给解释器的技能。当配置了解释器中间件时，Agent 可以从代码中导入这些模块并用于确定性的辅助逻辑。

适用于需要可复用辅助函数的结构化数据工作流，如排序、分组、评分、解析、验证或聚合数据。

## 安全与限制

解释器使用 QuickJS 以严格的默认隔离运行不受信任的 JavaScript。这是一个有范围的解释器运行时，**不是**完整的生产沙箱后端。

| 能力 | 默认可用 | 如何暴露 |
| --- | --- | --- |
| JavaScript 执行 | 是 | 添加解释器中间件 |
| 顶层 `await` | 是 | 在解释器代码中使用 Promise |
| `console.log` 捕获 | 是 | 用 `captureConsole: false` 禁用 |
| Agent 工具 | 否 | 添加 PTC 允许列表 |
| 解释器技能模块 | 否 | 添加 `module` 条目并配置 `skillsBackend` |
| 文件系统访问 | 否 | 通过 PTC 允许列表添加内置文件系统工具 |
| 网络访问 | 否 | 通过 PTC 暴露特定的网络工具 |
| 时钟或日期时间访问 | 否 | 需要时暴露一个显式的时间工具 |
| Shell 命令、包安装、测试、OS 级执行 | 否 | 使用沙箱后端 |

## 中间件选项

`createCodeInterpreterMiddleware` 接受以下选项：

| 选项 | 默认值 | 用途 |
| --- | --- | --- |
| `ptc` | 省略 | PTC 允许列表：工具名称或 `StructuredToolInterface` 实例数组 |
| `memoryLimitBytes` | `64 * 1024 * 1024` (64 MB) | QuickJS 内存限制（字节） |
| `maxStackSizeBytes` | `320 * 1024` | QuickJS 栈大小限制（字节） |
| `executionTimeoutMs` | `5000` | 每次 eval 超时时间（毫秒）。负值禁用超时 |
| `systemPrompt` | `null` | 覆盖内置的解释器系统提示 |
| `skillsBackend` | 省略 | 用于解析解释器技能模块的后端 |
| `maxPtcCalls` | `256` | 每次 eval 最大 `tools.*` 调用次数。仅在可信环境中使用 `null` |
| `maxResultChars` | `4000` | 从控制台输出、结果和错误字符串中保留的最大字符数 |
| `toolName` | `"eval"` | 暴露给模型的解释器工具名称 |
| `captureConsole` | `true` | 是否捕获 `console.log`、`console.warn` 和 `console.error` 输出 |
