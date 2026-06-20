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

  it('openai-compatible 空 baseUrl → configuration.baseURL undefined(走默认端点)', () => {
    const spec = resolveModelSpec(cfg({ baseUrl: '' }), 16_000);
    const configuration = spec.args.configuration as { baseURL?: string };
    expect(configuration.baseURL).toBeUndefined();
  });

  it('anthropic 无 baseUrl → 不带 anthropicApiUrl(走默认端点)', () => {
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
    expect(spec.args).not.toHaveProperty('anthropicApiUrl');
  });

  it('anthropic 带 baseUrl → anthropicApiUrl', () => {
    const spec = resolveModelSpec(
      cfg({ provider: 'anthropic', baseUrl: 'https://proxy' }),
      6_000,
    );
    expect(spec.args).toMatchObject({ anthropicApiUrl: 'https://proxy' });
  });

  it('gemini 无 baseUrl → 不带 baseUrl 选项', () => {
    const spec = resolveModelSpec(
      cfg({ provider: 'gemini', baseUrl: '' }),
      6_000,
    );
    expect(spec.kind).toBe('gemini');
    expect(spec.args).toMatchObject({ apiKey: 'k', model: 'm' });
    expect(spec.args).not.toHaveProperty('baseUrl');
  });

  it('gemini 带 baseUrl → baseUrl 选项', () => {
    const spec = resolveModelSpec(
      cfg({ provider: 'gemini', baseUrl: 'https://proxy' }),
      6_000,
    );
    expect(spec.args).toMatchObject({ baseUrl: 'https://proxy' });
  });

  it('temperature 覆盖默认', () => {
    const spec = resolveModelSpec(cfg({ temperature: 0.1 }), 16_000);
    expect(spec.args).toMatchObject({ temperature: 0.1 });
  });
});
