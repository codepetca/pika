'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, MoreVertical, Printer, RotateCcw, Settings, X } from 'lucide-react'
import { TeacherWorkSurfaceIconMenuButton } from '@/components/teacher-work-surface/TeacherWorkSurfaceActionCluster'
import type { TeacherClassroomQrPresentation } from '@/lib/teacher-attendance'
import { fetchJSON, fetchJSONWithCache } from '@/lib/request-cache'
import { serializeQrSvg } from '@/lib/qr-svg'
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
  attendanceHours,
  isOpen,
  onClose,
}: {
  classroomId: string
  classroomTitle: string
  attendanceHours: string | null
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
  const qrRef = useRef<HTMLDivElement>(null)

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

  function downloadQr() {
    const svg = qrRef.current?.querySelector('svg')
    if (!svg) return
    const blob = new Blob([serializeQrSvg(svg)], {
      type: 'image/svg+xml;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${classroomTitle.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'classroom'}-attendance-qr.svg`
    link.click()
    URL.revokeObjectURL(url)
  }

  const posterActions = [
    {
      id: 'print-poster',
      label: 'Print poster',
      icon: <Printer className="h-4 w-4" aria-hidden="true" />,
      onSelect: printPoster,
    },
    {
      id: 'download-svg',
      label: 'Download SVG',
      icon: <Download className="h-4 w-4" aria-hidden="true" />,
      onSelect: downloadQr,
    },
    {
      id: 'rotate-qr',
      label: 'Rotate QR',
      icon: <RotateCcw className="h-4 w-4" aria-hidden="true" />,
      onSelect: () => setRotateOpen(true),
    },
  ]

  const poster = entryUrl ? (
    <div
      data-classroom-qr-print-layout
      className="flex h-full w-full flex-col items-center bg-qr-background p-12 text-center text-qr-foreground"
    >
      <div className="shrink-0">
        <p data-classroom-qr-print-heading className="text-5xl font-semibold leading-tight">{classroomTitle}</p>
      </div>
      <div className="mt-8 flex min-h-0 w-full flex-1 items-center justify-center">
        <QrCode
          value={entryUrl}
          label={`${classroomTitle} check in for attendance QR code`}
          className="aspect-square h-full max-h-full max-w-full border-0 bg-qr-background p-[10%]"
          codeClassName="h-full max-w-none"
        />
      </div>
      <div className="mt-8 shrink-0">
        {attendanceHours ? <p data-classroom-qr-print-hours className="text-4xl font-semibold">{attendanceHours}</p> : null}
        <p data-classroom-qr-print-subtitle className="mt-3 text-2xl font-medium">Check in for attendance</p>
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
        className="aspect-[2/3] overflow-hidden sm:aspect-video"
      >
        <h2 id={titleId} className="sr-only">Check in for attendance</h2>
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
              title="Attendance QR unavailable"
              description={error}
              compact
              action={<Button type="button" onClick={() => void load()}>Try again</Button>}
            />
          </div>
        ) : entryUrl && presentation ? (
          <div className="flex h-full min-h-0 flex-col items-stretch justify-center gap-3 sm:flex-row sm:gap-6">
            <div className="flex w-full min-w-0 shrink-0 flex-col items-center justify-center px-3 text-center sm:w-1/3">
              <p className="text-3xl font-semibold leading-tight text-text-default sm:text-5xl">{classroomTitle}</p>
              <p className="mt-4 hidden text-xl font-medium leading-tight text-text-default sm:mt-6 sm:block sm:text-3xl">
                Check in for attendance
              </p>
              {attendanceHours ? (
                <p className="mt-2 hidden text-lg font-medium text-text-muted sm:mt-3 sm:block sm:text-2xl">{attendanceHours}</p>
              ) : null}
              <div className="mt-8 hidden sm:block">
                <TeacherWorkSurfaceIconMenuButton
                  ariaLabel="Poster settings"
                  tooltip="Poster settings"
                  icon={<Settings className="h-5 w-5" aria-hidden="true" />}
                  items={posterActions}
                  menuAriaLabel="Poster settings"
                  menuAlign="center"
                  variant="secondary"
                  className="h-11 w-11"
                />
              </div>
            </div>
            <div ref={qrRef} className="flex min-h-0 flex-none items-center justify-center sm:h-full sm:flex-1">
              <QrCode
                value={entryUrl}
                label={`${classroomTitle} check in for attendance QR code`}
                className="aspect-square w-full max-w-64 border-0 bg-qr-background p-[10%] sm:h-full sm:w-auto sm:max-w-full"
                codeClassName="h-full max-w-none"
              />
            </div>
            <div className="absolute left-3 top-3 sm:hidden">
              <TeacherWorkSurfaceIconMenuButton
                ariaLabel="QR options"
                tooltip="QR options"
                icon={<MoreVertical className="h-5 w-5" aria-hidden="true" />}
                items={posterActions}
                menuAlign="start"
                className="h-11 w-11"
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
            <div data-classroom-qr-print className="hidden h-screen w-screen">
              <style media="print">{'@page { size: portrait; margin: 0; }'}</style>
              {poster}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
