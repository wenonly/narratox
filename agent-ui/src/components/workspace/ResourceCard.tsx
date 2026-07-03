'use client'

import { useStore } from '@/store'
import type { Novel } from '@/types/novel'
import { ReferencesView } from './ReferencesView'
import ChaptersView from './views/ChaptersView'
import WorldviewView from './views/WorldviewView'
import OutlineView from './views/OutlineView'
import CharactersView from './views/CharactersView'
import HooksView from './views/HooksView'
import NavTabs from './NavTabs'
import type { ResourceKey } from './types'

interface Props {
  activeResource: ResourceKey
  onSelect: (key: ResourceKey) => void
  novel: Novel
  onSaved: () => void
}

/**
 * ResourceCard — right twin card (always rendered, w-[440px]).
 * W1: ResHead = 6 NavTabs centered; body = active view via temporary mapping
 * (plotline → HooksView for now; W2 swaps in PlotlineView with sub-tabs).
 */
const ResourceCard = ({
  activeResource,
  onSelect,
  novel,
  onSaved
}: Props) => {
  const writingChapterOrder = useStore((s) => s.writingChapterOrder)

  return (
    <section className="flex w-[440px] shrink-0 flex-col overflow-hidden rounded-2xl border border-overlay-15 bg-bg-card shadow-[0_6px_24px_#00000066] [clip-path:inset(0_round(16px))]">
      <header className="flex h-14 shrink-0 items-center justify-center border-b border-overlay-10 px-2">
        <NavTabs active={activeResource} onSelect={onSelect} />
      </header>
      <div className="flex-1 overflow-y-auto px-4 pb-6">
        {activeResource === 'chapters' && (
          <ChaptersView
            novel={novel}
            writingChapterOrder={writingChapterOrder}
          />
        )}
        {activeResource === 'outline' && <OutlineView novel={novel} />}
        {activeResource === 'worldview' && <WorldviewView novel={novel} />}
        {activeResource === 'references' && <ReferencesView novel={novel} />}
        {activeResource === 'characters' && <CharactersView novel={novel} />}
        {/* W1 temporary: plotline → HooksView. W2 replaces with PlotlineView
            (sub-tabs merging Hooks + Events). */}
        {activeResource === 'plotline' && <HooksView novel={novel} />}
      </div>
    </section>
  )
}

export default ResourceCard
