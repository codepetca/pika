'use client'

import { useId, type ReactNode, type Ref } from 'react'
import { CreationModalShell } from '@/components/creation/CreationModalShell'
import { Button, FormField, Input, SplitButton, type SplitButtonProps } from '@/ui'
import { cn } from '@/ui/utils'

type ClassworkContentModalShellProps = {
  isOpen: boolean
  title: string
  titleId: string
  closeLabel: string
  closeDisabled?: boolean
  maxWidth?: string
  contentClassName?: string
  onClose: () => void
  children: ReactNode
}

type ClassworkModalTopLineProps = {
  title: string
  titleLabel?: string
  titlePlaceholder: string
  titleError?: string
  titleRequired?: boolean
  titleDisabled?: boolean
  titleInputRef?: Ref<HTMLInputElement>
  titleMaxLength?: number
  titleInputClassName?: string
  titleFieldClassName?: string
  titleStatus?: ReactNode
  meta?: ReactNode
  secondaryActions?: ReactNode
  primaryActions?: ReactNode
  className?: string
  onTitleChange: (value: string) => void
  onTitleBlur?: () => void
}

type ClassworkModalTopLineFieldProps = {
  label: ReactNode
  required?: boolean
  tone?: 'default' | 'muted' | 'primary' | 'warning'
  trailing?: ReactNode
  className?: string
  labelClassName?: string
  controlClassName?: string
  children: ReactNode
}

type ClassworkModalActionIntent = 'publish' | 'primary'
export type ClassworkModalSaveStatusValue = 'saved' | 'saving' | 'unsaved'

type ClassworkModalSplitActionProps = Omit<SplitButtonProps, 'variant'> & {
  intent?: ClassworkModalActionIntent
  variant?: SplitButtonProps['variant']
}

type ClassworkModalPrimaryButtonProps = {
  children: ReactNode
  intent?: ClassworkModalActionIntent
  disabled?: boolean
  className?: string
  onClick: () => void
}

type ClassworkModalSaveStatusProps = {
  status: ClassworkModalSaveStatusValue
  labels?: Partial<Record<ClassworkModalSaveStatusValue, string>>
  className?: string
}

const TOP_LINE_FIELD_TONE_CLASS = {
  default: 'text-text-default',
  muted: 'text-text-muted',
  primary: 'text-primary',
  warning: 'text-warning',
} as const

const ACTION_INTENT_VARIANT = {
  publish: 'success',
  primary: 'primary',
} as const

const SAVE_STATUS_TONE_CLASS = {
  saved: 'text-success',
  saving: 'text-text-muted',
  unsaved: 'text-warning',
} as const

const SAVE_STATUS_LABEL = {
  saved: 'Saved',
  saving: 'Saving...',
  unsaved: 'Unsaved',
} as const

export function ClassworkContentModalShell({
  isOpen,
  title,
  titleId,
  closeLabel,
  closeDisabled,
  maxWidth,
  contentClassName,
  onClose,
  children,
}: ClassworkContentModalShellProps) {
  return (
    <CreationModalShell
      isOpen={isOpen}
      title={title}
      titleId={titleId}
      closeLabel={closeLabel}
      closeDisabled={closeDisabled}
      maxWidth={maxWidth}
      contentClassName={contentClassName}
      onClose={onClose}
    >
      {children}
    </CreationModalShell>
  )
}

