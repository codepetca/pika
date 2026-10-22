'use client'

import { useEffect, useId, useRef, type ReactNode } from 'react'
import { cva } from 'class-variance-authority'
import { Button } from './Button'
import { DialogCloseButton } from './DialogCloseButton'
import { ModalLayer, type ModalLayerProps } from './ModalLayer'

// Dialog panel styles with CVA
const dialogPanelStyles = cva([
  'relative w-full',
  'rounded-dialog border shadow-dialog p-dialog',
  'bg-surface',
  'border-border',
])

const dialogTitleStyles = 'text-base font-semibold text-text-default'
const dialogDescriptionStyles = 'mt-2 text-sm text-text-muted whitespace-pre-line'

// ============================================================================
// AlertDialog
// ============================================================================

export type AlertDialogVariant = 'default' | 'success' | 'error'

export interface AlertDialogState {
  isOpen: boolean
  title: string
  description?: string
  variant?: AlertDialogVariant
  autoDismiss?: boolean
}

export interface AlertDialogProps extends AlertDialogState {
  buttonLabel?: string
  onClose: () => void
  exitMotion?: ModalLayerProps['exitMotion']
}

function ErrorIcon() {
  return (
    <svg className="w-6 h-6 text-danger" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

/**
 * AlertDialog for displaying messages with a single action button.
 *
 * @example
 * <AlertDialog
 *   isOpen={showAlert}
 *   onClose={() => setShowAlert(false)}
 *   title="Success!"
 *   description="Your changes have been saved."
 *   variant="success"
 * />
 */
export function AlertDialog({
  isOpen,
  title,
  description,
  buttonLabel = 'OK',
  variant = 'default',
  autoDismiss = false,
  onClose,
  exitMotion = 'opacity',
}: AlertDialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const buttonRef = useRef<HTMLButtonElement | null>(null)

  // Auto-dismiss for success messages
  useEffect(() => {
    if (!isOpen || !autoDismiss) return
    const timer = setTimeout(onClose, 2000)
    return () => clearTimeout(timer)
  }, [isOpen, autoDismiss, onClose])

  const buttonVariant = variant === 'error' ? 'danger' : 'primary'
  const icon = variant === 'error' ? <ErrorIcon /> : null

  return (
    <ModalLayer
      isOpen={isOpen}
      exitMotion={exitMotion}
      onClose={onClose}
      role="alertdialog"
      onEnter={onClose}
      ariaLabelledBy={titleId}
      ariaDescribedBy={description ? descriptionId : undefined}
      initialFocusRef={buttonRef}
      panelClassName={`${dialogPanelStyles()} max-w-sm`}
    >
      <>
        <DialogCloseButton onClose={onClose} />
        <div className="flex min-h-control items-center gap-3 pr-14">
          {icon}
          <div id={titleId} className={dialogTitleStyles}>{title}</div>
        </div>
        {description && (
          <div id={descriptionId} className={`${dialogDescriptionStyles} ${icon ? 'ml-9' : ''}`}>
            {description}
          </div>
        )}
        <div className={`mt-4 ${icon ? 'ml-9' : ''}`}>
          <Button
            ref={buttonRef}
            type="button"
            variant={buttonVariant}
            className="w-full"
            onClick={onClose}
          >
            {buttonLabel}
          </Button>
        </div>
      </>
    </ModalLayer>
  )
}

// ============================================================================
// ConfirmDialog
// ============================================================================

type ConfirmDialogVariant = 'default' | 'danger'

export interface ConfirmDialogProps {
  isOpen: boolean
  exitMotion?: ModalLayerProps['exitMotion']
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  confirmVariant?: ConfirmDialogVariant
  errorMessage?: string
  isCancelDisabled?: boolean
  isConfirmDisabled?: boolean
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

/**
 * ConfirmDialog for actions that require user confirmation.
 *
 * @example
 * <ConfirmDialog
 *   isOpen={showConfirm}
 *   onCancel={() => setShowConfirm(false)}
 *   onConfirm={handleDelete}
 *   title="Delete item?"
 *   description="This action cannot be undone."
 *   confirmLabel="Delete"
 *   confirmVariant="danger"
 * />
 */
export function ConfirmDialog({
  isOpen,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmVariant = 'default',
  errorMessage,
  isCancelDisabled = false,
  isConfirmDisabled = false,
  onConfirm,
  onCancel,
  exitMotion = 'opacity',
}: ConfirmDialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null)
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!isOpen || !errorMessage || isConfirmDisabled) return
    confirmButtonRef.current?.focus()
  }, [errorMessage, isConfirmDisabled, isOpen])

  const confirmButtonVariant = confirmVariant === 'danger' ? 'danger' : 'primary'

  return (
    <ModalLayer
      isOpen={isOpen}
      exitMotion={exitMotion}
      onClose={onCancel}
      ariaLabelledBy={titleId}
      ariaDescribedBy={description ? descriptionId : undefined}
      initialFocusRef={cancelButtonRef}
      closeOnEscape={!isCancelDisabled}
      closeOnBackdrop={!isCancelDisabled}
      panelClassName={`${dialogPanelStyles()} max-w-sm`}
    >
      <>
        <DialogCloseButton onClose={onCancel} disabled={isCancelDisabled} />
        <div id={titleId} className={`${dialogTitleStyles} min-h-control pr-14`}>{title}</div>
        {description && (
          <div id={descriptionId} className={dialogDescriptionStyles}>
            {description}
          </div>
        )}
        {errorMessage ? (
          <div
            role="alert"
            className="mt-3 rounded-control border border-danger bg-danger-bg px-3 py-2 text-sm text-danger"
          >
            {errorMessage}
          </div>
        ) : null}
        <div className="mt-4 flex gap-control">
          <Button
            ref={cancelButtonRef}
            type="button"
            variant="secondary"
            className="flex-1"
            disabled={isCancelDisabled}
            onClick={onCancel}
          >
            {cancelLabel}
          </Button>
          <Button
            ref={confirmButtonRef}
            type="button"
            variant={confirmButtonVariant}
            className="flex-1"
            disabled={isConfirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </>
    </ModalLayer>
  )
}

