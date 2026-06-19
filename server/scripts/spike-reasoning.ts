// 诊断脚本 #2(v2 基石):能否从 GLM-5.2 的流式 chunk 里捕获 reasoning_content?
// 这是「扁平活动流」里 think 条目的数据源,也是消除卡顿的关键(思考阶段接出来 → 边想边显示)。
// 当前 extractDelta 只取 .text/.content,reasoning 被丢弃 → 界面冻住再爆一段。
//
// 本脚本:model.stream(prompt),逐 chunk 检查 additional_kwargs.reasoning_content
// (以及 content),统计哪些 chunk 带 reasoning、哪些带 content,以及时序。
//
// 运行: cd server && pnpm exec ts-node scripts/spike-reasoning.ts
import 'dotenv/config'

const apiKey = process.env.ZHIPUAI_API_KEY
if (!apiKey) throw new Error('ZHIPUAI_API_KEY missing in .env')

async function main() {
  const { ChatOpenAI } = await import('@langchain/openai')
  const model = new ChatOpenAI({
    apiKey,
    model: 'GLM-5.2',
    temperature: 0.2,
    configuration: { baseURL: 'https://api.z.ai/api/coding/paas/v4' },
    timeout: 90_000,
    maxRetries: 0,
  })

  console.log('=== GLM-5.2 reasoning_content streaming capture ===\n')

  const stream = await model.stream(
    '请认真思考后回答:如果一个主角被困在没有时间的房间里,他如何感知时间流逝?给出你的推理过程和结论。',
  )

  let reasoningChunks = 0
  let contentChunks = 0
  let reasoningChars = 0
  let contentChars = 0
  let firstReasoningAt: number | null = null
  let firstContentAt: number | null = null
  const start = Date.now()

  // 打印前若干 chunk 的结构,看清 reasoning_content 落在哪个字段。
  let printed = 0
  for await (const chunk of stream) {
    const c = chunk as {
      content?: unknown
      additional_kwargs?: Record<string, unknown>
    }
    // reasoning_content 可能直接挂在 chunk,或在 additional_kwargs.reasoning_content,
    // 也可能是 string 或 { content: string } 结构。全部探查。
    const ak = c.additional_kwargs ?? {}
    const chunkRec = chunk as unknown as Record<string, unknown>
    const reasoningRaw =
      (ak.reasoning_content as unknown) ??
      (ak.reasoning as unknown) ??
      (chunkRec.reasoning_content as unknown) ??
      null
    // 归一化成 string
    const reasoningStr = typeof reasoningRaw === 'string'
      ? reasoningRaw
      : reasoningRaw && typeof reasoningRaw === 'object' &&
          'content' in (reasoningRaw as Record<string, unknown>)
        ? String((reasoningRaw as { content?: unknown }).content ?? '')
        : ''
    const contentStr = typeof c.content === 'string' ? c.content : ''

    if (printed < 8) {
      console.log(
        `chunk#${printed} keys=${Object.keys(chunk as unknown as object).join(',')} ` +
          `ak=${Object.keys(ak).join(',') || '(none)'} ` +
          `reasoning=${reasoningStr.length}c content=${contentStr.length}c`,
      )
      printed++
    }

    if (reasoningStr) {
      reasoningChunks++
      reasoningChars += reasoningStr.length
      if (firstReasoningAt === null) firstReasoningAt = Date.now() - start
    }
    if (contentStr) {
      contentChunks++
      contentChars += contentStr.length
      if (firstContentAt === null) firstContentAt = Date.now() - start
    }
  }

  const ms = Date.now() - start
  console.log('\n--- summary ---')
  console.log(`elapsed: ${ms}ms`)
  console.log(`reasoning chunks: ${reasoningChunks} (${reasoningChars} chars)`)
  console.log(`content chunks:   ${contentChunks} (${contentChars} chars)`)
  console.log(
    `first reasoning at: ${firstReasoningAt ?? 'never'}ms  /  first content at: ${firstContentAt ?? 'never'}ms`,
  )

  if (reasoningChunks > 0) {
    console.log(
      '\n✅ PASS: reasoning_content is streamable — think activity items will have content.',
    )
  } else {
    console.log(
      '\n⚠️  reasoning_content NOT captured on additional_kwargs — need another field/layer.',
    )
  }
}

main().catch((e) => {
  console.error('crashed:', e)
  process.exit(1)
})
