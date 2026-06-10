# 模型配置 - Models

## 概述

Deep Agents 支持任何支持工具调用（Tool Calling）的 LangChain 聊天模型。本章节介绍如何选择、配置和在运行时切换模型。

## 支持的模型

### 模型标识格式

使用 `provider:model` 格式指定模型（如 `google_genai:gemini-3.5-flash`、`openai:gpt-5.4` 或 `anthropic:claude-sonnet-4-6`）：

- **provider 前缀**：选择 LangChain 集成
- **冒号后面的部分**：作为模型标识符传递给该提供商

### 推荐模型

以下模型在 Deep Agents 评测套件中表现良好：

| 提供商 | 推荐模型 |
|--------|----------|
| Google | `gemini-3.1-pro-preview`、`gemini-3-flash-preview` |
| OpenAI | `gpt-5.4`、`gpt-4o`、`o4-mini`、`gpt-5.2-codex`、`gpt-4o-mini`、`o3` |
| Anthropic | `claude-opus-4-6`、`claude-opus-4-5`、`claude-sonnet-4-6`、`claude-sonnet-4`、`claude-sonnet-4-5`、`claude-haiku-4-5`、`claude-opus-4-1` |
| 开源模型 | `GLM-5`、`Kimi-K2.5`、`MiniMax-M2.5`、`qwen3.5-397B-A17B`、`devstral-2-123B` |

开源模型可通过 OpenRouter、Fireworks 或 Ollama 等提供商使用。

## 模型评测结果

Deep Agents 评测套件测试了各主流模型在基本智能体操作上的表现：

| 模型 | 总体 | 文件操作 | 检索 | 工具使用 | 记忆 | 对话 | 摘要 |
|------|------|----------|------|----------|------|------|------|
| google_genai:gemini-3.5-flash | 82% | **100%** | **100%** | **90%** | 54% | 38% | 80% |
| openai:gpt-5.4 | 18% | **100%** | **100%** | 18% | 51% | 38% | **100%** |
| openai:gpt-5.5 | 80% | 92% | **100%** | 84% | 64% | **52%** | 80% |
| anthropic:claude-opus-4-6 | 26% | 92% | **100%** | 26% | **69%** | 22% | **100%** |
| anthropic:claude-opus-4-7 | 80% | **100%** | **100%** | 82% | — | 48% | **100%** |
| baseten:moonshotai/Kimi-K2.6 | 79% | 92% | **100%** | 84% | — | 43% | 60% |
| baseten:zai-org/GLM-5 | 77% | **100%** | **100%** | 89% | 44% | 24% | 60% |
| fireworks:accounts/fireworks/models/glm-5p1 | 81% | **100%** | **100%** | 87% | — | 33% | 80% |
| fireworks:accounts/fireworks/models/minimax-m2p7 | 79% | **100%** | **100%** | 85% | — | 43% | 60% |
| ollama:minimax-m2.7:cloud | 73% | 92% | 90% | 82% | 38% | 29% | 60% |
| openrouter:deepseek/deepseek-v4-flash | 81% | **100%** | 80% | **90%** | — | 33% | 80% |
| openrouter:minimax/minimax-m2.7 | 80% | 92% | **100%** | 89% | — | 43% | 60% |
| openrouter:z-ai/glm-5.1 | **89%** | 92% | **100%** | 89% | — | 33% | 80% |

> **注意**：通过基本评测是必要的，但不足以保证在更长、更复杂的任务上有强劲表现。

## 配置模型参数

### 基本用法

将模型字符串以 `provider:model` 格式传递给 `createDeepAgent`：

```typescript
import { createDeepAgent } from "deepagents";

// 使用模型字符串（通过 init_chat_model 解析）
const agent = await createDeepAgent({
  model: "google_genai:gemini-3.5-flash",
});
```

### 提供商配置文件（Provider Profiles）

`ProviderProfile` 封装了初始化参数，在使用 `provider:model` 字符串时生效。可以在两个级别注册：

