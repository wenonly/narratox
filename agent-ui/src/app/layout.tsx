import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { NuqsAdapter } from 'nuqs/adapters/next/app'
import { Toaster } from '@/components/ui/sonner'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap'
})

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
    <html lang="en">
      <body className={`${inter.variable} antialiased`}>
        <NuqsAdapter>{children}</NuqsAdapter>
        <Toaster />
      </body>
    </html>
  )
}
