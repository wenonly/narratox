# 权限控制 - Permissions

> 原文地址: https://docs.langchain.com/oss/javascript/deepagents/permissions

## 概述

使用声明式权限规则控制 Agent 可以读取或写入哪些文件和目录。向 `createDeepAgent` 传递规则列表，Agent 的内置文件系统工具会遵循这些规则。

**重要限制：** 权限仅适用于内置文件系统工具（`ls`、`read_file`、`glob`、`grep`、`write_file`、`edit_file`）。自定义工具和访问文件系统的 MCP 工具不受权限控制。权限也不适用于沙盒后端，因为沙盒通过 `execute` 工具支持任意命令执行。

---

## 基本用法

将 `FilesystemPermission` 规则列表传递给 `createDeepAgent`。规则按声明顺序评估，**第一条匹配的规则生效**。如果没有规则匹配，操作将被允许。

```typescript
const agent = createDeepAgent({
  model,
  backend,
  permissions: [
    {
      operations: ["write"],
      paths: ["/**"],
      mode: "deny",
    },
  ],
});
```

---

## 规则结构

每个 `FilesystemPermission` 包含三个字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `operations` | `("read" \| "write")[]` | 此规则适用的操作。`"read"` 涵盖 `ls`、`read_file`、`glob`、`grep`。`"write"` 涵盖 `write_file`、`edit_file` |
| `paths` | `string[]` | 匹配文件路径的 Glob 模式（如 `["/workspace/**"]`）。支持 `**` 递归匹配和 `{a,b}` 交替匹配 |
| `mode` | `"allow" \| "deny"` | 允许还是拒绝匹配的操作。默认为 `"allow"` |

**评估规则：**
- 使用**先匹配生效**原则：第一条 `operations` 和 `paths` 同时匹配的规则决定结果
- 如果没有规则匹配，调用将被**允许**（宽松默认）
- 路径必须是绝对路径（以 `/` 开头），不能包含 `..` 或 `~`
- 无效路径会在 Agent 构建时抛出错误

---

## 示例

### 隔离到工作区目录

仅允许 `/workspace/` 下的读写操作，拒绝其他所有操作：

```typescript
const agent = createDeepAgent({
  model,
  backend,
  permissions: [
    {
      operations: ["read", "write"],
      paths: ["/workspace/**"],
      mode: "allow",
    },
    {
      operations: ["read", "write"],
      paths: ["/**"],
      mode: "deny",
    },
  ],
});
```

### 保护特定文件

```typescript
const agent = createDeepAgent({
  model,
  backend,
  permissions: [
    // 首先拒绝敏感文件
    {
      operations: ["read", "write"],
      paths: ["/workspace/.env", "/workspace/examples/**"],
      mode: "deny",
    },
    // 然后允许工作区
    {
      operations: ["read", "write"],
      paths: ["/workspace/**"],
      mode: "allow",
    },
    // 最后拒绝其他所有
    {
      operations: ["read", "write"],
      paths: ["/**"],
      mode: "deny",
    },
  ],
});
```

### 只读记忆

允许 Agent 读取记忆文件但阻止修改，适用于组织策略或共享知识库：

```typescript
import { InMemoryStore } from "@langchain/langgraph";
import {
  createDeepAgent,
  CompositeBackend,
  StateBackend,
  StoreBackend,
} from "deepagents";

const store = new InMemoryStore();
const agent = createDeepAgent({
  model,
  backend: new CompositeBackend(new StateBackend(), {
    "/memories/": new StoreBackend({
      namespace: (rt) => [rt.serverInfo.user.identity],
    }),
    "/policies/": new StoreBackend({
      namespace: (rt) => [rt.context.orgId],
    }),
  }),
  permissions: [
    // 拒绝对记忆和策略的写入
    {
      operations: ["write"],
      paths: ["/memories/**", "/policies/**"],
      mode: "deny",
    },
  ],
  store,
});
```

### 拒绝所有访问

阻止所有读写操作，作为限制性基线，可以在其上叠加更具体的允许规则：

