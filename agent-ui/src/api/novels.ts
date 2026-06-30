import { APIRoutes } from './routes'
import type {
  Character,
  CreateNovelInput,
  Novel,
  NovelListItem,
  NovelReference,
  OutlineData,
  StoryEventHook,
  WorldEntry,
  EventTimelineItem,
  NovelStatus
} from '@/types/novel'
import type { MemoryData } from '@/types/os'

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

export const getChapterMemory = (
  base: string,
  token: string,
  novelId: string,
  order: number
) =>
  asJson<MemoryData>(
    fetch(APIRoutes.NovelChapterSummary(base, novelId, order), {
      headers: headers(token)
    })
  )

export const getOutline = (base: string, token: string, novelId: string) =>
  asJson<OutlineData>(
    fetch(APIRoutes.NovelOutline(base, novelId), { headers: headers(token) })
  )

export const getWorldview = (base: string, token: string, novelId: string) =>
  asJson<WorldEntry[]>(
    fetch(APIRoutes.NovelWorldview(base, novelId), {
      headers: headers(token)
    })
  )

export const getHooks = (base: string, token: string, novelId: string) =>
  asJson<StoryEventHook[]>(
    fetch(APIRoutes.NovelHooks(base, novelId), {
      headers: headers(token)
    })
  )

export const getEvents = (base: string, token: string, novelId: string) =>
  asJson<EventTimelineItem[]>(
    fetch(APIRoutes.NovelEvents(base, novelId), {
      headers: headers(token)
    })
  )

export const getStatus = (base: string, token: string, novelId: string) =>
  asJson<NovelStatus | null>(
    fetch(APIRoutes.NovelStatus(base, novelId), {
      headers: headers(token)
    })
  )

export const getCharacters = (base: string, token: string, novelId: string) =>
  asJson<Character[]>(
    fetch(APIRoutes.NovelCharacters(base, novelId), {
      headers: headers(token)
    })
  )

export const getNovelReferences = (
  base: string,
  token: string,
  novelId: string
) =>
  asJson<NovelReference[]>(
    fetch(APIRoutes.NovelReferences(base, novelId), {
      headers: headers(token)
    })
  )

export const setNovelVoiceProfile = (
  base: string,
  token: string,
  novelId: string,
  voiceProfileId: string | null
) =>
  asJson<{ ok: true }>(
    fetch(APIRoutes.NovelVoiceProfile(base, novelId), {
      method: 'PUT',
      headers: headers(token),
      body: JSON.stringify({ voiceProfileId })
    })
  )

export async function publishNovel(
  base: string,
  token: string,
  id: string,
  opts: {
    from: number
    to: number
    title: boolean
    synopsis: boolean
    indent: boolean
  }
): Promise<string> {
  const qs = new URLSearchParams({
    from: String(opts.from),
    to: String(opts.to),
    title: opts.title ? '1' : '0',
    synopsis: opts.synopsis ? '1' : '0',
    indent: opts.indent ? '1' : '0'
  })
  const res = await fetch(
    `${APIRoutes.NovelPublish(base, id)}?${qs.toString()}`,
    {
      headers: headers(token)
    }
  )
  if (!res.ok) throw new Error('生成失败')
  return res.text()
}
