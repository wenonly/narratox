import type { Response } from 'express';
import { AgentosController } from './agentos.controller';
import type { ContextAssembler } from './context-assembler.service';
import type { SessionsService } from './sessions.service';
import type { AgentosFrame } from './stream-adapter';
import type { WorkspaceSwarmService } from './workspace-swarm.service';
import type { RequestUser } from '../auth/current-user.decorator';
import { AGENT_ID } from './agentos.constants';

const EPOCH = new Date('2026-01-01T00:00:00.000Z');
const USER: RequestUser = { id: 'u1', email: 'a@b.com' };

/**
 * Build an AsyncIterable<string> from a list of chunks WITHOUT using
 * `async function*` — the test doubles never await (the real streamTurn does),
 * so an async generator would trip @typescript-eslint/require-await purely to
 * satisfy the AsyncIterable<string> type contract. A hand-rolled async iterator
 * keeps the same runtime behavior (for await...of yields each chunk in order)
 * with no superfluous async marker.
 */
function asyncFromChunks<T>(chunks: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next(): Promise<IteratorResult<T>> {
          if (i < chunks.length) {
            return Promise.resolve({ value: chunks[i++], done: false });
          }
          return Promise.resolve({
            value: undefined as unknown as T,
            done: true,
          });
        },
      };
    },
  };
}

