'use client'

import { useState } from 'react'
import Link from 'next/link'
import { MoreVertical } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { NovelListItem } from '@/types/novel'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

interface Props {
  novel: NovelListItem
  onDelete: (id: string) => void
  onPublish?: (novel: NovelListItem) => void
}

const formatDate = (iso: string) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('zh-CN')
}

const STATUS_LABEL: Record<string, string> = {
  CONCEPT: '构思中',
  ACTIVE: '写作中'
}

const COVERS = [
  'bg-[linear-gradient(135deg,#6366f1,#8b5cf6)]',
  'bg-[linear-gradient(135deg,#3b82f6,#6366f1)]',
  'bg-[linear-gradient(135deg,#f59e0b,#ef4444)]',
  'bg-[linear-gradient(135deg,#ec4899,#8b5cf6)]',
  'bg-[linear-gradient(135deg,#10b981,#06b6d4)]'
]

const pickCover = (id: string) => {
  let sum = 0
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i)
  return COVERS[sum % COVERS.length]
}

const NovelCard = ({ novel, onDelete, onPublish }: Props) => {
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  return (
    <>
      <Link
        href={`/novels/${novel.id}`}
        className="group block overflow-hidden rounded-lg border border-overlay-15 bg-bg-card transition-shadow hover:shadow-lg hover:shadow-black/40"
      >
        {/* Cover — h-[158px], per-novel gradient bg */}
        <div className={cn('relative h-[158px] w-full', pickCover(novel.id))}>
          {/* status tag top-left */}
          <span className="absolute left-2.5 top-2.5 z-10 rounded-sm bg-black/40 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
            {(novel.status && STATUS_LABEL[novel.status]) ?? novel.status}
          </span>
          {/* ⋮ menu top-right — appears on hover; click does not navigate */}
          <div
            className="absolute right-1 top-1 z-20 opacity-0 transition-opacity group-hover:opacity-100"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
          >
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  title="更多"
                  className="flex size-7 items-center justify-center rounded-md bg-black/20 text-white/80 hover:bg-black/40 hover:text-white"
                >
                  <MoreVertical className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => {
                    setMenuOpen(false)
                    onPublish?.(novel)
                  }}
                >
                  发布
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={() => {
                    setMenuOpen(false)
                    setConfirmOpen(true)
                  }}
                >
                  删除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {/* title centered on cover */}
          <div className="absolute inset-0 flex items-center justify-center px-3.5 pt-7">
            <h3 className="line-clamp-2 text-center text-lg font-bold leading-tight text-white drop-shadow-md">
              {novel.title}
            </h3>
          </div>
        </div>

        {/* Info — p-3, 3 lines */}
        <div className="space-y-1.5 p-3">
          <div className="truncate text-sm font-semibold text-text-primary">
            {novel.title}
          </div>
          <div className="truncate text-xs text-text-tertiary">
            {novel.genre || '未分类'}
          </div>
          <div className="text-xs text-text-label">
            {formatDate(novel.updatedAt)}
          </div>
        </div>
      </Link>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>删除《{novel.title}》?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-text-tertiary">此操作不可撤销。</p>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmOpen(false)
                onDelete(novel.id)
              }}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default NovelCard
