# 技能系统 (Skills)

> Skills 将领域专业知识打包为可复用的目录，让 Agent 按需加载，避免上下文膨胀。

## 概述

技能（Skills）将工作流、最佳实践、脚本、参考文档和模板等领域专业知识打包成可复用的目录。Agent 在启动时获取内容摘要，仅在相关时才读取完整文件。

技能通过**渐进式披露**（progressive disclosure）的方式帮助避免上下文膨胀——启动时只加载摘要，当任务需要时才读取完整指令。你可以在不同 Agent 和项目之间共享技能，也可以在单个 Agent 中组合多个技能。

## 技能的工作原理

随着 Agent 承担更复杂的任务，所需的上下文也随之增长。将所有指令加载到系统提示中会浪费 token，而手动跨会话提供相同指导则不可扩展。

### 三层加载机制

技能分三个级别加载，每个级别仅在任务需要时才增加更多细节：

| 级别 | 加载内容 | 加载时机 |
| --- | --- | --- |
| **1. 元数据** | `SKILL.md` 前置元数据中的 `name` 和 `description` | Agent 启动时，所有已配置的技能 |
| **2. 指令** | 完整的 `SKILL.md` 正文 | 技能被调用时 |
| **3. 资源** | `scripts/`、`references/` 和 `assets/` 下的支持文件 | 调用后按需加载 |

在 Deep Agents 中，`SkillsMiddleware`（当你传入 `skills` 时，作为默认中间件栈的一部分）处理前两个级别，第三个级别由 LLM 处理：

1. **发现**（级别 1）：Agent 启动时，中间件扫描已配置的技能路径，解析每个 `SKILL.md` 的前置元数据，将 `name` 和 `description` 字段注入系统提示。
2. **读取**（级别 2）：当 Agent 调用技能时，通过 `read_file` 读取完整的 `SKILL.md` 内容。
3. **执行**（级别 3）：调用后，Agent 按照技能指令操作，仅在指令需要时读取支持文件。

## 何时使用技能

如果你发现自己反复给 Agent 相似的指令，尤其是包含多个步骤的详细指令，考虑将这些指令编码为技能。技能特别适合：

- **多步骤工作流**：跨越多个步骤的工作流，类似于菜谱
- **领域特定知识**：指导 Agent 如何使用工具完成工作流
- **带可执行代码的指令**：将过程与脚本或模块打包，Agent 可以运行经过测试的逻辑
- **指南和规范**：提供护栏指令，如遵循特定格式或风格指南

## 编写有效技能

### 保持前置元数据简洁

将 `SKILL.md` 正文保持在 5,000 token 以下。每个技能的前置元数据在发现时都会添加到系统提示中。

### 编写具体的描述

在发现阶段，`description` 字段是 Agent 看到的唯一信息。好的描述应该告诉 Agent 技能做什么以及何时激活：

```yaml
# 好的示例：具体说明了做什么和何时使用
description: >-
  从 PDF 文件中提取文本和表格，填写 PDF 表单，合并多个 PDF。
  在处理 PDF 文档或用户提及 PDF、表单、文档提取时使用。

# 差的示例：太模糊，无法可靠匹配
description: Helps with PDFs.
```

### 保持指令聚焦

将 `SKILL.md` 保持在 500 行以下。当指令变长时，将详细的参考资料移入支持资源文件，并在主 `SKILL.md` 中引用它们。

## 添加支持资源

除了 `SKILL.md`，技能目录还可以包含任何额外的文件或目录。

### `scripts/` 目录

存放 Agent 可以运行的**可执行代码**，如 API 客户端、数据转换或验证检查。脚本应该：
- 自包含或清楚记录依赖
- 包含有用的错误消息
- 优雅地处理边缘情况

### `references/` 目录

存放 Agent 按需读取的**补充文档**。用于对 `SKILL.md` 来说过于详细但仍与任务相关的材料。

### `assets/` 目录

存放 Agent 使用但不需要作为指令读取的**静态资源**，如模板、图片、数据文件。

### 从 `SKILL.md` 引用文件

使用相对于技能根目录的路径：

```markdown
有关 API 详情，请参阅 [参考指南](references/api-patterns.md)。

要从 PDF 中提取表格，请运行：
scripts/extract.py
```

## 后端与远程技能加载

Deep Agents 支持不同的后端来存储和管理技能文件：

