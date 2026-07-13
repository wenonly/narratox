import {
  WRITER_AGENT_PROMPT,
  MAIN_ROLE_REMINDER,
  MAIN_AGENT_PROMPT,
  CHAPTER_ORCHESTRATOR_PROMPT,
  SETTLER_AGENT_PROMPT,
  VALIDATOR_AGENT_PROMPT,
  CURATOR_AGENT_PROMPT,
  WORLDBUILDER_ORCHESTRATOR_PROMPT,
  WORLDBUILDER_WRITER_PROMPT,
  WORLDBUILDER_CRITIC_PROMPT,
  OUTLINER_ORCHESTRATOR_PROMPT,
  OUTLINE_WRITER_PROMPT,
  OUTLINE_CRITIC_PROMPT,
  CHARACTER_ORCHESTRATOR_PROMPT,
  CHARACTER_WRITER_PROMPT,
  CHARACTER_CRITIC_PROMPT,
} from './agent-prompts';
import { AGENT_TREE, PROMPTS, collectSpecs } from './agent-tree.config';

const ALL = {
  WRITER_AGENT_PROMPT,
  MAIN_ROLE_REMINDER,
  MAIN_AGENT_PROMPT,
  CHAPTER_ORCHESTRATOR_PROMPT,
  SETTLER_AGENT_PROMPT,
  VALIDATOR_AGENT_PROMPT,
  CURATOR_AGENT_PROMPT,
  WORLDBUILDER_ORCHESTRATOR_PROMPT,
  WORLDBUILDER_WRITER_PROMPT,
  WORLDBUILDER_CRITIC_PROMPT,
  OUTLINER_ORCHESTRATOR_PROMPT,
  OUTLINE_WRITER_PROMPT,
  OUTLINE_CRITIC_PROMPT,
  CHARACTER_ORCHESTRATOR_PROMPT,
  CHARACTER_WRITER_PROMPT,
  CHARACTER_CRITIC_PROMPT,
};

describe('agent-prompts (runtime loader from prompts/*.md)', () => {
  it('16 个常量都是非空字符串', () => {
    for (const [name, val] of Object.entries(ALL)) {
      expect(typeof val).toBe('string');
      expect(val.length).toBeGreaterThan(0);
      // loader 必须把 body 头尾空白裁掉(无前导空白)
      expect(val[0]).not.toBe(' ');
      expect(val.trim()).toBe(val);
    }
    expect(Object.keys(ALL)).toHaveLength(16);
  });

  it('body 不泄漏 frontmatter(每个都不以 --- 开头)', () => {
    for (const val of Object.values(ALL)) {
      expect(val.startsWith('---')).toBe(false);
      // 不应出现裸 frontmatter 字段名行
      expect(val.match(/^name: /m)).toBeNull();
    }
  });

  it('关键 prompt 的开头正确(MAIN/WRITER)', () => {
    expect(MAIN_AGENT_PROMPT.startsWith('你是')).toBe(true);
    expect(WRITER_AGENT_PROMPT.startsWith('你是一位')).toBe(true);
    expect(MAIN_ROLE_REMINDER.startsWith('【职责提醒】')).toBe(true);
  });

  // 迁移逐字保真:每个 prompt 锁一个特征子串(body 里独特、不日常改动的句子)。
  // 改了对应 md 的这句 → 这里挂;证明 loader 读到的就是 md 的 body。
  const SUBSTRINGS: Record<string, string> = {
    WRITER_AGENT_PROMPT: '【写前必读 step 0 — 动笔前一次性把上下文读齐】',
    MAIN_AGENT_PROMPT: '你是【交互式编排者】',
    MAIN_ROLE_REMINDER: '每轮【只做一件事】',
    CHAPTER_ORCHESTRATOR_PROMPT: '写→结算→校验',
    SETTLER_AGENT_PROMPT: '每个必标 payoffTiming',
    VALIDATOR_AGENT_PROMPT: '细纲兑现',
    CURATOR_AGENT_PROMPT: '增量维护',
    WORLDBUILDER_ORCHESTRATOR_PROMPT: '取KB→建条目→评审',
    WORLDBUILDER_WRITER_PROMPT: '遵循 KB 五字诀',
    WORLDBUILDER_CRITIC_PROMPT: 'report_worldview_review',
    OUTLINER_ORCHESTRATOR_PROMPT: '改写细纲(因正文偏离)',
    OUTLINE_WRITER_PROMPT: '立总纲(全书北极星',
    OUTLINE_CRITIC_PROMPT: 'report_outline_review',
    CHARACTER_ORCHESTRATOR_PROMPT: '取KB→建档案→评审',
    CHARACTER_WRITER_PROMPT: '弧光目标 arcGoal',
    CHARACTER_CRITIC_PROMPT: 'report_character_review',
  };
  it('每个 prompt 含其特征子串(迁移逐字保真)', () => {
    for (const [name, sub] of Object.entries(SUBSTRINGS)) {
      expect((ALL as Record<string, string>)[name]).toContain(sub);
    }
  });

  it('outliner-orchestrator 含 4 类路由表与简化路线铁律', () => {
    expect(OUTLINER_ORCHESTRATOR_PROMPT).toContain('【任务路由】');
    expect(OUTLINER_ORCHESTRATOR_PROMPT).toContain('微调/删除类任务');
    expect(OUTLINER_ORCHESTRATOR_PROMPT).toContain('不调 outline-critic');
  });

  it('outline-writer 含减法任务禁止补全纪律', () => {
    expect(OUTLINE_WRITER_PROMPT).toContain('减法任务完成后');
    expect(OUTLINE_WRITER_PROMPT).toContain('禁止顺手调用');
  });

  it('PROMPTS 的 key 集合 == AGENT_TREE 所有 promptKey(防「加 promptKey 却没建 md」)', () => {
    const treeKeys = new Set(collectSpecs(AGENT_TREE).map((s) => s.promptKey));
    const mapKeys = new Set(Object.keys(PROMPTS));
    expect(treeKeys).toEqual(mapKeys);
    // 每个 PROMPTS 值都非空
    for (const v of Object.values(PROMPTS)) {
      expect(typeof v === 'string' && v.length > 0).toBe(true);
    }
  });
});
