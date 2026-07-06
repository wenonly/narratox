import { LoaderCircle } from 'lucide-react'

const SKELETON_BAR_WIDTHS = ['90%', '76%', '82%', '60%', '70%']

export const ChapterSkeleton = ({ order }: { order: number }) => (
  <div className="flex flex-col gap-2 rounded-md bg-overlay-5 p-3">
    <div className="flex items-center gap-2">
      <LoaderCircle className="size-3.5 animate-spin text-accent-violetLight" />
      <span className="text-xs text-accent-violetLight">
        第 {order} 章 · 正文生成中…
      </span>
    </div>
    {SKELETON_BAR_WIDTHS.map((w, i) => (
      <div
        key={i}
        className="h-1.5 rounded-full bg-overlay-10"
        style={{ width: w }}
      />
    ))}
  </div>
)
