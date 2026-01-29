'use client'

import { type ReactNode } from 'react'
import { useThreePanel } from './ThreePanelProvider'
import { MAIN_CONTENT_MAX_WIDTHS } from '@/lib/layout-config'

export interface MainContentProps {
  children: ReactNode
  className?: string
  /** Override the config's max-width */
  maxWidth?: keyof typeof MAIN_CONTENT_MAX_WIDTHS
}

/**
 * Main content area with configurable max-width.
 * Uses the layout config's maxWidth setting by default.
 */
export function MainContent({ children, className, maxWidth }: MainContentProps) {
  const { config } = useThreePanel()

  const maxWidthClass = MAIN_CONTENT_MAX_WIDTHS[maxWidth ?? config.mainContent.maxWidth]

  return (
    <main
      className={[
        'flex-1 min-w-0 min-h-0',
        'px-4 pt-2 pb-3',
        'flex flex-col',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div
        className={[
          'mx-auto w-full h-full',
          'flex flex-col min-h-0',
          maxWidthClass,
        ].join(' ')}
      >
        {children}
      </div>
    </main>
  )
}
