'use client'

import {
  Workflow,
  BookOpen,
  ScanSearch,
  ShieldCheck,
  AudioWaveform,
  Upload
} from 'lucide-react'

const FEATURES = [
  {
    icon: Workflow,
    title: '多 Agent 协作编排',
    desc: 'main 编排者调度 chapter / curator / worldbuilder / outliner / character,每个角色专精一事,任务自动委派。'
  },
  {
    icon: BookOpen,
    title: '全局写作知识库',
    desc: '6 大分类的拆书教程、公式模板、人设档案、词汇素材。Agent 按需读取并应用,你不必每次复述方法论。'
  },
  {
    icon: ScanSearch,
    title: '对标小说拆解',
    desc: '上传爆款自动切章,6 维结构化拆解(章节/情节/节奏/情绪/人物/文风),写作时按需调用作为参考。'
  },
  {
    icon: ShieldCheck,
    title: '12 维一致性审查',
    desc: '人物 OOC / 战力越级 / 细纲兑现 / 章节接缝 / AI 腔 一致性兜底。validator + 确定性守卫双层把关。'
  },
  {
    icon: AudioWaveform,
    title: '作者画像与声音',
    desc: '每用户多份 VoiceProfile,角色声音、语言习惯、风格倾向持久化。切换小说 = 切换人格,不丢失。'
  },
  {
    icon: Upload,
    title: '一键发布导出',
    desc: 'de-markdown 纯净化 + 网文平台格式,番茄/起点/晋江 直接粘贴。一章或全本,任你选择。'
  }
] as const

/**
 * 产品特性区:6 卡 2×3 网格。每卡:图标 / 标题 / 描述。
 */
export default function Features() {
  return (
    <section
      id="features"
      className="flex w-full flex-col items-center bg-[#0a0a0b] px-16 py-20"
      style={{ minHeight: 960 }}
    >
      {/* 标题 */}
      <div className="flex w-full max-w-[1312px] flex-col items-center gap-4">
        <span className="text-[13px] font-semibold uppercase tracking-[3px] text-[#8b5cf6]">
          FEATURES
        </span>
        <h2 className="text-5xl font-bold text-white">为长篇而生,不只是补全</h2>
        <p className="max-w-[720px] text-center text-base leading-[1.6] text-[#a1a1aa]">
          每一项能力都直击长篇创作痛点:人物漂移、伏笔遗忘、战力崩坏、节奏失控、AI
          腔。NarratoX 把方法论变成可执行的 Agent。
        </p>
      </div>

      {/* 卡片网格 */}
      <div className="mt-12 flex w-full max-w-[1312px] flex-col gap-5">
        <div className="grid grid-cols-3 gap-5">
          {FEATURES.slice(0, 3).map((f) => (
            <FeatureCard key={f.title} {...f} />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-5">
          {FEATURES.slice(3, 6).map((f) => (
            <FeatureCard key={f.title} {...f} />
          ))}
        </div>
      </div>
    </section>
  )
}

function FeatureCard({
  icon: Icon,
  title,
  desc
}: {
  icon: typeof Workflow
  title: string
  desc: string
}) {
  return (
    <div className="flex h-[280px] flex-col justify-between gap-3.5 rounded-2xl bg-[#1A1A2266] p-7 ring-1 ring-white/10 backdrop-blur-md">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-[#6366f1] to-[#8b5cf6]">
        <Icon className="h-6 w-6 text-white" />
      </div>
      <div className="flex flex-col gap-3.5">
        <h3 className="text-lg font-bold text-white">{title}</h3>
        <p className="text-[13px] leading-[1.6] text-[#a1a1aa]">{desc}</p>
      </div>
    </div>
  )
}
