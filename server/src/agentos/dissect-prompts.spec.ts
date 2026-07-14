import {
  DISSECT_MAIN_PROMPT,
  CHAPTER_EXTRACTOR_PROMPT,
  PLOT_ANALYST_PROMPT,
  CHARACTER_EXTRACTOR_PROMPT,
  STYLE_ANALYST_PROMPT,
  MATERIAL_EXTRACTOR_PROMPT,
  VOICE_PROFILE_EXTRACTOR_PROMPT,
  DISSECT_CRITIC_PROMPT,
} from './dissect-prompts';
import {
  DISSECT_PROMPTS,
  DISSECT_TREE,
  collectDissectSpecs,
} from './dissect-tree.config';

const ALL = {
  DISSECT_MAIN_PROMPT,
  CHAPTER_EXTRACTOR_PROMPT,
  PLOT_ANALYST_PROMPT,
  CHARACTER_EXTRACTOR_PROMPT,
  STYLE_ANALYST_PROMPT,
  MATERIAL_EXTRACTOR_PROMPT,
  VOICE_PROFILE_EXTRACTOR_PROMPT,
  DISSECT_CRITIC_PROMPT,
};

describe('dissect-prompts (runtime loader from prompts/dissect-*.md)', () => {
  it('8 个常量都非空,loader 裁了头尾空白', () => {
    for (const val of Object.values(ALL)) {
      expect(typeof val).toBe('string');
      expect(val.length).toBeGreaterThan(0);
      expect(val[0]).not.toBe(' ');
      expect(val.trim()).toBe(val);
    }
    expect(Object.keys(ALL)).toHaveLength(8);
  });

  it('body 不泄漏 frontmatter', () => {
    for (const val of Object.values(ALL)) {
      expect(val.startsWith('---')).toBe(false);
      expect(val.match(/^name: /m)).toBeNull();
    }
  });

  const SUBSTRINGS: Record<string, string> = {
    MATERIAL_EXTRACTOR_PROMPT: '【套用场景】',
    DISSECT_MAIN_PROMPT: '【交互式编排者】',
    PLOT_ANALYST_PROMPT: '起承转合',
    VOICE_PROFILE_EXTRACTOR_PROMPT: '语调与节奏',
    DISSECT_CRITIC_PROMPT: 'report_dissect_review',
  };
  it('关键 prompt 含特征子串', () => {
    for (const [name, sub] of Object.entries(SUBSTRINGS)) {
      expect((ALL as Record<string, string>)[name]).toContain(sub);
    }
  });

  it('DISSECT_PROMPTS key 集合 == DISSECT_TREE 所有 promptKey', () => {
    const treeKeys = new Set(
      collectDissectSpecs(DISSECT_TREE).map((s) => s.promptKey),
    );
    const mapKeys = new Set(Object.keys(DISSECT_PROMPTS));
    expect(treeKeys).toEqual(mapKeys);
    for (const v of Object.values(DISSECT_PROMPTS)) {
      expect(typeof v === 'string' && v.length > 0).toBe(true);
    }
  });
});
