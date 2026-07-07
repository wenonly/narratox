'use client'

import { Globe, Smartphone, Monitor, Check } from 'lucide-react'

const WEB_TAGS = ['多 Agent 实时编排', '12 维一致性审查', '一键发布导出']
const APP_TAGS = ['碎片时间阅读', '随身角色档案', '推送写作进度']
const PC_TAGS = ['系统集成快捷键', '多窗口对比阅读', '本地草稿缓存']

/**
 * 多端展示:3 排 Z 字形布局。
 * - Web:左文右图(已上线,绿色徽标)
 * - APP:左图右文(开发中,黄色徽标)
 * - PC :左文右图(开发中,黄色徽标)
 */
export default function PlatformShowcase() {
  return (
    <section
      id="multi-platform"
      className="flex w-full flex-col items-center gap-12 bg-[#0a0a0b] px-16 py-[60px]"
    >
      {/* Header */}
      <div className="flex flex-col items-center gap-3">
        <span className="text-[13px] font-semibold uppercase tracking-[3px] text-[#8b5cf6]">
          MULTI-PLATFORM
        </span>
        <h2 className="text-4xl font-bold text-white">
          一个工作台,三个端,处处衔接
        </h2>
      </div>

      {/* Row Web — 左文右图 */}
      <div className="flex w-full max-w-[1312px] items-center gap-12">
        <WebText />
        <WebImage />
      </div>

      {/* Row APP — 左图右文 */}
      <div className="flex w-full max-w-[1312px] items-center gap-12">
        <AppImage />
        <AppText />
      </div>

      {/* Row PC — 左文右图 */}
      <div className="flex w-full max-w-[1312px] items-center gap-12">
        <PcText />
        <PcImage />
      </div>
    </section>
  )
}

