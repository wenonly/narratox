// 诊断脚本:z.ai coding 端点上 GLM-5.2 的结构化输出到底哪条路通。
// run #1/#2 的 298s 挂死 = HTTP socket 超时 → 默认 structured 方法没响应。
// 本脚本:baseline 普通调用 + 显式 functionCalling / jsonSchema,各自 60s 超时。
// 运行: cd server && pnpm exec ts-node scripts/spike-analyst-structured.ts
import 'dotenv/config'

import { ChatOpenAI } from '@langchain/openai'
import { z } from 'zod'

const apiKey = process.env.ZHIPUAI_API_KEY
if (!apiKey) throw new Error('ZHIPUAI_API_KEY missing in .env')

const baseCfg = {
  apiKey,
  model: 'GLM-5.2',
  temperature: 0.1,
  configuration: { baseURL: 'https://api.z.ai/api/coding/paas/v4' },
  // 60s 超时 —— 别再挂 5 分钟
  timeout: 60_000,
  maxRetries: 0,
}

const schema = z.object({
  summary: z.string(),
  roleChanges: z.array(z.object({ name: z.string(), change: z.string() })),
  entities: z.array(z.object({ type: z.enum(['item', 'place', 'setting']), name: z.string(), note: z.string() })),
  newHooks: z.array(z.string()),
  resolvedHookIds: z.array(z.string()),
})

const messages = [
  {
    role: 'system' as const,
    content:
      '你是小说一致性记账员。严谨提取事实,不编造。resolvedHookIds 只能从给定 OPEN 伏笔 id 里挑。',
  },
  {
    role: 'user' as const,
    content:
      '【书名】剑来\n【OPEN 伏笔】\n- id=e1: 黑影身份\n- id=e2: 师父陨落真相\n\n【本章正文】第3章:陈平安在落魄山觉醒剑灵青冥,拔剑立誓。远处黑影窥视(回收了黑影身份的线索)。山下酒馆得一把银色钥匙。',
  },
]

async function timed<T>(label: string, fn: () => Promise<T>): Promise<void> {
  const start = Date.now()
  process.stdout.write(`${label} ... `)
  try {
    const res = await fn()
    const ms = Date.now() - start
    console.log(`OK (${ms}ms)`)
    console.log(`  → ${JSON.stringify(res).slice(0, 300)}`)
  } catch (err) {
    const ms = Date.now() - start
    const e = err as { name?: string; message?: string; status?: number }
    console.log(`FAIL (${ms}ms) ${e.name ?? ''} ${e.status ?? ''} ${e.message ?? ''}`.trim())
  }
}

async function main() {
  console.log('=== GLM-5.2 structured-output diagnosis (60s cap each) ===\n')

  // 1. baseline:普通调用(写作 Agent 这么用,应该通)—— 确认端点本身活着
  await timed('1. baseline model.invoke', async () => {
    const m = new ChatOpenAI(baseCfg)
    const r = await m.invoke(messages)
    return { kind: r?.constructor?.name, preview: String(r?.content ?? '').slice(0, 120) }
  })

  // 2. structured via functionCalling(工具模式)
  await timed('2. withStructuredOutput(method=functionCalling)', async () => {
    const m = new ChatOpenAI(baseCfg)
    const s = m.withStructuredOutput(schema, { method: 'functionCalling' })
    return s.invoke(messages)
  })

  // 3. structured via jsonSchema(response_format json_schema 模式)
  await timed('3. withStructuredOutput(method=jsonSchema)', async () => {
    const m = new ChatOpenAI(baseCfg)
    const s = m.withStructuredOutput(schema, { method: 'jsonSchema' })
    return s.invoke(messages)
  })

  // 4. structured via jsonMode(response_format json_object,无 schema 强约束)
  await timed('4. withStructuredOutput(method=jsonMode)', async () => {
    const m = new ChatOpenAI(baseCfg)
    const s = m.withStructuredOutput(schema, { method: 'jsonMode' })
    return s.invoke(messages)
  })

  console.log('\n=== done ===')
}

main().catch((e) => {
  console.error('crashed:', e)
  process.exit(1)
})
