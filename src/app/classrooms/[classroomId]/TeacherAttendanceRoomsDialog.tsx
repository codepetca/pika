'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Button, DialogPanel, FormField, Input, QrCode, Select } from '@/ui'
import { fetchJSON } from '@/lib/request-cache'
import { serializeQrSvg } from '@/lib/qr-svg'
import { TeacherRoomPosterDialog } from './TeacherRoomPosterDialog'

type Room = { room_id: string; label: string; can_manage: boolean; paired: boolean; attendance_ready?: boolean; selectable?: false }
type RoomList = { shared_catalog?: true; rooms: Room[]; default_room_id: string | null; meeting: { room_id: string | null; revision: number; accepting_until: number | null } | null }

const ready = (room: Room) => (room.attendance_ready ?? room.paired) && room.selectable !== false

function initialRoom(list: RoomList) {
  return list.rooms.find(room => room.room_id === list.default_room_id)?.room_id ?? ''
}

type RoomContentProps = { classroomId: string; date: string; onBusyChange?: (busy: boolean) => void; onPoster: (roomId: string) => void; enabled: boolean; disabled?: boolean }

export function TeacherAttendanceRoomsDialog({ classroomId, date, isOpen, onClose }: { classroomId: string; date: string; isOpen: boolean; onClose: () => void }) {
  const titleId = useId()
  const [busy, setBusy] = useState(false)
  const [posterRoom, setPosterRoom] = useState<string | null>(null)
  useEffect(() => { if (!isOpen) setPosterRoom(null) }, [isOpen])
  const rooms = useTeacherAttendanceRoomsContent({ classroomId, date, enabled: isOpen, onBusyChange: setBusy, onPoster: setPosterRoom })
  return <>
    <DialogPanel isOpen={isOpen && !posterRoom} onClose={onClose} closeDisabled={busy} maxWidth="max-w-lg" ariaLabelledBy={titleId}>
      <h2 id={titleId} className="text-lg font-semibold">Attendance rooms</h2>
      <div className="min-h-0 overflow-y-auto">{rooms}</div>
    </DialogPanel>
    {isOpen && posterRoom && <TeacherRoomPosterDialog key={posterRoom} classroomId={classroomId} roomId={posterRoom} onClose={() => setPosterRoom(null)} />}
  </>
}

