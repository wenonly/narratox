export type ModelProvider =
  | 'deepseek'
  | 'openai-compatible'
  | 'anthropic'
  | 'gemini'

/** 厂商下的单个模型;active 由后端 VendorService.list 标记默认模型。 */
export interface Model {
  id: string
  model: string
  temperature: number | null
  name: string | null
  active?: boolean
}

/** 厂商(一家 = 一组凭证 + baseUrl + 一组 Model)。 */
export interface Vendor {
  id: string
  name: string
  provider: ModelProvider
  baseUrl: string | null
  hasApiKey: boolean
  models: Model[]
}

/** 单 agent 模型覆写:模型 id + 可独立温度。 */
export interface AgentOverride {
  modelId: string
  temperature: number | null
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

export type RecommendedTier = 'strong' | 'mid' | 'cheap'

export interface AgentGroupEntry {
  key: string
  description: string
  recommendedTier: RecommendedTier
}
export interface AgentGroup {
  group: string
  agents: AgentGroupEntry[]
}
