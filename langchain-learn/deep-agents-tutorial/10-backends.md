# 后端系统 - Backends

> 原文地址: https://docs.langchain.com/oss/javascript/deepagents/backends

## 概述

Deep Agents 通过文件系统工具（如 `ls`、`read_file`、`write_file`、`edit_file`、`glob` 和 `grep`）向 Agent 暴露一个文件系统接口。这些工具通过可插拔的后端（Backend）来运行。`read_file` 工具原生支持图片文件（`.png`、`.jpg`、`.jpeg`、`.gif`、`.webp`）以及二进制文件（PDF、音频、视频），以多模态内容块的形式返回。

本章节将介绍如何：
- 选择合适的后端
- 将不同路径路由到不同后端
- 实现自定义虚拟文件系统（如 S3 或 Postgres）
- 设置文件系统访问权限
- 添加策略钩子
- 处理二进制和多模态文件

---

## 快速入门

以下是 Deep Agents 提供的预构建文件系统后端：

| 内置后端 | 说明 |
| --- | --- |
| **默认** | 线程作用域，存储在 LangGraph 状态中，文件在同一线程的多次轮次间持久化，但不跨线程共享 |
| **本地文件系统** | 通过 `FilesystemBackend` 访问本地磁盘，指定根目录 |
| **持久存储** | 通过 `StoreBackend` 使用 LangGraph store，支持跨线程持久化 |
| **Context Hub** | 通过 `ContextHubBackend` 将文件存储在 LangSmith Hub 仓库中 |
| **沙盒** | 在隔离环境中执行代码，提供文件系统工具和 `execute` 工具 |
| **本地 Shell** | 通过 `LocalShellBackend` 直接在主机上提供文件系统和 Shell 执行 |
| **组合后端** | 通过 `CompositeBackend` 将不同路径路由到不同后端 |

---

## 内置后端详解

### StateBackend（状态后端）

`StateBackend` 是默认后端，将文件存储在 LangGraph Agent 状态中。

```typescript
import { createDeepAgent, StateBackend } from "deepagents";

// 默认使用 StateBackend
const agent = createDeepAgent();

// 显式指定 StateBackend
const agent2 = createDeepAgent({
  backend: new StateBackend(),
});
```

**工作原理：**
- 文件存储在当前线程的 LangGraph Agent 状态中
- 通过检查点在同一线程的多次轮次间持久化
- 文件不跨线程共享

**适用场景：**
- 作为 Agent 的临时工作区，写入中间结果
- 自动卸载大型工具输出，Agent 可以按需分批读取

> **注意：** 该后端在主管 Agent 和子 Agent 之间共享，子 Agent 写入的文件在子 Agent 执行完毕后仍然存在。

---

### FilesystemBackend（本地文件系统后端）

`FilesystemBackend` 在可配置的根目录下读写真实文件。

```typescript
import { createDeepAgent, FilesystemBackend } from "deepagents";

const agent = createDeepAgent({
  model: "google-genai:gemini-3.5-flash",
  backend: new FilesystemBackend({ rootDir: ".", virtualMode: true }),
});
```

**安全注意事项：**
- Agent 可以读取任何可访问的文件，包括密钥（API Keys、凭证、`.env` 文件）
- 建议始终使用 `virtualMode: true` 来启用基于路径的访问限制
- 推荐使用 `CompositeBackend` 包装，将内部数据和项目文件分开

**使用 CompositeBackend 包装的推荐方式：**

```typescript
import { createDeepAgent, CompositeBackend, FilesystemBackend, StateBackend } from "deepagents";

const agent = createDeepAgent({
  backend: new CompositeBackend(
    new StateBackend(),
    {
      "/workspace/": new FilesystemBackend({ rootDir: "/path/to/project", virtualMode: true }),
    },
  ),
});
```

这样 `/workspace/` 下的读写操作会访问真实磁盘，而卸载的工具结果和其他内部数据则保存在临时状态中。

---

### LocalShellBackend（本地 Shell 后端）

`LocalShellBackend` 扩展了 `FilesystemBackend`，增加了 `execute` 工具用于在主机上运行 Shell 命令。

