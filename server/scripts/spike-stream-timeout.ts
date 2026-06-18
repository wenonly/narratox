// 诊断 spike #9:测「小参数工具调用」是否稳定 <60s。这是「分段编辑工具」方案能否成立的关键。
// 绑一个小参数工具 append_section(content ~300字),让模型调一次,测时间,跑 3 次。
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

// 小参数工具:只追加一小节(~300字)
const appendSection = tool(
  async ({ content }) => ({ ok: true, len: content.length }),
  {
    name: 'append_section',
    description: '向当前章节追加一小节正文(约300字)。一次只追加一小节。',
    schema: z.object({ content: z.string().describe('这一小节的正文,约300字') }),
  },
)
const bound = model.bindTools([appendSection])

type Kind = 'content' | 'reasoning' | 'tool_call' | 'empty'
function classify(chunk: unknown): Kind {
  const c = chunk as { content?: unknown; tool_call_chunks?: unknown[]; additional_kwargs?: { reasoning_content?: string; reasoning?: string } }
  if (typeof c.content === 'string' && c.content.length > 0) return 'content'
  const rc = c.additional_kwargs?.reasoning_content ?? c.additional_kwargs?.reasoning
  if (typeof rc === 'string' && rc.length > 0) return 'reasoning'
  if (Array.isArray(c.tool_call_chunks) && c.tool_call_chunks.length > 0) return 'tool_call'
  return 'empty'
}

const PROMPT =
  '你是小说写作手。请用 append_section 工具,追加第2章的第一小节(约300字,仙侠题材,陈平安觉醒剑灵青冥后的情节)。直接调用工具,不要在聊天里贴正文。'

async function once(i: number) {
  const start = Date.now()
  const counts: Record<Kind, number> = { content: 0, reasoning: 0, tool_call: 0, empty: 0 }
  let firstToolCallAt: number | null = null
  let argLen = 0
  try {
    const stream = await bound.stream(PROMPT)
    for await (const chunk of stream) {
      const k = classify(chunk)
      counts[k]++
      const now = Date.now() - start
      if (k === 'tool_call' && firstToolCallAt === null) firstToolCallAt = now
      // 估算工具参数累积长度(tool_call_chunks 里的 args 字符串)
      const tcc = (chunk as { tool_call_chunks?: Array<{ args?: string }> }).tool_call_chunks
      if (tcc) for (const c of tcc) if (typeof c.args === 'string') argLen += c.args.length
    }
    const s = ((Date.now() - start) / 1000).toFixed(1)
    const ft = firstToolCallAt === null ? '—' : `${(firstToolCallAt / 1000).toFixed(1)}s`
    console.log(`[run#${i}] ✅DONE ${s}s | counts=${JSON.stringify(counts)} firstToolCall=${ft} argLen≈${argLen}`)
  } catch (err) {
    const s = ((Date.now() - start) / 1000).toFixed(1)
    const ft = firstToolCallAt === null ? '—(无工具调用)' : `${(firstToolCallAt / 1000).toFixed(1)}s`
    console.log(`[run#${i}] ❌THREW ${s}s | counts=${JSON.stringify(counts)} firstToolCall=${ft} | ${(err as Error)?.message}`)
  }
}

async function run() {
  for (let i = 1; i <= 3; i++) await once(i)
  console.log('\n[verdict] 看 3 次 firstToolCall 是否都 <60s 且 DONE。都快 → 小参数工具方案成立。')
}

run().catch((e) => {
  console.error('crashed:', e)
  process.exit(1)
})
