'use client'

import type { ReactNode } from 'react'
import { cn } from '@/ui/utils'

const FLOATING_ACTION_CLUSTER_CLASS =
  'fixed left-1/2 top-[3.25rem] z-40 w-max max-w-[calc(100vw-1rem)] -translate-x-1/2 rounded-lg bg-surface/95 p-1 shadow-elevated backdrop-blur lg:left-[var(--main-content-center-x,50%)] lg:transition-[left] lg:duration-200 lg:ease-out'

export function FloatingActionCluster({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn(FLOATING_ACTION_CLUSTER_CLASS, className)}>
      {children}
    </div>
  )
}
