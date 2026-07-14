import { createActivityEmitter } from './activity-emitter';
import type { ActivityEvent } from './activity.types';

/**
 * 模拟 LangChain streamMode:'messages' 流出的 chunk。只覆盖 emitter 实际读取的字段,
 * 避免在单测里引入 LangChain 类型(保持 ESM/dual-package 干净)。
 */
type FakeChunk = {
  _getType: () => string;
  id?: string;
  content?: unknown;
  tool_calls?: Array<{ id?: string; name?: string; args?: unknown }>;
  tool_call_chunks?: Array<{
    index?: number;
    id?: string;
    name?: string;
    args?: string;
  }>;
  tool_call_id?: string;
  additional_kwargs?: { reasoning_content?: unknown };
};

describe('createActivityEmitter — tool args 累积', () => {
  it('跨多片 tool_call_chunks 累积出真实 args,而非首片的 {}', () => {
    const events: ActivityEvent[] = [];
    const { feed, finish } = createActivityEmitter((ev) => events.push(ev));

    // 第 1 片:声明 tool_call(id+name),args 为空 → 当前 bug 下被捕获成 {}
    feed({
      _getType: () => 'ai',
      id: 'msg-1',
      content: '',
      tool_calls: [{ id: 'call_1', name: 'append_section', args: {} }],
      tool_call_chunks: [
        { index: 0, id: 'call_1', name: 'append_section', args: '' },
      ],
    });
    // 第 2 片:仅 index + args 字符串分片(无 id/name),tool_calls 为空
    feed({
      _getType: () => 'ai',
      id: 'msg-1',
      content: '',
      tool_calls: [],
      tool_call_chunks: [{ index: 0, args: '{"chapterOrder":' }],
    });
    // 第 3 片:args 收尾 → 整段 JSON 方可解析
    feed({
      _getType: () => 'ai',
      id: 'msg-1',
      content: '',
      tool_calls: [],
      tool_call_chunks: [{ index: 0, args: '3,"title":"章三"}' }],
    });
    // ToolMessage:工具执行完成
    feed({
      _getType: () => 'tool',
      tool_call_id: 'call_1',
      content: JSON.stringify({ ok: true, order: 3 }),
    });

    finish();

    const actTools = events.filter(
      (e): e is Extract<ActivityEvent, { type: 'ActTool' }> =>
        e.type === 'ActTool',
    );

    // 只 emit 一次 ActTool,且 args 是累积后的真实对象
    expect(actTools).toHaveLength(1);
    expect(actTools[0].args).toEqual({ chapterOrder: 3, title: '章三' });

    // 同时 ActResult 仍正确(工具返回值不被本次改动影响)
    const actResult = events.find(
      (e): e is Extract<ActivityEvent, { type: 'ActResult' }> =>
        e.type === 'ActResult',
    );
    expect(actResult?.result).toEqual({ ok: true, order: 3 });
  });

  it('非流式 provider 一次性返回完整 args 时也能 emit', () => {
    const events: ActivityEvent[] = [];
    const { feed, finish } = createActivityEmitter((ev) => events.push(ev));

    // 单片就带完整 args(tool_calls 已解析,tool_call_chunks 同样整段 JSON)
    feed({
      _getType: () => 'ai',
      id: 'msg-2',
      content: '',
      tool_calls: [
        {
          id: 'call_2',
          name: 'write_summary',
          args: { chapterOrder: 7, summary: '前情' },
        },
      ],
      tool_call_chunks: [
        {
          index: 0,
          id: 'call_2',
          name: 'write_summary',
          args: '{"chapterOrder":7,"summary":"前情"}',
        },
      ],
    });
    feed({
      _getType: () => 'tool',
      tool_call_id: 'call_2',
      content: JSON.stringify({ ok: true }),
    });
    finish();

    const actTool = events.find(
      (e): e is Extract<ActivityEvent, { type: 'ActTool' }> =>
        e.type === 'ActTool',
    );
    expect(actTool?.args).toEqual({ chapterOrder: 7, summary: '前情' });
  });
});
