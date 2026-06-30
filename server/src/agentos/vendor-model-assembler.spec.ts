import { assembleModelConfig } from './vendor-model-assembler';

const model = {
  id: 'm1',
  model: 'glm-4-air',
  temperature: 0.7,
  updatedAt: new Date(0),
};
const vendor = {
  provider: 'anthropic',
  baseUrl: 'https://x/api/anthropic',
  apiKey: 'sk-x',
};

describe('assembleModelConfig', () => {
  it('Model + Vendor → ModelConfigRecord', () => {
    const r = assembleModelConfig(model, vendor);
    expect(r).toMatchObject({
      id: 'm1',
      model: 'glm-4-air',
      temperature: 0.7,
      provider: 'anthropic',
      baseUrl: 'https://x/api/anthropic',
      apiKey: 'sk-x',
    });
  });
  it('temperature null → 透传 null(由 resolveModelSpec 兜底为 0.5)', () => {
    const r = assembleModelConfig({ ...model, temperature: null }, vendor);
    expect(r.temperature).toBeNull();
  });
  it('baseUrl null → 透传 null', () => {
    const r = assembleModelConfig(model, { ...vendor, baseUrl: null });
    expect(r.baseUrl).toBeNull();
  });
});
