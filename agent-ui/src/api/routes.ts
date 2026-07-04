// server 全局 /api 前缀的单一真相源:NestJS main.ts 的 setGlobalPrefix('api') 把所有
// server 端点挂在 /api 下。agent-ui 所有 server URL 都经 APIRoutes 拼接,故只需在此
// 用 apiBase 注入前缀 —— 调用方零感知。改前缀(或取消)只动这里 + server main.ts。
const apiBase = (endpoint: string) => `${endpoint}/api`

export const APIRoutes = {
  AgentRun: (agentOSUrl: string) =>
    `${apiBase(agentOSUrl)}/agents/{agent_id}/runs`,
  Status: (agentOSUrl: string) => `${apiBase(agentOSUrl)}/health`,
  GetSession: (agentOSUrl: string, sessionId: string) =>
    `${apiBase(agentOSUrl)}/sessions/${sessionId}/runs`,

  DeleteSession: (agentOSUrl: string, sessionId: string) =>
    `${apiBase(agentOSUrl)}/sessions/${sessionId}`,

  RecallSession: (agentOSUrl: string, sessionId: string) =>
    `${apiBase(agentOSUrl)}/sessions/${sessionId}/recall`,

  Login: (agentOSUrl: string) => `${apiBase(agentOSUrl)}/auth/login`,
  Register: (agentOSUrl: string) => `${apiBase(agentOSUrl)}/auth/register`,
  Me: (agentOSUrl: string) => `${apiBase(agentOSUrl)}/auth/me`,

  Novels: (base: string) => `${apiBase(base)}/novels`,
  Novel: (base: string, id: string) => `${apiBase(base)}/novels/${id}`,
  NovelChapterSummary: (base: string, novelId: string, order: number) =>
    `${apiBase(base)}/novels/${novelId}/chapters/${order}/summary`,
  NovelChapter: (base: string, novelId: string, cid: string) =>
    `${apiBase(base)}/novels/${novelId}/chapters/${cid}`,
  NovelOutline: (base: string, id: string) =>
    `${apiBase(base)}/novels/${id}/outline`,
  NovelWorldview: (base: string, id: string) =>
    `${apiBase(base)}/novels/${id}/worldview`,
  NovelHooks: (base: string, id: string) => `${apiBase(base)}/novels/${id}/hooks`,
  NovelEvents: (base: string, id: string) => `${apiBase(base)}/novels/${id}/events`,
  NovelStatus: (base: string, id: string) =>
    `${apiBase(base)}/novels/${id}/status`,
  NovelCharacters: (base: string, id: string) =>
    `${apiBase(base)}/novels/${id}/characters`,
  NovelReferences: (base: string, id: string) =>
    `${apiBase(base)}/novels/${id}/references`,
  NovelPublish: (base: string, id: string) =>
    `${apiBase(base)}/novels/${id}/publish`,

  SettingsVendors: (base: string) => `${apiBase(base)}/settings/vendors`,
  SettingsVendor: (base: string, id: string) =>
    `${apiBase(base)}/settings/vendors/${id}`,
  SettingsModels: (base: string, vid: string) =>
    `${apiBase(base)}/settings/vendors/${vid}/models`,
  SettingsModel: (base: string, id: string) =>
    `${apiBase(base)}/settings/models/${id}`,
  SettingsModelActivate: (base: string, id: string) =>
    `${apiBase(base)}/settings/models/${id}/activate`,
  SettingsAgentTree: (base: string) => `${apiBase(base)}/settings/agent-tree`,
  SettingsAgentModels: (base: string) =>
    `${apiBase(base)}/settings/agent-models`,
  SettingsAgentModel: (base: string, agentKey: string) =>
    `${apiBase(base)}/settings/agent-models/${agentKey}`,

  SettingsVoiceProfiles: (base: string) =>
    `${apiBase(base)}/settings/voice-profiles`,
  SettingsVoiceProfile: (base: string, id: string) =>
    `${apiBase(base)}/settings/voice-profiles/${id}`,
  SettingsVoiceProfileGenerate: (base: string) =>
    `${apiBase(base)}/settings/voice-profiles/generate`,
  NovelVoiceProfile: (base: string, novelId: string) =>
    `${apiBase(base)}/novels/${novelId}/voice-profile`,

  Knowledge: (base: string) => `${apiBase(base)}/knowledge`,
  KnowledgeEntry: (base: string, id: string) =>
    `${apiBase(base)}/knowledge/${id}`,

  Benchmarks: (base: string) => `${apiBase(base)}/benchmarks`,
  Benchmark: (base: string, id: string) => `${apiBase(base)}/benchmarks/${id}`,
  BenchmarkDissect: (base: string, id: string) =>
    `${apiBase(base)}/benchmarks/${id}/dissect`,
  BenchmarkStream: (base: string, id: string) =>
    `${apiBase(base)}/benchmarks/${id}/stream`,
  BenchmarkUpload: (base: string) => `${apiBase(base)}/benchmarks/upload`
}
