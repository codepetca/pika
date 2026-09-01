'use client'

import type { ReactNode } from 'react'
import { cn } from '@/ui'

export function SettingsSwitch({
  checked,
  onChange,
  disabled,
  ariaLabel,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  ariaLabel: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'group relative h-11 w-14 shrink-0 rounded-control focus:outline-none focus-visible:ring-foundation focus-visible:ring-focus focus-visible:ring-offset-foundation',
        disabled ? 'cursor-not-allowed' : 'cursor-pointer',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-x-0 top-2 h-7 rounded-full border transition-colors',
          disabled
            ? 'border-border bg-surface-2'
            : checked
              ? 'border-primary bg-info-bg group-hover:border-primary-hover group-hover:bg-info-bg-hover'
              : 'border-border bg-surface-2 group-hover:bg-surface-hover',
        )}
      >
        <span
          className={cn(
            'absolute left-0 top-1 h-5 w-5 rounded-full bg-primary shadow-sm transition-transform',
            checked ? 'translate-x-7' : 'translate-x-1',
          )}
        />
      </span>
    </button>
  )
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
