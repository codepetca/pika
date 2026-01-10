'use client'

import { useEffect, useRef } from 'react'
import { Button } from '@/components/Button'

type ConfirmDialogVariant = 'default' | 'danger'

interface ConfirmDialogProps {
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
        className="absolute inset-0 bg-black/50 dark:bg-black/70"
        aria-label="Close dialog"
        disabled={isCancelDisabled}
        onClick={onCancel}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl p-5"
      >
        <div className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</div>
        {description && (
          <div className="mt-2 text-sm text-gray-600 dark:text-gray-300 whitespace-pre-line">
            {description}
          </div>
        )}
        <div className="mt-4 flex gap-3">
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
