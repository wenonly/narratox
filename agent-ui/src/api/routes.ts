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
  Me: (agentOSUrl: string) => `${agentOSUrl}/auth/me`
}
