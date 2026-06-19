// 诊断脚本:GLM-5.2(coding 端点 /api/coding/paas/v4)是否支持 thinking.budget_tokens
// 来限制思考(reasoning)token?验证点:① 参数被接受(不报错);② reasoning_content
// 在预算处停(budget 小→思考短,budget 大→思考长);③ 正文(content)仍能出。
//
// 直连 OpenAI 兼容端点(不走 langchain),最干净地测 API 对 thinking 字段的支持。
// 运行: cd server && pnpm exec ts-node scripts/spike-thinking-budget.ts
import 'dotenv/config'

const apiKey = process.env.ZHIPUAI_API_KEY
if (!apiKey) throw new Error('ZHIPUAI_API_KEY missing in .env')
const BASE = 'https://api.z.ai/api/coding/paas/v4'
const MODEL = 'GLM-5.2'

const PROMPT =
  '请认真思考后回答:如果一个主角被困在没有时间的房间里,他如何感知时间流逝?给出你的推理过程和结论。'

async function chat(label: string, extra: Record<string, unknown>): Promise<void> {
  const start = Date.now()
  process.stdout.write(`${label} ... `)
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'user', content: PROMPT }],
        stream: false,
        ...extra,
      }),
    })
    const ms = Date.now() - start
    if (!res.ok) {
      const text = await res.text()
      console.log(`FAIL (${ms}ms) HTTP ${res.status}: ${text.slice(0, 240)}`)
      return
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>
      usage?: {
        completion_tokens?: number
        completion_tokens_details?: { reasoning_tokens?: number }
        total_tokens?: number
      }
    }
    const msg = data?.choices?.[0]?.message ?? {}
    const reasoning = msg?.reasoning_content ?? ''
    const content = msg?.content ?? ''
    console.log(`OK (${ms}ms)`)
    console.log(
      `  reasoning_content: ${reasoning.length} chars` +
        (reasoning ? `; preview: ${reasoning.slice(0, 60)}` : ''),
    )
    console.log(`  content: ${content.length} chars; preview: ${content.slice(0, 80)}`)
    if (data.usage) {
      console.log(
        `  usage: total=${data.usage.total_tokens} completion=${data.usage.completion_tokens}` +
          ` reasoning=${data.usage.completion_tokens_details?.reasoning_tokens ?? '?'}`,
      )
    }
  } catch (err) {
    const ms = Date.now() - start
    console.log(
      `ERROR (${ms}ms) ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

async function main(): Promise<void> {
  console.log('=== GLM-5.2 thinking.budget_tokens support spike ===\n')

  // 1. baseline:不设 thinking —— 看 reasoning 默认多长(对比基准)
  await chat('1. baseline (no thinking)', {})

  // 2. thinking.budget_tokens = 300:小预算 —— 若支持,reasoning 应被截到 ~300 token
  await chat('2. thinking.budget_tokens=300', {
    thinking: { type: 'enabled', budget_tokens: 300 },
  })

  // 3. thinking.budget_tokens = 4000:大预算 —— 若支持,reasoning 可更长,但仍封顶
  await chat('3. thinking.budget_tokens=4000', {
    thinking: { type: 'enabled', budget_tokens: 4000 },
  })

  console.log('\n--- max_tokens 是否被遵守?(budget 被无视后的退路) ---\n')

  // 4. max_tokens = 300:小上限 —— 若遵守,completion_tokens 应 ~300(reasoning+content 都被截)
  await chat('4. max_tokens=300', { max_tokens: 300 })

  // 5. max_tokens = 2000:中等上限 —— 确认仍接受 + completion ≤ 2000
  await chat('5. max_tokens=2000', { max_tokens: 2000 })

  console.log('\n=== done ===')
}

main().catch((e) => {
  console.error('crashed:', e)
  process.exit(1)
})
