'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Printer, RotateCcw, Settings, X } from 'lucide-react'
import { TeacherWorkSurfaceIconMenuButton } from '@/components/teacher-work-surface/TeacherWorkSurfaceActionCluster'
import type { TeacherClassroomQrPresentation } from '@/lib/teacher-attendance'
import { fetchJSON, fetchJSONWithCache } from '@/lib/request-cache'
import { Button, ConfirmDialog, DialogPanel, PageState, QrCode } from '@/ui'

function classroomQrUrl(classroomId: string) {
  return `/api/teacher/attendance/classroom-qr?${new URLSearchParams({
    classroom_id: classroomId,
  }).toString()}`
}

function validatedUrl(presentation: TeacherClassroomQrPresentation) {
  const entryUrl = new URL(presentation.entryPath, window.location.origin)
  if (
    entryUrl.origin !== window.location.origin
    || !/^\/attendance\/classroom\/[A-Za-z0-9_-]{43}$/.test(entryUrl.pathname)
    || entryUrl.search
    || entryUrl.hash
    || !Number.isInteger(presentation.generation)
    || presentation.generation < 1
    || !Number.isFinite(Date.parse(presentation.rotatedAt))
  ) throw new Error('Permanent classroom QR is temporarily unavailable')
  return entryUrl.toString()
}

