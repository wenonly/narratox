'use client'

import { useEffect, useState } from 'react'
import { Check, Copy, Download } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/store'
import { getStatus, publishNovel } from '@/api/novels'
import type { NovelListItem } from '@/types/novel'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

interface Props {
  novel: NovelListItem | null
  onClose: () => void
}

/**
 * 自定义 checkbox 方块(对标 Pencil):
 * 选中 = 18×18 indigo 填充 + 12px 白色 Check 图标
 * 未选中 = 透明 + #ffffff2e 边框,空白
 */
const CheckBox = ({ checked }: { checked: boolean }) => (
  <span
    className={cn(
      'flex size-[18px] shrink-0 items-center justify-center rounded-[4px] border',
      checked
        ? 'border-accent-primary bg-accent-primary'
        : 'border-[#ffffff2e] bg-transparent'
    )}
  >
    {checked && <Check className="size-3 text-text-primary" />}
  </span>
)

/** 章节范围数字输入框:60×36,radius-md,bg-darkest,indigo 边框(对标 Pencil) */
const NumberBox = ({
  value,
  onChange
}: {
  value: number
  onChange: (n: number) => void
}) => (
  <input
    type="number"
    min={1}
    value={value}
    onChange={(e) => onChange(Math.max(1, Number(e.target.value) || 1))}
    className="h-9 w-[60px] rounded-md border border-accent-primary bg-bg-darkest text-center text-sm font-medium text-text-primary outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [appearance:textfield]"
  />
)

const OptionRow = ({
  label,
  checked,
  onChange
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) => (
  <button
    type="button"
    onClick={() => onChange(!checked)}
    className="flex w-full items-center gap-2.5 text-left"
  >
    <CheckBox checked={checked} />
    <span className="text-sm text-text-body">{label}</span>
  </button>
)

const PublishDialog = ({ novel, onClose }: Props) => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const [from, setFrom] = useState(1)
  const [to, setTo] = useState(1)
  const [includeTitle, setIncludeTitle] = useState(true)
  const [indent, setIndent] = useState(true)
  const [synopsis, setSynopsis] = useState(false)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)

  // 拉态势拿 frontierChapter,作为 `to` 的默认值(=最新有正文章节,即默认全量)
  useEffect(() => {
    if (!novel) return
    getStatus(endpoint, token, novel.id)
      .then((s) => {
        if (s?.frontierChapter && s.frontierChapter > 0) {
          setFrom(1)
          setTo(s.frontierChapter)
        }
      })
      .catch(() => {})
  }, [endpoint, token, novel])

  // 预览:取 `from` 这一章按当前选项格式化的前若干字(单章,轻量)
  useEffect(() => {
    if (!novel) return
    let cancelled = false
    setPreviewLoading(true)
    publishNovel(endpoint, token, novel.id, {
      from,
      to: from,
      title: includeTitle,
      synopsis,
      indent
    })
      .then((text) => {
        if (!cancelled) setPreview(text.slice(0, 600))
      })
      .catch(() => {
        if (!cancelled) setPreview('')
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [endpoint, token, novel, from, includeTitle, synopsis, indent])

  if (!novel) return null

  const buildOpts = () => ({ from, to, title: includeTitle, synopsis, indent })
  const rangeLabel = `第${from}-${to}章`

  const handleCopy = async () => {
    setBusy(true)
    try {
      const text = await publishNovel(endpoint, token, novel.id, buildOpts())
      await navigator.clipboard.writeText(text)
      toast.success(`已复制 ${rangeLabel} 成稿`)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '生成失败')
    } finally {
      setBusy(false)
    }
  }

  const handleDownload = async () => {
    setBusy(true)
    try {
      const text = await publishNovel(endpoint, token, novel.id, buildOpts())
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${novel.title || '小说'}.txt`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '生成失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <DialogContent className="max-w-[520px] gap-[18px] p-7">
        <DialogHeader className="space-y-1">
          <DialogTitle className="text-xl">发布《{novel.title}》</DialogTitle>
          <p className="text-sm text-text-label">
            选择章节范围,生成可粘贴的纯文本
          </p>
        </DialogHeader>

        {/* 章节范围 */}
        <div className="flex w-full items-center gap-3">
          <span className="text-sm text-text-secondary">章节范围</span>
          <NumberBox value={from} onChange={setFrom} />
          <span className="text-sm text-text-label">—</span>
          <NumberBox value={to} onChange={setTo} />
        </div>

        {/* 选项 */}
        <div className="flex w-full flex-col gap-2.5">
          <OptionRow
            label="包含章节标题"
            checked={includeTitle}
            onChange={setIncludeTitle}
          />
          <OptionRow
            label="包含卷简介"
            checked={synopsis}
            onChange={setSynopsis}
          />
          <OptionRow
            label="首行缩进（两个全角空格）"
            checked={indent}
            onChange={setIndent}
          />
        </div>

        {/* 预览 */}
        <div className="flex w-full flex-col gap-2">
          <span className="text-xs font-medium text-text-label">预览</span>
          <div className="h-[120px] w-full overflow-y-auto rounded-md border border-[#ffffff0f] bg-bg-darkest p-3.5">
            {previewLoading && !preview ? (
              <span className="text-xs text-text-label">生成预览中…</span>
            ) : preview ? (
              <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-text-tertiary">
                {preview}
              </pre>
            ) : (
              <span className="text-xs text-text-label">无预览</span>
            )}
          </div>
        </div>

        {/* 按钮 */}
        <div className="flex w-full justify-end gap-2.5 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-[#ffffff1f] px-4 py-2 text-sm font-medium text-text-body transition-colors hover:bg-overlay-10 disabled:opacity-50"
          >
            关闭
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-md border border-[#ffffff1f] px-4 py-2 text-sm font-medium text-text-body transition-colors hover:bg-overlay-10 disabled:opacity-50"
          >
            <Download className="size-3.5" />
            下载 .txt
          </button>
          <button
            type="button"
            onClick={handleCopy}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-md bg-gradient-to-b from-accent-primary to-accent-violet px-4 py-2 text-sm font-semibold text-text-primary transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Copy className="size-3.5" />
            {busy ? '生成中…' : '复制到剪贴板'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default PublishDialog
