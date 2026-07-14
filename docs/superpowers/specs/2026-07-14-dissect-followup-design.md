# 拆解完成后继续对话:命令栏微调

## Context

拆解完成后(`status: DONE`),用户可能发现:
- 某个维度拆得不够好(如 PLOT 遗漏了关键转折)→ 想让 agent 重写
- 某章漏拆或新拆一章 → 想让 agent 补拆
- 素材重复或错误 → 想让 agent 删除/修改

目前 `POST /:id/dissect` 只能从头跑一遍全流程(切章 + 7 维度 + 审核),没有「只改一处」的能力。`write_benchmark` 是纯创建(`prisma.benchmarkEntry.create`),没有 update/delete,微调只会产生重复条目。

**方案:命令栏 + update/delete 工具(Approach A)**。在拆解结果弹窗底部加一条命令输入栏;用户发指令 → 后端 `continueDissect` 用现有 `runStreamPhase` 跑一轮 → 流化活动帧 → 前端实时展示 + 完成后刷新 entries。无状态:每条命令独立,不持久化对话历史(checkpointer 独立 thread_id)。

## 为什么不复杂

- `runStreamPhase(agent, message, threadId, emitter, signal)` 是现成的「发一条消息 + 流化」方法,continueDissect 直接复用。
- `buildDissectGraph` 加一个 `mode` 参数,followup 模式给 subagents 多注入 2 个工具(update_benchmark / delete_benchmark)——其余不变。
- HTTP 路由复用现有 emitter 流化模式(`POST /:id/dissect` 的 stream helper 抽公共函数)。
- 前端命令栏 = 一个 input + button + 活动面板,复用已有 `BenchmarkStreamEvent` / `ActivityEvent` 类型和 newline-JSON 解析。
- 不改 DISSECT_TREE 结构、不改 prompt、不改 Prisma schema、不改切章/维度/审核的驱动循环。

## 改动清单

### 1. 后端:2 个新工具

#### `server/src/agentos/tools/update-benchmark.tool.ts`(新建)

仿 `write-benchmark.tool.ts` 模式,闭包注入 `{ bookId, benchmark }`。

```ts
export const makeUpdateBenchmarkTool = (d: WriteBenchmarkDeps) =>
  tool(
    async ({ entryId, title, content }) => {
      await d.benchmark.updateEntry(d.bookId, entryId, { title, content });
      return { ok: true };
    },
    {
      name: 'update_benchmark',
      description: '修改一条已有的拆解条目(标题/内容)。entryId 从 get_dissect_entries 取。',
      schema: z.object({
        entryId: z.string().describe('要修改的 BenchmarkEntry id'),
        title: z.string().optional().describe('新标题(不传则不改)'),
        content: z.string().optional().describe('新内容(不传则不改)'),
      }),
    },
  );
```

- 只改 title/content——不改 type/bookId/chapterNo/kind/purposes(这些是结构属性,改了等于换条目)。
- title/content 至少传一个(前端 zod refine)。

#### `server/src/agentos/tools/delete-benchmark.tool.ts`(新建)

```ts
export const makeDeleteBenchmarkTool = (d: WriteBenchmarkDeps) =>
  tool(
    async ({ entryId }) => {
      await d.benchmark.deleteEntry(d.bookId, entryId);
      return { ok: true };
    },
    {
      name: 'delete_benchmark',
      description: '删除一条拆解条目(如重复素材、错误条目)。entryId 从 get_dissect_entries 取。',
      schema: z.object({
        entryId: z.string().describe('要删除的 BenchmarkEntry id'),
      }),
    },
  );
```

#### `server/src/agentos/agent-registry.ts`

`TOOL_REGISTRY` 加两项:

```ts
update_benchmark: (d) => makeUpdateBenchmarkTool({ userId: d.userId, bookId: d.bookId!, benchmark: d.benchmark! }),
delete_benchmark: (d) => makeDeleteBenchmarkTool({ userId: d.userId, bookId: d.bookId!, benchmark: d.benchmark! }),
```

