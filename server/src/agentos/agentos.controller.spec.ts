import type { Response } from 'express';
import { AgentosController } from './agentos.controller';
import type { DeepAgentService } from './deep-agent.service';
import { StreamAdapter, type AgentosFrame } from './stream-adapter';

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

function buildController(
  deltas: (m: string) => AsyncIterable<string>,
): AgentosController {
  const fakeService = { streamDeltas: deltas } as unknown as DeepAgentService;
  return new AgentosController(fakeService, new StreamAdapter());
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
    expect(agents[0]).toMatchObject({
      id: 'deep-agent',
      name: 'Deep Agent',
      db_id: 'default',
    });
  });

  it('POST runs streams RunStarted -> RunContent x2 -> RunCompleted as newline JSON', async () => {
    const controller = buildController(async function* () {
      yield 'He';
      yield 'llo';
    });
    const { res, chunks } = createFakeRes();
    await controller.runAgent('deep-agent', { message: 'hi' }, res);

    const frames = chunks
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => JSON.parse(c)) as AgentosFrame[];
    expect(frames[0].event).toBe('RunStarted');
    expect(frames[0].session_id).toEqual(expect.any(String));
    expect(frames.map((f) => f.event)).toEqual([
      'RunStarted',
      'RunContent',
      'RunContent',
      'RunCompleted',
    ]);
    expect(frames[frames.length - 1].content).toBe('Hello');
  });

  it('POST runs emits RunError frame when service throws', async () => {
    const controller = buildController(async function* () {
      throw new Error('boom');
    });
    const { res, chunks } = createFakeRes();
    await controller.runAgent('deep-agent', { message: 'hi' }, res);

    const frames = chunks
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => JSON.parse(c)) as AgentosFrame[];
    const last = frames[frames.length - 1];
    expect(last.event).toBe('RunError');
    expect(last.content).toBe('boom');
  });
});
