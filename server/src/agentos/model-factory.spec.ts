import { resolveModelSpec } from './model-factory';

const cfg = (over: Partial<Parameters<typeof resolveModelSpec>[0]>) => ({
  id: 'c1',
  provider: 'openai-compatible',
  model: 'm',
  baseUrl: 'https://x',
  apiKey: 'k',
  temperature: null,
  ...over,
});

describe('resolveModelSpec', () => {
  it('openai-compatible → openai 构造参数(含 baseURL,默认 temp 0.5)', () => {
    const spec = resolveModelSpec(cfg({}), 16_000);
    expect(spec.kind).toBe('openai');
    expect(spec.args).toMatchObject({
      apiKey: 'k',
      model: 'm',
      configuration: { baseURL: 'https://x' },
      temperature: 0.5,
      maxTokens: 16_000,
      maxRetries: 0,
    });
  });

  it('anthropic → anthropic 构造参数(无 configuration)', () => {
    const spec = resolveModelSpec(
      cfg({ provider: 'anthropic', baseUrl: null }),
      6_000,
    );
    expect(spec.kind).toBe('anthropic');
    expect(spec.args).toMatchObject({
      apiKey: 'k',
      model: 'm',
      maxTokens: 6_000,
    });
    expect(spec.args).not.toHaveProperty('configuration');
  });

  it('gemini → gemini 构造参数', () => {
    const spec = resolveModelSpec(
      cfg({ provider: 'gemini', baseUrl: null }),
      6_000,
    );
    expect(spec.kind).toBe('gemini');
    expect(spec.args).toMatchObject({ apiKey: 'k', model: 'm' });
  });

  it('temperature 覆盖默认', () => {
    const spec = resolveModelSpec(cfg({ temperature: 0.1 }), 16_000);
    expect(spec.args).toMatchObject({ temperature: 0.1 });
  });
});
