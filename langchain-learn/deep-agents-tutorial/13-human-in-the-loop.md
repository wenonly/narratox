# 人在回路 - Human-in-the-Loop

> 原文地址: https://docs.langchain.com/oss/javascript/deepagents/human-in-the-loop

## 概述

某些工具操作可能是敏感的，需要在执行前获得人工审批。Deep Agents 通过 LangGraph 的中断（interrupt）能力支持人在回路（HITL）工作流。你可以使用 `interrupt_on` 参数配置哪些工具需要审批。

当设置了 `interrupt_on` 时，`HumanInTheLoopMiddleware` 会被添加到默认中间件栈中。如果运行在工具返回结果之前被取消或中断，同一栈中的 `PatchToolCallsMiddleware` 会自动修复消息历史。

---

## 基本配置

`interrupt_on` 参数接收一个字典，将工具名称映射到中断配置。每个工具可以配置为：

- **`true`**：启用中断，使用默认行为（允许批准、编辑、拒绝、响应）
- **`false`**：禁用此工具的中断
- **`InterruptOnConfig`**：自定义配置，设置 `allowedDecisions` 控制审核选项

```typescript
import { tool } from "langchain";
import { createDeepAgent } from "deepagents";
import { MemorySaver } from "@langchain/langgraph";
import { z } from "zod";

// 定义敏感工具：删除文件
const removeFile = tool(
  async ({ path }: { path: string }) => {
    return `Deleted ${path}`;
  },
  {
    name: "remove_file",
    description: "Delete a file from the filesystem.",
    schema: z.object({
      path: z.string(),
    }),
  },
);

// 定义普通工具：读取文件
const fetchFile = tool(
  async ({ path }: { path: string }) => {
    return `Contents of ${path}`;
  },
  {
    name: "fetch_file",
    description: "Read a file from the filesystem.",
    schema: z.object({
      path: z.string(),
    }),
  },
);

// 定义敏感工具：发送邮件
const notifyEmail = tool(
  async ({
    to,
    subject,
    body,
  }: {
    to: string;
    subject: string;
    body: string;
  }) => {
    return `Sent email to ${to}`;
  },
  {
    name: "notify_email",
    description: "Send an email.",
    schema: z.object({
      to: z.string(),
      subject: z.string(),
      body: z.string(),
    }),
  },
);

// 检查点是人在回路的必需品
const checkpointer = new MemorySaver();

const agent = createDeepAgent({
  model: "google_genai:gemini-3.5-flash",
  tools: [removeFile, fetchFile, notifyEmail],
  interruptOn: {
    remove_file: true, // 默认：批准、编辑、拒绝、响应
    fetch_file: false, // 不需要中断
    notify_email: { allowedDecisions: ["approve", "reject"] }, // 不允许编辑
  },
  checkpointer, // 必需！
});
```

---

## 决策类型

`allowedDecisions` 列表控制人工审核工具调用时可采取的操作：

| 决策 | 说明 |
| --- | --- |
| `"approve"` | 使用 Agent 提议的原始参数执行工具 |
| `"edit"` | 在执行前修改工具参数 |
| `"reject"` | 完全跳过此工具调用，将拒绝反馈返回给 Agent |
| `"respond"` | 将人工的消息直接作为工具结果返回，跳过执行 |

> **注意：** 使用 `reject` 拒绝提议的操作。`respond` 仅在人工充当工具时使用（如回答 `ask_user` 提示）。不要使用 `respond` 拒绝有副作用的工具。

```typescript
const interruptOn = {
  // 敏感操作：允许所有选项
  delete_file: { allowedDecisions: ["approve", "edit", "reject"] },

  // 中等风险：仅允许批准或拒绝
  write_file: { allowedDecisions: ["approve", "reject"] },

  // 必须批准（不允许拒绝）
  critical_operation: { allowedDecisions: ["approve"] },
};
```

---

## 处理中断

当中断被触发时，Agent 暂停执行并返回控制。需要检查结果中的中断并进行相应处理。

### 基本处理流程

