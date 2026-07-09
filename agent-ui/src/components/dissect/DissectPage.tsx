'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Search,
  Sparkles,
  Upload,
  Zap
} from 'lucide-react'
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
  BenchmarkStatus,
  DissectReview
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
import {
  BENCHMARK_DIMENSIONS,
  ENTRY_TYPE_LABEL,
  DIM_COLOR,
  TAB_LIST
} from '@/lib/benchmark-dimensions'
import { MaterialView } from './MaterialView'

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
  const [logSession, setLogSession] = useState<{
    id: string
    mode: 'start' | 'watch'
  } | null>(null)
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
    setLogSession({ id, mode: 'start' })
    // 乐观置 RUNNING:卡片立刻翻状态,并启动 RUNNING 轮询(避免关日志前卡片 stale 在 PENDING)
    setBooks((prev) =>
      prev.map((b) => (b.id === id ? { ...b, status: 'RUNNING' } : b))
    )
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
    setLogSession({ id: book.id, mode: 'start' })
  }

  /** RUNNING 卡片「查看日志」:只续看,不重新 POST(避免对在跑任务报「正在拆解中」)。 */
  const onWatch = (book: BenchmarkBook) => {
    setLogSession({ id: book.id, mode: 'watch' })
  }

  /** 关闭日志:同步卡片状态(覆盖「流未结束就关闭」导致的 stale)。 */
  const closeLog = () => {
    setLogSession(null)
    refresh()
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
                        onClick={() => onWatch(b)}
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
            <Button variant="gradient" onClick={confirmDissect}>
              <Zap className="size-3.5" />
              开始拆解
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 日志抽屉(流式解析) */}
      <LogDrawer
        bookId={logSession?.id ?? null}
        mode={logSession?.mode ?? 'start'}
        onClose={closeLog}
        endpoint={endpoint}
        token={token}
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
  /** 'start' = POST /dissect 启动+流化(被拒/断流回退 GET);'watch' = 只 GET 续看,不 POST。 */
  mode: 'start' | 'watch'
  onClose: () => void
  endpoint: string
  token: string
}

const LogDrawer = ({
  bookId,
  mode,
  onClose,
  endpoint,
  token
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

  // bookId / mode 变化 → 重置 + 按 mode 开流
  useEffect(() => {
    if (!bookId) return
    setRows([])
    setEnded(false)
    setError(null)
    actTextRef.current = new Map()
    seenIdsRef.current = new Set()
    let cancelled = false

    // start:POST /dissect 启动 + 同连接流化;被拒(已 RUNNING)/ 客户端断流 → 清瞬时态,GET 接管续看
    const startStream = async () => {
      let sawCompleted = false
      try {
        const res = await dissectBenchmarkStream(endpoint, token, bookId)
        if (!cancelled) sawCompleted = await readStream(res)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '连接失败')
          setEnded(true)
          return
        }
      }
      if (cancelled || sawCompleted) return
      // POST 未正常收尾(被拒 / 客户端断流重连)→ 清瞬时错误,GET 续看接管
      if (!cancelled) {
        setError(null)
        setEnded(false)
      }
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

    // watch:只 GET /stream 续看(不 POST,避免对已 RUNNING 任务报「正在拆解中」)
    const watchStream = async () => {
      try {
        const res = await streamBenchmark(endpoint, token, bookId)
        if (!cancelled) await readStream(res)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '连接失败')
          setEnded(true)
        }
      }
    }

    void (mode === 'start' ? startStream() : watchStream())
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, mode, endpoint, token])

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
/* ResultBrowser:7 维度 Tab · 章节/角色 主从 · 剧情/节奏/情绪/文风/素材 阅读栏 · 总评完整性报告
   对标设计:design/narratox.pen 11b / 11c / 11d 帧。
   维度元数据(label/color/tab)走单源 @/lib/benchmark-dimensions。            */
/* ------------------------------------------------------------------ */

