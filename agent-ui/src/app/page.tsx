'use client'
import { Suspense } from 'react'
import RequireAuth from '@/components/auth/RequireAuth'
import NovelLibrary from '@/components/library/NovelLibrary'

export default function Home() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <RequireAuth>
        <NovelLibrary />
      </RequireAuth>
    </Suspense>
  )
}
