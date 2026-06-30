export const APIRoutes = {
  AgentRun: (agentOSUrl: string) => `${agentOSUrl}/agents/{agent_id}/runs`,
  Status: (agentOSUrl: string) => `${agentOSUrl}/health`,
  GetSession: (agentOSUrl: string, sessionId: string) =>
    `${agentOSUrl}/sessions/${sessionId}/runs`,

  DeleteSession: (agentOSUrl: string, sessionId: string) =>
    `${agentOSUrl}/sessions/${sessionId}`,

  RecallSession: (agentOSUrl: string, sessionId: string) =>
    `${agentOSUrl}/sessions/${sessionId}/recall`,

  Login: (agentOSUrl: string) => `${agentOSUrl}/auth/login`,
  Register: (agentOSUrl: string) => `${agentOSUrl}/auth/register`,
  Me: (agentOSUrl: string) => `${agentOSUrl}/auth/me`,

  Novels: (base: string) => `${base}/novels`,
  Novel: (base: string, id: string) => `${base}/novels/${id}`,
  NovelChapterSummary: (base: string, novelId: string, order: number) =>
    `${base}/novels/${novelId}/chapters/${order}/summary`,
  NovelOutline: (base: string, id: string) => `${base}/novels/${id}/outline`,
  NovelWorldview: (base: string, id: string) =>
    `${base}/novels/${id}/worldview`,
  NovelHooks: (base: string, id: string) => `${base}/novels/${id}/hooks`,
  NovelEvents: (base: string, id: string) => `${base}/novels/${id}/events`,
  NovelStatus: (base: string, id: string) => `${base}/novels/${id}/status`,
  NovelCharacters: (base: string, id: string) =>
    `${base}/novels/${id}/characters`,
  NovelReferences: (base: string, id: string) =>
    `${base}/novels/${id}/references`,
  NovelPublish: (base: string, id: string) => `${base}/novels/${id}/publish`,

  SettingsVendors: (base: string) => `${base}/settings/vendors`,
  SettingsVendor: (base: string, id: string) =>
    `${base}/settings/vendors/${id}`,
  SettingsModels: (base: string, vid: string) =>
    `${base}/settings/vendors/${vid}/models`,
  SettingsModel: (base: string, id: string) => `${base}/settings/models/${id}`,
  SettingsModelActivate: (base: string, id: string) =>
    `${base}/settings/models/${id}/activate`,
  SettingsAgentTree: (base: string) => `${base}/settings/agent-tree`,
  SettingsAgentModels: (base: string) => `${base}/settings/agent-models`,
  SettingsAgentModel: (base: string, agentKey: string) =>
    `${base}/settings/agent-models/${agentKey}`,

  SettingsVoiceProfiles: (base: string) => `${base}/settings/voice-profiles`,
  SettingsVoiceProfile: (base: string, id: string) =>
    `${base}/settings/voice-profiles/${id}`,
  SettingsVoiceProfileGenerate: (base: string) =>
    `${base}/settings/voice-profiles/generate`,
  NovelVoiceProfile: (base: string, novelId: string) =>
    `${base}/novels/${novelId}/voice-profile`,

  Knowledge: (base: string) => `${base}/knowledge`,
  KnowledgeEntry: (base: string, id: string) => `${base}/knowledge/${id}`,

  Benchmarks: (base: string) => `${base}/benchmarks`,
  Benchmark: (base: string, id: string) => `${base}/benchmarks/${id}`,
  BenchmarkDissect: (base: string, id: string) =>
    `${base}/benchmarks/${id}/dissect`,
  BenchmarkStream: (base: string, id: string) =>
    `${base}/benchmarks/${id}/stream`,
  BenchmarkUpload: (base: string) => `${base}/benchmarks/upload`
}
