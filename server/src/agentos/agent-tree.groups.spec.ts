import {
  AGENT_TREE,
  buildAgentGroups,
  collectSpecs,
  type RecommendedTier,
} from './agent-tree.config';

describe('agent-tree per-agent config', () => {
  it('每个 spec 都标了 recommendedTier', () => {
    const missing = collectSpecs(AGENT_TREE).filter((s) => !s.recommendedTier);
    expect(missing.map((s) => s.name)).toEqual([]);
  });

  it('recommendedTier 只取 strong/mid/cheap', () => {
    const tiers = collectSpecs(AGENT_TREE).map((s) => s.recommendedTier);
    const valid: RecommendedTier[] = ['strong', 'mid', 'cheap'];
    tiers.forEach((t) => expect(valid).toContain(t));
  });

  it('buildAgentGroups 把 main 单列,每个 orchestrator 自成一组(含子孙)', () => {
    const groups = buildAgentGroups();
    const names = groups.map((g) => g.group);
    expect(names).toContain('main');
    expect(names).toContain('chapter');
    const chapterGroup = groups.find((g) => g.group === 'chapter')!;
    expect(chapterGroup.agents.map((a) => a.key)).toEqual(
      expect.arrayContaining(['chapter', 'writer', 'settler', 'validator']),
    );
  });

  it('每个 agent 条目带 key/description/recommendedTier', () => {
    const groups = buildAgentGroups();
    const mainAgent = groups
      .find((g) => g.group === 'main')!
      .agents.find((a) => a.key === 'main')!;
    expect(mainAgent.description).toBeTruthy();
    expect(mainAgent.recommendedTier).toBe('strong');
  });
});
