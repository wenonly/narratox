import { APIRoutes } from './routes'
import type { AuthResult, AuthUser } from '@/types/os'

export const loginAPI = async (
  base: string,
  email: string,
  password: string
): Promise<AuthResult> => {
  const res = await fetch(APIRoutes.Login(base), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  })
  if (!res.ok) {
    throw new Error(
      res.status === 401 ? '邮箱或密码错误' : `登录失败 (${res.status})`
    )
  }
  return res.json()
}

export const registerAPI = async (
  base: string,
  email: string,
  password: string,
  username?: string
): Promise<AuthResult> => {
  const res = await fetch(APIRoutes.Register(base), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, username })
  })
  if (!res.ok) {
    throw new Error(
      res.status === 409 ? '该邮箱已注册' : `注册失败 (${res.status})`
    )
  }
  return res.json()
}

export const meAPI = async (base: string, token: string): Promise<AuthUser> => {
  const res = await fetch(APIRoutes.Me(base), {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` }
  })
  if (!res.ok) {
    const err = new Error(`auth/me failed (${res.status})`) as Error & {
      status: number
    }
    err.status = res.status
    throw err
  }
  return res.json()
}
