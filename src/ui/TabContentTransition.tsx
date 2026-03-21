'use client'

import type { ReactNode } from 'react'

interface TabContentTransitionProps {
  isActive: boolean
  children: ReactNode
  className?: string
}

export function TabContentTransition({
  isActive,
  children,
  className = '',
}: TabContentTransitionProps) {
  return (
    <div
      aria-hidden={!isActive}
      className={[
        'transition-opacity duration-150 motion-reduce:transition-none',
        isActive ? 'flex min-h-0 flex-1 flex-col opacity-100' : 'hidden opacity-0',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  )
}
