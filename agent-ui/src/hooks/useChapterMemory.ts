'use client'

import { useEffect, useRef, useState } from 'react'
import { getChapterMemory } from '@/api/novels'
import { useStore } from '@/store'
import type { MemoryData } from '@/types/os'

type Status = 'idle' | 'polling' | 'settled' | 'timeout'

/**
 * 写作轮后轮询本章记忆。active=true 且给定 order 时启动;每 4s 一次,60s 超时。
 * settled 后停;超时或卸载时清理。不禁用输入框(异步)。
 */
export function useChapterMemory(
  novelId: string | undefined,
  order: number | null,
  active: boolean
) {
  const base = useStore((s) => s.selectedEndpoint)
  const token = useStore((s) => s.authToken)
  const [status, setStatus] = useState<Status>('idle')
  const [memory, setMemory] = useState<MemoryData | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startedAt = useRef(0)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    if (!active || !novelId || order === null) {
      setStatus('idle')
      setMemory(null)
      return
    }

    setStatus('polling')
    setMemory(null)
    startedAt.current = Date.now()
    const TIMEOUT = 60_000
    const INTERVAL = 4_000

    const tick = async () => {
      try {
        const data = await getChapterMemory(base, token, novelId, order)
        if (data.settled) {
          setStatus('settled')
          setMemory(data)
          timer.current = null
          return
        }
      } catch {
        /* 单次失败不致命,继续轮询 */
      }
      if (Date.now() - startedAt.current >= TIMEOUT) {
        setStatus('timeout')
        timer.current = null
        return
      }
      timer.current = setTimeout(tick, INTERVAL)
    }

    timer.current = setTimeout(tick, 1500) // 先给结算一点启动时间再开始轮询
    return () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
    }
  }, [novelId, order, active, base, token])

  return { status, memory }
}

export default useChapterMemory
