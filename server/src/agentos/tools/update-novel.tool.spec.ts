import { makeUpdateNovelTool } from './update-novel.tool';
import type { NovelService } from '../../novel/novel.service';

describe('makeUpdateNovelTool', () => {
  // helpers ---------------------------------------------------------------
  /** Build a NovelService-shaped mock whose `get` returns the given settings. */
  function makeNovels(settings: unknown = {}) {
    const update = jest.fn().mockResolvedValue({ id: 'n1' });
    const get = jest.fn().mockResolvedValue({ id: 'n1', settings });
    return { novels: { get, update } as unknown as NovelService, update, get };
  }

  it('maps worldviewText/style into settings and calls NovelService.update with bound userId + novelId', async () => {
    const { novels, update } = makeNovels({});
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
    const { novels, update } = makeNovels({});
    const t = makeUpdateNovelTool({ userId: 'u1', novelId: 'n1', novels });

    await t.invoke({ title: '只改名' });

    expect(update).toHaveBeenCalledWith('u1', 'n1', { title: '只改名' });
  });

  it('binds userId + novelId from closure, never from input', async () => {
    const { novels, update } = makeNovels({});
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

  // --- merge behavior (the bug fix) --------------------------------------
  it('merges new settings onto existing settings (first call sets worldviewText)', async () => {
    const { novels, update } = makeNovels({});
    const t = makeUpdateNovelTool({ userId: 'u1', novelId: 'n1', novels });

    await t.invoke({ worldviewText: '大漠' });

    expect(update).toHaveBeenCalledWith('u1', 'n1', {
      settings: { worldviewText: '大漠' },
    });
  });

  it('merges new settings onto existing settings (second call keeps BOTH fields)', async () => {
    // 模拟第二次调用:DB 里已经有 worldviewText(由上一次 update 写入)。
    // get 是 mock,所以这里直接给出现有 settings 即可。
    const { novels, update, get } = makeNovels({ worldviewText: '大漠' });
    const t = makeUpdateNovelTool({ userId: 'u1', novelId: 'n1', novels });

    await t.invoke({ style: '冷峻' });

    expect(get).toHaveBeenCalledWith('u1', 'n1');
    // 关键断言:合并后必须同时包含 worldviewText 和 style,而不是只剩 style。
    expect(update).toHaveBeenCalledWith('u1', 'n1', {
      settings: { worldviewText: '大漠', style: '冷峻' },
    });
  });

  it('reads the current novel via novels.get before updating', async () => {
    const { novels, get } = makeNovels({ language: 'zh' });
    const t = makeUpdateNovelTool({ userId: 'u1', novelId: 'n1', novels });

    await t.invoke({ style: '冷峻' });

    expect(get).toHaveBeenCalledWith('u1', 'n1');
  });
});
