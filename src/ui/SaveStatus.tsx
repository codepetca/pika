'use client'

import type { HTMLAttributes } from 'react'
import { cn } from './utils'
import { CircularProgress } from './CircularProgress'

export type SaveStatusState = 'saved' | 'saving' | 'unsaved' | 'error'

export interface SaveStatusProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  status: SaveStatusState
  errorMessage?: string
  /** Quiet editor feedback: show a spinner only while saving; keep failures visible. */
  presentation?: 'text' | 'indicator'
}

const STATUS_LABELS: Record<Exclude<SaveStatusState, 'error'>, string> = {
  saved: 'Saved',
  saving: 'Saving…',
  unsaved: 'Unsaved',
}

export function SaveStatus({ status, errorMessage, presentation = 'text', className, ...props }: SaveStatusProps) {
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
        presentation === 'indicator' && status !== 'error' && 'inline-flex h-5 w-5 items-center justify-center',
        className,
      )}
    >
      {presentation === 'indicator' && status !== 'error' ? <>
        {status === 'saving' && <CircularProgress />}
        <span className="sr-only">{label}</span>
      </> : label}
    </span>
  )
}
