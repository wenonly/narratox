import type { ReactNode } from 'react'

import AppSidebar from '@/components/layout/AppSidebar'

interface PageShellProps {
  active: 'library' | 'knowledge' | 'dissect' | 'settings'
  title: string
  /** Optional status/subtitle line below the title. */
  subtitle?: ReactNode
  /** Optional right-aligned header content (e.g. primary CTA button). */
  headerRight?: ReactNode
  children: ReactNode
}

/**
 * Shared route shell for library/knowledge/settings: bg-bg-darkest + AppSidebar
 * + main header. (Workspace uses IconRail; dissect is single-column — neither
 * uses PageShell.)
 */
const PageShell = ({
  active,
  title,
  subtitle,
  headerRight,
  children
}: PageShellProps) => (
  <div className="flex h-screen bg-bg-darkest">
    <AppSidebar active={active} />
    <main className="flex-1 overflow-y-auto p-8">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-lg font-semibold text-text-primary">{title}</h1>
          {subtitle ? (
            <div className="text-[11px] text-text-label">{subtitle}</div>
          ) : null}
        </div>
        {headerRight ? <div className="shrink-0">{headerRight}</div> : null}
      </header>
      {children}
    </main>
  </div>
)

export default PageShell
