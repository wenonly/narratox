# Deep Agents Code 概览 - Deep Agents Code Overview

> Deep Agents Code (`dcode`) 是基于 Deep Agents SDK 构建的开源终端编码代理。

## 概述

Deep Agents Code (`dcode`) 是一个开源编码代理，基于 Deep Agents SDK 构建。它支持任何大型语言模型，并且可以在会话中切换提供商或模型。持久化记忆在不同对话间传递上下文，可自定义的技能塑造其行为，审批控制门控代码执行。

## 快速开始

### 安装并启动

```bash
curl -LsSf https://langch.in/dcode | bash
```

### 添加提供商凭据

Deep Agents Code 支持任何支持工具调用的 LLM。模型通过提供商访问：OpenAI、Anthropic 和 Google 默认提供，其他提供商（Ollama、Groq、xAI 等）按需安装。

使用 `/auth` 命令设置 API 密钥。

Web 搜索使用 Tavily，需要设置 `TAVILY_API_KEY`。

### 选择模型（可选）

Deep Agents Code 默认使用启动时检测到的第一个可用提供商凭据（OpenAI -> Anthropic -> Google）。使用不同模型：

```bash
# 使用 Anthropic 模型
dcode --model anthropic:claude-opus-4-7

# 使用 Groq 模型
dcode --model groq:llama-3.3-70b-versatile

# 使用 Ollama 本地模型
dcode --model ollama:qwen3:4b
```

在会话内使用 `/model --default provider:model` 持久化你的选择。

### 给代理一个任务

```
Create a Python script that prints "Hello, World!"
```

代理会解释查询，以 diff 形式提出修改建议，等待你批准后才修改文件。如需要，它可以运行 shell 命令来测试代码、检查文档或搜索网络获取最新信息。

### 启用追踪（可选）

在 `~/.deepagents/.env` 中添加以下配置：

```bash
# ~/.deepagents/.env
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=lsv2_...
LANGSMITH_PROJECT=optional-project-name  # 指定项目名称，默认为 "deepagents-code"
```

## 内置能力

Deep Agents Code 具有以下内置能力：

- **文件操作** - 读取、写入和编辑磁盘上的文件
- **Shell 执行** - 执行命令来运行测试、构建项目、管理依赖和版本控制
- **远程沙盒** - 在远程而非本地运行代理工具
- **Web 搜索** - 搜索网络获取最新信息和文档（需要 Tavily API 密钥）
- **任务规划和追踪** - 将复杂任务分解为离散步骤并追踪进度
- **子代理** - 将工作委派给任务特定的子代理
- **记忆存储和检索** - 跨会话存储和检索信息
- **上下文压缩和卸载** - 摘要旧消息并将原始内容卸载到存储
- **人机交互** - 敏感工具操作需要人工批准
- **技能** - 使用自定义专业知识和指令扩展代理能力
- **MCP 工具** - 从 Model Context Protocol 服务器加载外部工具
- **追踪** - 在 LangSmith 中追踪代理操作

## 内置工具列表

| 工具 | 描述 | 需要人工审批 |
|---|---|---|
| `ls` | 列出文件和目录 | - |
| `read_file` | 读取文件内容；支持图片、音频、视频和 PDF | - |
| `write_file` | 创建或覆盖文件 | 需要 |
| `edit_file` | 对现有文件进行定向编辑 | 需要 |
| `glob` | 查找匹配模式的文件 | - |
| `grep` | 跨文件搜索文本模式 | - |
| `execute` | 在本地或远程沙盒中执行 shell 命令 | 需要 |
| `web_search` | 使用 Tavily 搜索网络 | 需要 |
| `fetch_url` | 获取网页并转换为 markdown | 需要 |
| `task` | 将工作委派给子代理并行执行 | 需要 |
| `ask_user` | 向用户提问（自由文本或选择题） | - |
| `compact_conversation` | 摘要旧消息并卸载到存储 | 混合 |
| `write_todos` | 创建和管理复杂工作的任务列表 | - |

### 自动批准

跳过人工审批：

```bash
dcode --auto-approve
# 或简写：
dcode -y
```

## 命令参考

```bash
# 使用指定代理配置
dcode --agent mybot

# 使用指定模型
dcode --model anthropic:claude-opus-4-7

# 自动批准所有工具使用
dcode -y

# 启动时运行命令，然后提交第一个提示
dcode --startup-cmd "ls -la" -m "Summarize what's in this directory"

# 非交互模式
dcode --startup-cmd "git diff --stat" -n "Review these changes"
```

