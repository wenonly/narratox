# 与 Claude Agent SDK 的对比 - Comparison with Claude Agent SDK

> 本章节将详细对比 LangChain Deep Agents 与 Claude Agent SDK 的异同，帮助你根据具体用例选择合适的工具。

---

## 概述

LangChain Deep Agents 和 Claude Agent SDK 都是用于构建自定义智能体的框架，但它们在执行环境、部署方式和供应商耦合度方面做出了不同的权衡。

---

## 一览对比

| 特性 | **Deep Agents** | **Claude Agent SDK** |
| --- | --- | --- |
| **智能体运行位置** | 在沙箱内部运行，或在沙箱外部远程执行命令 | 在沙箱内部运行 |
| **执行后端** | 可插拔：本地、虚拟文件系统、远程沙箱或自定义 | 沙箱的本地文件系统 |
| **模型提供商** | 任意（Anthropic、OpenAI、Google 等 100+ 家） | 仅 Claude（Anthropic、Bedrock、Vertex、Azure） |
| **部署方式** | 通过 `deepagents deploy` 部署到 LangSmith 托管云，或通过 `langgraph build` 自托管 Docker 镜像 | 自行托管。你需要构建服务器、认证和流式传输层。Claude managed agents 是一个独立的产品 |
| **多租户** | 内置支持：作用域线程、每用户沙箱、RBAC | 需要自行构建 |
| **许可证** | MIT | MIT（Claude Code 本身是专有软件） |

---

## 主要差异详解

### 1. 智能体与执行环境

连接智能体到沙箱有两种模式：

- **模式一**：在沙箱**内部**运行智能体
- **模式二**：在沙箱**外部**运行智能体，将沙箱**作为工具使用**

**Claude Agent SDK 仅支持模式一**。你的智能体在沙箱内运行，并针对沙箱的本地文件系统执行工具。Anthropic 的托管产品 Claude managed agents 使用解耦模式，这反映了生产级智能体架构的发展方向。

**Deep Agents 两种模式都支持**，并允许你选择后端来连接它们。实践中这意味着你可以：

- 在沙箱内运行智能体（与 Claude Agent SDK 相同的模式）
- 在长期运行的容器中运行智能体，通过网络在远程沙箱上执行命令
- 为测试换入虚拟文件系统，或为自有基础设施换入自定义后端

### 2. 多租户

当你将应用投入生产时，通常需要将其暴露给多个终端用户，并且必须为每个用户隔离环境。

**Claude Agent SDK** 中，SDK 将智能体绑定到其沙箱。要为每个用户提供隔离的执行环境，你必须：
- 构建一个 API 包装器
- 为每个用户启动沙箱
- 跟踪哪个沙箱属于哪个用户
- 在使用后进行清理

**Deep Agents** 直接处理这些问题：
- 在框架中为每个用户或每个助手配置沙箱
- 内置作用域线程、运行历史和 RBAC
- 如果使用 LangSmith Sandbox，还提供认证代理，使终端用户可以从沙箱调用第三方 API，无需你为每个用户配置凭证

### 3. 生产级智能体服务器

要将自托管的 Claude Agent SDK 应用暴露给终端用户，你需要：
- 编写自己的 HTTP/WebSocket 或 SSE 服务器
- 调用智能体并将 token 流式传回
- 管理对话线程
- 自行负责该服务器的构建、运维和安全

**Deep Agents** 部署开箱即用地包含智能体服务器：
- 流式传输端点
- 线程管理
- 运行历史
- Webhook
- 身份认证

### 4. 托管云或自托管

**Claude Agent SDK** 的部署是自托管的。SDK 和 Claude managed agents 是**独立的产品**。针对 SDK 编写的代码无法直接部署到托管产品。

**Deep Agents** 无需代码修改即可在两种模式下运行：
- **托管模式**：通过 `deepagents deploy` 部署到 LangSmith 托管云
- **自托管模式**：运行 `langgraph build` 生成独立的 Docker 镜像，可部署到任何地方

### 5. LLM 选择

**Claude Agent SDK** 将模型、后端和部署捆绑在一起，并在三者之间优化支持。

**Deep Agents** 允许你独立选择模型提供商、执行后端和部署目标。通过选择这个框架，你在模型和基础设施的选择上保留了最大的灵活性。

---

## 总结与选型建议

### 选择 Deep Agents 的场景

- 你需要**模型和基础设施的灵活性**（不想被单一提供商锁定）
- 你需要**内置的多租户部署**能力
- 你希望能够在**托管和自托管之间切换而无需修改代码**

### 选择 Claude Agent SDK 的场景

- 你**已决定使用 Claude** 作为唯一的模型提供商
- 你打算**自行托管**
- 你愿意**自行构建 API、认证和多租户层**

---

> **核心观点**：Deep Agents 在模型选择、基础设施和部署方式上提供了最大化的灵活性，而 Claude Agent SDK 则专注于为 Claude 模型提供深度优化的体验。如果你的项目需要长期演进的灵活性，Deep Agents 是更好的选择；如果你的团队完全依赖 Anthropic 生态且有能力自建基础设施层，Claude Agent SDK 也是可行的方案。
