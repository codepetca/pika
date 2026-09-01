'use client'

import { useId } from 'react'
import { Button, cn, type ButtonProps } from '@/ui'

interface DateLabelContentProps {
  label: string
  subtitle?: string | null
  reserveSubtitleSpace?: boolean
  subtitleId?: string
}

export interface DateLabelButtonProps
  extends Omit<ButtonProps, 'aria-label' | 'children'>,
    DateLabelContentProps {
  ariaLabel: string
}

export function DateLabelContent({
  label,
  subtitle,
  reserveSubtitleSpace = false,
  subtitleId,
}: DateLabelContentProps) {
  const showSubtitleRow = Boolean(subtitle) || reserveSubtitleSpace

  return (
    <>
      <span className="max-w-full truncate leading-tight">{label}</span>
      {showSubtitleRow ? (
        <span
          id={subtitle ? subtitleId : undefined}
          aria-hidden={subtitle ? undefined : true}
          className="max-w-full truncate text-xs font-normal leading-4 text-text-muted"
        >
          {subtitle ?? '\u00a0'}
        </span>
      ) : null}
    </>
  )
}

/** Shared two-line date button used by Daily and assignment due dates. */
export function DateLabelButton({
  label,
  subtitle,
  reserveSubtitleSpace = false,
  ariaLabel,
  className,
  ...buttonProps
}: DateLabelButtonProps) {
  const subtitleId = useId()
  const showSubtitleRow = Boolean(subtitle) || reserveSubtitleSpace

  return (
    <Button
      {...buttonProps}
      aria-label={ariaLabel}
      aria-describedby={subtitle ? subtitleId : undefined}
      className={cn(
        'min-w-0 px-2 !py-1 text-sm font-semibold sm:text-base',
        showSubtitleRow && 'flex-col gap-0',
        className,
      )}
    >
      <DateLabelContent
        label={label}
        subtitle={subtitle}
        reserveSubtitleSpace={reserveSubtitleSpace}
        subtitleId={subtitleId}
      />
    </Button>
  )
}
