import { splitSentences } from './prose-guard';

describe('splitSentences', () => {
  it('按中文终止标点切句,标注长度', () => {
    const s = splitSentences('陆青衫站在雨中。刀尖滴血。');
    expect(s.map((x) => x.len)).toEqual([8, 5]); // 含终止标点
    expect(s.every((x) => !x.isDialogue)).toBe(true);
  });

  it('纯对话行标 isDialogue(不计入句长检测)', () => {
    const s = splitSentences('「你来啦。」');
    expect(s).toHaveLength(1);
    expect(s[0].isDialogue).toBe(true);
  });

  it('空内容返空数组', () => {
    expect(splitSentences('')).toEqual([]);
  });

  it('多行逐行处理', () => {
    const s = splitSentences('第一句。\n第二句。\n');
    expect(s).toHaveLength(2);
  });
});
