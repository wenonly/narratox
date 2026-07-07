'use client'

import WelcomeNavbar from '@/components/welcome/WelcomeNavbar'
import Hero from '@/components/welcome/Hero'
import StatsStrip from '@/components/welcome/StatsStrip'
import Features from '@/components/welcome/Features'
import PlatformShowcase from '@/components/welcome/PlatformShowcase'
import Workflow from '@/components/welcome/Workflow'
import Download from '@/components/welcome/Download'
import WelcomeFooter from '@/components/welcome/WelcomeFooter'

/**
 * 营销主页 / 公开登录门。
 * 未登录用户访问任何受保护页(/、/novels/[id]、/settings 等)时,
 * RequireAuth 会把它们重定向到这里。点击「进入云端」按钮时,
 * 只看本地 authToken:有就直接进 /,没有就去 /login。
 */
export default function WelcomePage() {
  return (
    <main className="min-h-screen bg-[#0a0a0b] font-sans text-white scroll-smooth">
      <WelcomeNavbar />
      <Hero />
      <StatsStrip />
      <Features />
      <PlatformShowcase />
      <Workflow />
      <Download />
      <WelcomeFooter />
    </main>
  )
}
