'use client'

import { useRouter } from 'next/navigation'
import { ArrowRight, Bell, Globe, Monitor, Smartphone } from 'lucide-react'

import { useStore } from '@/store'

/**
 * 下载区:3 张卡片
 * - Cloud:可用,渐变背景,点击「立即进入云端」走 Navbar 同样逻辑
 * - PC / APP:灰色禁用,「上线时通知我」按钮(占位,未实装)
 */
export default function Download() {
  return (
    <section
      id="download"
      className="relative flex w-full flex-col items-center gap-12 overflow-hidden bg-[#0a0a0b] px-16 py-20"
    >
      {/* 装饰 blob */}
      <div
        className="absolute"
        style={{
          left: -200,
          top: -100,
          width: 700,
          height: 700,
          background:
            'radial-gradient(circle, #6366f130 0%, #6366f100 100%)',
          opacity: 0.6,
          borderRadius: '50%'
        }}
      />
      <div
        className="absolute"
        style={{
          left: 900,
          top: 200,
          width: 600,
          height: 600,
          background:
            'radial-gradient(circle, #8b5cf630 0%, #8b5cf600 100%)',
          opacity: 0.5,
          borderRadius: '50%'
        }}
      />

      {/* Header */}
      <div className="relative z-10 flex flex-col items-center gap-3">
        <span className="text-[13px] font-semibold uppercase tracking-[3px] text-[#8b5cf6]">
          GET STARTED
        </span>
        <h2 className="max-w-[900px] text-center text-5xl font-bold leading-[1.1] text-white">
          选择你的入口,开始创作之旅
        </h2>
        <p className="max-w-[680px] text-center text-base leading-[1.6] text-[#a1a1aa]">
          云端版本立即可用 · PC 与 APP 客户端正紧锣密鼓开发中
        </p>
      </div>

      {/* Cards */}
      <div className="relative z-10 grid w-full max-w-[1312px] grid-cols-3 gap-5">
        <CloudCard />
        <ClientCard
          icon={Monitor}
          badge="开发中 · 即将推出"
          title="桌面客户端"
          subtitle="Windows / macOS"
          desc="Windows / macOS 原生套壳。本地草稿、离线缓存、系统集成快捷键。适合长时间深度写作。"
          gradient="linear-gradient(135deg, #8b5cf6, #ec4899)"
          disabled
        />
        <ClientCard
          icon={Smartphone}
          badge="开发中 · 即将推出"
          title="移动端 APP"
          subtitle="iOS / Android"
          desc="iOS / Android。碎片时间看章节、改人设、跟进度。完整阅读与轻量编辑,随时随地。"
          gradient="linear-gradient(135deg, #ec4899, #f97316)"
          disabled
        />
      </div>
    </section>
  )
}

function CloudCard() {
  const router = useRouter()
  const hydrated = useStore((s) => s.hydrated)
  const authToken = useStore((s) => s.authToken)

  const handleClick = () => {
    if (hydrated && authToken) {
      router.push('/')
    } else {
      router.push('/login')
    }
  }

  return (
    <div
      className="flex h-[380px] flex-col justify-between gap-[18px] rounded-[20px] p-7 ring-1 ring-white/20"
      style={{
        background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
        boxShadow: '0 16px 48px -8px #6366f180'
      }}
    >
      <div className="flex flex-col gap-3.5">
        <div className="flex w-fit items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-white" />
          <span className="text-[11px] font-semibold text-white">立即可用</span>
        </div>
        <div className="flex h-[60px] w-[60px] items-center justify-center rounded-[14px] bg-white/20">
          <Globe className="h-7 w-7 text-white" />
        </div>
        <h3 className="text-[26px] font-bold text-white">NarratoX 云端</h3>
        <p className="text-[13px] leading-[1.6] text-white/80">
          浏览器直达。所有功能最新版本,免安装、免升级。包含云端模型配置与对标库同步。
        </p>
      </div>
      <button
        onClick={handleClick}
        className="flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3.5 transition-opacity hover:opacity-90"
      >
        <span className="text-sm font-bold text-[#6366f1]">立即进入云端</span>
        <ArrowRight className="h-4 w-4 text-[#6366f1]" />
      </button>
    </div>
  )
}

function ClientCard({
  icon: Icon,
  badge,
  title,
  subtitle,
  desc,
  gradient,
  disabled
}: {
  icon: typeof Globe
  badge: string
  title: string
  subtitle: string
  desc: string
  gradient: string
  disabled?: boolean
}) {
  return (
    <div className="flex h-[380px] flex-col justify-between gap-[18px] rounded-[20px] bg-[#1A1A22] p-7 ring-1 ring-white/10 backdrop-blur-md">
      <div className="flex flex-col gap-3.5">
        <div className="flex w-fit items-center gap-1.5 rounded-full bg-[#facc1520] px-2.5 py-1 ring-1 ring-[#facc1540]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#facc15]" />
          <span className="text-[11px] font-semibold text-[#facc15]">{badge}</span>
        </div>
        <div
          className="flex h-[60px] w-[60px] items-center justify-center rounded-[14px]"
          style={{ background: gradient }}
        >
          <Icon className="h-7 w-7 text-white" />
        </div>
        <h3 className="text-[26px] font-bold text-white">{title}</h3>
        <p className="text-xs text-[#a1a1aa]">{subtitle}</p>
        <p className="text-[13px] leading-[1.6] text-[#a1a1aa]">{desc}</p>
      </div>
      <button
        disabled={disabled}
        className="flex cursor-not-allowed items-center justify-center gap-2 rounded-xl bg-white/5 px-5 py-3.5 ring-1 ring-white/10"
      >
        <Bell className="h-3.5 w-3.5 text-[#d4d4d8]" />
        <span className="text-[13px] font-semibold text-[#d4d4d8]">
          上线时通知我
        </span>
      </button>
    </div>
  )
}
