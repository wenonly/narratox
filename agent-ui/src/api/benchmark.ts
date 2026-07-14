import { APIRoutes } from './routes'
import type { BenchmarkBook, BenchmarkEntry } from '@/types/benchmark'

const headers = (token: string): HeadersInit => ({
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

async function asEmpty(res: Promise<Response>): Promise<void> {
  const r = await res
  if (!r.ok) {
    const msg = await r.text().catch(() => r.statusText)
    throw new Error(msg || `HTTP ${r.status}`)
  }
}

export const listBenchmarks = (
  base: string,
  token: string
): Promise<BenchmarkBook[]> =>
  asJson<BenchmarkBook[]>(
    fetch(APIRoutes.Benchmarks(base), { headers: headers(token) })
  )

export const getBenchmark = (
  base: string,
  token: string,
  id: string
): Promise<BenchmarkBook> =>
  asJson<BenchmarkBook>(
    fetch(APIRoutes.Benchmark(base, id), { headers: headers(token) })
  )

export const deleteBenchmark = (
  base: string,
  token: string,
  id: string
): Promise<void> =>
  asEmpty(
    fetch(APIRoutes.Benchmark(base, id), {
      method: 'DELETE',
      headers: headers(token)
    })
  )

export interface UploadResult {
  id: string
  chapterCount: number
  estTokens: number
}

export const uploadBenchmark = (
  base: string,
  token: string,
  file: File,
  title: string
): Promise<UploadResult> => {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('title', title)
  return asJson<UploadResult>(
    fetch(APIRoutes.BenchmarkUpload(base), {
      method: 'POST',
      headers: headers(token),
      body: fd
    })
  )
}

/**
 * 流式拆解:POST dissect,返回 Response(newline-JSON ReadableStream)。
 * 调用方读 res.body.getReader() 逐 chunk decode + 按 \n split + JSON.parse,
 * 参照 hooks/useAIResponseStream.tsx 的增量解析。
 */
export const dissectBenchmarkStream = (
  base: string,
  token: string,
  id: string
): Promise<Response> =>
  fetch(APIRoutes.BenchmarkDissect(base, id), {
    method: 'POST',
    headers: headers(token)
  })

/** 断线重连:GET stream,返回正在跑的 job 的活动帧流。job 不在 → 立即 RunCompleted。 */
export const streamBenchmark = (
  base: string,
  token: string,
  id: string
): Promise<Response> =>
  fetch(APIRoutes.BenchmarkStream(base, id), { headers: headers(token) })

/** 重命名卡片:PATCH /:bookId/entries/:entryId { title }。返回更新后的 entry。 */
export const renameBenchmarkEntry = (
  base: string,
  token: string,
  bookId: string,
  entryId: string,
  title: string
): Promise<BenchmarkEntry> =>
  asJson<BenchmarkEntry>(
    fetch(APIRoutes.BenchmarkEntryRename(base, bookId, entryId), {
      method: 'PATCH',
      headers: { ...headers(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title })
    })
  )

/** 微调拆解:POST /:id/dissect/message { message },返回 newline-JSON 流。 */
export const dissectMessageStream = (
  base: string,
  token: string,
  id: string,
  message: string
): Promise<Response> =>
  fetch(APIRoutes.BenchmarkDissectMessage(base, id), {
    method: 'POST',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message })
  })
