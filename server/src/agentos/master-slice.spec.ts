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

  it('格式化三幕转折点(含灵魂黑夜)', () => {
    const s = buildMasterOutlineSlice({
      theme: '凡人修仙',
      mainLine: '',
      ending: '',
      powerProgression: [],
      hiddenLines: [],
      volumeSplitLogic: '',
      threeAct: {
        act1Turn: { atVolume: 2, beat: '决心夺回家族荣光' },
        act2Turn: { atVolume: 5, beat: '盟友背叛,一无所有' },
        act3Turn: { atVolume: 6, beat: '斩天证道' },
      },
    });
    expect(s).toContain('三幕:');
    expect(s).toContain('一幕末(卷2):决心夺回家族荣光');
    expect(s).toContain('二幕末·灵魂黑夜(卷5):盟友背叛,一无所有');
    expect(s).toContain('三幕末(卷6):斩天证道');
  });

  it('threeAct 为空对象时不加三幕行(不破坏其他字段 + 全空仍空串)', () => {
    const withTheme = buildMasterOutlineSlice({
      theme: '凡人修仙',
      mainLine: '',
      ending: '',
      powerProgression: [],
      hiddenLines: [],
      volumeSplitLogic: '',
      threeAct: {},
    });
    expect(withTheme).toContain('【总纲】');
    expect(withTheme).not.toContain('三幕:');
    // 全空(含 threeAct:{})仍返空串
    expect(
      buildMasterOutlineSlice({
        theme: '',
        mainLine: '',
        ending: '',
        powerProgression: [],
        hiddenLines: [],
        volumeSplitLogic: '',
        threeAct: {},
      }),
    ).toBe('');
  });
});
