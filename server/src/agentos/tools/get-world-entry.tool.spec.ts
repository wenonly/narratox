import { makeGetWorldEntryTool } from './get-world-entry.tool';
import type { WorldEntryService } from '../../novel/world-entry.service';

describe('get_world_entry tool', () => {
  it('returns the entry when it exists', async () => {
    const getEntry = jest.fn().mockResolvedValue({
      id: 'w1',
      type: 'location',
      name: '玄天宗',
      content: '东域大宗，建于玄天山',
    });
    const world = { getEntry } as unknown as WorldEntryService;
    const t = makeGetWorldEntryTool({ userId: 'u1', novelId: 'n1', world });
    const out = await t.invoke({ name: '玄天宗' });
    expect(getEntry).toHaveBeenCalledWith('u1', 'n1', '玄天宗');
    expect(out).toMatchObject({
      ok: true,
      type: 'location',
      name: '玄天宗',
      content: '东域大宗，建于玄天山',
    });
  });

  it('returns ok:false when no entry matches the name', async () => {
    const getEntry = jest.fn().mockResolvedValue(null);
    const world = { getEntry } as unknown as WorldEntryService;
    const t = makeGetWorldEntryTool({ userId: 'u1', novelId: 'n1', world });
    const out = await t.invoke({ name: '不存在' });
    expect(out).toEqual({ ok: false, reason: 'no_entry', name: '不存在' });
  });
});
