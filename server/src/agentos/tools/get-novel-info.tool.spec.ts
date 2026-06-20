import { makeGetNovelInfoTool } from './get-novel-info.tool';
import type { NovelService } from '../../novel/novel.service';

describe('makeGetNovelInfoTool', () => {
  /** Build a NovelService-shaped mock whose `get` returns the given novel fields. */
  function makeNovels(novel: Record<string, unknown>) {
    const get = jest.fn().mockResolvedValue(novel);
    return { novels: { get } as unknown as NovelService, get };
  }

  it('returns the novel info + missing array (empty fields flagged)', async () => {
    const { novels, get } = makeNovels({
      id: 'n1',
      title: '未命名',
      genre: '',
      synopsis: '',
      status: 'CONCEPT',
      settings: {},
    });
    const t = makeGetNovelInfoTool({ userId: 'u1', novelId: 'n1', novels });

    const res = await t.invoke({});

    expect(get).toHaveBeenCalledWith('u1', 'n1');
    expect(res).toMatchObject({
      title: '未命名',
      genre: '',
      synopsis: '',
      status: 'CONCEPT',
      worldviewText: null,
      style: null,
      coreConflict: null,
      chapterWordTarget: null,
    });
    // 未命名/空字段都要进入 missing(7 项基础信息)。
    expect(res.missing).toEqual([
      '书名',
      '类型',
      '简介/故事核',
      '核心冲突',
      '每章字数目标',
      '世界观',
      '文风',
    ]);
  });

  it('flags missing only for empty fields (partial novel)', async () => {
    const { novels } = makeNovels({
      id: 'n1',
      title: '剑来',
      genre: '仙侠',
      synopsis: '',
      status: 'CONCEPT',
      settings: { worldviewText: '九州', style: '' },
    });
    const t = makeGetNovelInfoTool({ userId: 'u1', novelId: 'n1', novels });

    const res = await t.invoke({});

    expect(res.title).toBe('剑来');
    expect(res.genre).toBe('仙侠');
    expect(res.worldviewText).toBe('九州');
    // style: '' 是 falsy,会被 missing 逻辑视为缺失;原样透传给调用方。
    expect(res.style).toBe('');
    // coreConflict / chapterWordTarget 未提供 → null,且进入 missing。
    expect(res.coreConflict).toBeNull();
    expect(res.chapterWordTarget).toBeNull();
    // title/genre/worldviewText 都已收集,缺 synopsis + 核心冲突 + 每章字数目标 + style。
    expect(res.missing).toEqual([
      '简介/故事核',
      '核心冲突',
      '每章字数目标',
      '文风',
    ]);
  });

  it('returns an empty missing array when all fields are filled', async () => {
    const { novels } = makeNovels({
      id: 'n1',
      title: '剑来',
      genre: '仙侠',
      synopsis: '一个少年的修行路',
      status: 'ACTIVE',
      settings: {
        worldviewText: '九州',
        style: '冷峻',
        coreConflict: '少年寻剑vs天命',
        chapterWordTarget: 3000,
      },
    });
    const t = makeGetNovelInfoTool({ userId: 'u1', novelId: 'n1', novels });

    const res = await t.invoke({});

    expect(res.coreConflict).toBe('少年寻剑vs天命');
    expect(res.chapterWordTarget).toBe(3000);
    expect(res.missing).toEqual([]);
  });

  it('binds userId + novelId from closure (closure args drive the lookup)', async () => {
    const { novels, get } = makeNovels({
      id: 'novel-9',
      title: 'X',
      genre: 'g',
      synopsis: 's',
      status: 'ACTIVE',
      settings: { worldviewText: 'w', style: 'st' },
    });
    const t = makeGetNovelInfoTool({
      userId: 'owner',
      novelId: 'novel-9',
      novels,
    });
    await t.invoke({});
    expect(get).toHaveBeenCalledWith('owner', 'novel-9');
  });
});
