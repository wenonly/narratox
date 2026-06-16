'use client'
import Sidebar from '@/components/chat/Sidebar/Sidebar'
import { ChatArea } from '@/components/chat/ChatArea'
import RequireAuth from '@/components/auth/RequireAuth'
import { Suspense } from 'react'

export default function Home() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <RequireAuth>
        <div className="flex h-screen bg-background/80">
          <Sidebar />
          <ChatArea />
        </div>
      </RequireAuth>
    </Suspense>
  )
}
