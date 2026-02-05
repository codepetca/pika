'use client'

import { useEffect, useId, useRef, type ReactNode } from 'react'
import { cva } from 'class-variance-authority'
import { Button } from './Button'

// Dialog panel styles with CVA
const dialogPanelStyles = cva([
  'relative w-full',
  'rounded-dialog border shadow-dialog p-dialog',
  'bg-surface',
  'border-border',
])

const dialogBackdropStyles = 'absolute inset-0 bg-black/50 dark:bg-black/70'
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
}

function SuccessIcon() {
  return (
    <svg className="w-6 h-6 text-success" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  )
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
}: AlertDialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const buttonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!isOpen) return
    buttonRef.current?.focus()
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' || e.key === 'Enter') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // Auto-dismiss for success messages
  useEffect(() => {
    if (!isOpen || !autoDismiss) return
    const timer = setTimeout(onClose, 2000)
    return () => clearTimeout(timer)
  }, [isOpen, autoDismiss, onClose])

  if (!isOpen) return null

  const buttonVariant = variant === 'error' ? 'danger' : 'primary'
  const icon = variant === 'success' ? <SuccessIcon /> : variant === 'error' ? <ErrorIcon /> : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className={dialogBackdropStyles}
        aria-label="Close dialog"
        onClick={onClose}
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={`${dialogPanelStyles()} max-w-sm`}
      >
        <div className="flex items-center gap-3">
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
      </div>
    </div>
  )
}

// ============================================================================
// ConfirmDialog
// ============================================================================

type ConfirmDialogVariant = 'default' | 'danger'

export interface ConfirmDialogProps {
  isOpen: boolean
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  confirmVariant?: ConfirmDialogVariant
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
  isCancelDisabled = false,
  isConfirmDisabled = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!isOpen) return
    cancelButtonRef.current?.focus()
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !isCancelDisabled) onCancel()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isCancelDisabled, onCancel])

  if (!isOpen) return null

  const confirmButtonVariant = confirmVariant === 'danger' ? 'danger' : 'primary'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className={dialogBackdropStyles}
        aria-label="Close dialog"
        disabled={isCancelDisabled}
        onClick={onCancel}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={`${dialogPanelStyles()} max-w-sm`}
      >
        <div id={titleId} className={dialogTitleStyles}>{title}</div>
        {description && (
          <div id={descriptionId} className={dialogDescriptionStyles}>
            {description}
          </div>
        )}
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
            type="button"
            variant={confirmButtonVariant}
            className="flex-1"
            disabled={isConfirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// DialogPanel
// ============================================================================

export interface DialogPanelProps {
  isOpen: boolean
  onClose: () => void
  maxWidth?: string
  className?: string
  /** ID of the element that labels the dialog (for accessibility) */
  ariaLabelledBy?: string
  children: ReactNode
}

/**
 * DialogPanel is a lower-level primitive for building custom modal dialogs.
 *
 * Unlike ContentDialog, it provides no built-in header or footer structure —
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
  ariaLabelledBy,
  children,
}: DialogPanelProps) {
  useEffect(() => {
    if (!isOpen) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className={dialogBackdropStyles}
        aria-label="Close dialog"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabelledBy}
        className={`${dialogPanelStyles()} ${maxWidth} max-w-[90vw] max-h-[85vh] flex flex-col ${className ?? ''}`}
      >
        {children}
      </div>
    </div>
  )
}

// ============================================================================
// ContentDialog
// ============================================================================

export interface ContentDialogProps {
  isOpen: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: ReactNode
  /** Max width class, defaults to 'max-w-2xl' */
  maxWidth?: string
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
}: ContentDialogProps) {
  const titleId = useId()
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)

  // Focus the close button when the dialog opens
  useEffect(() => {
    if (!isOpen) return
    closeButtonRef.current?.focus()
  }, [isOpen])

  // Escape key closes the dialog
  useEffect(() => {
    if (!isOpen) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className={dialogBackdropStyles}
        aria-label="Close dialog"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`${dialogPanelStyles()} ${maxWidth} max-w-[90vw] max-h-[85vh] flex flex-col`}
      >
        <div className="flex items-start justify-between gap-3 flex-shrink-0">
          <div className="min-w-0">
            <h3 id={titleId} className={dialogTitleStyles}>{title}</h3>
            {subtitle && (
              <p className="text-xs text-text-muted truncate mt-0.5">{subtitle}</p>
            )}
          </div>
          <Button ref={closeButtonRef} variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </Button>
        </div>
        <div className="mt-4 flex-1 min-h-0 overflow-y-auto">
          {children}
        </div>
        <div className="mt-6 flex justify-end flex-shrink-0">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  )
}
