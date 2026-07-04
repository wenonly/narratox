import { BookOpen, Sparkles, Map, Users, Upload } from 'lucide-react'

const FEATURES = [
  {
    icon: Sparkles,
    title: '多 Agent 协作',
    desc: '主笔 / 设定 / 大纲 / 校验各司其职'
  },
  {
    icon: Map,
    title: '智能大纲生成',
    desc: '三幕式 × 单元循环 × 弧线分卷'
  },
  {
    icon: Users,
    title: '角色世界观管理',
    desc: '人物小传 · 关系网 · 演化轨迹'
  },
  {
    icon: Upload,
    title: '一键发布',
    desc: '章节范围导出 · 纯文本可粘贴'
  }
]

const AuthBrandPanel = () => {
  return (
    <div className="relative hidden w-1/2 overflow-hidden bg-gradient-to-br from-bg-darkest to-bg-card lg:block">
      {/* 装饰光晕 — 半透明实心圆(对齐 Pencil) */}
      <div className="pointer-events-none absolute -left-[15%] -top-[12%] size-[28vw] rounded-full bg-[#6366f126]" />
      <div className="pointer-events-none absolute -right-[16%] -bottom-[14%] size-[26vw] rounded-full bg-[#8b5cf61f]" />
      <div className="pointer-events-none absolute left-[25%] top-[40%] size-[16vw] rounded-full bg-[#818CF814]" />
      <div className="pointer-events-none absolute right-[18%] top-[10%] size-[14vw] rounded-full bg-[#a78bfa18]" />

      <div className="relative z-10 flex h-full w-full flex-col justify-between p-16">
        {/* 品牌 */}
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-lg bg-gradient-to-b from-accent-primary to-accent-violet">
            <BookOpen className="size-[22px] text-text-primary" />
          </div>
          <span className="from-accent-indigoLight to-accent-violetLight bg-gradient-to-r bg-clip-text text-[30px] font-bold text-transparent">
            NarratoX
          </span>
        </div>

        {/* Slogan */}
        <div className="space-y-4">
          <h2 className="text-[28px] font-bold leading-snug text-text-primary">
            AI 驱动的长篇小说创作平台
          </h2>
          <p className="text-[14px] leading-relaxed text-text-tertiary">
            多 Agent 协作 · 完整世界观 · 千章不断线
            <br />
            让长篇创作从「孤军奋战」变成「团队作战」
          </p>
        </div>

        {/* Features */}
        <div className="space-y-[18px]">
          {FEATURES.map((f) => (
            <div key={f.title} className="flex items-center gap-3.5">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-primarySoft">
                <f.icon className="h-[18px] w-[18px] text-accent-indigoLight" />
              </div>
              <div className="min-w-0">
                <div className="text-lg font-semibold text-text-primary">
                  {f.title}
                </div>
                <div className="truncate text-sm text-text-tertiary">
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
