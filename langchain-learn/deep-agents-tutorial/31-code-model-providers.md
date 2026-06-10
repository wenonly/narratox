# 模型提供商 - Model Providers

> Deep Agents Code 支持多种 LLM 提供商，可以在会话中切换模型。

## 概述

Deep Agents Code 支持任何支持工具调用的 LLM。模型通过提供商访问：OpenAI、Anthropic 和 Google 默认提供，其他提供商（Ollama、Groq、xAI 等）按需安装。你可以在会话中随时切换模型。

## 内置提供商

Deep Agents Code 默认内置以下提供商：

| 提供商 | 默认模型 | API 密钥环境变量 |
|---|---|---|
| **OpenAI** | gpt-4o 系列 | `OPENAI_API_KEY` |
| **Anthropic** | Claude Sonnet/Opus | `ANTHROPIC_API_KEY` |
| **Google** | Gemini 系列 | `GOOGLE_API_KEY` |

## 提供商凭据管理

### 使用 `/auth` 命令（推荐）

在交互会话中使用 `/auth` 命令管理 API 密钥：

```
/auth
```

凭据管理器列出所有可用的 LLM 提供商，标记已设置密钥的提供商。选择一个提供商来添加或替换密钥。

每个提供商行显示的标签：

| 标签 | 含义 |
|---|---|
| `[stored]` | 通过 `/auth` 保存的密钥 |
| `[env: VARNAME]` | 来自环境变量的密钥 |
| `[missing]` | 未存储密钥且环境变量未设置 |

### 环境变量（CI 和无头模式）

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
export OPENAI_API_KEY="sk-..."

# 使用 DEEPAGENTS_CODE_ 前缀限定仅 Deep Agents Code 使用
export DEEPAGENTS_CODE_OPENAI_API_KEY="sk-..."
```

### 密钥解析顺序

当同一提供商的密钥在多处设置时，Deep Agents Code 使用以下优先级：

1. **`DEEPAGENTS_CODE_` 前缀的环境变量** - 最高优先级
2. **应用存储的密钥** - 通过 `/auth` 保存
3. **普通环境变量** - 如 `OPENAI_API_KEY`

## 模型选择

### 命令行指定模型

```bash
# 使用 Anthropic Opus 模型
dcode --model anthropic:claude-opus-4-7

# 使用 OpenAI GPT 模型
dcode --model openai:gpt-5.5

# 使用 Google Gemini 模型
dcode --model google_genai:gemini-3.5-flash

# 使用 Groq 模型
dcode --model groq:llama-3.3-70b-versatile

# 使用 Ollama 本地模型
dcode --model ollama:qwen3:4b
```

### 会话内切换模型

在交互会话中使用 `/model` 命令：

```
/model                    # 打开交互式模型选择器
/model anthropic:claude-opus-4-7   # 直接切换到指定模型
/model --default openai:gpt-5.5    # 设置持久化默认模型
```

## 配置提供商

在 `~/.deepagents/config.toml` 中配置提供商：

### 默认模型

```toml
[models]
default = "ollama:qwen3:4b"             # 长期偏好
recent = "google_genai:gemini-3.5-flash"  # 最近使用的模型（自动写入）
```

`[models].default` 总是优先于 `[models].recent`。

### 提供商配置

```toml
# 配置 OpenAI 提供商
[models.providers.openai]
base_url = "https://api.openai.com/v1"
api_key_env = "OPENAI_API_KEY"
models = ["gpt-4o", "gpt-4o-mini"]

# 配置 Ollama 提供商
[models.providers.ollama]
models = ["qwen3:4b", "llama3"]
base_url = "http://localhost:11434"

[models.providers.ollama.params]
temperature = 0
num_ctx = 8192

