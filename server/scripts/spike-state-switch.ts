// 一次性验证脚本:主 Agent 按状态选 update_novel(CONCEPT) vs transfer_to_writer(ready)。
// 运行: cd server && pnpm exec ts-node scripts/spike-state-switch.ts
import 'dotenv/config' // 加载 .env (ZHIPUAI_API_KEY)
import { ChatOpenAI } from '@langchain/openai'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
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

// stub update_novel(只测路由决策,不真写)
const updateNovel = tool(
  async () => ({ ok: true, message: '已更新小说信息。' }),
  {
    name: 'update_novel',
    description: '更新小说的基础信息(书名/类型/世界观/文风)。立项收集信息时调用。',
    schema: z.object({
      title: z.string().optional(),
      genre: z.string().optional(),
    }),
  },
)

const CONCEPT_PROMPT = `你是小说工作台的主 Agent。这本小说刚创建(信息不全)。
当前状态:书名="未命名",类型=未知,世界观=未知。
你的任务:通过问答收集书名/类型/世界观,每轮调 update_novel 更新。信息够前不要转交写作。`

const READY_PROMPT = `你是小说工作台的主 Agent。这本小说信息已齐全。
当前状态:书名《青云志》,类型=修仙,世界观=九州灵气。
作者要写正文时,用 transfer_to_writer 转交写作 Agent。`

async function run(label: string, prompt: string, userMsg: string, expectTool: string) {
  const main = createReactAgent({
    llm: MODEL,
    name: 'main',
    prompt,
    tools: [
      updateNovel,
      createHandoffTool({ agentName: 'writer', description: '转交写作 Agent 写正文' }),
    ],
  })
  const writer = createReactAgent({
    llm: MODEL,
    name: 'writer',
    prompt: '写作 Agent。收到后写一小段正文。',
    tools: [createHandoffTool({ agentName: 'main' })],
  })
  const app = createSwarm({ agents: [main, writer], defaultActiveAgent: 'main' }).compile()
  const stream = await app.stream(
    { messages: [{ role: 'user', content: userMsg }] },
    { configurable: { thread_id: `spike-${label}-${Date.now()}` }, streamMode: 'messages' },
  )
  let called = ''
  for await (const chunk of stream) {
    const msg = Array.isArray(chunk) ? chunk[0] : chunk
    const tc = (msg as { tool_calls?: Array<{ name: string }> }).tool_calls
    if (tc) {
      for (const t of tc) {
        if (t.name === expectTool || t.name === 'transfer_to_writer') called = t.name
      }
    }
  }
  const pass = called === expectTool
  console.log(`[${label}] expect=${expectTool} called=${called} → ${pass ? 'PASS' : 'FAIL'}`)
  return pass
}

async function main() {
  const a = await run(
    'CONCEPT',
    CONCEPT_PROMPT,
    '我想写一本叫青云志的修仙小说，世界观是九州灵气复苏。',
    'update_novel',
  )
  const b = await run('READY', READY_PROMPT, '开始写第一章。', 'transfer_to_writer')
  console.log(a && b ? '--- SPIKE PASS ---' : '--- SPIKE FAIL ---')
  if (!(a && b)) process.exit(1)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
