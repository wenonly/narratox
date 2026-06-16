import type { Response } from 'express';
import { AgentosController } from './agentos.controller';
import type { DeepAgentService } from './deep-agent.service';
import type { SessionsService } from './sessions.service';
import { StreamAdapter, type AgentosFrame } from './stream-adapter';
import type { RequestUser } from '../auth/current-user.decorator';
import { AGENT_ID } from './agentos.constants';

const EPOCH = new Date('2026-01-01T00:00:00.000Z');
const USER: RequestUser = { id: 'u1', email: 'a@b.com' };

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
      jest.fn(async () => ({ id: 'sess-1', userId: 'u1', name: 'n', createdAt: EPOCH, updatedAt: EPOCH })),
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

  it('does NOT expose /agents or /teams endpoints', () => {
    const controller = buildController(async function* () {}) as unknown as {
      agents?: unknown;
      teams?: unknown;
    };
    expect(controller.agents).toBeUndefined();
    expect(controller.teams).toBeUndefined();
  });

  it('POST runs scopes resolve/append by user, streams frames, persists the turn', async () => {
    const sessions = makeSessionsMock();
    const controller = buildController(async function* () {
      yield 'He';
      yield 'llo';
    }, sessions);
    const { res, chunks } = createFakeRes();

    await controller.runAgent(USER, 'deep-agent', { message: 'hi', session_id: 'sess-1' }, res);

    expect(sessions.resolveSession).toHaveBeenCalledWith('u1', 'sess-1', AGENT_ID, 'hi');
    const frames = parseFrames(chunks);
    expect(frames.map((f) => f.event)).toEqual(['RunStarted', 'RunContent', 'RunContent', 'RunCompleted']);
    expect(frames[0].session_id).toBe('sess-1');
    expect(frames.at(-1)?.content).toBe('Hello');
    expect(sessions.appendTurn).toHaveBeenCalledWith('u1', 'sess-1', 'hi', 'Hello');
  });

  it('POST runs creates a session when session_id is absent', async () => {
    const sessions = makeSessionsMock({
      resolveSession: jest.fn(async () => ({ id: 'fresh', userId: 'u1', name: 'hi', createdAt: EPOCH, updatedAt: EPOCH })),
    });
    const controller = buildController(async function* () {
      yield 'ok';
    }, sessions);
    const { res, chunks } = createFakeRes();

    await controller.runAgent(USER, 'deep-agent', { message: 'hi' }, res);

    expect(sessions.resolveSession).toHaveBeenCalledWith('u1', undefined, AGENT_ID, 'hi');
    expect(parseFrames(chunks)[0].session_id).toBe('fresh');
  });

  it('POST runs emits RunError and does NOT persist when the service throws', async () => {
    const sessions = makeSessionsMock();
    const controller = buildController(async function* () {
      throw new Error('boom');
    }, sessions);
    const { res, chunks } = createFakeRes();

    await controller.runAgent(USER, 'deep-agent', { message: 'hi', session_id: 'sess-1' }, res);

    const last = parseFrames(chunks).at(-1);
    expect(last?.event).toBe('RunError');
    expect(last?.content).toBe('boom');
    expect(sessions.appendTurn).not.toHaveBeenCalled();
  });

  it('GET /sessions maps rows to the UI shape and scopes by user', async () => {
    const sessions = makeSessionsMock({
      listSessions: jest.fn(async () => [
        { id: 's1', name: 'First', createdAt: EPOCH, updatedAt: EPOCH },
      ]),
    });
    const controller = buildController(async function* () {}, sessions);

    const result = await controller.listSessions(USER);

    expect(sessions.listSessions).toHaveBeenCalledWith('u1', AGENT_ID);
    expect(result).toEqual({
      data: [{ session_id: 's1', session_name: 'First', created_at: 1767225600, updated_at: 1767225600 }],
    });
  });

  it('GET /sessions/:id/runs maps run pairs and scopes by user', async () => {
    const sessions = makeSessionsMock({
      getRuns: jest.fn(async () => [
        { userContent: 'hi', assistantContent: 'hello', createdAt: EPOCH },
      ]),
    });
    const controller = buildController(async function* () {}, sessions);

    const result = await controller.getSessionRuns(USER, 's1');

    expect(sessions.getRuns).toHaveBeenCalledWith('u1', 's1');
    expect(result).toEqual([{ run_input: 'hi', content: 'hello', created_at: 1767225600 }]);
  });

  it('DELETE /sessions/:id removes the session and returns {ok:true}, scoped by user', async () => {
    const sessions = makeSessionsMock({
      deleteSession: jest.fn(async () => undefined),
    });
    const controller = buildController(async function* () {}, sessions);

    const result = await controller.deleteSession(USER, 's1');

    expect(sessions.deleteSession).toHaveBeenCalledWith('u1', 's1');
    expect(result).toEqual({ ok: true });
  });
});
