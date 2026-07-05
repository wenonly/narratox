/**
 * 对标拆解(Benchmark)前端类型。
 *
 * 对应后端 `/benchmarks` 路由 + Prisma `BenchmarkBook` / `BenchmarkEntry` 模型。
 * 后端 list 返回 books(含 chapters, 但不嵌 entries);detail (getWithEntries) 额外带 entries。
 */

export type BenchmarkStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'DONE'
  | 'FAILED'
  | 'INTERRUPTED'

export type BenchmarkEntryType =
  | 'CHAPTER'
  | 'PLOT'
  | 'RHYTHM'
  | 'EMOTION'
  | 'CHARACTER'
  | 'STYLE'

export interface BenchmarkEntry {
  id: string
  bookId: string
  type: BenchmarkEntryType
  title: string
  content: string
  chapterNo: number | null
  order: number
}

export interface BenchmarkProgress {
  chapter: number
  total: number
  agent: string
}

export interface BenchmarkBook {
  id: string
  title: string
  status: BenchmarkStatus
  /** RUNNING 时填充 {chapter,total,agent};其余状态为空对象。 */
  progress: BenchmarkProgress | Record<string, never>
  chapters: unknown[]
  createdAt: string
  /** 仅 detail 接口返回;list 不带。 */
  entries?: BenchmarkEntry[]
  /** dissect-critic 的总评(仅 DONE 时有值;镜像 server report_dissect_review)。 */
  review?: DissectReview | null
}

/**
 * critic 总评(dissect-critic 的 report_dissect_review 落库 JSON)。
 * - summary:一句话总评(完整性,非质量评价)。
 * - missingTypes:完全缺失的 type(空数组 = 6 维齐全)。
 * - notes:具体遗漏 / 建议(server zod 是单个 string,可能多行;FE 按行拆成 bullet)。
 */
export interface DissectReview {
  summary?: string
  missingTypes?: BenchmarkEntryType[]
  notes?: string
}

/**
 * 拆解流式帧。后端 newline-JSON,每行一个。
 * - RunStarted: 开头;RunCompleted: 收尾(正常 / 客户端断开 / job 不在)。
 * - Heartbeat: 每 15s 一次保活(前端可忽略渲染)。
 * - activity: agent 活动事件(think/tool/stage/content,见 ActivityEvent)。
 * - RunError: 启动被拒(如重复启动 RUNNING 任务)。
 */
export type BenchmarkStreamEvent =
  | { event: 'RunStarted'; book_id: string; created_at: number }
  | { event: 'RunCompleted'; created_at?: number; status?: BenchmarkStatus }
  | { event: 'Heartbeat' }
  | { event: 'RunError'; content: string }
  | { event: 'activity'; activity: ActivityEvent }

/**
 * agent 活动事件(镜像 server/src/agentos/activity.types.ts)。
 * FE 按 id 聚合:Act 建条目,ActDelta 追加文本,ActTool/ActResult 填详情,ActEnd 收尾。
 */
export type ActivityType = 'think' | 'tool' | 'stage' | 'content'

export interface ActivityActStart {
  type: 'Act'
  id: string
  act: ActivityType
  label?: string
}
export interface ActivityActDelta {
  type: 'ActDelta'
  id: string
  text: string
}
export interface ActivityActTool {
  type: 'ActTool'
  id: string
  args: unknown
}
export interface ActivityActResult {
  type: 'ActResult'
  id: string
  result: unknown
}
export interface ActivityActEnd {
  type: 'ActEnd'
  id: string
  status: 'ok' | 'error'
  summary?: string
}
export type ActivityEvent =
  | ActivityActStart
  | ActivityActDelta
  | ActivityActTool
  | ActivityActResult
  | ActivityActEnd
