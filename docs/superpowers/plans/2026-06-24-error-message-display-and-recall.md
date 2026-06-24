# 错误信息回显 + 用户消息撤回 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让整轮失败错误进入 Message 列表并持久化回显;给用户消息加撤回按钮,二次确认后尾部截断 + Agent 记忆真回退 + 文案回填输入框。

**Architecture:** 服务端把 `appendTurn`(成功才一次性写)拆成 `startTurn`(开始即建 user 行,带 langgraph id)+ `finishTurn`(收尾写 assistant 行,成败皆写,标 `isError`)。撤回用 langgraph 原生 `getState`+`updateState(RemoveMessage)` 真回退 checkpoint,DB 删尾部行,前端切数组 + 回填。客户端 `inputMessage` 从 ChatInput local state 提升进 Zustand store。

**Tech Stack:** NestJS 11 + Prisma 7(Postgres)、langgraph 1.4.2(`RemoveMessage` 来自 `@langchain/core/messages`)、Next.js 15 + React 18 + Zustand + nuqs + shadcn Dialog + lucide-react + sonner。

**Spec:** [docs/superpowers/specs/2026-06-24-error-message-display-and-recall-design.md](../specs/2026-06-24-error-message-display-and-recall-design.md)

**Conventions:**
- server 测试:`cd server && pnpm test -- <file>`(Jest,`NODE_OPTIONS=--experimental-vm-modules`)。改 schema 后**必须手动 `npx prisma generate`**(见 memory: prisma7-generate-gotcha)。
- agent-ui 无测试器:用 `cd agent-ui && pnpm typecheck` + `pnpm lint:fix` 做质量门 + 手测。
- 提交信息中文,scoped;每个 Task 末尾 commit。

---

## File Structure

**server(改 5 + 测试 2):**
- [prisma/schema.prisma](server/prisma/schema.prisma) — `Message` 加 `isError`、`langGraphId`。
- [src/agentos/sessions.service.ts](server/src/agentos/sessions.service.ts) — `appendTurn`→`startTurn`+`finishTurn`;`getRuns` 扩字段;新增 `getRecallTarget`+`deleteMessages`。
- [src/agentos/agentos.controller.ts](server/src/agentos/agentos.controller.ts) — `runAgent` 持久化重构 + `RunStarted` 扩字段;新增 `POST sessions/:id/recall`。
- [src/agentos/deep-agent.service.ts](server/src/agentos/deep-agent.service.ts) — 抽 `buildAgentGraph`;`runTurn` 注入 `userMessageId`;新增 `rewind`。
- [src/agentos/sessions.service.spec.ts](server/src/agentos/sessions.service.spec.ts) / [agentos.controller.spec.ts](server/src/agentos/agentos.controller.spec.ts) — 更新/新增用例。

**agent-ui(改 7 + 新 1):**
- [src/types/os.ts](agent-ui/src/types/os.ts) — `ChatMessage` 加 `id`/`langGraphId`/`isError`。
- [src/store.ts](agent-ui/src/store.ts) — `inputMessage`+`setChatInput`。
- [src/components/chat/ChatArea/ChatInput/ChatInput.tsx](agent-ui/src/components/chat/ChatArea/ChatInput/ChatInput.tsx) — 读 store input。
- [src/hooks/useAIStreamHandler.tsx](agent-ui/src/hooks/useAIStreamHandler.tsx) — `RunStarted` 回填 id;删 `slice(0,-2)`。
- [src/components/workspace/ChatPanel.tsx](agent-ui/src/components/workspace/ChatPanel.tsx) + [src/hooks/useSessionLoader.tsx](agent-ui/src/hooks/useSessionLoader.tsx) — 历史加载透传新字段。
- [src/components/chat/ChatArea/Messages/MessageItem.tsx](agent-ui/src/components/chat/ChatArea/Messages/MessageItem.tsx) — `AgentMessage` 错误渲染;`UserMessage` 撤回按钮 + 确认弹窗。
- [src/components/chat/ChatArea/Messages/Messages.tsx](agent-ui/src/components/chat/ChatArea/Messages/Messages.tsx) — 接撤回按钮 + 单实例确认 Dialog。
- [src/api/routes.ts](agent-ui/src/api/routes.ts) + [src/api/os.ts](agent-ui/src/api/os.ts) — `RecallSession` 路由 + client。
- 新 [src/hooks/useRecallMessage.ts](agent-ui/src/hooks/useRecallMessage.ts) — 撤回编排(API + 切数组 + 回填)。

**实现顺序(三阶段,共享地基先行):**
- **Phase A 共享地基:** Task 1–5(Schema + startTurn/finishTurn + RunPair 扩字段 + controller 持久化 + buildAgentGraph 抽取)。
- **Phase B 功能①错误回显:** Task 6–11(客户端类型/store/input/stream/历史/渲染)。
- **Phase C 功能②撤回:** Task 12–17(rewind + getRecallTarget/deleteMessages + recall 路由 + api + hook + UI)。
- **Phase D 验证:** Task 18。

---

## Phase A — 共享地基

### Task 1: Prisma schema 加两列

**Files:**
- Modify: `server/prisma/schema.prisma`(Message model,L44–54)

- [ ] **Step 1: 加两列**

把 Message model 改为:

```prisma
model Message {
  id          String   @id @default(cuid())
  sessionId   String
  role        String
  content     String
  activities  Json?
  isError     Boolean  @default(false)
  langGraphId String?
  createdAt   DateTime @default(now())
  session     Session  @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId, createdAt])
}
```

- [ ] **Step 2: 生成迁移 + client**

Run:
```sh
cd server && npx prisma migrate dev --name add_message_error_and_langgraph_id
```
Expected: 生成 `prisma/migrations/<ts>_add_message_error_and_langgraph_id/`,SQL 含 `ALTER TABLE "Message" ADD COLUMN "isError" BOOLEAN NOT NULL DEFAULT false, ADD COLUMN "langGraphId" TEXT;`。

> ⚠️ prisma7-generate-gotcha:migrate dev 在 7.x **不会自动 regenerate client**。若上一步末尾没看到 `✔ Generated Prisma Client`,手动跑:
> ```sh
> cd server && npx prisma generate
> ```

- [ ] **Step 3: 验证 client 已含新字段**

Run:
```sh
cd server && node -e "const{PrismaClient}=require('@prisma/client');console.log('isError' in PrismaClient.prototype.message.fields, 'langGraphId' in PrismaClient.prototype.message.fields)" 2>/dev/null || grep -c "isError\|langGraphId" node_modules/.prisma/client/index.d.ts | head -1
```
Expected: 两个 `true`(或 grep 命中 ≥2)。若为 false,回到 Step 2 末尾的手动 generate。

- [ ] **Step 4: Commit**

```sh
git add server/prisma/schema.prisma server/prisma/migrations
git commit -m "feat(message): Message 加 isError + langGraphId 列"
```

---

### Task 2: SessionsService — appendTurn 拆成 startTurn + finishTurn

**Files:**
- Modify: `server/src/agentos/sessions.service.ts`(L99–125 替换)
- Test: `server/src/agentos/sessions.service.spec.ts`(appendTurn describe 块 L267–339 替换)

- [ ] **Step 1: 写失败测试 — 替换 sessions.service.spec.ts 的 appendTurn describe 块**

把 `sessions.service.spec.ts` 的 `describe('appendTurn', ...)` 整块(L267–339)替换为:

```ts
  describe('startTurn', () => {
    it('is a no-op (returns null) when the session is not owned', async () => {
      const prisma = makePrismaMock();
      prisma.session.findFirst.mockResolvedValue(null);
      const service = makeService(prisma);

      const result = await service.startTurn('u1', 'sX', 'hi', 'lg-1');

      expect(result).toBeNull();
      expect(prisma.message.create).not.toHaveBeenCalled();
    });

    it('creates the user message row with langGraphId and returns its id', async () => {
      const prisma = makePrismaMock();
      prisma.session.findFirst.mockResolvedValue({ id: 's1', userId: 'u1' });
      prisma.message.create.mockResolvedValue({ id: 'msg-1' });
      const service = makeService(prisma);

      const result = await service.startTurn('u1', 's1', 'hi', 'lg-1');

      expect(result).toBe('msg-1');
      expect(prisma.message.create).toHaveBeenCalledWith({
        data: { sessionId: 's1', role: 'user', content: 'hi', langGraphId: 'lg-1' },
      });
    });
  });

  describe('finishTurn', () => {
    it('is a no-op when the session is not owned', async () => {
      const prisma = makePrismaMock();
      prisma.session.findFirst.mockResolvedValue(null);
      const service = makeService(prisma);

      await service.finishTurn('u1', 's1', 'hello', undefined, false);

      expect(prisma.message.create).not.toHaveBeenCalled();
      expect(prisma.session.update).not.toHaveBeenCalled();
    });

    it('writes the assistant message (with isError) and bumps updatedAt when owned', async () => {
      const prisma = makePrismaMock();
      prisma.session.findFirst.mockResolvedValue({ id: 's1', userId: 'u1' });
      const service = makeService(prisma);

      await service.finishTurn('u1', 's1', 'boom-msg', undefined, true);

      expect(prisma.message.create).toHaveBeenCalledWith({
        data: {
          sessionId: 's1',
          role: 'assistant',
          content: 'boom-msg',
          activities: undefined,
          isError: true,
        },
      });
      expect(prisma.session.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: { updatedAt: expect.any(Date) },
      });
    });

    it('persists activities on the assistant message when provided (isError defaults false)', async () => {
      const prisma = makePrismaMock();
      prisma.session.findFirst.mockResolvedValue({ id: 's1', userId: 'u1' });
      const service = makeService(prisma);
      const activities = { 'think-1': { act: 'think', text: '想' } };

      await service.finishTurn('u1', 's1', '你好', activities, false);

      expect(prisma.message.create).toHaveBeenCalledWith({
        data: {
          sessionId: 's1',
          role: 'assistant',
          content: '你好',
          activities,
          isError: false,
        },
      });
    });
  });
```

