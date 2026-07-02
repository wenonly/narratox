'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { useStore } from '@/store'
import { registerAPI } from '@/api/auth'
import AuthBrandPanel from '@/components/auth/AuthBrandPanel'

const inputBase =
  'focus:border-accent-indigo-light flex h-11 w-full rounded-md border border-white/10 bg-bg-darkest px-3.5 text-sm text-text-primary outline-none transition-colors placeholder:text-text-label'
const inputAccent =
  inputBase.replace('border-white/10', 'border-accent-primary') +
  ' focus-visible:shadow-[0_4px_16px_#6366f140]'

export default function RegisterPage() {
  const router = useRouter()
  const endpoint = useStore((s) => s.selectedEndpoint)
  const login = useStore((s) => s.login)
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [agree, setAgree] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 8) {
      toast.error('密码至少 8 位')
      return
    }
    if (confirm !== password) {
      toast.error('两次输入的密码不一致')
      return
    }
    if (!agree) {
      toast.error('请先同意服务条款与隐私政策')
      return
    }
    setLoading(true)
    try {
      const { token, user } = await registerAPI(
        endpoint,
        email,
        password,
        username || undefined
      )
      login(token, user)
      router.replace('/')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '注册失败')
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
          className="w-full max-w-[400px] space-y-[18px]"
        >
          <div className="space-y-2">
            <h1 className="text-4xl font-bold text-text-primary">创建账户</h1>
            <p className="text-sm text-text-tertiary">
              开始你的 AI 小说创作之旅
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-text-label">昵称</label>
            <input
              type="text"
              placeholder="你的笔名"
              aria-label="昵称"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={inputAccent}
            />
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
              className={inputBase}
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-text-label">密码</label>
            <input
              type="password"
              placeholder="至少 8 位"
              aria-label="密码"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className={inputBase}
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-text-label">
              确认密码
            </label>
            <input
              type="password"
              placeholder="再输一次"
              aria-label="确认密码"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              className={inputBase}
            />
          </div>

          {/* 同意条款 */}
          <label className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              checked={agree}
              onChange={(e) => setAgree(e.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-[#6366f1]"
            />
            <span className="text-xs leading-relaxed text-text-tertiary">
              我已阅读并同意 NarratoX
              <span className="text-accent-indigo-light">《服务条款》</span>与
              <span className="text-accent-indigo-light">《隐私政策》</span>
            </span>
          </label>

          <button
            type="submit"
            disabled={loading}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-gradient-to-b from-accent-primary to-accent-violet text-sm font-semibold text-white shadow-[0_4px_16px_#6366f140] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {loading ? '创建中…' : '创建账户'}
          </button>

          <p className="flex items-center justify-center gap-1 pt-1 text-sm text-text-tertiary">
            已有账户?
            <Link
              href="/login"
              className="text-accent-indigo-light font-semibold hover:underline"
            >
              登录
            </Link>
          </p>
        </form>
      </div>
    </div>
  )
}