/** active tab / list 项的软 indigo 底。 */
const ACTIVE_BG = 'rgba(99, 102, 241, 0.15)'

type ResultTab = BenchmarkEntryType | 'REVIEW'

/** 把 entry.content 的 【header】body 切成段;无 【】 标记返回空(由调用方整段渲染)。 */
const parseSections = (content: string): { header: string; body: string }[] => {
  if (!content) return []
  // split 带捕获组 → [pre, h1, b1, h2, b2, …]
  const parts = content.split(/【([^】]+)】/)
  if (parts.length < 3) return []
  const out: { header: string; body: string }[] = []
  for (let i = 1; i < parts.length; i += 2) {
    out.push({ header: parts[i], body: (parts[i + 1] ?? '').trim() })
  }
  return out
}

const ResultBrowser = ({
  book,
  onClose
}: {
  book: BenchmarkBook | null
  onClose: () => void
}) => {
  const grouped = useMemo(
    () => groupByType(book?.entries ?? []),
    [book?.entries]
  )
  const [tab, setTab] = useState<ResultTab>('CHAPTER')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // 切书重置选择 / 搜索
  useEffect(() => {
    setSelectedId(null)
    setQuery('')
  }, [book?.id])

  const review = (book?.review ?? null) as DissectReview | null
  const entryCount = book?.entries?.length ?? 0
  const chapterTotal = book?.chapters ? (book.chapters as unknown[]).length : 0

  return (
    <Dialog open={!!book} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[88vh] max-h-[88vh] w-[96vw] flex-col gap-0 overflow-hidden rounded-dialog border border-overlay-15 bg-bg-card p-0 sm:max-w-6xl">
        {/* Header:标题 + meta(close 用 DialogContent 自带 X) */}
        <div className="border-b border-overlay-10 px-6 py-4 pr-12">
          <DialogTitle className="text-base font-semibold text-text-primary">
            《{book?.title}》拆解结果
          </DialogTitle>
          <p className="mt-1 text-xs text-text-label">
            {BENCHMARK_DIMENSIONS.length} 个维度 · {entryCount} 条
            {chapterTotal ? ` · ${chapterTotal} 章` : ''}
            {book ? ` · ${formatDate(book.createdAt)}` : ''}
          </p>
        </div>

        {/* Tab strip */}
        <div className="flex items-center gap-1 px-6 py-2">
          {TAB_LIST.map((t) => {
            const active = tab === t.key
            const items = grouped[t.key]
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                style={active ? { backgroundColor: ACTIVE_BG } : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-md px-3 py-1.5 text-xs transition-colors',
                  active
                    ? 'font-semibold text-text-primary'
                    : 'font-medium text-text-tertiary hover:bg-overlay-5 hover:text-text-secondary'
                )}
              >
                <span
                  className="size-1.5 rounded-full"
                  style={{ backgroundColor: DIM_COLOR[t.key] }}
                />
                {t.label}
                {t.count && items.length > 0 && (
                  <span className="rounded-pill bg-overlay-10 px-1.5 py-px text-[9px] font-normal text-text-secondary">
                    {items.length}
                  </span>
                )}
              </button>
            )
          })}
          <span className="mx-1 h-4 w-px bg-overlay-15" />
          <button
            onClick={() => setTab('REVIEW')}
            style={
              tab === 'REVIEW' ? { backgroundColor: ACTIVE_BG } : undefined
            }
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors',
              tab === 'REVIEW'
                ? 'font-semibold text-text-primary'
                : 'font-medium text-text-tertiary hover:bg-overlay-5 hover:text-text-secondary'
            )}
          >
            <Sparkles className="size-3" />
            总评
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 px-6 pb-6">
          {(tab === 'CHAPTER' || tab === 'CHARACTER') && (
            <ListView
              entries={grouped[tab]}
              accent={DIM_COLOR[tab]}
              selectedId={selectedId}
              onSelect={setSelectedId}
              query={query}
              onQuery={setQuery}
              searchPlaceholder={tab === 'CHAPTER' ? '搜索章节…' : '搜索角色…'}
              listTitle={tab === 'CHAPTER' ? '章节' : '角色'}
              countLabel={
                tab === 'CHAPTER'
                  ? `共 ${grouped.CHAPTER.length} 章`
                  : `${grouped.CHARACTER.length} 个`
              }
              getTitle={(e) =>
                tab === 'CHAPTER' ? `第 ${e.chapterNo ?? '?'} 章` : e.title
              }
              getPreview={(e) => {
                const secs = parseSections(e.content)
                const body =
                  secs.find(
                    (s) =>
                      s.header.includes('摘要') || s.header.includes('人设')
                  )?.body ?? e.content
                return body.slice(0, 32)
              }}
              detailTitle={(e) =>
                tab === 'CHAPTER' ? `第 ${e.chapterNo ?? '?'} 章` : e.title
              }
              emptyLabel={tab === 'CHAPTER' ? '暂无章节摘要' : '暂无角色卡'}
            />
          )}
          {tab === 'PLOT' && (
            <ReadingView entry={grouped.PLOT[0]} accent={DIM_COLOR.PLOT} />
          )}
          {tab === 'RHYTHM' && (
            <ReadingView entry={grouped.RHYTHM[0]} accent={DIM_COLOR.RHYTHM} />
          )}
          {tab === 'EMOTION' && (
            <ReadingView
              entry={grouped.EMOTION[0]}
              accent={DIM_COLOR.EMOTION}
            />
          )}
          {tab === 'STYLE' && (
            <ReadingView entry={grouped.STYLE[0]} accent={DIM_COLOR.STYLE} />
          )}
          {tab === 'MATERIAL' && <MaterialView entries={grouped.MATERIAL} />}
          {tab === 'REVIEW' && (
            <ReviewView book={book} grouped={grouped} review={review} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* ---- 主从列表(章节 / 角色共用)---- */

const ListView = ({
  entries,
  accent,
  selectedId,
  onSelect,
  query,
  onQuery,
  searchPlaceholder,
  listTitle,
  countLabel,
  getTitle,
  getPreview,
  detailTitle,
  emptyLabel
}: {
  entries: BenchmarkEntry[]
  accent: string
  selectedId: string | null
  onSelect: (id: string) => void
  query: string
  onQuery: (q: string) => void
  searchPlaceholder: string
  listTitle: string
  countLabel: string
  getTitle: (e: BenchmarkEntry) => string
  getPreview: (e: BenchmarkEntry) => string
  detailTitle: (e: BenchmarkEntry) => string
  emptyLabel: string
}) => {
  const sorted = useMemo(
    () =>
      entries
        .slice()
        .sort((a, b) => (a.chapterNo ?? a.order) - (b.chapterNo ?? b.order)),
    [entries]
  )
  const q = query.trim().toLowerCase()
  const filtered = q
    ? sorted.filter(
        (e) =>
          getTitle(e).toLowerCase().includes(q) ||
          e.content.toLowerCase().includes(q)
      )
    : sorted
  const selected =
    filtered.find((e) => e.id === selectedId) ??
    sorted.find((e) => e.id === selectedId) ??
    filtered[0] ??
    sorted[0]

  return (
    <div className="flex h-full gap-4">
      {/* 列表面板 */}
      <div className="flex w-56 shrink-0 flex-col overflow-hidden rounded-lg bg-bg-darkest">
        <div className="border-b border-overlay-10 p-2">
          <div className="mb-1.5 flex items-center justify-between px-1">
            <span className="text-xs font-semibold text-text-secondary">
              {listTitle}
            </span>
            <span className="text-[10px] text-text-label">{countLabel}</span>
          </div>
          <SearchInput
            value={query}
            onChange={onQuery}
            placeholder={searchPlaceholder}
          />
        </div>
        <div className="flex flex-col gap-0.5 overflow-y-auto p-1.5">
          {filtered.map((e) => {
            const active = selected?.id === e.id
            return (
              <button
                key={e.id}
                onClick={() => onSelect(e.id)}
                className={cn(
                  'relative flex flex-col gap-0.5 rounded-md px-2.5 py-2 text-left',
                  active ? '' : 'hover:bg-overlay-5'
                )}
                style={active ? { backgroundColor: ACTIVE_BG } : undefined}
              >
                {active && (
                  <span
                    className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full"
                    style={{ backgroundColor: accent }}
                  />
                )}
                <span
                  className={cn(
                    'text-xs font-semibold',
                    active ? 'text-text-bright' : 'text-text-secondary'
                  )}
                >
                  {getTitle(e)}
                </span>
                <span
                  className={cn(
                    'line-clamp-1 text-[11px]',
                    active ? 'text-text-secondary' : 'text-text-label'
                  )}
                >
                  {getPreview(e)}
                </span>
              </button>
            )
          })}
          {filtered.length === 0 && (
            <p className="px-2 py-6 text-center text-xs text-text-label">
              无匹配
            </p>
          )}
        </div>
      </div>
      {/* 详情面板 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {selected ? (
          <EntryDetail
            entry={selected}
            accent={accent}
            title={detailTitle(selected)}
            showChapterTag={selected.chapterNo != null}
          />
        ) : (
          <EmptyDetail label={emptyLabel} />
        )}
      </div>
    </div>
  )
}

/* ---- 阅读型单栏(剧情 / 节奏 / 情绪 / 文风)---- */

const ReadingView = ({
  entry,
  accent
}: {
  entry: BenchmarkEntry | undefined
  accent: string
}) => {
  if (!entry) return <EmptyDetail label="暂无该维度条目" />
  const sections = parseSections(entry.content)
  return (
    <div className="h-full overflow-y-auto">
      <article className="mx-auto flex max-w-3xl flex-col gap-5 py-1">
        <header className="flex items-center gap-2">
          <span
            className="size-2 rounded-full"
            style={{ backgroundColor: accent }}
          />
          <h3 className="text-sm font-medium text-text-secondary">
            {entry.title}
          </h3>
        </header>
        {sections.length === 0 ? (
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-text-body">
            {entry.content}
          </p>
        ) : (
          sections.map((s, i) => (
            <Section key={i} header={s.header} body={s.body} accent={accent} />
          ))
        )}
      </article>
    </div>
  )
}

/* ---- 总评:完整性报告(对标 11d;review = {summary, missingTypes, notes}) ---- */

const ReviewView = ({
  book,
  grouped,
  review
}: {
  book: BenchmarkBook | null
  grouped: Record<BenchmarkEntryType, BenchmarkEntry[]>
  review: DissectReview | null
}) => {
  const chapterTotal = book?.chapters ? (book.chapters as unknown[]).length : 0
  const missing = review?.missingTypes ?? []
  const complete = missing.length === 0
  // server zod: notes 是单个 string(可能多行);按行拆成 bullet。空字符串 → []。
  const notes = (review?.notes ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  const stats: [string, string][] = [
    ['章节', String(chapterTotal)],
    ['角色', String(grouped.CHARACTER.length)],
    ['条目', String(book?.entries?.length ?? 0)],
    ['拆解日期', book ? formatDate(book.createdAt).split(' ')[0] || '-' : '-']
  ]
  const allDims = BENCHMARK_DIMENSIONS.map((d) => d.key)
  const bannerBg = complete
    ? 'linear-gradient(135deg, rgba(34,197,94,0.12), rgba(99,102,241,0.12))'
    : 'linear-gradient(135deg, rgba(245,158,11,0.12), rgba(99,102,241,0.12))'
  const bannerColor = complete ? '#22C55E' : '#F59E0B'

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 py-1">
        {/* stats */}
        <div className="grid grid-cols-4 gap-3">
          {stats.map((s) => (
            <div
              key={s[0]}
              className="flex flex-col gap-1 rounded-md bg-overlay-5 px-3.5 py-2.5"
            >
              <span className="text-lg font-bold text-text-bright">{s[1]}</span>
              <span className="text-[10px] text-text-label">{s[0]}</span>
            </div>
          ))}
        </div>
        {/* 完整性 banner */}
        <div
          className="flex items-center gap-3 rounded-lg border p-3.5"
          style={{ borderColor: bannerColor + '40', background: bannerBg }}
        >
          <div
            className="flex size-7 shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: bannerColor + '26' }}
          >
            {complete ? (
              <Check className="size-4" style={{ color: bannerColor }} />
            ) : (
              <AlertTriangle
                className="size-4"
                style={{ color: bannerColor }}
              />
            )}
          </div>
          <div className="flex flex-1 flex-col gap-0.5">
            <span className="text-sm font-semibold text-text-primary">
              {complete ? '拆解完整' : '部分缺失'}
            </span>
            <span className="text-xs text-text-label">
              {complete
                ? `${BENCHMARK_DIMENSIONS.length - missing.length} / ${BENCHMARK_DIMENSIONS.length} 维度齐全` +
                  (chapterTotal ? ` · ${chapterTotal} 章覆盖` : '')
                : `缺 ${missing.map((m) => ENTRY_TYPE_LABEL[m]).join('、')}`}
            </span>
          </div>
          <span
            className="rounded-pill px-2.5 py-1 text-[10px] font-semibold"
            style={{ backgroundColor: bannerColor + '26', color: bannerColor }}
          >
            {complete ? '完整性通过' : '需补拆'}
          </span>
        </div>
        {/* 维度完整度 chips */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-text-secondary">
            维度完整度
          </span>
          <span className="text-xs" style={{ color: bannerColor }}>
            {BENCHMARK_DIMENSIONS.length - missing.length} /{' '}
            {BENCHMARK_DIMENSIONS.length}
          </span>
          {allDims.map((d) => {
            const ok = !missing.includes(d)
            return (
              <span
                key={d}
                className="flex items-center gap-1 rounded-pill bg-overlay-10 px-2 py-0.5 text-[10px] text-text-secondary"
              >
                {ok ? (
                  <Check className="size-2.5" style={{ color: DIM_COLOR[d] }} />
                ) : (
                  <AlertTriangle
                    className="size-2.5"
                    style={{ color: '#F59E0B' }}
                  />
                )}
                {ENTRY_TYPE_LABEL[d]}
              </span>
            )
          })}
        </div>
        {/* 审核摘要 */}
        {review?.summary && (
          <Section
            header="审核摘要"
            body={review.summary}
            accent={DIM_COLOR.CHAPTER}
          />
        )}
        {/* 审核备注 */}
        {notes.length > 0 && (
          <section className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span
                className="h-3.5 w-[3px] rounded-full"
                style={{ backgroundColor: '#60A5FA' }}
              />
              <h4 className="text-sm font-semibold text-text-secondary">
                【审核备注】
              </h4>
              <span className="text-[10px] text-text-label">
                critic · {notes.length} 条
              </span>
            </div>
            <ul className="flex flex-col gap-1.5">
              {notes.map((n, i) => (
                <li key={i} className="flex gap-2 text-sm text-text-body">
                  <span
                    className="mt-[7px] size-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: '#60A5FA' }}
                  />
                  <span className="whitespace-pre-wrap break-words">{n}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {!review && (
          <p className="rounded-md border border-overlay-10 bg-overlay-5 px-4 py-6 text-center text-sm text-text-tertiary">
            暂未生成总评 — 拆解未跑完或 critic 未运行。
          </p>
        )}
      </div>
    </div>
  )
}

/* ---- 共享小组件 ---- */

const EntryDetail = ({
  entry,
  accent,
  title,
  showChapterTag
}: {
  entry: BenchmarkEntry
  accent: string
  title: string
  showChapterTag: boolean
}) => {
  const sections = parseSections(entry.content)
  return (
    <article className="flex flex-col gap-5 py-1">
      <header className="flex items-center gap-2">
        <h3 className="text-lg font-semibold text-text-primary">{title}</h3>
        {showChapterTag && (
          <span
            className="rounded-pill px-2 py-0.5 text-[10px] font-semibold"
            style={{ backgroundColor: accent + '26', color: accent }}
          >
            CHAPTER
          </span>
        )}
      </header>
      {sections.length === 0 ? (
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-text-body">
          {entry.content}
        </p>
      ) : (
        sections.map((s, i) => (
          <Section key={i} header={s.header} body={s.body} accent={accent} />
        ))
      )}
    </article>
  )
}

const Section = ({
  header,
  body,
  accent
}: {
  header: string
  body: string
  accent: string
}) => {
  // 角色提及 → 切成 chips(按 、 , ， 分隔)
  if (header.includes('角色提及')) {
    const names = body
      .split(/[、,，]/)
      .map((s) => s.trim())
      .filter(Boolean)
    if (names.length > 0) {
      return (
        <section className="flex flex-col gap-2">
          <SectionHeader header={header} accent={accent} />
          <div className="flex flex-wrap gap-1.5">
            {names.map((n, i) => (
              <span
                key={i}
                className="flex items-center gap-1.5 rounded-pill bg-overlay-10 px-2.5 py-1 text-xs text-text-secondary"
              >
                <span
                  className="size-1.5 rounded-full"
                  style={{ backgroundColor: '#22C55E' }}
                />
                {n}
              </span>
            ))}
          </div>
        </section>
      )
    }
  }
  // bullet list(行首 1. / - / •)
  const lines = body
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  const isBullet =
    lines.length > 1 && lines.every((l) => /^(\d+[.、]|[-*•])/.test(l))
  return (
    <section className="flex flex-col gap-2">
      <SectionHeader header={header} accent={accent} />
      {isBullet ? (
        <ul className="flex flex-col gap-1.5">
          {lines.map((l, i) => (
            <li
              key={i}
              className="flex gap-2 text-sm leading-relaxed text-text-body"
            >
              <span
                className="mt-[7px] size-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: accent }}
              />
              <span className="whitespace-pre-wrap break-words">
                {l.replace(/^(\d+[.、]|[-*•])\s*/, '')}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-text-body">
          {body}
        </p>
      )}
    </section>
  )
}

const SectionHeader = ({
  header,
  accent
}: {
  header: string
  accent: string
}) => (
  <div className="flex items-center gap-2">
    <span
      className="h-3.5 w-[3px] rounded-full"
      style={{ backgroundColor: accent }}
    />
    <h4 className="text-sm font-semibold text-text-secondary">【{header}】</h4>
  </div>
)

const SearchInput = ({
  value,
  onChange,
  placeholder
}: {
  value: string
  onChange: (v: string) => void
  placeholder: string
}) => (
  <div className="relative">
    <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-text-label" />
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-md border border-overlay-10 bg-overlay-5 py-1.5 pl-7 pr-2 text-xs text-text-primary outline-none placeholder:text-text-label focus:border-accent-indigoLight"
    />
  </div>
)

const EmptyDetail = ({ label }: { label: string }) => (
  <div className="flex h-full items-center justify-center">
    <p className="text-sm text-text-tertiary">{label}</p>
  </div>
)

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
  const out = Object.fromEntries(
    BENCHMARK_DIMENSIONS.map((d) => [d.key, []])
  ) as unknown as Record<BenchmarkEntryType, BenchmarkEntry[]>
  for (const e of entries) {
    if (out[e.type]) out[e.type].push(e)
  }
  return out
}
