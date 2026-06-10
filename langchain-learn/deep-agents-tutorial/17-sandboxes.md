# 沙箱 (Sandboxes)

> 在隔离环境中执行代码，使用沙箱后端保护主机系统安全。

## 概述

Agent 会生成代码、与文件系统交互并运行 Shell 命令。由于我们无法预测 Agent 可能会做什么，因此重要的是将其环境隔离，使其无法访问凭证、文件或网络。**沙箱**通过在 Agent 的执行环境和主机系统之间创建边界来提供这种隔离。

在 Deep Agents 中，**沙箱是后端**（backends），定义了 Agent 运行的环境。与其他后端（State、Filesystem、Store）不同，沙箱后端还提供了 `execute` 工具用于运行 Shell 命令。当你配置沙箱后端时，Agent 获得：

- 所有标准文件系统工具（`ls`、`read_file`、`write_file`、`edit_file`、`glob`、`grep`）
- `execute` 工具，用于在沙箱中运行任意 Shell 命令
- 保护主机系统的安全边界

## 为什么使用沙箱？

沙箱用于**安全**。它们让 Agent 执行任意代码、访问文件和使用网络，而不会损害你的凭证、本地文件或主机系统。

沙箱特别适用于：

- **编码 Agent**：自主运行的 Agent 可以使用 Shell、Git、克隆仓库，并运行 Docker-in-Docker 进行构建和测试管道
- **数据分析 Agent**：在安全的隔离环境中加载文件、安装数据分析库（pandas、numpy 等）、运行统计计算并创建输出

## 基本用法

```typescript
import { createDeepAgent } from "deepagents";
import { ChatAnthropic } from "@langchain/anthropic";
import { DenoSandbox } from "@langchain/deno";

// 创建并初始化沙箱
const sandbox = await DenoSandbox.create({
  memoryMb: 1024,   // 内存限制：1024 MB
  lifetime: "10m",  // 生存时间：10 分钟
});

try {
  const agent = createDeepAgent({
    model: new ChatAnthropic({ model: "claude-opus-4-6" }),
    systemPrompt: "You are a JavaScript coding assistant with sandbox access.",
    backend: sandbox,  // 将沙箱作为后端
  });

  const result = await agent.invoke({
    messages: [
      {
        role: "user",
        content:
          "Create a simple HTTP server using Deno.serve and test it with curl",
      },
    ],
  });
} finally {
  // 使用完毕后关闭沙箱，释放资源
  await sandbox.close();
}
```

## 生命周期与作用域

大多数应用选择**每个线程一个沙箱**（线程作用域）或**每个助手共享一个沙箱**（助手作用域）。

沙箱消耗资源并持续产生费用，直到关闭。确保在不再使用时关闭沙箱。

### 线程作用域（默认）

每个对话获得自己的沙箱。第一次运行创建它；同一线程上的后续对话复用它。当线程结束或沙箱 TTL 过期时，环境消失。

```typescript
import { Daytona } from "@daytonaio/sdk";
import { DaytonaSandbox } from "@langchain/daytona";
import { createDeepAgent } from "deepagents";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";

const client = new Daytona();

// 异步工厂函数：根据线程 ID 创建或复用沙箱
export async function agent(config: LangGraphRunnableConfig) {
  const threadId = config.configurable?.thread_id as string;
  let sandbox;
  try {
    // 尝试查找已有的沙箱
    sandbox = await client.findOne({ labels: { thread_id: threadId } });
  } catch {
    // 没找到，创建新的沙箱
    sandbox = await client.create({
      labels: { thread_id: threadId },
      autoDeleteInterval: 3600, // TTL：空闲时自动清理
    });
  }
  return createDeepAgent({
    model: "google_genai:gemini-3.5-flash",
    backend: await DaytonaSandbox.fromId(sandbox.id),
  });
}
```

### 助手作用域

同一助手上的每个线程复用一个沙箱。文件、安装的包和克隆的仓库在对话之间持久存在。

```typescript
import { Daytona } from "@daytonaio/sdk";
import { DaytonaSandbox } from "@langchain/daytona";
import { createDeepAgent } from "deepagents";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";

const client = new Daytona();

// 异步工厂函数：根据助手 ID 创建或复用沙箱
export async function agent(config: LangGraphRunnableConfig) {
  const assistantId = config.configurable?.assistant_id as string;
  let sandbox;
  try {
    // 尝试查找该助手已有的沙箱
    sandbox = await client.findOne({ labels: { assistant_id: assistantId } });
  } catch {
    // 没找到，创建新的共享沙箱
    sandbox = await client.create({ labels: { assistant_id: assistantId } });
  }
  return createDeepAgent({
    model: "google_genai:gemini-3.5-flash",
    backend: await DaytonaSandbox.fromId(sandbox.id),
  });
}
```

