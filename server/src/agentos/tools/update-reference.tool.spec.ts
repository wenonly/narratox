import { makeUpdateReferenceTool } from './update-reference.tool';
import type { NovelReferenceService } from '../../novel/novel-reference.service';

describe('update_reference tool', () => {
  it('转发到 NovelReferenceService.update,字段级 patch', async () => {
    const update = jest
      .fn()
      .mockResolvedValue({ id: 'r1', title: '新标题', content: '新内容' });
    const references = { update } as unknown as NovelReferenceService;
    const t = makeUpdateReferenceTool({
      userId: 'u1',
      novelId: 'n1',
      references,
    });
    const out = await t.invoke({ id: 'r1', content: '新内容' });
    expect(update).toHaveBeenCalledWith('u1', 'n1', 'r1', {
      content: '新内容',
    });
    expect(out.id).toBe('r1');
    expect(out.updatedFields).toEqual(['content']);
  });

  it('id 不存在时,service 抛 NotFound,异常向上抛', async () => {
    const update = jest
      .fn()
      .mockRejectedValue(new Error('Reference not found'));
    const references = { update } as unknown as NovelReferenceService;
    const t = makeUpdateReferenceTool({
      userId: 'u1',
      novelId: 'n1',
      references,
    });
    await expect(t.invoke({ id: 'missing' })).rejects.toThrow(/not found/i);
  });
});
