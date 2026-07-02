'use client'

import { useState } from 'react'
import Link from 'next/link'
import { MoreHorizontal } from 'lucide-react'
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
import { Badge } from '@/components/ui/badge'

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
        className={cn(
          'group relative flex flex-col overflow-hidden rounded-lg border border-overlay-15 bg-bg-card transition-colors hover:border-accent-indigoLight',
          novel.status === 'ACTIVE' && 'border-l-2 border-l-accent-indigoLight'
        )}
      >
        <div className={cn('relative h-28 shrink-0', pickCover(novel.id))}>
          <div className="absolute left-3 top-3">
            {novel.status === 'CONCEPT' ? (
              <Badge variant="neutral">构思中</Badge>
            ) : (
              <Badge variant="accent">写作中</Badge>
            )}
          </div>
          <div
            className="absolute right-3 top-3 z-10 opacity-0 transition-opacity group-hover:opacity-100"
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
                  className="rounded-md bg-overlay-10 p-1 text-text-tertiary hover:text-text-primary"
                >
                  <MoreHorizontal className="h-4 w-4" />
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
        </div>

        <div className="flex flex-1 flex-col gap-1.5 p-4">
          <h3 className="line-clamp-1 text-base font-semibold text-text-primary">
            {novel.title}
          </h3>
          {novel.genre ? (
            <span className="text-xs text-text-tertiary">{novel.genre}</span>
          ) : null}
          <p className="line-clamp-3 text-xs text-text-tertiary">
            {novel.synopsis || '暂无简介'}
          </p>
          <div className="mt-auto flex items-center justify-between pt-2">
            <span className="text-xs text-text-label">
              {formatDate(novel.updatedAt)}
            </span>
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
