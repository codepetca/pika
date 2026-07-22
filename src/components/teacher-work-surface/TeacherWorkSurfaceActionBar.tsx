'use client'

import type { ReactNode } from 'react'
import { FloatingActionCluster } from '@/components/FloatingActionCluster'
import { cn } from '@/ui'

interface TeacherWorkSurfaceActionBarProps {
  label?: ReactNode
  center?: ReactNode
  trailing?: ReactNode
  className?: string
  labelClassName?: string
  centerClassName?: string
  centerPlacement?: 'inline' | 'floating'
  trailingClassName?: string
  testId?: string
}

export function TeacherWorkSurfaceFloatingActionCluster({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <FloatingActionCluster className={className}>
      {children}
    </FloatingActionCluster>
  )
}

export function TeacherWorkSurfaceActionBar({
  label,
  center,
  trailing,
  className,
  labelClassName,
  centerClassName,
  centerPlacement = 'inline',
  trailingClassName,
  testId,
}: TeacherWorkSurfaceActionBarProps) {
  const isCenterFloating = centerPlacement === 'floating'

  return (
    <div
      data-testid={testId}
      className={cn(
        'grid min-h-10 w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2',
        className,
      )}
    >
      <div className={cn('min-w-0 max-w-full overflow-hidden justify-self-start text-sm font-semibold text-text-default', labelClassName)}>
        {label}
      </div>
      {center ? (
        isCenterFloating ? (
          <TeacherWorkSurfaceFloatingActionCluster className={centerClassName}>
            {center}
          </TeacherWorkSurfaceFloatingActionCluster>
        ) : (
          <div className={cn('min-w-0 justify-self-center', centerClassName)}>
            {center}
          </div>
        )
      ) : (
        <div />
      )}
      <div className={cn('min-w-0 justify-self-end', trailingClassName)}>
        {trailing}
      </div>
    </div>
  )
}