export function TeacherClassroomQrDialog({
  classroomId,
  classroomTitle,
  isOpen,
  onClose,
}: {
  classroomId: string
  classroomTitle: string
  isOpen: boolean
  onClose: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [presentation, setPresentation] = useState<TeacherClassroomQrPresentation | null>(null)
  const [rotateOpen, setRotateOpen] = useState(false)
  const [rotating, setRotating] = useState(false)
  const [rotateError, setRotateError] = useState('')
  const titleId = useId()
  const requestVersion = useRef(0)

  const load = useCallback(async () => {
    const version = ++requestVersion.current
    setLoading(true)
    setPresentation(null)
    setError('')
    try {
      const url = classroomQrUrl(classroomId)
      // Coalesce reads, but always revalidate when reopened: another device may rotate it.
      const next = await fetchJSONWithCache(url, () => fetchJSON<TeacherClassroomQrPresentation>(url, {
        init: { cache: 'no-store' },
        errorMessage: 'Permanent classroom QR is temporarily unavailable',
      }), 0)
      if (version !== requestVersion.current) return
      validatedUrl(next)
      setPresentation(next)
    } catch (loadError) {
      if (version !== requestVersion.current) return
      setError(loadError instanceof Error
        ? loadError.message
        : 'Permanent classroom QR is temporarily unavailable')
    } finally {
      if (version === requestVersion.current) setLoading(false)
    }
  }, [classroomId])

  useEffect(() => {
    setRotateOpen(false)
    setRotateError('')
    setRotating(false)
    if (isOpen) void load()
    else {
      setPresentation(null)
      setError('')
      setRotateOpen(false)
      setRotateError('')
    }
    return () => { requestVersion.current += 1 }
  }, [isOpen, load])

  const entryUrl = presentation && typeof window !== 'undefined'
    ? validatedUrl(presentation)
    : null

  async function rotate() {
    if (!presentation || rotating) return
    const version = ++requestVersion.current
    setRotating(true)
    setRotateError('')
    try {
      const next = await fetchJSON<TeacherClassroomQrPresentation>(
        '/api/teacher/attendance/classroom-qr',
        {
          init: {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              classroom_id: classroomId,
              expected_generation: presentation.generation,
            }),
          },
          errorMessage: 'Permanent classroom QR could not be rotated',
        },
      )
      if (version !== requestVersion.current) return
      validatedUrl(next)
      setPresentation(next)
      setRotateOpen(false)
    } catch {
      if (version !== requestVersion.current) return
      // The write may have committed despite a lost response, or another device
      // may have rotated it. Never offer the possibly revoked poster for export.
      setPresentation(null)
      setRotateOpen(false)
      setError('The rotation could not be confirmed. Reload the current QR before printing or rotating again.')
    } finally {
      if (version === requestVersion.current) setRotating(false)
    }
  }

  function printPoster() {
    document.body.dataset.printClassroomQr = 'true'
    const cleanup = () => {
      delete document.body.dataset.printClassroomQr
      window.removeEventListener('afterprint', cleanup)
    }
    window.addEventListener('afterprint', cleanup)
    window.print()
  }

  const poster = entryUrl ? (
    <div className="flex h-full w-full items-center gap-8 bg-qr-background p-8 text-qr-foreground">
      <div className="flex w-1/3 min-w-0 flex-col justify-center">
        <p className="text-4xl font-semibold leading-tight">{classroomTitle}</p>
        <p className="mt-3 text-lg">Scan to check in for attendance</p>
        <p className="mt-6 text-sm">Sign in to Pika after scanning. Attendance must be open.</p>
      </div>
      <div className="flex h-full min-h-0 flex-1 items-center justify-center">
        <QrCode
          value={entryUrl}
          label={`${classroomTitle} permanent attendance QR code`}
          className="aspect-square h-full max-w-full border-0 bg-qr-background p-[10%]"
          codeClassName="h-full max-w-none"
        />
      </div>
    </div>
  ) : null

  return (
    <>
      <DialogPanel
        isOpen={isOpen}
        onClose={onClose}
        ariaLabelledBy={titleId}
        maxWidth="max-w-6xl"
        className="aspect-square overflow-hidden sm:aspect-video"
      >
        <h2 id={titleId} className="sr-only">Classroom QR</h2>
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
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <PageState kind="loading" title="Loading classroom QR" compact />
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center">
            <PageState
              kind="error"
              title="Classroom QR unavailable"
              description={error}
              compact
              action={<Button type="button" onClick={() => void load()}>Try again</Button>}
            />
          </div>
        ) : entryUrl && presentation ? (
          <div className="flex h-full min-h-0 flex-col items-stretch gap-3 sm:flex-row sm:gap-6">
            <div className="flex w-full min-w-0 flex-col justify-center pr-12 sm:w-1/3 sm:pl-3 sm:pr-0">
              <p className="text-2xl font-semibold leading-tight text-text-default sm:text-4xl">{classroomTitle}</p>
              <p className="mt-3 text-sm leading-5 text-text-muted">
                Students scan to sign in to Pika. Check-in works while attendance is open.
              </p>
              <div className="mt-6 flex items-center gap-3">
                <TeacherWorkSurfaceIconMenuButton
                  ariaLabel="Poster settings"
                  tooltip="Poster settings"
                  className="h-11 w-11"
                  menuAlign="start"
                  icon={<Settings className="h-5 w-5" aria-hidden="true" />}
                  items={[
                    {
                      id: 'print-poster',
                      label: 'Print poster',
                      icon: <Printer className="h-4 w-4" aria-hidden="true" />,
                      onSelect: printPoster,
                    },
                    {
                      id: 'rotate-qr',
                      label: 'Rotate QR',
                      icon: <RotateCcw className="h-4 w-4" aria-hidden="true" />,
                      onSelect: () => setRotateOpen(true),
                    },
                  ]}
                />
                <span className="text-xs text-text-muted">Stable until you rotate it</span>
              </div>
            </div>
            <div className="flex h-full min-h-0 flex-1 items-center justify-center">
              <QrCode
                value={entryUrl}
                label={`${classroomTitle} permanent attendance QR code`}
                className="aspect-square w-full max-w-40 border-0 bg-qr-background p-[10%] sm:h-full sm:w-auto sm:max-w-full"
                codeClassName="h-full max-w-none"
              />
            </div>
          </div>
        ) : null}
      </DialogPanel>
      <ConfirmDialog
        isOpen={rotateOpen}
        title="Rotate classroom QR?"
        description="The current printed poster will stop working immediately. Print and replace it after rotating."
        confirmLabel="Rotate QR"
        errorMessage={rotateError}
        isCancelDisabled={rotating}
        isConfirmDisabled={rotating}
        onCancel={() => {
          if (!rotating) setRotateOpen(false)
        }}
        onConfirm={rotate}
      />
      {poster && typeof document !== 'undefined'
        ? createPortal(
            <div data-classroom-qr-print className="hidden h-screen w-screen">{poster}</div>,
            document.body,
          )
        : null}
    </>
  )
}
