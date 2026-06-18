import { makeUpdateNovelTool } from './update-novel.tool';
import type { NovelService } from '../../novel/novel.service';

describe('makeUpdateNovelTool', () => {
  it('maps worldviewText/style into settings and calls NovelService.update with bound userId + novelId', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'n1' });
    const novels = { update } as unknown as NovelService;
    const t = makeUpdateNovelTool({ userId: 'u1', novelId: 'n1', novels });

    const res = await t.invoke({
      title: '新名字',
      genre: '武侠',
      worldviewText: '大漠',
      style: '冷峻',
    });

    expect(update).toHaveBeenCalledWith('u1', 'n1', {
      title: '新名字',
      genre: '武侠',
      settings: { worldviewText: '大漠', style: '冷峻' },
    });
    expect(res).toMatchObject({ ok: true });
  });

  it('omits settings entirely when neither worldviewText nor style is provided', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'n1' });
    const novels = { update } as unknown as NovelService;
    const t = makeUpdateNovelTool({ userId: 'u1', novelId: 'n1', novels });

    await t.invoke({ title: '只改名' });

    expect(update).toHaveBeenCalledWith('u1', 'n1', { title: '只改名' });
  });

  it('binds userId + novelId from closure, never from input', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'n1' });
    const novels = { update } as unknown as NovelService;
    const t = makeUpdateNovelTool({
      userId: 'owner',
      novelId: 'novel-9',
      novels,
    });
    await t.invoke({ title: 'X' });
    expect(update).toHaveBeenCalledWith(
      'owner',
      'novel-9',
      expect.objectContaining({ title: 'X' }),
    );
  });
});
