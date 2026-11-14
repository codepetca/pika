'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Button, DialogPanel, FormField, Input, QrCode, Select } from '@/ui'
import { fetchJSON } from '@/lib/request-cache'
import { serializeQrSvg } from '@/lib/qr-svg'

type Room = { room_id: string; label: string; can_manage: boolean; paired: boolean }
type RoomList = { display_setup_url: string | null; rooms: Room[]; default_room_id: string | null; meeting: { room_id: string | null; revision: number; accepting_until: number | null } | null }

function initialRoom(list: RoomList) {
  return [list.meeting?.room_id, list.default_room_id].find(id => list.rooms.some(room => room.room_id === id))
    ?? list.rooms[0]?.room_id ?? ''
}

export function TeacherAttendanceRoomsDialog({ classroomId, date, isOpen, onClose }: { classroomId: string; date: string; isOpen: boolean; onClose: () => void }) {
  const titleId = useId()
  const qrRef = useRef<HTMLDivElement>(null)
  const [list, setList] = useState<RoomList | null>(null)
  const [roomId, setRoomId] = useState('')
  const [label, setLabel] = useState('')
  const [pairingCode, setPairingCode] = useState('')
  const [success, setSuccess] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [undo, setUndo] = useState<number | null>(null)
  const [displayUrl, setDisplayUrl] = useState('')
  const [saveDefault, setSaveDefault] = useState(false)

  async function command(operation: string, fields: Record<string, unknown> = {}) {
    return fetchJSON<any>('/api/teacher/attendance/rooms', {
      init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ classroom_id: classroomId, date, operation, ...fields }) },
      errorMessage: 'Room attendance is temporarily unavailable',
    })
  }
  async function load() {
    const next = await command('list') as RoomList
    setList(next)
    setRoomId(current => next.rooms.some(room => room.room_id === current) ? current : initialRoom(next))
  }
  useEffect(() => {
    if (!isOpen) return
    let active = true
    setList(null); setError(''); setSuccess(''); setPairingCode(''); setUndo(null); setDisplayUrl(''); setNotice(''); setSaveDefault(false)
    void command('list').then((next: RoomList) => {
      if (!active) return
      setList(next); setRoomId(initialRoom(next))
    }).catch((err: Error) => { if (active) setError(err.message) })
    return () => { active = false }
    // Reload when the dialog or selected attendance day changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, classroomId, date])

  async function act(operation: string, fields: Record<string, unknown> = {}) {
    setBusy(true); setError(''); setSuccess(''); setDisplayUrl('')
    try {
      const result = await command(operation, fields)
      if (operation === 'move') setUndo(result.revision)
      if (operation === 'undo') setUndo(null)
      if (operation === 'pair') setDisplayUrl(result.display_url)
      if (operation === 'pair_code') { setPairingCode(''); setSuccess(`${selected?.label ?? 'Room'} display paired`) }
      if (operation === 'create') { setLabel(''); setRoomId(result.room_id) }
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : 'Room attendance is temporarily unavailable') }
    finally { setBusy(false) }
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
  const selected = list?.rooms.find(room => room.room_id === roomId)
  const canonicalCode = pairingCode.replace(/[ -]/g, '').toUpperCase()
  const validCode = /^[0-9A-HJKMNP-TV-Z]{8}$/.test(canonicalCode)
  const canMove = Boolean(selected?.paired && list?.meeting && list.meeting.room_id !== roomId)
  return <DialogPanel isOpen={isOpen} onClose={onClose} maxWidth="max-w-lg" ariaLabelledBy={titleId}>
    <h2 id={titleId} className="text-lg font-semibold">Attendance rooms</h2>
    <div className="space-y-4 overflow-y-auto p-1">
      <p className="text-sm text-text-muted">Choose where this class meets. A room display can serve several classes at once.</p>
      {success && <p role="status" className="text-sm">{success}</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {!list && !error && <p>Loading rooms…</p>}
      {list && <>
        {list.rooms.length > 0 && <>
          <FormField label="Room"><Select value={roomId} disabled={busy} onChange={e => { setRoomId(e.target.value); setDisplayUrl(''); setSuccess(''); setPairingCode('') }} options={list.rooms.map(room => ({ value: room.room_id, label: room.paired ? room.label : `${room.label} (unpaired)` }))} /></FormField>
          <p className="text-sm text-text-muted">Changing the default affects future meetings. Move this meeting separately if it has already started.</p>
          <p className="text-sm text-text-muted">Default: {list.rooms.find(room => room.room_id === list.default_room_id)?.label ?? 'None'}. Current meeting: {list.rooms.find(room => room.room_id === list.meeting?.room_id)?.label ?? 'No room'}.</p>
          {canMove && <Button variant="secondary" aria-pressed={saveDefault} disabled={busy} onClick={() => setSaveDefault(value => !value)}>Also use as the default for future meetings</Button>}
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || !roomId || !canMove} onClick={() => void act('move', { room_id: roomId, save_default: saveDefault })}>Move this meeting</Button>
            <Button variant="secondary" disabled={busy || !selected?.paired || list.default_room_id === roomId} onClick={() => void act('default', { room_id: roomId })}>Set default for future meetings</Button>
            {list.default_room_id && <Button variant="secondary" disabled={busy} onClick={() => void act('default', { room_id: null })}>Clear default</Button>}
            {undo !== null && <Button variant="secondary" disabled={busy} onClick={() => void act('undo', { revision: undo })}>Undo move</Button>}
          </div>
          {selected && typeof window !== 'undefined' && <div className="space-y-2"><p className="text-sm">Teacher room sticker: scan to move an open class here.</p><div ref={qrRef}><QrCode value={`${window.location.origin}/attendance/room/${selected.room_id}/move`} label="Teacher room sticker" className="w-40 bg-qr-background p-4" /></div><Button variant="secondary" onClick={downloadSticker}>Download sticker</Button></div>}
          {selected?.can_manage && <>
            {list.display_setup_url && <form className="space-y-2" onSubmit={event => {
              event.preventDefault()
              if (validCode && !busy) void act('pair_code', { room_id: roomId, pairing_code: canonicalCode })
            }}>
              <p className="text-sm">On the room display, open{' '}
                <a className="break-all underline" href={list.display_setup_url} target="_blank" rel="noreferrer">{list.display_setup_url}</a>
                {' '}and enter its code here.
              </p>
              {selected.paired && <p className="text-sm text-text-muted">Pairing a new display will disconnect the current display.</p>}
              <FormField label="Display pairing code">
                <Input value={pairingCode} maxLength={15} autoComplete="off" autoCapitalize="characters" spellCheck={false}
                  placeholder="ABCD-EFGH" onChange={event => setPairingCode(event.target.value.toUpperCase().replace(/[ -]/g, '').replace(/^(.{4})(?=.)/, '$1-'))} />
              </FormField>
              <Button type="submit" disabled={busy || !validCode}>Pair display</Button>
            </form>}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" disabled={busy} onClick={() => void act('pair', { room_id: roomId })}>Create pairing link instead</Button>
              <Button variant="secondary" disabled={busy || !selected.paired} onClick={() => void act('revoke', { room_id: roomId })}>Disconnect display</Button>
            </div>
            <FormField label="Room display notice"><Input value={notice} maxLength={200} onChange={event => setNotice(event.target.value)} /></FormField>
            <p className="text-sm text-text-muted">Replace the display notices with this message, or clear them.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" disabled={busy || !notice.trim()} onClick={() => void act('notices', { room_id: roomId, notices: [notice.trim()] })}>Publish notice</Button>
              <Button variant="secondary" disabled={busy} onClick={() => void act('notices', { room_id: roomId, notices: [] })}>Clear notices</Button>
            </div>
          </>}
          {displayUrl && <p className="break-all text-sm">Open on the room display: <a className="underline" href={displayUrl} rel="noreferrer">Open paired display</a> <Button variant="secondary" onClick={() => void navigator.clipboard.writeText(displayUrl).then(() => setError(''), () => setError('Could not copy the display link'))}>Copy link</Button></p>}
        </>}
        <FormField label="New room name"><Input value={label} maxLength={80} onChange={e => setLabel(e.target.value)} /></FormField>
        <Button variant="secondary" disabled={busy || !label.trim()} onClick={() => void act('create', { label: label.trim() })}>Create room</Button>
      </>}
    </div>
  </DialogPanel>
}
