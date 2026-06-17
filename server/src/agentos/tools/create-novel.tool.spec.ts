import { makeCreateNovelTool } from './create-novel.tool';
import type { NovelService } from '../../novel/novel.service';

describe('makeCreateNovelTool', () => {
  it('calls NovelService.create with the bound userId + mapped args, returns novelId', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'n1' });
    const novels = { create } as unknown as NovelService;
    const t = makeCreateNovelTool({ userId: 'u1', novels });

    const res = await t.invoke({
      title: '江湖夜雨',
      genre: '武侠',
      synopsis: '一把刀的传奇',
      worldviewText: '大漠武侠',
    });

    expect(create).toHaveBeenCalledWith('u1', {
      title: '江湖夜雨',
      genre: '武侠',
      synopsis: '一把刀的传奇',
      settings: { worldviewText: '大漠武侠' },
    });
    expect(res).toMatchObject({ novelId: 'n1' });
  });

  it('works without optional fields', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'n2' });
    const novels = { create } as unknown as NovelService;
    const t = makeCreateNovelTool({ userId: 'u1', novels });
    const res = await t.invoke({ title: '只有书名' });
    expect(create).toHaveBeenCalledWith('u1', { title: '只有书名' });
    expect(res).toMatchObject({ novelId: 'n2' });
  });

  it('binds the userId from closure, never from input', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'n3' });
    const novels = { create } as unknown as NovelService;
    const t = makeCreateNovelTool({ userId: 'owner', novels });
    await t.invoke({ title: 'X' });
    expect(create).toHaveBeenCalledWith(
      'owner',
      expect.objectContaining({ title: 'X' }),
    );
  });
});