export function useTeacherAttendanceRoomsContent({ classroomId, date, enabled, disabled = false, onBusyChange, onPoster }: RoomContentProps) {
  const qrRef = useRef<HTMLDivElement>(null)
  const owner = `${classroomId}:${date}:${enabled}`
  const ownerRef = useRef({ key: owner, generation: 0 })
  if (ownerRef.current.key !== owner) ownerRef.current = { key: owner, generation: ownerRef.current.generation + 1 }
  const generation = ownerRef.current.generation
  const [listState, setListState] = useState<{ generation: number; value: RoomList | null } | null>(null)
  const list = listState?.generation === generation ? listState.value : null
  const setList = (value: RoomList | null | ((current: RoomList | null) => RoomList | null)) => {
    setListState(current => ({ generation, value: typeof value === 'function' ? value(current?.generation === generation ? current.value : null) : value }))
  }
  const [roomId, setRoomId] = useState('')
  const [label, setLabel] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [undo, setUndo] = useState<number | null>(null)
  const [displayUrl, setDisplayUrl] = useState('')
  const [pendingMeetingRoomId, setPendingMeetingRoomId] = useState<string | null>(null)
  const [meetingNeedsRefresh, setMeetingNeedsRefresh] = useState(false)
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])

  async function command(operation: string, fields: Record<string, unknown> = {}) {
    return fetchJSON<any>('/api/teacher/attendance/rooms', {
      init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ classroom_id: classroomId, date, operation, ...fields }) },
      errorMessage: 'Room attendance is temporarily unavailable',
    })
  }
  async function load(current: () => boolean) {
    const next = await command('list') as RoomList
    if (!current()) return
    setList(next)
    setMeetingNeedsRefresh(false)
    setRoomId(current => current === '' || next.rooms.some(room => room.room_id === current) ? current : initialRoom(next))
  }
  useEffect(() => {
    let active = true
    if (!enabled) return () => { active = false }
    setBusy(false); onBusyChange?.(false); setPendingMeetingRoomId(null); setList(null); setError(''); setUndo(null); setDisplayUrl(''); setNotice('')
    setMeetingNeedsRefresh(false)
    void command('list').then((next: RoomList) => {
      if (!active || ownerRef.current.generation !== generation) return
      setList(next); setRoomId(initialRoom(next))
    }).catch((err: Error) => { if (active && ownerRef.current.generation === generation) setError(err.message) })
    return () => { active = false }
    // Reload when the dialog or selected attendance day changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classroomId, date, enabled])

  async function act(operation: string, fields: Record<string, unknown> = {}) {
    const current = () => active.current && ownerRef.current.generation === generation
    setBusy(true); onBusyChange?.(true); setError(''); setDisplayUrl('')
    let undoCompleted = false
    try {
      if (operation !== 'list') {
        const result = await command(operation, fields)
        if (!current()) return
        if (operation === 'move' && typeof fields.room_id === 'string') {
          const meetingRoomId = fields.room_id
          setUndo(result.revision)
          setList(current => current?.meeting ? {
            ...current,
            meeting: { ...current.meeting, room_id: meetingRoomId, revision: result.revision },
          } : current)
        }
        if (operation === 'undo') {
          undoCompleted = true
          setUndo(null)
        }
        if (operation === 'pair') setDisplayUrl(result.display_url)
        if (operation === 'create') { setLabel(''); setRoomId(result.room_id) }
      }
      await load(current)
    } catch (err) {
      if (!current()) return
      if (undoCompleted) setMeetingNeedsRefresh(true)
      setError(err instanceof Error ? err.message : 'Room attendance is temporarily unavailable')
    }
    finally { if (current()) { setBusy(false); onBusyChange?.(false) } }
  }
  async function moveMeeting(destination: string) {
    if (busy || disabled || !list?.meeting || destination === list.meeting.room_id || !list.rooms.some(room => room.room_id === destination && ready(room))) return
    const ownerAtMove = generation
    setPendingMeetingRoomId(destination)
    try {
      await act('move', { room_id: destination })
    } finally {
      if (active.current && ownerRef.current.generation === ownerAtMove) setPendingMeetingRoomId(null)
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
    label: (room.attendance_ready ?? room.paired) ? room.label : `${room.label} (unpaired)`,
    paired: ready(room),
  }))
  const canSaveDefault = Boolean(list && (roomId || null) !== list.default_room_id && (roomId === '' || selected && ready(selected)))
  return <div className="space-y-4 p-1">
      {listState?.generation === generation && error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {!list && (listState?.generation !== generation || !error) && <p>Loading rooms…</p>}
      {list && <>
        {rooms.length > 0 && <>
          {meetingNeedsRefresh && <Button variant="secondary" disabled={busy || disabled} onClick={() => void act('list')}>Refresh rooms</Button>}
          {list.meeting && !meetingNeedsRefresh && <div className="space-y-2">
            <FormField label="This meeting">
              <Select
                value={pendingMeetingRoomId ?? meetingRoom?.room_id ?? ''}
                disabled={busy || disabled || !rooms.some(ready)}
                aria-busy={pendingMeetingRoomId !== null}
                onChange={event => void moveMeeting(event.target.value)}
                options={[
                  { value: '', label: 'No room', disabled: true },
                  ...roomOptions.map(option => ({ ...option, disabled: !option.paired })),
                ]}
              />
            </FormField>
            {pendingMeetingRoomId !== null && <p role="status" className="text-sm text-text-muted">Moving meeting…</p>}
            {undo !== null && <Button variant="secondary" disabled={busy || disabled} onClick={() => void act('undo', { revision: undo })}>Undo move</Button>}
          </div>}
          <FormField label="Default room" >
            <Select
              value={roomId}
              disabled={busy || disabled}
              onChange={event => { setRoomId(event.target.value); setDisplayUrl('') }}
              options={[{ value: '', label: 'None' }, ...roomOptions.map(option => ({ ...option, disabled: !option.paired }))]}
            />
          </FormField>
          <Button variant="secondary" disabled={busy || disabled || !canSaveDefault} onClick={() => void act('default', { room_id: roomId || null })}>Save default</Button>
          {list.shared_catalog && selected && selected.selectable !== false && <Button variant="secondary" disabled={busy || disabled} onClick={() => onPoster(selected.room_id)}>Print student poster</Button>}
          {selected && typeof window !== 'undefined' && <div className="space-y-2"><p className="text-sm">Teacher room sticker: scan to move an open class here.</p><div ref={qrRef}><QrCode value={`${window.location.origin}/attendance/room/${selected.room_id}/move`} label="Teacher room sticker" className="w-40 bg-qr-background p-4" /></div><Button variant="secondary" onClick={downloadSticker}>Download sticker</Button></div>}
          {!list.shared_catalog && selected?.can_manage && <><FormField label="Room display notice"><Input value={notice} maxLength={200} onChange={event => setNotice(event.target.value)} /></FormField><p className="text-sm text-text-muted">Replace the display notices with this message, or clear them.</p><div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={busy || disabled || !notice.trim()} onClick={() => void act('notices', { room_id: roomId, notices: [notice.trim()] })}>Publish notice</Button><Button variant="secondary" disabled={busy || disabled} onClick={() => void act('notices', { room_id: roomId, notices: [] })}>Clear notices</Button></div><div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={busy || disabled} onClick={() => void act('pair', { room_id: roomId })}>Pair room display</Button><Button variant="secondary" disabled={busy || disabled || !selected.paired} onClick={() => void act('revoke', { room_id: roomId })}>Disconnect display</Button></div></>}
          {displayUrl && <p className="break-all text-sm">Open on the room display: <a className="underline" href={displayUrl} rel="noreferrer">Open paired display</a> <Button variant="secondary" onClick={() => void navigator.clipboard.writeText(displayUrl).then(() => setError(''), () => setError('Could not copy the display link'))}>Copy link</Button></p>}
        </>}
        {!list.shared_catalog && <><FormField label="New room name"><Input value={label} maxLength={80} onChange={e => setLabel(e.target.value)} /></FormField>
        <Button variant="secondary" disabled={busy || disabled || !label.trim()} onClick={() => void act('create', { label: label.trim() })}>Create room</Button></>}
      </>}
    </div>
}
