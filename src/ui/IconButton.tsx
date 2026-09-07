'use client'

import { forwardRef, type ReactNode } from 'react'
import { LoaderCircle, type LucideIcon } from 'lucide-react'
import { Button, type ButtonProps } from './Button'
import { Tooltip } from './Tooltip'
import { cn } from './utils'

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'aria-label'> {
  label: string
  icon: LucideIcon
  tooltip?: ReactNode
  /** Opt in for help icons whose only action is showing their tooltip. */
  tooltipOnClick?: boolean
}

/** A named, tooltip-backed icon action with a full-sized touch target. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, tooltip, tooltipOnClick = false, icon: Icon, loading = false, disabled, className, type = 'button', ...props },
  ref,
) {
  const button = (
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
  )
  return (
    <Tooltip content={tooltip ?? label} openOnClick={tooltipOnClick}>
      {tooltipOnClick ? button : <span className="inline-flex shrink-0">{button}</span>}
    </Tooltip>
  )
})
