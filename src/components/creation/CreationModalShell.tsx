'use client'

import { useId, type ReactNode, type Ref } from 'react'
import { DialogCloseButton, DialogPanel, FormField, Input, type FormFieldProps } from '@/ui'
import { cn } from '@/ui'

interface CreationModalShellProps {
  isOpen: boolean
  /** Individually audited callers may opt in; other creation owners stay immediate. */
  exitMotion?: 'none' | 'opacity'
  title: string
  titleId: string
  closeLabel: string
  closeDisabled?: boolean
  /** Use false only when the dialog content provides its own accessible close control. */
  showCloseButton?: boolean
  maxWidth?: string
  panelClassName?: string
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
  hideTitleLabel?: boolean
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
  exitMotion,
  title,
  titleId,
  closeLabel,
  closeDisabled = false,
  showCloseButton = true,
  maxWidth = '!max-w-4xl',
  panelClassName,
  contentClassName,
  tall = false,
  showTitle = false,
  headerCenter,
  footer,
  onClose,
  children,
}: CreationModalShellProps) {
  const hasHeader = showTitle || Boolean(headerCenter)
  // Compact editors share their existing first row with the panel-owned X.
  // Stacked layouts reserve the context corner; split layouts reserve control rows.
  const compactCloseSpace = !hasHeader && showCloseButton
    ? cn(
      '[&_.modal-context-row]:sticky [&_.modal-context-row]:top-3 sm:[&_.modal-context-row]:top-4 lg:[&_.modal-context-row]:top-0 [&_.modal-context-row]:z-sticky-table [&_.modal-context-row]:bg-inherit [&_.modal-context-row]:pr-14 lg:[&_.modal-context-row]:pr-0',
      '[&_.modal-controls-row]:sticky [&_.modal-controls-row]:top-0 [&_.modal-controls-row]:z-sticky-table [&_.modal-controls-row]:min-h-control [&_.modal-controls-row]:bg-surface [&_.modal-controls-row]:pr-14',
      '[&_.modal-question-controls-row]:sticky [&_.modal-question-controls-row]:top-0 [&_.modal-question-controls-row]:z-sticky-table [&_.modal-question-controls-row]:bg-surface [&_.modal-question-controls-tail]:pr-14',
      '[&_.simple-editor-wrapper]:isolate',
    )
    : undefined

  function handleRequestClose() {
    if (closeDisabled) return
    onClose()
  }

  return (
    <DialogPanel
      isOpen={isOpen}
      exitMotion={exitMotion}
      onClose={handleRequestClose}
      closeDisabled={closeDisabled}
      showCloseButton={false}
      maxWidth={maxWidth}
      className={cn(CREATION_PANEL_CLASS, compactCloseSpace, tall && 'h-[90dvh]', panelClassName)}
      viewportPaddingClassName="p-2 sm:p-4"
      ariaLabelledBy={titleId}
    >
      {showCloseButton && <DialogCloseButton label={closeLabel} onClose={handleRequestClose} disabled={closeDisabled}
        className={!hasHeader ? 'sm:right-4 sm:top-4' : undefined} />}
      {hasHeader ? (
        <div className={cn('grid min-h-14 shrink-0 items-center gap-2 px-3 pt-3 sm:px-4', headerCenter ? 'grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]' : 'grid-cols-[minmax(0,1fr)_auto]')}>
          <h2 id={titleId} className={showTitle ? 'min-w-0 truncate pr-14 text-base font-semibold text-text-default' : 'sr-only'} title={title}>
            {title}
          </h2>
          {headerCenter && <div className="flex flex-1 items-center justify-center">{headerCenter}</div>}
        </div>
      ) : <h2 id={titleId} className="sr-only">{title}</h2>}

      <div className={cn('min-h-0 flex-1 overflow-y-auto p-3 sm:p-4', contentClassName)}>
        {children}
      </div>
      {footer && (
        <div className="shrink-0 p-3 sm:p-4">
          {footer}
        </div>
      )}
    </DialogPanel>
  )
}

/** Identifies the classwork without expanding the right pane's control row. */
export function CreationModalContextHeader({ itemType, classroomName, spacious = false }: {
  itemType: 'Assignment' | 'Material' | 'Test' | 'Survey'
  classroomName?: string
  /** Separate context row above a muted details body in split authoring dialogs. */
  spacious?: boolean
}) {
  return (
    <header className={cn('modal-context-row flex min-w-0 shrink-0 items-center text-sm',
      spacious ? '!top-0 min-h-[76px] gap-3 !bg-surface px-3 sm:px-4' : 'min-h-control gap-2')}>
      <span className={cn('shrink-0 font-semibold text-text-default', spacious && 'text-2xl leading-8')}>{itemType}</span>
      {classroomName && (
        <span title={classroomName} className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-text-muted"
          style={{
            maskImage: 'linear-gradient(to right, black calc(100% - 1.5rem), transparent)',
            WebkitMaskImage: 'linear-gradient(to right, black calc(100% - 1.5rem), transparent)',
          }}>
          {classroomName}
        </span>
      )}
    </header>
  )
}

/** An accessible title input and its settings share the existing controls' height. */
export function CreationModalTitleField({ children, actions, error }: Pick<FormFieldProps, 'children' | 'error'> & { actions?: ReactNode }) {
  return <div className="modal-title-field flex items-start gap-2">
    <FormField label="Title" required hideLabel collapseHiddenLabel error={error} className="min-w-0 flex-1">
      {children}
    </FormField>
    {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
  </div>
}

export function CreationModalTopRow({
  title,
  titleLabel = 'Title',
  titlePlaceholder,
  titleError,
  titleRequired = true,
  hideTitleLabel = false,
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
          {hideTitleLabel ? (
            <label htmlFor={titleFieldId} className="sr-only">
              {titleLabel}
              {titleRequired && <span aria-hidden="true">*</span>}
            </label>
          ) : (
            <div className="mb-1 flex min-h-5 items-center justify-between gap-2">
              <label htmlFor={titleFieldId} className="block text-sm font-medium text-text-default">
                {titleLabel}
                {titleRequired && <span className="ml-1 text-danger">*</span>}
              </label>
              <div className="min-w-0 shrink-0">
                {titleStatus}
              </div>
            </div>
          )}
          {titleInput}
          {hideTitleLabel && (
            <div className="mt-1 flex justify-end">
              {titleStatus}
            </div>
          )}
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
          hideLabel={hideTitleLabel}
          collapseHiddenLabel={hideTitleLabel}
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
