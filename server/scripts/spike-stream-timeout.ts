// 诊断 spike #5:固定「重写」任务,变化章节上下文大小,测「首个正文字符」出现时间。
// 目的:判断 60s 卡是「上下文太大」(→ 按需拉取工具方案有效)还是「任务复杂度」(→ 无效)。
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

async function trial(label: string, prompt: string) {
  const start = Date.now()
  const counts: Record<Kind, number> = { content: 0, reasoning: 0, tool_call: 0, empty: 0 }
  let firstContentAt: number | null = null
  let firstToolCallAt: number | null = null
  try {
    const stream = await bound.stream(prompt)
    for await (const chunk of stream) {
      const k = classify(chunk)
      counts[k]++
      const now = Date.now() - start
      if (k === 'content' && firstContentAt === null) firstContentAt = now
      if (k === 'tool_call' && firstToolCallAt === null) firstToolCallAt = now
    }
    const s = ((Date.now() - start) / 1000).toFixed(1)
    const fc = firstContentAt === null ? '—' : `${(firstContentAt / 1000).toFixed(1)}s`
    const ft = firstToolCallAt === null ? '—' : `${(firstToolCallAt / 1000).toFixed(1)}s`
    console.log(`[${label}] DONE ${s}s | counts=${JSON.stringify(counts)} firstContent=${fc} firstToolCall=${ft}`)
  } catch (err) {
    const s = ((Date.now() - start) / 1000).toFixed(1)
    const fc = firstContentAt === null ? '—(无正文)' : `${(firstContentAt / 1000).toFixed(1)}s`
    console.log(`[${label}] ❌THREW ${s}s | counts=${JSON.stringify(counts)} firstContent=${fc} | ${(err as Error)?.message}`)
  }
}

const SENTENCE = '陈平安站在落魄山的山巅,夜风猎猎。'
async function run() {
  // A:大上下文(整章 ~3000 字)重写 —— 预期卡 60s(已知)
  await trial('A 大上下文(3000字)', `你是一位资深小说写作手。重写下面正文,提升文笔,写完调用 write_chapter。一次输出约4000字。\n\n【正文】\n${SENTENCE.repeat(150)}\n\n【开始重写】`)
  // B:中等上下文(~600 字)
  await trial('B 中上下文(600字)', `你是一位资深小说写作手。重写下面正文,提升文笔,写完调用 write_chapter。一次输出约4000字。\n\n【正文】\n${SENTENCE.repeat(30)}\n\n【开始重写】`)
  // C:小上下文(~150 字)
  await trial('C 小上下文(150字)', `你是一位资深小说写作手。重写下面正文,提升文笔,写完调用 write_chapter。一次输出约4000字。\n\n【正文】\n${SENTENCE.repeat(8)}\n\n【开始重写】`)
}

run().catch((e) => {
  console.error('crashed:', e)
  process.exit(1)
})
