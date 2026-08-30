'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useId } from 'react'
import { Button, cn } from '@/ui'

export interface DateNavigatorProps {
  label: string
  subtitle?: string | null
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
  subtitle,
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
  const subtitleId = useId()

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
            'min-w-0 px-2 py-1 text-sm font-semibold sm:text-base',
            subtitle && 'flex-col gap-0',
            joined && 'rounded-none border-0',
            labelClassName,
          )}
          aria-label={labelAriaLabel}
          aria-describedby={subtitle ? subtitleId : undefined}
        >
          <span className="max-w-full truncate leading-tight">{label}</span>
          {subtitle ? (
            <span id={subtitleId} className="max-w-full truncate text-xs font-normal leading-none text-text-muted">
              {subtitle}
            </span>
          ) : null}
        </Button>
      ) : (
        <span
          className={cn(
            'min-w-0 px-2 py-1 text-sm font-semibold text-text-default sm:text-base',
            subtitle && 'flex flex-col items-center gap-0',
            joined && 'flex min-h-control items-center justify-center',
            labelClassName,
          )}
        >
          <span className="max-w-full truncate leading-tight">{label}</span>
          {subtitle ? (
            <span className="max-w-full truncate text-xs font-normal leading-none text-text-muted">
              {subtitle}
            </span>
          ) : null}
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
