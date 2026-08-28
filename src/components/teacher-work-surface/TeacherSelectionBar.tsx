'use client'

import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { FloatingActionCluster } from '@/components/FloatingActionCluster'
import { Button, cn } from '@/ui'

interface TeacherSelectionBarProps {
  selectedCount: number
  children: ReactNode
  onClear: () => void
  ariaLabel?: string
  selectionLabel?: ReactNode
  clearAriaLabel?: string
  clearDisabled?: boolean
  className?: string
}

/**
 * Shared bottom action surface for bulk operations on selected teacher rows.
 * Domain actions remain feature-owned children.
 */
export function TeacherSelectionBar({
  selectedCount,
  children,
  onClear,
  ariaLabel = 'Selection actions',
  selectionLabel,
  clearAriaLabel = 'Clear selection',
  clearDisabled = false,
  className,
}: TeacherSelectionBarProps) {
  if (selectedCount < 1) return null

  return (
    <FloatingActionCluster
      placement="bottom"
      className={cn('flex flex-wrap items-center justify-center gap-1', className)}
      role="toolbar"
      aria-label={ariaLabel}
    >
      <span className="px-2 text-sm font-semibold text-text-default">
        {selectionLabel ?? `${selectedCount} selected`}
      </span>
      {children}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={clearDisabled}
        onClick={onClear}
        aria-label={clearAriaLabel}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </Button>
    </FloatingActionCluster>
  )
}
