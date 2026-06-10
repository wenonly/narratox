# 配置档案 (Profiles)

> 打包每个提供商和每个模型的默认配置，Deep Agents 在选择模型时自动应用。

## 概述

**Harness 配置档案**（Harness Profiles）让你可以打包 Deep Agents 在选择特定提供商或模型时自动应用的配置：系统提示调整、工具描述覆盖、排除的工具或中间件、额外的中间件，以及通用子 Agent 编辑。它们是针对特定模型调整 Harness 行为的主要方式，无需更改你的 `createDeepAgent` 调用点。

**提供商配置档案**（Provider Profiles）是一个更窄的配套 API，用于**模型构建**参数，不影响 Harness。大多数调用者不需要它们；当你想要 `init_chat_model` 默认值、凭证检查或运行时派生的参数作为提供商选择的默认值时使用。

Deep Agents 内置了 OpenAI 和 Anthropic (Claude) 模型的 Harness 配置档案。

## Harness 配置档案

一个 `HarnessProfile` 描述了 `createDeep_agent` 在构建聊天模型后应用的提示组装、工具可见性、中间件和默认子 Agent 调整。

### 关键配置字段

| 字段 | 说明 |
| --- | --- |
| `system_prompt_suffix` | 附加到组装的基础提示后（应用于主 Agent、声明式子 Agent 和自动添加的通用子 Agent） |
| `tool_description_overrides` | 覆盖单个工具描述，按键值对（工具名 -> 新描述） |
| `excluded_tools` | 从工具集中移除特定的 Harness 级工具。按工具名称匹配 |
| `excluded_middleware` | 从栈中剥离特定的中间件类。接受中间件类或字符串名称 |
| `extra_middleware` | 向每个此档案适用的栈追加中间件 |
| `general_purpose_subagent` | 禁用、重命名或重新提示通用子 Agent |

### 注册示例

```typescript
import {
  HarnessProfile,
  registerHarnessProfile,
} from "deepagents";

// 为特定模型注册配置档案
registerHarnessProfile(
  "openai:gpt-5.4",
  new HarnessProfile({
    systemPromptSuffix: "Respond in under 100 words.",
    excludedTools: ["execute"],
    excludedMiddleware: ["SummarizationMiddleware"],
    generalPurposeSubagent: { enabled: false },
  }),
);
```

## 注册键

两种档案类型使用相同的键格式：

- **提供商级别**：裸提供商名称如 `"openai"` 应用于该提供商的每个模型
- **模型级别**：完全限定的 `provider:model` 键如 `"openai:gpt-5.4"` 仅应用于该特定模型

当提供商级别和模型级别档案同时存在时，它们在解析时合并。未设置的字段从提供商级别档案继承。

## 合并语义

| 字段 | 合并行为 |
| --- | --- |
| `base_system_prompt`、`system_prompt_suffix` | 新值设置时覆盖；否则继承 |
| `tool_description_overrides` | 按键合并映射；共享键上新值覆盖 |
| `excluded_tools`、`excluded_middleware` | 集合并集 |
| `extra_middleware` | 按具体类合并：新实例替换其位置的现有实例，新类追加 |
| `general_purpose_subagent` | 按字段合并（未设置的字段继承） |

## 提供商配置档案

`ProviderProfile` 声明 Deep Agents 应如何为给定提供商或特定模型规范构建聊天模型。它仅在你创建 Deep Agent 时提供 `provider:model` 字符串时适用，不适用于传入预配置模型的情况。

```typescript
import { ProviderProfile, registerProviderProfile } from "deepagents";

// 为 OpenAI 注册提供商配置
registerProviderProfile(
  "openai",
  new ProviderProfile({
    initKwargs: { temperature: 0 },
  }),
);
```

### 提供商档案字段

| 字段 | 说明 |
| --- | --- |
| `init_kwargs` | 转发给 `init_chat_model` 的静态初始化参数 |
| `pre_init` | 在构建之前运行的副作用（例如凭证验证） |
| `init_kwargs_factory` | 从运行时状态派生的参数（例如从环境变量中提取的请求头） |

## 从配置文件加载档案

对于 YAML/JSON 支持的工作流，使用 `HarnessProfileConfig`。它映射了 `HarnessProfile` 的声明式子集，并拥有 `toDict` / `fromDict` 方法。

### YAML 配置示例

```yaml
# openai.yaml
base_system_prompt: You are helpful.
system_prompt_suffix: Respond briefly.
excluded_tools:
  - execute
  - grep
excluded_middleware:
  - SummarizationMiddleware
general_purpose_subagent:
  enabled: false
```

### 加载 YAML 并注册

```typescript
import yaml from "js-yaml";
import fs from "fs";
import { HarnessProfileConfig, registerHarnessProfile } from "deepagents";

// 从 YAML 文件加载并注册
const config = yaml.load(fs.readFileSync("openai.yaml", "utf-8"));
registerHarnessProfile(
  "openai",
  HarnessProfileConfig.fromDict(config),
);
```

## 作为插件发布档案

可分发的档案可以通过 `importlib.metadata` 入口点自行注册，而不需要调用者手动运行 `register_*_profile`。

加载顺序为：**内置优先，然后入口点插件，然后用户代码中的直接 `register_*_profile` 调用**。所有三个路径通过相同的增量注册汇合。

### 定义入口点

在 `pyproject.toml` 中声明入口点：

```toml
[project.entry-points."deepagents.harness_profiles"]
my_provider = "my_pkg.profiles:register_harness"

[project.entry-points."deepagents.provider_profiles"]
my_provider = "my_pkg.profiles:register_provider"
```

### 实现注册函数

```typescript
import {
  HarnessProfile,
  ProviderProfile,
  registerHarnessProfile,
  registerProviderProfile,
} from "deepagents";

// 注册 Harness 配置档案
function registerHarness() {
  registerHarnessProfile(
    "my_provider",
    new HarnessProfile({
      systemPromptSuffix: "Batch independent tool calls in parallel.",
    }),
  );
}

// 注册提供商配置档案
function registerProvider() {
  registerProviderProfile(
    "my_provider",
    new ProviderProfile({
      initKwargs: { temperature: 0 },
    }),
  );
}
```

## 关键概念总结

- **Harness 档案**影响提示组装、工具可见性、中间件和子 Agent 配置——在 `createDeepAgent` 处理模型后应用
- **提供商档案**仅影响模型构建参数——通过 `init_chat_model` 应用
- 两者都使用 `provider` 或 `provider:model` 键进行注册
- 多个档案通过字段级合并叠加，而不是替换
- 支持从 YAML/JSON 文件加载和通过入口点自动注册
