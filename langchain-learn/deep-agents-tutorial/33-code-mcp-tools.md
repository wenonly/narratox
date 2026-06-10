# MCP 工具 - MCP Tools

> 使用 MCP（Model Context Protocol）服务器扩展 Deep Agents Code 的工具集。

## 概述

MCP（Model Context Protocol）让你可以用外部服务器的工具扩展 Deep Agents Code -- 文件系统、API、数据库等等 -- 而无需修改代理本身。Deep Agents Code 在启动时连接到 MCP 服务器，发现它们的工具，并将它们与内置工具一起提供给代理使用。

通过在项目中添加 `.mcp.json` 配置文件（项目级别）或在用户级别添加配置来引入 MCP 服务器。

## 自动发现

Deep Agents Code 自动搜索标准位置的 `.mcp.json` 文件。无需额外标志，只需放置配置文件即可。

### 发现位置

配置文件按以下顺序检查（从低到高优先级）：

| 优先级 | 位置 | 范围 |
|---|---|---|
| 1（最低） | `~/.deepagents/.mcp.json` | 用户级别 -- 应用于所有项目 |
| 2 | `<project>/.deepagents/.mcp.json` | 项目级别 -- `.deepagents` 子目录 |
| 3（最高） | `<project>/.mcp.json` | 项目级别 -- 根目录（兼容 Claude Code） |

当存在多个配置文件时，它们的 `mcpServers` 条目会被合并。如果相同服务器名出现在多个文件中，高优先级的配置胜出。

### 命令行标志

| 标志 | 行为 |
|---|---|
| `--mcp-config PATH` | 添加显式配置作为最高优先级来源 |
| `--no-mcp` | 完全禁用 MCP -- 不加载任何服务器 |

## 配置格式

每个 `mcpServers` 下的键是服务器名称。服务器的字段决定了 Deep Agents Code 如何连接到它。

### stdio 服务器（默认）

stdio 服务器作为子进程启动，通过 stdin/stdout 通信：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      "env": {}
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "your-token" }
    }
  }
}
```

### SSE 和 HTTP 服务器

对于远程 MCP 服务器，设置 `type` 为 `"sse"` 或 `"http"` 并提供 `url`：

```json
{
  "mcpServers": {
    "remote-api": {
      "type": "sse",
      "url": "https://api.example.com/mcp",
      "headers": { "Authorization": "Bearer your-token" }
    }
  }
}
```

### 字段参考

| 字段 | 类型 | 描述 |
|---|---|---|
| `command` | `string` | stdio 服务器的启动命令 |
| `args` | `string[]` | 命令参数 |
| `env` | `object` | 环境变量 |
| `type` | `string` | 传输类型：`"stdio"`（默认）、`"sse"`、`"http"` |
| `url` | `string` | 远程服务器 URL（SSE/HTTP） |
| `headers` | `object` | HTTP 请求头（支持 `${VAR}` 变量替换） |

Header 值支持 `${VAR}` 变量替换：

```json
{
  "mcpServers": {
    "internal-api": {
      "type": "http",
      "url": "https://api.example.com/mcp",
      "headers": { "Authorization": "Bearer ${INTERNAL_API_TOKEN}" }
    }
  }
}
```

## 多服务器配置

可以配置任意数量的服务器。所有服务器的工具会被合并：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user/projects"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "ghp_..." }
    },
    "database": {
      "type": "sse",
      "url": "https://db-mcp.internal:8080/mcp",
      "headers": { "Authorization": "Bearer ..." }
    }
  }
}
```

### 工具过滤

每个服务器可以通过以下字段限制暴露给代理的工具：

- `allowedTools`：仅保留列出的工具
- `disabledTools`：移除列出的工具

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      "allowedTools": ["read_file", "list_directory"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "disabledTools": ["delete_repository", "delete_*_branch"]
    }
  }
}
```

**注意**：不能同时设置 `allowedTools` 和 `disabledTools`。

### 匹配规则

每个条目是字面工具名或 `fnmatch` 风格的 glob 模式：

```json
{
  "allowedTools": ["read_file", "fs_list_*"]
}
```

## OAuth 登录

对于需要 OAuth 的远程 MCP 服务器，设置 `"auth": "oauth"` 并运行登录命令：

### 配置 OAuth 服务器

```json
{
  "mcpServers": {
    "linear": {
      "type": "http",
      "url": "https://mcp.linear.app/mcp",
      "auth": "oauth"
    }
  }
}
```

**LangSmith Remote MCP：**

```json
{
  "mcpServers": {
    "langsmith": {
      "url": "https://api.smith.langchain.com/mcp",
      "transport": "http",
      "auth": "oauth"
    }
  }
}
```

### 运行登录流程

```bash
# 登录到 MCP 服务器
dcode mcp login linear

# 使用指定配置文件
dcode mcp login linear --config ./mcp-config.json
```

登录流程取决于服务器：
- **标准合规服务器**：动态客户端注册 + 浏览器授权码 + PKCE 流程
- **Slack**：使用 Slack 公开客户端预置的粘贴回流程
- **GitHub**：RFC 8628 设备授权授予

### Token 存储

Token 存储在：

```
~/.deepagents/.state/mcp-tokens/<server>-<sha256-16(url)>.json
```

目录权限为 `0700`，每个文件权限为 `0600`。

### 重新认证

当 refresh token 过期时，Deep Agents Code 将服务器标记为 `unauthenticated`。重新运行登录命令即可，无需重启会话：

```bash
dcode mcp login <server>
```

## 服务器状态

每个配置的服务器在启动后进入以下三种状态之一：

| 状态 | 含义 |
|---|---|
| `ok` | 已连接；工具已加载并可用 |
| `unauthenticated` | 需要 OAuth 登录或刷新失败 |
| `error` | 预检、发现或传输设置失败 |

使用 `/mcp` 命令查看每个服务器的状态、传输类型、工具列表和失败原因。

## 项目级信任

项目级配置可能包含执行本地命令的 stdio 服务器和插值环境变量的远程服务器。为了防止不受信任的仓库执行任意代码，Deep Agents Code 对项目级条目实施**默认拒绝**策略。

### 工作方式

- **交互模式**：在激活项目服务器前提示批准
- **非交互模式**：除非传递 `--trust-project-mcp`，否则跳过项目服务器
- **用户级配置**始终受信任

```bash
# 跳过批准提示
dcode --trust-project-mcp

# 非交互模式：明确信任项目服务器
dcode -n "run tests" --trust-project-mcp
```

### 信任存储

信任决策存储在 `~/.deepagents/.state/mcp_trust.json`：

```json
{
  "version": 1,
  "projects": {
    "/Users/you/myproject": "sha256:abc123..."
  }
}
```

## Claude Code 兼容性

如果你已经在项目根目录有 Claude Code 的 `.mcp.json`，Deep Agents Code 会自动识别，无需额外设置。

## 故障排除

- 使用 `/mcp` 查看服务器状态和工具列表
- 单个服务器失败不会中止启动
- 欢迎横幅显示未认证和出错的服务器数量
- 使用 `dcode mcp config` 查看 MCP 配置发现路径

## 小结

- MCP 通过外部服务器扩展 Deep Agents Code 的工具集
- 支持 stdio（本地子进程）和 SSE/HTTP（远程）两种传输方式
- 配置通过 `.mcp.json` 文件管理，支持用户级和项目级
- 自动发现配置文件，支持 Claude Code 兼容
- 支持 OAuth 认证和工具过滤
- 项目级配置有信任机制保护
