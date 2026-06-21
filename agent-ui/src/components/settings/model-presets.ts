import type { ModelProvider } from '@/types/settings'

export interface ModelPreset {
  id: string
  label: string
  provider: ModelProvider
  /** 默认 base URL(空串 = 走 provider 默认端点)。 */
  baseUrl: string
  model: string
}

/**
 * 预设厂商。OpenAI 兼容模式覆盖多个厂商(各自 baseUrl + model 预填);
 * Anthropic / Gemini 为原生。全部支持自定义 baseUrl 覆盖。
 *
 * 后端 model-factory 按 model 名进一步路由(如 deepseek → ChatDeepSeek)。
 */
export const MODEL_PROVIDER_PRESETS: ModelPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    provider: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat'
  },
  {
    id: 'glm',
    label: '智谱 GLM',
    provider: 'openai-compatible',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-plus'
  },
  {
    id: 'moonshot',
    label: 'Moonshot (Kimi)',
    provider: 'openai-compatible',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k'
  },
  {
    id: 'qwen',
    label: '通义千问',
    provider: 'openai-compatible',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus'
  },
  {
    id: 'openai',
    label: 'OpenAI',
    provider: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o'
  },
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    provider: 'anthropic',
    baseUrl: '',
    model: 'claude-sonnet-4-6'
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    provider: 'gemini',
    baseUrl: '',
    model: 'gemini-2.5-pro'
  }
]

/** 按 provider 类型找第一个匹配的预设(用于已存在配置的回显)。 */
export const presetByProvider = (provider: ModelProvider): ModelPreset =>
  MODEL_PROVIDER_PRESETS.find((p) => p.provider === provider) ??
  MODEL_PROVIDER_PRESETS[0]
