import { pickAgentConfig } from './deep-agent.service';
import type { ModelConfigRecord } from './model-factory';

const active: ModelConfigRecord = {
  id: 'active',
  provider: 'p',
  model: 'm',
  baseUrl: null,
  apiKey: 'k',
  temperature: 0.5,
  updatedAt: new Date(0),
};
const override: ModelConfigRecord = { ...active, id: 'override' };

describe('pickAgentConfig (override 优先)', () => {
  it('有 override 用 override', () => {
    const map = new Map([['writer', override]]);
    expect(pickAgentConfig('writer', map, active).id).toBe('override');
  });

  it('无 override 回退 active', () => {
    expect(pickAgentConfig('writer', new Map(), active).id).toBe('active');
  });

  it('main agent key 也能被 override(root path, 经 mainModel)', () => {
    const map = new Map([['main', override]]);
    expect(pickAgentConfig('main', map, active).id).toBe('override');
  });
});
