'use client'

import { useStore } from '@/store'
import type { Novel } from '@/types/novel'
import MarkdownRenderer from '@/components/ui/typography/MarkdownRenderer'

type ResourceKey =
  | 'outline'
  | 'chapters'
  | 'characters'
  | 'worldview'
  | 'status'
  | 'info'

interface Props {
  resource: ResourceKey
  novel: Novel
  onClose: () => void
  onSaved: () => void
}

const TITLES: Record<ResourceKey, string> = {
  outline: '大纲',
  chapters: '正文',
  characters: '角色',
  worldview: '世界观',
  status: '状态',
  info: '小说信息'
}

const ResourcePanel = ({ resource, novel, onClose }: Props) => {
  const writingChapterOrder = useStore((s) => s.writingChapterOrder)

  return (
    <section className="flex w-[420px] shrink-0 flex-col overflow-hidden border-l border-primary/10 bg-background">
      <header className="flex items-center justify-between px-4 py-3">
        <h2 className="text-sm font-semibold text-primary">
          {TITLES[resource]}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="text-lg leading-none text-muted hover:text-primary"
        >
          ×
        </button>
      </header>
      <div className="flex-1 overflow-y-auto px-4 pb-6">
        {resource === 'chapters' && (
          <ChaptersView
            novel={novel}
            writingChapterOrder={writingChapterOrder}
          />
        )}
        {resource === 'info' && <InfoView novel={novel} />}
        {resource !== 'chapters' && resource !== 'info' && (
          <div className="flex h-full items-center justify-center text-sm text-muted">
            {TITLES[resource]} · 即将推出
          </div>
        )}
      </div>
    </section>
  )
}

const ChaptersView = ({
  novel,
  writingChapterOrder
}: {
  novel: Novel
  writingChapterOrder: number | null
}) => {
  if (writingChapterOrder !== null) {
    return (
      <div>
        <p className="mb-2 text-xs text-muted">
          第 {writingChapterOrder} 章 · AI 写作中…
        </p>
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-4 animate-pulse rounded bg-accent"
              style={{ width: `${70 + ((i * 7) % 30)}%` }}
            />
          ))}
        </div>
      </div>
    )
  }
  const chapter = novel.chapters[0]
  if (!chapter || !chapter.content) {
    return (
      <p className="text-sm text-muted">
        {novel.status === 'CONCEPT'
          ? '立项中,信息收集完成后开始写作。'
          : '本章还没有内容。'}
      </p>
    )
  }
  return (
    <article className="prose prose-invert max-w-none text-sm">
      <MarkdownRenderer>{chapter.content}</MarkdownRenderer>
    </article>
  )
}

const InfoView = ({ novel }: { novel: Novel }) => {
  const settings = novel.settings as { style?: string } | null
  const rows = [
    { label: '书名', value: novel.title },
    { label: '类型', value: novel.genre || '—' },
    { label: '简介', value: novel.synopsis || '—' },
    { label: '文风', value: settings?.style || '—' }
  ]
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="text-xs uppercase text-muted">{r.label}</div>
          <div className="text-sm text-primary">{r.value}</div>
        </div>
      ))}
      <div className="pt-2 text-xs text-muted/50">
        信息卡 · 由 Agent 通过 update_novel 自动填充
      </div>
    </div>
  )
}

export default ResourcePanel
