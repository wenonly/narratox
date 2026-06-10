# 代理客户端协议 - Agent Client Protocol (ACP)

> ACP 标准化了编码代理与代码编辑器/IDE 之间的通信协议。

## 概述

Agent Client Protocol (ACP) 标准化了编码代理与代码编辑器或 IDE 之间的通信。通过 ACP 协议，你可以让自定义的 Deep Agents 与任何兼容 ACP 的客户端配合使用，使代码编辑器能够提供项目上下文并接收丰富的更新。

## 快速开始

### 安装 ACP 集成包

```bash
npm install deepagents-acp
```

### 暴露 Deep Agent 到 ACP

启动一个 stdio 模式的 ACP 服务器（从 stdin 读取请求，向 stdout 写入响应）。通常，这是由 ACP 客户端（例如你的编辑器）作为命令启动的，然后通过 stdio 与服务器通信。

```typescript
import { startServer } from "deepagents-acp";

// 启动 ACP 服务器，暴露一个编码助手代理
await startServer({
  agents: {
    name: "coding-assistant",                    // 代理名称
    description: "AI coding assistant with filesystem access",  // 描述
  },
  workspaceRoot: process.cwd(),                  // 工作区根目录
});
```

### 使用 CLI（无需编写代码）

```bash
npx deepagents-acp
```

## 支持的客户端

Deep Agents 可以在任何能运行 ACP 代理服务器的地方工作。一些主要的 ACP 客户端包括：

- **Zed** 编辑器
- **JetBrains IDE** 系列
- **Visual Studio Code**（通过 vscode-acp 插件）
- **Neovim**（通过 ACP 兼容插件）

### Zed 编辑器配置

将 Deep Agent 注册到 Zed 中，添加到设置文件（macOS: `~/Library/Application Support/Zed/settings.json`）：

**简单设置（无需代码）：**

```json
{
  "agent": {
    "profiles": {
      "deepagents": {
        "name": "DeepAgents",
        "command": "npx",
        "args": ["deepagents-acp"],
        "env": {
          "ANTHROPIC_API_KEY": "sk-ant-..."
        }
      }
    }
  }
}
```

**带 CLI 选项：**

```json
{
  "agent": {
    "profiles": {
      "deepagents": {
        "name": "DeepAgents",
        "command": "npx",
        "args": [
          "deepagents-acp",
          "--name", "my-assistant",
          "--skills", "./skills",
          "--debug"
        ],
        "env": {
          "ANTHROPIC_API_KEY": "sk-ant-..."
        }
      }
    }
  }
}
```

**自定义服务器脚本：**

```typescript
// server.ts - 自定义 ACP 服务器脚本
import { startServer } from "deepagents-acp";

await startServer({
  agents: {
    name: "my-agent",
    description: "My custom coding agent",
    skills: ["./skills/"],    // 技能目录路径
  },
});
```

然后在 Zed 设置中指向此脚本：

```json
{
  "agent": {
    "profiles": {
      "my-agent": {
        "name": "My Agent",
        "command": "npx",
        "args": ["tsx", "./server.ts"]
      }
    }
  }
}
```

## CLI 参考

```bash
npx deepagents-acp [选项]
```

| 选项 | 缩写 | 描述 |
|---|---|---|
| `--name <name>` | `-n` | 代理名称（默认: `"deepagents"`） |
| `--description <desc>` | `-d` | 代理描述 |
| `--model <model>` | `-m` | LLM 模型（默认: `"claude-sonnet-4-5-20250929"`） |
| `--workspace <path>` | `-w` | 工作区根目录（默认: 当前目录） |
| `--skills <paths>` | `-s` | 逗号分隔的技能路径 |
| `--memory <paths>` | | 逗号分隔的 AGENTS.md 路径 |
| `--debug` | | 启用调试日志输出到 stderr |
| `--help` | `-h` | 显示帮助信息 |
| `--version` | `-v` | 显示版本号 |

### 环境变量

| 变量 | 描述 |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic/Claude 模型的 API 密钥（必需） |
| `OPENAI_API_KEY` | OpenAI 模型的 API 密钥 |
| `DEBUG` | 设为 `"true"` 启用调试日志 |
| `WORKSPACE_ROOT` | `--workspace` 的替代环境变量 |

## 编程式 API

### `startServer` - 便捷函数

一步创建并启动服务器：

```typescript
import { startServer } from "deepagents-acp";

const server = await startServer({
  agents: {
    name: "coding-assistant",
    description: "AI coding assistant with filesystem access",
  },
  workspaceRoot: process.cwd(),
});
```

### `DeepAgentsServer` - 完整控制

使用 `DeepAgentsServer` 类进行完整控制：

