'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { useStore } from '@/store'
import { loginAPI } from '@/api/auth'
import AuthBrandPanel from '@/components/auth/AuthBrandPanel'

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
      <AuthBrandPanel />

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
