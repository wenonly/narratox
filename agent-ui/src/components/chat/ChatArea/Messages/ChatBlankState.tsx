'use client'

const ChatBlankState = () => {
  return (
    <section
      className="flex flex-col items-center text-center"
      aria-label="Welcome message"
    >
      <div className="flex flex-col gap-y-3">
        <p className="text-lg font-semibold text-text-primary">✍️ narratox</p>
        <p className="text-sm text-text-tertiary">和我聊聊你的故事吧</p>
        <p className="max-w-md text-sm leading-relaxed text-text-tertiary">
          比如:「我想写一本都市修仙,主角是个外卖员,意外获得……」
        </p>
        <p className="max-w-md text-xs leading-relaxed text-text-tertiary">
          书名、类型、故事核心、世界观、文风都可以,想到什么说什么 →
        </p>
      </div>
    </section>
  )
}

export default ChatBlankState
