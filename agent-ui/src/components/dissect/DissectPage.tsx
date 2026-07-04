'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/store'
import {
  deleteBenchmark,
  dissectBenchmarkStream,
  getBenchmark,
  listBenchmarks,
  streamBenchmark,
  uploadBenchmark
} from '@/api/benchmark'
import type {
  ActivityEvent,
  BenchmarkBook,
  BenchmarkEntry,
  BenchmarkEntryType,
  BenchmarkStatus
} from '@/types/benchmark'
import AppSidebar from '@/components/layout/AppSidebar'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const STATUS_META: Record<
  BenchmarkStatus,
  { label: string; variant: 'neutral' | 'accent' | 'success' | 'destructive' }
> = {
  PENDING: { label: '⏸ 待确认', variant: 'neutral' },
  RUNNING: { label: '🔄 拆解中', variant: 'accent' },
  DONE: { label: '✓ 完成', variant: 'success' },
  FAILED: { label: '⚠ 失败', variant: 'destructive' },
  INTERRUPTED: { label: '⚠ 中断', variant: 'neutral' }
}

const ENTRY_TYPE_LABEL: Record<BenchmarkEntryType, string> = {
  CHAPTER: '章节摘要',
  PLOT: '剧情',
  RHYTHM: '节奏',
  EMOTION: '情绪',
  CHARACTER: '角色',
  STYLE: '文风'
}

/** 渲染顺序:文风 → 节奏 → 情绪 → 角色 → 剧情 → 章节摘要 */
const ENTRY_TYPE_ORDER: BenchmarkEntryType[] = [
  'STYLE',
  'RHYTHM',
  'EMOTION',
  'CHARACTER',
  'PLOT',
  'CHAPTER'
]

const formatDate = (iso: string): string => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('zh-CN', { hour12: false })
}

const progressText = (book: BenchmarkBook): string => {
  if (book.status !== 'RUNNING' || !book.progress) return ''
  const p = book.progress as {
    chapter?: number
    total?: number
    agent?: string
  }
  if (!p.chapter && !p.total) return ''
  const total = p.total ? `/${p.total}` : ''
  const agent = p.agent ? ` · ${p.agent}` : ''
  return `第 ${p.chapter ?? '?'}${total} 章${agent}`
}

