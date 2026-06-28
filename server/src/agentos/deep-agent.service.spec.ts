import { buildTurnMessages } from './deep-agent.service';

describe('buildTurnMessages', () => {
  it('每轮前置 system 职责提醒 + user 消息', () => {
    const msgs = buildTurnMessages('写第8章', 'mid-1');
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({ role: 'system' });
    const sys = (msgs[0] as { content: string }).content;
    expect(sys).toContain('编排者');
    expect(sys).toContain('task 委派');
    expect(sys).toContain('交互式');
    expect(msgs[1]).toMatchObject({
      role: 'user',
      content: '写第8章',
      id: 'mid-1',
    });
  });
});
