'use client'

import { useId, useRef, type ReactNode, type Ref } from 'react'
import { Eye } from 'lucide-react'
import { CreationModalShell } from '@/components/creation/CreationModalShell'
import { DateActionBar } from '@/components/DateActionBar'
import { ACTIONBAR_BUTTON_CLASSNAME } from '@/components/PageLayout'
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

type DateTimeFieldsProps = {
  label: string
  date: string
  time: string
  disabled?: boolean
  required?: boolean
  error?: string | null
  dateLabel?: string
  timeLabel?: string
  className?: string
  trailing?: ReactNode
  onDateChange: (next: string) => void
  onTimeChange: (next: string) => void
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

type ClassworkModalPreviewButtonProps = {
  onClick: () => void
  disabled?: boolean
  active?: boolean
  label?: string
  className?: string
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

type ClassworkModalSurveyDueFieldsProps = {
  dueDate: string
  dueTime: string
  disabled?: boolean
  onDueDateChange: (next: string) => void
  onDueTimeChange: (next: string) => void
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

function formatTimeLabel(value: string): string {
  const [hourPart, minutePart] = value.split(':')
  const hour = Number(hourPart)
  const minute = Number(minutePart)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 'Select time'

  const period = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 || 12
  return `${displayHour}:${String(minute).padStart(2, '0')} ${period}`
}

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

export function ClassworkModalPreviewButton({
  onClick,
  disabled,
  active = false,
  label = 'Preview',
  className,
}: ClassworkModalPreviewButtonProps) {
  return (
    <Button
      type="button"
      variant={active ? 'primary' : 'secondary'}
      size="sm"
      onClick={onClick}
      disabled={disabled}
      className={cn('h-9 w-9 px-0 sm:w-auto sm:px-3 sm:gap-1.5', className)}
      aria-label={label}
    >
      <Eye className="h-4 w-4" aria-hidden="true" />
      <span className="hidden sm:inline">{label}</span>
    </Button>
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

export function ClassworkContentModalTopRow(props: ClassworkModalTopLineProps) {
  return <ClassworkModalTopLine {...props} />
}

function ClassworkModalTimeAction({
  value,
  disabled,
  onChange,
}: {
  value: string
  disabled?: boolean
  onChange: (next: string) => void
}) {
  const timeInputRef = useRef<HTMLInputElement>(null)
  const timeInputId = useId()

  return (
    <div>
      <label className="sr-only" htmlFor={timeInputId}>
        Time
      </label>
      <input
        ref={timeInputRef}
        id={timeInputId}
        type="time"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="sr-only"
        tabIndex={-1}
      />
      <button
        type="button"
        className={cn(ACTIONBAR_BUTTON_CLASSNAME, 'w-[6.75rem] text-center sm:w-[8.25rem]')}
        disabled={disabled}
        onClick={() => timeInputRef.current?.showPicker()}
      >
        {formatTimeLabel(value)}
      </button>
    </div>
  )
}

export function ClassworkModalSurveyDueFields({
  dueDate,
  dueTime,
  disabled,
  onDueDateChange,
  onDueTimeChange,
}: ClassworkModalSurveyDueFieldsProps) {
  return (
    <div className="min-w-0 lg:w-[18rem]">
      <ClassworkModalTopLineField
        label="Due"
        required
        className="min-w-0"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <DateActionBar
            value={dueDate}
            onChange={onDueDateChange}
            layout="compact"
            disabled={disabled}
          />
          <ClassworkModalTimeAction
            value={dueTime}
            disabled={disabled}
            onChange={onDueTimeChange}
          />
        </div>
      </ClassworkModalTopLineField>
    </div>
  )
}

export function DateTimeFields({
  label,
  date,
  time,
  disabled,
  required = false,
  error,
  dateLabel = 'Date',
  timeLabel = 'Time',
  className,
  trailing,
  onDateChange,
  onTimeChange,
}: DateTimeFieldsProps) {
  const dateInputId = useId()
  const timeInputId = useId()

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex min-h-5 items-center justify-between gap-2">
        <span className="text-sm font-medium text-text-default">
          {label}
          {required && <span className="ml-1 text-danger">*</span>}
        </span>
        {trailing}
      </div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9.5rem]">
        <div>
          <label htmlFor={dateInputId} className="sr-only">
            {dateLabel}
          </label>
          <input
            id={dateInputId}
            type="date"
            value={date}
            required={required}
            disabled={disabled}
            onChange={(event) => onDateChange(event.target.value)}
            className="h-10 w-full rounded-control border border-border bg-surface px-3 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-surface-2 disabled:opacity-60"
          />
        </div>
        <div>
          <label htmlFor={timeInputId} className="sr-only">
            {timeLabel}
          </label>
          <input
            id={timeInputId}
            type="time"
            value={time}
            required={required}
            disabled={disabled}
            onChange={(event) => onTimeChange(event.target.value)}
            className="h-10 w-full rounded-control border border-border bg-surface px-3 text-sm text-text-default focus:outline-none focus:ring-2 focus:ring-primary disabled:bg-surface-2 disabled:opacity-60"
          />
        </div>
      </div>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
