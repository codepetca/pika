'use client'

import { useEffect, useRef } from 'react'
import { Button } from '@/components/Button'

export type AlertDialogVariant = 'default' | 'success' | 'error'

export interface AlertDialogState {
  isOpen: boolean
  title: string
  description?: string
  variant?: AlertDialogVariant
  autoDismiss?: boolean
}

interface AlertDialogProps extends AlertDialogState {
  buttonLabel?: string
  onClose: () => void
}

function SuccessIcon() {
  return (
    <svg className="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  )
}

function ErrorIcon() {
  return (
    <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

export function AlertDialog({
  isOpen,
  title,
  description,
  buttonLabel = 'OK',
  variant = 'default',
  autoDismiss = false,
  onClose,
}: AlertDialogProps) {
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
        className="absolute inset-0 bg-black/50 dark:bg-black/70"
        aria-label="Close dialog"
        onClick={onClose}
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl p-5"
      >
        <div className="flex items-center gap-3">
          {icon}
          <div className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</div>
        </div>
        {description && (
          <div className={`mt-2 text-sm text-gray-600 dark:text-gray-300 whitespace-pre-line ${icon ? 'ml-9' : ''}`}>
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
