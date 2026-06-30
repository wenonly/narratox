import { splitChapters, SplitChapter } from './chapter-splitter';

describe('splitChapters', () => {
  it('按「第N章」切分', () => {
    const text = '第一章 出场\n内容A\n第二章 冲突\n内容B';
    const r = splitChapters(text);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ chapterNo: 1, title: '出场' });
    expect(r[0].text).toContain('内容A');
    expect(r[1]).toMatchObject({ chapterNo: 2, title: '冲突' });
  });

  it('支持阿拉伯数字「第3章」', () => {
    const text = '第1章 开端\nfoo\n第2章 发展\nbar';
    const r = splitChapters(text);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ chapterNo: 1, title: '开端' });
    expect(r[1]).toMatchObject({ chapterNo: 2, title: '发展' });
  });

  it('支持「第N回」「第N节」「第N卷」', () => {
    const text = '第一回 楔子\nA\n第二回 入胜\nB';
    const r = splitChapters(text);
    expect(r).toHaveLength(2);
    expect(r[0].title).toBe('楔子');
    expect(r[1].title).toBe('入胜');
  });

  it('无章节标记 → 按字数均分(title 空)', () => {
    const text = 'a'.repeat(3000);
    const r = splitChapters(text);
    expect(r.length).toBeGreaterThan(1);
    expect(r.every((c) => c.title === '')).toBe(true);
    // chunkSize=2000 → 3000 字分两段(2000 + 1000)
    expect(r).toHaveLength(2);
    expect(r[0].length).toBe(2000);
    expect(r[1].length).toBe(1000);
  });

  it('空文本 → 空数组', () => {
    expect(splitChapters('')).toEqual([]);
  });

  it('纯空白文本 → 空数组', () => {
    expect(splitChapters('   \n  \t  \n')).toEqual([]);
  });

  it('offset/length/text 三者一致(有标记)', () => {
    const text = '第一章 A\nbody1\n第二章 B\nbody2';
    const r = splitChapters(text);
    for (const c of r) {
      expect(c.text).toBe(text.slice(c.offset, c.offset + c.length));
      expect(c.length).toBe(c.text.length);
    }
    // 章节衔接:下一章 offset = 上一章 offset + length
    expect(r[1].offset).toBe(r[0].offset + r[0].length);
  });

  it('offset/length/text 三者一致(均分)', () => {
    const text = 'abcdefghij'.repeat(500); // 5000 字
    const r = splitChapters(text);
    for (const c of r) {
      expect(c.text).toBe(text.slice(c.offset, c.offset + c.length));
      expect(c.length).toBe(c.text.length);
    }
    // 无标记时,offset 从 0 起,覆盖整段原文
    expect(r[0].offset).toBe(0);
    const last = r[r.length - 1];
    expect(last.offset + last.length).toBe(text.length);
  });

  it('章节号从 1 连续递增', () => {
    const text = '一\n第一章 a\nx\n第二章 b\ny\n第三章 c\nz';
    const r = splitChapters(text);
    // 「一」单独不算(无「第N章」标记),前缀文本归入第一章
    expect(r).toHaveLength(3);
    r.forEach((c, i) => expect(c.chapterNo).toBe(i + 1));
  });

  it('章节标题含标记字符时正确剥离', () => {
    const text = '第1章 标题\n内容';
    const r = splitChapters(text);
    expect(r[0].title).toBe('标题');
    expect(r[0].text.startsWith('第1章')).toBe(true);
  });

  it('前缀文本(第一个标记前)并入第一章(offset 0 覆盖全文)', () => {
    const text = '楔子内容\n第一章 a\nbody';
    const r = splitChapters(text);
    expect(r).toHaveLength(1);
    expect(r[0].offset).toBe(0);
    expect(r[0].text).toContain('楔子内容');
  });

  it('title 行含「第N章」→ 该 marker 被当独立章切分(每章 title 正确剥离)', () => {
    const text = '第1章 这是第2章的伏笔\nbody';
    const r = splitChapters(text);
    expect(r).toHaveLength(2); // '第2章' 被 matchAll 当第二个 marker
    expect(r[0].title).toBe('这是');
    expect(r[1].title).toBe('的伏笔');
  });

  it('marker 无换行 → title 取到行尾', () => {
    const text = '第1章 标题 内容内容';
    const r = splitChapters(text);
    expect(r[0].title).toBe('标题 内容内容');
  });

  it('类型导出 SplitChapter 可引用', () => {
    const c: SplitChapter = {
      chapterNo: 1,
      title: '',
      offset: 0,
      length: 0,
      text: '',
    };
    expect(c.chapterNo).toBe(1);
  });
});
