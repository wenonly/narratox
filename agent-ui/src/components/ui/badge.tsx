import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

/**
 * Badge / Tag — Token Spec §3.6. Pill-shaped label.
 * Variants: accent / neutral / success / warning / destructive.
 * Functional colors are RGB-channel-backed, so /15 opacity modifiers work.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap',
  {
    variants: {
      variant: {
        accent: 'bg-accent-primarySoft text-accent-violetLight',
        neutral: 'bg-overlay-10 text-text-tertiary',
        success: 'bg-success/15 text-success',
        warning: 'bg-warning/15 text-warningText',
        destructive: 'bg-destructive/15 text-destructive'
      }
    },
    defaultVariants: {
      variant: 'neutral'
    }
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
