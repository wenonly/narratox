# 应用数据 - App Data

> 了解 Deep Agents Code 如何管理和访问应用数据。

## 概述

Deep Agents Code 在运行过程中会产生和管理多种类型的应用数据，包括会话线程、记忆文件、技能定义、配置和状态数据。了解这些数据的组织方式有助于更好地管理和维护你的代理环境。

## 数据目录结构

Deep Agents Code 的所有数据存储在 `~/.deepagents/` 目录下：

```
~/.deepagents/
  config.toml           # 主配置文件
  .env                  # 全局环境变量和 API 密钥
  hooks.json            # 生命周期钩子配置
  .mcp.json             # 全局 MCP 服务器配置
  .state/               # 运行时状态数据
    mcp-tokens/         # MCP OAuth token 存储
    mcp_trust.json      # 项目级 MCP 信任存储
  <agent_name>/         # 每个代理的独立目录
    agents/             # 子代理定义
    skills/             # 用户级别技能
    memory.md           # 用户级别记忆
    threads/            # 会话线程数据
```

## 会话线程管理

### 线程存储

每个会话创建一个线程，存储在代理目录下。线程包含完整的对话历史和元数据。

### 线程管理命令

```bash
# 列出会话线程
dcode threads list
dcode threads list --agent mybot --limit 10
dcode threads list --sort updated --verbose

# 删除会话线程
dcode threads delete <thread_id>

# 预览删除（不实际执行）
dcode threads delete <thread_id> --dry-run
```

### 恢复会话

```bash
# 恢复最近的会话
dcode -r

# 恢复指定会话
dcode -r <thread_id>
```

在交互会话中使用 `/threads` 命令浏览和恢复之前的会话线程。

### 线程过滤

```bash
# 按 Git 分支过滤
dcode threads list --branch main

# 按工作目录过滤
dcode threads list --cwd

# 显示相对时间戳
dcode threads list --relative
```

## 代理数据

### 多代理支持

Deep Agents Code 支持多个独立的代理配置，每个代理有自己的数据目录：

```bash
# 列出所有代理
dcode agents list

# 使用指定代理（独立记忆和技能）
dcode --agent mybot

# 重置代理记忆
dcode agents reset --agent mybot

# 从另一个代理复制记忆
dcode agents reset --agent mybot --target source-agent

# 预览重置操作
dcode agents reset --agent mybot --dry-run
```

### 代理切换

在交互会话中使用 `/agents` 命令热切换代理，无需重启：

```
/agents
```

- `Enter` - 选择代理（写入 `recent`）
- `Ctrl+S` - 固定为默认代理（写入 `default`）

## 对话历史卸载

当 token 使用量超过阈值时，Deep Agents Code 自动卸载对话历史：

1. 通过 LLM 摘要旧消息
2. 将原始内容存储到 `/conversation_history/{thread_id}.md`
3. 在上下文中用摘要替换原始内容

代理仍然可以从卸载文件中检索完整历史。

### 手动卸载

```
/offload
# 或
/compact
```

## 记忆数据

### 记忆文件位置

| 位置 | 范围 |
|---|---|
| `~/.deepagents/<agent>/memory.md` | 用户级别 |
| `.deepagents/memory.md` | 项目级别 |

### 记忆管理

使用 `/remember` 命令更新记忆：

```
/remember This project uses pnpm as package manager
```

## 技能数据

### 技能文件位置

```
~/.deepagents/<agent>/skills/<skill-name>/SKILL.md    # 用户级别
.deepagents/skills/<skill-name>/SKILL.md               # 项目级别
```

### 技能管理命令

```bash
# 列出所有技能
dcode skills list

# 列出项目级别技能
dcode skills list --project

# 创建新技能
dcode skills create my-skill
dcode skills create my-skill --project

# 查看技能详情
dcode skills info my-skill

# 删除技能
dcode skills delete my-skill
```

## 配置数据

### 配置文件

| 文件 | 用途 |
|---|---|
| `~/.deepagents/config.toml` | 模型、提供商、主题等配置 |
| `~/.deepagents/.env` | 全局 API 密钥 |
| `~/.deepagents/hooks.json` | 生命周期钩子 |
| `~/.deepagents/.mcp.json` | MCP 服务器配置 |

### 环境变量加载顺序

1. Shell 环境变量（最高优先级）
2. 项目目录的 `.env` 文件
3. `~/.deepagents/.env` 全局后备

### 重新加载配置

在会话中使用 `/reload` 命令重新读取 `.env` 文件、刷新配置并重新发现技能，无需重启。对话状态会被保留。

```
/reload
```

## 状态数据

### MCP Token 存储

```
~/.deepagents/.state/mcp-tokens/<server>-<hash>.json
```

### MCP 信任存储

```
~/.deepagents/.state/mcp_trust.json
```

### 调试日志

```bash
# 启用调试日志
export DEEPAGENTS_CODE_DEBUG=true
export DEEPAGENTS_CODE_DEBUG_FILE=/tmp/deepagents_debug.log
```

## JSON 输出

所有管理子命令支持 `--json` 标志输出机器可读的 JSON：

```bash
dcode agents list --json
dcode threads list --json
dcode skills list --json
dcode update --json
```

输出格式：

```json
{"schema_version": 1, "command": "...", "data": ...}
```

## 数据清理

### 清理单个代理

```bash
# 重置代理记忆（预览）
dcode agents reset --agent mybot --dry-run

# 实际重置
dcode agents reset --agent mybot
```

### 清理会话

```bash
# 删除指定会话（预览）
dcode threads delete <thread_id> --dry-run

# 实际删除
dcode threads delete <thread_id>
```

### 完全卸载

```bash
# 卸载程序
uv tool uninstall deepagents-code

# 手动删除所有数据
rm -rf ~/.deepagents/
```

## 小结

- 所有数据存储在 `~/.deepagents/` 目录下，每个代理有独立子目录
- 会话线程支持列表、过滤、恢复和删除操作
- 对话历史在 token 超限时自动卸载到文件
- 记忆和技能分为用户级别和项目级别
- 配置可通过 `/reload` 命令热重载
- 所有管理命令支持 `--json` 输出和 `--dry-run` 预览