```typescript
import { createDeepAgent, LocalShellBackend } from "deepagents";

const backend = new LocalShellBackend({ workingDirectory: "." });

const agent = createDeepAgent({
  model: "google-genai:gemini-3.5-flash",
  backend,
});
```

**安全警告：**
- Agent 可以执行任意 Shell 命令
- 强烈建议启用 Human-in-the-Loop（HITL）中间件来审核操作
- 仅在受控的开发环境中使用

---

### StoreBackend（LangGraph Store 后端）

`StoreBackend` 将文件存储在 LangGraph `BaseStore` 中，支持跨线程持久化存储。

```typescript
import { createDeepAgent, StoreBackend } from "deepagents";
import { InMemoryStore } from "@langchain/langgraph";

const store = new InMemoryStore(); // 本地开发使用内存存储

const agent = createDeepAgent({
  model: "google-genai:gemini-3.5-flash",
  backend: new StoreBackend({
    namespace: (rt) => [rt.serverInfo.user.identity],
  }),
  store,
});
```

#### 命名空间工厂

命名空间工厂控制 `StoreBackend` 读写数据的位置，接收 LangGraph `Runtime` 并返回字符串元组。

**常用命名空间模式：**

```typescript
import { StoreBackend } from "deepagents";

// 按用户隔离：每个用户拥有独立的存储空间
const backend = new StoreBackend({
  namespace: (rt) => [rt.serverInfo.user.identity],
});

// 按 Assistant 隔离：同一 Assistant 的所有用户共享存储
const backend = new StoreBackend({
  namespace: (rt) => [rt.serverInfo.assistantId],
});

// 按线程隔离：存储范围限定为单个会话
const backend = new StoreBackend({
  namespace: (rt) => [rt.executionInfo.threadId],
});
```

---

### ContextHubBackend

`ContextHubBackend` 将文件存储在 LangSmith Hub 仓库中。

```typescript
import { createDeepAgent, ContextHubBackend } from "deepagents";

const agent = createDeepAgent({
  model: "google-genai:gemini-3.5-flash",
  backend: new ContextHubBackend("my-agent"),
});
```

使用前需设置 `LANGSMITH_API_KEY` 环境变量。

---

### CompositeBackend（组合路由后端）

`CompositeBackend` 根据路径前缀将文件操作路由到不同的后端。

```typescript
import {
  createDeepAgent,
  CompositeBackend,
  StateBackend,
  StoreBackend,
} from "deepagents";
import { InMemoryStore } from "@langchain/langgraph";

const store = new InMemoryStore();

const agent = createDeepAgent({
  model: "google-genai:gemini-3.5-flash",
  backend: new CompositeBackend(new StateBackend(), {
    "/memories/": new StoreBackend({
      namespace: () => ["memories"],
    }),
  }),
  store,
});
```

**路由行为：**
- `/workspace/plan.md` -> `StateBackend`（线程作用域）
- `/memories/agent.md` -> `StoreBackend`（跨线程持久化）
- `ls`、`glob`、`grep` 会聚合结果并显示原始路径前缀

---

## 路由到不同后端

```typescript
import { createDeepAgent, CompositeBackend, FilesystemBackend, StateBackend } from "deepagents";

const agent = createDeepAgent({
  backend: new CompositeBackend(
    new StateBackend(),
    {
      "/memories/": new FilesystemBackend({ rootDir: "/deepagents/myagent", virtualMode: true }),
    },
  ),
});
```

**注意事项：**
- 更长的前缀优先匹配（如 `/memories/projects/` 可以覆盖 `/memories/`）
- Deep Agents 会将内部数据写入默认后端
- 建议使用 `StateBackend` 作为默认后端，将内部数据保持在临时存储中

---

## 自定义虚拟文件系统

你可以构建自定义后端，将远程或数据库文件系统（如 S3 或 Postgres）映射到工具命名空间。

**设计指南：**
- 路径是绝对路径（`/x/y.txt`），需要决定如何映射到存储键/行
- 高效实现 `ls` 和 `glob`（尽可能使用服务端过滤）
- 对于外部持久化存储，写入/编辑结果中省略 `filesUpdate` 字段

### S3 后端示例

