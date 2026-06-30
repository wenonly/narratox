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

describe('pickAgentConfig (override 优先,返回 config+temperatureOverride)', () => {
  it('有 override 用 override.config', () => {
    const map = new Map([
      ['writer', { config: override, temperatureOverride: 0.8 }],
    ]);
    expect(pickAgentConfig('writer', map, active).config.id).toBe('override');
    expect(pickAgentConfig('writer', map, active).temperatureOverride).toBe(
      0.8,
    );
  });
  it('无 override 回退 active,temperatureOverride=null', () => {
    const r = pickAgentConfig('writer', new Map(), active);
    expect(r.config.id).toBe('active');
    expect(r.temperatureOverride).toBeNull();
  });
  it('main agent key 也能 override', () => {
    const map = new Map([
      ['main', { config: override, temperatureOverride: null }],
    ]);
    expect(pickAgentConfig('main', map, active).config.id).toBe('override');
  });
});
