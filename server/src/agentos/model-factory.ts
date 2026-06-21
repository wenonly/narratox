export interface ModelConfigRecord {
  id: string;
  provider: string;
  model: string;
  baseUrl: string | null;
  apiKey: string;
  temperature: number | null;
}

type ChatModelSpec =
  | { kind: 'deepseek'; args: Record<string, unknown> }
  | { kind: 'openai'; args: Record<string, unknown> }
  | { kind: 'anthropic'; args: Record<string, unknown> }
  | { kind: 'gemini'; args: Record<string, unknown> };

/** 规整 baseUrl:空串/纯空白视为未设置(走 provider 默认端点)。 */
function normalizeBaseUrl(baseUrl: string | null): string | undefined {
  const trimmed = (baseUrl ?? '').trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * 纯路由:按 provider 选构造器 + 组参数(不含任何 import,好测)。
 * 三种 provider 都支持自定义 baseUrl(留空走各自默认端点):
 *  - openai-compatible → ChatOpenAI 的 configuration.baseURL
 *  - anthropic         → ChatAnthropic 的 anthropicApiUrl
 *  - gemini            → ChatGoogleGenerativeAI 的 baseUrl
 */
export function resolveModelSpec(
  config: ModelConfigRecord,
  maxTokens: number,
): ChatModelSpec {
  const temperature = config.temperature ?? 0.5;
  const baseUrl = normalizeBaseUrl(config.baseUrl);

  if (config.provider === 'anthropic') {
    const args: Record<string, unknown> = {
      apiKey: config.apiKey,
      model: config.model,
      maxTokens,
      temperature,
    };
    if (baseUrl) args.anthropicApiUrl = baseUrl;
    return { kind: 'anthropic', args };
  }

  if (config.provider === 'gemini') {
    const args: Record<string, unknown> = {
      apiKey: config.apiKey,
      model: config.model,
      maxTokens,
      temperature,
    };
    if (baseUrl) args.baseUrl = baseUrl;
    return { kind: 'gemini', args };
  }

  // DeepSeek:用原生 ChatDeepSeek(正确处理 reasoning_content 往返)。
  if (config.model.toLowerCase().includes('deepseek')) {
    return {
      kind: 'deepseek',
      args: {
        apiKey: config.apiKey,
        model: config.model,
        configuration: { baseURL: baseUrl },
        temperature,
        timeout: 120_000,
        maxRetries: 0,
        maxTokens,
      },
    };
  }

  // 其他 openai-compatible(GLM / Moonshot / Qwen / OpenAI …)
  return {
    kind: 'openai',
    args: {
      apiKey: config.apiKey,
      model: config.model,
      configuration: { baseURL: baseUrl },
      temperature,
      timeout: 120_000,
      maxRetries: 0,
      maxTokens,
    },
  };
}

/** 实例化:动态 import 四套 chat 类(保持 Jest collection 干净)。 */
export async function buildChatModel(
  config: ModelConfigRecord,
  maxTokens: number,
) {
  const spec = resolveModelSpec(config, maxTokens);
  if (spec.kind === 'anthropic') {
    const { ChatAnthropic } = await import('@langchain/anthropic');
    return new ChatAnthropic(spec.args as never);
  }
  if (spec.kind === 'gemini') {
    const { ChatGoogleGenerativeAI } = await import('@langchain/google-genai');
    return new ChatGoogleGenerativeAI(spec.args as never);
  }
  if (spec.kind === 'deepseek') {
    const { ChatDeepSeek } = await import('@langchain/deepseek');
    return new ChatDeepSeek(spec.args as never);
  }
  const { ChatOpenAI } = await import('@langchain/openai');
  return new ChatOpenAI(spec.args as never);
}