```typescript
import {
  type BackendProtocolV2,
  type LsResult,
  type ReadResult,
  type ReadRawResult,
  type GrepResult,
  type GlobResult,
  type WriteResult,
  type EditResult,
} from "deepagents";

class S3Backend implements BackendProtocolV2 {
  constructor(private bucket: string, private prefix: string = "") {
    this.prefix = prefix.replace(/\/$/, "");
  }

  private key(path: string): string {
    return `${this.prefix}${path}`;
  }

  async ls(path: string): Promise<LsResult> {
    // 列出 key(path) 下的对象；返回 { files: [...] }
    // ...
  }

  async read(filePath: string, offset?: number, limit?: number): Promise<ReadResult> {
    // 获取对象；返回 { content, mimeType }
    // 对于二进制文件，返回 Uint8Array 内容
    // ...
  }

  async readRaw(filePath: string): Promise<ReadRawResult> {
    // 返回 { data: FileData }
    // ...
  }

  async grep(pattern: string, path?: string | null, glob?: string | null): Promise<GrepResult> {
    // 搜索文本文件；跳过二进制文件；返回 { matches: [...] }
    // ...
  }

  async glob(pattern: string, path = "/"): Promise<GlobResult> {
    // 相对于路径应用 glob 模式；返回 { files: [...] }
    // ...
  }

  async write(filePath: string, content: string): Promise<WriteResult> {
    // 执行创建语义；返回 { path: filePath, filesUpdate: null }
    // ...
  }

  async edit(filePath: string, oldString: string, newString: string, replaceAll?: boolean): Promise<EditResult> {
    // 读取 -> 替换 -> 写入 -> 返回 { path, occurrences }
    // ...
  }
}
```

---

## 添加策略钩子

### 子类方式阻止写入

```typescript
import { FilesystemBackend, type WriteResult, type EditResult } from "deepagents";

class GuardedBackend extends FilesystemBackend {
  private denyPrefixes: string[];

  constructor({ denyPrefixes, ...options }: { denyPrefixes: string[]; rootDir?: string }) {
    super(options);
    this.denyPrefixes = denyPrefixes.map(p => p.endsWith("/") ? p : p + "/");
  }

  async write(filePath: string, content: string): Promise<WriteResult> {
    if (this.denyPrefixes.some(p => filePath.startsWith(p))) {
      return { error: `Writes are not allowed under ${filePath}` };
    }
    return super.write(filePath, content);
  }

  async edit(filePath: string, oldString: string, newString: string, replaceAll = false): Promise<EditResult> {
    if (this.denyPrefixes.some(p => filePath.startsWith(p))) {
      return { error: `Edits are not allowed under ${filePath}` };
    }
    return super.edit(filePath, oldString, newString, replaceAll);
  }
}
```

### 通用包装器

```typescript
import {
  type BackendProtocolV2,
  type LsResult,
  type ReadResult,
  type ReadRawResult,
  type GrepResult,
  type GlobResult,
  type WriteResult,
  type EditResult,
} from "deepagents";

class PolicyWrapper implements BackendProtocolV2 {
  private denyPrefixes: string[];

  constructor(private inner: BackendProtocolV2, denyPrefixes: string[] = []) {
    this.denyPrefixes = denyPrefixes.map(p => p.endsWith("/") ? p : p + "/");
  }

  private isDenied(path: string): boolean {
    return this.denyPrefixes.some(p => path.startsWith(p));
  }

  ls(path: string): Promise<LsResult> { return this.inner.ls(path); }
  read(filePath: string, offset?: number, limit?: number): Promise<ReadResult> { return this.inner.read(filePath, offset, limit); }
  readRaw(filePath: string): Promise<ReadRawResult> { return this.inner.readRaw(filePath); }
  grep(pattern: string, path?: string | null, glob?: string | null): Promise<GrepResult> { return this.inner.grep(pattern, path, glob); }
  glob(pattern: string, path?: string): Promise<GlobResult> { return this.inner.glob(pattern, path); }

  async write(filePath: string, content: string): Promise<WriteResult> {
    if (this.isDenied(filePath)) return { error: `Writes are not allowed under ${filePath}` };
    return this.inner.write(filePath, content);
  }

  async edit(filePath: string, oldString: string, newString: string, replaceAll = false): Promise<EditResult> {
    if (this.isDenied(filePath)) return { error: `Edits are not allowed under ${filePath}` };
    return this.inner.edit(filePath, oldString, newString, replaceAll);
  }
}
```