```typescript
import { v7 as uuid7 } from "uuid";
import { Command } from "@langchain/langgraph";

// 创建带有 thread_id 的配置以持久化状态
const config = { configurable: { thread_id: uuid7() } };

// 调用 Agent
let result = await agent.invoke({
  messages: [{ role: "user", content: "Delete the file temp.txt" }],
}, config);

// 检查执行是否被中断
if (result.__interrupt__) {
  // 提取中断信息
  const interrupts = result.__interrupt__[0].value;
  const actionRequests = interrupts.actionRequests;
  const reviewConfigs = interrupts.reviewConfigs;

  // 从工具名称到审核配置创建查找映射
  const configMap = Object.fromEntries(
    reviewConfigs.map((cfg) => [cfg.actionName, cfg])
  );

  // 向用户展示待审批的操作
  for (const action of actionRequests) {
    const reviewConfig = configMap[action.name];
    console.log(`Tool: ${action.name}`);
    console.log(`Arguments: ${JSON.stringify(action.args)}`);
    console.log(`Allowed decisions: ${reviewConfig.allowedDecisions}`);
  }

  // 获取用户决策（每个 actionRequest 一个，按顺序）
  const decisions = [
    {
      type: "reject",
      message: "User rejected deleting temp.txt. Do not retry deletion.",
    }
  ];

  // 使用决策恢复执行
  result = await agent.invoke(
    new Command({ resume: { decisions } }),
    config  // 必须使用相同的配置！
  );
}

// 处理最终结果
console.log(result.messages[result.messages.length - 1].content);
```

### 批量处理多个工具中断

当 Agent 调用多个需要审批的工具时，所有中断会批量一起返回：

```typescript
const config = { configurable: { thread_id: uuid7() } };

let result = await agent.invoke({
  messages: [{
    role: "user",
    content: "Delete temp.txt and send an email to admin@example.com"
  }]
}, config);

if (result.__interrupt__) {
  const interrupts = result.__interrupt__[0].value;
  const actionRequests = interrupts.actionRequests;

  // 两个工具需要审批
  console.assert(actionRequests.length === 2);

  // 按 actionRequests 的相同顺序提供决策
  const decisions = [
    { type: "approve" },  // 第一个工具：delete_file
    {
      type: "reject",
      message: "User rejected this action. Do not retry this tool call.",
    }  // 第二个工具：send_email
  ];

  result = await agent.invoke(
    new Command({ resume: { decisions } }),
    config
  );
}
```

---

## 拒绝消息

当审核者返回 `reject` 决策时，Deep Agents 跳过工具调用并将拒绝反馈发送回 Agent。

对于敏感或有副作用的工具，请传递包含明确指令的消息：

```typescript
const decisions = [
  {
    type: "reject",
    message: "User rejected deleting this file. Do not retry deletion. Ask which file to archive instead.",
  },
];
```

---

## 编辑工具参数

当 `"edit"` 在允许的决策中时，可以在执行前修改工具参数：

```typescript
if (result.__interrupt__) {
  const interrupts = result.__interrupt__[0].value;
  const actionRequest = interrupts.actionRequests[0];

  // Agent 的原始参数
  console.log(actionRequest.args);  // { to: "everyone@company.com", ... }

  // 用户决定编辑收件人
  const decisions = [{
    type: "edit",
    editedAction: {
      name: actionRequest.name,  // 必须包含工具名称
      args: { to: "team@company.com", subject: "...", body: "..." }
    }
  }];

  result = await agent.invoke(
    new Command({ resume: { decisions } }),
    config
  );
}
```

---

## 子代理中断

### 工具调用上的中断

每个子代理可以有自己的 `interrupt_on` 配置，覆盖主 Agent 的设置：

```typescript
const agent = createDeepAgent({
  tools: [deleteFile, readFile],
  interruptOn: {
    delete_file: true,
    read_file: false,
  },
  subagents: [{
    name: "file-manager",
    description: "Manages file operations",
    systemPrompt: "You are a file management assistant.",
    tools: [deleteFile, readFile],
    interruptOn: {
      // 覆盖：此子代理中读取也需要审批
      delete_file: true,
      read_file: true,  // 与主 Agent 不同！
    }
  }],
  checkpointer
});
```

### 工具调用内的中断

子代理工具可以直接调用 `interrupt()` 来暂停执行并等待审批：

