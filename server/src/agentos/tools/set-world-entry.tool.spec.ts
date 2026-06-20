import { makeSetWorldEntryTool } from './set-world-entry.tool';
import type { WorldEntryService } from '../../novel/world-entry.service';

describe('set_world_entry tool', () => {
  it('delegates to WorldEntryService.upsertEntry with bound userId/novelId', async () => {
    const upsertEntry = jest.fn().mockResolvedValue({ id: 'w1' });
    const world = { upsertEntry } as unknown as WorldEntryService;
    const t = makeSetWorldEntryTool({ userId: 'u1', novelId: 'n1', world });
    const out = await t.invoke({
      type: 'powerSystem',
      name: '灵气修炼',
      content: '炼气→筑基→金丹',
    });
    expect(upsertEntry).toHaveBeenCalledWith('u1', 'n1', {
      type: 'powerSystem',
      name: '灵气修炼',
      content: '炼气→筑基→金丹',
    });
    expect(out).toMatchObject({ ok: true, name: '灵气修炼' });
  });
});