```typescript
const agent = createDeepAgent({
  model,
  backend,
  permissions: [
    {
      operations: ["read", "write"],
      paths: ["/**"],
      mode: "deny",
    },
  ],
});
```

---

## 规则顺序

由于先匹配生效原则，规则顺序非常重要。将更具体的规则放在更宽泛的规则之前：

```typescript
import { FilesystemPermission } from "deepagents";

// 正确的顺序：具体规则在前
const correctPermissions: FilesystemPermission[] = [
  { operations: ["read", "write"], paths: ["/workspace/.env"], mode: "deny" },
  {
    operations: ["read", "write"],
    paths: ["/workspace/**"],
    mode: "allow",
  },
  { operations: ["read", "write"], paths: ["/**"], mode: "deny" },
];

// 错误的顺序：宽泛规则在前，.env 永远不会被拒绝
const incorrectPermissions: FilesystemPermission[] = [
  {
    operations: ["read", "write"],
    paths: ["/workspace/**"],
    mode: "allow",
  },
  {
    operations: ["read", "write"],
    paths: ["/workspace/.env"],
    mode: "deny",
  },
  { operations: ["read", "write"], paths: ["/**"], mode: "deny" },
];
```

---

## 子代理权限

子代理默认继承父代理的权限。要为子代理设置不同的权限，在其规范中设置 `permissions` 字段。这会**完全替换**父代理的规则。

```typescript
const agent = createDeepAgent({
  model,
  backend,
  permissions: [
    {
      operations: ["read", "write"],
      paths: ["/workspace/**"],
      mode: "allow",
    },
    { operations: ["read", "write"], paths: ["/**"], mode: "deny" },
  ],
  subagents: [
    {
      name: "auditor",
      description: "Read-only code reviewer",
      systemPrompt: "Review the code for issues.",
      permissions: [
        // 审计员只能读取，不能写入
        { operations: ["write"], paths: ["/**"], mode: "deny" },
        { operations: ["read"], paths: ["/workspace/**"], mode: "allow" },
        { operations: ["read"], paths: ["/**"], mode: "deny" },
      ],
    },
  ],
});
```

**关键行为：**
- 设置 `permissions: []`（空数组）授予子代理无限制访问
- 省略 `permissions` 则从父代理继承

---

## 组合后端

当使用 `CompositeBackend` 且默认后端为沙盒时，每个权限路径必须限定在已知的路由前缀下。沙盒支持任意命令执行，仅靠基于路径的限制无法阻止通过 Shell 命令访问文件系统。将权限范围限定到特定路由的后端可以避免此冲突。

```typescript
import {
  createDeepAgent,
  CompositeBackend,
  StateBackend,
} from "deepagents";

const sandbox = new StateBackend();
const memoriesBackend = new StateBackend();
const composite = new CompositeBackend(sandbox, {
  "/memories/": memoriesBackend,
});

const agent = createDeepAgent({
  model,
  backend: composite,
  permissions: [
    // 权限路径限定在 /memories/ 路由下
    { operations: ["write"], paths: ["/memories/**"], mode: "deny" },
  ],
});
```

如果权限包含超出任何路由前缀的路径，会在构建时抛出错误：

```typescript
// 这会抛出错误：/workspace/ 不在任何路由前缀下
const sandbox = new StateBackend();
const memoriesBackend = new StateBackend();
const composite = new CompositeBackend(sandbox, {
  "/memories/": memoriesBackend,
});

createDeepAgent({
  model,
  backend: composite,
  permissions: [
    { operations: ["write"], paths: ["/workspace/**"], mode: "deny" },
  ],
});
```

---

## 小结

- 权限通过声明式规则控制 Agent 对文件系统的访问
- 使用**先匹配生效**原则，规则顺序至关重要
- 支持通配符模式（`**` 递归匹配、`{a,b}` 交替匹配）
- 默认策略是宽松的——未匹配的操作被允许
- 子代理默认继承父代理权限，可以完全覆盖
- 使用组合后端时，权限路径必须限定在路由前缀下
- 权限不适用于自定义工具、MCP 工具和沙盒后端的 `execute` 工具
- 对于更复杂的验证逻辑，结合后端策略钩子使用
