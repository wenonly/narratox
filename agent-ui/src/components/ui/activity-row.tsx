import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

/**
 * ActivityRow — Token Spec §3.8. A single streamed activity line in chat
 * or the dissect log drawer. Variants color-code the activity kind:
 *   think (purple) / tool (blue) / content (brand/white) / stage (brand).
 * Shared by chat Messages (Wave 2) and dissect LogDrawer (Wave 3).
 */
const activityRowVariants = cva(
  'flex items-start gap-2 rounded-lg bg-overlay-6 px-3 py-2.5',
  {
    variants: {
      variant: {
        think: '',
        tool: '',
        content: 'bg-transparent px-0 py-1',
        stage: ''
      }
    },
    defaultVariants: {
      variant: 'content'
    }
  }
)

const labelClassByVariant: Record<
  NonNullable<ActivityRowProps['variant']>,
  string
> = {
  think: 'text-accent-violetLight',
  tool: 'text-info',
  content: 'text-text-label',
  stage: 'text-accent-indigoLight'
}

const labelTextByVariant: Record<
  NonNullable<ActivityRowProps['variant']>,
  string
> = {
  think: 'think',
  tool: 'tool',
  content: '',
  stage: 'stage'
}

export interface ActivityRowProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'>,
    VariantProps<typeof activityRowVariants> {
  label?: string
  children?: React.ReactNode
}

const ActivityRow = React.forwardRef<HTMLDivElement, ActivityRowProps>(
  ({ className, variant = 'content', label, children, ...props }, ref) => {
    const resolvedVariant = variant ?? 'content'
    const labelText = label ?? labelTextByVariant[resolvedVariant]
    return (
      <div
        ref={ref}
        className={cn(activityRowVariants({ variant }), className)}
        {...props}
      >
        {labelText ? (
          <span
            className={cn(
              'shrink-0 text-[11px] font-semibold uppercase tracking-wide',
              labelClassByVariant[resolvedVariant]
            )}
          >
            {labelText}
          </span>
        ) : null}
        <div className="min-w-0 flex-1 text-[11px] leading-relaxed text-text-tertiary">
          {children}
        </div>
      </div>
    )
  }
)
ActivityRow.displayName = 'ActivityRow'

export { ActivityRow, activityRowVariants }
