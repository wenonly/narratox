// 测试桩用纯 yield 的 async generator,无 await —— 整文件豁免 require-await 误报。
/* eslint-disable @typescript-eslint/require-await */
import { PipelineRunner, type Pipeline } from './pipeline-runner';
import type { StatelessAgent } from './stateless-agent';
import type { ActivityEvent, ActEnd } from '../agentos/activity.types';

const isActEnd = (e: ActivityEvent): e is ActEnd => e.type === 'ActEnd';

/** 造一个产出固定事件序列的 stub 专家 agent。 */
function stubAgent(name: string, events: ActivityEvent[]): StatelessAgent {
  return {
    name,
    async *run() {
      for (const ev of events) yield ev;
    },
  };
}

/** 造一个【抛错】的 stub 专家 agent。 */
function throwingAgent(name: string, err: Error): StatelessAgent {
  return {
    name,
    async *run() {
      yield { type: 'Act', id: 'pre-throw', act: 'think', label: '即将失败' };
      throw err;
    },
  };
}

describe('PipelineRunner', () => {
  const base = { userId: 'u1', novelId: 'n1', input: { chapterOrder: 1 } };

  it('runs stages in order and wraps each in a stage Act / ActEnd pair', async () => {
    const writer = stubAgent('writer', [
      { type: 'Act', id: 'w-think', act: 'think', label: '思考' },
      { type: 'ActDelta', id: 'w-think', text: '想' },
      { type: 'Act', id: 'w-tool', act: 'tool', label: 'append_section' },
      { type: 'ActTool', id: 'w-tool', args: { chapterOrder: 1 } },
      { type: 'ActResult', id: 'w-tool', result: { ok: true } },
      { type: 'ActEnd', id: 'w-tool', status: 'ok' },
    ]);
    const settler = stubAgent('settler', [
      { type: 'Act', id: 's-content', act: 'content', label: '结算' },
      { type: 'ActDelta', id: 's-content', text: '已结算' },
      { type: 'ActEnd', id: 's-content', status: 'ok' },
    ]);

    const pipeline: Pipeline = {
      name: 'write-chapter',
      stages: [
        { name: 'writer', agent: writer, input: (ctx) => ctx.input },
        { name: 'settler', agent: settler, input: (ctx) => ctx.input },
      ],
    };

    const out: ActivityEvent[] = [];
    for await (const ev of new PipelineRunner().run(pipeline, base))
      out.push(ev);

    // 序列:stage(writer) → writer 6 事件 → stage ActEnd(ok) → stage(settler) → settler 3 事件 → stage ActEnd(ok)
    const types = out.map((e) => `${e.type}:${('act' in e && e.act) || ''}`);
    expect(types).toEqual([
      'Act:stage', // writer stage 开始
      'Act:think',
      'ActDelta:',
      'Act:tool',
      'ActTool:',
      'ActResult:',
      'ActEnd:',
      'ActEnd:', // writer stage 结束(stage 的 ActEnd,与开头的 stage Act 配对)
      'Act:stage', // settler stage 开始
      'Act:content',
      'ActDelta:',
      'ActEnd:',
      'ActEnd:', // settler stage 结束
    ]);

    // 每个 stage Act 都有【同 id】的 ActEnd 配对。
    const stageStarts = out.filter(
      (e) => e.type === 'Act' && e.act === 'stage',
    );
    const stageEndIds = new Set(stageStarts.map((s) => s.id));
    const stageEnds = out.filter(isActEnd).filter((e) => stageEndIds.has(e.id));
    expect(stageStarts.length).toBe(2);
    expect(stageEnds.length).toBe(2);
    expect(stageEnds.every((e) => e.status === 'ok')).toBe(true);
  });

  it('emits an error ActEnd for a failing stage and aborts the pipeline', async () => {
    const boom = new Error('writer blew up');
    const pipeline: Pipeline = {
      name: 'write-chapter',
      stages: [
        {
          name: 'writer',
          agent: throwingAgent('writer', boom),
          input: (ctx) => ctx.input,
        },
        {
          name: 'settler',
          agent: stubAgent('settler', [
            { type: 'Act', id: 'never', act: 'content' },
          ]),
          input: (ctx) => ctx.input,
        },
      ],
    };

    const out: ActivityEvent[] = [];
    await expect(async () => {
      for await (const ev of new PipelineRunner().run(pipeline, base))
        out.push(ev);
    }).rejects.toThrow('writer blew up');

    // 失败 stage 的事件先流出,然后是 error ActEnd;settler 不应跑。
    const last = out[out.length - 1];
    expect(isActEnd(last)).toBe(true);
    if (isActEnd(last)) {
      expect(last.status).toBe('error');
      expect(last.summary).toBe('writer blew up');
    }
    // settler 的 content 条目从未出现
    expect(out.some((e) => e.id === 'never')).toBe(false);
  });
});
