'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Button, DialogPanel, FormField, Select } from '@/ui'
import { fetchJSON } from '@/lib/request-cache'
import { TeacherRoomPosterDialog } from './TeacherRoomPosterDialog'

type Room = { room_id: string; label: string; can_manage: boolean; paired: boolean; attendance_ready?: boolean; selectable?: false }
type RoomList = { shared_catalog?: true; rooms: Room[]; default_room_id: string | null; meeting: { room_id: string | null; revision: number; accepting_until: number | null } | null }

const ready = (room: Room) => (room.attendance_ready ?? room.paired) && room.selectable !== false

type RoomContentProps = { classroomId: string; date: string; onBusyChange?: (busy: boolean) => void; onPoster: (roomId: string) => void; enabled: boolean; disabled?: boolean }

export function TeacherAttendanceRoomsDialog({ classroomId, date, isOpen, onClose }: { classroomId: string; date: string; isOpen: boolean; onClose: () => void }) {
  const titleId = useId()
  const [busy, setBusy] = useState(false)
  const [posterRoom, setPosterRoom] = useState<string | null>(null)
  useEffect(() => { if (!isOpen) setPosterRoom(null) }, [isOpen])
  const rooms = useTeacherAttendanceRoomsContent({ classroomId, date, enabled: isOpen, onBusyChange: setBusy, onPoster: setPosterRoom })
  return <>
    <DialogPanel isOpen={isOpen && !posterRoom} onClose={onClose} closeDisabled={busy} maxWidth="max-w-lg" ariaLabelledBy={titleId}>
      <h2 id={titleId} className="text-lg font-semibold">Attendance Location</h2>
      <div className="min-h-0 overflow-y-auto">{rooms}</div>
    </DialogPanel>
    {isOpen && posterRoom && <TeacherRoomPosterDialog key={posterRoom} classroomId={classroomId} roomId={posterRoom} onClose={() => setPosterRoom(null)} />}
  </>
}

type LocationUndo = { previousDefault: string | null; previousMeeting: string | null; revision: number | null; restoreDefault: boolean; meetingUndone: boolean }

