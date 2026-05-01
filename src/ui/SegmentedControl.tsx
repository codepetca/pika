'use client'

import type { ReactNode } from 'react'
import { cn } from './utils'

export interface SegmentedControlOption<TValue extends string> {
  value: TValue
  label: string
  icon?: ReactNode
  disabled?: boolean
}

export interface SegmentedControlProps<TValue extends string> {
  ariaLabel: string
  value: TValue
  options: Array<SegmentedControlOption<TValue>>
  onChange: (value: TValue) => void
  iconOnly?: boolean
  capitalizeLabels?: boolean
  className?: string
  testId?: string
}

export function SegmentedControl<TValue extends string>({
  ariaLabel,
  value,
  options,
  onChange,
  iconOnly = false,
  capitalizeLabels = false,
  className,
  testId,
}: SegmentedControlProps<TValue>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-testid={testId}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-control bg-surface-2 p-0.5',
        className,
      )}
    >
      {options.map((option) => {
        const isActive = option.value === value

        return (
          <button
            key={option.value}
            type="button"
            className={cn(
              'inline-flex items-center justify-center gap-1.5 rounded-control text-xs font-medium transition-colors',
              iconOnly ? 'h-8 w-8 px-0' : 'px-3 py-1 sm:text-sm',
              capitalizeLabels && !iconOnly ? 'capitalize' : '',
              isActive
                ? 'bg-info-bg text-primary'
                : 'text-text-muted hover:bg-surface-hover hover:text-text-default',
              option.disabled ? 'cursor-not-allowed opacity-50 hover:bg-transparent hover:text-text-muted' : '',
            )}
            onClick={() => onChange(option.value)}
            disabled={option.disabled}
            aria-pressed={isActive}
            aria-label={option.label}
            title={iconOnly ? option.label : undefined}
          >
            {option.icon ? (
              <span className="inline-flex h-4 w-4 items-center justify-center" aria-hidden="true">
                {option.icon}
              </span>
            ) : null}
            {iconOnly ? <span className="sr-only">{option.label}</span> : <span>{option.label}</span>}
          </button>
        )
      })}
    </div>
  )
}