- `StateBackend`：将文件存储在当前线程的 LangGraph Agent 状态中
- `StoreBackend`：将文件存储在 LangGraph Store 中，用于持久的跨线程存储
- `FilesystemBackend`：从磁盘读取和写入技能文件

### 使用 StateBackend

```typescript
import { createCodeInterpreterMiddleware } from "@langchain/quickjs";
import { createDeepAgent, StateBackend, type FileData } from "deepagents";
import { MemorySaver } from "@langchain/langgraph";

// 创建检查点和后端
const checkpointer = new MemorySaver();
const backend = new StateBackend();

// 辅助函数：创建文件数据
function createFileData(content: string): FileData {
  const now = new Date().toISOString();
  return {
    content: content.split("\n"),
    created_at: now,
    modified_at: now,
  };
}

// 从远程 URL 加载技能内容
const skillsFiles: Record<string, FileData> = {};
const skillUrl =
  "https://raw.githubusercontent.com/langchain-ai/deepagentsjs/refs/heads/main/examples/skills/langgraph-docs/SKILL.md";
const response = await fetch(skillUrl);
const skillContent = await response.text();

skillsFiles["/skills/langgraph-docs/SKILL.md"] = createFileData(skillContent);

// 创建带有技能的 Agent
const agent = await createDeepAgent({
  model: "google-genai:gemini-3.1-pro-preview",
  backend,
  checkpointer, // 必需！
  // 重要：deepagents 技能源路径是相对于后端根目录的虚拟（POSIX）路径
  skills: ["/skills/"],
  middleware: [createCodeInterpreterMiddleware({ skillsBackend: backend })],
});

// 调用 Agent
const config = { configurable: { thread_id: `thread-${Date.now()}` } };
const result = await agent.invoke(
  {
    messages: [{ role: "user", content: "what is langraph?" }],
    files: skillsFiles,
  },
  config,
);
```

### 使用 StoreBackend

```typescript
import { createCodeInterpreterMiddleware } from "@langchain/quickjs";
import { createDeepAgent, StoreBackend, type FileData } from "deepagents";
import { InMemoryStore, MemorySaver } from "@langchain/langgraph";

// 创建检查点器和存储
const checkpointer = new MemorySaver();
const store = new InMemoryStore();
const backend = new StoreBackend({
  namespace: () => ["filesystem"],
});

// 辅助函数：创建文件数据
function createFileData(content: string): FileData {
  const now = new Date().toISOString();
  return {
    content: content.split("\n"),
    created_at: now,
    modified_at: now,
  };
}

// 从远程 URL 加载技能并存储
const skillUrl =
  "https://raw.githubusercontent.com/langchain-ai/deepagentsjs/refs/heads/main/examples/skills/langgraph-docs/SKILL.md";

const response = await fetch(skillUrl);
const skillContent = await response.text();
const fileData = createFileData(skillContent);

// 将技能文件放入存储
await store.put(["filesystem"], "/skills/langgraph-docs/SKILL.md", fileData);

// 创建带有技能的 Agent
const agent = await createDeepAgent({
  model: "google-genai:gemini-3.1-pro-preview",
  backend,
  store,
  checkpointer,
  skills: ["/skills/"],
  middleware: [createCodeInterpreterMiddleware({ skillsBackend: backend })],
});

const config = {
  recursionLimit: 50,
  configurable: { thread_id: `thread-${Date.now()}` },
};
const result = await agent.invoke(
  { messages: [{ role: "user", content: "what is langraph?" }] },
  config,
);
```

### 使用 FilesystemBackend

```typescript
import { createCodeInterpreterMiddleware } from "@langchain/quickjs";
import { createDeepAgent, FilesystemBackend } from "deepagents";
import { MemorySaver } from "@langchain/langgraph";

// 创建基于文件系统的后端
const checkpointer = new MemorySaver();
const backend = new FilesystemBackend({ rootDir: process.cwd() });

// 创建 Agent，技能路径指向本地文件系统
const agent = await createDeepAgent({
  model: "google-genai:gemini-3.1-pro-preview",
  backend,
  skills: ["./examples/skills/"],
  interruptOn: {
    read_file: true,
    write_file: true,
    delete_file: true,
  },
  checkpointer, // 必需！
  middleware: [createCodeInterpreterMiddleware({ skillsBackend: backend })],
});

const config = { configurable: { thread_id: `thread-${Date.now()}` } };
const result = await agent.invoke(
  { messages: [{ role: "user", content: "what is langraph?" }] },
  config,
);
```

