export type ModelProvider =
  | 'deepseek'
  | 'openai-compatible'
  | 'anthropic'
  | 'gemini'

/** 服务端响应:不含 apiKey,只给 hasApiKey。 */
export interface ModelConfig {
  id: string
  userId: string
  name: string
  provider: ModelProvider
  model: string
  baseUrl: string | null
  temperature: number | null
  hasApiKey: boolean
  active: boolean
  createdAt: string
  updatedAt: string
}

/** 新建/更新入参;更新时 apiKey 留空=不改。 */
export interface ModelConfigInput {
  name: string
  provider: ModelProvider
  model: string
  baseUrl?: string
  apiKey?: string
  temperature?: number
}
