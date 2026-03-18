'use client'

import { type ReactNode } from 'react'
import { useThreePanel } from './ThreePanelProvider'
import { MAIN_CONTENT_MAX_WIDTHS } from '@/lib/layout-config'
import type { PageDensity } from '@/components/PageLayout'

export interface MainContentProps {
  children: ReactNode
  className?: string
  /** Override the config's max-width */
  maxWidth?: keyof typeof MAIN_CONTENT_MAX_WIDTHS
  density?: PageDensity
}

/**
 * Main content area with configurable max-width.
 * Uses the layout config's maxWidth setting by default.
 */
export function MainContent({ children, className, maxWidth, density = 'default' }: MainContentProps) {
  const { config } = useThreePanel()

  const maxWidthClass = MAIN_CONTENT_MAX_WIDTHS[maxWidth ?? config.mainContent.maxWidth]
  const spacingClass =
    density === 'teacher'
      ? 'px-3 pb-3'
      : density === 'student'
        ? 'px-4 pb-4'
        : 'px-4 pb-3'

  return (
    <main
      className={[
        'flex-1 min-w-0 min-h-0',
        spacingClass,
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
