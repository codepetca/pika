'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, Printer, RotateCcw, Settings } from 'lucide-react'
import { TeacherWorkSurfaceIconMenuButton } from '@/components/teacher-work-surface/TeacherWorkSurfaceActionCluster'
import type { TeacherClassroomQrPresentation } from '@/lib/teacher-attendance'
import { fetchJSON, fetchJSONWithCache } from '@/lib/request-cache'
import { serializeQrSvg } from '@/lib/qr-svg'
import { Button, ConfirmDialog, ContentDialog, PageState, QrCode } from '@/ui'

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
  const qrRef = useRef<HTMLDivElement | null>(null)
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

  function downloadPoster() {
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

  const poster = entryUrl ? (
    <div className="flex h-full w-full flex-col items-center justify-center bg-qr-background p-8 text-center text-qr-foreground">
      <p className="text-2xl font-semibold">{classroomTitle}</p>
      <p className="mt-1 text-base">Scan to check in for attendance</p>
      <div className="mt-6 w-[min(70vw,70vh)] max-w-[760px]">
        <QrCode
          value={entryUrl}
          label={`${classroomTitle} permanent attendance QR code`}
          className="aspect-square w-full border-0 bg-qr-background p-[10%]"
          codeClassName="max-w-none"
        />
      </div>
      <p className="mt-5 text-sm">Sign in to Pika after scanning. Attendance must be open.</p>
    </div>
  ) : null

  return (
    <>
      <ContentDialog
        isOpen={isOpen}
        onClose={onClose}
        title="Classroom QR"
        subtitle={`${classroomTitle} · Reusable poster`}
        maxWidth="max-w-4xl"
        panelClassName="w-full"
        showFooterClose={false}
      >
        {loading ? (
          <PageState kind="loading" title="Loading classroom QR" compact />
        ) : error ? (
          <PageState
            kind="error"
            title="Classroom QR unavailable"
            description={error}
            compact
            action={<Button type="button" onClick={() => void load()}>Try again</Button>}
          />
        ) : entryUrl && presentation ? (
          <div className="grid items-center gap-5 md:grid-cols-2">
            <div ref={qrRef} className="mx-auto w-full max-w-md rounded-card border border-border bg-qr-background p-3 shadow-sm">
              <QrCode
                value={entryUrl}
                label={`${classroomTitle} permanent attendance QR code`}
                className="aspect-square w-full border-0 bg-qr-background p-8"
                codeClassName="max-w-none"
              />
            </div>
            <div className="flex flex-col gap-4 text-left">
              <div>
                <p className="text-lg font-semibold text-text-default">Print once and use every day</p>
                <p className="mt-1 text-sm leading-5 text-text-muted">
                  Students sign in to Pika after scanning. Check-in works only while attendance is open.
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-1">
                <Button type="button" variant="primary" className="w-full justify-center" onClick={printPoster}>
                  <Printer className="h-4 w-4" aria-hidden="true" /> Print poster
                </Button>
                <Button type="button" variant="secondary" className="w-full justify-center" onClick={downloadPoster}>
                  <Download className="h-4 w-4" aria-hidden="true" /> Download SVG
                </Button>
              </div>
              <div className="flex items-center justify-between border-t border-border pt-3">
                <span className="text-xs text-text-muted">Stable until you rotate it</span>
                <TeacherWorkSurfaceIconMenuButton
                  ariaLabel="Poster settings"
                  tooltip="Poster settings"
                  className="h-11 w-11"
                  menuAlign="end"
                  icon={<Settings className="h-4 w-4" aria-hidden="true" />}
                  items={[{
                    id: 'rotate-qr',
                    label: 'Rotate QR',
                    icon: <RotateCcw className="h-4 w-4" aria-hidden="true" />,
                    onSelect: () => setRotateOpen(true),
                  }]}
                />
              </div>
            </div>
          </div>
        ) : null}
      </ContentDialog>
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
