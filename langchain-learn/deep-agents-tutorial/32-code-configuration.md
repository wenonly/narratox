# 配置详解 - Configuration

> 使用 config.toml、hooks 和 MCP 服务器配置 Deep Agents Code。

## 概述

Deep Agents Code 将所有配置存储在 `~/.deepagents/` 目录中。主要配置文件包括：

| 文件 | 格式 | 用途 |
|---|---|---|
| `config.toml` | TOML | 模型默认值、提供商设置、构造函数参数、配置文件覆盖、主题、更新设置 |
| `.env` | Dotenv | 全局 API 密钥、密钥和其他环境变量 |
| `hooks.json` | JSON | 外部工具对 Deep Agents Code 生命周期事件的订阅 |
| `.mcp.json` | JSON | 全局 MCP 服务器定义 |

## 提供商凭据

### 使用 `/auth`（推荐）

从任何会话中打开凭据管理器：

```
/auth
```

管理器列出可用的 LLM 提供商，并标记已设置密钥的提供商。`/auth` 仅管理 LLM 提供商凭据。工具凭据如 `TAVILY_API_KEY` 和 `LANGSMITH_API_KEY` 从环境变量读取。

### 环境变量（CI 和无头模式）

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."

# 使用前缀限定仅 Deep Agents Code 使用
export DEEPAGENTS_CODE_OPENAI_API_KEY="sk-..."
```

### 密钥解析顺序

1. `DEEPAGENTS_CODE_` 前缀的环境变量
2. `/auth` 存储的密钥
3. 普通环境变量

```bash
# 即使 /auth 中有存储的密钥，普通环境变量不会覆盖它
OPENAI_API_KEY=sk-xxxx dcode -n "..."

# DEEPAGENTS_CODE_ 前缀会覆盖存储的密钥
DEEPAGENTS_CODE_OPENAI_API_KEY=sk-xxxx dcode -n "..."
```

### 启用 Web 搜索

```bash
# 在 ~/.deepagents/.env 中设置
TAVILY_API_KEY=tvly-...
```

## 环境变量

### 加载顺序和优先级

1. 项目目录的 `.env` 文件（向上搜索，第一个找到的生效）
2. `~/.deepagents/.env` 作为全局后备
3. Shell 环境变量（最高优先级）

### `DEEPAGENTS_CODE_` 前缀

所有 Deep Agents Code 特定的环境变量使用此前缀。前缀也可作为任何环境变量的覆盖机制：

```bash
# 给 Deep Agents Code 单独的值
DEEPAGENTS_CODE_OPENAI_API_KEY=sk-cli-only

# 设为空让 Deep Agents Code 忽略某个密钥
DEEPAGENTS_CODE_ANTHROPIC_API_KEY=
```

## 配置文件

`~/.deepagents/config.toml` 允许你自定义模型提供商、设置默认值和传递额外参数。

### 默认模型和代理

```toml
[models]
default = "ollama:qwen3:4b"             # 长期偏好
recent = "google_genai:gemini-3.5-flash"  # 最近切换（自动写入）

[agents]
default = "backend-dev"   # 长期偏好（Ctrl+S 设置）
recent = "frontend-dev"   # 最近切换（Enter 设置）
```

### 提供商配置

```toml
[models.providers.<name>]
models = ["gpt-4o"]
api_key_env = "OPENAI_API_KEY"
base_url = "https://api.openai.com/v1"
class_path = "my_package.models:MyChatModel"
enabled = true

[models.providers.<name>.params]
temperature = 0
max_tokens = 4096

[models.providers.<name>.params."gpt-4o"]
temperature = 0.7
```

### 自定义端点

```toml
# 兼容 OpenAI 的 API
[models.providers.openai]
base_url = "https://api.example.com/v1"
api_key_env = "EXAMPLE_API_KEY"
models = ["my-model"]

# 自定义提供商
[models.providers.my_custom]
class_path = "my_package.models:MyChatModel"
api_key_env = "MY_API_KEY"
base_url = "https://my-endpoint.example.com"
```

### Profile 覆盖

```toml
# 全局覆盖
[models.providers.anthropic.profile]
max_input_tokens = 4096

