# 远程沙盒 - Remote Sandboxes

> 在远程沙盒环境中而非本地机器上运行代理工具。

## 概述

Deep Agents Code 支持远程沙盒执行，允许代理工具在隔离的远程环境中运行，而不是在你的本地机器上。这对于安全隔离、一致性环境和 CI/CD 场景非常有用。

## 支持的沙盒类型

Deep Agents Code 支持以下远程沙盒提供商：

| 沙盒类型 | 说明 | 是否需要额外安装 |
|---|---|---|
| `none` | 默认，在本地执行 | - |
| `langsmith` | LangSmith 提供的沙盒 | 内置 |
| `agentcore` | Amazon AgentCore 沙盒 | 需要额外安装 |
| `modal` | Modal 平台沙盒 | 需要额外安装 |
| `daytona` | Daytona 沙盒 | 需要额外安装 |
| `runloop` | Runloop 沙盒 | 需要额外安装 |

## 使用方法

### 基本用法

```bash
# 使用 LangSmith 沙盒
dcode --sandbox langsmith

# 使用 AgentCore 沙盒
dcode --sandbox agentcore

# 使用 Modal 沙盒
dcode --sandbox modal
```

### 复用已有沙盒

```bash
# 复用一个已存在的沙盒实例（跳过创建和清理）
dcode --sandbox langsmith --sandbox-id existing-sandbox-id
```

### 沙盒快照

```bash
# 使用或创建指定名称的沙盒快照（仅 LangSmith）
dcode --sandbox langsmith --sandbox-snapshot-name my-snapshot
```

### 沙盒初始化脚本

```bash
# 在沙盒创建后运行初始化脚本
dcode --sandbox langsmith --sandbox-setup ./setup.sh
```

## 配置示例

### LangSmith 沙盒

LangSmith 沙盒内置在 Deep Agents Code 中，无需额外安装：

```bash
# 安装后即可使用
dcode --sandbox langsmith -n "Run the test suite"
```

### 带初始化的沙盒

创建一个初始化脚本来设置沙盒环境：

```bash
# setup.sh - 沙盒初始化脚本
#!/bin/bash
apt-get update && apt-get install -y python3-pip
pip install -r requirements.txt
npm install
```

```bash
# 使用初始化脚本启动沙盒
dcode --sandbox langsmith --sandbox-setup ./setup.sh
```

## 使用场景

### 1. CI/CD 流水线

在 CI 环境中使用远程沙盒确保一致性和隔离：

```bash
# 在 CI 中运行，自动批准所有操作
dcode --sandbox langsmith -y -n "Run all tests and report results"
```

### 2. 安全隔离

不信任的代码在沙盒中运行，保护本地环境：

```bash
# 在沙盒中分析未知代码
dcode --sandbox langsmith -n "Analyze this repository for security issues"
```

### 3. 团队协作

使用快照确保团队成员使用相同的环境配置：

```bash
# 创建团队共享快照
dcode --sandbox langsmith --sandbox-snapshot-name team-env --sandbox-setup ./team-setup.sh

# 其他成员复用快照
dcode --sandbox langsmith --sandbox-snapshot-name team-env
```

## 注意事项

- 远程沙盒执行会有网络延迟，对于简单任务可能比本地执行慢
- 沙盒环境可能与本地环境有差异（操作系统、已安装工具等）
- 部分沙盒提供商需要额外安装对应的扩展包
- 文件同步可能在本地和远程之间需要额外时间
- 敏感数据（API 密钥等）需要谨慎处理，确保沙盒环境的安全

## 小结

- Deep Agents Code 支持 6 种沙盒类型：none、langsmith、agentcore、modal、daytona、runloop
- LangSmith 沙盒内置，其他需要额外安装
- 支持沙盒复用、快照和初始化脚本
- 适用于 CI/CD、安全隔离和团队协作场景
- 使用 `--sandbox` 命令行选项指定沙盒类型