## 运行时加载技能

当你有大量技能集合但只有部分与某次运行相关时，可以根据运行时上下文（如用户角色、租户或请求类型）选择要加载的技能。

### 动态技能列表

最简单的方法是在创建 Agent 之前构建 `skills` 数组：

```typescript
import { createDeepAgent } from "deepagents";

// 按角色定义技能路径映射
const SKILLS_BY_ROLE: Record<string, string[]> = {
  engineering: ["/skills/code-review/", "/skills/testing/", "/skills/deployment/"],
  data: ["/skills/sql-analysis/", "/skills/visualization/", "/skills/data-pipeline/"],
  support: ["/skills/ticket-triage/", "/skills/runbook/"],
};

// 根据用户角色创建对应的 Agent
function createAgentForUser(userRole: string) {
  return createDeepAgent({
    model: "anthropic:claude-sonnet-4-6",
    skills: SKILLS_BY_ROLE[userRole] ?? [],
  });
}
```

### 命名空间技能

对于多租户应用，将 `/skills/` 路由到带有命名空间工厂的 StoreBackend：

```typescript
import {
  createDeepAgent,
  CompositeBackend,
  StateBackend,
  StoreBackend,
} from "deepagents";

// 使用组合后端，按用户路由技能
const agent = await createDeepAgent({
  model: "anthropic:claude-sonnet-4-6",
  skills: ["/skills/"],
  backend: new CompositeBackend({
    default: new StateBackend(),
    routes: {
      "/skills/": new StoreBackend({
        namespace: (ctx) => [
          ctx.assistantId ?? "default",
          ctx.config?.configurable?.user_id ?? "anonymous",
        ],
      }),
    },
  }),
});
```

## 子 Agent 的技能

当你使用子 Agent 时，可以配置每种类型的子 Agent 可以访问哪些技能：

- **通用子 Agent**：当你将 `skills` 传递给 `createDeepAgent` 时，自动继承主 Agent 的技能
- **自定义子 Agent**：不继承主 Agent 的技能，需要单独配置

```typescript
// 定义带有特定技能的研究子 Agent
const researchSubagent = {
  name: "researcher",
  description: "Research assistant with specialized skills",
  systemPrompt: "You are a researcher.",
  tools: [webSearch],
  skills: ["/skills/research/", "/skills/web-search/"],  // 子 Agent 专属技能
};

// 创建主 Agent
const agent = await createDeepAgent({
  model: "google_genai:gemini-3.5-flash",
  skills: ["/skills/main/"],  // 主 Agent 和通用子 Agent 使用这些技能
  subagents: [researchSubagent],  // 研究员只使用自己的技能
});
```

## 技能权限

### 限制技能写入权限

```typescript
import { MemorySaver } from "@langchain/langgraph";
import { createDeepAgent } from "deepagents";

// 创建需要写入审批的 Agent
const agent = await createDeepAgent({
  model: "anthropic:claude-sonnet-4-6",
  skills: ["/skills/personal/"],
  permissions: [
    {
      operations: ["write"],
      paths: ["/skills/**"],
      mode: "interrupt",  // 写入技能文件时暂停等待人工审批
    },
  ],
  checkpointer: new MemorySaver(), // 暂停和恢复所必需
});
```

### 允许 Agent 编辑个人技能

```typescript
import {
  createDeepAgent,
  CompositeBackend,
  StateBackend,
  StoreBackend,
} from "deepagents";

// 共享技能只读，个人技能可写
const agent = await createDeepAgent({
  model: "anthropic:claude-sonnet-4-6",
  backend: new CompositeBackend({
    default: new StateBackend(),
    routes: {
      // 共享技能：组织级别，只读
      "/skills/shared/": new StoreBackend({
        namespace: (rt) => ["curated-skills", rt.context.orgId],
      }),
      // 个人技能：用户级别，可写
      "/skills/personal/": new StoreBackend({
        namespace: (ctx) => [
          "user-skills",
          ctx.config?.configurable?.user_id ?? "anonymous",
        ],
      }),
    },
  }),
  skills: ["/skills/shared/", "/skills/personal/"],
  permissions: [
    {
      operations: ["write"],
      paths: ["/skills/shared/**"],
      mode: "deny",  // 禁止写入共享技能
    },
  ],
});
```

## 使用技能执行代码

