'use client'

import { Feather } from 'lucide-react'

import { useStore } from '@/store'

const SUGGESTIONS = [
  '帮我构思一个都市修仙开局',
  '我想写一本科幻短篇',
  '分析一本爆款的结构'
]

const ChatBlankState = () => {
  const setChatInput = useStore((s) => s.setChatInput)

  return (
    <section
      className="flex flex-col items-center gap-5 py-10"
      aria-label="Welcome message"
    >
      {/* Mark — gradient feather tile with indigo glow. */}
      <div className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-primary to-accent-violet shadow-[0_8px_24px_#6366f140]">
        <Feather className="size-7 text-text-primary" />
      </div>
      {/* Text block — heading + subtext. */}
      <div className="flex w-full flex-col items-center gap-2">
        <h2 className="text-xl font-semibold text-text-primary">
          和我聊聊你的故事吧
        </h2>
        <p className="max-w-md text-center text-sm leading-relaxed text-text-tertiary">
          书名、类型、故事核心、世界观、文风 — 想到什么说什么
        </p>
      </div>
      {/* Suggestion chips — click fills the input capsule. */}
      <div className="flex flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((text) => (
          <button
            key={text}
            type="button"
            onClick={() => setChatInput(text)}
            className="cursor-pointer rounded-full border border-overlay-15 bg-overlay-5 px-3 py-1.5 text-xs text-text-secondary hover:bg-overlay-10"
          >
            {text}
          </button>
        ))}
      </div>
    </section>
  )
}

export default ChatBlankState
