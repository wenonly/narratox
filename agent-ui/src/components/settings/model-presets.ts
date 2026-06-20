import type { ModelProvider } from '@/types/settings'

export interface ModelPreset {
  id: string
  label: string
  provider: ModelProvider
  baseUrl: string | null
  model: string
  needsBaseUrl: boolean
}

/** 选厂商时自动带出 baseUrl + 默认 model(用户可改)。 */
export const MODEL_PROVIDER_PRESETS: ModelPreset[] = [
  {
    id: 'glm',
    label: '智谱 GLM',
    provider: 'openai-compatible',
    baseUrl: 'https://api.z.ai/api/coding/paas/v4',
    model: 'GLM-5.2',
    needsBaseUrl: true
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    provider: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    needsBaseUrl: true
  },
  {
    id: 'moonshot',
    label: 'Moonshot (Kimi)',
    provider: 'openai-compatible',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-32k',
    needsBaseUrl: true
  },
  {
    id: 'qwen',
    label: '通义千问',
    provider: 'openai-compatible',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    needsBaseUrl: true
  },
  {
    id: 'openai',
    label: 'OpenAI',
    provider: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
    needsBaseUrl: true
  },
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    provider: 'anthropic',
    baseUrl: null,
    model: 'claude-sonnet-4-6',
    needsBaseUrl: false
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    provider: 'gemini',
    baseUrl: null,
    model: 'gemini-2.5-pro',
    needsBaseUrl: false
  }
]