### 2. 后端:BenchmarkService 加 2 个方法

`server/src/benchmark/benchmark.service.ts` 末尾加:

```ts
/** 修改条目内容/标题。updateMany + bookId 防跨书(id 是 PK 保证唯一,bookId 是额外过滤)。 */
async updateEntry(bookId: string, entryId: string, opts: { title?: string; content?: string }) {
  const result = await this.prisma.benchmarkEntry.updateMany({
    where: { id: entryId, bookId },
    data: {
      ...(opts.title != null ? { title: opts.title } : {}),
      ...(opts.content != null ? { content: opts.content } : {}),
    },
  });
  if (result.count === 0) throw new NotFoundException('条目不存在');
  return this.prisma.benchmarkEntry.findUniqueOrThrow({ where: { id: entryId } });
}

/** 删除条目。deleteMany + bookId 防跨书。 */
async deleteEntry(bookId: string, entryId: string) {
  const result = await this.prisma.benchmarkEntry.deleteMany({
    where: { id: entryId, bookId },
  });
  if (result.count === 0) throw new NotFoundException('条目不存在');
}
```

用 `updateMany`/`deleteMany` 而非 `update`/`delete`——Prisma 的 `update.where` 只接受 unique scalar(`id`),不接受 `{ id, bookId }` 复合 where。`updateMany.where` 接受任意过滤,`id` 保证最多命中一行,`bookId` 是额外的跨书安全网(closure 注入的 bookId 是可信的,这是 defense-in-depth)。

### 3. 后端:DissectAgentService.continueDissect

`server/src/agentos/dissect-agent.service.ts` 加方法。与 `startDissect` 共享 `buildDissectGraph` + `runStreamPhase`,区别:

1. 不跑分阶段驱动循环(Phase 1/2/3)——只跑一条用户消息。
2. `buildDissectGraph({ ..., mode: 'followup' })` → subagents 多注入 `update_benchmark` + `delete_benchmark`。
3. 状态:`DONE` → `RUNNING` → `DONE`(失败也回 `DONE`,不回 `FAILED`,因为初始拆解结果仍然有效)。
4. thread_id 用 `dissect-${bookId}-followup-${Date.now()}`,保证每次独立。

```ts
async continueDissect(userId: string, bookId: string, message: string): Promise<void> {
  const activeConfig = await this.modelConfigs.getActive(userId);
  if (!activeConfig) throw new Error('尚未配置模型');
  // ... 解析 config + overrideMap(同 startDissect)

  const book = await this.prisma.benchmarkBook.findUniqueOrThrow({ where: { id: bookId } });
  if (book.userId !== userId) throw new Error('无权限');
  if (book.status === 'RUNNING') throw new Error('正在拆解中,请等待完成');

  const emitter = new EventEmitter();
  const abortController = new AbortController();
  this.jobs.set(bookId, { emitter, abortController });

  await this.prisma.benchmarkBook.update({
    where: { id: bookId },
    data: { status: 'RUNNING' },
  });

  (async () => {
    try {
      const agent = await this.buildDissectGraph({
        userId, bookId,
        systemPrompt: prompt,
        activeConfig: config,
        overrideMap,
        mode: 'followup',   // ← 新参
      });
      await this.runStreamPhase(
        agent,
        message,
        `dissect-${bookId}-followup-${Date.now()}`,
        emitter,
        abortController.signal,
      );
    } catch (err) {
      this.logger.error(`continueDissect ${bookId}: ${err}`);
    } finally {
      // 无论成败都回 DONE(初始拆解结果仍有效)
      await this.prisma.benchmarkBook.update({
        where: { id: bookId },
        data: { status: 'DONE' },
      });
      emitter.emit('done');
      this.jobs.delete(bookId);
    }
  })();
}
```

### 4. 后端:buildDissectGraph 加 mode 参数

