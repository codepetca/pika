'use client'

import { useEffect, useRef } from 'react'
import { Button } from '@/components/Button'

type AlertDialogVariant = 'default' | 'success' | 'error'

interface AlertDialogProps {
  isOpen: boolean
  title: string
  description?: string
  buttonLabel?: string
  variant?: AlertDialogVariant
  onClose: () => void
}

export function AlertDialog({
  isOpen,
  title,
  description,
  buttonLabel = 'OK',
  variant = 'default',
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

  if (!isOpen) return null

  const buttonVariant = variant === 'error' ? 'danger' : 'primary'

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
        <div className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</div>
        {description && (
          <div className="mt-2 text-sm text-gray-600 dark:text-gray-300 whitespace-pre-line">
            {description}
          </div>
        )}
        <div className="mt-4">
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
