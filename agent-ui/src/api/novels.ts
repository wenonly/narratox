import { APIRoutes } from './routes'
import type {
  Chapter,
  CreateNovelInput,
  Novel,
  NovelListItem
} from '@/types/novel'

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

export const listNovels = (base: string, token: string) =>
  asJson<NovelListItem[]>(
    fetch(APIRoutes.Novels(base), { headers: headers(token) })
  )

export const getNovel = (base: string, token: string, id: string) =>
  asJson<Novel>(fetch(APIRoutes.Novel(base, id), { headers: headers(token) }))

export const createNovel = (
  base: string,
  token: string,
  input: CreateNovelInput
) =>
  asJson<Novel>(
    fetch(APIRoutes.Novels(base), {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify(input)
    })
  )

export const deleteNovel = (base: string, token: string, id: string) =>
  asJson<{ ok: true }>(
    fetch(APIRoutes.Novel(base, id), {
      method: 'DELETE',
      headers: headers(token)
    })
  )

export const createChapter = (base: string, token: string, novelId: string) =>
  asJson<Chapter>(
    fetch(APIRoutes.NovelChapters(base, novelId), {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify({})
    })
  )

export const listChapters = (base: string, token: string, novelId: string) =>
  asJson<Chapter[]>(
    fetch(APIRoutes.NovelChapters(base, novelId), { headers: headers(token) })
  )

export interface AcceptInput {
  chapterId: string
  op: 'set' | 'append'
  content: string
}
export const acceptIntoChapter = (
  base: string,
  token: string,
  novelId: string,
  input: AcceptInput
) =>
  asJson<{ ok: true }>(
    fetch(APIRoutes.NovelAccept(base, novelId), {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify(input)
    })
  )
