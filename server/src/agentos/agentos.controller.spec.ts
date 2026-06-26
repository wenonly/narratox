import type { Request, Response } from 'express';
import { AgentosController } from './agentos.controller';
import type { ContextAssembler } from './context-assembler.service';
import type { SessionsService } from './sessions.service';
import type { DeepAgentService } from './deep-agent.service';
import type { ActivityEvent } from './activity.types';
import type { RequestUser } from '../auth/current-user.decorator';
import { AGENT_ID } from './agentos.constants';

const EPOCH = new Date('2026-01-01T00:00:00.000Z');
const USER: RequestUser = { id: 'u1', email: 'a@b.com' };

/** A parsed frame from the newline-JSON stream. event ∈ Run* | Act*. */
interface Frame {
  event: string;
  [k: string]: unknown;
}

/** Shape of the test double returned by makeSessionsMock — all jest mocks. */
interface SessionsMock {
  resolveSession: jest.Mock;
  startTurn: jest.Mock;
  finishTurn: jest.Mock;
  listSessions: jest.Mock;
  getRuns: jest.Mock;
  deleteSession: jest.Mock;
  getRecallTarget: jest.Mock;
  deleteMessages: jest.Mock;
}

function createFakeRes(): { res: Response; chunks: string[] } {
  const chunks: string[] = [];
  const res = {
    setHeader: () => {},
    write: (s: string) => {
      chunks.push(s);
      return true;
    },
    end: () => {},
  } as unknown as Response;
  return { res, chunks };
}

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
    startTurn: overrides.startTurn ?? jest.fn(() => Promise.resolve('msg-1')),
    finishTurn: overrides.finishTurn ?? jest.fn(() => Promise.resolve()),
    listSessions: overrides.listSessions ?? jest.fn(() => Promise.resolve([])),
    getRuns: overrides.getRuns ?? jest.fn(() => Promise.resolve([])),
    deleteSession: overrides.deleteSession ?? jest.fn(() => Promise.resolve()),
    getRecallTarget:
      overrides.getRecallTarget ?? jest.fn(() => Promise.resolve(null)),
    deleteMessages:
      overrides.deleteMessages ?? jest.fn(() => Promise.resolve()),
  };
}

/**
 * Build a controller with the 3-dep constructor (conversational, sessions,
 * contextAssembler). `runTurnImpl` drives the mock conversational agent: it
 * receives (emit, args) and emits activity events (default: think + content
 * "Hello"). Return value/throw controls success/error paths.
 */
function buildController(
  runTurnImpl?: (emit: (ev: ActivityEvent) => void) => Promise<void>,
  sessions: SessionsMock = makeSessionsMock(),
  systemPrompt = 'PROMPT',
  novelId = 'novel-1',
): {
  controller: AgentosController;
  sessions: SessionsMock;
  conversational: { runTurn: jest.Mock };
} {
  const conversational = {
    runTurn: jest.fn((args: { emit: (ev: ActivityEvent) => void }) => {
      const { emit } = args;
      if (runTurnImpl) return runTurnImpl(emit);
      emit({ type: 'Act', id: 't1', act: 'think', label: '思考' });
      emit({ type: 'ActDelta', id: 't1', text: '想' });
      emit({ type: 'Act', id: 'c1', act: 'content' });
      emit({ type: 'ActDelta', id: 'c1', text: 'Hello' });
      return Promise.resolve();
    }),
  } as unknown as DeepAgentService;
  const fakeAssembler = {
    forSession: jest.fn().mockResolvedValue({ prompt: systemPrompt, novelId }),
  } as unknown as ContextAssembler;
  return {
    controller: new AgentosController(
      conversational,
      sessions as unknown as SessionsService,
      fakeAssembler,
    ),
    sessions,
    conversational: conversational as unknown as { runTurn: jest.Mock },
  };
}

function parseFrames(chunks: string[]): Frame[] {
  return chunks
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => JSON.parse(c) as Frame);
}

