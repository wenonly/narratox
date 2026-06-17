'use client'

import Link from 'next/link'
import type { Novel } from '@/types/novel'

const NovelCard = ({ novel }: { novel: Novel }) => (
  <Link
    href={`/novels/${novel.id}`}
    className="flex flex-col gap-2 rounded-2xl border border-primary/10 bg-background-secondary p-5 transition-colors hover:border-brand/40"
  >
    <div className="flex items-center justify-between">
      <h3 className="line-clamp-1 text-base font-semibold text-primary">
        {novel.title}
      </h3>
      {novel.genre && (
        <span className="rounded-md bg-accent px-2 py-0.5 text-xs text-muted">
          {novel.genre}
        </span>
      )}
    </div>
    <p className="line-clamp-2 text-xs text-muted">
      {novel.synopsis || '暂无简介'}
    </p>
    <p className="text-xs text-muted/60">{novel.chapters?.length ?? 0} 章</p>
  </Link>
)

export default NovelCard
