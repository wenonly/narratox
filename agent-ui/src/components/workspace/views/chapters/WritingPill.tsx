import { PencilLine } from 'lucide-react'

export interface WritingPillProps {
  order: number
  onJump: () => void
}

export const WritingPill = ({ order, onJump }: WritingPillProps) => (
  <button
    type="button"
    onClick={onJump}
    className="flex w-full items-center justify-between rounded-md border border-[#6366f140] bg-[#6366f110] px-3 py-2 text-sm hover:bg-[#6366f11a]"
  >
    <span className="flex items-center gap-1.5 font-semibold text-accent-indigoLight">
      <PencilLine className="size-3.5 text-accent-indigoLight" />✍ AI 正写第{' '}
      {order} 章
    </span>
    <span className="text-xs text-accent-indigoLight">跳转 ›</span>
  </button>
)