- [ ] **Step 2: 跑测试,确认失败**

Run: `cd server && pnpm test -- sessions.service.spec.ts`
Expected: FAIL(`startTurn is not a function` / `appendTurn` 相关用例找不到)。

- [ ] **Step 3: 实现 — 替换 sessions.service.ts 的 appendTurn(L99–125)**

把 `appendTurn` 方法整体替换为:

```ts
  /**
   * 轮次开始:立即建 user 消息行(带 langGraphId,供撤回定位 checkpoint),
   * 并刷新 updatedAt。整轮失败时该行也保留(错误 assistant 行由 finishTurn 写)。
   * 返回新建行 id;不属于本用户 → null(no-op,绝不改别人的会话)。
   */
  async startTurn(
    userId: string,
    sessionId: string,
    userContent: string,
    langGraphId: string,
  ): Promise<string | null> {
    const owned = await this.prisma.session.findFirst({
      where: { id: sessionId, userId },
    });
    if (!owned) return null;
    const created = await this.prisma.message.create({
      data: { sessionId, role: 'user', content: userContent, langGraphId },
    });
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() },
    });
    return created.id;
  }

  /**
   * 轮次结束:写 assistant 消息行(成功/失败都调)。isError=true 时 content 为错误文案。
   * 不属于本用户 → no-op。userId 仅作二次 ownership 校验(行本身按 sessionId 归属)。
   */
  async finishTurn(
    userId: string,
    sessionId: string,
    assistantContent: string,
    activities: unknown | undefined,
    isError: boolean,
  ): Promise<void> {
    const owned = await this.prisma.session.findFirst({
      where: { id: sessionId, userId },
    });
    if (!owned) return;
    await this.prisma.message.create({
      data: {
        sessionId,
        role: 'assistant',
        content: assistantContent,
        activities: activities ?? undefined,
        isError,
      },
    });
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() },
    });
  }
```

- [ ] **Step 4: 跑测试,确认通过**

Run: `cd server && pnpm test -- sessions.service.spec.ts`
Expected: PASS(startTurn/finishTurn 全绿)。注:`getRuns` 用例可能因 Step 3 未碰而仍过;若有红,继续 Task 3。

- [ ] **Step 5: Commit**

```sh
git add server/src/agentos/sessions.service.ts server/src/agentos/sessions.service.spec.ts
git commit -m "refactor(sessions): appendTurn 拆成 startTurn + finishTurn"
```

---

### Task 3: SessionsService — RunPair 扩字段 + getRuns 透传

**Files:**
- Modify: `server/src/agentos/sessions.service.ts`(`RunPair` L15–21、`getRuns` L70–93)
- Test: `server/src/agentos/sessions.service.spec.ts`(getRuns 用例补字段)

- [ ] **Step 1: 写失败测试 — 更新 getRuns 的现有用例断言**

在 `sessions.service.spec.ts` 的 `describe('getRuns', ...)` 里:

(a) 把 "pairs consecutive user+assistant" 用例(L194–224)的 mock 行加上新字段,并断言。把那 4 行 mock + 期望替换为:

```ts
      prisma.message.findMany.mockResolvedValue([
        { id: 'u1r', role: 'user', content: 'q1', langGraphId: 'lg1', createdAt: EPOCH },
        { id: 'a1r', role: 'assistant', content: 'a1', isError: false, createdAt: EPOCH },
        { id: 'u2r', role: 'user', content: 'q2', langGraphId: 'lg2', createdAt: EPOCH },
        { id: 'a2r', role: 'assistant', content: 'a2', isError: false, createdAt: EPOCH },
      ]);
      const service = makeService(prisma);

      const result = await service.getRuns('u1', 's1');

      expect(result).toEqual([
        {
          userContent: 'q1',
          assistantContent: 'a1',
          createdAt: EPOCH,
          activities: null,
          userMessageId: 'u1r',
          langGraphId: 'lg1',
          isError: false,
        },
        {
          userContent: 'q2',
          assistantContent: 'a2',
          createdAt: EPOCH,
          activities: null,
          userMessageId: 'u2r',
          langGraphId: 'lg2',
          isError: false,
        },
      ]);
```

(b) 新增一个错误轮次透传用例,加在 getRuns describe 末尾(L265 前):

```ts
    it('carries isError=true and null langGraphId for error turns', async () => {
      const prisma = makePrismaMock();
      prisma.session.findFirst.mockResolvedValue({ id: 's1', userId: 'u1' });
      prisma.message.findMany.mockResolvedValue([
        { id: 'ue', role: 'user', content: 'q', langGraphId: 'lgE', createdAt: EPOCH },
        { id: 'ae', role: 'assistant', content: 'boom', isError: true, createdAt: EPOCH },
      ]);
      const service = makeService(prisma);

      const result = await service.getRuns('u1', 's1');

      expect(result).toEqual([
        {
          userContent: 'q',
          assistantContent: 'boom',
          createdAt: EPOCH,
          activities: null,
          userMessageId: 'ue',
          langGraphId: 'lgE',
          isError: true,
        },
      ]);
    });
```

- [ ] **Step 2: 跑测试,确认失败**

Run: `cd server && pnpm test -- sessions.service.spec.ts`
Expected: FAIL(getRuns 返回对象缺 `userMessageId`/`langGraphId`/`isError`)。

- [ ] **Step 3: 实现 — 改 RunPair 接口 + getRuns**

(a) `RunPair` 接口(L15–21)改为:

```ts
export interface RunPair {
  userContent: string;
  assistantContent: string;
  createdAt: Date;
  activities: unknown;
  /** user 行的 DB id(撤回锚点)。 */
  userMessageId: string;
  /** user 行的 langgraph message id(撤回定位 checkpoint);历史行可能为 null。 */
  langGraphId: string | null;
  /** assistant 行整轮失败标记(功能①回显)。 */
  isError: boolean;
}
```

(b) `getRuns`(L70–93)的 push 块改为(读取新字段;`as any` 规避 Prisma 类型尚未 regenerate 的边缘情况,实际 Step Task 1 已 generate):

```ts
    const runs: RunPair[] = [];
    for (let i = 0; i < messages.length - 1; i++) {
      const userRow = messages[i] as {
        role: string;
        content: string;
        id: string;
        langGraphId: string | null;
        createdAt: Date;
      };
      const assistantRow = messages[i + 1] as {
        role: string;
        content: string;
        activities?: unknown;
        isError?: boolean;
      };
      if (userRow.role === 'user' && assistantRow.role === 'assistant') {
        runs.push({
          userContent: userRow.content,
          assistantContent: assistantRow.content,
          createdAt: userRow.createdAt,
          activities: assistantRow.activities ?? null,
          userMessageId: userRow.id,
          langGraphId: userRow.langGraphId,
          isError: assistantRow.isError ?? false,
        });
        i++; // consume the assistant message too
      }
    }
    return runs;
```

- [ ] **Step 4: 跑测试,确认通过**

Run: `cd server && pnpm test -- sessions.service.spec.ts`
Expected: PASS(getRuns + 错误轮次透传全绿)。

- [ ] **Step 5: Commit**

```sh
git add server/src/agentos/sessions.service.ts server/src/agentos/sessions.service.spec.ts
git commit -m "feat(sessions): RunPair/getRuns 透传 userMessageId/langGraphId/isError"
```

---

### Task 4: Controller — runAgent 持久化重构 + RunStarted 扩字段

**Files:**
- Modify: `server/src/agentos/agentos.controller.ts`(imports、`runAgent` L141–238)
- Modify: `server/src/agentos/agentos.controller.spec.ts`(mock + 两个持久化用例)

- [ ] **Step 1: 写失败测试 — 更新 mock + 持久化用例**

(a) 在 `agentos.controller.spec.ts` 的 `SessionsMock` 接口(L20–26)加新方法,替换为:

```ts
interface SessionsMock {
  resolveSession: jest.Mock;
  startTurn: jest.Mock;
  finishTurn: jest.Mock;
  getRecallTarget: jest.Mock;
  deleteMessages: jest.Mock;
  listSessions: jest.Mock;
  getRuns: jest.Mock;
  deleteSession: jest.Mock;
}
```

(b) `makeSessionsMock`(L41–59)替换 `appendTurn` 行,加入新 mock:

```ts
function makeSessionsMock(overrides: Partial<SessionsMock> = {}): SessionsMock {
  return {
    resolveSession:
      overrides.resolveSession ??
      jest.fn(() =>
        Promise.resolve({
          id: 'sess-1',
          userId: 'u1',
          name: 'n',
          createdAt: EPOCH,
          updatedAt: EPOCH,
        }),
      ),
    startTurn:
      overrides.startTurn ?? jest.fn(() => Promise.resolve('msg-turn-1')),
    finishTurn: overrides.finishTurn ?? jest.fn(() => Promise.resolve()),
    getRecallTarget:
      overrides.getRecallTarget ?? jest.fn(() => Promise.resolve(null)),
    deleteMessages:
      overrides.deleteMessages ?? jest.fn(() => Promise.resolve()),
    listSessions: overrides.listSessions ?? jest.fn(() => Promise.resolve([])),
    getRuns: overrides.getRuns ?? jest.fn(() => Promise.resolve([])),
    deleteSession: overrides.deleteSession ?? jest.fn(() => Promise.resolve()),
  };
}
```

