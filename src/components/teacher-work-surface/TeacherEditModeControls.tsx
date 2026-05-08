'use client'

import type { ReactNode } from 'react'
import { Pencil } from 'lucide-react'
import { Button, Tooltip, type ButtonProps } from '@/ui'
import { cn } from '@/ui/utils'

interface TeacherEditModeControlsProps {
  active: boolean
  onActiveChange: (active: boolean) => void
  disabled?: boolean
  children?: ReactNode
  editLabel?: string
  variant?: NonNullable<ButtonProps['variant']>
  className?: string
}

export function TeacherEditModeControls({
  active,
  onActiveChange,
  disabled = false,
  children,
  editLabel = 'Edit',
  variant = 'ghost',
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
          variant={variant}
          size="sm"
          aria-label={editLabel}
          title={editLabel}
          className={cn(
            'h-9 w-9 px-0',
            active
              ? 'border-primary/40 bg-info-bg text-primary shadow-inner hover:bg-info-bg-hover hover:text-primary'
              : '',
          )}
          aria-pressed={active}
          disabled={disabled}
          onClick={() => onActiveChange(!active)}
        >
          <Pencil className="h-4 w-4" aria-hidden="true" />
        </Button>
      </Tooltip>
    </div>
  )
}
