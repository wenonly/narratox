'use client'

import { useTheme } from 'next-themes'
import { Toaster as Sonner } from 'sonner'

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-bg-card group-[.toaster]:text-text-primary group-[.toaster]:border-overlay-15 group-[.toaster]:shadow-lg',
          description: 'group-[.toast]:text-text-tertiary',
          actionButton:
            'group-[.toast]:bg-accent-primary group-[.toast]:text-white',
          cancelButton:
            'group-[.toast]:bg-bg-cardElevated group-[.toast]:text-text-primary'
        }
      }}
      {...props}
    />
  )
}

export { Toaster }
