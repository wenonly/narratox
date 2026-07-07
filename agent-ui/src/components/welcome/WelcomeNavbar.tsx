'use client'

import { useRouter } from 'next/navigation'
import { Sparkles, ArrowRight } from 'lucide-react'

import { useStore } from '@/store'

const NAV_LINKS = [
  { href: '#features', label: '特性' },
  { href: '#multi-platform', label: '多端' },
  { href: '#workflow', label: '流程' },
  { href: '#download', label: '下载' }
] as const

/**
 * 顶部导航栏。
 * 中间是 4 个同页锚点(只在 /welcome 内滚动,不跳路由)。
 * 右侧「进入云端」按钮:有 token → /,无 token → /login。
 * token 失效时由 RequireAuth 兜底自动登出 + 跳回 /welcome。
 */
export default function WelcomeNavbar() {
  const router = useRouter()
  const hydrated = useStore((s) => s.hydrated)
  const authToken = useStore((s) => s.authToken)

  const handleEnterCloud = () => {
    if (hydrated && authToken) {
      router.push('/')
    } else {
      router.push('/login')
    }
  }

  return (
    <header className="sticky top-0 z-50 grid h-[72px] w-full grid-cols-[1fr_auto_1fr] items-center bg-[#0a0a0b]/95 px-16 backdrop-blur">
      {/* Logo */}
      <div className="flex items-center gap-2.5 justify-self-start">
        <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-gradient-to-br from-[#6366f1] to-[#8b5cf6]">
          <Sparkles className="h-5 w-5 text-white" />
        </div>
        <span className="text-xl font-bold text-white">NarratoX</span>
      </div>

      {/* 中部同页锚点 */}
      <nav className="flex items-center gap-8 justify-self-center">
        {NAV_LINKS.map((link) => (
          <a
            key={link.href}
            href={link.href}
            className="text-sm font-medium text-[#a1a1aa] transition-colors hover:text-white"
          >
            {link.label}
          </a>
        ))}
      </nav>

      {/* CTA */}
      <button
        onClick={handleEnterCloud}
        className="flex items-center gap-1.5 justify-self-end rounded-[10px] bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] px-5 py-2.5 transition-opacity hover:opacity-90"
      >
        <span className="text-[13px] font-semibold text-white">进入云端</span>
        <ArrowRight className="h-3.5 w-3.5 text-white" />
      </button>
    </header>
  )
}
