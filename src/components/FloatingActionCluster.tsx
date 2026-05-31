'use client'

import type { ComponentPropsWithoutRef } from 'react'
import { cn } from '@/ui/utils'

const FLOATING_ACTION_CLUSTER_CLASSES = {
  top: 'fixed left-1/2 top-[3.25rem] z-40 w-max max-w-[calc(100vw-1rem)] -translate-x-1/2 rounded-lg bg-surface/95 p-1 shadow-elevated backdrop-blur lg:left-[var(--main-content-center-x,50%)] lg:transition-[left] lg:duration-200 lg:ease-out',
  bottom: 'fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 z-40 w-[calc(100vw-3.5rem)] max-w-[40.5rem] -translate-x-1/2 rounded-lg bg-surface/95 py-2 pl-3 pr-1 shadow-elevated backdrop-blur',
} as const

interface FloatingActionClusterProps extends ComponentPropsWithoutRef<'div'> {
  placement?: keyof typeof FLOATING_ACTION_CLUSTER_CLASSES
}

export function FloatingActionCluster({
  children,
  className,
  placement = 'top',
  ...props
}: FloatingActionClusterProps) {
  return (
    <div
      {...props}
      className={cn(FLOATING_ACTION_CLUSTER_CLASSES[placement], className)}
    >
      {children}
    </div>
  )
}
