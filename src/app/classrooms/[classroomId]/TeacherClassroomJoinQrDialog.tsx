'use client'

import { useId } from 'react'
import { ClipboardCopy, X } from 'lucide-react'
import { Button, DialogPanel, QrCode } from '@/ui'

export function TeacherClassroomJoinQrDialog({
  classroomTitle,
  joinUrl,
  isOpen,
  onClose,
  onCopyLink,
}: {
  classroomTitle: string
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
      maxWidth="max-w-3xl"
      className="p-6 sm:p-8"
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="absolute right-3 top-3 h-11 w-11 p-0"
        aria-label="Close"
        onClick={onClose}
      >
        <X className="h-5 w-5" aria-hidden="true" />
      </Button>
      <div className="grid items-center gap-8 sm:grid-cols-2">
        <div className="min-w-0 text-center sm:text-left">
          <p className="text-sm font-semibold text-primary">Student access</p>
          <h2 id={titleId} className="mt-2 text-3xl font-semibold leading-tight text-text-default">
            Join this classroom
          </h2>
          <p className="mt-3 text-xl font-medium text-text-default">{classroomTitle}</p>
          <p className="mt-4 text-sm leading-6 text-text-muted">
            Students scan this code, sign in with their school account, and join when exactly one roster entry matches.
          </p>
          <Button type="button" variant="secondary" className="mt-6" onClick={onCopyLink}>
            <ClipboardCopy className="h-4 w-4" aria-hidden="true" />
            Copy link
          </Button>
        </div>
        <QrCode
          value={joinUrl}
          label={`${classroomTitle} join classroom QR code`}
          className="mx-auto aspect-square w-full max-w-80 border-0 bg-qr-background p-8"
          codeClassName="h-full max-w-none"
        />
      </div>
    </DialogPanel>
  )
}
