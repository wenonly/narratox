'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { useStore } from '@/store'
import { publishNovel } from '@/api/novels'
import type { NovelListItem } from '@/types/novel'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface Props {
  novel: NovelListItem | null
  onClose: () => void
}

const PublishDialog = ({ novel, onClose }: Props) => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const [rangeMode, setRangeMode] = useState<'all' | 'range'>('all')
  const [from, setFrom] = useState(1)
  const [to, setTo] = useState(1)
  const [includeTitle, setIncludeTitle] = useState(true)
  const [indent, setIndent] = useState(true)
  const [synopsis, setSynopsis] = useState(false)
  const [busy, setBusy] = useState(false)

  if (!novel) return null

  const buildOpts = () => ({
    from: rangeMode === 'all' ? 0 : from,
    to: rangeMode === 'all' ? 0 : to,
    title: includeTitle,
    synopsis,
    indent
  })

  const rangeLabel = rangeMode === 'all' ? '全部章节' : `第${from}-${to}章`

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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>发布《{novel.title}》</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2 text-sm text-primary">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="w-16 shrink-0 text-xs text-muted">章节范围</span>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                checked={rangeMode === 'all'}
                onChange={() => setRangeMode('all')}
              />
              全部
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                checked={rangeMode === 'range'}
                onChange={() => setRangeMode('range')}
              />
              第
            </label>
            <input
              type="number"
              min={1}
              value={from}
              disabled={rangeMode !== 'range'}
              onChange={(e) => setFrom(Number(e.target.value) || 1)}
              className="w-16 rounded border border-primary/10 bg-background px-1 py-0.5 disabled:opacity-40"
            />
            <span className="text-muted">–</span>
            <input
              type="number"
              min={1}
              value={to}
              disabled={rangeMode !== 'range'}
              onChange={(e) => setTo(Number(e.target.value) || 1)}
              className="w-16 rounded border border-primary/10 bg-background px-1 py-0.5 disabled:opacity-40"
            />
            <span className="text-muted">章</span>
          </div>
          <div className="space-y-1.5">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={includeTitle}
                onChange={(e) => setIncludeTitle(e.target.checked)}
              />
              含章题行
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={indent}
                onChange={(e) => setIndent(e.target.checked)}
              />
              首行缩进(全角空格×2)
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={synopsis}
                onChange={(e) => setSynopsis(e.target.checked)}
              />
              含简介(开头)
            </label>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            取消
          </Button>
          <Button onClick={handleCopy} disabled={busy}>
            {busy ? '生成中…' : '复制到剪贴板'}
          </Button>
          <Button variant="secondary" onClick={handleDownload} disabled={busy}>
            下载 .txt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default PublishDialog
