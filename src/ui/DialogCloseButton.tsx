'use client'

import { forwardRef } from 'react'
import { X } from 'lucide-react'
import { Button } from './Button'
import { cn } from './utils'

export interface DialogCloseButtonProps {
  onClose: () => void
  label?: string
  disabled?: boolean
  className?: string
}

/** Position relative to the dialog panel, outside its scrolling content. */
export const DialogCloseButton = forwardRef<HTMLButtonElement, DialogCloseButtonProps>(function DialogCloseButton(
  { onClose, label = 'Close', disabled = false, className }, ref,
) {
  return <div data-dialog-close className={cn("absolute right-3 top-3 z-local-menu", className)}>
    <Button ref={ref} type="button" aria-label={label} title="Close" variant="ghost"
      className="h-11 w-11 p-0" disabled={disabled} onClick={() => { if (!disabled) onClose() }}>
      <X className="h-4 w-4" aria-hidden="true" />
    </Button>
  </div>
})