`buildDissectGraph` 签名加 `mode?: 'initial' | 'followup'`(默认 `'initial'`)。

followup 模式:在 `buildNode` 里,如果 spec.tools 包含 `write_benchmark`,则追加 `update_benchmark` + `delete_benchmark`:

```ts
const resolveTools = (keys: string[]) => {
  const result = [...keys];
  if (mode === 'followup' && keys.includes('write_benchmark')) {
    result.push('update_benchmark', 'delete_benchmark');
  }
  return result.map((k) => TOOL_REGISTRY[k](deps) as never);
};
```

这保证:
- 初始拆解:只有 `write_benchmark`(纯创建),agent 不会误改已有条目。
- 微调:有全部三个工具,agent 能读(get_dissect_entries)+ 改(update)+ 删(delete)+ 补(write)。

main agent 的 `DISSECT_TREE.tools = []`(无直接工具,委派 task)——不需要改,subagents 会带上新工具。

### 5. 后端:HTTP 路由

`server/src/benchmark/benchmark.controller.ts` 加一条路由:

```ts
@Post(':id/dissect/message')
async dissectMessage(
  @CurrentUser() user: RequestUser,
  @Param('id') id: string,
  @Body('message') message: string,
  @Res() res: Response,
  @Req() req: Request,
): Promise<void> {
  // 流化逻辑与 dissect 路由相同——抽公共 attachJobStream helper
  res.setHeader('Content-Type', 'application/json');
  const writeFrame = ...; // 同 dissect 路由

  const book = await this.benchmarks.get(user.id, id);
  if (book.status === 'RUNNING') {
    writeFrame({ event: 'RunError', content: '该任务正在拆解中' });
    res.end();
    return;
  }

  await this.dissectService.continueDissect(user.id, id, message);
  const job = this.dissectService.getJob(id);

  // 流化(与 dissect 路由的 heartbeat + onActivity + cleanup 完全一致)
  writeFrame({ event: 'RunStarted', book_id: id, created_at: Date.now() });
  // ... heartbeat / onActivity / cleanup
}
```

**重构:抽 `attachJobStream` 公共函数。** `dissect`、`stream`、`dissectMessage` 三个路由共享 ~15 行流化代码(heartbeat + onActivity + cleanup)。抽成 controller 私有方法:

```ts
private attachJobStream(
  res: Response,
  req: Request,
  job: DissectJob | undefined,
  writeFrame: (p: Record<string, unknown>) => void,
) {
  const heartbeat = setInterval(() => writeFrame({ event: 'Heartbeat' }), 15_000);
  const onActivity = (ev: unknown) => writeFrame({ event: 'activity', activity: ev });
  job?.emitter.on('activity', onActivity);
  const cleanup = () => {
    clearInterval(heartbeat);
    job?.emitter.off('activity', onActivity);
    if (!res.writableEnded) {
      writeFrame({ event: 'RunCompleted', created_at: Date.now() });
      res.end();
    }
  };
  job?.emitter.once('done', cleanup);
  req.on('close', cleanup);
}
```

三个路由都调 `this.attachJobStream(res, req, job, writeFrame)`。

### 6. 前端:API 层

`agent-ui/src/api/routes.ts` 加:

```ts
BenchmarkDissectMessage: (base: string, id: string) =>
  `${apiBase(base)}/benchmarks/${id}/dissect/message`,
```

`agent-ui/src/api/benchmark.ts` 加:

```ts
export const dissectMessageStream = (
  base: string,
  token: string,
  id: string,
  message: string,
): Promise<Response> =>
  fetch(APIRoutes.BenchmarkDissectMessage(base, id), {
    method: 'POST',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
```

### 7. 前端:ResultBrowser 加命令栏

`agent-ui/src/components/dissect/DissectPage.tsx` 的 `ResultBrowser` 组件(约 824-973 行):

#### 7a. 状态