// ============================================================================
// DialogPanel
// ============================================================================

export interface DialogPanelProps {
  isOpen: boolean
  /** Defaults to immediate unmount. Opacity retains descendants through the exit. */
  exitMotion?: ModalLayerProps['exitMotion']
  onClose: () => void
  maxWidth?: string
  className?: string
  viewportPaddingClassName?: string
  /** ID of the element that labels the dialog (for accessibility) */
  ariaLabelledBy?: string
  closeLabel?: string
  closeDisabled?: boolean
  showCloseButton?: boolean
  children: ReactNode
}

/**
 * DialogPanel is a lower-level primitive for building custom modal dialogs.
 *
 * It supplies the standard corner close but no built-in header or footer —
 * children control their own layout via flex utilities. Use this when you need
 * full control over the dialog content (e.g., forms, wizards, multi-step flows).
 *
 * Features:
 * - Backdrop click closes dialog
 * - Escape key closes dialog
 * - Viewport constraints (max-h-[85vh]) with flex layout for scrollable content
 * - Consistent styling with other dialog components
 *
 * @example
 * <DialogPanel isOpen={isOpen} onClose={handleClose} maxWidth="max-w-lg" ariaLabelledBy="modal-title">
 *   <h2 id="modal-title" className="flex-shrink-0">Header content</h2>
 *   <div className="flex-1 min-h-0 overflow-y-auto">Scrollable content</div>
 *   <div className="flex-shrink-0">Footer with buttons</div>
 * </DialogPanel>
 */
