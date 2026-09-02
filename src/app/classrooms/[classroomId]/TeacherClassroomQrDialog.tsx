'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, Printer, RotateCcw } from 'lucide-react'
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
    } catch (rotationError) {
      if (version !== requestVersion.current) return
      setRotateError(rotationError instanceof Error
        ? rotationError.message
        : 'Permanent classroom QR could not be rotated')
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
        title="Classroom QR poster"
        subtitle="Stable until you rotate it"
        maxWidth="max-w-3xl"
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
          <div className="flex flex-col items-center gap-4 text-center">
            <div ref={qrRef} className="w-full max-w-md">
              <QrCode
                value={entryUrl}
                label={`${classroomTitle} permanent attendance QR code`}
                className="aspect-square w-full bg-qr-background p-[10%]"
                codeClassName="max-w-none"
              />
            </div>
            <div>
              <p className="font-medium text-text-default">Print once and use for every class</p>
              <p className="mt-1 text-sm text-text-muted">
                Students sign in to Pika. The poster works only while this classroom has open attendance.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <Button type="button" variant="secondary" onClick={printPoster}>
                <Printer className="h-4 w-4" aria-hidden="true" /> Print
              </Button>
              <Button type="button" variant="secondary" onClick={downloadPoster}>
                <Download className="h-4 w-4" aria-hidden="true" /> Download SVG
              </Button>
              <Button type="button" variant="secondary" onClick={() => setRotateOpen(true)}>
                <RotateCcw className="h-4 w-4" aria-hidden="true" /> Rotate QR
              </Button>
            </div>
          </div>
        ) : null}
      </ContentDialog>
      <ConfirmDialog
        isOpen={rotateOpen}
        title="Rotate classroom QR?"
        description="The current poster will stop working immediately. Print and replace it with the new QR."
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
