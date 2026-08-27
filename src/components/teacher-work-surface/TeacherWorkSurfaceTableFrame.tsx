'use client'

import type { ReactNode } from 'react'
import { cn } from '@/ui'

interface TeacherWorkSurfaceTableFrameProps {
  children: ReactNode
  selectionActive?: boolean
  className?: string
}

/**
 * Gives long teacher tables an internal scroll region and reserves bottom
 * scroll clearance only while a floating selection bar is visible.
 */
export function TeacherWorkSurfaceTableFrame({
  children,
  selectionActive = false,
  className,
}: TeacherWorkSurfaceTableFrameProps) {
  return (
    <div
      className={cn(
        'min-h-48 flex-1 overflow-auto rounded-lg bg-surface',
        selectionActive && 'pb-32 sm:pb-20',
        className,
      )}
    >
      {children}
    </div>
  )
}
