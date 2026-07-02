'use client'

import { useStore } from '@/store'
import type { Novel } from '@/types/novel'
import { ReferencesView } from './ReferencesView'
import VoiceProfileView from './VoiceProfileView'
import ChaptersView from './views/ChaptersView'
import WorldviewView from './views/WorldviewView'
import OutlineView from './views/OutlineView'
import CharactersView from './views/CharactersView'
import HooksView from './views/HooksView'
import EventsView from './views/EventsView'
import OverviewView from './views/OverviewView'
import InfoView from './views/InfoView'
import type { ResourceKey } from './types'

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
  references: '参考资料',
  status: '状态',
  info: '小说信息',
  voiceProfile: '作者画像',
  events: '事件时间线',
  overview: '态势'
}

const ResourcePanel = ({ resource, novel, onClose, onSaved }: Props) => {
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
        {resource === 'outline' && <OutlineView novel={novel} />}
        {resource === 'worldview' && <WorldviewView novel={novel} />}
        {resource === 'references' && <ReferencesView novel={novel} />}
        {resource === 'status' && <HooksView novel={novel} />}
        {resource === 'events' && <EventsView novel={novel} />}
        {resource === 'overview' && <OverviewView novel={novel} />}
        {resource === 'characters' && <CharactersView novel={novel} />}
        {resource === 'info' && <InfoView novel={novel} />}
        {resource === 'voiceProfile' && (
          <VoiceProfileView novel={novel} onSaved={onSaved} />
        )}
      </div>
    </section>
  )
}

export default ResourcePanel