---

## 多模态和二进制文件

### 支持的 MIME 类型

| 类别 | 扩展名 | MIME 类型 |
| --- | --- | --- |
| 图片 | `.png`, `.jpg`/`.jpeg`, `.gif`, `.webp`, `.svg`, `.heic`, `.heif` | `image/png`, `image/jpeg` 等 |
| 音频 | `.mp3`, `.wav`, `.aiff`, `.aac`, `.ogg`, `.flac` | `audio/mpeg`, `audio/wav` 等 |
| 视频 | `.mp4`, `.webm`, `.mpeg`/`.mpg`, `.mov` 等 | `video/mp4`, `video/webm` 等 |
| 文档 | `.pdf`, `.ppt`, `.pptx` | `application/pdf` 等 |
| 文本 | `.txt`, `.html`, `.json`, `.js`, `.ts`, `.py` 等 | `text/plain`, `text/html` 等 |

### 读取二进制文件

```typescript
const result = await backend.read("/workspace/screenshot.png");

if (result.error) {
  console.error(result.error);
} else if (result.content instanceof Uint8Array) {
  // 二进制文件 — content 是 Uint8Array，mimeType 已设置
  console.log(`Binary file: ${result.mimeType}`); // "image/png"
} else {
  // 文本文件 — content 是 string
  console.log(`Text file: ${result.mimeType}`); // "text/plain"
}
```

### FileData 格式

```typescript
type FileData =
  // 当前格式 (v2)
  | {
      content: string | Uint8Array; // string 用于文本，Uint8Array 用于二进制
      mimeType: string;             // 例如 "text/plain", "image/png"
      created_at: string;           // ISO 8601 时间戳
      modified_at: string;          // ISO 8601 时间戳
    }
  // 旧版格式 (v1)
  | {
      content: string[];            // 行数组
      created_at: string;           // ISO 8601 时间戳
      modified_at: string;          // ISO 8601 时间戳
    };
```

---

## 协议参考

### 必需方法

| 方法 | 签名 | 说明 |
| --- | --- | --- |
| `ls` | `(path: string) => LsResult` | 列出目录内容（非递归） |
| `read` | `(filePath: string, offset?: number, limit?: number) => ReadResult` | 读取文件内容 |
| `readRaw` | `(filePath: string) => ReadRawResult` | 读取原始 FileData |
| `grep` | `(pattern: string, path?: string, glob?: string) => GrepResult` | 搜索文件内容 |
| `glob` | `(pattern: string, path?: string) => GlobResult` | 按 glob 模式匹配文件 |
| `write` | `(filePath: string, content: string) => WriteResult` | 创建文件（仅创建语义） |
| `edit` | `(filePath: string, oldString: string, newString: string, replaceAll?: boolean) => EditResult` | 编辑文件内容 |

### 结果类型

| 类型 | 成功字段 | 错误字段 |
| --- | --- | --- |
| `ReadResult` | `content?: string \| Uint8Array`, `mimeType?: string` | `error` |
| `ReadRawResult` | `data?: FileData` | `error` |
| `LsResult` | `files?: FileInfo[]` | `error` |
| `GlobResult` | `files?: FileInfo[]` | `error` |
| `GrepResult` | `matches?: GrepMatch[]` | `error` |
| `WriteResult` | `path?: string` | `error` |
| `EditResult` | `path?: string`, `occurrences?: number` | `error` |

### V1 到 V2 迁移

```typescript
import { adaptBackendProtocol, adaptSandboxProtocol } from "deepagents";

// 将 V1 后端适配为 V2
const v2Backend = adaptBackendProtocol(v1Backend);

// 将 V1 沙盒适配为 V2
const v2Sandbox = adaptSandboxProtocol(v1Sandbox);
```

---

## 小结

- Deep Agents 使用可插拔后端来提供文件系统功能
- `StateBackend` 是默认选项，适合线程内的临时工作
- `StoreBackend` 支持跨线程持久化，适合长期记忆
- `CompositeBackend` 允许将不同路径路由到不同后端
- 可以通过实现 `BackendProtocolV2` 接口创建自定义后端
- 始终注意安全，特别是在使用 `FilesystemBackend` 和 `LocalShellBackend` 时
