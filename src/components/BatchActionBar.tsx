'use client'

import type { ReactNode } from 'react'
import { Check } from 'lucide-react'

interface BatchActionBarProps {
  selectedCount: number
  children: ReactNode
}

export function BatchActionBar({ selectedCount, children }: BatchActionBarProps) {
  if (selectedCount === 0) return null

  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-info-bg border border-primary rounded-md text-sm">
      <span className="inline-flex items-center gap-1 font-medium text-info">
        {selectedCount} <Check className="w-4 h-4" />
      </span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}
