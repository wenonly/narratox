'use client'

import { Feather, Diamond } from 'lucide-react'

/**
 * 页脚。logo + slogan + 装饰分隔线 + 社交 + 版权。
 */
export default function WelcomeFooter() {
  return (
    <footer className="flex w-full flex-col items-center gap-10 border-t border-white/10 bg-[#0F0F13] px-16 pb-10 pt-[60px]">
      {/* Top:品牌区 */}
      <div className="flex w-full max-w-[1312px] flex-col items-center gap-3.5">
        {/* 装饰分隔线 */}
        <div className="flex w-[280px] items-center justify-center gap-3">
          <span className="h-px w-[100px] bg-white/10" />
          <Diamond className="h-2.5 w-2.5 text-[#8b5cf6]" />
          <span className="h-px w-[100px] bg-white/10" />
        </div>

        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[#6366f1] to-[#8b5cf6]">
            <Feather className="h-4 w-4 text-white" />
          </div>
          <span className="text-lg font-bold text-white">NarratoX</span>
        </div>

        <p className="max-w-[680px] text-center text-[13px] leading-[1.6] text-[#a1a1aa]">
          为长篇小说创作者打造的 AI 协作工作台。从立项到发布,一个工作台完成。
        </p>

        <div className="mt-8 flex w-[280px] items-center justify-center gap-3">
          <span className="h-px w-[100px] bg-white/10" />
          <span className="h-1 w-1 rounded-full bg-[#8b5cf6]" />
          <span className="h-px w-[100px] bg-white/10" />
        </div>
      </div>

      {/* Bottom:版权 */}
      <div className="flex w-full max-w-[1312px] flex-wrap items-center justify-center gap-5 pt-5">
        <span className="text-xs text-[#71717a]">
          © 2026 NarratoX. All rights reserved.
        </span>
        <span className="text-xs text-[#71717a]">
          Made with ❤ for storytellers
        </span>
      </div>
    </footer>
  )
}
