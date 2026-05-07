'use client'

import type { ReactNode } from 'react'
import { cn } from '@/ui/utils'

const TEACHER_WORK_SURFACE_FLOATING_ACTION_CLUSTER_CLASS =
  'fixed left-1/2 top-[3.25rem] z-40 w-max max-w-[calc(100vw-1rem)] -translate-x-1/2 rounded-lg bg-surface/95 p-1 shadow-elevated backdrop-blur lg:left-[var(--main-content-center-x,50%)] lg:transition-[left] lg:duration-200 lg:ease-out'

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
    <div className={cn(TEACHER_WORK_SURFACE_FLOATING_ACTION_CLUSTER_CLASS, className)}>
      {children}
    </div>
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