(c) 把 "POST runs scopes resolve/append..." 用例(L125–164)里的 `appendTurn` 断言块(L156–163)替换为对 startTurn/finishTurn + RunStarted 字段的断言:

```ts
    // RunStarted 帧带 user_message_id / user_message_lang_id(供前端撤回回填)。
    expect(frames[0]).toEqual(
      expect.objectContaining({
        event: 'RunStarted',
        session_id: 'sess-1',
        user_message_id: 'msg-turn-1',
        user_message_lang_id: expect.any(String),
      }),
    );
    // 轮次开始即建 user 行(带 langGraphId);收尾写 assistant 行(isError=false)。
    expect(sessions.startTurn).toHaveBeenCalledWith(
      'u1',
      'sess-1',
      'hi',
      expect.any(String),
    );
    expect(sessions.finishTurn).toHaveBeenCalledWith(
      'u1',
      'sess-1',
      '::think{id="t1"}\n\nHello',
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      expect.objectContaining({ t1: expect.anything() }),
      false,
    );
```

(d) 把 "POST runs emits RunError and does NOT persist..." 用例(L279–298)的末尾断言(L297)替换 —— 现在错误时**仍持久化**(isError=true):

```ts
    const last = parseFrames(chunks).at(-1);
    expect(last?.event).toBe('RunError');
    expect(last?.content).toBe('boom');
    // 错误时仍 startTurn(已建)+ finishTurn(isError=true):错误轮次保留在历史。
    expect(sessions.startTurn).toHaveBeenCalledWith(
      'u1',
      'sess-1',
      'hi',
      expect.any(String),
    );
    expect(sessions.finishTurn).toHaveBeenCalledWith(
      'u1',
      'sess-1',
      'boom',
      {},
      true,
    );
```

- [ ] **Step 2: 跑测试,确认失败**

Run: `cd server && pnpm test -- agentos.controller.spec.ts`
Expected: FAIL(startTurn/finishTurn 未被调用 / RunStarted 无 user_message_id)。

- [ ] **Step 3: 实现 — 改 agentos.controller.ts**

(a) 顶部 import 区加 `randomUUID`(在现有 import 之后,L24 附近加):

```ts
import { randomUUID } from 'node:crypto';
```

(b) `runAgent` 里把 L141–238(从 `let sessionId = body?.session_id ?? '';` 到 `finally` 块结束)替换为:

```ts
    let sessionId = body?.session_id ?? '';
    let contentMarkdown = '';
    let activities: unknown = {};
    let completed = false;
    let turnId: string | null = null;
    let runError: Error | undefined;
    const userMsgId = randomUUID();
    try {
      const session = await this.sessions.resolveSession(
        user.id,
        body?.session_id,
        AGENT_ID,
        message,
      );
      sessionId = session.id;
      // 轮次开始即建 user 行(带 langGraphId):整轮失败也保留,且撤回有锚点。
      turnId = await this.sessions.startTurn(
        user.id,
        sessionId,
        message,
        userMsgId,
      );
      const { prompt, novelId } = await this.contextAssembler.forSession(
        user.id,
        session.id,
      );
      writeFrame({
        event: 'RunStarted',
        agent_id: AGENT_ID,
        session_id: sessionId,
        user_message_id: turnId,
        user_message_lang_id: userMsgId,
        created_at: now(),
      });

      // 活动帧汇:每个 ActivityEvent 即时写一帧 newline-JSON(不缓冲),同时收进
      // collected。流末 aggregate → { contentMarkdown, activitiesLookup };
      // contentMarkdown 含 ::think/tool/stage 标记(与 FE 流式构建同构),
      // 落 assistant message.content 供刷新时重建交错文档。
      const collected: ActivityEvent[] = [];
      const emit = (ev: ActivityEvent): void => {
        collected.push(ev);
        writeFrame({ event: ev.type, ...ev, created_at: now() });
      };

      if (novelId) {
        await this.deepAgent.runTurn({
          userId: user.id,
          novelId,
          threadId: sessionId,
          userMessage: message,
          userMessageId: userMsgId,
          systemPrompt: prompt,
          emit,
          signal: ac.signal,
          readingChapterOrder,
        });
      } else {
        // 防御:工作台 session 必有关联小说;查不到时给一条可读提示而非崩溃。
        const id = nextActId('content');
        const fallback = '（未找到关联的小说,请从书架进入一本小说后再对话。）';
        emit({ type: 'Act', id, act: 'content' });
        emit({ type: 'ActDelta', id, text: fallback });
        emit({ type: 'ActEnd', id, status: 'ok' });
      }

      const aggregated = aggregateActivities(collected);
      contentMarkdown = aggregated.contentMarkdown;
      activities = aggregated.activities;

      writeFrame({
        event: 'RunCompleted',
        content: contentMarkdown,
        created_at: now(),
      });
      completed = true;
    } catch (err) {
      // 记录完整错误(类型/message/stack/cause)—— RunError 帧只带 message,栈会丢。
      runError = err instanceof Error ? err : new Error(String(err));
      this.logger.error(
        runError,
        `[agentos] run stream failed (session ${sessionId})`,
      );
      writeFrame({
        event: 'RunError',
        content: runError.message,
        created_at: now(),
      });
    } finally {
      res.end();
      // 成败都持久化:错误轮次也进 messages 表(isError=true)供回显;DB 写失败
      // 不回滚已推送的流(best-effort)。模型可能只调工具 → contentMarkdown 为空 → 占位。
      if (turnId && message) {
        const reply = completed
          ? contentMarkdown.trim() || '（已写入章节正文）'
          : runError?.message ?? '本轮执行失败';
        try {
          await this.sessions.finishTurn(
            user.id,
            sessionId,
            reply,
            activities,
            !completed,
          );
        } catch (err) {
          this.logger.error(
            `[agentos] finishTurn failed for session ${sessionId}: ${
              err instanceof Error ? err.message : err
            }`,
          );
        }
      }
    }
```

- [ ] **Step 4: 跑测试,确认通过**

Run: `cd server && pnpm test -- agentos.controller.spec.ts`
Expected: PASS(含改后的两个持久化用例)。注:其余用例(resolveSession/runTurn 透传/AbortSignal)不受影响。

- [ ] **Step 5: Commit**

```sh
git add server/src/agentos/agentos.controller.ts server/src/agentos/agentos.controller.spec.ts
git commit -m "feat(agentos): 持久化重构 + RunStarted 带 user message id"
```

---

### Task 5: DeepAgentService — 抽 buildAgentGraph + runTurn 注入 userMessageId

**Files:**
- Modify: `server/src/agentos/deep-agent.service.ts`(runTurn 拆分 + 注入 id)

> 这是为 Task 12 `rewind` 复用同一 graph 句柄做的准备;本任务不引入新行为,runTurn 行为不变。

- [ ] **Step 1: 抽 buildAgentGraph —— 把 runTurn 的 agent 构造段抽成私有方法**

在 `deep-agent.service.ts` 中:

(a) 把 `runTurn` 里 L185–373(从 `const agent = createAgent({` 到 `.withConfig({ recursionLimit: 10_000 }) as unknown as { ... }`)整段剪切。

(b) 在 `runTurn` 原位置改为调用新方法:

```ts
    const agent = await this.buildAgentGraph({
      userId,
      novelId,
      readingChapterOrder,
      writerPrompt,
      model,
      settlerModel,
      validatorModel,
    });
```

(c) 新增私有方法(放在 `runTurn` 之后、`writerTools` 之前),内容就是被剪切的构造段,但参数化。签名 + 体:

