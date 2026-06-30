import { splitSentences, check } from './prose-guard';

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

describe('check · blocking', () => {
  it('逐字复读:相邻整行完全相同且≥8字 → blocking', () => {
    const r = check('陆青衫站在雨中看着远方。\n陆青衫站在雨中看着远方。');
    expect(r.blocking.some((f) => f.type === 'verbatim-repeat')).toBe(true);
    expect(r.nextAction).toBe('revise');
  });

  it('排比(相似非全等)不命中复读', () => {
    const r = check('他笑了,笑得很大声。\n他哭了,哭得很伤心。');
    expect(r.blocking.some((f) => f.type === 'verbatim-repeat')).toBe(false);
  });

  it('落盘失败:<500字节 且 末行无终止标点 → blocking truncation', () => {
    const r = check('他走进了房间'); // 6字,无终止标点
    expect(r.blocking.some((f) => f.type === 'truncation')).toBe(true);
  });

  it('正常短章不误判 truncation(有终止标点)', () => {
    const r = check('他走进了房间。');
    expect(r.blocking.some((f) => f.type === 'truncation')).toBe(false);
  });

  it('拒绝语(非对话行)→ blocking refusal', () => {
    const r = check('作为人工智能,我无法继续生成。');
    expect(r.blocking.some((f) => f.type === 'refusal')).toBe(true);
  });

  it('对话行里的 Sure 不命中拒绝语', () => {
    const r = check('「Sure,为什么不可以。」');
    expect(r.blocking.some((f) => f.type === 'refusal')).toBe(false);
  });

  it('工程词泄漏 tier1(CBN/任务描述等)→ blocking leak-tier1', () => {
    const r = check('本章的 CBN 是主角觉醒。');
    expect(r.blocking.some((f) => f.type === 'leak-tier1')).toBe(true);
  });

  it('干净正文无 blocking,nextAction 非 revise', () => {
    const r = check('陆青衫站在雨中。刀尖滴血。他抬头望向远方的城楼,心中升起一股不安。');
    expect(r.blocking).toHaveLength(0);
    expect(r.nextAction).not.toBe('revise');
  });
});
