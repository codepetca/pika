'use client'

import type { ReactNode } from 'react'
import { cn } from '@/ui/utils'

interface TeacherWorkSurfaceActionBarProps {
  label?: ReactNode
  center?: ReactNode
  trailing?: ReactNode
  className?: string
  labelClassName?: string
  centerClassName?: string
  trailingClassName?: string
  testId?: string
}

export function TeacherWorkSurfaceActionBar({
  label,
  center,
  trailing,
  className,
  labelClassName,
  centerClassName,
  trailingClassName,
  testId,
}: TeacherWorkSurfaceActionBarProps) {
  return (
    <div
      data-testid={testId}
      className={cn(
        'grid min-h-10 w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2',
        className,
      )}
    >
      <div className={cn('min-w-0 max-w-full overflow-hidden justify-self-start', labelClassName)}>
        {label}
      </div>
      <div className={cn('min-w-0 justify-self-center', centerClassName)}>
        {center}
      </div>
      <div className={cn('min-w-0 justify-self-end', trailingClassName)}>
        {trailing}
      </div>
    </div>
  )
}
