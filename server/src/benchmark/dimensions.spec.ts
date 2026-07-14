import {
  BENCHMARK_DIMENSIONS,
  BENCHMARK_TYPES,
  DIM_BY_KEY,
  MATERIAL_KINDS,
  MATERIAL_PURPOSES,
} from './dimensions';

describe('benchmark dimensions 单源', () => {
  it('8 个维度,含 MATERIAL / VOICE_PROFILE', () => {
    expect(BENCHMARK_TYPES).toEqual([
      'CHAPTER',
      'PLOT',
      'RHYTHM',
      'EMOTION',
      'CHARACTER',
      'STYLE',
      'MATERIAL',
      'VOICE_PROFILE',
    ]);
  });

  it('每维度有 label/color/tab', () => {
    for (const d of BENCHMARK_DIMENSIONS) {
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.color.startsWith('#')).toBe(true);
      expect(['list', 'reading', 'material']).toContain(d.tab);
    }
  });

  it('DIM_BY_KEY 覆盖所有 type', () => {
    for (const t of BENCHMARK_TYPES) {
      expect(DIM_BY_KEY[t]).toBeDefined();
    }
  });

  it('MATERIAL_KINDS / PURPOSES 非空且唯一', () => {
    expect(new Set(MATERIAL_KINDS).size).toBe(MATERIAL_KINDS.length);
    expect(new Set(MATERIAL_PURPOSES).size).toBe(MATERIAL_PURPOSES.length);
    expect(MATERIAL_KINDS.length).toBeGreaterThan(0);
    expect(MATERIAL_PURPOSES.length).toBeGreaterThan(0);
  });
});
