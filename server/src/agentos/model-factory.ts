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

  // 默认 openai-compatible(GLM / DeepSeek / Moonshot / Qwen / OpenAI …)
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
  const model = new ChatOpenAI(spec.args as never);

  // DeepSeek/GLM thinking 模式兼容:patch .invoke/.stream,在每次 API 调用前
  // 从 input messages strip additional_kwargs.reasoning_content。
  // 否则 DeepSeek 400「reasoning_content must be passed back to the API」。
  // (ChatOpenAI 序列化时不带 additional_kwargs 非标字段 → DeepSeek 检测到
  //  thinking 模式的响应丢了 reasoning_content → 报错。)
  // 思考 token 仍通过 stream chunks 被 activity emitter 捕获(FE 可见)。
  const stripFromInput = (input: unknown) => {
    const msgs = Array.isArray(input)
      ? input
      : (input as { messages?: unknown[] })?.messages;
    if (!Array.isArray(msgs)) return;
    for (const m of msgs as Array<{ additional_kwargs?: Record<string, unknown> }>) {
      if (m?.additional_kwargs?.reasoning_content !== undefined) {
        delete m.additional_kwargs.reasoning_content;
      }
    }
  };
  const origInvoke = model.invoke.bind(model);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (model as any).invoke = async (input: any, options?: any) => {
    stripFromInput(input);
    return origInvoke(input, options);
  };
  const origStream = model.stream.bind(model);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (model as any).stream = async function* (input: any, options?: any) {
    stripFromInput(input);
    yield* origStream(input, options);
  };

  return model;
}
