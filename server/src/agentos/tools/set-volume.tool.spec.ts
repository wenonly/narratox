import { makeSetVolumeTool } from './set-volume.tool';
import type { OutlineService } from '../../novel/outline.service';

describe('set_volume tool', () => {
  it('delegates to OutlineService.upsertVolume with bound userId/novelId', async () => {
    const upsertVolume = jest.fn().mockResolvedValue({ id: 'v1' });
    const outlines = { upsertVolume } as unknown as OutlineService;
    const t = makeSetVolumeTool({ userId: 'u1', novelId: 'n1', outlines });
    const out = await t.invoke({
      order: 1,
      title: '初入江湖',
      goal: '少年下山',
      synopsis: '卷一梗概',
    });
    expect(upsertVolume).toHaveBeenCalledWith('u1', 'n1', 1, {
      title: '初入江湖',
      goal: '少年下山',
      synopsis: '卷一梗概',
    });
    expect(out).toMatchObject({ ok: true, order: 1, title: '初入江湖' });
  });
});
