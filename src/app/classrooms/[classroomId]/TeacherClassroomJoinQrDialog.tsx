'use client'

import { useId } from 'react'
import { ClipboardCopy, X } from 'lucide-react'
import { Button, DialogPanel, QrCode } from '@/ui'

export function TeacherClassroomJoinQrDialog({
  classroomTitle,
  joinCode,
  joinUrl,
  isOpen,
  onClose,
  onCopyLink,
}: {
  classroomTitle: string
  joinCode: string
  joinUrl: string
  isOpen: boolean
  onClose: () => void
  onCopyLink: () => void
}) {
  const titleId = useId()
  return (
    <DialogPanel
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy={titleId}
      maxWidth="max-w-6xl"
      className="aspect-[2/3] overflow-hidden sm:aspect-video"
    >
      <h2 id={titleId} className="sr-only">Join this classroom</h2>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="absolute right-3 top-3 z-local-menu h-11 w-11 p-0"
        aria-label="Close"
        onClick={onClose}
      >
        <X className="h-5 w-5" aria-hidden="true" />
      </Button>
      <div className="flex h-full min-h-0 flex-col items-stretch justify-center gap-3 sm:flex-row sm:gap-6">
        <div className="flex w-full min-w-0 shrink-0 flex-col items-center justify-center px-3 text-center sm:w-1/3">
          <p className="text-3xl font-semibold leading-tight text-text-default sm:text-5xl">{classroomTitle}</p>
          <div className="mt-5 sm:mt-8">
            <p className="text-sm font-medium uppercase tracking-wide text-text-muted sm:text-base">Join code</p>
            <p className="mt-1 font-mono text-3xl font-semibold tracking-wider text-text-default sm:text-5xl">{joinCode}</p>
          </div>
          <Button type="button" variant="secondary" className="mt-6" onClick={onCopyLink}>
            <ClipboardCopy className="h-4 w-4" aria-hidden="true" />
            Copy link
          </Button>
        </div>
        <div className="flex min-h-0 flex-none items-center justify-center sm:h-full sm:flex-1">
          <QrCode
            value={joinUrl}
            label={`${classroomTitle} join classroom QR code`}
            className="aspect-square w-full max-w-64 border-0 bg-qr-background p-8 sm:h-full sm:w-auto sm:max-w-full sm:p-16"
            codeClassName="h-full max-w-none"
          />
        </div>
      </div>
    </DialogPanel>
  )
}
