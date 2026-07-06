'use client'

import { useEffect, useState } from 'react'

import { useStore } from '@/store'
import { getOutline } from '@/api/novels'
import type { Novel, OutlineData } from '@/types/novel'

import { ChapterListPage } from './chapters/ChapterListPage'
import { ChapterReadingPage } from './chapters/ChapterReadingPage'

export interface ChaptersViewProps {
  novel: Novel
  writingChapterOrder: number | null
}

const ChaptersView = ({ novel, writingChapterOrder }: ChaptersViewProps) => {
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const currentChapterOrder = useStore((s) => s.currentChapterOrder)
  const setCurrentChapterOrder = useStore((s) => s.setCurrentChapterOrder)
  const setManualLock = useStore((s) => s.setManualLock)
  const outlineWriteSeq = useStore((s) => s.outlineWriteSeq)

  const [tocOpen, setTocOpen] = useState(false)
  const [outlineData, setOutlineData] = useState<OutlineData | null>(null)

  // fetch OutlineData(参照 OutlineView 模式):mount + outlineWriteSeq 变化时刷新。
  useEffect(() => {
    let cancelled = false
    getOutline(endpoint, token, novel.id)
      .then((d) => {
        if (!cancelled) setOutlineData(d)
      })
      .catch(() => {
        if (!cancelled) setOutlineData(null)
      })
    return () => {
      cancelled = true
    }
  }, [endpoint, token, novel.id, outlineWriteSeq])

  const sorted = [...novel.chapters].sort((a, b) => a.order - b.order)
  const idx = sorted.findIndex((c) => c.order === currentChapterOrder)
  const chapter = idx >= 0 ? sorted[idx] : undefined
  const prevOrder = idx > 0 ? sorted[idx - 1].order : null
  const nextOrder =
    idx >= 0 && idx < sorted.length - 1 ? sorted[idx + 1].order : null

  const pickOrder = (order: number) => {
    setCurrentChapterOrder(order)
    setManualLock(true)
    setTocOpen(false)
  }

  // CONCEPT / 无章:占位。
  if (currentChapterOrder == null || !chapter) {
    return (
      <p className="text-sm text-text-tertiary">
        {novel.status === 'CONCEPT'
          ? '立项中,信息收集完成后开始写作。'
          : '本章还没有内容。'}
      </p>
    )
  }

  // 三态路由:列表态 > 写作中态 > 正文态(tocOpen 优先,不被写作打断)。
  if (tocOpen) {
    return (
      <ChapterListPage
        chapters={sorted}
        volumes={outlineData?.volumes ?? []}
        arcs={outlineData?.arcs ?? []}
        outlines={outlineData?.chapterOutlines ?? []}
        currentOrder={chapter.order}
        writingOrder={writingChapterOrder}
        onPick={pickOrder}
        onClose={() => setTocOpen(false)}
      />
    )
  }

  return (
    <ChapterReadingPage
      novel={novel}
      chapter={chapter}
      prevOrder={prevOrder}
      nextOrder={nextOrder}
      outlineData={outlineData}
      writingChapterOrder={writingChapterOrder}
      onOpenToc={() => setTocOpen(true)}
      onJumpToOrder={pickOrder}
    />
  )
}

export default ChaptersView
