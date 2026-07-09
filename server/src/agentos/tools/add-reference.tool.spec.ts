import { makeAddReferenceTool } from './add-reference.tool';
import type { NovelReferenceService } from '../../novel/novel-reference.service';

describe('add_reference tool', () => {
  it('转发到 NovelReferenceService.create 并返回 {id,title}', async () => {
    const create = jest
      .fn()
      .mockResolvedValue({ id: 'r1', title: '武器体系' });
    const references = { create } as unknown as NovelReferenceService;
    const t = makeAddReferenceTool({ userId: 'u1', novelId: 'n1', references });
    const out = await t.invoke({
      title: '武器体系',
      content: '冷兵器分阶...',
      category: '世界观',
      injectTo: 'writer',
    });
    expect(create).toHaveBeenCalledWith('u1', 'n1', {
      title: '武器体系',
      content: '冷兵器分阶...',
      category: '世界观',
      injectTo: 'writer',
    });
    expect(out).toEqual({ id: 'r1', title: '武器体系' });
  });

  it('service 抛异常时,异常原样向上抛(让 agent 看到错误)', async () => {
    const create = jest
      .fn()
      .mockRejectedValue(new Error('标题「武器体系」已存在'));
    const references = { create } as unknown as NovelReferenceService;
    const t = makeAddReferenceTool({ userId: 'u1', novelId: 'n1', references });
    await expect(
      t.invoke({ title: '武器体系', content: 'x' }),
    ).rejects.toThrow(/已存在/);
  });
});