export function useTeacherAttendanceRoomsContent({ classroomId, date, enabled, disabled = false, onBusyChange, onPoster }: RoomContentProps) {
  const owner = `${classroomId}:${date}:${enabled}`
  const ownerRef = useRef({ key: owner, generation: 0 })
  if (ownerRef.current.key !== owner) ownerRef.current = { key: owner, generation: ownerRef.current.generation + 1 }
  const generation = ownerRef.current.generation
  const [listState, setListState] = useState<{ generation: number; value: RoomList | null } | null>(null)
  const list = listState?.generation === generation ? listState.value : null
  const setList = (value: RoomList | null | ((current: RoomList | null) => RoomList | null)) => {
    setListState(current => ({ generation, value: typeof value === 'function' ? value(current?.generation === generation ? current.value : null) : value }))
  }
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [needsRefresh, setNeedsRefresh] = useState(false)
  const [recovery, setRecovery] = useState<'undoMeeting' | 'undoDefault' | null>(null)
  const [pendingRoom, setPendingRoom] = useState<string | null>(null)
  const [undo, setUndo] = useState<LocationUndo | null>(null)
  const [noticeGeneration, setNoticeGeneration] = useState<number | null>(null)
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const current = () => active.current && ownerRef.current.generation === generation

  async function command(operation: string, fields: Record<string, unknown> = {}) {
    return fetchJSON<any>('/api/teacher/attendance/rooms', {
      init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ classroom_id: classroomId, date, operation, ...fields }) },
      errorMessage: 'Room attendance is temporarily unavailable',
    })
  }
  useEffect(() => {
    let activeLoad = true
    if (!enabled) return () => { activeLoad = false }
    setBusy(false); onBusyChange?.(false); setPendingRoom(null); setNeedsRefresh(false); setRecovery(null); setList(null); setError(''); setUndo(null); setNoticeGeneration(null)
    void command('list').then((next: RoomList) => {
      if (activeLoad && current()) setList(next)
    }).catch((err: Error) => { if (activeLoad && current()) setError(err.message) })
    return () => { activeLoad = false }
    // Each classroom, date and open lifetime has its own location snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classroomId, date, enabled])

  async function refreshAfterWrite() {
    try {
      const next = await command('list') as RoomList
      if (!current()) return false
      setList(next); setNeedsRefresh(false)
      return next
    } catch {
      if (current()) { setNeedsRefresh(true); setError('Location changed, but could not be refreshed. Refresh to continue.') }
      return null
    }
  }

  async function retryRefresh() {
    if (busy || disabled) return
    setBusy(true); onBusyChange?.(true); setError('')
    try {
      const next = await command('list') as RoomList
      if (!current()) return
      setList(next); setNeedsRefresh(false)
      if (recovery && undo) {
        if ((undo.revision === null || next.meeting !== null) && (next.meeting?.room_id ?? null) === undo.previousMeeting) {
          if (!undo.restoreDefault || next.default_room_id === undo.previousDefault) setUndo(null)
          else {
            setUndo({ ...undo, meetingUndone: true })
            setError('Meeting restored. Retry undo to restore the future attendance location.')
          }
        } else if (recovery === 'undoMeeting' && next.meeting && next.meeting.revision === undo.revision) {
          setError('Undo was not confirmed. You can retry the location change undo.')
        } else {
          setUndo(null)
          setError('Attendance location changed elsewhere. Review the current location before making another change.')
        }
      }
      setRecovery(null)
    } catch {
      if (current()) setError('Could not refresh the attendance location. Try again.')
    } finally {
      if (current()) { setBusy(false); onBusyChange?.(false) }
    }
  }

  async function chooseLocation(destination: string) {
    if (!list || busy || disabled || needsRefresh || undo?.meetingUndone || !list.rooms.some(room => room.room_id === destination && ready(room))) return
    const needsMove = Boolean(list.meeting && list.meeting.room_id !== destination)
    const needsDefault = list.default_room_id !== destination
    if (!needsMove && !needsDefault) return
    const previousDefault = list.default_room_id
    const previousMeeting = list.meeting?.room_id ?? null
    const canUndo = !needsDefault || previousDefault === null || list.rooms.some(room => room.room_id === previousDefault && ready(room))
    setNoticeGeneration(null)
    setBusy(true); onBusyChange?.(true); setPendingRoom(destination); setError('')
    try {
      const result = needsMove
        ? await command('move', { room_id: destination, save_default: true })
        : await command('default', { room_id: destination })
      if (!current()) return
      setUndo(canUndo ? { previousDefault, previousMeeting, revision: needsMove ? result.revision : null, restoreDefault: needsDefault, meetingUndone: false } : null)
      setList(previous => previous ? { ...previous, default_room_id: destination, meeting: previous.meeting && needsMove ? { ...previous.meeting, room_id: destination, revision: result.revision } : previous.meeting } : previous)
      const refreshed = await refreshAfterWrite()
      if (refreshed && current() && !canUndo && refreshed.default_room_id === destination && (!needsMove || refreshed.meeting?.room_id === destination)) setNoticeGeneration(generation)
    } catch (err) {
      if (current()) {
        setUndo(null); setRecovery(null); setNeedsRefresh(true)
        setError(`${err instanceof Error ? err.message : 'Room attendance is temporarily unavailable'}. Refresh location to check whether the change was applied.`)
      }
    } finally {
      if (current()) { setBusy(false); onBusyChange?.(false); setPendingRoom(null) }
    }
  }

  async function undoLocation() {
    if (!undo || busy || disabled || needsRefresh) return
    setBusy(true); onBusyChange?.(true); setError('')
    let meetingUndone = undo.meetingUndone
    try {
      if (undo.revision !== null && !meetingUndone) {
        await command('undo', { revision: undo.revision })
        if (!current()) return
        meetingUndone = true
        setUndo({ ...undo, meetingUndone: true })
        setList(previous => previous?.meeting ? { ...previous, meeting: { ...previous.meeting, room_id: undo.previousMeeting } } : previous)
      }
      if (undo.restoreDefault) {
        await command('default', { room_id: undo.previousDefault })
        if (!current()) return
        setList(previous => previous ? { ...previous, default_room_id: undo.previousDefault } : previous)
      }
      setUndo(null)
      await refreshAfterWrite()
    } catch {
      if (!current()) return
      setUndo({ ...undo, meetingUndone })
      setRecovery(meetingUndone ? 'undoDefault' : 'undoMeeting')
      setNeedsRefresh(true)
      setError('Undo could not be confirmed. Refresh location before continuing.')
    } finally {
      if (current()) { setBusy(false); onBusyChange?.(false) }
    }
  }

  const location = pendingRoom ?? (list?.meeting ? list.meeting.room_id ?? '' : list?.default_room_id ?? '')
  const rooms = list?.rooms ?? []
  const selected = rooms.find(room => room.room_id === location)
  const partialUndo = Boolean(undo?.meetingUndone && undo.restoreDefault)
  const options = rooms.map(room => ({ value: room.room_id, label: (room.attendance_ready ?? room.paired) ? room.label : `${room.label} (unpaired)`, disabled: !ready(room) }))
  if (location && !selected) options.unshift({ value: location, label: 'Current location unavailable', disabled: true })
  return <div className="space-y-4 p-1">
    {listState?.generation === generation && error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {!list && (listState?.generation !== generation || !error) && <p>Loading rooms…</p>}
    {noticeGeneration === generation && <p role="status" className="text-sm text-text-muted">Previous location unavailable. Undo is unavailable.</p>}
    {needsRefresh && <Button variant="secondary" disabled={busy || disabled} onClick={() => void retryRefresh()}>Refresh location</Button>}
    {list && (rooms.length === 0 && !location ? <p className="text-sm text-text-muted">No attendance locations are available.</p> : <>
      <FormField label="Attendance Location" hideLabel collapseHiddenLabel>
        <Select value={location} disabled={busy || disabled || partialUndo || needsRefresh || !rooms.some(ready)} aria-busy={pendingRoom !== null}
          onChange={event => void chooseLocation(event.target.value)}
          options={[{ value: '', label: 'Choose a room', disabled: true }, ...options]} />
      </FormField>
      {pendingRoom !== null && <p role="status" className="text-sm text-text-muted">Updating attendance location…</p>}
      {(undo || list.shared_catalog && selected && selected.selectable !== false) && <div className="flex flex-wrap gap-2">
        {undo && <Button variant="secondary" disabled={busy || disabled || needsRefresh} onClick={() => void undoLocation()}>{partialUndo ? 'Retry undo' : 'Undo location change'}</Button>}
        {list.shared_catalog && selected && selected.selectable !== false && <Button variant="secondary" disabled={busy || disabled || partialUndo || needsRefresh} onClick={() => onPoster(selected.room_id)}>Print student poster</Button>}
      </div>}
    </>)}
  </div>
}
