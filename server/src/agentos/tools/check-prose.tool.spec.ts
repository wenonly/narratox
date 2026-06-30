import { makeCheckProseTool } from './check-prose.tool';

const chapters = {
  findByOrder: jest.fn(),
  update: jest.fn(),
};
const novels = { get: jest.fn() };

describe('check_prose tool', () => {
  it('无正文 → ok:false,空 report', async () => {
    chapters.findByOrder.mockResolvedValue({ id: 'c1', content: '' });
    const t = makeCheckProseTool({
      userId: 'u',
      novelId: 'n',
      chapters: chapters as never,
      novels: novels as never,
    });
    const r = await t.invoke({ chapterOrder: 1 });
    expect(r).toMatchObject({ ok: false, chapterOrder: 1 });
    expect(r.blocking).toHaveLength(0);
  });

  it('退化正文 → ok:true + blocking + nextAction revise', async () => {
    chapters.findByOrder.mockResolvedValue({
      id: 'c1',
      content: '陆青衫站在雨中看着远方。\n陆青衫站在雨中看着远方。',
    });
    novels.get.mockResolvedValue({ settings: { chapterWordTarget: 2000 } });
    const t = makeCheckProseTool({
      userId: 'u',
      novelId: 'n',
      chapters: chapters as never,
      novels: novels as never,
    });
    const r = await t.invoke({ chapterOrder: 1 });
    expect(r.ok).toBe(true);
    expect(r.blocking.length).toBeGreaterThan(0);
    expect(r.nextAction).toBe('revise');
  });

  it('auto-fix 命中 → 调 chapters.update 写回归一正文', async () => {
    chapters.findByOrder.mockResolvedValue({ id: 'c1', content: '正文�正文。' });
    novels.get.mockResolvedValue({ settings: {} });
    chapters.update.mockResolvedValue({});
    const t = makeCheckProseTool({
      userId: 'u',
      novelId: 'n',
      chapters: chapters as never,
      novels: novels as never,
    });
    await t.invoke({ chapterOrder: 1 });
    expect(chapters.update).toHaveBeenCalledWith('u', 'n', 'c1', {
      content: '正文正文。',
    });
  });

  it('chapterWordTarget 缺省时 novels.get 仍被调用且不报错', async () => {
    chapters.findByOrder.mockResolvedValue({ id: 'c1', content: '正常的一句正文。' });
    novels.get.mockResolvedValue({ settings: null });
    const t = makeCheckProseTool({
      userId: 'u',
      novelId: 'n',
      chapters: chapters as never,
      novels: novels as never,
    });
    const r = await t.invoke({ chapterOrder: 1 });
    expect(r.ok).toBe(true);
    expect(r.nextAction).toBe('pass');
  });
});
