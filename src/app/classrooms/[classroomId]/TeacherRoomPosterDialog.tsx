'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Download, Printer } from 'lucide-react'
import { fetchJSON } from '@/lib/request-cache'
import { serializeQrSvg } from '@/lib/qr-svg'
import { Button, DialogPanel, PageState } from '@/ui'
import { AttendancePoster } from './AttendancePoster'

type Poster = { label: string; student_poster_url: string | null }

function validPoster(value: Poster, roomId: string): boolean {
  if (typeof value.label !== 'string' || !value.label.trim() || value.label.length > 80) return false
  if (value.student_poster_url === null) return true
  try {
    const url = new URL(value.student_poster_url)
    return (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
      && !url.username && !url.password && !url.hash && url.pathname === `/rooms/${roomId}/scan`
      && [...url.searchParams.keys()].length === 1 && /^[A-Za-z0-9_-]{40}$/.test(url.searchParams.get('poster') ?? '')
  } catch { return false }
}

export function TeacherRoomPosterDialog({ classroomId, roomId, onClose }: {
  classroomId: string
  roomId: string
  onClose: () => void
}) {
  const titleId = useId()
  const qrRef = useRef<HTMLDivElement>(null)
  const [poster, setPoster] = useState<Poster | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setPoster(null); setError('')
    void fetchJSON<Poster>('/api/teacher/attendance/rooms', {
      init: { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ classroom_id: classroomId, operation: 'poster', room_id: roomId }) },
      errorMessage: 'Student poster is temporarily unavailable',
    }).then(value => {
      if (!validPoster(value, roomId)) throw new Error('Student poster is temporarily unavailable')
      if (active) setPoster(value)
    }).catch(() => { if (active) setError('Student poster is temporarily unavailable') })
    return () => { active = false }
  }, [classroomId, roomId, attempt])
  function printPoster() {
    document.body.dataset.printClassroomQr = 'true'
    const cleanup = () => { delete document.body.dataset.printClassroomQr; window.removeEventListener('afterprint', cleanup) }
    window.addEventListener('afterprint', cleanup)
    window.print()
  }
  function downloadQr() {
    const svg = qrRef.current?.querySelector('svg')
    if (!svg || !poster) return
    const url = URL.createObjectURL(new Blob([serializeQrSvg(svg)], { type: 'image/svg+xml;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${poster.label.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'room'}-attendance-qr.svg`
    link.click(); URL.revokeObjectURL(url)
  }
  const actions = [
    { id: 'print-poster', label: 'Print poster', icon: <Printer className="h-4 w-4" aria-hidden="true" />, onSelect: printPoster },
    { id: 'download-svg', label: 'Download SVG', icon: <Download className="h-4 w-4" aria-hidden="true" />, onSelect: downloadQr },
  ]
  return <DialogPanel isOpen onClose={onClose} ariaLabelledBy={titleId} maxWidth="max-w-6xl" className="aspect-[2/3] overflow-hidden sm:aspect-video">
    <h2 id={titleId} className="sr-only">Student attendance poster</h2>
    {!poster && !error ? <div className="flex h-full items-center justify-center"><PageState kind="loading" title="Loading student poster" compact /></div>
      : error ? <div className="flex h-full items-center justify-center"><PageState kind="error" title="Student poster unavailable" description={error} compact action={<Button onClick={() => setAttempt(value => value + 1)}>Try again</Button>} /></div>
      : poster?.student_poster_url === null ? <div className="flex h-full items-center justify-center"><PageState kind="empty" title="Student poster unavailable" description="Ask an administrator to enable the student QR for this room." compact /></div>
      : poster?.student_poster_url ? <AttendancePoster title={poster.label} url={poster.student_poster_url} attendanceHours={null} qrRef={qrRef} posterActions={actions} /> : null}
  </DialogPanel>
}
