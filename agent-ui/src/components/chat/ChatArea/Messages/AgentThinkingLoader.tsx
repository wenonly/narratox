const AgentThinkingLoader = () => (
  <div className="flex items-center gap-1.5">
    <div className="size-2 animate-bounce rounded-full bg-text-label [animation-delay:-0.3s] [animation-duration:0.70s]" />
    <div className="size-2 animate-bounce rounded-full bg-text-label [animation-delay:-0.10s] [animation-duration:0.70s]" />
    <div className="size-2 animate-bounce rounded-full bg-text-label [animation-duration:0.70s]" />
    <span className="ml-1 text-xs text-text-tertiary">等待响应…</span>
  </div>
)

export default AgentThinkingLoader
