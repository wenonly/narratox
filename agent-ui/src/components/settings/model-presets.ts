import type { ModelProvider } from '@/types/settings'

export interface ProviderPreset {
  provider: ModelProvider
  label: string
  /** 空 = 走 provider 默认端点。 */
  baseUrl: string
}

/**
 * Provider 预设,供「新建厂商」表单预填 baseUrl。
 * 选 provider → 自动填默认 baseUrl(空串表示走原生端点)。
 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  { provider: 'anthropic', label: 'Anthropic 兼容(如智谱 GLM)', baseUrl: '' },
  { provider: 'openai-compatible', label: 'OpenAI 兼容', baseUrl: '' },
  {
    provider: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com'
  },
  { provider: 'gemini', label: 'Google Gemini', baseUrl: '' }
]

/** 按 provider 类型找预设,用于已存在厂商表单回显。 */
export const presetByProvider = (provider: ModelProvider): ProviderPreset =>
  PROVIDER_PRESETS.find((p) => p.provider === provider) ?? PROVIDER_PRESETS[0]
