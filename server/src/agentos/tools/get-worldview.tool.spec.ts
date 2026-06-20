import { makeGetWorldviewTool } from './get-worldview.tool';
import type { WorldEntryService } from '../../novel/world-entry.service';

describe('get_worldview tool', () => {
  it('lists all entries when no type filter', async () => {
    const listEntries = jest.fn().mockResolvedValue([
      { id: 'w1', type: 'concept', name: '总览', content: '仙侠世界' },
      { id: 'w2', type: 'location', name: '玄天宗', content: '东域大宗' },
    ]);
    const world = { listEntries } as unknown as WorldEntryService;
    const t = makeGetWorldviewTool({ userId: 'u1', novelId: 'n1', world });
    const out = await t.invoke({});
    expect(listEntries).toHaveBeenCalledWith('u1', 'n1', undefined);
    expect(out.entries).toHaveLength(2);
    expect(out.entries[0]).toMatchObject({ type: 'concept', name: '总览' });
  });

  it('filters by type when given', async () => {
    const listEntries = jest.fn().mockResolvedValue([]);
    const world = { listEntries } as unknown as WorldEntryService;
    const t = makeGetWorldviewTool({ userId: 'u1', novelId: 'n1', world });
    await t.invoke({ type: 'location' });
    expect(listEntries).toHaveBeenCalledWith('u1', 'n1', 'location');
  });
});
