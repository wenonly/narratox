'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { NovelListItem } from '@/types/novel'

interface Props {
  novel: NovelListItem
  onDelete: (id: string) => void
}

const formatDate = (iso: string) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('zh-CN')
}

const NovelCard = ({ novel, onDelete }: Props) => (
  <Link
    href={`/novels/${novel.id}`}
    className={cn(
      'group relative flex flex-col gap-2 rounded-2xl border border-primary/10 bg-background-secondary p-5 transition-colors hover:border-brand/40',
      novel.status === 'ACTIVE' && 'border-l-2 border-l-brand/60'
    )}
  >
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (confirm(`确定删除《${novel.title}》？此操作不可撤销。`)) {
          onDelete(novel.id)
        }
      }}
      title="删除"
      className="absolute right-3 top-3 rounded-md bg-destructive/80 p-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100"
    >
      🗑
    </button>
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
    {novel.genre && <span className="text-xs text-muted">{novel.genre}</span>}
    <p className="line-clamp-3 text-xs text-muted/80">
      {novel.synopsis || '暂无简介'}
    </p>
    <div className="mt-auto flex items-center justify-between pt-2">
      <span className="text-xs text-muted/50">
        {formatDate(novel.updatedAt)}
      </span>
    </div>
  </Link>
)

export default NovelCard
