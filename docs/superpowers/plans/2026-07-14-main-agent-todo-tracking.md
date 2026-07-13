# Plan: Main Agent Todo Tracking(2026-07-14)

Spec: [2026-07-14-main-agent-todo-tracking-design.md](../specs/2026-07-14-main-agent-todo-tracking-design.md)

## 步骤

### S1 · 挂载 todoListMiddleware
- 文件:[server/src/agentos/deep-agent.service.ts](server/src/agentos/deep-agent.service.ts)
- 动态 import 拆出 `todoListMiddleware`(line 445,从 `'langchain'` import)
- main 的 middleware 数组(line 545)首位加 `todoListMiddleware() as never`
- 子 agent 的 `subagentStack()`(line 457)**不动**

### S2 · main.md 加【用户计划跟踪】段落
- 文件:[server/src/agentos/prompts/main.md](server/src/agentos/prompts/main.md)
- 位置:【核心原则 — 一步一停】段落之后(line 13 后)
- 内容:意图判断(交 agent)/ 与一步一停缝合 / 整体替换语义 / 收尾核对

### S3 · 验证
- `pnpm --dir server test -- agent-prompts.spec` —— MAIN 特征子串断言仍过(锁的是开头 `'你是【交互式编排者】'`,新段落不影响)
- `pnpm --dir server typecheck` —— import 类型 OK
- `pnpm --dir server build` —— postbuild 拷贝 prompts 进 dist

## 回滚
两文件 git revert 即可。无 DB 迁移、无 FE。
