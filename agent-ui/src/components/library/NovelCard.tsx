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

const NovelCard = ({ novel, onDelete, onPublish }: Props) => {
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  return (
    <>
      <Link
        href={`/novels/${novel.id}`}
        className={cn(
          'group relative flex flex-col gap-2 rounded-2xl border border-primary/10 bg-background-secondary p-5 transition-colors hover:border-brand/40',
          novel.status === 'ACTIVE' && 'border-l-2 border-l-brand/60'
        )}
      >
        {/* ⋮ 三点菜单:stopPropagation 不触发卡片 Link 跳转 */}
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
                className="rounded-md bg-background-secondary/80 p-1 text-muted hover:text-primary"
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

        <div className="flex items-start justify-between gap-2 pr-8">
          <h3 className="line-clamp-1 text-base font-semibold text-primary">
            {novel.title}
          </h3>
          <span
            className={cn(
              'shrink-0 rounded-md px-2 py-0.5 text-xs',
              novel.status === 'CONCEPT'
                ? 'bg-accent text-muted'
                : 'bg-brand/20 text-brand'
            )}
          >
            {novel.status === 'CONCEPT' ? '构思中' : '写作中'}
          </span>
        </div>
        {novel.genre && (
          <span className="text-xs text-muted">{novel.genre}</span>
        )}
        <p className="line-clamp-3 text-xs text-muted/80">
          {novel.synopsis || '暂无简介'}
        </p>
        <div className="mt-auto flex items-center justify-between pt-2">
          <span className="text-xs text-muted/50">
            {formatDate(novel.updatedAt)}
          </span>
        </div>
      </Link>

      {/* 删除二次确认 */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>删除《{novel.title}》?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted">此操作不可撤销。</p>
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
