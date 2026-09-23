'use client'

import type { ReactNode } from 'react'
import { Tooltip, cn } from '@/ui'

export function SettingsSwitch({
  checked,
  onChange,
  disabled,
  ariaLabel,
  tooltip,
  checkedTone = 'default',
  checkedIcon,
  uncheckedIcon,
  retainCheckedToneWhenDisabled = false,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  ariaLabel: string
  tooltip?: ReactNode
  checkedTone?: 'default' | 'success'
  checkedIcon?: ReactNode
  uncheckedIcon?: ReactNode
  retainCheckedToneWhenDisabled?: boolean
}) {
  const hasIcon = Boolean(checkedIcon || uncheckedIcon)
  const retainCheckedTone = disabled && checked && retainCheckedToneWhenDisabled
  const control = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'group relative h-11 shrink-0 rounded-control focus:outline-none focus-visible:ring-foundation focus-visible:ring-focus focus-visible:ring-offset-foundation',
        hasIcon ? 'w-16' : 'w-14',
        disabled ? 'cursor-not-allowed' : 'cursor-pointer',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-x-0 rounded-full border transition-colors',
          hasIcon ? 'top-1.5 h-8' : 'top-2 h-7',
          disabled && !retainCheckedTone
            ? 'border-border bg-surface-2'
            : checked
              ? checkedTone === 'success'
                ? 'border-success bg-success-solid group-hover:bg-success-solid-hover'
                : 'border-primary bg-info-bg group-hover:border-primary-hover group-hover:bg-info-bg-hover'
              : 'border-border bg-surface-2 group-hover:bg-surface-hover',
        )}
      >
        {uncheckedIcon && !checked ? (
          <span className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center">
            {uncheckedIcon}
          </span>
        ) : null}
        <span
          className={cn(
            'absolute left-0 top-1 inline-flex items-center justify-center rounded-full shadow-sm transition-transform',
            hasIcon ? 'h-6 w-6' : 'h-5 w-5',
            checked && checkedTone === 'success'
              ? 'bg-surface'
              : hasIcon && !checked
                ? 'bg-text-muted'
                : 'bg-primary',
            checked ? (hasIcon ? 'translate-x-9' : 'translate-x-7') : 'translate-x-1',
          )}
        >
          {checked ? checkedIcon : null}
        </span>
      </span>
    </button>
  )

  return tooltip ? <Tooltip content={tooltip}>{control}</Tooltip> : control
}

export function SettingsSwitchRow({
  checked,
  onChange,
  disabled,
  ariaLabel,
  children,
  className,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  ariaLabel: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <SettingsSwitch checked={checked} onChange={onChange} disabled={disabled} ariaLabel={ariaLabel} />
      <div className={cn('min-w-0 text-sm', disabled ? 'text-text-muted' : 'text-text-default')}>{children}</div>
    </div>
  )
}
