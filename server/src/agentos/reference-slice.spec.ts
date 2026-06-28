import { buildReferenceSlice } from './reference-slice';

const ref = (
  injectTo: string | null,
  title: string,
  category = '分类',
  content = '正文',
) => ({ injectTo, title, category, content });

describe('buildReferenceSlice', () => {
  it('命中本角色精要 + 全量索引', () => {
    const refs = [
      ref('writer', '写手精要', '方法论', '写战斗要点'),
      ref(null, '战斗词汇', '词汇'),
      ref('main', '主精要', '方法论'),
    ];
    const s = buildReferenceSlice('writer', refs);
    expect(s).toContain('【写作参考】');
    expect(s).toContain('写手精要');
    expect(s).toContain('写战斗要点');
    // 索引含全量(含 null 与别的角色)
    expect(s).toContain('战斗词汇');
    expect(s).toContain('主精要');
    // 按需、勿盲查脚注
    expect(s).toContain('get_reference');
    expect(s).toContain('勿查');
  });

  it("'both' 命中任意 role(兼容)", () => {
    const refs = [ref('both', '通用精要')];
    expect(buildReferenceSlice('writer', refs)).toContain('通用精要');
    expect(buildReferenceSlice('validator', refs)).toContain('通用精要');
  });

  it('无精要返空串(不注入)', () => {
    const refs = [ref(null, '库条目'), ref('main', '主精要')];
    expect(buildReferenceSlice('validator', refs)).toBe('');
  });

  it('top6 截断 + 500 字截断', () => {
    const refs = Array.from({ length: 8 }, (_, i) =>
      ref('writer', `精要${i}`, 'c', 'X'.repeat(600)),
    );
    const s = buildReferenceSlice('writer', refs);
    expect((s.match(/### /g) || []).length).toBe(6);
    // 每条精要正文截到 500,不含完整 600
    expect(s).not.toContain('X'.repeat(600));
    expect(s).toContain('X'.repeat(500));
  });
});
