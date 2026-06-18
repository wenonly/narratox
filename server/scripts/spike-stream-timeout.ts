// 诊断 spike #4:测 z.ai coding 端点认不认 thinking:disabled。同样的「工具+大上下文重写」,
// 开 thinking 禁用,看 reasoning 是否消失、正文是否 <60s 出来、是否还断。
// 运行: cd server && pnpm exec ts-node scripts/spike-stream-timeout.ts
import 'dotenv/config'
import { ChatOpenAI } from '@langchain/openai'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'

const apiKey = process.env.ZHIPUAI_API_KEY
if (!apiKey) throw new Error('ZHIPUAI_API_KEY missing in .env')

const model = new ChatOpenAI({
  apiKey,
  model: 'GLM-5.2',
  configuration: { baseURL: 'https://api.z.ai/api/coding/paas/v4' },
})

const writeChapter = tool(
  async () => ({ ok: true }),
  { name: 'write_chapter', description: '把正文写入章节', schema: z.object({ content: z.string() }) },
)

const CH1 = '陈平安站在落魄山的山巅,夜风猎猎。'.repeat(120)
const PROMPT =
  `你是一位资深小说写作手。下面是第1章已有正文,请「重写」整章,提升文笔,写完后调用 write_chapter 落稿。一次输出完整整章(约4000字)。\n\n【第1章已有正文】\n${CH1}\n\n【开始重写】`

type Kind = 'content' | 'reasoning' | 'tool_call' | 'empty'
function classify(chunk: unknown): Kind {
  const c = chunk as { content?: unknown; tool_call_chunks?: unknown[]; additional_kwargs?: { reasoning_content?: string; reasoning?: string } }
  if (typeof c.content === 'string' && c.content.length > 0) return 'content'
  const rc = c.additional_kwargs?.reasoning_content ?? c.additional_kwargs?.reasoning
  if (typeof rc === 'string' && rc.length > 0) return 'reasoning'
  if (Array.isArray(c.tool_call_chunks) && c.tool_call_chunks.length > 0) return 'tool_call'
  return 'empty'
}

async function trial(label: string, opts: Record<string, unknown>) {
  const start = Date.now()
  const counts: Record<Kind, number> = { content: 0, reasoning: 0, tool_call: 0, empty: 0 }
  let firstContentAt: number | null = null
  try {
    const stream = await model.bindTools([writeChapter]).stream(PROMPT, opts as never)
    for await (const chunk of stream) {
      const k = classify(chunk)
      counts[k]++
      if (k === 'content' && firstContentAt === null) firstContentAt = Date.now() - start
    }
    const s = ((Date.now() - start) / 1000).toFixed(1)
    const fc = firstContentAt === null ? '—' : `${(firstContentAt / 1000).toFixed(1)}s`
    console.log(`[${label}] DONE ${s}s | counts=${JSON.stringify(counts)} firstContent=${fc}`)
    console.log(`[${label}] counts.reasoning=${counts.reasoning} → thinking ${counts.reasoning === 0 ? '✅ 已禁用' : '❌ 仍在思考'}`)
  } catch (err) {
    const s = ((Date.now() - start) / 1000).toFixed(1)
    console.log(`[${label}] THREW ${s}s | counts=${JSON.stringify(counts)} firstContent=${firstContentAt ?? '—'} | ${(err as Error)?.message}`)
  }
}

async function run() {
  // extra_body.thinking 跑 3 次,看是稳定生效还是运气
  for (let i = 1; i <= 3; i++) {
    await trial(`B#${i} extra_body.thinking`, { extra_body: { thinking: { type: 'disabled' } } })
  }
}

run().catch((e) => {
  console.error('crashed:', e)
  process.exit(1)
})
