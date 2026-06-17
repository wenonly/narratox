'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { useStore } from '@/store'
import { createNovel } from '@/api/novels'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const NewNovelForm = ({ onDone }: { onDone?: () => void }) => {
  const router = useRouter()
  const endpoint = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const [title, setTitle] = useState('')
  const [genre, setGenre] = useState('')
  const [synopsis, setSynopsis] = useState('')
  const [worldviewText, setWorldviewText] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    setLoading(true)
    try {
      const novel = await createNovel(endpoint, token, {
        title: title.trim(),
        genre: genre.trim() || undefined,
        synopsis: synopsis.trim() || undefined,
        settings: worldviewText.trim()
          ? { worldviewText: worldviewText.trim() }
          : undefined
      })
      onDone?.()
      router.push(`/novels/${novel.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '创建失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Input
        placeholder="书名"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        required
      />
      <Input
        placeholder="类型(如 玄幻 / 悬疑)"
        value={genre}
        onChange={(e) => setGenre(e.target.value)}
      />
      <Input
        placeholder="一句话简介"
        value={synopsis}
        onChange={(e) => setSynopsis(e.target.value)}
      />
      <Input
        placeholder="世界观/设定(可选,会喂给 AI)"
        value={worldviewText}
        onChange={(e) => setWorldviewText(e.target.value)}
      />
      <Button
        type="submit"
        disabled={loading}
        className="h-11 w-full bg-brand text-white hover:bg-brand/90"
      >
        {loading ? '创建中…' : '创建并开始写作'}
      </Button>
    </form>
  )
}

export default NewNovelForm
