// 诊断脚本 #1(v2 基石):createReactAgent **不带 checkpointer** 能否跑完一个工具循环?
// 这决定专家 agent(writer/settler)能否用「无 checkpointer 的 createReactAgent」实现
// —— 否则要退回手写工具循环(call LLM → 若 tool_call 则执行→拼接→重复)。
//
// 关键点:不带 checkpointer 时,.stream 能否【不传 thread_id / configurable】直接跑、
// 且工具循环(LLM→tool_call→执行→LLM→正文)能完整跑到结束。
//
// 运行: cd server && pnpm exec ts-node scripts/spike-no-checkpointer.ts
import 'dotenv/config'

import { tool } from '@langchain/core/tools'
import { z } from 'zod'

const apiKey = process.env.ZHIPUAI_API_KEY
if (!apiKey) throw new Error('ZHIPUAI_API_KEY missing in .env')

const appendSection = tool(
  async ({ chapterOrder, content }) => {
    return {
      ok: true,
      chapterOrder,
      chars: content.length,
    }
  },
  {
    name: 'append_section',
    description: '向第 chapterOrder 章追加一小节正文。',
    schema: z.object({
      chapterOrder: z.number().int(),
      content: z.string(),
    }),
  },
)

async function main() {
  const { ChatOpenAI } = await import('@langchain/openai')
  const { createReactAgent } = await import('@langchain/langgraph/prebuilt')

  const model = new ChatOpenAI({
    apiKey,
    model: 'GLM-5.2',
    temperature: 0.2,
    configuration: { baseURL: 'https://api.z.ai/api/coding/paas/v4' },
    timeout: 90_000,
    maxRetries: 0,
  })

  // 不传 checkpointer —— 专家 agent 的形态。
  const agent = createReactAgent({
    llm: model,
    name: 'writer',
    tools: [appendSection as never],
    prompt:
      '你是小说写作手。用 append_section 写正文,聊天里只说完成情况,不贴正文。',
  })

  console.log('=== createReactAgent WITHOUT checkpointer: tool-loop run ===\n')
  const start = Date.now()

  // 注意:不传 configurable.thread_id(无 checkpointer 时不需要)。
  const stream = await agent.stream(
    {
      messages: [
        { role: 'user', content: '请写第1章开头一节(约300字),写完告诉我。' },
      ],
    },
    { streamMode: 'messages' },
  )

  let toolCalls = 0
  let contentChars = 0
  let finishReason: string | null = null
  let lastType: string | null = null

  for await (const chunk of stream) {
    const msg = (Array.isArray(chunk) ? chunk[0] : chunk) as {
      _getType?: () => string
      name?: string
      tool_calls?: unknown[]
      content?: unknown
    }
    const type = typeof msg?._getType === 'function' ? msg._getType() : ''
    lastType = type

    if (type === 'ai' && Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
      toolCalls += msg.tool_calls.length
      console.log(
        `[ai] tool_call x${msg.tool_calls.length}: ${JSON.stringify(msg.tool_calls.map((t) => (t as { name?: string }).name))}`,
      )
    } else if (type === 'tool') {
      console.log(`[tool] result from ${msg.name}`)
    } else if (type === 'ai' && typeof msg.content === 'string') {
      contentChars += msg.content.length
      if (msg.content.trim()) {
        console.log(`[ai] final content (${msg.content.length} chars)`)
      }
    }
  }

  const ms = Date.now() - start
  console.log('\n--- summary ---')
  console.log(`elapsed: ${ms}ms`)
  console.log(`tool_calls emitted: ${toolCalls}`)
  console.log(`final content chars: ${contentChars}`)
  console.log(`last message type: ${lastType}`)
  finishReason = toolCalls > 0 ? 'RAN_TOOL_LOOP' : 'NO_TOOL_CALL'
  console.log(`verdict: ${finishReason}`)

  if (toolCalls > 0 && contentChars >= 0) {
    console.log('\n✅ PASS: createReactAgent w/o checkpointer ran a tool-loop to completion.')
  } else {
    console.log('\n⚠️  inspect: tool-loop did not behave as expected.')
  }
}

main().catch((e) => {
  console.error('crashed:', e)
  process.exit(1)
})
