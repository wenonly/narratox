import { Sparkles, Users, Globe, ShieldCheck } from 'lucide-react'

const FEATURES = [
  {
    icon: Users,
    title: '多 Agent 协作',
    desc: '主编 / 大纲 / 世界观 / 角色 / 校验 各司其职'
  },
  {
    icon: Globe,
    title: '完整世界观',
    desc: '总纲 · 卷 · 弧线 · 细纲 四级结构不穿帮'
  },
  {
    icon: ShieldCheck,
    title: '智能一致性校验',
    desc: '人物 / 战力 / 伏笔 / 细纲兑现逐章把关'
  },
  {
    icon: Sparkles,
    title: '对标拆解学习',
    desc: '上传爆款拆解,按维度内化为写作参考'
  }
]

/**
 * Auth left-side brand panel (Pencil frames 01/02 BrandPanel).
 * Shared by login + register. 50% width, hidden on mobile.
 */
const AuthBrandPanel = () => {
  return (
    <div className="relative hidden w-1/2 overflow-hidden bg-gradient-to-br from-bg-darkest to-bg-card lg:block">
      {/* 装饰光晕 */}
      <div className="pointer-events-none absolute -left-24 -top-24 h-[520px] w-[520px] rounded-full bg-[#6366f126] blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 right-[-120px] h-[480px] w-[480px] rounded-full bg-[#8b5cf61f] blur-3xl" />
      <div className="pointer-events-none absolute left-1/4 top-1/3 h-[300px] w-[300px] rounded-full bg-[#818CF81a] blur-3xl" />

      <div className="relative z-10 flex h-full w-full flex-col justify-between p-16">
        {/* 品牌 */}
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-gradient-to-b from-accent-primary to-accent-violet">
            <Sparkles className="size-5 text-white" />
          </div>
          <span className="from-accent-indigo-light to-accent-violet-light bg-gradient-to-r bg-clip-text text-3xl font-bold text-transparent">
            NarratoX
          </span>
        </div>

        {/* Slogan */}
        <div className="space-y-4">
          <h2 className="text-[28px] font-bold leading-snug text-text-primary">
            AI 驱动的长篇小说创作平台
          </h2>
          <p className="text-sm leading-relaxed text-text-tertiary">
            多 Agent 协作 · 完整世界观 · 千章不断线
            <br />
            让长篇创作从「孤军奋战」变成「团队作战」
          </p>
        </div>

        {/* Features */}
        <div className="space-y-[18px]">
          {FEATURES.map((f) => (
            <div key={f.title} className="flex items-center gap-3.5">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-overlay-15 bg-overlay-10">
                <f.icon className="text-accent-indigo-light size-4" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-text-primary">
                  {f.title}
                </div>
                <div className="truncate text-xs text-text-tertiary">
                  {f.desc}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default AuthBrandPanel
