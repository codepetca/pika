'use client'

import { forwardRef } from 'react'
import { X } from 'lucide-react'
import { Button } from './Button'

export interface DialogCloseButtonProps {
  onClose: () => void
  label?: string
  disabled?: boolean
}

/** Position relative to the dialog panel, outside its scrolling content. */
export const DialogCloseButton = forwardRef<HTMLButtonElement, DialogCloseButtonProps>(function DialogCloseButton(
  { onClose, label = 'Close', disabled = false }, ref,
) {
  return <div data-dialog-close className="absolute right-3 top-3 z-local-menu">
    <Button ref={ref} type="button" aria-label={label} title="Close" variant="ghost"
      className="h-11 w-11 p-0" disabled={disabled} onClick={() => { if (!disabled) onClose() }}>
      <X className="h-4 w-4" aria-hidden="true" />
    </Button>
  </div>
})
