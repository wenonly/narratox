'use client'

import * as React from 'react'
import { ChevronDown } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * CollapsibleCard — Token Spec §3.3衍生. Collapsed shows title + chevron;
 * expanded reveals children. Used by worldview/outline/characters panels
 * (Wave 2). Controlled by internal state; uncontrolled by default.
 */
interface CollapsibleCardProps {
  title: React.ReactNode
  /** Optional right-aligned extra (count badge, actions). */
  extra?: React.ReactNode
  defaultOpen?: boolean
  /** Controlled open state. If omitted, the card manages its own state. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: React.ReactNode
  className?: string
}

function CollapsibleCard({
  title,
  extra,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  children,
  className
}: CollapsibleCardProps) {
  const isControlled = openProp !== undefined
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen)
  const open = isControlled ? openProp : internalOpen

  const toggle = () => {
    const next = !open
    if (!isControlled) setInternalOpen(next)
    onOpenChange?.(next)
  }

  return (
    <div
      className={cn('rounded-lg border border-overlay-15 bg-bg-card', className)}
    >
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
        aria-expanded={open}
      >
        <ChevronDown
          className={cn(
            'size-3.5 shrink-0 text-text-label transition-transform',
            open ? '' : '-rotate-90'
          )}
        />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text-primary">
          {title}
        </span>
        {extra ? <div className="shrink-0">{extra}</div> : null}
      </button>
      {open ? (
        <div className="border-t border-overlay-10 px-3 py-2.5 text-[12px] text-text-body">
          {children}
        </div>
      ) : null}
    </div>
  )
}

export { CollapsibleCard }