export function DialogPanel({
  isOpen,
  onClose,
  maxWidth = 'max-w-2xl',
  className,
  viewportPaddingClassName = 'p-4',
  ariaLabelledBy,
  children,
  exitMotion,
  closeLabel = 'Close',
  closeDisabled = false,
  showCloseButton = true,
}: DialogPanelProps) {
  function requestClose() { if (!closeDisabled) onClose() }
  return (
    <ModalLayer
      isOpen={isOpen}
      exitMotion={exitMotion}
      onClose={requestClose}
      closeOnEscape={!closeDisabled}
      closeOnBackdrop={!closeDisabled}
      ariaLabelledBy={ariaLabelledBy}
      rootClassName={`flex items-center justify-center ${viewportPaddingClassName}`}
      panelClassName={`${dialogPanelStyles()} ${maxWidth} max-w-[90vw] max-h-[85vh] flex flex-col ${showCloseButton ? '[&>h2]:min-h-control [&>h2]:shrink-0 [&>h2]:pr-14 [&>h3]:min-h-control [&>h3]:shrink-0 [&>h3]:pr-14' : ''} ${className ?? ''}`}
    >
      {showCloseButton && <DialogCloseButton onClose={requestClose} label={closeLabel} disabled={closeDisabled} />}
      {children}
    </ModalLayer>
  )
}

// ============================================================================
// ContentDialog
// ============================================================================

export interface ContentDialogProps {
  isOpen: boolean
  /** Defaults to immediate unmount. Opacity retains descendants through the exit. */
  exitMotion?: ModalLayerProps['exitMotion']
  onClose: () => void
  title: string
  subtitle?: string
  children: ReactNode
  /** Max width class, defaults to 'max-w-2xl' */
  maxWidth?: string
  showHeaderClose?: boolean
  closeDisabled?: boolean
  showFooterClose?: boolean
  panelClassName?: string
  /** Actions kept visible while the dialog content scrolls. */
  footer?: ReactNode
}

/**
 * ContentDialog for displaying rich content in a modal.
 *
 * Provides focus management, Escape-to-close, backdrop click-to-close,
 * and proper ARIA attributes. Use this when you need a modal with
 * custom content (e.g. rich text, forms, previews).
 *
 * @example
 * <ContentDialog
 *   isOpen={showInstructions}
 *   onClose={() => setShowInstructions(false)}
 *   title="Instructions"
 *   subtitle={assignment.title}
 * >
 *   <RichTextViewer content={assignment.rich_instructions} />
 * </ContentDialog>
 */
export function ContentDialog({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  maxWidth = 'max-w-2xl',
  showHeaderClose = true,
  closeDisabled = false,
  showFooterClose = true,
  panelClassName,
  footer,
  exitMotion,
}: ContentDialogProps) {
  const titleId = useId()
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  function requestClose() { if (!closeDisabled) onClose() }

  return (
    <ModalLayer
      isOpen={isOpen}
      exitMotion={exitMotion}
      onClose={requestClose}
      closeOnEscape={!closeDisabled}
      closeOnBackdrop={!closeDisabled}
      ariaLabelledBy={titleId}
      initialFocusRef={showHeaderClose ? closeButtonRef : undefined}
      panelClassName={`${dialogPanelStyles()} ${maxWidth} max-w-[90vw] max-h-[85vh] flex flex-col ${panelClassName ?? ''}`}
    >
        <div className={`flex min-h-control items-start justify-between gap-3 flex-shrink-0 ${showHeaderClose ? 'pr-14' : ''}`}>
          <div className="min-w-0">
            <h3 id={titleId} className={dialogTitleStyles}>{title}</h3>
            {subtitle && (
              <p className="text-xs text-text-muted truncate mt-0.5">{subtitle}</p>
            )}
          </div>
          {showHeaderClose && (
            <DialogCloseButton ref={closeButtonRef} onClose={requestClose} disabled={closeDisabled} />
          )}
        </div>
        <div className="mt-4 flex-1 min-h-0 overflow-y-auto">
          {children}
        </div>
        {footer ? (
          <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-border pt-4 flex-shrink-0">
            {footer}
          </div>
        ) : showFooterClose && (
          <div className="mt-6 flex justify-end flex-shrink-0">
            <Button variant="secondary" onClick={requestClose} disabled={closeDisabled}>
              Close
            </Button>
          </div>
        )}
    </ModalLayer>
  )
}
