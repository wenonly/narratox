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

/** 画像库单条记录(Markdown profile)。 */
export interface VoiceProfile {
  id: string
  name: string
  profile: string
  createdAt: string
  updatedAt: string
}

/** 新建画像入参。 */
export interface CreateVoiceProfileInput {
  name: string
  profile: string
}

/** 更新画像入参(字段皆可选)。 */
export interface UpdateVoiceProfileInput {
  name?: string
  profile?: string
}

/** POST /settings/voice-profiles/generate 入参。 */
export interface GenerateVoiceProfileInput {
  samples: string[]
}
