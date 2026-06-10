# 记忆与技能 - Memory and Skills

> Deep Agents Code 的持久化记忆系统和可自定义技能系统。

## 概述

Deep Agents Code 提供两个关键机制来增强代理的长期能力：

- **记忆（Memory）** - 跨会话存储和检索信息，让代理记住项目约定和学习到的模式
- **技能（Skills）** - 使用自定义专业知识和指令扩展代理能力

## 记忆系统

### 记忆存储位置

记忆文件以 Markdown 格式存储在以下位置：

| 路径 | 范围 |
|---|---|
| `~/.deepagents/<agent_name>/memory.md` | 用户级别记忆，应用于所有项目 |
| `.deepagents/memory.md` | 项目级别记忆，仅在项目内生效 |

### 记忆管理

使用 `/remember` 命令审查对话并更新记忆：

```
/remember Always use TypeScript strict mode in this project
```

代理会自动在对话过程中识别值得记住的信息。

### 记忆文件格式

记忆文件是标准 Markdown 文件，可以包含任何对代理有用的上下文信息：

```markdown
# Project Memory

## Code Style
- Use TypeScript strict mode
- Prefer functional components with hooks
- Use async/await over .then() chains

## Architecture
- Frontend: Next.js with App Router
- Backend: Express with TypeScript
- Database: PostgreSQL with Prisma ORM

## Conventions
- API routes follow RESTful naming
- All API responses wrapped in { data, error } format
- Tests use Vitest with testing-library
```

### 自动上下文压缩

当 token 使用量超过模型感知的阈值时，Deep Agents Code 会自动在后台卸载对话：

1. 通过 LLM 摘要旧消息
2. 将原始内容弹出存储（`/conversation_history/{thread_id}.md`）
3. 在上下文中用摘要替换原始内容

代理仍然可以从卸载文件中检索完整历史记录。

手动触发上下文卸载：

```
/offload
# 或
/compact
```

## 技能系统

### 技能存储位置

技能以 `SKILL.md` 文件的形式存储在以下目录中：

| 路径 | 范围 |
|---|---|
| `~/.deepagents/<agent_name>/skills/<skill-name>/SKILL.md` | 用户级别技能 |
| `.deepagents/skills/<skill-name>/SKILL.md` | 项目级别技能 |

### 技能管理命令

```bash
# 列出所有技能
dcode skills list

# 列出项目级别技能
dcode skills list --project

# 创建新技能
dcode skills create my-skill

# 创建项目级别技能
dcode skills create my-skill --project

# 查看技能详情
dcode skills info my-skill

# 删除技能
dcode skills delete my-skill
```

### 技能文件格式

技能使用 Markdown 文件定义，包含 YAML 前置元数据：

```markdown
---
name: code-review
description: Perform thorough code reviews with best practices
---

# Code Review Skill

You are a code review expert. When reviewing code, follow this process:

## Review Checklist

1. **Correctness**: Does the code do what it's supposed to?
2. **Security**: Are there any security vulnerabilities?
3. **Performance**: Are there any performance concerns?
4. **Readability**: Is the code easy to understand?
5. **Testing**: Are there adequate tests?

## Output Format

For each issue found, provide:
- Severity (critical/warning/info)
- File and line number
- Description of the issue
- Suggested fix with code example
```

### 技能使用

在会话中通过斜杠命令调用技能：

```
/skill:code-review Review the changes in src/auth.ts
```

也可以在启动时指定技能：

```bash
dcode --skill code-review -n "Review all recent changes"
```

### 技能示例：Git 工作流

```markdown
---
name: git-workflow
description: Standard git workflow for feature development
---

# Git Workflow Skill

Follow this branching and commit strategy:

1. Create a feature branch from `main`
2. Make atomic commits with conventional commit messages
3. Run tests before committing
4. Create a PR with description and test plan

## Commit Message Format

type(scope): description

Types: feat, fix, docs, style, refactor, test, chore
```

### 技能示例：API 开发

```markdown
---
name: api-development
description: RESTful API development patterns
---

# API Development Skill

When creating API endpoints:

1. Define the route with proper HTTP method
2. Add request validation middleware
3. Implement the handler with error handling
4. Add response type documentation
5. Write integration tests
```

## 上下文工程

### `/remember` 命令

在会话中使用 `/remember` 命令来保存重要上下文：

```
/remember This project uses pnpm, not npm
```

可以传递额外上下文：

```
/remember The database migrations are in src/db/migrations
```

### `@filename` 引用

使用 `@` 符号在提示中引用文件内容：

```
@src/config.ts Explain what this configuration does
```

### Token 使用监控

使用 `/tokens` 命令查看当前上下文窗口的 token 使用情况：

```
/tokens
```

## 小结

- **记忆系统**跨会话持久化上下文，支持用户级和项目级
- **技能系统**通过 `SKILL.md` 文件定义可重用的专业能力
- `/remember` 命令用于手动保存记忆
- `/skill:<name>` 命令用于调用技能
- 自动上下文压缩在 token 超限时触发
- 技能和记忆都支持用户级和项目级的作用域
