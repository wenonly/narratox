# 子代理 - Subagents

> 定义自定义子代理，让 Deep Agents Code 可以将专门任务委派给它们。

## 概述

Deep Agents Code 支持将自定义同步子代理定义为 Markdown 文件，使得代理可以将专门的任务委派给它们。

每个子代理存放在自己的目录中，包含一个 `AGENTS.md` 文件：

```
.deepagents/agents/{subagent-name}/AGENTS.md   # 项目级别
~/.deepagents/{agent}/agents/{subagent-name}/AGENTS.md  # 用户级别
```

项目级别的子代理会覆盖同名的用户级别子代理。

## 文件格式

子代理 `AGENTS.md` 文件使用 YAML 前置元数据，后跟 Markdown 正文：

```markdown
---
name: researcher
description: Research topics on the web before writing content
model: anthropic:claude-haiku-4-5-20251001
---

You are a research assistant with access to web search.

## Your Process
1. Search for relevant information
2. Summarize findings clearly
```

### 前置元数据字段

| 字段 | 必需 | 描述 |
|---|---|---|
| `name` | 是 | 子代理名称（与 `SubAgent` 规范相同） |
| `description` | 是 | 子代理描述 |
| `model` | 否 | 覆盖主代理的模型。使用 `provider:model-name` 格式。省略则继承主代理的模型 |

Markdown 正文成为子代理的 `system_prompt`（系统提示）。

## 示例：高性价比子代理

使用更便宜、更快的模型处理简单的委派任务，同时保持主代理使用更强大的模型：

```markdown
---
name: general-purpose
description: General-purpose agent for research and multi-step tasks
model: anthropic:claude-haiku-4-5-20251001
---

You are a general-purpose assistant. Complete the task efficiently and return a concise summary.
```

这个配置覆盖了内置的通用子代理，将所有委派任务路由到更便宜的模型。

## 示例：专业化子代理

### 代码审查子代理

```markdown
---
name: code-reviewer
description: Specialized code review with security and performance focus
model: anthropic:claude-sonnet-4-5-20250929
---

You are a senior code reviewer. Focus on:

1. **Security vulnerabilities** - SQL injection, XSS, auth issues
2. **Performance bottlenecks** - N+1 queries, memory leaks
3. **Code quality** - Readability, maintainability, DRY
4. **Testing** - Coverage, edge cases, integration tests

For each finding:
- Rate severity: critical / warning / info
- Provide specific file and line
- Suggest a fix with code example
```

### 文档编写子代理

```markdown
---
name: doc-writer
description: Write clear, well-structured documentation
model: anthropic:claude-haiku-4-5-20251001
---

You are a technical documentation writer. Follow these guidelines:

## Style
- Use clear, concise language
- Include code examples for every concept
- Add a table of contents for long documents
- Use proper Markdown formatting

## Structure
1. Start with a brief overview
2. Include a quick start example
3. Detailed API reference
4. Common patterns and recipes
5. Troubleshooting section
```

### 测试编写子代理

```markdown
---
name: test-writer
description: Write comprehensive test suites
---

You are a test engineering specialist. When writing tests:

1. Follow the Arrange-Act-Assert pattern
2. Test happy paths first, then edge cases
3. Use descriptive test names that explain the expected behavior
4. Mock external dependencies
5. Aim for meaningful coverage over percentage targets
6. Include integration tests for critical paths
```

## 子代理优先级

当多个位置存在同名子代理时：

1. **项目级别**（`.deepagents/agents/`）- 最高优先级
2. **用户级别**（`~/.deepagents/<agent>/agents/`）- 较低优先级

项目级别的子代理会覆盖同名的用户级别子代理。

## 模型选择策略

子代理的 `model` 字段允许你为不同类型的任务使用不同的模型：

| 任务类型 | 推荐模型 | 原因 |
|---|---|---|
| 简单研究/搜索 | claude-haiku-4-5 | 快速且低成本 |
| 代码审查 | claude-sonnet-4-5 | 需要深度理解 |
| 文档编写 | claude-haiku-4-5 | 标准语言任务 |
| 架构设计 | claude-opus-4-7 | 需要最强的推理能力 |

## 小结

- 子代理通过 `AGENTS.md` 文件定义，存放在专门的目录中
- 支持项目级别和用户级别两个作用域
- 可以通过 `model` 字段为子代理指定不同的模型
- Markdown 正文成为子代理的系统提示
- 项目级别的子代理优先于用户级别的同名子代理
- 可以为不同类型的任务选择不同性价比的模型
