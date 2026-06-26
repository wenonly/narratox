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
  NovelCharacters: (base: string, id: string) =>
    `${base}/novels/${id}/characters`,
  NovelReferences: (base: string, id: string) =>
    `${base}/novels/${id}/references`,

  SettingsModels: (base: string) => `${base}/settings/models`,
  SettingsModel: (base: string, id: string) => `${base}/settings/models/${id}`,
  SettingsModelActivate: (base: string, id: string) =>
    `${base}/settings/models/${id}/activate`,

  Knowledge: (base: string) => `${base}/knowledge`,
  KnowledgeEntry: (base: string, id: string) => `${base}/knowledge/${id}`
}