[models.providers.ollama.params."qwen3:4b"]
temperature = 0.5
num_ctx = 4000
```

### 提供商配置选项

| 选项 | 类型 | 描述 |
|---|---|---|
| `models` | `string[]` | 在 `/model` 选择器中显示的模型列表 |
| `api_key_env` | `string` | API 密钥的环境变量名 |
| `base_url` | `string` | 覆盖提供商的默认端点 URL |
| `base_url_env` | `string` | 端点 URL 的环境变量名 |
| `class_path` | `string` | 自定义模型类的完整路径（`module.path:ClassName`） |
| `enabled` | `boolean` | 是否在选择器中显示（默认 `true`） |
| `params` | `table` | 传递给模型构造函数的额外参数 |

### 自定义端点

```toml
# 使用兼容 OpenAI 的 API
[models.providers.openai]
base_url = "https://api.example.com/v1"
api_key_env = "EXAMPLE_API_KEY"
models = ["my-model"]

# 使用兼容 Anthropic 的 API
[models.providers.anthropic]
base_url = "https://api.example.com"
api_key_env = "EXAMPLE_API_KEY"
models = ["my-model"]
```

### 自定义提供商

```toml
# 使用任意 BaseChatModel 子类
[models.providers.my_custom]
class_path = "my_package.models:MyChatModel"
api_key_env = "MY_API_KEY"
base_url = "https://my-endpoint.example.com"

[models.providers.my_custom.params]
temperature = 0
max_tokens = 4096
```

安装自定义提供商包：

```bash
dcode --install my_package --package
```

## 开源模型

Deep Agents Code 支持通过 Ollama 运行开源模型：

```bash
# 安装 Ollama：https://ollama.ai
# 拉取模型
ollama pull qwen3:4b
ollama pull llama3

# 使用 Ollama 模型
dcode --model ollama:qwen3:4b
```

### 配置 Ollama 模型

```toml
[models.providers.ollama]
models = ["gemma4", "qwen3.6", "granite4.1:3b"]
base_url = "http://localhost:11434"
```

## 端点、密钥和网关

### base_url 解析顺序

1. `config.toml` 中的 `base_url`
2. `DEEPAGENTS_CODE_` 前缀的端点变量
3. 普通端点变量（如 `OPENAI_BASE_URL`）
4. `/auth` 中保存的端点
5. 提供商 SDK 的默认端点

### 管理网关

在配置了模型网关的机器上（如 LangSmith 网关），网关通常同时导出网关密钥和匹配的端点变量。Deep Agents Code 默认使用这对配置。

要使用自己的密钥，通过 `/auth` 存储或设置 `DEEPAGENTS_CODE_` 前缀变量：

```bash
DEEPAGENTS_CODE_OPENAI_API_KEY=sk-cli-only
DEEPAGENTS_CODE_OPENAI_BASE_URL=https://api.openai.com/v1
```

## 模型参数

### 构造函数参数

```toml
[models.providers.anthropic.params]
temperature = 0
max_tokens = 4096

# 为特定模型覆盖参数
[models.providers.anthropic.params."claude-sonnet-4-5"]
temperature = 0.7
```

### Profile 覆盖（高级）

```toml
# 覆盖模型运行时配置
[models.providers.anthropic.profile]
max_input_tokens = 4096

# 为特定模型设置不同的限制
[models.providers.anthropic.profile."claude-sonnet-4-5"]
max_input_tokens = 8192
```

### CLI Profile 覆盖

```bash
dcode --profile-override '{"max_input_tokens": 4096}'
dcode --model google_genai:gemini-3.5-flash --profile-override '{"max_input_tokens": 4096}'
dcode -n "Summarize this repo" --profile-override '{"max_input_tokens": 4096}'
```

## 小结

- 支持所有主流 LLM 提供商：OpenAI、Anthropic、Google、Ollama 等
- 使用 `/auth` 管理密钥，或通过环境变量配置
- `DEEPAGENTS_CODE_` 前缀实现密钥作用域限定
- 支持自定义端点、自定义提供商和开源模型
- 模型参数和 Profile 可全局或按模型配置
- 支持管理网关和自定义 base URL
