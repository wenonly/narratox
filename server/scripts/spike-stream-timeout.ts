// 诊断 spike #7:最关键的可用性测试。写第2章时,第1章正文在上下文里(做前情)。
// 测首字时间——快=app 可用(只是整章重写坏);慢=多章写作根本走不通。
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
const bound = model.bindTools([writeChapter])

type Kind = 'content' | 'reasoning' | 'tool_call' | 'empty'
function classify(chunk: unknown): Kind {
  const c = chunk as { content?: unknown; tool_call_chunks?: unknown[]; additional_kwargs?: { reasoning_content?: string; reasoning?: string } }
  if (typeof c.content === 'string' && c.content.length > 0) return 'content'
  const rc = c.additional_kwargs?.reasoning_content ?? c.additional_kwargs?.reasoning
  if (typeof rc === 'string' && rc.length > 0) return 'reasoning'
  if (Array.isArray(c.tool_call_chunks) && c.tool_call_chunks.length > 0) return 'tool_call'
  return 'empty'
}
async function trial(label: string, m: { stream: (p: string) => Promise<AsyncIterable<unknown>> }, prompt: string) {
  const start = Date.now()
  const counts: Record<Kind, number> = { content: 0, reasoning: 0, tool_call: 0, empty: 0 }
  let firstContentAt: number | null = null
  try {
    const stream = await m.stream(prompt)
    for await (const chunk of stream) {
      const k = classify(chunk)
      counts[k]++
      if (k === 'content' && firstContentAt === null) firstContentAt = Date.now() - start
    }
    const s = ((Date.now() - start) / 1000).toFixed(1)
    const fc = firstContentAt === null ? '—' : `${(firstContentAt / 1000).toFixed(1)}s`
    console.log(`[${label}] ✅DONE ${s}s | counts=${JSON.stringify(counts)} firstContent=${fc}`)
  } catch (err) {
    const s = ((Date.now() - start) / 1000).toFixed(1)
    const fc = firstContentAt === null ? '—(无正文)' : `${(firstContentAt / 1000).toFixed(1)}s`
    console.log(`[${label}] ❌THREW ${s}s | counts=${JSON.stringify(counts)} firstContent=${fc} | ${(err as Error)?.message}`)
  }
}

const CH1 = '陈平安站在落魄山的山巅,夜风猎猎。他低头看着手中那柄锈迹斑斑的铁剑,忽然剑身一震,一道幽蓝光芒从剑中逸出,化作一个身着青衫的虚影。"你……是谁？"陈平安退后一步。"我是剑灵,名唤青冥。"虚影微微一笑,"你在山门试炼中浴血三日,以纯善之心唤醒了我。"陈平安沉默片刻,缓缓拔剑。剑出鞘的刹那,天地间仿佛有一声极轻的叹息。'.repeat(30) // ~1500 字第1章
async function run() {
  const p = `你是资深小说写作手。请写第2章正文(仙侠题材,陈平安觉醒剑灵后的故事)。一次约2000字。\n\n【开始】`
  // A:带 write_chapter 工具
  await trial('A 写第2章·带工具', bound, p)
  // B:不带任何工具(纯生成)
  await trial('B 写第2章·不带工具', model, p)
}

run().catch((e) => {
  console.error('crashed:', e)
  process.exit(1)
})