```ts
  /**
   * 构造 main agent 的 compiled graph(主 agent + chapter/writer/settler/validator
   * + curator 子树 + summarization/patch 中间件 + checkpointer)。runTurn 用于 stream,
   * rewind 用于 getState/updateState(不调 LLM)。抽出来让两者共用同一 graph 句柄,
   * 保证 messages channel 与 checkpointer 一致。
   */
  private async buildAgentGraph(args: {
    userId: string;
    novelId: string;
    readingChapterOrder: number | null;
    writerPrompt: string;
    model: unknown;
    settlerModel: unknown;
    validatorModel: unknown;
  }): Promise<{
    stream: (
      input: { messages: Array<{ role: string; content: string; id?: string }> },
      options: {
        configurable: Record<string, unknown>;
        streamMode: string;
        signal?: AbortSignal;
      },
    ) => Promise<AsyncIterable<unknown>>;
    getState: (config: {
      configurable: Record<string, unknown>;
    }) => Promise<{ values: { messages?: Array<{ id?: string }> } }>;
    updateState: (
      config: { configurable: Record<string, unknown> },
      values: Record<string, unknown>,
    ) => Promise<unknown>;
  }> {
    const { userId, novelId, readingChapterOrder, writerPrompt, model, settlerModel, validatorModel } = args;
    const { createAgent } = await import('langchain');
    const {
      createSubAgentMiddleware,
      createSummarizationMiddleware,
      createPatchToolCallsMiddleware,
      createSubagentTransformer,
      StateBackend,
    } = await import('deepagents');

    const backend = new StateBackend();
    const subagentStack = () => [createPatchToolCallsMiddleware()] as never;

    // —— 以下为原 runTurn L185–373 的 createAgent({...}).withConfig(...) 构造,
    //    原样保留(model/settlerModel/validatorModel/writerPrompt/readingChapterOrder
    //    全部改用本方法入参;闭包注入的 userId/novelId 不变)。
    const agent = createAgent({
      model: model as never,
      systemPrompt: MAIN_AGENT_PROMPT,
      tools: [
        makeGetNovelInfoTool({ userId, novelId, novels: this.novels }) as never,
        makeUpdateNovelTool({ userId, novelId, novels: this.novels }) as never,
        makeGetReadingChapterTool({
          userId,
          novelId,
          readingChapterOrder,
          chapters: this.chapters,
        }) as never,
        makeSetVolumeTool({ userId, novelId, outlines: this.outlines }) as never,
        makeSetChapterPlanTool({ userId, novelId, outlines: this.outlines }) as never,
        makeGetOutlineTool({ userId, novelId, outlines: this.outlines }) as never,
        makeGetChapterPlanTool({ userId, novelId, outlines: this.outlines }) as never,
        makeSetWorldEntryTool({ userId, novelId, world: this.world }) as never,
        makeGetWorldviewTool({ userId, novelId, world: this.world }) as never,
        makeGetWorldEntryTool({ userId, novelId, world: this.world }) as never,
        makeSetCharacterTool({ userId, novelId, characters: this.characters }) as never,
        makeGetReferenceTool({ userId, novelId, references: this.references }) as never,
      ],
      middleware: [
        createSubAgentMiddleware({
          defaultModel: model as never,
          generalPurposeAgent: false,
          defaultMiddleware: subagentStack(),
          subagents: [
            {
              name: 'chapter',
              description:
                '写/改/续写/重写章节。作者要写/续写/重写第 N 章时委派;它会在聚焦上下文里跑完 writer → settler → validator(+修订) 全流程。',
              systemPrompt: CHAPTER_ORCHESTRATOR_PROMPT,
              model: model as never,
              tools: [
                makeSnapshotChapterTool({ userId, novelId, snapshots: this.snapshots }) as never,
                makeRestoreChapterTool({ userId, novelId, snapshots: this.snapshots }) as never,
              ],
              middleware: [
                createSubAgentMiddleware({
                  defaultModel: model as never,
                  generalPurposeAgent: false,
                  defaultMiddleware: subagentStack(),
                  subagents: [
                    {
                      name: 'writer',
                      description: '写/改/续写章节正文。',
                      systemPrompt: writerPrompt,
                      tools: this.writerTools(userId, novelId),
                    },
                    {
                      name: 'settler',
                      description: '结算章节(提取摘要/角色/伏笔)。',
                      systemPrompt: SETTLER_AGENT_PROMPT,
                      model: settlerModel as never,
                      tools: [
                        makeGetChapterTool({ userId, novelId, chapters: this.chapters }) as never,
                        makeWriteSummaryTool({
                          userId,
                          novelId,
                          chapters: this.chapters,
                          summaries: this.summaries,
                          events: this.events,
                          characters: this.characters,
                        }) as never,
                      ],
                    },
                    {
                      name: 'validator',
                      description: '校验章节一致性/质量。',
                      systemPrompt: VALIDATOR_AGENT_PROMPT,
                      model: validatorModel as never,
                      tools: [
                        makeGetChapterTool({ userId, novelId, chapters: this.chapters }) as never,
                        makeQueryMemoryTool({ userId, novelId, prisma: this.prisma }) as never,
                        makeReportReviewTool() as never,
                      ],
                    },
                  ],
                }) as never,
              ],
            },
            {
              name: 'curator',
              description:
                '搜索/提炼写作参考资料并固化为本小说专属参考。立项信息齐、需要建参考资料时委派。',
              systemPrompt: CURATOR_AGENT_PROMPT,
              tools: [
                makeListKnowledgeTool({ kb: this.knowledge }) as never,
                makeGetKnowledgeTool({ kb: this.knowledge }) as never,
                makeSetReferencesTool({ userId, novelId, references: this.references }) as never,
                makeGetReferenceTool({ userId, novelId, references: this.references }) as never,
              ],
            },
          ],
        }) as never,
        createSummarizationMiddleware({ backend }) as never,
        createPatchToolCallsMiddleware() as never,
      ],
      streamTransformers: [createSubagentTransformer([] as never)] as never,
      ...(this.checkpointer
        ? { checkpointer: this.checkpointer as never }
        : {}),
    }).withConfig({ recursionLimit: 10_000 }) as unknown as {
      stream: (
        input: { messages: Array<{ role: string; content: string; id?: string }> },
        options: {
          configurable: Record<string, unknown>;
          streamMode: string;
          signal?: AbortSignal;
        },
      ) => Promise<AsyncIterable<unknown>>;
      getState: (config: {
        configurable: Record<string, unknown>;
      }) => Promise<{ values: { messages?: Array<{ id?: string }> } }>;
      updateState: (
        config: { configurable: Record<string, unknown> },
        values: Record<string, unknown>,
      ) => Promise<unknown>;
    };
    return agent;
  }
```

> ⚠️ 剪切时**逐行核对**原 L185–373 的每个 tool/middleware,确保原样搬入 `buildAgentGraph`。任何遗漏会导致 graph 少工具。完成后 `runTurn` 里 `createAgent`/`deepagents` 的动态 import 若不再被 runTurn 直接用,可保留在 buildAgentGraph 里(runTurn 不再需要那两个 `await import`)。

- [ ] **Step 2: runTurn 注入 userMessageId**

(a) `runTurn` 的 `args` 类型(L108–117)加 `userMessageId`:

```ts
  async runTurn(args: {
    userId: string;
    novelId: string;
    threadId: string;
    userMessage: string;
    userMessageId: string;
    systemPrompt: string;
    emit: (ev: ActivityEvent) => void;
    signal?: AbortSignal;
    readingChapterOrder: number | null;
  }): Promise<void> {
```

(b) 解构(L118–127)加 `userMessageId`。

(c) `agent.stream` 调用(原 L375–378)注入 id:

```ts
    const stream = await agent.stream(
      { messages: [{ role: 'user', content: userMessage, id: userMessageId }] },
      { configurable: { thread_id: threadId }, streamMode: 'messages', signal },
    );
```

(d) 若 `runTurn` 不再直接用 `langchain`/`deepagents` import,删掉 runTurn 里那两个 `const { createAgent } = await import('langchain')` / `const { ... } = await import('deepagents')`(它们已搬进 buildAgentGraph)。但 `createActivityEmitter`、model 获取、refs 拼装仍在 runTurn。

- [ ] **Step 3: typecheck**

Run: `cd server && pnpm typecheck`
Expected: PASS(无 TS 错误)。

- [ ] **Step 4: 跑现有测试确保无回归**

Run: `cd server && pnpm test`
Expected: 全绿(deep-agent.service 无直接单测;controller spec 把 DeepAgentService 整体 mock,runTurn 签名加字段不影响 mock)。

- [ ] **Step 5: Commit**

```sh
git add server/src/agentos/deep-agent.service.ts
git commit -m "refactor(deep-agent): 抽 buildAgentGraph + runTurn 注入 userMessageId"
```

---

## Phase B — 功能①错误回显(客户端)

### Task 6: ChatMessage 加 id/langGraphId/isError

**Files:**
- Modify: `agent-ui/src/types/os.ts`(`ChatMessage` L220–238)

- [ ] **Step 1: 改 ChatMessage 接口**

把 `ChatMessage`(L220–238)改为(在 `content` 后插入三字段):

```ts
export interface ChatMessage {
  role: 'user' | 'agent' | 'system' | 'tool'
  content: string
  /** DB 行 id(撤回锚点;历史加载 + RunStarted 回填)。 */
  id?: string
  /** user 行对应的 langgraph message id(撤回定位 checkpoint)。 */
  langGraphId?: string
  /** 持久化的整轮失败标记(刷新后从历史加载;区别于瞬时 streamingError)。 */
  isError?: boolean
  streamingError?: boolean
  stopped?: boolean
  created_at: number
  tool_calls?: ToolCall[]
  activities?: ActivityMap
  extra_data?: {
    reasoning_steps?: ReasoningSteps[]
    reasoning_messages?: ReasoningMessage[]
    references?: ReferenceData[]
  }
  images?: ImageData[]
  videos?: VideoData[]
  audio?: AudioData[]
  response_audio?: ResponseAudio
  memory?: MemoryData
}
```

- [ ] **Step 2: typecheck**

Run: `cd agent-ui && pnpm typecheck`
Expected: PASS。

- [ ] **Step 3: Commit**

```sh
git add agent-ui/src/types/os.ts
git commit -m "feat(types): ChatMessage 加 id/langGraphId/isError"
```

---

### Task 7: Store — inputMessage + setChatInput

**Files:**
- Modify: `agent-ui/src/store.ts`(Store 接口 + 初始值 + login/logout reset)

- [ ] **Step 1: Store 接口加字段**

在 `store.ts` 的 `Store` interface,`messages`/`setMessages` 之后(L30 附近)加:

```ts
  inputMessage: string
  setChatInput: (inputMessage: string) => void
```

- [ ] **Step 2: 初始值 + setter**

在 `create<Store>()(...)` 的 state 工厂里,`messages`/`setMessages` 块之后(L99 附近)加:

```ts
      inputMessage: '',
      setChatInput: (inputMessage) => set(() => ({ inputMessage })),
```

- [ ] **Step 3: login/logout 重置 inputMessage**

在 `logout`(L107–124)和 `login`(L127–144)的 `set(() => ({ ... }))` 里各加一行 `inputMessage: '',`。

- [ ] **Step 4: typecheck**