## 集成模式

根据 Agent 运行的位置，有两种架构模式。

### Agent 在沙箱中模式

Agent 在沙箱内运行，通过网络进行通信。

**优点**：
- 紧密耦合 Agent 和环境
- 接近本地开发体验

**缺点**：
- API 密钥必须存在于沙箱内（安全风险）
- 更新需要重建镜像
- 需要通信基础设施（WebSocket 或 HTTP 层）

### 沙箱作为工具模式（推荐）

Agent 运行在你的机器或服务器上。当需要执行代码时，它调用沙箱工具（如 `execute`、`read_file`、`write_file`），通过提供商的 API 在远程沙箱中运行操作。

**优点**：
- 即时更新 Agent 代码，无需重建镜像
- Agent 状态与执行环境更清晰分离
- API 密钥保留在沙箱外部
- 可以在多个沙箱中并行运行任务
- 只按执行时间付费

**缺点**：
- 每次执行调用有网络延迟

```typescript
import "dotenv/config";
import { DaytonaSandbox } from "@langchain/daytona";
import { createDeepAgent } from "deepagents";

// 创建沙箱（也可以使用 E2B、Runloop、Modal）
const sandbox = await DaytonaSandbox.create();

const agent = createDeepAgent({
  backend: sandbox,
  systemPrompt:
    "You are a coding assistant with sandbox access. You can create and run code in the sandbox.",
});

try {
  const result = await agent.invoke({
    messages: [
      {
        role: "user",
        content: "Create a hello world Python script and run it",
      },
    ],
  });
  const lastMessage = result.messages[result.messages.length - 1];
  console.log(
    typeof lastMessage.content === "string"
      ? lastMessage.content
      : String(lastMessage.content),
  );
} catch (err) {
  // 可选：在异常时主动删除沙箱
  await sandbox.close();
  throw err;
}
```

## 沙箱的工作原理

### 隔离边界

所有沙箱提供商保护你的主机系统免受 Agent 的文件系统和 Shell 操作的影响。Agent 无法读取本地文件、访问环境变量或干扰其他进程。

然而，沙箱本身**不能**防护：
- **上下文注入**：控制 Agent 输入的攻击者可以指示它在沙箱内运行任意命令
- **网络渗透**：除非阻止网络访问，否则上下文注入的 Agent 可以通过 HTTP 或 DNS 从沙箱发送数据

### `execute` 方法

沙箱后端架构简单：提供商必须实现的唯一方法是 `execute()`，它运行 Shell 命令并返回输出。其他所有文件系统操作都由 `BaseSandbox` 基类在 `execute()` 之上构建。

这意味着：
- **添加新提供商很简单**——只需实现 `execute()`
- **`execute` 工具按条件可用**——如果后端未实现 `SandboxBackendProtocol`，工具会被过滤掉

### 两个文件访问层

1. **Agent 文件系统工具**：`read_file`、`write_file`、`edit_file`、`ls`、`glob`、`grep` 和 `execute`——Agent 在执行期间调用的工具
2. **文件传输 API**：`uploadFiles()` 和 `downloadFiles()`——你的应用代码调用的方法，使用提供商的原生文件传输 API

## 文件操作

### 种子沙箱

使用 `uploadFiles()` 在 Agent 运行之前填充沙箱：

```typescript
const encoder = new TextEncoder();
// 上传初始文件到沙箱
const responses = await sandbox.uploadFiles([
  ["src/index.js", encoder.encode("console.log('Hello')")],
  ["package.json", encoder.encode('{"name": "my-app"}')],
]);

// 检查每个文件的上传结果
for (const res of responses) {
  if (res.error) {
    console.error(`Failed to upload ${res.path}: ${res.error}`);
  }
}
```

### 获取产物

使用 `downloadFiles()` 在 Agent 完成后从沙箱获取文件：

```typescript
const results = await sandbox.downloadFiles(["src/index.js", "output.txt"]);

const decoder = new TextDecoder();
for (const result of results) {
  if (result.content) {
    console.log(`${result.path}: ${decoder.decode(result.content)}`);
  } else {
    console.error(`Failed to download ${result.path}: ${result.error}`);
  }
}
```

## 安全注意事项

### 安全处理密钥

如果你的 Agent 需要调用经过身份验证的 API，有两种选择：

1. **将密钥保留在沙箱外的工具中**（推荐）——定义在主机环境中运行的工具并在那里处理身份验证
2. **使用注入凭证的网络代理**——某些沙箱提供商支持拦截 HTTP 请求并附加凭证的代理

### 通用最佳实践

- 在应用中对沙箱输出进行审查后再采取行动
- 在不需要时阻止沙箱网络访问
- 使用中间件过滤或编辑工具输出中的敏感模式
- 将沙箱内产生的所有内容视为不受信任的输入