```tsx
const [followupMsg, setFollowupMsg] = useState('')
const [followupRunning, setFollowupRunning] = useState(false)
const [rows, setRows] = useState<LogRow[]>([])  // 复用 LogDrawer 的 LogRow 类型
const actTextRef = useRef<Map<string, string>>(new Map())
const seenIdsRef = useRef<Set<string>>(new Set())
```

#### 7b. 发送命令

```tsx
const sendFollowup = useCallback(async () => {
  const msg = followupMsg.trim();
  if (!msg || followupRunning) return;
  setFollowupMsg('');
  setFollowupRunning(true);
  setRows([]);  // 清空上一轮活动

  try {
    const res = await dissectMessageStream(base, token, book!.id, msg);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop()!;
      for (const line of lines) {
        if (!line.trim()) continue;
        const frame = JSON.parse(line) as BenchmarkStreamEvent;
        // 复用 LogDrawer 的 handleFrame/handleActivity 逻辑:
        // RunStarted/RunCompleted/RunError → 状态行
        // activity → Act/ActDelta/ActTool/ActResult/ActEnd 聚合到 rows
        handleFrame(frame);  // 抽自 LogDrawer 或 inline 精简版
        if (frame.event === 'RunCompleted') {
          // 完成后刷新 entries
          const updated = await getBenchmark(base, token, book!.id);
          onBookChange(updated);
        }
      }
    }
  } catch (err) {
    toast.error(err instanceof Error ? err.message : '发送失败');
  } finally {
    setFollowupRunning(false);
  }
}, [followupMsg, followupRunning, base, token, book, onBookChange]);
```

活动帧处理逻辑复用 `LogDrawer` 组件的 `handleActivity`(约 519-560 行)——`Act` 建行、`ActDelta` 追加文本、`ActTool/ActResult/ActEnd` 补细节。followup 命令栏只需一个精简版(同样的 `rows: LogRow[]` + `actTextRef` + `seenIdsRef` 模式),不必抽公共函数——直接 inline 在 ResultBrowser 的 `sendFollowup` 回调里,或抽一个 `useFollowupStream` hook(实现时决定)。

#### 7c. UI 结构

在 `</div>`(Body div,约 970 行)之后、`</DialogContent>` 之前加:

```tsx
{/* Command bar */}
<div className="border-t border-overlay-10 px-6 py-3">
  {followupRunning && (
    <FollowupActivityPanel rows={rows} />
  )}
  <div className="flex items-center gap-3">
    <Sparkles className="size-4 shrink-0 text-accent-primary" />
    <input
      className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none"
      placeholder="给拆解 agent 发指令…  如:补拆第 30 章 / 重写 PLOT / 删除重复素材"
      value={followupMsg}
      onChange={(e) => setFollowupMsg(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendFollowup()}
      disabled={followupRunning}
    />
    <button
      onClick={sendFollowup}
      disabled={followupRunning || !followupMsg.trim()}
      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent-primary to-accent-violet text-text-primary disabled:opacity-40"
    >
      <ArrowUp className="size-4" />
    </button>
  </div>
</div>
```

#### 7d. FollowupActivityPanel 子组件

展示 agent 执行进度(think/tool/content),内联在 DissectPage.tsx:

```tsx
function FollowupActivityPanel({ rows }: { rows: LogRow[] }) {
  return (
    <div className="mb-3 max-h-48 space-y-1 overflow-y-auto rounded-md bg-overlay-5 p-3">
      {rows.map((r) => (
        <FollowupRow key={r.id} row={r} />
      ))}
    </div>
  );
}
```

`FollowupRow` 渲染单条 LogRow——think(灰底斜体)/ tool(蓝点 + label)/ content(正常文本)/ stage(淡色)。与 LogDrawer 的行渲染风格一致,精简版(不展示 timestamp/label tag,只展示内容)。

### 8. 边界情况

