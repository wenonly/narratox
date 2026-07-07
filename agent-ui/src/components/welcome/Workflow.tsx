'use client'

import { Lightbulb, Map, PenTool, Rocket } from 'lucide-react'

const STEPS = [
  {
    num: '01',
    icon: Lightbulb,
    title: '立项建档',
    desc: '输入小说名、题材、世界观、风格。curator 自动补充市场分析与读者画像。',
    gradient: 'linear-gradient(135deg, #6366f1, #8b5cf6)'
  },
  {
    num: '02',
    icon: Map,
    title: '大纲构建',
    desc: 'outliner 分卷分弧、生成总纲(三幕 + 暗线 + 战力曲线),character 构建角色档案。',
    gradient: 'linear-gradient(135deg, #8b5cf6, #ec4899)'
  },
  {
    num: '03',
    icon: PenTool,
    title: 'AI 协作写作',
    desc: 'chapter orchestrator 委派 writer,每章自动调用前情、相邻章、伏笔,validator 兜底一致性。',
    gradient: 'linear-gradient(135deg, #ec4899, #f97316)'
  },
  {
    num: '04',
    icon: Rocket,
    title: '导出发布',
    desc: 'de-markdown 纯净化,番茄/起点/晋江 一键粘贴。一本完结小说就此诞生。',
    gradient: 'linear-gradient(135deg, #f97316, #facc15)'
  }
] as const

/**
 * 工作流区:4 步骤卡片。
 */
export default function Workflow() {
  return (
    <section
      id="workflow"
      className="flex w-full flex-col items-center gap-12 bg-[#0F0F13] px-16 py-[60px]"
      style={{ minHeight: 560 }}
    >
      {/* Header */}
      <div className="flex flex-col items-center gap-3">
        <span className="text-[13px] font-semibold uppercase tracking-[3px] text-[#8b5cf6]">
          WORKFLOW
        </span>
        <h2 className="text-4xl font-bold text-white">四步从立项到发布</h2>
      </div>

      {/* Steps */}
      <div className="grid w-full max-w-[1312px] grid-cols-4 gap-5">
        {STEPS.map((s) => {
          const Icon = s.icon
          return (
            <div
              key={s.num}
              className="relative flex h-[280px] flex-col gap-3.5 rounded-2xl bg-[#1A1A22] p-6 ring-1 ring-white/10"
            >
              <span className="absolute right-6 top-5 text-[32px] font-extrabold text-white/20">
                {s.num}
              </span>
              <div
                className="flex h-11 w-11 items-center justify-center rounded-[10px]"
                style={{ background: s.gradient }}
              >
                <Icon className="h-[22px] w-[22px] text-white" />
              </div>
              <h3 className="text-lg font-bold text-white">{s.title}</h3>
              <p className="text-xs leading-[1.55] text-[#a1a1aa]">{s.desc}</p>
            </div>
          )
        })}
      </div>
    </section>
  )
}
