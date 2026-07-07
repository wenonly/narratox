'use client'

const STATS = [
  {
    num: '6',
    label: '写作知识库分类',
    sub: '人设 / 公式 / 创作须知 / 拆文 / 词汇 / 方法论'
  },
  {
    num: '12+',
    label: '维一致性审查',
    sub: '人物 / 战力 / 细纲 / 节奏 全维度把关'
  },
  {
    num: '5',
    label: 'Agent 协作编排',
    sub: 'main / chapter / curator / worldbuilder / outliner'
  },
  {
    num: '∞',
    label: '章前文记忆',
    sub: '事件 / 弧线 / 角色 长程上下文不丢'
  }
] as const

/**
 * 4 数字横向 stat 条。每个数字带 indigo→violet 渐变。
 */
export default function StatsStrip() {
  return (
    <section className="w-full bg-[#0F0F13]">
      <div className="mx-auto flex h-[160px] w-full max-w-[1312px] items-center justify-between gap-6 px-16 py-6">
        {STATS.map((s) => (
          <div
            key={s.label}
            className="flex w-full flex-col items-center gap-2 text-center"
          >
            <span className="bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] bg-clip-text text-5xl font-extrabold text-transparent">
              {s.num}
            </span>
            <span className="text-sm font-semibold text-white">{s.label}</span>
            <span className="text-xs leading-[1.5] text-[#a1a1aa]">
              {s.sub}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
