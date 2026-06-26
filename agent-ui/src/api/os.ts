import { APIRoutes } from './routes'

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

export const getSessionAPI = async (
  base: string,
  type: 'agent' | 'team',
  sessionId: string,
  dbId?: string,
  authToken?: string
) => {
  // build query string
  const queryParams = new URLSearchParams({ type })
  if (dbId) queryParams.append('db_id', dbId)

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
