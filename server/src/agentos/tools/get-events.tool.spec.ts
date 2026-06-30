import { makeGetEventsTool } from './get-events.tool';

describe('get_events tool(Phase 11)', () => {
  it('返回 JSON 字符串(防数组被供应商当多模态块)', async () => {
    const eventService = {
      listEvents: jest
        .fn()
        .mockResolvedValue([{ chapterOrder: 12, description: '发现血书' }]),
    };
    const t = makeGetEventsTool({
      userId: 'u1',
      novelId: 'n1',
      eventService: eventService as any,
    });
    const out: any = await t.invoke({ character: '沈砚' });
    expect(typeof out).toBe('string');
    const parsed = JSON.parse(out);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      chapterOrder: 12,
      description: '发现血书',
    });
  });

  it('把过滤参数透传给 eventService.listEvents', async () => {
    const eventService = { listEvents: jest.fn().mockResolvedValue([]) };
    const t = makeGetEventsTool({
      userId: 'u1',
      novelId: 'n1',
      eventService: eventService as any,
    });
    await t.invoke({
      chapterFrom: 5,
      chapterTo: 20,
      character: '沈砚',
      significance: 'MAJOR',
      keyword: '血书',
    });
    expect(eventService.listEvents).toHaveBeenCalledWith('u1', 'n1', {
      chapterFrom: 5,
      chapterTo: 20,
      character: '沈砚',
      significance: 'MAJOR',
      keyword: '血书',
    });
  });
});