/** An AsyncIterable that rejects on first iteration (simulates a stream error). */
function asyncThrow(err: Error): AsyncIterable<string> {
  return {
    [Symbol.asyncIterator]() {
      let thrown = false;
      return {
        next(): Promise<IteratorResult<string>> {
          if (!thrown) {
            thrown = true;
            return Promise.reject(err);
          }
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  };
}

/** Shape of the test double returned by makeSessionsMock — all jest mocks. */
interface SessionsMock {
  resolveSession: jest.Mock;
  appendTurn: jest.Mock;
  listSessions: jest.Mock;
  getRuns: jest.Mock;
  deleteSession: jest.Mock;
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
    appendTurn: overrides.appendTurn ?? jest.fn(() => Promise.resolve()),
    listSessions: overrides.listSessions ?? jest.fn(() => Promise.resolve([])),
    getRuns: overrides.getRuns ?? jest.fn(() => Promise.resolve([])),
    deleteSession: overrides.deleteSession ?? jest.fn(() => Promise.resolve()),
  };
}

/**
 * Build a controller with the post-cleanup 3-dep constructor
 * (workspace, sessions, contextAssembler). The creation branch is gone, so
 * buildController no longer takes or wires a fakeCreation double.
 */
function buildController(
  deltas: (m: string) => AsyncIterable<string>,
  sessions: SessionsMock = makeSessionsMock(),
  systemPrompt = 'PROMPT',
): { controller: AgentosController; sessions: SessionsMock } {
  const fakeWorkspace = {
    streamTurn: ({
      userMessage,
    }: {
      userId: string;
      novelId: string;
      threadId: string;
      userMessage: string;
      systemPrompt: string;
    }) => deltas(userMessage),
  } as unknown as WorkspaceSwarmService;
  const fakeAssembler = {
    forSession: jest
      .fn()
      .mockResolvedValue({ prompt: systemPrompt, novelId: 'novel-1' }),
  } as unknown as ContextAssembler;
  return {
    controller: new AgentosController(
      fakeWorkspace,
      sessions as unknown as SessionsService,
      fakeAssembler,
    ),
    sessions,
  };
}

function parseFrames(chunks: string[]): AgentosFrame[] {
  return chunks
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => JSON.parse(c) as AgentosFrame);
}

describe('AgentosController', () => {
  it('GET /health returns empty object', () => {
    const { controller } = buildController(() => asyncFromChunks([]));
    expect(controller.health()).toEqual({});
  });

  it('does NOT expose /agents or /teams endpoints', () => {
    const { controller } = buildController(() => asyncFromChunks([]));
    const probe = controller as unknown as {
      agents?: unknown;
      teams?: unknown;
    };
    expect(probe.agents).toBeUndefined();
    expect(probe.teams).toBeUndefined();
  });

  it('POST runs scopes resolve/append by user, streams frames, persists the turn', async () => {
    const { controller, sessions } = buildController(() =>
      asyncFromChunks(['He', 'llo']),
    );
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
    const frames = parseFrames(chunks);
    expect(frames.map((f) => f.event)).toEqual([
      'RunStarted',
      'RunContent',
      'RunContent',
      'RunCompleted',
    ]);
    expect(frames[0].session_id).toBe('sess-1');
    expect(frames.at(-1)?.content).toBe('Hello');
    expect(sessions.appendTurn).toHaveBeenCalledWith(
      'u1',
      'sess-1',
      'hi',
      'Hello',
    );
  });

  it('POST runAgent resolves a per-session system prompt + novelId and passes them to streamTurn', async () => {
    const workspaceMock = {
      streamTurn: jest.fn(() => asyncFromChunks(['ok'])),
    } as unknown as WorkspaceSwarmService;
    const assemblerMock = {
      forSession: jest
        .fn()
        .mockResolvedValue({ prompt: 'PROMPT', novelId: 'novel-xyz' }),
    } as unknown as ContextAssembler;
    const sessions = makeSessionsMock();
    const c = new AgentosController(
      workspaceMock,
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

    // Route assertions through the controller's private fields (the existing
    // pattern in this file) so jest.Matchers stay bound to their object —
    // avoids @typescript-eslint/unbound-method on `mock.method` references.
    const internals = c as unknown as {
      contextAssembler: { forSession: jest.Mock };
      workspace: { streamTurn: jest.Mock };
    };
    expect(internals.contextAssembler.forSession).toHaveBeenCalledWith(
      'u1',
      'sess-1',
    );
    expect(sessions.resolveSession).toHaveBeenCalled();
    // novelId must be threaded from the assembler through to the swarm so the
    // writer can resolve chapterOrder → cuid (regression guard for the silent
    // no-op bug where the writer guessed chapterId="1").
    expect(internals.workspace.streamTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        novelId: 'novel-xyz',
        threadId: 'sess-1',
        systemPrompt: 'PROMPT',
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
    const { controller } = buildController(
      () => asyncFromChunks(['ok']),
      sessions,
    );
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

  it('POST runs emits RunError and does NOT persist when the service throws', async () => {
    const sessions = makeSessionsMock();
    const { controller } = buildController(
      () => asyncThrow(new Error('boom')),
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
    expect(sessions.appendTurn).not.toHaveBeenCalled();
  });

  it('GET /sessions maps rows to the UI shape and scopes by user', async () => {
    const sessions = makeSessionsMock({
      listSessions: jest.fn(() =>
        Promise.resolve([
          { id: 's1', name: 'First', createdAt: EPOCH, updatedAt: EPOCH },
        ]),
      ),
    });
    const { controller } = buildController(() => asyncFromChunks([]), sessions);

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
          },
        ]),
      ),
    });
    const { controller } = buildController(() => asyncFromChunks([]), sessions);

    const result = await controller.getSessionRuns(USER, 's1');

    expect(sessions.getRuns).toHaveBeenCalledWith('u1', 's1');
    expect(result).toEqual([
      { run_input: 'hi', content: 'hello', created_at: 1767225600 },
    ]);
  });

  it('DELETE /sessions/:id removes the session and returns {ok:true}, scoped by user', async () => {
    const sessions = makeSessionsMock({
      deleteSession: jest.fn(() => Promise.resolve()),
    });
    const { controller } = buildController(() => asyncFromChunks([]), sessions);

    const result = await controller.deleteSession(USER, 's1');

    expect(sessions.deleteSession).toHaveBeenCalledWith('u1', 's1');
    expect(result).toEqual({ ok: true });
  });
});
