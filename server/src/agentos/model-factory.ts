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

  // DeepSeek:原生 ChatDeepSeek + monkey-patch reasoning_content 往返。
  // LangChain 的 _convertMessageToDict 丢 additional_kwargs.reasoning_content
  // → DeepSeek 400 "must be passed back"(langchain#37177 / langchainjs#10883)。
  // patch:序列化 AIMessage 时把 reasoning_content 从 additional_kwargs 写回 dict。
  if (config.provider === 'deepseek') {
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
    const model = new ChatDeepSeek(spec.args as never);
    patchDeepSeekReasoningPassback(model as unknown as PatchableModel);
    return model;
  }
  const { ChatOpenAI } = await import('@langchain/openai');
  return new ChatOpenAI(spec.args as never);
}

/**
 * ChatDeepSeek 的私有序列化方法按名动态访问/覆写,故用宽松的索引签名刻画;
 * 调用方把 ChatDeepSeek 实例经 `unknown` 转入(类实例不带索引签名,无法直接赋值)。
 */
type PatchableModel = {
  [method: string]: ((...args: unknown[]) => unknown) | undefined;
};

/**
 * Monkey-patch ChatDeepSeek:修复 LangChain 序列化 AIMessage 时丢弃
 * additional_kwargs.reasoning_content 的 bug(langchain#37177)。
 *
 * DeepSeek V4 thinking 模式要求多轮对话中 assistant 消息的 reasoning_content
 * 必须传回 API。ChatOpenAI._convertMessageToDict() 不带 additional_kwargs
 * → DeepSeek 400 "must be passed back"。
 *
 * 修法:patch 序列化方法,把 reasoning_content 从 additional_kwargs 写回 dict。
 * 思考 token 仍在 stream 阶段到达 FE;此处只修「回传」不修「接收」。
 */

function patchDeepSeekReasoningPassback(model: PatchableModel) {
  const candidates = ['_convertMessageToDict', '_convertMessagesToChatParams'];
  for (const methodName of candidates) {
    const orig = model[methodName];
    if (typeof orig !== 'function') continue;
    model[methodName] = function (this: unknown, ...args: unknown[]) {
      // orig.apply 经 Function.apply 返回 any;orig 的签名承诺 unknown,显式断言。
      const result = orig.apply(this, args) as unknown;
      const patchDict = (dict: Record<string, unknown>, msg: unknown): void => {
        const m = msg as {
          _getType?: () => string;
          additional_kwargs?: Record<string, unknown>;
        };
        if (
          m?._getType?.() === 'ai' &&
          m?.additional_kwargs?.reasoning_content !== undefined &&
          dict &&
          dict.role === 'assistant'
        ) {
          dict.reasoning_content = m.additional_kwargs.reasoning_content;
        }
      };
      const messages = args[0];
      if (Array.isArray(result) && Array.isArray((result as unknown[])[0])) {
        const dicts = (result as unknown[])[0] as Record<string, unknown>[];
        const msgs = Array.isArray(messages) ? messages : [];
        for (let i = 0; i < dicts.length; i++) {
          patchDict(dicts[i], (msgs as unknown[])[i]);
        }
      } else if (typeof result === 'object' && result !== null) {
        patchDict(result as Record<string, unknown>, messages);
      }

      return result;
    };
    break;
  }
}
