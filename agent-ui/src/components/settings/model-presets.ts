import type { ModelProvider } from '@/types/settings'

export interface ModelPreset {
  id: string
  label: string
  provider: ModelProvider
  /** 默认 base URL(空串 = 走 provider 默认端点;三种 provider 都可在此覆盖/填代理)。 */
  baseUrl: string
  model: string
}

/**
 * 三种通用厂商。OpenAI 兼容模式覆盖 GLM / DeepSeek / Moonshot / Qwen / OpenAI 等
 * (改 baseUrl + model 即可);Anthropic / Gemini 为原生。三种都支持自定义 baseUrl。
 */
export const MODEL_PROVIDER_PRESETS: ModelPreset[] = [
  {
    id: 'openai',
    label: 'OpenAI 兼容',
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
