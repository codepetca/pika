'use client'

import type { ReactNode } from 'react'
import { Check, Pencil } from 'lucide-react'
import { Button, Tooltip } from '@/ui'
import { cn } from '@/ui/utils'

interface TeacherEditModeControlsProps {
  active: boolean
  onActiveChange: (active: boolean) => void
  disabled?: boolean
  children?: ReactNode
  editLabel?: string
  doneLabel?: string
  className?: string
}

export function TeacherEditModeControls({
  active,
  onActiveChange,
  disabled = false,
  children,
  editLabel = 'Edit',
  doneLabel = 'Done',
  className,
}: TeacherEditModeControlsProps) {
  const Icon = active ? Check : Pencil
  const label = active ? doneLabel : editLabel

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
          variant={active ? 'secondary' : 'ghost'}
          size="sm"
          className="min-h-10 px-3"
          aria-pressed={active}
          disabled={disabled}
          onClick={() => onActiveChange(!active)}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
          <span>{label}</span>
        </Button>
      </Tooltip>
    </div>
  )
}