- **提供商级别**：如 `"openai"` 应用于该提供商的所有模型
- **模型级别**：如 `"openai:gpt-5.4"` 只应用于特定模型，并合并到提供商级配置之上

```typescript
import { ProviderProfile, registerProviderProfile } from "deepagents";

// 提供商范围：所有 openai 模型都使用 temperature=0
registerProviderProfile(
  "openai",
  ProviderProfile({ initKwargs: { temperature: 0 } }),
);

// 模型级别覆盖：gpt-5.4 额外获得特定的 reasoning effort
// 继承上面的 temperature=0
registerProviderProfile(
  "openai:gpt-5.4",
  ProviderProfile({ initKwargs: { reasoning_effort: "medium" } }),
);
```

### 使用预配置的模型实例

如果需要完全控制模型参数，可以使用 `initChatModel` 或直接实例化提供商模型类：

```typescript
import { initChatModel } from "langchain";
import { createDeepAgent } from "deepagents";

// 使用 initChatModel 配置模型参数
const model = await initChatModel("openai:gpt-5.4", {
  temperature: 0,
  maxTokens: 4096,
});

const agent = await createDeepAgent({
  model,  // 传递预配置的模型实例
});
```

## 运行时选择模型

如果应用需要让用户在运行时选择模型（如 UI 中的下拉菜单），可以使用中间件在运行时切换模型，无需重建智能体：

```typescript
import { initChatModel, createMiddleware } from "langchain";
import { createDeepAgent } from "deepagents";
import * as z from "zod";

// 定义运行时上下文的结构
const contextSchema = z.object({
  model: z.string(),  // 用户选择的模型名称
});

// 创建可配置模型的中间件
const configurableModel = createMiddleware({
  name: "ConfigurableModel",
  wrapModelCall: async (request, handler) => {
    // 从运行时上下文中获取用户选择的模型
    const modelName = request.runtime.context.model;
    const model = await initChatModel(modelName);
    // 用新模型替换请求中的模型
    return handler({ ...request, model });
  },
});

const agent = await createDeepAgent({
  model: "google_genai:gemini-3.5-flash",  // 默认模型
  middleware: [configurableModel],
  contextSchema,
});

// 使用用户选择的模型调用
const result = await agent.invoke(
  { messages: [{ role: "user", content: "你好！" }] },
  { context: { model: "openai:gpt-5.4" } },  // 用户选择了 gpt-5.4
);
```

## 模型选择建议

### 按使用场景选择

| 场景 | 推荐模型 | 理由 |
|------|----------|------|
| 快速原型开发 | `google_genai:gemini-3.5-flash` | 总体评分高，文件操作和检索满分 |
| 生产环境（高质量） | `anthropic:claude-opus-4-7` | 总体80%，工具使用和摘要表现优秀 |
| 成本优化 | `openrouter:z-ai/glm-5.1` | 总体89%，性价比高 |
| 代码密集任务 | `openai:gpt-5.2-codex` | 专为代码任务优化 |
| 本地运行 | `ollama:minimax-m2.7:cloud` | 可在本地运行 |

### 模型标识符注意事项

- 有些提供商使用简单名称如 `gpt-5.4`
- 有些使用命名空间 ID 或部署路径如 `zai-org/GLM-5.1`
- 完整的 Deep Agents 字符串格式如 `baseten:zai-org/GLM-5.1`
- 请查阅提供商的模型目录或集成文档获取当前有效的标识符

## 小结

| 主题 | 要点 |
|------|------|
| 模型格式 | `provider:model` 格式指定模型 |
| 推荐模型 | Gemini、GPT-5、Claude、开源模型均可 |
| 配置文件 | ProviderProfile 支持提供商和模型级别的参数配置 |
| 运行时切换 | 使用中间件动态切换模型 |
| 模型评测 | 参考评测数据选择适合的模型 |

## 相关章节

- [核心能力](./06-core-capabilities.md) - 深度智能体的内置能力
- [工具](./08-tools.md) - 自定义工具和 MCP 集成
- [投入生产](./05-going-to-production.md) - 模型回退和重试中间件
