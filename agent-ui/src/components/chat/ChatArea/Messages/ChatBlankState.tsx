'use client'

const ChatBlankState = () => {
  return (
    <section
      className="flex flex-col items-center text-center"
      aria-label="Welcome message"
    >
      <div className="flex flex-col gap-y-2">
        <p className="text-lg font-semibold text-primary">✍️ narratox</p>
        <p className="text-sm text-muted">
          AI 小说工作台 · 与 AI 协作创作你的小说
        </p>
      </div>
    </section>
  )
}

export default ChatBlankState
