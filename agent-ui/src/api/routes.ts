export const APIRoutes = {
  AgentRun: (agentOSUrl: string) => `${agentOSUrl}/agents/{agent_id}/runs`,
  Status: (agentOSUrl: string) => `${agentOSUrl}/health`,
  GetSessions: (agentOSUrl: string) => `${agentOSUrl}/sessions`,
  GetSession: (agentOSUrl: string, sessionId: string) =>
    `${agentOSUrl}/sessions/${sessionId}/runs`,

  DeleteSession: (agentOSUrl: string, sessionId: string) =>
    `${agentOSUrl}/sessions/${sessionId}`,

  Login: (agentOSUrl: string) => `${agentOSUrl}/auth/login`,
  Register: (agentOSUrl: string) => `${agentOSUrl}/auth/register`,
  Me: (agentOSUrl: string) => `${agentOSUrl}/auth/me`,

  Novels: (base: string) => `${base}/novels`,
  Novel: (base: string, id: string) => `${base}/novels/${id}`,
  NovelChapters: (base: string, id: string) => `${base}/novels/${id}/chapters`,
  NovelChapter: (base: string, novelId: string, chapterId: string) =>
    `${base}/novels/${novelId}/chapters/${chapterId}`,
  NovelChapterSummary: (base: string, novelId: string, order: number) =>
    `${base}/novels/${novelId}/chapters/${order}/summary`,
  NovelOutline: (base: string, id: string) => `${base}/novels/${id}/outline`,
  NovelAccept: (base: string, id: string) => `${base}/novels/${id}/accept`,

  SettingsModels: (base: string) => `${base}/settings/models`,
  SettingsModel: (base: string, id: string) => `${base}/settings/models/${id}`,
  SettingsModelActivate: (base: string, id: string) =>
    `${base}/settings/models/${id}/activate`
}
