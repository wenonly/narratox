'use client'

import { useRouter } from 'next/navigation'
import { Sparkles, ArrowRight, CirclePlay } from 'lucide-react'

import { useStore } from '@/store'

/**
 * Hero 区域。
 * - 3 个绝对定位的渐变 blob 装饰
 * - 顶部 badge:AI 长篇小说写作工作台 · 全新上线
 * - 标题:两行,第二行用三色渐变
 * - 副标题
 * - CTA 行:进入云端工作台(主)+ 观看 2 分钟演示(虚)
 *
 * 「进入云端工作台」按钮:有 token → /,无 token → /login。
 * token 失效时由 RequireAuth 兜底自动登出 + 跳回 /welcome。
 */
export default function Hero() {
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
    <section className="relative flex h-[760px] w-full flex-col items-center justify-center overflow-hidden bg-[#0a0a0b] px-16 pb-[60px] pt-20">
      {/* Blob 1 — Indigo 左上 */}
      <div
        className="absolute"
        style={{
          left: '-12.5%',
          top: '-16%',
          width: '47%',
          aspectRatio: '1',
          background:
            'radial-gradient(circle, #6366f140 0%, #6366f100 100%)',
          opacity: 0.8,
          borderRadius: '50%',
          filter: 'blur(60px)'
        }}
      />
      {/* Blob 2 — Violet 右上 */}
      <div
        className="absolute"
        style={{
          left: '68%',
          top: '10%',
          width: '39%',
          aspectRatio: '1',
          background:
            'radial-gradient(circle, #8b5cf640 0%, #8b5cf600 100%)',
          opacity: 0.7,
          borderRadius: '50%',
          filter: 'blur(50px)'
        }}
      />
      {/* Blob 3 — Pink 底中 */}
      <div
        className="absolute"
        style={{
          left: '36%',
          top: '53%',
          width: '28%',
          aspectRatio: '1',
          background:
            'radial-gradient(circle, #ec489930 0%, #ec489900 100%)',
          opacity: 0.6,
          borderRadius: '50%',
          filter: 'blur(40px)'
        }}
      />

      {/* 内容 */}
      <div className="relative z-10 flex w-full max-w-[1200px] flex-col items-center gap-8">
        {/* Badge */}
        <div className="flex items-center gap-2 rounded-full bg-[#1A1A22] px-3.5 py-1.5 ring-1 ring-white/10">
          <span className="h-1.5 w-1.5 rounded-full bg-[#6366f1]" />
          <span className="text-xs font-medium text-[#d4d4d8]">
            AI 长篇小说写作工作台 · 全新上线
          </span>
        </div>

        {/* 标题 */}
        <div className="flex w-full flex-col items-center gap-6">
          <h1
            className="w-full text-center font-extrabold leading-[1.05]"
            style={{ fontSize: 88 }}
          >
            <span className="bg-gradient-to-b from-white to-[#a1a1aa] bg-clip-text text-transparent">
              让 AI 与你
            </span>
          </h1>
          <h2
            className="w-full text-center font-extrabold leading-[1.05]"
            style={{ fontSize: 88 }}
          >
            <span className="bg-gradient-to-r from-[#6366f1] via-[#8b5cf6] to-[#ec4899] bg-clip-text text-transparent">
              共写一卷长篇
            </span>
          </h2>
          <p className="max-w-[760px] text-center text-[18px] leading-[1.6] text-[#a1a1aa]">
            NarratoX 是为网文与长篇小说创作者打造的 AI 协作工作台。多 Agent 实时编排
            · 12 维一致性审查 · 全局写作知识库 · 对标拆解,从立项到发布,一个工作台完成。
          </p>
        </div>

        {/* CTA */}
        <div className="mt-2 flex items-center gap-4">
          <button
            type="button"
            onClick={handleEnterCloud}
            className="flex items-center gap-2.5 rounded-[14px] bg-gradient-to-br from-[#6366f1] to-[#8b5cf6] px-8 py-4.5 shadow-[0_12px_32px_-4px_#6366f180] transition-opacity hover:opacity-90"
            style={{ padding: '18px 32px' }}
          >
            <Sparkles className="h-[18px] w-[18px] text-white" />
            <span className="text-base font-semibold text-white">
              进入云端工作台
            </span>
            <ArrowRight className="h-4 w-4 text-white" />
          </button>
          <button
            type="button"
            className="flex items-center gap-2.5 rounded-[14px] bg-white/5 px-7 py-4.5 ring-1 ring-white/10 backdrop-blur transition-colors hover:bg-white/10"
            style={{ padding: '18px 28px' }}
          >
            <CirclePlay className="h-[18px] w-[18px] text-[#d4d4d8]" />
            <span className="text-base font-medium text-[#d4d4d8]">
              观看 2 分钟演示
            </span>
          </button>
        </div>
      </div>
    </section>
  )
}
