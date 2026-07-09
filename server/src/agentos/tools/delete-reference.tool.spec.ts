import { makeDeleteReferenceTool } from './delete-reference.tool';
import type { NovelReferenceService } from '../../novel/novel-reference.service';

describe('delete_reference tool', () => {
  it('转发到 NovelReferenceService.deleteOne 并返回 {id,title}', async () => {
    const deleteOne = jest
      .fn()
      .mockResolvedValue({ id: 'r1', title: '武器体系' });
    const references = { deleteOne } as unknown as NovelReferenceService;
    const t = makeDeleteReferenceTool({
      userId: 'u1',
      novelId: 'n1',
      references,
    });
    const out = await t.invoke({ id: 'r1' });
    expect(deleteOne).toHaveBeenCalledWith('u1', 'n1', 'r1');
    expect(out).toEqual({ id: 'r1', title: '武器体系' });
  });

  it('id 不属于本 novel 时,service 抛 NotFound', async () => {
    const deleteOne = jest
      .fn()
      .mockRejectedValue(new Error('Reference not found'));
    const references = { deleteOne } as unknown as NovelReferenceService;
    const t = makeDeleteReferenceTool({
      userId: 'u1',
      novelId: 'n1',
      references,
    });
    await expect(t.invoke({ id: 'foreign' })).rejects.toThrow(/not found/i);
  });
});