function LiveBadge({ text = '即用 · 浏览器直达' }: { text?: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-full bg-[#10b98115] px-3 py-[5px] ring-1 ring-[#10b98140]">
      <span className="h-1.5 w-1.5 rounded-full bg-[#10b981]" />
      <span className="text-[11px] font-semibold text-[#10b981]">{text}</span>
    </div>
  )
}

function TBDBadge() {
  return (
    <div className="flex items-center gap-1.5 rounded-full bg-[#facc1515] px-3 py-[5px] ring-1 ring-[#facc1540]">
      <span className="h-[11px] w-[11px] rounded-full bg-[#facc15]" />
      <span className="text-[11px] font-semibold text-[#facc15]">
        开发中 · 即将上线
      </span>
    </div>
  )
}

function TagPills({ tags }: { tags: string[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {tags.map((t) => (
        <span
          key={t}
          className="flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 text-xs text-[#d4d4d8] ring-1 ring-white/10"
        >
          <Check className="h-3 w-3 text-[#8b5cf6]" />
          {t}
        </span>
      ))}
    </div>
  )
}

function PlatformHead({
  icon: Icon,
  title,
  subtitle,
  gradient
}: {
  icon: typeof Globe
  title: string
  subtitle: string
  gradient: string
}) {
  return (
    <div className="flex items-center gap-3.5">
      <div
        className="flex h-[52px] w-[52px] items-center justify-center rounded-[14px]"
        style={{ background: gradient }}
      >
        <Icon className="h-6 w-6 text-white" />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-2xl font-bold text-white">{title}</span>
        <span className="text-xs text-[#a1a1aa]">{subtitle}</span>
      </div>
    </div>
  )
}

function WebText() {
  return (
    <div className="flex w-[512px] flex-col gap-[18px]">
      <LiveBadge />
      <PlatformHead
        icon={Globe}
        title="Web 浏览器"
        subtitle="Chrome / Edge / Safari 推荐"
        gradient="linear-gradient(135deg, #6366f1, #8b5cf6)"
      />
      <p className="text-[15px] leading-[1.7] text-[#a1a1aa]">
        浏览器直达,无需安装。所有功能最新版本,云端模型配置、对标库同步、写作知识库一手在握。从立项到发布,一个标签页完成。
      </p>
      <TagPills tags={WEB_TAGS} />
    </div>
  )
}

function AppText() {
  return (
    <div className="flex flex-1 flex-col gap-[18px]">
      <TBDBadge />
      <PlatformHead
        icon={Smartphone}
        title="移动 APP"
        subtitle="iOS / Android"
        gradient="linear-gradient(135deg, #ec4899, #f97316)"
      />
      <p className="text-[15px] leading-[1.7] text-[#a1a1aa]">
        iPhone 与 Android。碎片时间阅读章节、跟进写作进度、修改人设。完整阅读体验,轻量编辑能力,让你的故事随身携带。
      </p>
      <TagPills tags={APP_TAGS} />
    </div>
  )
}

function PcText() {
  return (
    <div className="flex w-[512px] flex-col gap-[18px]">
      <TBDBadge />
      <PlatformHead
        icon={Monitor}
        title="桌面客户端"
        subtitle="macOS / Windows"
        gradient="linear-gradient(135deg, #8b5cf6, #ec4899)"
      />
      <p className="text-[15px] leading-[1.7] text-[#a1a1aa]">
        macOS 与 Windows 原生套壳。系统集成快捷键、多窗口对比阅读、本地草稿缓存、自动更新。深度写作场景的最佳搭档。
      </p>
      <TagPills tags={PC_TAGS} />
    </div>
  )
}

function WebImage() {
  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded-[14px] bg-[#0F0F13] ring-1 ring-white/10"
         style={{ height: 520 }}>
      <div
        className="absolute"
        style={{
          left: 200,
          top: -100,
          width: 600,
          height: 600,
          background:
            'radial-gradient(circle, #6366f130 0%, #6366f100 100%)',
          opacity: 0.6,
          borderRadius: '50%'
        }}
      />
      <img
        src="/welcome/zmLJC.png"
        alt="Web 工作台预览"
        className="relative z-10 rounded-lg shadow-[0_16px_40px_-8px_#00000080]"
        style={{ width: 740, height: 462, objectFit: 'cover' }}
      />
    </div>
  )
}

function AppImage() {
  return (
    <div
      className="relative flex w-[512px] items-center justify-center overflow-hidden rounded-[14px] ring-1 ring-white/10"
      style={{
        height: 560,
        background: 'linear-gradient(135deg, #1A1A22, #0F0F13)'
      }}
    >
      <div
        className="absolute"
        style={{
          left: 60,
          top: 30,
          width: 500,
          height: 500,
          background:
            'radial-gradient(circle, #ec489935 0%, #ec489900 100%)',
          opacity: 0.7,
          borderRadius: '50%'
        }}
      />
      <img
        src="/welcome/aUs1a.png"
        alt="APP 预览"
        className="relative z-10 rounded-[18px] shadow-[0_16px_40px_-8px_#ec489960]"
        style={{ width: 257, height: 540, objectFit: 'cover' }}
      />
    </div>
  )
}

function PcImage() {
  return (
    <div
      className="relative flex flex-1 items-center justify-center overflow-hidden rounded-[14px] bg-[#0F0F13] ring-1 ring-white/10"
      style={{ height: 520 }}
    >
      <div
        className="absolute"
        style={{
          left: 200,
          top: -100,
          width: 600,
          height: 600,
          background:
            'radial-gradient(circle, #8b5cf630 0%, #8b5cf600 100%)',
          opacity: 0.6,
          borderRadius: '50%'
        }}
      />
      <img
        src="/welcome/MCEdZ.png"
        alt="PC 客户端预览"
        className="relative z-10 rounded-lg shadow-[0_16px_40px_-8px_#00000080]"
        style={{ width: 740, height: 462, objectFit: 'cover' }}
      />
    </div>
  )
}
