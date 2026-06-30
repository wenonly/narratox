import { makeGetArcsTool } from './get-arcs.tool';

describe('get_arcs tool(Phase 12)', () => {
  it('返回 JSON 字符串(防数组多模态块)', async () => {
    const arcs = {
      listArcs: jest
        .fn()
        .mockResolvedValue([{ order: 1, title: '入世', fromChapter: 1 }]),
    };
    const t = makeGetArcsTool({
      userId: 'u1',
      novelId: 'n1',
      arcs: arcs as any,
    });
    const out: any = await t.invoke({});
    expect(typeof out).toBe('string');
    const parsed = JSON.parse(out);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toMatchObject({ order: 1, title: '入世' });
  });
});
