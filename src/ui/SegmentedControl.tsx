'use client'

import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from './utils'
import { Tooltip } from './Tooltip'

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
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const activeIndex = options.findIndex((option) => option.value === value && !option.disabled)
  const firstEnabledIndex = options.findIndex((option) => !option.disabled)
  const tabbableIndex = activeIndex >= 0 ? activeIndex : firstEnabledIndex

  const activateIndex = (index: number) => {
    const option = options[index]
    if (!option || option.disabled) return
    optionRefs.current[index]?.focus()
    onChange(option.value)
  }

  const moveFrom = (index: number, direction: 1 | -1) => {
    if (options.length === 0) return
    for (let offset = 1; offset <= options.length; offset += 1) {
      const nextIndex = (index + offset * direction + options.length) % options.length
      if (!options[nextIndex]?.disabled) {
        activateIndex(nextIndex)
        return
      }
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      moveFrom(index, 1)
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveFrom(index, -1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      activateIndex(firstEnabledIndex)
    } else if (event.key === 'End') {
      event.preventDefault()
      const lastEnabledIndex = options.findLastIndex((option) => !option.disabled)
      activateIndex(lastEnabledIndex)
    }
  }

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
      {options.map((option, index) => {
        const isActive = option.value === value
        const button = (
          <button
            key={option.value}
            ref={(element) => {
              optionRefs.current[index] = element
            }}
            type="button"
            className={cn(
              'inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-control text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset',
              iconOnly ? 'h-11 w-11 px-0' : 'px-3 py-1 sm:text-sm',
              capitalizeLabels && !iconOnly ? 'capitalize' : '',
              isActive
                ? 'bg-info-bg text-primary'
                : 'text-text-muted hover:bg-surface-hover hover:text-text-default',
              option.disabled ? 'cursor-not-allowed opacity-50 hover:bg-transparent hover:text-text-muted' : '',
            )}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            disabled={option.disabled}
            tabIndex={index === tabbableIndex ? 0 : -1}
            aria-pressed={isActive}
            aria-label={option.label}
          >
            {option.icon ? (
              <span className="inline-flex h-4 w-4 items-center justify-center" aria-hidden="true">
                {option.icon}
              </span>
            ) : null}
            {iconOnly ? <span className="sr-only">{option.label}</span> : <span>{option.label}</span>}
          </button>
        )

        return iconOnly ? (
          <Tooltip key={option.value} content={option.label} side="top">
            {button}
          </Tooltip>
        ) : (
          button
        )
      })}
    </div>
  )
}
