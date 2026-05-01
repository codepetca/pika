'use client'

import type { ReactNode } from 'react'
import { Pencil } from 'lucide-react'
import { Button, Tooltip } from '@/ui'
import { cn } from '@/ui/utils'

interface TeacherEditModeControlsProps {
  active: boolean
  onActiveChange: (active: boolean) => void
  disabled?: boolean
  children?: ReactNode
  editLabel?: string
  className?: string
}

export function TeacherEditModeControls({
  active,
  onActiveChange,
  disabled = false,
  children,
  editLabel = 'Edit',
  className,
}: TeacherEditModeControlsProps) {
  return (
    <div className={cn('flex flex-wrap items-center justify-end gap-1.5', className)}>
      {active && children ? (
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {children}
        </div>
      ) : null}

      <Tooltip content={active ? 'Hide edit actions' : 'Show edit actions'}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            'min-h-10 px-3',
            active
              ? 'border-primary/40 bg-info-bg text-primary shadow-inner hover:bg-info-bg-hover hover:text-primary'
              : '',
          )}
          aria-pressed={active}
          disabled={disabled}
          onClick={() => onActiveChange(!active)}
        >
          <Pencil className="h-4 w-4" aria-hidden="true" />
          <span>{editLabel}</span>
        </Button>
      </Tooltip>
    </div>
  )
}
