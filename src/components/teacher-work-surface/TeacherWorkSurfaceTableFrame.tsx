'use client'

import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'
import { cn } from '@/ui'

interface TeacherWorkSurfaceTableFrameProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  selectionActive?: boolean
  className?: string
}

/**
 * Gives long teacher tables an internal scroll region and reserves bottom
 * scroll clearance only while a floating selection bar is visible.
 */
export const TeacherWorkSurfaceTableFrame = forwardRef<HTMLDivElement, TeacherWorkSurfaceTableFrameProps>(function TeacherWorkSurfaceTableFrame({
  children,
  selectionActive = false,
  className,
  ...props
}, ref) {
  return (
    <div
      {...props}
      ref={ref}
      className={cn(
        'min-h-48 flex-1 overflow-auto rounded-lg bg-surface',
        selectionActive && 'pb-32 sm:pb-20',
        className,
      )}
    >
      {children}
    </div>
  )
})
