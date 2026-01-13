'use client'

import { useState, useCallback } from 'react'
import type { AlertDialogState, AlertDialogVariant } from '@/components/AlertDialog'

const INITIAL_STATE: AlertDialogState = { isOpen: false, title: '' }

export function useAlertDialog() {
  const [state, setState] = useState<AlertDialogState>(INITIAL_STATE)

  const showAlert = useCallback((
    title: string,
    options?: {
      description?: string
      variant?: AlertDialogVariant
      autoDismiss?: boolean
    }
  ) => {
    setState({
      isOpen: true,
      title,
      description: options?.description,
      variant: options?.variant,
      autoDismiss: options?.autoDismiss,
    })
  }, [])

  const showSuccess = useCallback((title: string, description?: string) => {
    showAlert(title, { description, variant: 'success', autoDismiss: true })
  }, [showAlert])

  const showError = useCallback((title: string, description?: string) => {
    showAlert(title, { description, variant: 'error' })
  }, [showAlert])

  const closeAlert = useCallback(() => {
    setState(INITIAL_STATE)
  }, [])

  return {
    alertState: state,
    showAlert,
    showSuccess,
    showError,
    closeAlert,
  }
}