| 场景 | 处理 |
|------|------|
| 用户在 RUNNING 中发命令 | 后端 `RunError` 帧拒绝(`status === 'RUNNING'` → 立即回错误) |
| 前端发命令时弹窗关闭 | React 组件 unmount,fetch reader 中断,后端 emitter 继续(客户端断不停 agent);重新打开弹窗时 `GET /:id/stream` 断线重连 |
| agent 执行失败 | 后端 catch → 状态回 DONE(不回 FAILED);emitter emit 'done' → 前端 RunCompleted;toast 提示 |
| agent 超时 | recursionLimit=500 兜底;agent 完不成时 emitter 不会 emit 'done',前端靠 Heartbeat 判断存活(15s 一次) |
| 用户刷新页面 | job 在内存(jobs map),后端进程没死则继续;刷新后打开弹窗,`GET /:id/stream` 重连 |
| message 为空 | 前端 button disabled;后端 zod 校验 `@Body('message')` 非空 |
| 跨书攻击 | `continueDissect` 校验 `book.userId === userId`;`updateEntry`/`deleteEntry` 的 where 带 bookId |

## 不改的东西

- **Prisma schema**:不加字段、不加 enum、不改表结构。
- **DISSECT_TREE 结构**:不改 subagents 列表、不改依赖关系、不改 promptKey。
- **Prompt**:不改任何 .md prompt 文件。dissect-main.md 已有「每次收到一条用户消息,只做消息要求的事」的交互式编排语义——followup 消息天然契合。
- **驱动循环**:不改 Phase 1/2/3 分阶段逻辑,continueDissect 是独立路径。
- **初始拆解工具**:followup 模式不影响 initial 模式(mode 默认 'initial'),初始拆解仍然只有 write_benchmark。

## Pencil 设计

### 空闲态 — Frame `iPc92`("11b Dissect Result v2 — 章节")

Dialog `yz7ZI`(1160×760)子节点顺序:Head → TabStrip → Body → **CommandBar**(最底部)。

- CommandBar(`VvERH`):`fill_container` 宽,52px 高,水平布局,sparkles 图标($accent-primary) + placeholder 文本 + 渐变发送按钮($accent-primary → $accent-violet)。
- Body(`bUzmy`):`fill_container` 高(CommandBar 在 Body 之后,不会被挤掉)。

### 执行态 — Frame `GapTF`("11d CommandBar States Mockup")

独立 mockup 展示执行态(不嵌入 Dialog,避免 Pencil 5-child flex 布局 bug):

- **ActivityLog**(`nHxbt`):活动日志面板,4 行示例:
  - think 行(brain 图标 + 灰色斜体"分析指令…")
  - tool 行(蓝点 + `get_dissect_entries { type: 'PLOT' }`,monospace)
  - tool 行(绿点 + `update_benchmark { entryId: 'plot-001' }`)
  - result 行(紫点 + "✓ 已更新 2 条 PLOT 条目")
- **RunningCommandBar**(`j2fRtW`):loader-circle 图标($accent-primary,旋转动画) + "拆解中… agent 正在处理你的指令"($text-secondary) + 红色 StopBtn($bg-card 底 + #ef4444 边框 + square 图标)。

前端实现参照此布局:命令栏始终在底部;执行态时 ActivityLog 在命令栏上方展开(参见 spec 7c 节 `FollowupActivityPanel`)。

## 验证

1. **类型检查**:`cd server && pnpm typecheck` + `cd agent-ui && pnpm typecheck`
2. **单元测试**:`cd server && pnpm test`(现有测试不应回归)
3. **手动验证**:
   - 上传短书 → `POST /:id/dissect` → 等完成
   - 打开拆解结果 → 底部命令栏可见
   - 输入「重写 PLOT,补充第 20 章的伏笔」→ 点发送
   - 活动面板显示 agent think/tool/content 帧
   - 完成后 PLOT 条目内容更新(不是新增重复条目)
   - 输入「删除最后一个素材」→ 素材 tab 少一条
   - 输入「补拆第 30 章」→ CHAPTER tab 多一条
   - RUNNING 中再次输入 → 被拒(RunError)
