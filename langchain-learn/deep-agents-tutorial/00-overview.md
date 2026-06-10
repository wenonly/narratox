# Deep Agents 教程 — TypeScript 完全指南

> 基于 [LangChain Deep Agents](https://docs.langchain.com/oss/javascript/deepagents/overview) 官方文档整理

## 什么是 Deep Agents？

Deep Agents 是 LangChain 推出的**智能体框架 (Agent Harness)**，基于 LangChain 核心构建模块和 LangGraph 生产级工具构建。它提供了构建可靠 LLM 应用所需的全部内置能力：

- **环境操作** — 通过工具执行动作、读写文件、运行代码
- **数据连接** — 在正确时刻加载记忆、技能和领域知识
- **上下文管理** — 跨长时间运行自动压缩和摘要历史
- **任务并行** — 委派给通用或专用子代理，在隔离上下文窗口中运行
- **人机协作** — 在关键决策点暂停等待人类审批
- **持续改进** — 根据实际使用更新记忆、技能和提示词

## 快速安装

```bash
npm install deepagents langchain @langchain/core
```

## 30 秒创建一个 Deep Agent

```typescript
import * as z from "zod";
import { createDeepAgent } from "deepagents";
import { tool } from "langchain";

// 定义工具
const getWeather = tool(
  ({ city }) => `It's always sunny in ${city}!`,
  {
    name: "get_weather",
    description: "Get the weather for a given city",
    schema: z.object({
      city: z.string(),
    }),
  },
);

// 创建智能体
const agent = createDeepAgent({
  tools: [getWeather],
  systemPrompt: "You are a helpful assistant",
});

// 调用智能体
const result = await agent.invoke({
  messages: [{ role: "user", content: "What's the weather in Tokyo?" }],
});
console.log(result);
```

## 教程章节索引

### 入门篇

| 章节 | 文件 | 内容 |
|------|------|------|
| 快速入门 | [01-quickstart.md](01-quickstart.md) | 构建你的第一个 Deep Agent |
| 自定义配置 | [02-customization.md](02-customization.md) | 自定义选项详解 |
| 与 Claude Agent SDK 对比 | [03-comparison.md](03-comparison.md) | 框架对比分析 |

### 部署篇

| 章节 | 文件 | 内容 |
|------|------|------|
| 托管 Deep Agents | [04-managed-deep-agents.md](04-managed-deep-agents.md) | 部署到 LangSmith |
| 生产就绪 | [05-going-to-production.md](05-going-to-production.md) | 生产环境最佳实践 |

### 核心能力篇

| 章节 | 文件 | 内容 |
|------|------|------|
| 核心能力概览 | [06-core-capabilities.md](06-core-capabilities.md) | 全部内置能力介绍 |
| 模型配置 | [07-models.md](07-models.md) | 配置模型和提供商 |
| 工具系统 | [08-tools.md](08-tools.md) | 自定义工具与 MCP |
| 上下文工程 | [09-context-engineering.md](09-context-engineering.md) | 上下文管理与压缩 |
| 文件系统后端 | [10-backends.md](10-backends.md) | 可插拔文件系统后端 |
| 子代理 | [11-subagents.md](11-subagents.md) | 子代理生成与委派 |
| 异步子代理 | [12-async-subagents.md](12-async-subagents.md) | 后台并行任务 |
| 人在环路 | [13-human-in-the-loop.md](13-human-in-the-loop.md) | 人类审批机制 |
| 权限控制 | [14-permissions.md](14-permissions.md) | 文件系统访问权限 |
| 长期记忆 | [15-memory.md](15-memory.md) | 跨会话持久化记忆 |
| 技能系统 | [16-skills.md](16-skills.md) | 可复用技能扩展 |
| 沙箱执行 | [17-sandboxes.md](17-sandboxes.md) | 隔离执行环境 |
| 解释器 | [18-interpreters.md](18-interpreters.md) | QuickJS 运行时 |
| 配置文件 | [19-profiles.md](19-profiles.md) | Agent 配置方案 |
| 事件流 | [20-event-streaming.md](20-event-streaming.md) | 类型化事件流 |
| 流式输出 | [21-streaming.md](21-streaming.md) | 实时流式响应 |

### 前端篇

| 章节 | 文件 | 内容 |
|------|------|------|
| 前端集成概览 | [22-frontend.md](22-frontend.md) | 前端架构 |
| 前端模式 | [23-frontend-patterns.md](23-frontend-patterns.md) | UI 集成模式 |

### 协议篇

| 章节 | 文件 | 内容 |
|------|------|------|
| Agent Client Protocol | [24-acp.md](24-acp.md) | ACP 协议集成 |
| MCP 集成 | [25-mcp.md](25-mcp.md) | Model Context Protocol |
| A2A 协议 | [26-a2a.md](26-a2a.md) | Agent-to-Agent 通信 |

### Deep Agents Code 篇

| 章节 | 文件 | 内容 |
|------|------|------|
| Code 概览 | [27-deep-agents-code.md](27-deep-agents-code.md) | 代码执行环境 |
| 记忆与技能 | [28-code-memory-skills.md](28-code-memory-skills.md) | 代码中的记忆管理 |
| 远程沙箱 | [29-code-remote-sandboxes.md](29-code-remote-sandboxes.md) | 远程隔离执行 |
| 子代理 | [30-code-subagents.md](30-code-subagents.md) | 代码中的子代理 |
| 模型提供商 | [31-code-model-providers.md](31-code-model-providers.md) | 配置模型 |
| 配置管理 | [32-code-configuration.md](32-code-configuration.md) | 配置文件详解 |
| MCP 工具 | [33-code-mcp-tools.md](33-code-mcp-tools.md) | MCP 工具集成 |
| 应用数据 | [34-code-app-data.md](34-code-app-data.md) | 应用数据管理 |

## 架构关系

```
┌─────────────────────────────────────────┐
│            Deep Agents (Harness)        │
│  ┌───────────┐ ┌──────────┐ ┌────────┐ │
│  │ 规划引擎  │ │ 上下文管理│ │ 子代理 │ │
│  └───────────┘ └──────────┘ └────────┘ │
│  ┌───────┐ ┌────────┐ ┌──────────────┐ │
│  │ 记忆  │ │ 技能   │ │ 文件系统权限 │ │
│  └───────┘ └────────┘ └──────────────┘ │
├─────────────────────────────────────────┤
│          LangGraph (Runtime)            │
│  ┌───────────┐ ┌───────────┐           │
│  │ 流式处理  │ │ 检查点    │           │
│  └───────────┘ └───────────┘           │
├─────────────────────────────────────────┤
│          LangChain (Framework)          │
│  ┌──────────┐ ┌──────────┐ ┌────────┐ │
│  │ 模型接口 │ │ 工具抽象 │ │ 消息   │ │
│  └──────────┘ └──────────┘ └────────┘ │
└─────────────────────────────────────────┘
```

## 学习路径建议

1. **新手**：01 → 02 → 06 → 07 → 08
2. **进阶**：09 → 11 → 15 → 16 → 13
3. **生产部署**：04 → 05 → 14 → 17 → 20
4. **深度定制**：10 → 18 → 19 → 27-34

---

> 📖 官方文档：https://docs.langchain.com/oss/javascript/deepagents/overview
