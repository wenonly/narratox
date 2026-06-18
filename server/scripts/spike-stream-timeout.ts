// 诊断 spike #2:用「工具 + 大上下文」复现 swarm-path 的请求形态,看是不是 z.ai 因请求
// 复杂度(工具/大上下文/推理)而关闭连接 —— 隔离「请求形态」vs「langgraph」。
// 运行: cd server && pnpm exec ts-node scripts/spike-stream-timeout.ts
import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'

const apiKey = process.env.ZHIPUAI_API_KEY
if (!apiKey) throw new Error('ZHIPUAI_API_KEY missing in .env')

// 与 Writer 一致(无 timeout/maxRetries 覆盖)
const model = new ChatOpenAI({
  apiKey,
  model: 'GLM-5.2',
  configuration: { baseURL: 'https://api.z.ai/api/coding/paas/v4' },
})

// 绑定一个工具(模拟 Writer 的 write_chapter / query_memory),触发 function-calling 路径
const writeChapter = tool(
  async ({ content }) => ({ ok: true, message: `已写入 ${content.length} 字` }),
  {
    name: 'write_chapter',
    description: '把正文写入章节',
    schema: z.object({ content: z.string() }),
  },
)
const bound = model.bindTools([writeChapter])

// 大上下文:模拟 rewrite 时历史里的第 1 章全文(约 2000 字)+ 重写指令
const CH1 = '陈平安站在落魄山的山巅,夜风猎猎。'.repeat(120) // ~3000 字
const PROMPT =
  `你是一位资深小说写作手。下面是第1章已有正文,请「重写」整章,保持情节但提升文笔,` +
  `写完后调用 write_chapter 落稿。一次输出完整的整章正文(约4000字)。\n\n` +
  `【第1章已有正文】\n${CH1}\n\n【开始重写】`

async function run() {
  const start = Date.now()
  let chunks = 0
  let chars = 0
  let firstTokenAt: number | null = null
  process.stdout.write('[spike2] tools + large context, streaming rewrite ... \n')
  try {
    const stream = await bound.stream(PROMPT)
    for await (const chunk of stream) {
      const now = Date.now()
      if (firstTokenAt === null) firstTokenAt = now
      chunks++
      const c = chunk as { content?: unknown }
      const text: string = typeof c.content === 'string' ? c.content : ''
      chars += text.length
      if (chunks % 200 === 0) {
        process.stdout.write(`[spike2] +${((now - start) / 1000).toFixed(0)}s chunks=${chunks} chars=${chars}\n`)
      }
    }
    const elapsed = Date.now() - start
    console.log(`\n[spike2] DONE in ${(elapsed / 1000).toFixed(1)}s | chunks=${chunks} chars=${chars}`)
    console.log(`[verdict] 工具+大上下文 也跑完 → 不是请求形态的问题,是 langgraph/swarm 路径。`)
  } catch (err) {
    const elapsed = Date.now() - start
    console.log(`\n[spike2] THREW after ${(elapsed / 1000).toFixed(1)}s | chunks=${chunks} chars=${chars}`)
    console.log('[spike2] error:', (err as Error)?.name, '-', (err as Error)?.message)
    console.log('[spike2] cause:', (err as { cause?: { message?: string } })?.cause?.message)
    if (elapsed < 70000) {
      console.log(`[verdict] ~${(elapsed / 1000).toFixed(0)}s 被 z.ai 关闭 → 是「工具+大上下文」请求形态触发 z.ai 关连接(非 langgraph)。`)
    }
  }
}

run().catch((e) => {
  console.error('spike crashed:', e)
  process.exit(1)
})
