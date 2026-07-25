'use client'

import type { HTMLAttributes } from 'react'
import { cn } from './utils'

export type SaveStatusState = 'saved' | 'saving' | 'unsaved' | 'error'

export interface SaveStatusProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  status: SaveStatusState
  errorMessage?: string
}

const STATUS_LABELS: Record<Exclude<SaveStatusState, 'error'>, string> = {
  saved: 'Saved',
  saving: 'Saving…',
  unsaved: 'Unsaved',
}

export function SaveStatus({ status, errorMessage, className, ...props }: SaveStatusProps) {
  const label = status === 'error' ? errorMessage || 'Save failed' : STATUS_LABELS[status]

  return (
    <span
      role="status"
      aria-live="polite"
      aria-atomic="true"
      {...props}
      className={cn(
        'shrink-0 text-xs font-medium',
        status === 'saved' && 'text-success',
        status === 'saving' && 'text-text-muted',
        status === 'unsaved' && 'text-warning',
        status === 'error' && 'text-danger',
        className,
      )}
    >
      {label}
    </span>
  )
}