```typescript
import { createAgent, tool } from "langchain";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import { MemorySaver, Command, interrupt } from "@langchain/langgraph";
import { createDeepAgent } from "deepagents";
import { z } from "zod";

// 直接在工具内请求审批
const requestApproval = tool(
  async ({ actionDescription }: { actionDescription: string }) => {
    // 调用 interrupt() 暂停执行，等待人工审批
    const approval = interrupt({
      type: "approval_request",
      action: actionDescription,
      message: `Please approve or reject: ${actionDescription}`,
    }) as { approved?: boolean; reason?: string };

    if (approval.approved) {
      return `Action '${actionDescription}' was APPROVED. Proceeding...`;
    } else {
      return `Action '${actionDescription}' was REJECTED. Reason: ${
        approval.reason || "No reason provided"
      }`;
    }
  },
  {
    name: "request_approval",
    description: "Request human approval before proceeding with an action.",
    schema: z.object({
      actionDescription: z
        .string()
        .describe("The action that requires approval"),
    }),
  }
);

async function main() {
  const checkpointer = new MemorySaver();
  const model = new ChatOpenAI({
    model: "gpt-4o-mini",
    maxTokens: 4096,
  });

  const compiledSubagent = createAgent({
    model: model,
    tools: [requestApproval],
    name: "approval-agent",
  });

  const parentAgent = await createDeepAgent({
    checkpointer: checkpointer,
    subagents: [
      {
        name: "approval-agent",
        description: "An agent that can request approvals",
        runnable: compiledSubagent as any,
      },
    ],
  });

  const threadId = "test_interrupt_directly";
  const config = { configurable: { thread_id: threadId } };

  let result = await parentAgent.invoke(
    {
      messages: [
        new HumanMessage({
          content:
            "Use the task tool to launch the approval-agent sub-agent. " +
            "Tell it to use the request_approval tool to request approval for 'deploying to production'.",
        }),
      ],
    },
    config
  );

  // 处理中断
  if (result.__interrupt__) {
    const interruptValue = result.__interrupt__[0].value as {
      type?: string;
      action?: string;
      message?: string;
    };
    console.log("Interrupt received!");
    console.log(`  Type: ${interruptValue.type}`);
    console.log(`  Action: ${interruptValue.action}`);

    // 恢复并批准
    const result2 = await parentAgent.invoke(
      new Command({ resume: { approved: true } }),
      config
    );

    if (!result2.__interrupt__) {
      console.log("Execution completed!");
    }
  }
}

main().catch(console.error);
```

**运行输出：**

```
Invoking agent - sub-agent will use request_approval tool...

Interrupt received!
  Type: approval_request
  Action: deploying to production
  Message: Please approve or reject: deploying to production

Resuming with Command(resume={'approved': true})...

Execution completed!
  Tool result: Approval for "deploying to production" has been granted.
```

---

## 最佳实践

### 始终使用检查点

人在回路需要检查点来在中断和恢复之间持久化 Agent 状态：

```typescript
const checkpointer = new MemorySaver();
const agent = createDeepAgent({ checkpointer, interruptOn: { ... } });
```

### 使用相同的线程 ID

恢复时必须使用带有相同 `thread_id` 的配置：

```typescript
// 中断和恢复使用相同的 config
const config = { configurable: { thread_id: "my-thread" } };
```

### 按顺序匹配决策

决策列表必须与 `actionRequests` 的顺序匹配：

```typescript
// 如果有 2 个 actionRequest，必须提供 2 个决策
const decisions = [
  { type: "approve" },
  { type: "reject", message: "..." },
];
```

### 按风险级别配置

根据工具的风险级别进行不同配置：

```typescript
const interruptOn = {
  delete_file: { allowedDecisions: ["approve", "edit", "reject"] },  // 高风险
  write_file: { allowedDecisions: ["approve", "reject"] },           // 中风险
  read_file: false,                                                   // 低风险
};
```

---

## 小结

- 人在回路通过 LangGraph 中断能力实现敏感操作的人工审批
- `interrupt_on` 参数配置哪些工具需要审批
- 支持四种决策类型：批准、编辑、拒绝、响应
- 必须使用检查点来持久化中断和恢复之间的状态
- 子代理可以有自己的中断配置，工具内部也可以直接调用 `interrupt()`
- 拒绝消息应包含明确的指令告诉 Agent 接下来该做什么
- 根据工具的风险级别定制审批配置
