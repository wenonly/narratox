export interface ModelConfigRecord {
  id: string;
  provider: string;
  model: string;
  baseUrl: string | null;
  apiKey: string;
  temperature: number | null;
}

type ChatModelSpec =
  | { kind: 'openai'; args: Record<string, unknown> }
  | { kind: 'anthropic'; args: Record<string, unknown> }
  | { kind: 'gemini'; args: Record<string, unknown> };

/** 纯路由:按 provider 选构造器 + 组参数(不含任何 import,好测)。 */
export function resolveModelSpec(
  config: ModelConfigRecord,
  maxTokens: number,
): ChatModelSpec {
  const temperature = config.temperature ?? 0.5;
  if (config.provider === 'anthropic') {
    return {
      kind: 'anthropic',
      args: {
        apiKey: config.apiKey,
        model: config.model,
        maxTokens,
        temperature,
      },
    };
  }
  if (config.provider === 'gemini') {
    return {
      kind: 'gemini',
      args: {
        apiKey: config.apiKey,
        model: config.model,
        maxTokens,
        temperature,
      },
    };
  }
  // 默认 openai-compatible(GLM / DeepSeek / Moonshot / Qwen / OpenAI …)
  return {
    kind: 'openai',
    args: {
      apiKey: config.apiKey,
      model: config.model,
      configuration: { baseURL: config.baseUrl ?? undefined },
      temperature,
      timeout: 120_000,
      maxRetries: 0,
      maxTokens,
    },
  };
}

/** 实例化:动态 import 三套 chat 类(保持 Jest collection 干净)。 */
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
  const { ChatOpenAI } = await import('@langchain/openai');
  return new ChatOpenAI(spec.args as never);
}
