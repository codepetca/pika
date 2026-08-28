'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button, cn } from '@/ui'

export interface DateNavigatorProps {
  label: string
  onPrev?: () => void
  onNext?: () => void
  onLabelClick?: () => void
  showNavigation?: boolean
  labelAriaLabel?: string
  prevAriaLabel?: string
  nextAriaLabel?: string
  className?: string
  labelClassName?: string
  joined?: boolean
}

/**
 * Shared date-scope control for classroom work surfaces.
 *
 * Callers own date calculations and picker behavior. This component owns only
 * the consistent previous/label/next control geometry and accessible labels.
 */
export function DateNavigator({
  label,
  onPrev,
  onNext,
  onLabelClick,
  showNavigation = true,
  labelAriaLabel = 'Go to today',
  prevAriaLabel = 'Previous',
  nextAriaLabel = 'Next',
  className,
  labelClassName,
  joined = false,
}: DateNavigatorProps) {
  return (
    <div
      className={cn(
        'flex min-w-0 items-center',
        joined
          ? 'overflow-hidden rounded-control border border-border-strong bg-surface'
          : 'gap-1 sm:gap-2',
        className,
      )}
    >
      {showNavigation ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            'h-9 w-9 px-0',
            joined && 'rounded-none border-0 border-r border-border',
          )}
          onClick={onPrev}
          aria-label={prevAriaLabel}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
      ) : null}

      {onLabelClick ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onLabelClick}
          className={cn(
            'min-w-0 truncate px-2 py-1 text-sm font-semibold sm:text-base',
            joined && 'rounded-none border-0',
            labelClassName,
          )}
          aria-label={labelAriaLabel}
        >
          {label}
        </Button>
      ) : (
        <span
          className={cn(
            'min-w-0 truncate px-2 py-1 text-sm font-semibold text-text-default sm:text-base',
            joined && 'flex min-h-control items-center',
            labelClassName,
          )}
        >
          {label}
        </span>
      )}

      {showNavigation ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            'h-9 w-9 px-0',
            joined && 'rounded-none border-0 border-l border-border',
          )}
          onClick={onNext}
          aria-label={nextAriaLabel}
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  )
}
