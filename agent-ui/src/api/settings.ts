import { APIRoutes } from './routes'
import type {
  ModelConfig,
  ModelConfigInput,
  VoiceProfile,
  CreateVoiceProfileInput,
  UpdateVoiceProfileInput,
  GenerateVoiceProfileInput,
  AgentGroup
} from '@/types/settings'

const headers = (token: string): HeadersInit => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${token}`
})

async function asJson<T>(res: Promise<Response>): Promise<T> {
  const r = await res
  if (!r.ok) {
    const msg = await r.text().catch(() => r.statusText)
    throw new Error(msg || `HTTP ${r.status}`)
  }
  return r.json() as Promise<T>
}

export const listModelConfigs = (base: string, token: string) =>
  asJson<ModelConfig[]>(
    fetch(APIRoutes.SettingsModels(base), { headers: headers(token) })
  )

export const createModelConfig = (
  base: string,
  token: string,
  input: ModelConfigInput
) =>
  asJson<ModelConfig>(
    fetch(APIRoutes.SettingsModels(base), {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify(input)
    })
  )

export const updateModelConfig = (
  base: string,
  token: string,
  id: string,
  input: ModelConfigInput
) =>
  asJson<ModelConfig>(
    fetch(APIRoutes.SettingsModel(base, id), {
      method: 'PATCH',
      headers: headers(token),
      body: JSON.stringify(input)
    })
  )

export const deleteModelConfig = (base: string, token: string, id: string) =>
  asJson<{ ok: true }>(
    fetch(APIRoutes.SettingsModel(base, id), {
      method: 'DELETE',
      headers: headers(token)
    })
  )

export const activateModelConfig = (base: string, token: string, id: string) =>
  asJson<{ ok: true }>(
    fetch(APIRoutes.SettingsModelActivate(base, id), {
      method: 'POST',
      headers: headers(token)
    })
  )

export const listVoiceProfiles = (base: string, token: string) =>
  asJson<VoiceProfile[]>(
    fetch(APIRoutes.SettingsVoiceProfiles(base), { headers: headers(token) })
  )

export const createVoiceProfile = (
  base: string,
  token: string,
  input: CreateVoiceProfileInput
) =>
  asJson<VoiceProfile>(
    fetch(APIRoutes.SettingsVoiceProfiles(base), {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify(input)
    })
  )

export const updateVoiceProfile = (
  base: string,
  token: string,
  id: string,
  input: UpdateVoiceProfileInput
) =>
  asJson<VoiceProfile>(
    fetch(APIRoutes.SettingsVoiceProfile(base, id), {
      method: 'PATCH',
      headers: headers(token),
      body: JSON.stringify(input)
    })
  )

export const deleteVoiceProfile = (base: string, token: string, id: string) =>
  asJson<{ ok: true }>(
    fetch(APIRoutes.SettingsVoiceProfile(base, id), {
      method: 'DELETE',
      headers: headers(token)
    })
  )

export const generateVoiceProfile = (
  base: string,
  token: string,
  input: GenerateVoiceProfileInput
) =>
  asJson<{ profile: string }>(
    fetch(APIRoutes.SettingsVoiceProfileGenerate(base), {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify(input)
    })
  )

/** 对返回空 body 的端点(如 NestJS `Promise<void>`);只校验状态,不解析 body。 */
async function asEmpty(res: Promise<Response>): Promise<void> {
  const r = await res
  if (!r.ok) {
    const msg = await r.text().catch(() => r.statusText)
    throw new Error(msg || `HTTP ${r.status}`)
  }
}

export const listAgentTree = (base: string, token: string) =>
  asJson<AgentGroup[]>(
    fetch(APIRoutes.SettingsAgentTree(base), { headers: headers(token) })
  )

export const listAgentModels = (base: string, token: string) =>
  asJson<Record<string, string>>(
    fetch(APIRoutes.SettingsAgentModels(base), { headers: headers(token) })
  )

export const putAgentModel = (
  base: string,
  token: string,
  agentKey: string,
  modelConfigId: string
) =>
  asEmpty(
    fetch(APIRoutes.SettingsAgentModel(base, agentKey), {
      method: 'PUT',
      headers: headers(token),
      body: JSON.stringify({ modelConfigId })
    })
  )

export const deleteAgentModel = (
  base: string,
  token: string,
  agentKey: string
) =>
  asEmpty(
    fetch(APIRoutes.SettingsAgentModel(base, agentKey), {
      method: 'DELETE',
      headers: headers(token)
    })
  )