describe('AgentosController', () => {
  it('GET /health returns empty object', () => {
    const { controller } = buildController();
    expect(controller.health()).toEqual({});
  });

  it('does NOT expose /agents or /teams endpoints', () => {
    const { controller } = buildController();
    const probe = controller as unknown as {
      agents?: unknown;
      teams?: unknown;
    };
    expect(probe.agents).toBeUndefined();
    expect(probe.teams).toBeUndefined();
  });

  it('POST runs scopes resolve/startTurn/finishTurn by user, streams flat activity frames, persists the turn', async () => {
    const { controller, sessions } = buildController();
    const { res, chunks } = createFakeRes();

    await controller.runAgent(
      USER,
      'deep-agent',
      { message: 'hi', session_id: 'sess-1' },
      res,
    );

    expect(sessions.resolveSession).toHaveBeenCalledWith(
      'u1',
      'sess-1',
      AGENT_ID,
      'hi',
    );
    // startTurn 在轮次开始时即写 user 行(langGraphId = 本轮随机 UUID 供撤回定位)。
    expect(sessions.startTurn).toHaveBeenCalledWith(
      'u1',
      'sess-1',
      'hi',
      expect.any(String),
    );
    const frames = parseFrames(chunks);
    // RunStarted 帧带 user_message_id(DB 行 id, mock 返回 'msg-1')+ user_message_lang_id(本轮 UUID)。
    expect(frames[0]).toEqual(
      expect.objectContaining({
        event: 'RunStarted',
        session_id: 'sess-1',
        user_message_id: 'msg-1',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        user_message_lang_id: expect.any(String),
      }),
    );
    // RunStarted 包头 / 扁平活动帧 / RunCompleted 包尾。
    expect(frames.map((f) => f.event)).toEqual([
      'RunStarted',
      'Act',
      'ActDelta',
      'Act',
      'ActDelta',
      'RunCompleted',
    ]);
    expect(frames[0].session_id).toBe('sess-1');
    // RunCompleted.content 由 controller 聚合得到:think 条目插 ::think{id="t1"} 标记,
    // content 正文 'Hello' 拼在后(标记语法与 FE 流式构建同构)。
    expect(frames.at(-1)?.content).toBe('::think{id="t1"}\n\nHello');
    // finishTurn 在流末写 assistant 行,成功时 isError=false,activities 是聚合结果。
    expect(sessions.finishTurn).toHaveBeenCalledWith(
      'u1',
      'sess-1',
      '::think{id="t1"}\n\nHello',
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      expect.objectContaining({ t1: expect.anything() }),
      false,
    );
  });

  it('POST runAgent resolves a per-session system prompt + novelId and passes them to the conversational agent', async () => {
    const assemblerMock = {
      forSession: jest
        .fn()
        .mockResolvedValue({ prompt: 'PROMPT', novelId: 'novel-xyz' }),
    } as unknown as ContextAssembler;
    const sessions = makeSessionsMock();
    const runTurnMock = jest.fn(
      (args: { emit: (ev: ActivityEvent) => void }) => {
        args.emit({ type: 'Act', id: 'c', act: 'content' });
        args.emit({ type: 'ActDelta', id: 'c', text: 'ok' });
        return Promise.resolve();
      },
    );
    const conversational = {
      runTurn: runTurnMock,
    } as unknown as DeepAgentService;
    const c = new AgentosController(
      conversational,
      sessions as unknown as SessionsService,
      assemblerMock,
    );
    const { res } = createFakeRes();

    await c.runAgent(
      USER,
      'deep-agent',
      { message: 'hi', session_id: 'sess-1' },
      res,
    );

    // novelId 必须从 assembler 穿到会话 agent(防越权 / 让工具按 order 定位章节)。
    // body 不带 readingChapterOrder → parseReadingChapterOrder(undefined) → null。
    expect(runTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        novelId: 'novel-xyz',
        threadId: 'sess-1',
        systemPrompt: 'PROMPT',
        readingChapterOrder: null,
      }),
    );
    expect(sessions.resolveSession).toHaveBeenCalled();
  });

  it('POST runAgent threads readingChapterOrder (string → number) into runTurn', async () => {
    const assemblerMock = {
      forSession: jest
        .fn()
        .mockResolvedValue({ prompt: 'PROMPT', novelId: 'novel-xyz' }),
    } as unknown as ContextAssembler;
    const sessions = makeSessionsMock();
    const runTurnMock = jest.fn(
      (args: { emit: (ev: ActivityEvent) => void }) => {
        args.emit({ type: 'Act', id: 'c', act: 'content' });
        args.emit({ type: 'ActDelta', id: 'c', text: 'ok' });
        return Promise.resolve();
      },
    );
    const conversational = {
      runTurn: runTurnMock,
    } as unknown as DeepAgentService;
    const c = new AgentosController(
      conversational,
      sessions as unknown as SessionsService,
      assemblerMock,
    );
    const { res } = createFakeRes();

    await c.runAgent(
      USER,
      'deep-agent',
      { message: 'hi', session_id: 'sess-1', readingChapterOrder: '3' },
      res,
    );

    // body 的 string '3' 经 parseReadingChapterOrder 解析成 number 3,透传进 runTurn。
    expect(runTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        novelId: 'novel-xyz',
        threadId: 'sess-1',
        readingChapterOrder: 3,
      }),
    );
  });

  it('POST runs creates a session when session_id is absent', async () => {
    const sessions = makeSessionsMock({
      resolveSession: jest.fn(() =>
        Promise.resolve({
          id: 'fresh',
          userId: 'u1',
          name: 'hi',
          createdAt: EPOCH,
          updatedAt: EPOCH,
        }),
      ),
    });
    const { controller } = buildController(undefined, sessions);
    const { res, chunks } = createFakeRes();

    await controller.runAgent(USER, 'deep-agent', { message: 'hi' }, res);

    expect(sessions.resolveSession).toHaveBeenCalledWith(
      'u1',
      undefined,
      AGENT_ID,
      'hi',
    );
    expect(parseFrames(chunks)[0].session_id).toBe('fresh');
  });

  it('POST runs emits RunError and still persists the turn (isError=true) when the agent throws', async () => {
    const sessions = makeSessionsMock();
    const { controller } = buildController(
      () => Promise.reject(new Error('boom')),
      sessions,
    );
    const { res, chunks } = createFakeRes();

    await controller.runAgent(
      USER,
      'deep-agent',
      { message: 'hi', session_id: 'sess-1' },
      res,
    );

    const last = parseFrames(chunks).at(-1);
    expect(last?.event).toBe('RunError');
    expect(last?.content).toBe('boom');
    // startTurn 仍在轮次开始时落 user 行(整轮失败也保留)。
    expect(sessions.startTurn).toHaveBeenCalledWith(
      'u1',
      'sess-1',
      'hi',
      expect.any(String),
    );
    // finishTurn 以 isError=true 落错误文案 assistant 行(供 UI 显示错误气泡)。
    // activities 保持初始 {}(出错未跑聚合,无活动可落)。
    expect(sessions.finishTurn).toHaveBeenCalledWith(
      'u1',
      'sess-1',
      'boom',
      {},
      true,
    );
  });

  it('GET /sessions maps rows to the UI shape and scopes by user', async () => {
    const sessions = makeSessionsMock({
      listSessions: jest.fn(() =>
        Promise.resolve([
          { id: 's1', name: 'First', createdAt: EPOCH, updatedAt: EPOCH },
        ]),
      ),
    });
    const { controller } = buildController(undefined, sessions);

    const result = await controller.listSessions(USER);

    expect(sessions.listSessions).toHaveBeenCalledWith('u1', AGENT_ID);
    expect(result).toEqual({
      data: [
        {
          session_id: 's1',
          session_name: 'First',
          created_at: 1767225600,
          updated_at: 1767225600,
        },
      ],
    });
  });

  it('GET /sessions/:id/runs maps run pairs and scopes by user', async () => {
    const sessions = makeSessionsMock({
      getRuns: jest.fn(() =>
        Promise.resolve([
          {
            userContent: 'hi',
            assistantContent: 'hello',
            createdAt: EPOCH,
            activities: { t1: { act: 'think', label: '思考' } },
            userMessageId: 'm1',
            langGraphId: 'lg1',
            isError: false,
          },
        ]),
      ),
    });
    const { controller } = buildController(undefined, sessions);

    const result = await controller.getSessionRuns(USER, 's1');

    expect(sessions.getRuns).toHaveBeenCalledWith('u1', 's1');
    expect(result).toEqual([
      {
        run_input: 'hi',
        content: 'hello',
        activities: { t1: { act: 'think', label: '思考' } },
        created_at: 1767225600,
        user_message_id: 'm1',
        user_message_lang_id: 'lg1',
        is_error: false,
      },
    ]);
  });

  it('DELETE /sessions/:id removes the session and returns {ok:true}, scoped by user', async () => {
    const sessions = makeSessionsMock({
      deleteSession: jest.fn(() => Promise.resolve()),
    });
    const { controller } = buildController(undefined, sessions);

    const result = await controller.deleteSession(USER, 's1');

    expect(sessions.deleteSession).toHaveBeenCalledWith('u1', 's1');
    expect(result).toEqual({ ok: true });
  });

  it('POST runs passes an AbortSignal to runTurn and aborts it when the client disconnects', async () => {
    const sessions = makeSessionsMock();
    let capturedSignal: AbortSignal | undefined;
    const runTurnMock = jest.fn(
      (args: { emit: (ev: ActivityEvent) => void; signal?: AbortSignal }) => {
        capturedSignal = args.signal;
        args.emit({ type: 'Act', id: 'c', act: 'content' });
        args.emit({ type: 'ActDelta', id: 'c', text: 'ok' });
        return Promise.resolve();
      },
    );
    const conversational = {
      runTurn: runTurnMock,
    } as unknown as DeepAgentService;
    const assemblerMock = {
      forSession: jest.fn().mockResolvedValue({ prompt: 'P', novelId: 'n-1' }),
    } as unknown as ContextAssembler;
    const c = new AgentosController(
      conversational,
      sessions as unknown as SessionsService,
      assemblerMock,
    );
    const { res } = createFakeRes();

    const closeHandlers: Array<() => void> = [];
    const req = {
      on: (event: string, cb: () => void) => {
        if (event === 'close') closeHandlers.push(cb);
      },
    } as unknown as Request;

    await c.runAgent(
      USER,
      'deep-agent',
      { message: 'hi', session_id: 'sess-1' },
      res,
      req,
    );

    // runTurn 必须收到一个未中止的 signal(供 LangGraph 透传给模型/工具)。
    expect(capturedSignal).toBeInstanceOf(AbortSignal);
    expect(capturedSignal?.aborted).toBe(false);

    // 客户端断开 → signal 被 abort → LangGraph stream 真正停掉。
    closeHandlers[0]?.();
    expect(capturedSignal?.aborted).toBe(true);
  });

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
    expect(rewindMock).toHaveBeenCalledWith('u1', 'nov-1', 'sess-1', 'lg-1');
    expect(sessions.deleteMessages).toHaveBeenCalledWith('sess-1', [
      'm1',
      'm2',
    ]);
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
});
