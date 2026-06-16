'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { useStore } from '@/store'
import { registerAPI } from '@/api/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function RegisterPage() {
  const router = useRouter()
  const endpoint = useStore((s) => s.selectedEndpoint)
  const login = useStore((s) => s.login)
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
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
    <div className="flex h-screen items-center justify-center bg-background/80 px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-5 rounded-2xl border border-primary/10 bg-background-secondary p-8 shadow-2xl shadow-black/40"
      >
        <div className="space-y-1.5">
          <h1 className="text-xl font-semibold text-primary">注册</h1>
          <p className="text-xs text-muted">创建账号开始使用</p>
        </div>
        <div className="space-y-3">
          <Input
            type="email"
            placeholder="邮箱"
            aria-label="邮箱"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            type="text"
            placeholder="用户名（可选）"
            aria-label="用户名"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <Input
            type="password"
            placeholder="密码（至少 8 位）"
            aria-label="密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </div>
        <Button
          type="submit"
          className="h-11 w-full bg-brand text-white hover:bg-brand/90 focus-visible:ring-2 focus-visible:ring-brand/50"
          disabled={loading}
        >
          {loading ? '注册中…' : '注册'}
        </Button>
        <p className="text-center text-xs text-muted">
          已有账号？
          <Link
            href="/login"
            className="text-brand underline-offset-2 hover:underline"
          >
            登录
          </Link>
        </p>
      </form>
    </div>
  )
}
