import { APIRoutes } from './routes'
import type {
  Vendor,
  Model,
  ModelProvider,
  AgentOverride,
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

export const listVendors = (base: string, token: string) =>
  asJson<Vendor[]>(
    fetch(APIRoutes.SettingsVendors(base), { headers: headers(token) })
  )

export const createVendor = (
  base: string,
  token: string,
  body: {
    name: string
    provider: ModelProvider
    baseUrl?: string | null
    apiKey: string
  }
) =>
  asJson<Vendor>(
    fetch(APIRoutes.SettingsVendors(base), {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify(body)
    })
  )

export const updateVendor = (
  base: string,
  token: string,
  id: string,
  body: Partial<{
    name: string
    provider: ModelProvider
    baseUrl?: string | null
    apiKey?: string
  }>
) =>
  asJson<Vendor>(
    fetch(APIRoutes.SettingsVendor(base, id), {
      method: 'PATCH',
      headers: headers(token),
      body: JSON.stringify(body)
    })
  )

export const deleteVendor = (base: string, token: string, id: string) =>
  asEmpty(
    fetch(APIRoutes.SettingsVendor(base, id), {
      method: 'DELETE',
      headers: headers(token)
    })
  )

export const createModel = (
  base: string,
  token: string,
  vid: string,
  body: { model: string; temperature?: number; name?: string }
) =>
  asJson<Model>(
    fetch(APIRoutes.SettingsModels(base, vid), {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify(body)
    })
  )

export const updateModel = (
  base: string,
  token: string,
  id: string,
  body: Partial<{ model: string; temperature?: number; name?: string }>
) =>
  asJson<Model>(
    fetch(APIRoutes.SettingsModel(base, id), {
      method: 'PATCH',
      headers: headers(token),
      body: JSON.stringify(body)
    })
  )

export const deleteModel = (base: string, token: string, id: string) =>
  asEmpty(
    fetch(APIRoutes.SettingsModel(base, id), {
      method: 'DELETE',
      headers: headers(token)
    })
  )

export const activateModel = (base: string, token: string, id: string) =>
  asEmpty(
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
  asJson<Record<string, AgentOverride>>(
    fetch(APIRoutes.SettingsAgentModels(base), { headers: headers(token) })
  )

export const putAgentModel = (
  base: string,
  token: string,
  agentKey: string,
  body: { modelId?: string; temperature?: number | null }
) =>
  asEmpty(
    fetch(APIRoutes.SettingsAgentModel(base, agentKey), {
      method: 'PUT',
      headers: headers(token),
      body: JSON.stringify(body)
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
