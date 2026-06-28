import { buildMasterOutlineSlice } from './master-slice';

describe('buildMasterOutlineSlice', () => {
  it('无总纲返空串', () => {
    expect(buildMasterOutlineSlice(null)).toBe('');
  });

  it('格式化各字段 + 力量曲线 + 暗线时刻表', () => {
    const s = buildMasterOutlineSlice({
      theme: '凡人修仙',
      mainLine: '主角从废柴到飞升',
      ending: '破开天界',
      powerProgression: [{ volume: 1, level: '炼气→筑基', note: '宗门考核' }],
      hiddenLines: [
        { name: '身世', type: '身世', plant: '卷1', advance: ['卷3'], reveal: '卷6' },
      ],
      volumeSplitLogic: '按境界分卷',
    });
    expect(s).toContain('【总纲】');
    expect(s).toContain('凡人修仙');
    expect(s).toContain('炼气→筑基');
    expect(s).toContain('身世');
    expect(s).toContain('卷6');
  });

  it('空总纲(全默认)返空串,不注入噪声', () => {
    expect(
      buildMasterOutlineSlice({
        theme: '',
        mainLine: '',
        ending: '',
        powerProgression: [],
        hiddenLines: [],
        volumeSplitLogic: '',
      }),
    ).toBe('');
  });
});
