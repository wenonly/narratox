import { stripMarkdown, formatForPublish } from './publish';

describe('stripMarkdown', () => {
  it('去标题 #', () => {
    expect(stripMarkdown('# 标题\n正文')).toBe('标题\n正文');
  });
  it('去粗 ** 与斜 *', () => {
    expect(stripMarkdown('**粗**和*斜*')).toBe('粗和斜');
  });
  it('链接 [t](u) → t', () => {
    expect(stripMarkdown('[文](http://x)')).toBe('文');
  });
  it('图片 ![]() 删除', () => {
    expect(stripMarkdown('前![](u)后')).toBe('前后');
  });
  it('引用 > 与列表 - / 1.', () => {
    expect(stripMarkdown('> 引用\n- 项\n1. 项')).toBe('引用\n项\n项');
  });
  it('纯文本不损', () => {
    expect(stripMarkdown('就是普通一句话。')).toBe('就是普通一句话。');
  });
});

describe('formatForPublish', () => {
  const novel = { title: '测试书', synopsis: '这是简介。' };
  const chapters = [
    { order: 1, title: '开端', content: '# 一\n**粗**段落。' },
    { order: 2, title: '发展', content: '第二章正文。' },
    { order: 3, title: '高潮', content: '第三章。' },
  ];
  const baseOpts = {
    from: 0,
    to: 0,
    includeTitle: true,
    includeSynopsis: false,
    indent: false,
  };

  it('含章题行 + 多章顺序 + 章间分块', () => {
    const out = formatForPublish(novel, chapters, baseOpts);
    expect(out).toContain('第1章 开端');
    expect(out).toContain('第2章 发展');
    expect(out).toContain('一\n粗段落。');
    expect(out.indexOf('第1章')).toBeLessThan(out.indexOf('第2章'));
  });

  it('不含章题行', () => {
    const out = formatForPublish(novel, chapters, {
      ...baseOpts,
      from: 1,
      to: 1,
      includeTitle: false,
    });
    expect(out).not.toContain('第1章');
    expect(out).toContain('粗段落');
  });

  it('范围切片 from..to', () => {
    const out = formatForPublish(novel, chapters, {
      ...baseOpts,
      from: 2,
      to: 2,
    });
    expect(out).toContain('第2章 发展');
    expect(out).not.toContain('第1章');
    expect(out).not.toContain('第3章');
  });

  it('from=0/to=0 = 全部(clamp 到 min..max)', () => {
    const out = formatForPublish(novel, chapters, baseOpts);
    expect(out).toContain('第1章');
    expect(out).toContain('第3章');
  });

  it('含简介(开头)', () => {
    const out = formatForPublish(novel, chapters, {
      ...baseOpts,
      from: 1,
      to: 1,
      includeSynopsis: true,
    });
    expect(out.startsWith('这是简介。')).toBe(true);
  });

  it('缩进:段首全角空格×2', () => {
    const out = formatForPublish(novel, chapters, {
      ...baseOpts,
      from: 2,
      to: 2,
      includeTitle: false,
      indent: true,
    });
    expect(out.startsWith('　　')).toBe(true);
  });
});
