'use client'

import { useId, type ReactNode, type Ref } from 'react'
import { X } from 'lucide-react'
import { Button, DialogPanel, FormField, Input } from '@/ui'
import { cn } from '@/ui'

interface CreationModalShellProps {
  isOpen: boolean
  title: string
  titleId: string
  closeLabel: string
  closeDisabled?: boolean
  maxWidth?: string
  contentClassName?: string
  /** Use a consistent viewport-relative height for long authoring forms. */
  tall?: boolean
  /** Show the dialog's name above the editable item title. */
  showTitle?: boolean
  /** Optional metadata centered in the visible heading row. */
  headerCenter?: ReactNode
  footer?: ReactNode
  onClose: () => void
  children: ReactNode
}

interface CreationModalTopRowProps {
  title: string
  titleLabel?: string
  titlePlaceholder: string
  titleError?: string
  titleRequired?: boolean
  titleDisabled?: boolean
  titleInputRef?: Ref<HTMLInputElement>
  titleInitialFocus?: boolean
  titleInputClassName?: string
  titleFieldClassName?: string
  titleStatus?: ReactNode
  afterTitle?: ReactNode
  actions?: ReactNode
  className?: string
  onTitleChange: (value: string) => void
  onTitleBlur?: () => void
}

const CREATION_PANEL_CLASS =
  'relative !max-h-[calc(100dvh-1rem)] overflow-hidden p-0 sm:!max-h-[calc(100dvh-2rem)]'

function getTopRowGridClassName(hasAfterTitle: boolean, hasActions: boolean) {
  if (hasAfterTitle && hasActions) {
    return 'grid-cols-[minmax(2.75rem,1fr)_auto_auto] sm:grid-cols-[minmax(9rem,1fr)_auto_auto]'
  }

  if (hasAfterTitle || hasActions) {
    return 'grid-cols-[minmax(2.75rem,1fr)_auto] sm:grid-cols-[minmax(9rem,1fr)_auto]'
  }

  return 'grid-cols-1'
}

export function CreationModalShell({
  isOpen,
  title,
  titleId,
  closeLabel,
  closeDisabled = false,
  maxWidth = '!max-w-4xl',
  contentClassName,
  tall = false,
  showTitle = false,
  headerCenter,
  footer,
  onClose,
  children,
}: CreationModalShellProps) {
  function handleRequestClose() {
    if (closeDisabled) return
    onClose()
  }

  const closeControl = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn('z-20 h-11 w-11 px-0 text-text-default', !showTitle && 'absolute right-1 top-1')}
      onClick={handleRequestClose}
      disabled={closeDisabled}
      aria-label={closeLabel}
      title="Close"
    >
      <X className="h-4 w-4" aria-hidden="true" />
    </Button>
  )

  return (
    <DialogPanel
      isOpen={isOpen}
      onClose={handleRequestClose}
      maxWidth={maxWidth}
      className={cn(CREATION_PANEL_CLASS, tall && 'h-[90dvh]')}
      viewportPaddingClassName="p-2 sm:p-4"
      ariaLabelledBy={titleId}
    >
      {showTitle ? (
        <div className={cn('grid h-12 shrink-0 items-center gap-2 px-3 sm:px-4', headerCenter ? 'grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]' : 'grid-cols-[minmax(0,1fr)_auto]')}>
          <h2 id={titleId} className="min-w-0 truncate text-base font-semibold text-text-default" title={title}>
            {title}
          </h2>
          {headerCenter && <div className="flex items-center justify-center">{headerCenter}</div>}
          <div className="flex justify-end">{closeControl}</div>
        </div>
      ) : (
        <h2 id={titleId} className="sr-only">{title}</h2>
      )}

      {!showTitle && closeControl}

      <div className={cn('min-h-0 flex-1 overflow-y-auto p-3 sm:p-4', contentClassName)}>
        {children}
      </div>
      {footer && (
        <div className="shrink-0 border-t border-border p-3 sm:p-4">
          {footer}
        </div>
      )}
    </DialogPanel>
  )
}

export function CreationModalTopRow({
  title,
  titleLabel = 'Title',
  titlePlaceholder,
  titleError,
  titleRequired = true,
  titleDisabled = false,
  titleInputRef,
  titleInitialFocus = false,
  titleInputClassName,
  titleFieldClassName,
  titleStatus,
  afterTitle,
  actions,
  className,
  onTitleChange,
  onTitleBlur,
}: CreationModalTopRowProps) {
  const gridClassName = getTopRowGridClassName(Boolean(afterTitle), Boolean(actions))
  const titleFieldId = useId()
  const titleErrorId = titleError ? `${titleFieldId}-error` : undefined
  const titleInput = (
    <Input
      ref={titleInputRef}
      data-modal-initial-focus={titleInitialFocus && !titleDisabled ? '' : undefined}
      id={titleFieldId}
      type="text"
      value={title}
      onChange={(event) => onTitleChange(event.target.value)}
      onBlur={onTitleBlur}
      required={titleRequired}
      disabled={titleDisabled}
      placeholder={titlePlaceholder}
      hasError={Boolean(titleError)}
      aria-invalid={titleError ? 'true' : undefined}
      aria-describedby={titleErrorId}
      className={titleInputClassName}
    />
  )

  return (
    <div className={cn('grid items-end gap-1.5 sm:gap-2', gridClassName, className)}>
      {titleStatus ? (
        <div className={cn('min-w-0 max-w-[22rem] sm:max-w-[24rem]', titleFieldClassName)}>
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
          className={cn('min-w-0 max-w-[22rem] sm:max-w-[24rem]', titleFieldClassName)}
        >
          {titleInput}
        </FormField>
      )}

      {afterTitle}

      {actions && (
        <div className="min-w-0">
          {actions}
        </div>
      )}
    </div>
  )
}