### 常用命令行选项

| 选项 | 描述 |
|---|---|
| `-a, --agent NAME` | 使用命名代理（独立记忆） |
| `-M, --model MODEL` | 使用指定模型 (`provider:model`) |
| `-m, --message TEXT` | 会话启动时自动提交的初始提示 |
| `-n, --non-interactive TEXT` | 非交互模式运行单个任务后退出 |
| `-y, --auto-approve` | 自动批准所有工具调用 |
| `-S, --shell-allow-list LIST` | 允许的 shell 命令列表 |
| `--sandbox TYPE` | 远程沙盒类型：`none`、`langsmith`、`agentcore`、`modal`、`daytona`、`runloop` |
| `--mcp-config PATH` | 添加显式 MCP 配置 |
| `--no-mcp` | 禁用所有 MCP 工具加载 |

## 配置

所有配置存储在 `~/.deepagents/` 目录下：

| 路径 | 用途 |
|---|---|
| `~/.deepagents/config.toml` | 模型和代理默认值、提供商设置、配置文件覆盖、主题、更新设置 |
| `~/.deepagents/.env` | 全局 API 密钥和密钥 |
| `~/.deepagents/hooks.json` | 生命周期事件钩子 |
| `~/.deepagents/<agent_name>/` | 每个代理的记忆、技能和会话线程 |
| `.deepagents/`（项目根目录） | 项目特定的记忆和技能 |

## 交互模式

### 斜杠命令

在会话中可用的命令：

| 命令 | 功能 |
|---|---|
| `/model` | 切换模型或打开交互式模型选择器 |
| `/agents` | 热切换预配置的代理 |
| `/auth` | 管理模型提供商的 API 密钥 |
| `/remember [context]` | 审查对话并更新记忆和技能 |
| `/skill:<name> [args]` | 按名称直接调用技能 |
| `/offload` 或 `/compact` | 释放上下文窗口空间 |
| `/tokens` | 显示当前 token 使用量 |
| `/clear` | 清除对话历史 |
| `/threads` | 浏览和恢复之前的会话线程 |
| `/mcp` | 显示活动的 MCP 服务器和工具 |
| `/trace` | 在 LangSmith 中打开当前线程 |
| `/quit` | 退出应用 |

### Shell 命令

输入 `!` 进入 shell 模式：

```bash
!git status
!npm test
!ls -la
```

### 快捷键

| 快捷键 | 操作 |
|---|---|
| `Enter` | 提交提示 |
| `Shift+Enter` | 插入换行 |
| `@filename` | 自动完成文件并注入内容 |
| `Shift+Tab` | 切换自动批准 |
| `Ctrl+X` | 在外部编辑器中打开提示 |
| `Escape` | 中断当前操作 |
| `Ctrl+C` | 中断或退出 |
| `Ctrl+D` | 退出 |

## 非交互模式和管道

```bash
# 运行单个任务
dcode -n "Write a Python script that prints hello world"

# 通过管道传递输入
echo "Explain this code" | dcode
cat error.log | dcode -n "What's causing this error?"
git diff | dcode -n "Review these changes"

# 清洁输出用于管道
dcode -n "Generate a .gitignore for Python" -q > .gitignore
```

### 限制回合数

```bash
dcode -n "fix the failing tests" --max-turns 10
```

### 限制执行时间

```bash
# 如果超过 2 分钟则失败
dcode -n "run the test suite" --timeout 120

# 组合使用 - 先触发的限制生效
dcode -n "refactor auth module" --timeout 300 --max-turns 20
```

## LangSmith 追踪

```bash
# ~/.deepagents/.env
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=lsv2_...
LANGSMITH_PROJECT=optional-project-name
```

分离代理追踪和应用追踪：

```bash
# ~/.deepagents/.env
DEEPAGENTS_CODE_LANGSMITH_PROJECT=deepagents-code
```

```bash
# .env（项目目录）
LANGSMITH_PROJECT=customer-support-agent
```

## 小结

- `dcode` 是功能丰富的终端编码代理，支持多模型、多提供商
- 内置 13 个工具，涵盖文件操作、Shell 执行、Web 搜索、子代理等
- 支持交互和非交互两种使用模式
- 通过斜杠命令和快捷键提供丰富的会话内控制
- 集成 LangSmith 追踪，支持代理和应用追踪分离
- 配置存储在 `~/.deepagents/` 目录下，支持项目和用户级别
