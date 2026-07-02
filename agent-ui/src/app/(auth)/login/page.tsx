'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Sparkles, Users, Globe, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'

import { useStore } from '@/store'
import { loginAPI } from '@/api/auth'

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

export default function LoginPage() {
  const router = useRouter()
  const endpoint = useStore((s) => s.selectedEndpoint)
  const login = useStore((s) => s.login)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const { token, user } = await loginAPI(endpoint, email, password)
      login(token, user)
      router.replace('/')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-screen bg-bg-base">
      {/* BrandPanel — 左 50%(移动端隐藏) */}
      <div className="relative hidden w-1/2 overflow-hidden bg-gradient-to-br from-bg-darkest to-bg-card lg:block">
        {/* 装饰光晕 */}
        <div className="bg-accent-primary/15 pointer-events-none absolute -left-24 -top-24 h-[520px] w-[520px] rounded-full blur-3xl" />
        <div className="bg-accent-violet/12 pointer-events-none absolute bottom-0 right-[-120px] h-[480px] w-[480px] rounded-full blur-3xl" />
        <div className="bg-accent-indigo-light/10 pointer-events-none absolute left-1/4 top-1/3 h-[300px] w-[300px] rounded-full blur-3xl" />

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

      {/* FormPanel — 右 50% */}
      <div className="flex w-full items-center justify-center bg-bg-card p-8 lg:w-1/2">
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-[400px] space-y-5"
        >
          <div className="space-y-2">
            <h1 className="text-4xl font-bold text-text-primary">欢迎回来</h1>
            <p className="text-sm text-text-tertiary">
              输入账户信息,继续你的创作之旅
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-text-label">邮箱</label>
            <input
              type="email"
              placeholder="you@example.com"
              aria-label="邮箱"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="focus:border-accent-indigo-light flex h-11 w-full rounded-md border border-accent-primary bg-bg-darkest px-3.5 text-sm text-text-primary outline-none transition-colors placeholder:text-text-label focus-visible:shadow-[0_4px_16px_#6366f140]"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-text-label">密码</label>
            <input
              type="password"
              placeholder="••••••••"
              aria-label="密码"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="focus:border-accent-indigo-light flex h-11 w-full rounded-md border border-white/10 bg-bg-darkest px-3.5 text-sm text-text-primary outline-none transition-colors placeholder:text-text-label"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-gradient-to-b from-accent-primary to-accent-violet text-sm font-semibold text-white shadow-[0_4px_16px_#6366f140] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {loading ? '登录中…' : '登录'}
          </button>

          <p className="flex items-center justify-center gap-1 pt-1 text-sm text-text-tertiary">
            还没有账户?
            <Link
              href="/register"
              className="text-accent-indigo-light font-semibold hover:underline"
            >
              注册
            </Link>
          </p>
        </form>
      </div>
    </div>
  )
}