# 特定模型覆盖
[models.providers.anthropic.profile."claude-sonnet-4-5"]
max_input_tokens = 8192
```

CLI 覆盖：

```bash
dcode --profile-override '{"max_input_tokens": 4096}'
```

## 技能目录白名单

```toml
[skills]
extra_allowed_dirs = [
    "~/shared-skills",
    "/opt/team-skills",
]
```

或使用环境变量：

```bash
export DEEPAGENTS_CODE_EXTRA_SKILLS_DIRS="~/shared-skills:/opt/team-skills"
```

## 主题配置

使用 `/theme` 打开交互式主题选择器。

```toml
[ui]
theme = "langchain-dark"
```

### 自定义主题

```toml
[themes.my-solarized]
label = "My Solarized"
dark = true
primary = "#268BD2"
warning = "#B58900"
```

### 映射主题到终端

```toml
[ui.terminal_themes]
"Apple_Terminal" = "langchain-light"
"iTerm.app" = "langchain"
```

### 主题解析顺序

1. `DEEPAGENTS_CODE_THEME` 环境变量
2. `[ui.terminal_themes]` 映射
3. `[ui] theme` 保存的偏好
4. 内置默认值（`langchain`）

## 自动更新

```toml
[update]
auto_update = true
```

```bash
export DEEPAGENTS_CODE_AUTO_UPDATE=1
```

## Hooks（生命周期钩子）

Hooks 让外部程序响应 Deep Agents Code 的生命周期事件。在 `~/.deepagents/hooks.json` 中配置：

```json
{
  "hooks": [
    {
      "command": ["bash", "-c", "cat >> ~/deepagents-events.log"],
      "events": ["session.start", "session.end"]
    }
  ]
}
```

### Hook 配置

```json
{
  "hooks": [
    {
      "command": ["python3", "my_handler.py"],
      "events": ["session.start", "task.complete"]
    },
    {
      "command": ["bash", "log_everything.sh"]
    }
  ]
}
```

### 事件参考

| 事件 | 描述 | 额外字段 |
|---|---|---|
| `session.start` | 会话开始 | `thread_id` |
| `session.end` | 会话结束 | `thread_id` |
| `user.prompt` | 用户提交消息 | - |
| `input.required` | 代理需要人工输入 | - |
| `permission.request` | 工具需要审批 | `tool_names` |
| `tool.error` | 工具调用出错 | `tool_names` |
| `task.complete` | 代理完成任务 | `thread_id` |
| `context.compact` | 上下文压缩前触发 | - |

### Hook 示例

**桌面通知（macOS）：**

```json
{
  "hooks": [
    {
      "command": [
        "bash", "-c",
        "osascript -e 'display notification \"Agent finished\" with title \"Deep Agents\"'"
      ],
      "events": ["task.complete"]
    }
  ]
}
```

**Python 处理器：**

```python
import json
import sys

payload = json.load(sys.stdin)
event = payload["event"]

if event == "session.start":
    print(f"Session started: {payload['thread_id']}", file=sys.stderr)
elif event == "permission.request":
    print(f"Approval needed for: {payload['tool_names']}", file=sys.stderr)
```

```json
{
  "hooks": [
    {
      "command": ["python3", "my_handler.py"],
      "events": ["session.start", "permission.request"]
    }
  ]
}
```

### Hook 执行模型

- **后台线程**：不阻塞主事件循环
- **并发调度**：多个 Hook 并发运行
- **5 秒超时**：超时命令被终止
- **即发即忘**：错误被捕获并记录，不会崩溃
- **无 Shell 展开**：命令直接执行，不通过 Shell

## 环境变量参考

| 变量 | 描述 |
|---|---|
| `DEEPAGENTS_CODE_AUTO_UPDATE` | 启用自动更新（`1`/`true`/`yes`） |
| `DEEPAGENTS_CODE_DEBUG` | 启用调试日志 |
| `DEEPAGENTS_CODE_DEBUG_FILE` | 调试日志文件路径 |
| `DEEPAGENTS_CODE_EXTRA_SKILLS_DIRS` | 额外技能目录（冒号分隔） |
| `DEEPAGENTS_CODE_LANGSMITH_PROJECT` | LangSmith 项目名 |
| `DEEPAGENTS_CODE_NO_UPDATE_CHECK` | 禁用更新检查 |
| `DEEPAGENTS_CODE_SHELL_ALLOW_LIST` | 允许的 Shell 命令 |
| `DEEPAGENTS_CODE_USER_ID` | LangSmith 追踪用户标识 |

## 卸载

```bash
uv tool uninstall deepagents-code
```

此命令不会删除用户配置或会话数据。要完全删除，手动删除 `~/.deepagents/` 目录。

## 小结

- 配置文件存储在 `~/.deepagents/` 目录下
- `config.toml` 管理模型、提供商、主题等设置
- `.env` 管理全局 API 密钥
- `hooks.json` 配置生命周期事件钩子
- `DEEPAGENTS_CODE_` 前缀实现环境变量作用域限定
- 支持自定义主题、终端映射和自动更新
