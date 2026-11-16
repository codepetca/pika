'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Button, DialogPanel, FormField, Input, QrCode, Select } from '@/ui'
import { fetchJSON } from '@/lib/request-cache'
import { serializeQrSvg } from '@/lib/qr-svg'

type Room = { room_id: string; label: string; can_manage: boolean; paired: boolean }
type RoomList = { rooms: Room[]; default_room_id: string | null; meeting: { room_id: string | null; revision: number; accepting_until: number | null } | null }

function initialRoom(list: RoomList) {
  return list.rooms.find(room => room.room_id === list.default_room_id)?.room_id ?? ''
}

export function TeacherAttendanceRoomsDialog({ classroomId, date, isOpen, onClose }: { classroomId: string; date: string; isOpen: boolean; onClose: () => void }) {
  const titleId = useId()
  const qrRef = useRef<HTMLDivElement>(null)
  const [list, setList] = useState<RoomList | null>(null)
  const [roomId, setRoomId] = useState('')
  const [label, setLabel] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [undo, setUndo] = useState<number | null>(null)
  const [displayUrl, setDisplayUrl] = useState('')
  const [pendingMeetingRoomId, setPendingMeetingRoomId] = useState<string | null>(null)

  async function command(operation: string, fields: Record<string, unknown> = {}) {
    return fetchJSON<any>('/api/teacher/attendance/rooms', {
      init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ classroom_id: classroomId, date, operation, ...fields }) },
      errorMessage: 'Room attendance is temporarily unavailable',
    })
  }
  async function load() {
    const next = await command('list') as RoomList
    setList(next)
    setRoomId(current => current === '' || next.rooms.some(room => room.room_id === current) ? current : initialRoom(next))
  }
  useEffect(() => {
    if (!isOpen) return
    let active = true
    setList(null); setError(''); setUndo(null); setDisplayUrl(''); setNotice('')
    void command('list').then((next: RoomList) => {
      if (!active) return
      setList(next); setRoomId(initialRoom(next))
    }).catch((err: Error) => { if (active) setError(err.message) })
    return () => { active = false }
    // Reload when the dialog or selected attendance day changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, classroomId, date])

  async function act(operation: string, fields: Record<string, unknown> = {}) {
    setBusy(true); setError(''); setDisplayUrl('')
    try {
      const result = await command(operation, fields)
      if (operation === 'move' && typeof fields.room_id === 'string') {
        const meetingRoomId = fields.room_id
        setUndo(result.revision)
        setList(current => current?.meeting ? {
          ...current,
          meeting: { ...current.meeting, room_id: meetingRoomId, revision: result.revision },
        } : current)
      }
      if (operation === 'undo') setUndo(null)
      if (operation === 'pair') setDisplayUrl(result.display_url)
      if (operation === 'create') { setLabel(''); setRoomId(result.room_id) }
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Room attendance is temporarily unavailable') }
    finally { setBusy(false) }
  }
  async function moveMeeting(destination: string) {
    if (busy || !list?.meeting || destination === list.meeting.room_id || !list.rooms.some(room => room.room_id === destination && room.paired)) return
    setPendingMeetingRoomId(destination)
    try {
      await act('move', { room_id: destination })
    } finally {
      setPendingMeetingRoomId(null)
    }
  }
  function downloadSticker() {
    const svg = qrRef.current?.querySelector('svg')
    if (!svg) return
    const url = URL.createObjectURL(new Blob([serializeQrSvg(svg)], { type: 'image/svg+xml;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'attendance-room-sticker.svg'
    link.click()
    URL.revokeObjectURL(url)
  }
  const rooms = list?.rooms ?? []
  const selected = rooms.find(room => room.room_id === roomId)
  const meetingRoom = rooms.find(room => room.room_id === list?.meeting?.room_id)
  const roomOptions = rooms.map(room => ({
    value: room.room_id,
    label: room.paired ? room.label : `${room.label} (unpaired)`,
    paired: room.paired,
  }))
  const canSaveDefault = Boolean(list && (roomId || null) !== list.default_room_id && (roomId === '' || selected?.paired))
  return <DialogPanel isOpen={isOpen} onClose={onClose} closeDisabled={busy} maxWidth="max-w-lg" ariaLabelledBy={titleId}>
    <h2 id={titleId} className="text-lg font-semibold">Attendance rooms</h2>
    <div className="space-y-4 overflow-y-auto p-1">
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {!list && !error && <p>Loading rooms…</p>}
      {list && <>
        {rooms.length > 0 && <>
          {list.meeting && <div className="space-y-2">
            <FormField label="This meeting">
              <Select
                value={pendingMeetingRoomId ?? meetingRoom?.room_id ?? ''}
                disabled={busy || !rooms.some(room => room.paired)}
                aria-busy={pendingMeetingRoomId !== null}
                onChange={event => void moveMeeting(event.target.value)}
                options={[
                  { value: '', label: 'No room', disabled: true },
                  ...roomOptions.map(option => ({ ...option, disabled: !option.paired })),
                ]}
              />
            </FormField>
            {pendingMeetingRoomId !== null && <p role="status" className="text-sm text-text-muted">Moving meeting…</p>}
            {undo !== null && <Button variant="secondary" disabled={busy} onClick={() => void act('undo', { revision: undo })}>Undo move</Button>}
          </div>}
          <FormField label="Default room" hideLabel={!list.meeting} collapseHiddenLabel>
            <Select
              value={roomId}
              disabled={busy}
              onChange={event => { setRoomId(event.target.value); setDisplayUrl('') }}
              options={[{ value: '', label: 'None' }, ...roomOptions]}
            />
          </FormField>
          <Button variant="secondary" disabled={busy || !canSaveDefault} onClick={() => void act('default', { room_id: roomId || null })}>Save default</Button>
          {selected && typeof window !== 'undefined' && <div className="space-y-2"><p className="text-sm">Teacher room sticker: scan to move an open class here.</p><div ref={qrRef}><QrCode value={`${window.location.origin}/attendance/room/${selected.room_id}/move`} label="Teacher room sticker" className="w-40 bg-qr-background p-4" /></div><Button variant="secondary" onClick={downloadSticker}>Download sticker</Button></div>}
          {selected?.can_manage && <><FormField label="Room display notice"><Input value={notice} maxLength={200} onChange={event => setNotice(event.target.value)} /></FormField><p className="text-sm text-text-muted">Replace the display notices with this message, or clear them.</p><div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={busy || !notice.trim()} onClick={() => void act('notices', { room_id: roomId, notices: [notice.trim()] })}>Publish notice</Button><Button variant="secondary" disabled={busy} onClick={() => void act('notices', { room_id: roomId, notices: [] })}>Clear notices</Button></div><div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={busy} onClick={() => void act('pair', { room_id: roomId })}>Pair room display</Button><Button variant="secondary" disabled={busy || !selected.paired} onClick={() => void act('revoke', { room_id: roomId })}>Disconnect display</Button></div></>}
          {displayUrl && <p className="break-all text-sm">Open on the room display: <a className="underline" href={displayUrl} rel="noreferrer">Open paired display</a> <Button variant="secondary" onClick={() => void navigator.clipboard.writeText(displayUrl).then(() => setError(''), () => setError('Could not copy the display link'))}>Copy link</Button></p>}
        </>}
        <FormField label="New room name"><Input value={label} maxLength={80} onChange={e => setLabel(e.target.value)} /></FormField>
        <Button variant="secondary" disabled={busy || !label.trim()} onClick={() => void act('create', { label: label.trim() })}>Create room</Button>
      </>}
    </div>
  </DialogPanel>
}
