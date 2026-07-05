import { APIRoutes } from './routes'
import type { ActivityMap } from '@/types/os'

// Helper function to create headers with optional auth token
const createHeaders = (authToken?: string): HeadersInit => {
  const headers: HeadersInit = {
    'Content-Type': 'application/json'
  }

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`
  }

  return headers
}

/** server GET /sessions/:id/runs 返回的单条 run DTO(展开成 2 条 ChatMessage)。 */
export interface SessionRunDTO {
  run_input: string
  content: string
  created_at: number
  user_message_id: string
  user_message_lang_id: string | null
  is_error: boolean
  /** server 持久化的 think/tool/stage lookup 表(刷新回显用)。 */
  activities?: ActivityMap | null
}

/** 分页包(page 参数在场时返回)。 */
export interface SessionRunsPage {
  runs: SessionRunDTO[]
  hasMore: boolean
  nextCursor: number | null
}

export const getStatusAPI = async (
  base: string,
  authToken?: string
): Promise<number> => {
  const response = await fetch(APIRoutes.Status(base), {
    method: 'GET',
    headers: createHeaders(authToken)
  })
  return response.status
}

export function getSessionAPI(
  base: string,
  type: 'agent' | 'team',
  sessionId: string,
  dbId?: string,
  authToken?: string
): Promise<SessionRunDTO[]>
export function getSessionAPI(
  base: string,
  type: 'agent' | 'team',
  sessionId: string,
  dbId: string | undefined,
  authToken: string | undefined,
  page: { limit: number; before?: number }
): Promise<SessionRunsPage>
export async function getSessionAPI(
  base: string,
  type: 'agent' | 'team',
  sessionId: string,
  dbId?: string,
  authToken?: string,
  page?: { limit: number; before?: number }
): Promise<SessionRunDTO[] | SessionRunsPage> {
  // build query string
  const queryParams = new URLSearchParams({ type })
  if (dbId) queryParams.append('db_id', dbId)
  if (page) {
    queryParams.append('limit', String(page.limit))
    if (page.before !== undefined)
      queryParams.append('before', String(page.before))
  }

  const response = await fetch(
    `${APIRoutes.GetSession(base, sessionId)}?${queryParams.toString()}`,
    {
      method: 'GET',
      headers: createHeaders(authToken)
    }
  )

  if (!response.ok) {
    throw new Error(`Failed to fetch session: ${response.statusText}`)
  }

  return response.json()
}

export const deleteSessionAPI = async (
  base: string,
  dbId: string,
  sessionId: string,
  authToken?: string
) => {
  const queryParams = new URLSearchParams()
  if (dbId) queryParams.append('db_id', dbId)
  const response = await fetch(
    `${APIRoutes.DeleteSession(base, sessionId)}?${queryParams.toString()}`,
    {
      method: 'DELETE',
      headers: createHeaders(authToken)
    }
  )
  return response
}

export const recallSessionAPI = async (
  base: string,
  sessionId: string,
  messageRowId: string,
  authToken?: string
): Promise<{ recalledContent: string }> => {
  const response = await fetch(APIRoutes.RecallSession(base, sessionId), {
    method: 'POST',
    headers: createHeaders(authToken),
    body: JSON.stringify({ messageRowId })
  })

  if (!response.ok) {
    throw new Error(`Failed to recall: ${response.statusText}`)
  }

  return response.json()
}
