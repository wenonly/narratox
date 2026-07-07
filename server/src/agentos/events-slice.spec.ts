import { buildEventsSlice } from './events-slice';

describe('buildEventsSlice', () => {
  it('空返 ""', () => {
    expect(buildEventsSlice([])).toBe('');
  });

  it('格式化 + 早→晚(listRecentMajor 返 desc,reverse)+ 涉及角色/地点', () => {
    const s = buildEventsSlice([
      {
        chapterOrder: 5,
        description: '发现血书',
        involvedCharacters: ['陆青衫', '沈砚'],
        location: '藏书阁',
      },
      {
        chapterOrder: 3,
        description: '雨夜斩刺客',
        involvedCharacters: ['陆青衫'],
        location: '密室',
      },
    ]);
    expect(s).toBe(
      '【近期关键事件】第3章:雨夜斩刺客 涉及:陆青衫 @密室 / 第5章:发现血书 涉及:陆青衫/沈砚 @藏书阁\n(以上为最近 MAJOR 简表;需要 MINOR / 更早 / 某事件详情 → get_events 按需拉取)',
    );
  });

  it('无涉及角色/地点也正常(不拼空字段)', () => {
    const s = buildEventsSlice([{ chapterOrder: 1, description: '开局' }]);
    expect(s).toContain('第1章:开局');
    expect(s).not.toContain('涉及:');
    expect(s).not.toContain('@');
  });

  it('脚注引导 get_events 按需拉取', () => {
    const s = buildEventsSlice([{ chapterOrder: 1, description: 'x' }]);
    expect(s).toContain('get_events');
  });
});
