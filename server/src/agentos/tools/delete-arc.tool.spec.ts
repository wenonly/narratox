import { makeDeleteArcTool } from './delete-arc.tool';
import type { ArcService } from '../../novel/arc.service';

describe('delete_arc tool', () => {
  it('转发给 ArcService.deleteArc', async () => {
    const deleteArc = jest.fn().mockResolvedValue({ ok: true, order: 3 });
    const arcs = { deleteArc } as unknown as ArcService;
    const t = makeDeleteArcTool({ userId: 'u1', novelId: 'n1', arcs });
    const out = await t.invoke({ order: 3 });
    expect(deleteArc).toHaveBeenCalledWith('u1', 'n1', 3);
    expect(out).toMatchObject({ ok: true, order: 3 });
  });
});
