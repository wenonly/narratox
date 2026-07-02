import type { Novel } from '@/types/novel'

export interface InfoViewProps {
  novel: Novel
}

const InfoView = ({ novel }: InfoViewProps) => {
  const settings = novel.settings as {
    style?: string
    coreConflict?: string
    chapterWordTarget?: number
  } | null
  const rows = [
    { label: '书名', value: novel.title },
    { label: '类型', value: novel.genre || '—' },
    { label: '简介', value: novel.synopsis || '—' },
    { label: '核心冲突', value: settings?.coreConflict || '—' },
    {
      label: '每章字数目标',
      value: settings?.chapterWordTarget
        ? `${settings.chapterWordTarget} 字`
        : '—'
    },
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

export default InfoView
