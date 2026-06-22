import { APIRoutes } from './routes'
import type {
  KbCategory,
  KbEntry,
  KbEntryDetail,
  KbListFilter
} from '@/types/knowledge'

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

export const listKnowledge = (
  base: string,
  token: string,
  filter: KbListFilter = {}
): Promise<{ categories: KbCategory[]; entries: KbEntry[] }> => {
  const qs = new URLSearchParams()
  if (filter.category) qs.set('category', filter.category)
  if (filter.tag) qs.set('tag', filter.tag)
  if (filter.search) qs.set('search', filter.search)
  const q = qs.toString()
  return asJson(
    fetch(`${APIRoutes.Knowledge(base)}${q ? '?' + q : ''}`, {
      headers: headers(token)
    })
  )
}

export const getKnowledgeEntry = (
  base: string,
  token: string,
  id: string
): Promise<KbEntryDetail> =>
  asJson(fetch(APIRoutes.KnowledgeEntry(base, id), { headers: headers(token) }))
