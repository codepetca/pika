'use client'

import type { ReactNode } from 'react'

interface BatchActionBarProps {
  selectedCount: number
  children: ReactNode
}

export function BatchActionBar({ selectedCount, children }: BatchActionBarProps) {
  if (selectedCount === 0) return null

  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-info-bg border border-primary rounded-md text-sm">
      <span className="font-medium text-info">{selectedCount} selected</span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}