export function ClassworkModalTopLine({
  title,
  titleLabel = 'Title',
  titlePlaceholder,
  titleError,
  titleRequired = true,
  titleDisabled = false,
  titleInputRef,
  titleMaxLength,
  titleInputClassName,
  titleFieldClassName,
  titleStatus,
  meta,
  secondaryActions,
  primaryActions,
  className,
  onTitleChange,
  onTitleBlur,
}: ClassworkModalTopLineProps) {
  const titleFieldId = useId()
  const titleErrorId = titleError ? `${titleFieldId}-error` : undefined
  const titleInput = (
    <Input
      ref={titleInputRef}
      id={titleFieldId}
      type="text"
      value={title}
      onChange={(event) => onTitleChange(event.target.value)}
      onBlur={onTitleBlur}
      required={titleRequired}
      disabled={titleDisabled}
      maxLength={titleMaxLength}
      placeholder={titlePlaceholder}
      hasError={Boolean(titleError)}
      aria-invalid={titleError ? 'true' : undefined}
      aria-describedby={titleErrorId}
      className={titleInputClassName}
    />
  )

  return (
    <div className={cn('flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end', className)}>
      {titleStatus ? (
        <div className={cn('min-w-56 flex-1', titleFieldClassName)}>
          <div className="mb-1 flex min-h-5 items-center justify-between gap-2">
            <label htmlFor={titleFieldId} className="block text-sm font-medium text-text-default">
              {titleLabel}
              {titleRequired && <span className="ml-1 text-danger">*</span>}
            </label>
            <div className="min-w-0 shrink-0">
              {titleStatus}
            </div>
          </div>
          {titleInput}
          {titleError && (
            <p id={titleErrorId} className="mt-1 text-sm text-danger" role="alert">
              {titleError}
            </p>
          )}
        </div>
      ) : (
        <FormField
          label={titleLabel}
          required={titleRequired}
          error={titleError}
          className={cn('min-w-56 flex-1', titleFieldClassName)}
        >
          {titleInput}
        </FormField>
      )}

      {meta && <div className="min-w-0 lg:shrink-0">{meta}</div>}

      {secondaryActions && (
        <div className="flex min-w-0 flex-wrap items-end gap-2 lg:shrink-0">
          {secondaryActions}
        </div>
      )}

      {primaryActions && (
        <div className="flex min-w-0 flex-wrap items-end justify-end gap-2 lg:shrink-0">
          {primaryActions}
        </div>
      )}
    </div>
  )
}

export function ClassworkModalTopLineField({
  label,
  required = false,
  tone = 'default',
  trailing,
  className,
  labelClassName,
  controlClassName,
  children,
}: ClassworkModalTopLineFieldProps) {
  return (
    <div className={cn('w-full space-y-1', className)}>
      <div
        className={cn(
          'flex min-h-5 items-center justify-between gap-2 text-sm font-medium',
          TOP_LINE_FIELD_TONE_CLASS[tone],
          labelClassName
        )}
      >
        <span className="min-w-0 truncate">
          {label}
          {required && <span className="ml-1 text-danger">*</span>}
        </span>
        {trailing ? <span className="shrink-0">{trailing}</span> : null}
      </div>
      <div className={cn('flex min-h-9 items-center', controlClassName)}>
        {children}
      </div>
    </div>
  )
}

export function ClassworkModalSplitAction({
  intent = 'primary',
  variant,
  size = 'md',
  menuPlacement = 'down',
  primaryButtonProps,
  ...props
}: ClassworkModalSplitActionProps) {
  const { className: primaryClassName, ...restPrimaryButtonProps } = primaryButtonProps ?? {}

  return (
    <SplitButton
      variant={variant ?? ACTION_INTENT_VARIANT[intent]}
      size={size}
      menuPlacement={menuPlacement}
      primaryButtonProps={{
        ...restPrimaryButtonProps,
        className: cn('min-w-[5.75rem] justify-center font-semibold', primaryClassName),
      }}
      {...props}
    />
  )
}

export function ClassworkModalPrimaryButton({
  children,
  intent = 'primary',
  disabled,
  className,
  onClick,
}: ClassworkModalPrimaryButtonProps) {
  return (
    <Button
      type="button"
      variant={ACTION_INTENT_VARIANT[intent]}
      className={cn('min-w-[7.75rem] justify-center whitespace-nowrap font-semibold', className)}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

export function ClassworkModalSaveStatus({
  status,
  labels,
  className,
}: ClassworkModalSaveStatusProps) {
  return (
    <span className={cn('text-xs', SAVE_STATUS_TONE_CLASS[status], className)}>
      {labels?.[status] ?? SAVE_STATUS_LABEL[status]}
    </span>
  )
}
