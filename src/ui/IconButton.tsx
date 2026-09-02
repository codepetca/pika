'use client'

import { forwardRef } from 'react'
import { LoaderCircle, type LucideIcon } from 'lucide-react'
import { Button, type ButtonProps } from './Button'
import { Tooltip } from './Tooltip'
import { cn } from './utils'

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'aria-label'> {
  label: string
  icon: LucideIcon
  tooltip?: string
}

/** A named, tooltip-backed icon action with a full-sized touch target. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, tooltip, icon: Icon, loading = false, disabled, className, type = 'button', ...props },
  ref,
) {
  return (
    <Tooltip content={tooltip ?? label}>
      <span className="inline-flex shrink-0">
        <Button
          {...props}
          ref={ref}
          type={type}
          aria-label={label}
          aria-busy={loading || undefined}
          disabled={disabled || loading}
          className={cn('h-11 w-11 p-0', className)}
        >
          {loading
            ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            : <Icon className="h-4 w-4" aria-hidden="true" />}
        </Button>
      </span>
    </Tooltip>
  )
})
