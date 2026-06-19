// Spike: deepagents JS + z.ai GLM-5.2 兼容性验证
// 验证:① createDeepAgent 接受 ChatOpenAI 实例;② GLM 能跑通;③ 流式格式(message-stream)
import 'dotenv/config'
import { createDeepAgent } from 'deepagents'

async function main() {
  const { ChatOpenAI } = await import('@langchain/openai')
  const apiKey = process.env.ZHIPUAI_API_KEY
  if (!apiKey) throw new Error('ZHIPUAI_API_KEY missing')
  const model = new ChatOpenAI({
    apiKey, model: 'GLM-5.2', temperature: 0.5,
    configuration: { baseURL: 'https://api.z.ai/api/coding/paas/v4' },
    timeout: 120_000, maxRetries: 0, maxTokens: 200,
  })

  // 1. createDeepAgent 接受 ChatOpenAI 实例?
  console.log('1. creating deep agent with ChatOpenAI instance...')
  const agent = await createDeepAgent({
    model: model as never,
    systemPrompt: '你是一位小说写作助手。简短回复。',
    tools: [],
    subagents: [],
  })
  console.log('   ✅ createDeepAgent accepted ChatOpenAI instance')

  // 2. invoke works with GLM?
  console.log('2. invoking agent (GLM-5.2)...')
  const result = await agent.invoke(
    { messages: [{ role: 'user', content: '你好,一句话介绍你自己。' }] },
    { configurable: { thread_id: `spike-${Date.now()}` } },
  )
  const msgs = (result as { messages: Array<{ content?: unknown }> }).messages
  const last = msgs[msgs.length - 1]
  console.log('   ✅ invoke OK, reply:', String(last?.content ?? '').slice(0, 120))

  // 3. streaming format (message-stream → createActivityEmitter compatible?)
  console.log('3. streaming test...')
  const stream = await agent.stream(
    { messages: [{ role: 'user', content: '说一个字' }] },
    { configurable: { thread_id: `spike-stream-${Date.now()}` }, streamMode: 'messages' },
  )
  let chunkCount = 0
  let hasReasoning = false
  let hasContent = false
  let hasToolCall = false
  for await (const chunk of stream) {
    const msg = (Array.isArray(chunk) ? chunk[0] : chunk) as {
      _getType?: () => string
      content?: unknown
      additional_kwargs?: { reasoning_content?: unknown }
      tool_calls?: unknown[]
    }
    if (msg?.additional_kwargs?.reasoning_content) hasReasoning = true
    if (typeof msg?.content === 'string' && msg.content) hasContent = true
    if (Array.isArray(msg?.tool_calls) && msg.tool_calls.length) hasToolCall = true
    chunkCount++
  }
  console.log(`   ✅ stream: ${chunkCount} chunks, reasoning=${hasReasoning}, content=${hasContent}, toolCalls=${hasToolCall}`)
  console.log('\n=== SPIKE PASSED: deepagents + GLM-5.2 compatible ===')
}

main().catch(e => {
  console.error('SPIKE FAILED:', e instanceof Error ? e.message : String(e))
  process.exit(1)
})