技能支持两种代码执行方式：

- **沙箱脚本**：当 Agent 需要安装依赖、运行测试、调用 CLI 或使用操作系统文件系统时
- **解释器技能**：当 Agent 需要在解释器代码中使用的可复用、可导入的辅助函数时

### 解释器技能示例

技能目录结构：

```yaml
# skills/order-helpers/SKILL.md
---
name: order-helpers
description: 用于规范化订单记录的辅助函数
metadata:
  entrypoint: scripts/index.ts
---

# order-helpers

当订单记录需要确定性清理或聚合时使用此技能。

在 REPL 中导入这些工具以与订单数据交互：

```typescript
const { groupByStatus } = await import("@/skills/order-helpers");
groupByStatus(...);
```
```

辅助函数代码：

```typescript
// skills/order-helpers/scripts/index.ts
interface Order {
  id: string;
  status: string;
}

// 按状态分组订单
export function groupByStatus(orders: Order[]) {
  return orders.reduce((acc, order) => {
    acc[order.status] = acc[order.status] ?? [];
    acc[order.status].push(order);
    return acc;
  }, {} as Record<string, Order[]>);
}
```

配置 Agent 使用解释器技能：

```typescript
import { createDeepAgent, StateBackend } from "deepagents";
import { createCodeInterpreterMiddleware } from "@langchain/quickjs";

const backend = new StateBackend();

const agent = createDeepAgent({
  model: "openai:gpt-5.4",
  backend,
  skills: ["/skills/"],
  middleware: [createCodeInterpreterMiddleware({ skillsBackend: backend })],
});
```

Agent 可以在解释器代码中导入模块：

```typescript
const { groupByStatus } = await import("@/skills/order-helpers");

const grouped = groupByStatus(orders);
grouped;
```

## 故障排除

### 技能未被激活

**问题**：Agent 处理任务时没有读取技能的 `SKILL.md`。

**解决方案**：
1. 使描述更具体——包含技能做什么、何时使用和关键词
2. 减少技能之间的重叠
3. 确认技能在 `skills` 数组中

### 启动时技能缺失

**问题**：Agent 没有在系统提示中列出技能。

**解决方案**：
1. 检查技能路径——路径必须使用正斜杠，相对于后端根目录
2. 验证 `SKILL.md` 前置元数据格式
3. 检查文件大小——Deep Agents 在发现时跳过超过 10 MB 的文件

### 支持文件未找到

**问题**：Agent 读取了 `SKILL.md` 但无法访问脚本、参考或资产。

**解决方案**：
1. 在 `SKILL.md` 中引用文件——Agent 不会自动发现支持文件
2. 保持路径在技能目录内
3. 如果使用沙箱后端，需要先将技能文件同步到沙箱中

## 参考

### 技能、记忆和工具对比

|  | 技能 (Skills) | 记忆 (Memory) | 工具 (Tools) |
| --- | --- | --- | --- |
| **用途** | 通过渐进式披露发现的按需能力 | 启动时加载的持久上下文 | Agent 可以调用的编程操作 |
| **加载** | 仅在 Agent 判断相关时读取 | Agent 启动时加载 | 每轮都可用 |
| **格式** | 命名目录中的 `SKILL.md` | `AGENTS.md` 文件 | 绑定到 Agent 的函数 |
| **层级** | 用户级，然后项目级（后者覆盖） | 用户级，然后项目级（合并） | Agent 创建时定义 |

### 前置元数据字段

| 字段 | 必需 | 描述 |
| --- | --- | --- |
| `name` | 是 | 小写字母数字加连字符，1-64 字符。必须匹配父目录名称 |
| `description` | 是 | 技能做什么和何时使用。最多 1,024 字符 |
| `license` | 否 | 许可证名称或许可证文件引用 |
| `compatibility` | 否 | 环境要求（系统包、网络访问）。最多 500 字符 |
| `metadata` | 否 | 额外属性的任意键值对 |
| `allowed-tools` | 否 | 预批准的工具列表（空格分隔）。实验性功能 |

前置元数据示例：

```yaml
---
name: langgraph-docs
description: 用于与 LangGraph 相关的请求，以获取相关文档并提供准确的最新指导。
license: MIT
compatibility: 需要互联网访问以获取文档 URL
metadata:
  author: langchain
  version: "1.0"
allowed-tools: fetch_url
---

# langgraph-docs

Agent 指令放在这里。
```