const DissectPage = () => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const [books, setBooks] = useState<BenchmarkBook[]>([])
  const [loading, setLoading] = useState(true)
  /** 确认弹窗的数据源:新上传或 PENDING 重新确认共用。 */
  const [confirmTarget, setConfirmTarget] = useState<{
    id: string
    chapterCount: number
    estTokens: number
  } | null>(null)
  const [pendingTitle, setPendingTitle] = useState('')
  const [logBookId, setLogBookId] = useState<string | null>(null)
  const [resultBook, setResultBook] = useState<BenchmarkBook | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<BenchmarkBook | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      setBooks(await listBenchmarks(endpoint, token))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [endpoint, token])

  useEffect(() => {
    refresh()
  }, [refresh])

  // RUNNING 时 5s 轮询刷新 status/progress
  useEffect(() => {
    if (!books.some((b) => b.status === 'RUNNING')) return
    const t = setInterval(() => {
      listBenchmarks(endpoint, token)
        .then(setBooks)
        .catch(() => {
          /* 轮询失败不弹 toast,避免刷屏 */
        })
    }, 5000)
    return () => clearInterval(t)
  }, [books, endpoint, token])

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = '' // 重置,允许重选同一文件
    if (!f) return
    if (!f.name.toLowerCase().endsWith('.txt')) {
      toast.error('仅支持 .txt 文件')
      return
    }
    try {
      const result = await uploadBenchmark(endpoint, token, f, f.name)
      setConfirmTarget(result)
      setPendingTitle(f.name.replace(/\.txt$/i, ''))
      await refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '上传失败')
    }
  }

  const confirmDissect = () => {
    if (!confirmTarget) return
    const id = confirmTarget.id
    setConfirmTarget(null)
    // 只置 logBookId;LogDrawer 的 effect 负责发起 dissect 流(单点 fetch,
    // 避免重复 POST 被后端以「已在 RUNNING」拒绝)。
    setLogBookId(id)
  }

  /** PENDING 卡片「开始拆解」:重开确认弹窗(token 预估 + 标题)。 */
  const onStart = (book: BenchmarkBook) => {
    const chapterCount = (book.chapters as unknown[])?.length ?? 0
    setConfirmTarget({
      id: book.id,
      chapterCount,
      estTokens: chapterCount * 4000
    })
    setPendingTitle(book.title)
  }

  const onRetry = (book: BenchmarkBook) => {
    setLogBookId(book.id)
  }

  const onDelete = async () => {
    if (!confirmDelete) return
    const id = confirmDelete.id
    setConfirmDelete(null)
    try {
      await deleteBenchmark(endpoint, token, id)
      setBooks((prev) => prev.filter((b) => b.id !== id))
      toast.success('已删除')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '删除失败')
    }
  }

  const onBrowseResult = async (book: BenchmarkBook) => {
    try {
      const full = await getBenchmark(endpoint, token, book.id)
      setResultBook(full)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载结果失败')
    }
  }

  return (
    <div className="flex h-screen bg-bg-darkest">
      <AppSidebar active="dissect" />
      <main className="flex-1 overflow-y-auto">
        <div className="flex items-end justify-between px-8 pb-4 pt-6">
          <div>
            <h1 className="text-xl font-semibold text-text-primary">
              对标拆解
            </h1>
            <p className="mt-1 text-xs text-text-label">
              上传范本小说 → 自动拆解为文风/节奏/情绪/角色/剧情/章节摘要条目
            </p>
          </div>
          <Button
            variant="gradient"
            onClick={() => document.getElementById('dissect-upload')?.click()}
            className="h-10 rounded-pill px-5 text-sm font-medium shadow-[0_8px_24px_-8px_rgba(99,102,241,0.5)]"
          >
            <Upload className="size-4" />
            上传小说
          </Button>
          <input
            id="dissect-upload"
            type="file"
            accept=".txt"
            hidden
            onChange={onFile}
          />
        </div>

        {loading ? (
          <p className="px-8 text-sm text-text-tertiary">加载中…</p>
        ) : books.length === 0 ? (
          <p className="px-8 text-sm text-text-tertiary">
            还没有范本,点击「上传小说」开始。
          </p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4 px-8 pb-8">
            {books.map((b) => {
              const meta = STATUS_META[b.status]
              return (
                <div
                  key={b.id}
                  className="flex flex-col gap-2 rounded-2xl border border-overlay-15 bg-bg-cardElevated p-5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="line-clamp-1 flex-1 text-base font-semibold text-text-primary">
                      {b.title}
                    </h3>
                    <Badge variant={meta.variant} className="shrink-0">
                      {meta.label}
                    </Badge>
                  </div>
                  {b.status === 'RUNNING' && (
                    <p className="text-xs text-accent-indigoLight">
                      {progressText(b)}
                    </p>
                  )}
                  <p className="text-xs text-text-label">
                    {(b.chapters as unknown[])?.length ?? 0} 章 ·{' '}
                    {formatDate(b.createdAt)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {b.status === 'DONE' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onBrowseResult(b)}
                      >
                        浏览结果
                      </Button>
                    )}
                    {b.status === 'RUNNING' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setLogBookId(b.id)}
                      >
                        查看日志
                      </Button>
                    )}
                    {b.status === 'PENDING' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onStart(b)}
                      >
                        开始拆解
                      </Button>
                    )}
                    {(b.status === 'FAILED' || b.status === 'INTERRUPTED') && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onRetry(b)}
                      >
                        重试
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-text-tertiary hover:text-destructive"
                      onClick={() => setConfirmDelete(b)}
                    >
                      删除
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>

      {/* 二次确认:警告 token + 预估 + 模型建议(新上传 / PENDING 重新确认共用) */}
      <Dialog
        open={!!confirmTarget}
        onOpenChange={(o) => !o && setConfirmTarget(null)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>确认拆解?</DialogTitle>
          </DialogHeader>
          {confirmTarget && (
            <div className="space-y-3 text-sm">
              <div className="space-y-1">
                <label className="text-xs text-text-tertiary">标题</label>
                <input
                  type="text"
                  value={pendingTitle}
                  onChange={(e) => setPendingTitle(e.target.value)}
                  className="w-full rounded-md border border-overlay-15 bg-bg-card px-3 py-2 text-text-primary outline-none focus:border-accent-indigoLight"
                />
              </div>
              <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-300">
                <p className="font-medium">⚠ 预估消耗</p>
                <p className="mt-1 text-yellow-200/90">
                  共 <b>{confirmTarget.chapterCount}</b> 章,预估{' '}
                  <b>{(confirmTarget.estTokens / 1000).toFixed(1)}k</b> tokens。
                </p>
                <p className="mt-1 text-yellow-200/70">
                  建议在「设置」为 chapter-extractor
                  角色配置一个便宜的模型以控制成本。
                </p>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setConfirmTarget(null)}>
              取消
            </Button>
            <Button onClick={confirmDissect}>开始拆解</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 日志抽屉(流式解析) */}
      <LogDrawer
        bookId={logBookId}
        onClose={() => setLogBookId(null)}
        endpoint={endpoint}
        token={token}
        onCompleted={() => refresh()}
      />

      {/* 结果浏览 */}
      <ResultBrowser book={resultBook} onClose={() => setResultBook(null)} />

      {/* 删除二次确认 */}
      <Dialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>删除《{confirmDelete?.title}》?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-text-tertiary">
            章节文本与拆解条目将一并删除,此操作不可撤销。
          </p>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={onDelete}>
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default DissectPage

/* ------------------------------------------------------------------ */
/* LogDrawer:读 dissectBenchmarkStream / streamBenchmark 的 newline-JSON */
/* ------------------------------------------------------------------ */

interface LogRow {
  id: string
  ts: number
  label: string // event 标签 / activity.act
  text: string
  level: 'info' | 'think' | 'tool' | 'content' | 'error' | 'stage'
}

interface LogDrawerProps {
  bookId: string | null
  onClose: () => void
  endpoint: string
  token: string
  onCompleted: () => void
}

const LogDrawer = ({
  bookId,
  onClose,
  endpoint,
  token,
  onCompleted
}: LogDrawerProps) => {
  const [rows, setRows] = useState<LogRow[]>([])
  const [ended, setEnded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // id -> 累积文本(ActDelta 追加)
  const actTextRef = useRef<Map<string, string>>(new Map())
  // 已收到的 activity id 集合(去重,防 stream 重连续看重复)
  const seenIdsRef = useRef<Set<string>>(new Set())
  const containerRef = useRef<HTMLDivElement | null>(null)

  const pushRow = useCallback((row: LogRow) => {
    setRows((prev) => [...prev, row])
  }, [])

  // 处理单条流帧
  const handleFrame = useCallback(
    (frame: unknown) => {
      if (!frame || typeof frame !== 'object') return
      const ev = (frame as { event?: string }).event
      const ts = Date.now()
      if (ev === 'RunStarted') {
        pushRow({
          id: `rs-${ts}`,
          ts,
          label: 'RunStarted',
          text: '拆解开始',
          level: 'info'
        })
      } else if (ev === 'Heartbeat') {
        // 心跳不渲染,但可用于保活提示(此处静默)
      } else if (ev === 'RunCompleted') {
        const status = (frame as { status?: BenchmarkStatus }).status
        pushRow({
          id: `rc-${ts}`,
          ts,
          label: 'RunCompleted',
          text: status ? `流结束(${status})` : '流结束',
          level: 'info'
        })
        setEnded(true)
      } else if (ev === 'RunError') {
        const content = (frame as { content?: string }).content ?? '未知错误'
        pushRow({
          id: `re-${ts}`,
          ts,
          label: 'RunError',
          text: content,
          level: 'error'
        })
        setError(content)
        setEnded(true)
      } else if (ev === 'activity') {
        const activity = (frame as { activity?: ActivityEvent }).activity
        if (!activity) return
        handleActivity(activity, ts)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pushRow]
  )

  const handleActivity = useCallback(
    (act: ActivityEvent, ts: number) => {
      // 去重:同 id 的 ActStart 只建一次(stream 重连不会重复)
      if (
        (act.type === 'Act' ||
          act.type === 'ActDelta' ||
          act.type === 'ActTool' ||
          act.type === 'ActResult' ||
          act.type === 'ActEnd') &&
        seenIdsRef.current.has(act.id)
      ) {
        // ActDelta 仍要追加(同 id 的 delta 永远是新的),不去重 delta 文本
        if (act.type !== 'ActDelta') return
      }
      if (act.type === 'Act') {
        seenIdsRef.current.add(act.id)
        const levelMap: Record<string, LogRow['level']> = {
          think: 'think',
          tool: 'tool',
          content: 'content',
          stage: 'stage'
        }
        pushRow({
          id: act.id,
          ts,
          label: act.act,
          text: act.label ?? '',
          level: levelMap[act.act] ?? 'info'
        })
        actTextRef.current.set(act.id, act.label ?? '')
      } else if (act.type === 'ActDelta') {
        const prev = actTextRef.current.get(act.id) ?? ''
        const next = prev + act.text
        actTextRef.current.set(act.id, next)
        // 增量更新对应行
        setRows((prevRows) =>
          prevRows.map((r) => (r.id === act.id ? { ...r, text: next } : r))
        )
      } else if (act.type === 'ActTool') {
        setRows((prevRows) =>
          prevRows.map((r) =>
            r.id === act.id
              ? {
                  ...r,
                  text: `${r.text}\n[args] ${safeJson(act.args)}`
                }
              : r
          )
        )
      } else if (act.type === 'ActResult') {
        setRows((prevRows) =>
          prevRows.map((r) =>
            r.id === act.id
              ? {
                  ...r,
                  text: `${r.text}\n[result] ${safeJson(act.result)}`
                }
              : r
          )
        )
      } else if (act.type === 'ActEnd') {
        setRows((prevRows) =>
          prevRows.map((r) =>
            r.id === act.id
              ? {
                  ...r,
                  text:
                    act.summary && act.summary !== r.text
                      ? `${r.text}\n[${act.status}] ${act.summary}`
                      : `${r.text}\n[${act.status}]`
                }
              : r
          )
        )
      }
    },
    [pushRow]
  )

  // 读 ReadableStream,按 \n 切 + JSON.parse(增量 buffer)
  const readStream = useCallback(
    async (res: Response): Promise<boolean> => {
      if (!res.ok) {
        const msg = await res.text().catch(() => res.statusText)
        setError(msg || `HTTP ${res.status}`)
        setEnded(true)
        return false
      }
      if (!res.body) {
        setError('无响应体')
        setEnded(true)
        return false
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let sawCompleted = false
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          // 按 \n 切,最后一段可能不完整 → 留 buffer
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) continue
            try {
              handleFrame(JSON.parse(trimmed))
              if (trimmed.includes('"RunCompleted"')) sawCompleted = true
            } catch {
              /* 单行 JSON 解析失败跳过,不致命 */
            }
          }
        }
        // flush 剩余 buffer
        const tail = buffer.trim()
        if (tail) {
          try {
            handleFrame(JSON.parse(tail))
          } catch {
            /* ignore */
          }
        }
      } catch (e) {
        // 网络中断等
        setError(e instanceof Error ? e.message : '流读取失败')
      }
      return sawCompleted
    },
    [handleFrame]
  )

  // bookId 变化 → 重置 + 开流
  useEffect(() => {
    if (!bookId) return
    setRows([])
    setEnded(false)
    setError(null)
    actTextRef.current = new Map()
    seenIdsRef.current = new Set()
    let cancelled = false

    const run = async () => {
      // 先 POST dissect(启动 + 同连接流化);若后端拒(已 RUNNING)→ 回退 GET stream 续看
      let sawCompleted = false
      try {
        const res = await dissectBenchmarkStream(endpoint, token, bookId)
        if (!cancelled) sawCompleted = await readStream(res)
      } catch (e) {
        if (!cancelled) {
          // 网络错误直接置错
          setError(e instanceof Error ? e.message : '连接失败')
          setEnded(true)
          return
        }
      }
      // 流自然结束但没看到 RunCompleted 且没报错 → 后端 job 可能仍在跑(客户端断开重连场景),
      // 或 dissect 被拒(已在跑)。尝试 GET stream 续看。
      if (cancelled || sawCompleted || error) return
      try {
        const res2 = await streamBenchmark(endpoint, token, bookId)
        if (!cancelled) await readStream(res2)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '重连失败')
          setEnded(true)
        }
      }
    }

    run()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, endpoint, token])

  // 结束时通知父组件刷新
  useEffect(() => {
    if (ended) onCompleted()
  }, [ended, onCompleted])

  // 自动滚到底
  useEffect(() => {
    const el = containerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [rows])

  return (
    <Dialog open={!!bookId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[80vh] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>拆解日志</DialogTitle>
        </DialogHeader>
        <div
          ref={containerRef}
          className="flex h-[55vh] flex-col gap-1 overflow-y-auto rounded-md border border-overlay-15 bg-overlay-6 p-3 font-mono text-xs"
        >
          {rows.length === 0 && !error && (
            <p className="text-text-tertiary">等待活动…</p>
          )}
          {rows.map((r) => (
            <div key={r.id} className="flex gap-2">
              <span className="shrink-0 text-text-label">
                {new Date(r.ts).toLocaleTimeString('zh-CN', { hour12: false })}
              </span>
              <span
                className={cn(
                  'shrink-0 font-semibold',
                  r.level === 'think' && 'text-purple-400',
                  r.level === 'tool' && 'text-blue-400',
                  r.level === 'content' && 'text-text-primary',
                  r.level === 'stage' && 'text-accent-indigoLight',
                  r.level === 'error' && 'text-destructive',
                  r.level === 'info' && 'text-text-tertiary'
                )}
              >
                [{r.label}]
              </span>
              <span className="whitespace-pre-wrap break-all text-text-tertiary">
                {r.text || '…'}
              </span>
            </div>
          ))}
          {error && <p className="mt-2 text-destructive">错误: {error}</p>}
          {ended && !error && (
            <p className="mt-2 text-text-label">— 流结束 —</p>
          )}
          {!ended && !error && rows.length > 0 && (
            <p className="mt-2 animate-pulse text-text-label">▌ 拆解中…</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* ResultBrowser:按 type 分组展示 entries                              */
/* ------------------------------------------------------------------ */

const ResultBrowser = ({
  book,
  onClose
}: {
  book: BenchmarkBook | null
  onClose: () => void
}) => {
  const grouped: Record<BenchmarkEntryType, BenchmarkEntry[]> = groupByType(
    book?.entries ?? []
  )

  return (
    <Dialog open={!!book} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>《{book?.title}》拆解结果</DialogTitle>
        </DialogHeader>
        <div className="flex h-[65vh] flex-col gap-4 overflow-y-auto pr-1">
          {ENTRY_TYPE_ORDER.map((type) => {
            const items = grouped[type]
            if (!items || items.length === 0) return null
            return (
              <section key={type}>
                <h4 className="mb-2 text-sm font-semibold text-accent-indigoLight">
                  {ENTRY_TYPE_LABEL[type]}（{items.length}）
                </h4>
                <div className="flex flex-col gap-2">
                  {items
                    .slice()
                    .sort((a, b) => a.order - b.order)
                    .map((entry) => (
                      <article
                        key={entry.id}
                        className="rounded-md border border-overlay-15 bg-bg-cardElevated p-3"
                      >
                        <header className="mb-1 flex items-center gap-2">
                          <span className="text-sm font-medium text-text-primary">
                            {entry.title}
                          </span>
                          {entry.chapterNo != null && (
                            <span className="rounded bg-overlay-10 px-1.5 py-0.5 text-xs text-text-tertiary">
                              第 {entry.chapterNo} 章
                            </span>
                          )}
                        </header>
                        <p className="whitespace-pre-wrap break-words text-xs text-text-tertiary">
                          {entry.content}
                        </p>
                      </article>
                    ))}
                </div>
              </section>
            )
          })}
          {(!book?.entries || book.entries.length === 0) && (
            <p className="text-sm text-text-tertiary">暂无拆解条目。</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const safeJson = (v: unknown): string => {
  try {
    return typeof v === 'string' ? v : JSON.stringify(v)
  } catch {
    return String(v)
  }
}

const groupByType = (
  entries: BenchmarkEntry[]
): Record<BenchmarkEntryType, BenchmarkEntry[]> => {
  const out: Record<BenchmarkEntryType, BenchmarkEntry[]> = {
    CHAPTER: [],
    PLOT: [],
    RHYTHM: [],
    EMOTION: [],
    CHARACTER: [],
    STYLE: []
  }
  for (const e of entries) {
    if (out[e.type]) out[e.type].push(e)
  }
  return out
}
