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
  const setAuthToken = useStore((s) => s.setAuthToken)
  const setUser = useStore((s) => s.setUser)
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
      setAuthToken(token)
      setUser(user)
      router.replace('/')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '注册失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-background/80">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-2xl border border-primary/15 bg-background p-6"
      >
        <h1 className="text-lg font-semibold">注册</h1>
        <Input
          type="email"
          placeholder="邮箱"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Input
          type="text"
          placeholder="用户名（可选）"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <Input
          type="password"
          placeholder="密码（至少 8 位）"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
        />
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? '注册中…' : '注册'}
        </Button>
        <p className="text-center text-xs text-muted">
          已有账号？
          <Link href="/login" className="underline">
            登录
          </Link>
        </p>
      </form>
    </div>
  )
}
