// 一次性验证脚本:GLM 在 swarm 里是否可靠发出 transfer_to_writer。
// 运行: cd server && pnpm exec ts-node scripts/spike-handoff.ts
import 'dotenv/config' // 加载 .env (ZHIPUAI_API_KEY)
import { ChatOpenAI } from '@langchain/openai'
import { createReactAgent } from '@langchain/langgraph/prebuilt'
import { createSwarm, createHandoffTool } from '@langchain/langgraph-swarm'

const MODEL = process.env.ZHIPUAI_API_KEY
  ? new ChatOpenAI({
      apiKey: process.env.ZHIPUAI_API_KEY,
      model: 'GLM-5.2',
      configuration: { baseURL: 'https://api.z.ai/api/coding/paas/v4' },
    })
  : (() => {
      throw new Error('ZHIPUAI_API_KEY missing in .env')
    })()

async function main() {
  const main = createReactAgent({
    llm: MODEL,
    name: 'main',
    prompt:
      '你是小说工作台的主 Agent。用户要写正文/写章节时,用 transfer_to_writer 转交给写作 Agent。其它问题自己回答。',
    tools: [
      createHandoffTool({
        agentName: 'writer',
        description: '转交给写作 Agent 来写/续写章节正文',
      }),
    ],
  })
  const writer = createReactAgent({
    llm: MODEL,
    name: 'writer',
    prompt: '你是写作 Agent。收到控制权后,直接写一小段小说正文给用户。',
    tools: [createHandoffTool({ agentName: 'main' })],
  })
  const app = createSwarm({ agents: [main, writer], defaultActiveAgent: 'main' }).compile()

  const stream = await app.stream(
    { messages: [{ role: 'user', content: '帮我写第一章的开头' }] },
    { configurable: { thread_id: 'spike-1' }, streamMode: 'messages' },
  )
  let sawTransfer = false
  for await (const chunk of stream) {
    const msg = Array.isArray(chunk) ? chunk[0] : chunk
    const tcalls = (msg as { tool_calls?: Array<{ name: string }> }).tool_calls
    if (tcalls?.some((t) => t.name === 'transfer_to_writer')) sawTransfer = true
    const txt = (msg as { text?: string; content?: unknown }).text
    if (typeof txt === 'string' && txt) process.stdout.write(txt)
  }
  console.log('\n--- SPIKE RESULT ---')
  console.log(
    sawTransfer ? 'PASS: GLM emitted transfer_to_writer' : 'FAIL: no transfer_to_writer observed',
  )
  if (!sawTransfer) process.exit(1)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
