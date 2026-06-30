import { appendRoleReminder, buildTurnMessages } from './deep-agent.service';

describe('buildTurnMessages', () => {
  it('只返回 user 消息(reminder 已并入 systemPrompt,不再注入非首条 system)', () => {
    const msgs = buildTurnMessages('写第8章', 'mid-1');
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({
      role: 'user',
      content: '写第8章',
      id: 'mid-1',
    });
  });
});

describe('appendRoleReminder', () => {
  it('把 MAIN_ROLE_REMINDER 追加到 systemPrompt 末尾(并入首条 system)', () => {
    const out = appendRoleReminder('【小说态势】…');
    expect(out).toContain('【小说态势】…');
    expect(out).toContain('编排者');
    expect(out).toContain('task 委派');
    expect(out).toContain('交互式');
  });
});
