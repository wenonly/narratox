import type { Metadata } from 'next'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { Toaster } from '@/components/ui/sonner'
import './globals.css'

export const metadata: Metadata = {
  title: 'NarratoX — AI 长篇小说创作平台',
  description:
    '多 Agent 协作 · 完整世界观 · 千章不断线 — 让长篇创作从「孤军奋战」变成「团队作战」',
  keywords: [
    'AI写作',
    '小说创作',
    '长篇小说',
    '多Agent',
    '世界观',
    '大纲生成',
    'NarratoX'
  ]
}

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    // suppressHydrationWarning:浏览器扩展(沉浸式翻译等)会给 <html>/<body> 注入
    // data-* 属性,触发 SSR/CSR mismatch 报警。这些非应用属性不参与渲染,抑制即可。
    <html lang="en" suppressHydrationWarning>
      <body
        className="antialiased"
        suppressHydrationWarning
      >
        <NuqsAdapter>{children}</NuqsAdapter>
        <Toaster />
      </body>
    </html>
  )
}