Run: `cd agent-ui && pnpm typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```sh
git add agent-ui/src/store.ts
git commit -m "feat(store): inputMessage 提升进 store + setChatInput"
```

---

### Task 8: ChatInput 读 store 的 input

**Files:**
- Modify: `agent-ui/src/components/chat/ChatArea/ChatInput/ChatInput.tsx`

- [ ] **Step 1: 用 store 替换 local useState**

把 ChatInput.tsx 改为(删 `useState` import 与本地 state,改读 store):

```tsx
'use client'
import { toast } from 'sonner'
import { TextArea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { useStore } from '@/store'
import useAIChatStreamHandler from '@/hooks/useAIStreamHandler'
import { useQueryState } from 'nuqs'
import Icon from '@/components/ui/icon'

const ChatInput = () => {
  const { chatInputRef } = useStore()

  const { handleStreamResponse, stopStreaming } = useAIChatStreamHandler()
  const [selectedAgent] = useQueryState('agent')
  const [teamId] = useQueryState('team')
  const inputMessage = useStore((state) => state.inputMessage)
  const setInputMessage = useStore((state) => state.setChatInput)
  const isStreaming = useStore((state) => state.isStreaming)
  const handleSubmit = async () => {
    if (!inputMessage.trim()) return

    const currentMessage = inputMessage
    setInputMessage('')

    try {
      await handleStreamResponse(currentMessage)
    } catch (error) {
      toast.error(
        `Error in handleSubmit: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  return (
    <div className="relative mx-auto mb-1 flex w-full max-w-2xl items-end justify-center gap-x-2 font-geist">
      <TextArea
        placeholder={'Ask anything'}
        value={inputMessage}
        onChange={(e) => setInputMessage(e.target.value)}
        onKeyDown={(e) => {
          if (
            e.key === 'Enter' &&
            !e.nativeEvent.isComposing &&
            !e.shiftKey &&
            !isStreaming
          ) {
            e.preventDefault()
            handleSubmit()
          }
        }}
        className="w-full border border-accent bg-primaryAccent px-4 text-sm text-primary focus:border-accent"
        disabled={!(selectedAgent || teamId)}
        ref={chatInputRef}
      />
      {isStreaming ? (
        <Button
          onClick={stopStreaming}
          size="icon"
          className="rounded-xl bg-primary p-5 text-primaryAccent"
          title="停止生成"
        >
          <span className="relative flex h-5 w-5 items-center justify-center">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primaryAccent opacity-60" />
            <Icon type="square" color="primaryAccent" />
          </span>
        </Button>
      ) : (
        <Button
          onClick={handleSubmit}
          disabled={!(selectedAgent || teamId) || !inputMessage.trim()}
          size="icon"
          className="rounded-xl bg-primary p-5 text-primaryAccent"
        >
          <Icon type="send" color="primaryAccent" />
        </Button>
      )}
    </div>
  )
}

export default ChatInput
```

- [ ] **Step 2: typecheck**

Run: `cd agent-ui && pnpm typecheck`
Expected: PASS。

- [ ] **Step 3: Commit**

```sh
git add agent-ui/src/components/chat/ChatArea/ChatInput/ChatInput.tsx
git commit -m "refactor(chat-input): inputMessage 改读 store(为撤回回填铺路)"
```

---

### Task 9: useAIStreamHandler — RunStarted 回填 id + 删 slice(0,-2)

**Files:**
- Modify: `agent-ui/src/hooks/useAIStreamHandler.tsx`

- [ ] **Step 1: 删「下一轮自动 slice(0,-2) 掉错误对」块**

删除 L124–137 的整个 `setMessages((prevMessages) => { if (prevMessages.length >= 2) ... return prevMessages.slice(0, -2) ... })` 块(错误轮次现在保留在历史)。

- [ ] **Step 2: RunStarted 分支回填 user message 的 id**

在 RunStarted 分支(原 L199–225,`newSessionId = chunk.session_id ... setSessionsData(...)` 块)**末尾**(该分支闭合 `}` 之前)追加:把帧里的 `user_message_id` / `user_message_lang_id` 盖到末尾 user 消息上:

```ts
              // 回填本轮 user 消息的 DB id + langGraphId(撤回锚点)。
              const userMessageId = chunk.user_message_id as string | undefined
              const userMessageLangId = chunk.user_message_lang_id as
                | string
                | undefined
              if (userMessageId || userMessageLangId) {
                setMessages((prevMessages) => {
                  const newMessages = [...prevMessages]
                  const lastUser = [...newMessages]
                    .reverse()
                    .find((m) => m.role === 'user')
                  if (lastUser) {
                    if (userMessageId) lastUser.id = userMessageId
                    if (userMessageLangId) lastUser.langGraphId = userMessageLangId
                  }
                  return newMessages
                })
              }
```

- [ ] **Step 3: typecheck**

Run: `cd agent-ui && pnpm typecheck`
Expected: PASS(`chunk` 是 `RunResponse`,新字段未声明 —— 若 TS 报错,用 `(chunk as RunResponse & { user_message_id?: string; user_message_lang_id?: string })` 断言;`RunResponse` 是宽松 interface,索引未知字段通常不报错,先观察)。

- [ ] **Step 4: Commit**

```sh
git add agent-ui/src/hooks/useAIStreamHandler.tsx
git commit -m "feat(stream): RunStarted 回填 user message id + 不再自动删错误轮次"
```

---

### Task 10: 历史加载透传新字段(ChatPanel + useSessionLoader)

**Files:**
- Modify: `server/src/agentos/agentos.controller.ts`(`getSessionRuns` 返回类型 L72–87)
- Modify: `agent-ui/src/components/workspace/ChatPanel.tsx`(SessionRun + 映射 L19–23、L64–76)
- Modify: `agent-ui/src/hooks/useSessionLoader.tsx`(映射 L94–138)

- [ ] **Step 1: 服务端 getSessionRuns 返回新字段**

把 controller 的 `getSessionRuns`(L68–87)的 Promise 类型 + map 改为:

```ts
  @Get('sessions/:id/runs')
  async getSessionRuns(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
  ): Promise<
    Array<{
      run_input: string;
      content: string;
      activities: unknown;
      created_at: number;
      user_message_id: string;
      user_message_lang_id: string | null;
      is_error: boolean;
    }>
  > {
    const runs = await this.sessions.getRuns(user.id, id);
    return runs.map((r) => ({
      run_input: r.userContent,
      content: r.assistantContent,
      activities: r.activities,
      created_at: toUnix(r.createdAt),
      user_message_id: r.userMessageId,
      user_message_lang_id: r.langGraphId,
      is_error: r.isError,
    }));
  }
```

- [ ] **Step 2: ChatPanel 映射新字段**

把 ChatPanel.tsx 的 `SessionRun` 接口(L19–23)改为:

```ts
interface SessionRun {
  run_input: string
  content: string
  created_at: number
  user_message_id: string
  user_message_lang_id: string | null
  is_error: boolean
}
```

把 history 映射循环(L65–76)改为:

```ts
        for (const r of list) {
          history.push({
            role: 'user',
            content: r.run_input,
            id: r.user_message_id,
            langGraphId: r.user_message_lang_id ?? undefined,
            created_at: r.created_at
          })
          history.push({
            role: 'agent',
            content: r.content,
            isError: r.is_error,
            created_at: r.created_at + 1
          })
        }
```

- [ ] **Step 3: useSessionLoader 映射新字段(通用聊天路径)**

在 useSessionLoader.tsx 的 `messagesFor.flatMap` 里,user push(L95–100)与 agent push(L126–138)补字段。把 user push 改为:

```ts
                filteredMessages.push({
                  role: 'user',
                  content: run.run_input ?? '',
                  id: (run as { user_message_id?: string }).user_message_id,
                  langGraphId:
                    (run as { user_message_lang_id?: string | null })
                      .user_message_lang_id ?? undefined,
                  created_at: run.created_at
                })
```

把 agent push 的对象里加 `isError`:

```ts
                filteredMessages.push({
                  role: 'agent',
                  content: (run.content as string) ?? '',
                  isError: (run as { is_error?: boolean }).is_error ?? false,
                  activities:
                    (run.activities as ActivityMap | undefined) ?? undefined,
                  tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
                  extra_data: run.extra_data,
                  images: run.images,
                  videos: run.videos,
                  audio: run.audio,
                  response_audio: run.response_audio,
                  created_at: run.created_at
                })
```

- [ ] **Step 4: typecheck + lint**

Run: `cd server && pnpm typecheck && cd ../agent-ui && pnpm typecheck && pnpm lint:fix`
Expected: server 与 agent-ui 都 PASS。

- [ ] **Step 5: Commit**

```sh
git add server/src/agentos/agentos.controller.ts agent-ui/src/components/workspace/ChatPanel.tsx agent-ui/src/hooks/useSessionLoader.tsx
git commit -m "feat(history): 历史加载透传 user_message_id/langGraphId/is_error"
```

---

### Task 11: AgentMessage 错误渲染(isError 持久 vs streamingError 瞬时)

**Files:**
- Modify: `agent-ui/src/components/chat/ChatArea/Messages/MessageItem.tsx`(`AgentMessage` L17–30)

- [ ] **Step 1: 改 AgentMessage 错误分支**

把 `AgentMessage`(L17–30)的头几行改为(红字触发 = isError || streamingError;文案分两条路径):

```tsx
const AgentMessage = ({ message }: MessageProps) => {
  const { streamingErrorMessage } = useStore()
  let messageContent
  if (message.isError || message.streamingError) {
    // 持久错误(刷新后):文案在 content;瞬时错误(本轮流式态):文案在全局 streamingErrorMessage。
    const text = message.isError
      ? message.content
      : streamingErrorMessage || 'Please try refreshing the page or try again later.'
    messageContent = (
      <p className="text-destructive">
        Oops! Something went wrong. {text}
      </p>
    )
  } else if (message.content) {
```

(其余 `else if`/`else` 分支不变。)

- [ ] **Step 2: typecheck + lint**

Run: `cd agent-ui && pnpm typecheck && pnpm lint:fix`
Expected: PASS。

- [ ] **Step 3: 手测功能①(端到端)**

启动:`cd /Users/taowen/project/narratox && pnpm dev`(agent-ui :3000 / server :3001)。登录 → 进一本小说工作台 → **在 /settings 临时取消激活模型**(或删 key)→ 发一条消息:
- 预期:聊天区出现红色错误气泡(文案 = 后端报错,如 "尚未配置模型...")。
- 刷新页面 → 错误气泡**仍在**(持久化生效);用户原消息也在。
- DB 验证(可选):`psql $DATABASE_URL -c "select role, content, \"isError\" from \"Message\" order by \"createdAt\" desc limit 4;"` → 应看到 user 行 + assistant 行(isError=true)。
- 测完到 /settings 重新激活模型。

- [ ] **Step 4: Commit**

```sh
git add agent-ui/src/components/chat/ChatArea/Messages/MessageItem.tsx
git commit -m "feat(message): AgentMessage 区分持久 isError 与瞬时 streamingError 渲染"
```

---

## Phase C — 功能②撤回(真回退)

### Task 12: DeepAgentService — rewind(getState + updateState + RemoveMessage)

**Files:**
- Modify: `server/src/agentos/deep-agent.service.ts`(import + 新 rewind 方法)

- [ ] **Step 1: import RemoveMessage**

在 `deep-agent.service.ts` 顶部 import 区(L6 附近,`agent-prompts` import 之前/之后均可)加:

```ts
import { RemoveMessage } from '@langchain/core/messages';
```

- [ ] **Step 2: 加 rewind 方法**

在 `runTurn` 之后、`buildAgentGraph` 之前(或 `writerTools` 之前任意位置)加:

```ts
  /**
   * 真回退:把 thread state 里从「锚点 user 消息」起到末尾的消息全部 RemoveMessage 删除,
   * 写一个「已删除」的新 checkpoint —— 下轮 runTurn 加载它时 agent 不再看到被撤回内容。
   * 不调 LLM(仅 state 操作);锚点已被摘要压缩(findIndex<0)或无活动模型配置 → 跳过,
   * 只删 DB 行(由调用方负责),记日志。best-effort:抛错由调用方兜底(仍删 DB 行)。
   */
  async rewind(
    userId: string,
    novelId: string,
    threadId: string,
    langGraphId: string,
  ): Promise<void> {
    // 复用 runTurn 的 graph 构造(同一 checkpointer + messages channel)。rewind 不调 LLM,
    // 但 createAgent 需要 model —— 读活动配置;无配置则跳过(调用方仍删 DB 行,降级为「仅 UI 撤回」)。
    const activeConfig = await this.modelConfigs.getActive(userId);
    if (!activeConfig) {
      this.logger.warn(
        `rewind: 无活动模型配置,跳过 checkpoint 回退(thread ${threadId}),仅删 DB 行`,
      );
      return;
    }
    const config: ModelConfigRecord = {
      id: activeConfig.id,
      provider: activeConfig.provider,
      model: activeConfig.model,
      baseUrl: activeConfig.baseUrl,
      apiKey: activeConfig.apiKey,
      temperature: activeConfig.temperature,
    };
    const model = await this.getModel(config);
    const settlerModel = await this.getModel(config, 6_000);
    const validatorModel = await this.getModel(config, 6_000);
    const agent = await this.buildAgentGraph({
      userId,
      novelId,
      readingChapterOrder: null,
      writerPrompt: WRITER_AGENT_PROMPT,
      model,
      settlerModel,
      validatorModel,
    });

    const state = await agent.getState({ configurable: { thread_id: threadId } });
    const messages = state.values.messages ?? [];
    const idx = messages.findIndex((m) => m.id === langGraphId);
    if (idx < 0) {
      // 锚点已被 summarization 压缩 → state 里已无该消息 → 跳过(摘要可能残留语义,已知限制)。
      this.logger.warn(
        `rewind: 锚点 ${langGraphId} 不在当前 state(可能已压缩),跳过 checkpoint 回退`,
      );
      return;
    }
    // 只 Remove 当前 state 里确实存在的 id(删不存在的 id 会抛错)。
    const removes = messages
      .slice(idx)
      .filter((m) => typeof m.id === 'string')
      .map((m) => new RemoveMessage({ id: m.id as string }));
    if (removes.length === 0) return;
    await agent.updateState(
      { configurable: { thread_id: threadId } },
      { messages: removes },
    );
    this.logger.log(
      `rewind: 已从 thread ${threadId} 删除 ${removes.length} 条消息(锚点 ${langGraphId})`,
    );
  }
```

> `WRITER_AGENT_PROMPT` 已在文件顶部 import(L9),`ModelConfigRecord`/`getModel` 同类内可见。

- [ ] **Step 3: typecheck**

Run: `cd server && pnpm typecheck`
Expected: PASS。

- [ ] **Step 4: 跑全测确保无回归**

Run: `cd server && pnpm test`
Expected: 全绿(rewind 无单测,集成验证在 Task 18)。

- [ ] **Step 5: Commit**

```sh
git add server/src/agentos/deep-agent.service.ts
git commit -m "feat(deep-agent): rewind 用 RemoveMessage 真回退 thread state"
```

---

### Task 13: SessionsService — getRecallTarget + deleteMessages

**Files:**
- Modify: `server/src/agentos/sessions.service.ts`(新增两方法)
- Test: `server/src/agentos/sessions.service.spec.ts`(PrismaMock 加 message.findFirst/deleteMany + 新 describe)

- [ ] **Step 1: 写失败测试**

(a) 在 `sessions.service.spec.ts` 的 `PrismaMock.message`(L23–26)加 `findFirst` + `deleteMany`:

```ts
  message: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
    create: jest.Mock;
    deleteMany: jest.Mock;
  };
```

`makePrismaMock`(L39–43)对应加:

```ts
    message: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
```

(b) 在文件末尾 `describe('deleteSession', ...)` 之后(L352 后、最外层 `});` 前)加新 describe:

```ts
  describe('getRecallTarget', () => {
    it('returns null when the session is not owned', async () => {
      const prisma = makePrismaMock();
      prisma.session.findFirst.mockResolvedValue(null);
      const service = makeService(prisma);

      const result = await service.getRecallTarget('u1', 'sX', 'm1');

      expect(result).toBeNull();
      expect(prisma.message.findFirst).not.toHaveBeenCalled();
    });

    it('returns null when the anchor user message is not found', async () => {
      const prisma = makePrismaMock();
      prisma.session.findFirst.mockResolvedValue({
        id: 's1',
        userId: 'u1',
        novel: { id: 'nov-1' },
      });
      prisma.message.findFirst.mockResolvedValue(null);
      const service = makeService(prisma);

      const result = await service.getRecallTarget('u1', 's1', 'missing');

      expect(result).toBeNull();
    });

    it('returns recalled content, langGraphId, novelId + deleteIds for the anchor and all later rows', async () => {
      const prisma = makePrismaMock();
      prisma.session.findFirst.mockResolvedValue({
        id: 's1',
        userId: 'u1',
        novel: { id: 'nov-1' },
      });
      prisma.message.findFirst.mockResolvedValue({
        id: 'm2',
        role: 'user',
        content: 'second',
        langGraphId: 'lg2',
        createdAt: EPOCH,
      });
      prisma.message.findMany.mockResolvedValue([
        { id: 'm2', createdAt: EPOCH },
        { id: 'm3', createdAt: EPOCH },
      ]);
      const service = makeService(prisma);

      const result = await service.getRecallTarget('u1', 's1', 'm2');

      expect(prisma.message.findFirst).toHaveBeenCalledWith({
        where: { id: 'm2', sessionId: 's1', role: 'user' },
      });
      expect(prisma.message.findMany).toHaveBeenCalledWith({
        where: { sessionId: 's1', createdAt: { gte: EPOCH } },
        orderBy: { createdAt: 'asc' },
      });
      expect(result).toEqual({
        recalledContent: 'second',
        langGraphId: 'lg2',
        novelId: 'nov-1',
        deleteIds: ['m2', 'm3'],
      });
    });
  });

  describe('deleteMessages', () => {
    it('deleteMany by sessionId + ids', async () => {
      const prisma = makePrismaMock();
      const service = makeService(prisma);

      await service.deleteMessages('s1', ['m2', 'm3']);

      expect(prisma.message.deleteMany).toHaveBeenCalledWith({
        where: { sessionId: 's1', id: { in: ['m2', 'm3'] } },
      });
    });
  });
```

- [ ] **Step 2: 跑测试,确认失败**

Run: `cd server && pnpm test -- sessions.service.spec.ts`
Expected: FAIL(`getRecallTarget is not a function`)。

- [ ] **Step 3: 实现 — 在 SessionsService 加两方法**

在 `sessions.service.ts` 的 `deleteSession` 方法之前(或 `appendTurn`→`finishTurn` 之后)加:

```ts
  /**
   * 撤回读阶段(纯读):校验 ownership → 取锚点 user 行(id/role/content/langGraphId/
   * createdAt)→ 取该 session 内 createdAt >= 锚点的所有行(尾部截断范围)→ 取 session.novel
   * 的 id(rewind 需要 novelId 构造 graph)。不属于本用户 / 锚点不存在 → null。
   */
  async getRecallTarget(
    userId: string,
    sessionId: string,
    messageRowId: string,
  ): Promise<{
    recalledContent: string;
    langGraphId: string | null;
    novelId: string;
    deleteIds: string[];
  } | null> {
    const owned = await this.prisma.session.findFirst({
      where: { id: sessionId, userId },
      include: { novel: { select: { id: true } } },
    });
    if (!owned) return null;
    const anchor = await this.prisma.message.findFirst({
      where: { id: messageRowId, sessionId, role: 'user' },
    });
    if (!anchor) return null;
    const after = await this.prisma.message.findMany({
      where: { sessionId, createdAt: { gte: anchor.createdAt } },
      orderBy: { createdAt: 'asc' },
    });
    return {
      recalledContent: anchor.content,
      langGraphId: anchor.langGraphId,
      novelId: owned.novel?.id ?? '',
      deleteIds: after.map((m) => m.id),
    };
  }

  /** 撤回写阶段(纯写):删尾部截断范围内的消息行(scoped by sessionId)。 */
  async deleteMessages(sessionId: string, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.prisma.message.deleteMany({
      where: { sessionId, id: { in: ids } },
    });
  }
```

- [ ] **Step 4: 跑测试,确认通过**

Run: `cd server && pnpm test -- sessions.service.spec.ts`
Expected: PASS(getRecallTarget + deleteMessages 全绿)。

- [ ] **Step 5: Commit**

```sh
git add server/src/agentos/sessions.service.ts server/src/agentos/sessions.service.spec.ts
git commit -m "feat(sessions): getRecallTarget + deleteMessages(撤回读写阶段)"
```

---

### Task 14: Controller — POST sessions/:id/recall 路由

**Files:**
- Modify: `server/src/agentos/agentos.controller.ts`(import + 新方法)
- Test: `server/src/agentos/agentos.controller.spec.ts`(新用例)

- [ ] **Step 1: 写失败测试**

在 `agentos.controller.spec.ts` 末尾(L411 `});` 前)加:

```ts
  it('POST sessions/:id/recall orchestrates rewind + deleteMessages and returns recalled content', async () => {
    const sessions = makeSessionsMock({
      getRecallTarget: jest.fn(() =>
        Promise.resolve({
          recalledContent: 'hi',
          langGraphId: 'lg-1',
          novelId: 'nov-1',
          deleteIds: ['m1', 'm2'],
        }),
      ),
      deleteMessages: jest.fn(() => Promise.resolve()),
    });
    const rewindMock = jest.fn(() => Promise.resolve());
    const conversational = {
      runTurn: jest.fn(() => Promise.resolve()),
      rewind: rewindMock,
    } as unknown as DeepAgentService;
    const c = new AgentosController(
      conversational,
      sessions as unknown as SessionsService,
      {
        forSession: jest.fn(),
      } as unknown as ContextAssembler,
    );

    const result = await c.recall(USER, 'sess-1', { messageRowId: 'm1' });

    expect(sessions.getRecallTarget).toHaveBeenCalledWith('u1', 'sess-1', 'm1');
    // 有 langGraphId → 调 rewind(userId, novelId, threadId, langGraphId)。
    expect(rewindMock).toHaveBeenCalledWith('u1', 'nov-1', 'sess-1', 'lg-1');
    expect(sessions.deleteMessages).toHaveBeenCalledWith('sess-1', ['m1', 'm2']);
    expect(result).toEqual({ recalledContent: 'hi' });
  });

  it('POST sessions/:id/recall skips rewind but still deletes when langGraphId is null', async () => {
    const sessions = makeSessionsMock({
      getRecallTarget: jest.fn(() =>
        Promise.resolve({
          recalledContent: 'hi',
          langGraphId: null,
          novelId: 'nov-1',
          deleteIds: ['m1'],
        }),
      ),
      deleteMessages: jest.fn(() => Promise.resolve()),
    });
    const rewindMock = jest.fn(() => Promise.resolve());
    const conversational = {
      runTurn: jest.fn(() => Promise.resolve()),
      rewind: rewindMock,
    } as unknown as DeepAgentService;
    const c = new AgentosController(
      conversational,
      sessions as unknown as SessionsService,
      { forSession: jest.fn() } as unknown as ContextAssembler,
    );

    const result = await c.recall(USER, 'sess-1', { messageRowId: 'm1' });

    expect(rewindMock).not.toHaveBeenCalled();
    expect(sessions.deleteMessages).toHaveBeenCalledWith('sess-1', ['m1']);
    expect(result).toEqual({ recalledContent: 'hi' });
  });
```

- [ ] **Step 2: 跑测试,确认失败**

Run: `cd server && pnpm test -- agentos.controller.spec.ts`
Expected: FAIL(`c.recall is not a function`)。

- [ ] **Step 3: 实现 — 在 controller 加 recall 方法 + NotFoundException import**

(a) import 区顶部(L1–12 的 `@nestjs/common` import)加 `NotFoundException`(若未有):

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UseInterceptors,
} from '@nestjs/common';
```

(b) 在 `runAgent` 方法之后(类内)加:

```ts
  /**
   * 撤回用户消息(尾部截断 + 真回退):取锚点 →(有 langGraphId 时)rewind checkpoint →
   * 删尾部 DB 行。rewind 抛错不阻断删行(best-effort,降级为「仅 UI 撤回」)。
   */
  @Post('sessions/:id/recall')
  async recall(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() body: { messageRowId: string },
  ): Promise<{ recalledContent: string }> {
    const target = await this.sessions.getRecallTarget(user.id, id, body.messageRowId);
    if (!target) throw new NotFoundException();
    if (target.langGraphId) {
      try {
        await this.deepAgent.rewind(user.id, target.novelId, id, target.langGraphId);
      } catch (err) {
        // checkpoint 回退失败不阻断 DB 撤回;降级为「仅 UI/DB 撤回」。
        this.logger.error(
          `[agentos] rewind failed for session ${id}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }
    await this.sessions.deleteMessages(id, target.deleteIds);
    return { recalledContent: target.recalledContent };
  }
```

- [ ] **Step 4: 跑测试,确认通过**

Run: `cd server && pnpm test -- agentos.controller.spec.ts`
Expected: PASS(两个 recall 用例 + 全部既有用例)。

- [ ] **Step 5: Commit**

```sh
git add server/src/agentos/agentos.controller.ts server/src/agentos/agentos.controller.spec.ts
git commit -m "feat(agentos): POST sessions/:id/recall 撤回编排(rewind + deleteMessages)"
```

---

### Task 15: 客户端 API — RecallSession 路由 + recallSessionAPI

**Files:**
- Modify: `agent-ui/src/api/routes.ts`
- Modify: `agent-ui/src/api/os.ts`

- [ ] **Step 1: routes.ts 加 RecallSession**

在 `routes.ts` 的 `DeleteSession`(L8–9)之后加:

```ts
  RecallSession: (agentOSUrl: string, sessionId: string) =>
    `${agentOSUrl}/sessions/${sessionId}/recall`,
```

- [ ] **Step 2: os.ts 加 recallSessionAPI**

在 `os.ts` 的 `deleteSessionAPI`(L85–101)之后加:

```ts
export const recallSessionAPI = async (
  base: string,
  sessionId: string,
  messageRowId: string,
  authToken?: string
): Promise<{ recalledContent: string }> => {
  const response = await fetch(APIRoutes.RecallSession(base, sessionId), {
    method: 'POST',
    headers: createHeaders(authToken),
    body: JSON.stringify({ messageRowId })
  })

  if (!response.ok) {
    throw new Error(`Failed to recall: ${response.statusText}`)
  }

  return response.json()
}
```

- [ ] **Step 3: typecheck + lint**

Run: `cd agent-ui && pnpm typecheck && pnpm lint:fix`
Expected: PASS。

- [ ] **Step 4: Commit**

```sh
git add agent-ui/src/api/routes.ts agent-ui/src/api/os.ts
git commit -m "feat(api): RecallSession 路由 + recallSessionAPI"
```

---

### Task 16: useRecallMessage hook

**Files:**
- Create: `agent-ui/src/hooks/useRecallMessage.ts`

- [ ] **Step 1: 创建 hook**

新建 `agent-ui/src/hooks/useRecallMessage.ts`:

```ts
'use client'
import { useCallback } from 'react'
import { useQueryState } from 'nuqs'
import { toast } from 'sonner'

import { useStore } from '@/store'
import useChatActions from '@/hooks/useChatActions'
import { recallSessionAPI } from '@/api/os'
import { constructEndpointUrl } from '@/lib/constructEndpointUrl'

/**
 * 撤回一条用户消息(index = store.messages 里的下标,指向 role:'user')。
 * 流程:POST /sessions/:id/recall → 成功则切掉该消息及之后所有消息 + 回填输入框 + focus。
 * 旧消息(无 id)/ 流式中 → 不执行(toast 提示 / 调用方禁用)。
 */
const useRecallMessage = () => {
  const setMessages = useStore((s) => s.setMessages)
  const setChatInput = useStore((s) => s.setChatInput)
  const selectedEndpoint = useStore((s) => s.selectedEndpoint)
  const authToken = useStore((s) => s.authToken)
  const isStreaming = useStore((s) => s.isStreaming)
  const { focusChatInput } = useChatActions()
  const [sessionId] = useQueryState('session')

  const recall = useCallback(
    async (index: number) => {
      if (isStreaming) {
        toast.error('正在生成中,请稍后再撤回')
        return
      }
      const messages = useStore.getState().messages
      const userMsg = messages[index]
      if (!userMsg || userMsg.role !== 'user') return
      if (!userMsg.id) {
        toast.error('此消息为历史消息,暂不支持撤回')
        return
      }
      const recalledText = userMsg.content
      try {
        const endpoint = constructEndpointUrl(selectedEndpoint)
        await recallSessionAPI(endpoint, sessionId ?? '', userMsg.id, authToken)
        setMessages((prev) => prev.slice(0, index))
        setChatInput(recalledText)
        focusChatInput()
        toast.success('已撤回,内容已回到输入框')
      } catch (err) {
        toast.error(
          `撤回失败:${err instanceof Error ? err.message : String(err)}`
        )
      }
    },
    [
      isStreaming,
      selectedEndpoint,
      authToken,
      sessionId,
      setMessages,
      setChatInput,
      focusChatInput
    ]
  )

  return { recall, isStreaming }
}

export default useRecallMessage
```

- [ ] **Step 2: typecheck + lint**

Run: `cd agent-ui && pnpm typecheck && pnpm lint:fix`
Expected: PASS。

- [ ] **Step 3: Commit**

```sh
git add agent-ui/src/hooks/useRecallMessage.ts
git commit -m "feat(hook): useRecallMessage 撤回编排(API + 切数组 + 回填)"
```

---

### Task 17: UserMessage 撤回按钮 + Messages.tsw 确认弹窗

**Files:**
- Modify: `agent-ui/src/components/chat/ChatArea/Messages/MessageItem.tsx`(`UserMessage` + 新 `RecallConfirmDialog`)
- Modify: `agent-ui/src/components/chat/ChatArea/Messages/Messages.tsx`(接 onRecall + 单实例 Dialog)

- [ ] **Step 1: MessageItem.tsx — 改 UserMessage + 加 RecallConfirmDialog**

(a) 顶部 import 区加(lucide 图标 + Dialog + Button + useState):

```tsx
import { memo, useState } from 'react'
import { Undo2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import Tooltip from '@/components/ui/tooltip'
```

(把原 `import { memo } from 'react'` 合并进新 `useState` import;`Tooltip` 按需 —— 若 MessageItem 未引则加上。)

(b) `UserMessage`(L93–104)替换为(接收 `onRequestRecall` + `disabled`,右上角 hover 撤回图标):

```tsx
interface UserMessageProps {
  message: ChatMessage
  disabled?: boolean
  onRequestRecall?: () => void
}

const UserMessage = memo(
  ({ message, disabled, onRequestRecall }: UserMessageProps) => {
    const supported = !!message.id
    const clickable = supported && !disabled && !!onRequestRecall
    return (
      <div className="group relative flex items-start gap-4 pt-4 text-start max-md:break-words">
        <div className="flex-shrink-0">
          <Icon type="user" size="sm" />
        </div>
        <div className="text-md rounded-lg pr-7 font-geist text-secondary">
          {message.content}
        </div>
        {onRequestRecall && (
          <Tooltip
            delayDuration={0}
            content={
              <p className="text-accent">
                {supported ? '撤回' : '历史消息暂不支持撤回'}
              </p>
            }
            side="top"
          >
            <button
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onRequestRecall()}
              className="absolute right-0 top-4 opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-20 hover:!opacity-100"
            >
              <Undo2 className="h-4 w-4 text-muted hover:text-primary" />
            </button>
          </Tooltip>
        )}
      </div>
    )
  }
)
```

(c) 文件末尾(L108 `export` 之后)加 `RecallConfirmDialog`(单实例,由 Messages.tsx 持有 open 状态):

```tsx
interface RecallConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

const RecallConfirmDialog = ({
  open,
  onOpenChange,
  onConfirm
}: RecallConfirmDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>撤回此消息?</DialogTitle>
        <DialogDescription>
          该消息及其后的所有对话将被删除,内容会回到输入框。
        </DialogDescription>
      </DialogHeader>
      <DialogFooter className="gap-2">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          取消
        </Button>
        <Button
          variant="default"
          onClick={() => {
            onConfirm()
            onOpenChange(false)
          }}
        >
          确认撤回
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
)

export { AgentMessage, UserMessage, RecallConfirmDialog }
```

(把原 `export { AgentMessage, UserMessage }` 改为含 `RecallConfirmDialog`。)

- [ ] **Step 2: Messages.tsx — 接撤回按钮 + 单实例确认弹窗**

(a) 顶部 import 改:从 MessageItem 引入 `RecallConfirmDialog`,加 `useState`:

```tsx
import { AgentMessage, UserMessage, RecallConfirmDialog } from './MessageItem'
import { useState } from 'react'
import useRecallMessage from '@/hooks/useRecallMessage'
```

(b) `Messages`(L154–178)替换为:

```tsx
const Messages = ({ messages }: MessageListProps) => {
  const { recall, isStreaming } = useRecallMessage()
  const [recallIndex, setRecallIndex] = useState<number | null>(null)

  if (messages.length === 0) {
    return <ChatBlankState />
  }

  return (
    <>
      {messages.map((message, index) => {
        const key = `${message.role}-${message.created_at}-${index}`
        const isLastMessage = index === messages.length - 1

        if (message.role === 'agent') {
          return (
            <AgentMessageWrapper
              key={key}
              message={message}
              isLastMessage={isLastMessage}
            />
          )
        }
        return (
          <UserMessage
            key={key}
            message={message}
            disabled={isStreaming}
            onRequestRecall={() => setRecallIndex(index)}
          />
        )
      })}
      <RecallConfirmDialog
        open={recallIndex !== null}
        onOpenChange={(o) => !o && setRecallIndex(null)}
        onConfirm={() => {
          const idx = recallIndex
          if (idx !== null) void recall(idx)
        }}
      />
    </>
  )
}
```

- [ ] **Step 3: typecheck + lint**

Run: `cd agent-ui && pnpm typecheck && pnpm lint:fix`
Expected: PASS。注:若 lint 报 `react-hooks/exhaustive-deps`(recall 闭包),按需加 eslint-disable 注释(与既有代码风格一致)。

- [ ] **Step 4: 手测功能②(端到端,真回退验证)**

启动 `pnpm dev`,确保 /settings 已激活模型。进一本小说工作台:
1. 发「记住数字 42」→ 等 agent 回复。
2. 发「我刚才说的数字是?」→ agent 应回答 42(确认记忆生效)。
3. **hover 第 1 条用户消息(「记住数字 42」)→ 出现 ↩ 图标 → 点击 → 确认弹窗 → 确认。**
   - 预期:第 1 条 + 第 2 条及回复全消失;输入框回填「记住数字 42」。
4. 改输入为「我刚才说的数字是?(直接问,不带 42)」→ 发送 → agent **不应**知道 42(真回退生效);若仍答 42,检查 server 日志是否有 `rewind:` 行(`已从 thread ... 删除 N 条消息`)。
5. 刷新页面 → 撤回的两轮确实不在历史里。
6. 边界:hover 一条**历史消息**(若 DB 有 pre-feature 旧消息,无 id)→ 图标 disabled + tooltip「历史消息暂不支持撤回」。

- [ ] **Step 5: Commit**

```sh
git add agent-ui/src/components/chat/ChatArea/Messages/MessageItem.tsx agent-ui/src/components/chat/ChatArea/Messages/Messages.tsx
git commit -m "feat(message): 用户消息撤回按钮 + 二次确认弹窗"
```

---

## Phase D — 验证

### Task 18: 全量质量门 + 端到端回归

**Files:** 无(验证)

- [ ] **Step 1: server 全测 + typecheck + lint**

Run:
```sh
cd server && pnpm test && pnpm typecheck && pnpm lint
```
Expected: 全绿。

- [ ] **Step 2: agent-ui validate**

Run:
```sh
cd agent-ui && pnpm typecheck && pnpm lint && pnpm format
```
Expected: 全绿(format 是 `--check`,若有格式问题先 `pnpm format:fix`)。

- [ ] **Step 3: 端到端回归(两个功能一起)**

`pnpm dev`,激活模型,进小说工作台:
- **功能①**:关掉模型 key → 发消息 → 看红字错误 + 刷新仍在 + DB 有 isError=true 行 → 重新激活。
- **功能②**:发两轮 → 撤回第 1 轮 → 截断 + 回填 + agent 真遗忘(第 4 步验证)。
- **回归**:正常发消息、流式渲染、停止按钮、章节自动写入(write_chapter)、刷新历史恢复 —— 均正常(确认持久化重构未破坏正常流)。

- [ ] **Step 4: 更新 CLAUDE.md(若架构描述受影响)**

检查 [CLAUDE.md](CLAUDE.md) 的 Agentos / 数据模型段落:`Message` 现有 `isError`/`langGraphId`;持久化从 appendTurn 改为 startTurn/finishTurn;新增 recall 路由 + rewind。若有需要,补一行说明(非必须,视 CLAUDE.md 现状)。

- [ ] **Step 5: 最终 commit(若有 CLAUDE.md / 格式改动)**

```sh
git add -A
git commit -m "chore: 端到端回归通过 + 文档/格式收尾"
```

---

## 完成判据

- [ ] 整轮失败错误:聊天区红字回显 + 刷新后仍在 + DB 有 `isError=true` 行。
- [ ] 用户消息 hover 出现 ↩ 撤回图标;二次确认后该消息及之后所有轮次消失 + 文案回填输入框。
- [ ] 撤回后 agent 真遗忘被撤回内容(`rewind:` 日志 + 第 4 步验证)。
- [ ] 历史消息(无 id)撤回按钮 disabled + tooltip。
- [ ] 流式中撤回被禁用。
- [ ] server `pnpm test` + agent-ui `pnpm typecheck`/`pnpm lint` 全绿。
