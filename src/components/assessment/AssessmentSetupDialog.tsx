'use client'

import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button, DialogPanel } from '@/ui'

interface AssessmentSetupDialogProps {
  isOpen: boolean
  title: string
  titleId: string
  closeLabel: string
  isCompact?: boolean
  compactMaxWidth?: string
  closeDisabled?: boolean
  onClose: () => void
  children: ReactNode
}

const FULL_VIEWPORT_PANEL_CLASS =
  '!h-[calc(100dvh-0.5rem)] !max-h-[calc(100dvh-0.5rem)] !w-[calc(100vw-0.5rem)] !max-w-[calc(100vw-0.5rem)] overflow-hidden p-0 sm:!h-[calc(100dvh-1rem)] sm:!max-h-[calc(100dvh-1rem)] sm:!w-[calc(100vw-1rem)] sm:!max-w-[calc(100vw-1rem)]'

export function AssessmentSetupDialog({
  isOpen,
  title,
  titleId,
  closeLabel,
  isCompact = false,
  compactMaxWidth = 'max-w-xs',
  closeDisabled = false,
  onClose,
  children,
}: AssessmentSetupDialogProps) {
  return (
    <DialogPanel
      isOpen={isOpen}
      onClose={onClose}
      maxWidth={isCompact ? compactMaxWidth : 'max-w-none'}
      className={isCompact ? 'p-6' : FULL_VIEWPORT_PANEL_CLASS}
      viewportPaddingClassName={isCompact ? undefined : 'p-1 sm:p-2'}
      ariaLabelledBy={titleId}
    >
      <div className={isCompact ? '' : 'flex min-h-0 flex-1 flex-col'}>
        <div
          className={
            isCompact
              ? 'mb-4 flex flex-shrink-0 items-start gap-3'
              : 'flex flex-shrink-0 items-center gap-3 border-b border-border px-4 py-3'
          }
        >
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-xl font-bold text-text-default">
            {title}
          </h2>
          <Button
            type="button"
            variant="surface"
            size="sm"
            className="h-10 w-10 flex-shrink-0 px-0"
            onClick={onClose}
            disabled={closeDisabled}
            aria-label={closeLabel}
            title="Close"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </Button>
        </div>
        {children}
      </div>
    </DialogPanel>
  )
}
