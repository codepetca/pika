'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Download, Printer, RotateCcw } from 'lucide-react'
import { AttendancePoster } from './AttendancePoster'
import type { TeacherClassroomQrPresentation } from '@/lib/teacher-attendance'
import { fetchJSON, fetchJSONWithCache } from '@/lib/request-cache'
import { serializeQrSvg } from '@/lib/qr-svg'
import { Button, ConfirmDialog, DialogPanel, PageState } from '@/ui'

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
          <AttendancePoster title={classroomTitle} url={entryUrl} attendanceHours={attendanceHours} qrRef={qrRef} posterActions={posterActions} />
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

    </>
  )
}
