import {
  buildAgentRoster,
  AGENT_TREE,
  collectSpecs,
} from './agent-tree.config';

describe('buildAgentRoster', () => {
  it('含全部已知角色(除 curator 自身)', () => {
    const roster = buildAgentRoster();
    expect(roster).toContain('【agent 名单');
    for (const name of [
      'main',
      'writer',
      'validator',
      'settler',
      'outline-critic',
      'wb-critic',
      'char-critic',
    ]) {
      expect(roster).toContain(name);
    }
    // curator 是生产者,不自标
    expect(roster).not.toContain('\n- curator:');
  });

  it('与 AGENT_TREE 同步:collectSpecs 去掉 curator 后一一对应', () => {
    const names = collectSpecs(AGENT_TREE)
      .map((s) => s.name)
      .filter((n) => n !== 'curator');
    const roster = buildAgentRoster();
    for (const n of names) expect(roster).toContain(n);
  });
});
