import type { Response } from 'express';
import { AgentosController } from './agentos.controller';
import type { DeepAgentService } from './deep-agent.service';
import type { SessionsService } from './sessions.service';
import { StreamAdapter, type AgentosFrame } from './stream-adapter';

const EPOCH = new Date('2026-01-01T00:00:00.000Z');

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

function makeSessionsMock(
  overrides: Partial<{
    resolveSession: jest.Mock;
    appendTurn: jest.Mock;
    listSessions: jest.Mock;
    getRuns: jest.Mock;
    deleteSession: jest.Mock;
  }> = {},
) {
  return {
    resolveSession:
      overrides.resolveSession ??
      jest.fn(async () => ({ id: 'sess-1', name: 'n', createdAt: EPOCH, updatedAt: EPOCH })),
    appendTurn: overrides.appendTurn ?? jest.fn(async () => undefined),
    listSessions: overrides.listSessions ?? jest.fn(async () => []),
    getRuns: overrides.getRuns ?? jest.fn(async () => []),
    deleteSession: overrides.deleteSession ?? jest.fn(async () => undefined),
  } as unknown as SessionsService;
}

function buildController(
  deltas: (m: string) => AsyncIterable<string>,
  sessions: SessionsService = makeSessionsMock(),
): AgentosController {
  const fakeService = {
    streamTurn: ({ userMessage }: { threadId: string; userMessage: string }) =>
      deltas(userMessage),
  } as unknown as DeepAgentService;
  return new AgentosController(fakeService, new StreamAdapter(), sessions);
}

function parseFrames(chunks: string[]): AgentosFrame[] {
  return chunks
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => JSON.parse(c)) as AgentosFrame[];
}

describe('AgentosController', () => {
  it('GET /health returns empty object', () => {
    const controller = buildController(async function* () {});
    expect(controller.health()).toEqual({});
  });

  it('GET /agents returns one agent with id/name/db_id', () => {
    const controller = buildController(async function* () {});
    const agents = controller.agents();
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({ id: 'deep-agent', name: 'Deep Agent', db_id: 'default' });
  });

  it('POST runs respects incoming session_id, streams frames, persists the turn', async () => {
    const sessions = makeSessionsMock();
    const controller = buildController(async function* () {
      yield 'He';
      yield 'llo';
    }, sessions);
    const { res, chunks } = createFakeRes();

    await controller.runAgent('deep-agent', { message: 'hi', session_id: 'sess-1' }, res);

    expect(sessions.resolveSession).toHaveBeenCalledWith('sess-1', 'deep-agent', 'hi');
    const frames = parseFrames(chunks);
    expect(frames[0].event).toBe('RunStarted');
    expect(frames[0].session_id).toBe('sess-1'); // resolved id flows back to the UI
    expect(frames.map((f) => f.event)).toEqual([
      'RunStarted',
      'RunContent',
      'RunContent',
      'RunCompleted',
    ]);
    expect(frames[frames.length - 1].content).toBe('Hello');
    expect(sessions.appendTurn).toHaveBeenCalledWith('sess-1', 'hi', 'Hello');
  });

  it('POST runs creates a session when session_id is absent', async () => {
    const sessions = makeSessionsMock({
      resolveSession: jest.fn(async () => ({ id: 'fresh', name: 'hi', createdAt: EPOCH, updatedAt: EPOCH })),
    });
    const controller = buildController(async function* () {
      yield 'ok';
    }, sessions);
    const { res, chunks } = createFakeRes();

    await controller.runAgent('deep-agent', { message: 'hi' }, res);

    expect(sessions.resolveSession).toHaveBeenCalledWith(undefined, 'deep-agent', 'hi');
    expect(parseFrames(chunks)[0].session_id).toBe('fresh');
  });

  it('POST runs emits RunError and does NOT persist when the service throws', async () => {
    const sessions = makeSessionsMock();
    const controller = buildController(async function* () {
      throw new Error('boom');
    }, sessions);
    const { res, chunks } = createFakeRes();

    await controller.runAgent('deep-agent', { message: 'hi', session_id: 'sess-1' }, res);

    const last = parseFrames(chunks).at(-1);
    expect(last?.event).toBe('RunError');
    expect(last?.content).toBe('boom');
    expect(sessions.appendTurn).not.toHaveBeenCalled();
  });

  it('GET /sessions maps rows to the UI SessionEntry shape (unix seconds)', async () => {
    const sessions = makeSessionsMock({
      listSessions: jest.fn(async () => [
        { id: 's1', name: 'First', createdAt: EPOCH, updatedAt: EPOCH },
      ]),
    });
    const controller = buildController(async function* () {}, sessions);

    const result = await controller.listSessions();

    expect(sessions.listSessions).toHaveBeenCalledWith('deep-agent');
    expect(result).toEqual({
      data: [{ session_id: 's1', session_name: 'First', created_at: 1767225600, updated_at: 1767225600 }],
    });
  });

  it('GET /sessions/:id/runs maps run pairs to {run_input, content, created_at}', async () => {
    const sessions = makeSessionsMock({
      getRuns: jest.fn(async () => [
        { userContent: 'hi', assistantContent: 'hello', createdAt: EPOCH },
      ]),
    });
    const controller = buildController(async function* () {}, sessions);

    const result = await controller.getSessionRuns('s1');

    expect(sessions.getRuns).toHaveBeenCalledWith('s1');
    expect(result).toEqual([{ run_input: 'hi', content: 'hello', created_at: 1767225600 }]);
  });

  it('DELETE /sessions/:id removes the session and returns {ok:true}', async () => {
    const sessions = makeSessionsMock({
      deleteSession: jest.fn(async () => undefined),
    });
    const controller = buildController(async function* () {}, sessions);

    const result = await controller.deleteSession('s1');

    expect(sessions.deleteSession).toHaveBeenCalledWith('s1');
    expect(result).toEqual({ ok: true });
  });
});