```typescript
import { DeepAgentsServer } from "deepagents-acp";

// 创建带有多个代理的服务器实例
const server = new DeepAgentsServer({
  agents: [
    {
      name: "code-agent",
      description: "Full-featured coding assistant",
      model: "claude-sonnet-4-5-20250929",
      skills: ["./skills/"],
      memory: ["./.deepagents/AGENTS.md"],
    },
    {
      name: "reviewer",
      description: "Code review specialist",
      systemPrompt: "You are a code review expert...",
    },
  ],
  serverName: "my-deepagents-acp",
  serverVersion: "1.0.0",
  workspaceRoot: process.cwd(),
  debug: true,
});

await server.start();
```

#### 服务器选项

| 选项 | 类型 | 默认值 | 描述 |
|---|---|---|---|
| `agents` | `DeepAgentConfig \| DeepAgentConfig[]` | 必需 | 代理配置 |
| `serverName` | `string` | `"deepagents-acp"` | ACP 服务器名称 |
| `serverVersion` | `string` | `"0.0.1"` | 服务器版本 |
| `workspaceRoot` | `string` | `process.cwd()` | 工作区根目录 |
| `debug` | `boolean` | `false` | 启用调试日志 |

## 自定义功能

### 多代理支持

从单个服务器暴露多个代理，ACP 客户端在创建会话时选择使用哪个代理：

```typescript
const server = new DeepAgentsServer({
  agents: [
    { name: "code-agent", description: "General coding" },
    { name: "reviewer", description: "Code reviews" },
  ],
});
```

### 斜杠命令

服务器注册内置斜杠命令：`/plan`、`/agent`、`/ask`、`/clear` 和 `/status`。你也可以为每个代理定义自定义命令：

```typescript
const server = new DeepAgentsServer({
  agents: {
    name: "my-agent",
    commands: [
      { name: "test", description: "Run the project's test suite" },
      { name: "lint", description: "Run linter and fix issues" },
      {
        name: "deploy",
        description: "Deploy to staging",
        input: { hint: "environment (staging or production)" },
      },
    ],
  },
});
```

### 人机交互（HITL）

使用 `interruptOn` 在 IDE 中要求用户批准敏感工具操作：

```typescript
const server = new DeepAgentsServer({
  agents: {
    name: "careful-agent",
    interruptOn: {
      // execute 工具需要用户审批，可选操作：approve, edit, reject
      execute: { allowedDecisions: ["approve", "edit", "reject"] },
      // write_file 工具也需要用户审批
      write_file: true,
    },
  },
});
```

### 自定义工具

```typescript
import { DeepAgentsServer } from "deepagents-acp";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

// 使用 LangChain 的 tool 函数定义自定义工具
const searchTool = tool(
  async ({ query }) => {
    return `Results for: ${query}`;
  },
  {
    name: "search",
    description: "Search the codebase",
    schema: z.object({ query: z.string() }),
  },
);

const server = new DeepAgentsServer({
  agents: {
    name: "search-agent",
    tools: [searchTool],  // 将自定义工具添加到代理
  },
});

await server.start();
```

### 自定义后端

```typescript
import { DeepAgentsServer } from "deepagents-acp";
import { CompositeBackend, FilesystemBackend, StateBackend } from "deepagents";

const server = new DeepAgentsServer({
  agents: {
    name: "custom-agent",
    // 使用组合后端，将不同路径路由到不同后端
    backend: new CompositeBackend({
      routes: [
        {
          prefix: "/workspace",
          backend: new FilesystemBackend({ rootDir: "./workspace" }),
        },
        { prefix: "/", backend: new StateBackend() },
      ],
    }),
  },
});

await server.start();
```

### 技能和记忆

```typescript
import { startServer } from "deepagents-acp";

await startServer({
  agents: {
    name: "project-agent",
    description: "Agent with project-specific knowledge",
    skills: ["./skills/", "~/.deepagents/skills/"],  // 技能路径
    memory: ["./.deepagents/AGENTS.md"],               // 记忆文件
  },
  workspaceRoot: process.cwd(),
});
```

## ACP Registry

Deep Agents 已在 ACP Agent Registry 中注册，支持在 Zed 和 JetBrains IDE 中一键安装。当 ACP 客户端支持注册表时，用户可以直接发现和安装 Deep Agents，无需手动配置。

## 小结

- ACP 协议标准化了编码代理与 IDE 之间的通信
- 支持 Zed、JetBrains、VS Code、Neovim 等主流编辑器
- 提供 CLI 和编程式 API 两种使用方式
- 支持多代理、自定义工具、人机交互等高级功能
- 通过 `interruptOn` 配置敏感操作的审批机制
