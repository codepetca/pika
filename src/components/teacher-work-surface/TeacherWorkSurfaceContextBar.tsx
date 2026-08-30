'use client'

import type { ReactNode } from 'react'
import { cn } from '@/ui'

interface TeacherWorkSurfaceContextBarProps {
  ariaLabel: string
  context?: ReactNode
  primary: ReactNode
  summary?: ReactNode
  actions?: ReactNode
  className?: string
  contextClassName?: string
  primaryClassName?: string
  primaryChrome?: 'floating' | 'none'
  trailingClassName?: string
  testId?: string
}

/**
 * Shared one-row hierarchy for teacher operational work surfaces.
 *
 * Feature code owns the labels, metrics, actions, and business state. This
 * component only keeps quiet context at the edges and the primary control
 * mathematically centered in normal document flow.
 */
export function TeacherWorkSurfaceContextBar({
  ariaLabel,
  context,
  primary,
  summary,
  actions,
  className,
  contextClassName,
  primaryClassName,
  primaryChrome = 'floating',
  trailingClassName,
  testId,
}: TeacherWorkSurfaceContextBarProps) {
  return (
    <section
      aria-label={ariaLabel}
      data-testid={testId}
      className={cn(
        'relative z-floating grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1 px-2 py-1 sm:gap-2 sm:px-3',
        className,
      )}
    >
      <div
        className={cn(
          'min-w-0 justify-self-start overflow-hidden text-xs text-text-muted sm:text-sm',
          contextClassName,
        )}
      >
        {context}
      </div>
      <div
        className={cn(
          'min-w-0 justify-self-center',
          primaryChrome === 'floating' && 'rounded-lg bg-surface/95 shadow-elevated backdrop-blur',
          primaryClassName,
        )}
      >
        {primary}
      </div>
      <div
        className={cn(
          'flex min-w-0 items-center justify-self-end overflow-visible',
          trailingClassName,
        )}
      >
        {summary ? <div className="hidden min-w-0 items-center xl:flex">{summary}</div> : null}
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>
    </section>
  )
}
