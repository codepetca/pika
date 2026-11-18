'use client'

import { useEffect, useState } from 'react'
import { Button, FormField, Select } from '@/ui'
import { fetchJSON } from '@/lib/request-cache'
import { getTodayInToronto } from '@/lib/timezone'
import type { BaraRoomResult } from '@/lib/server/bara-attendance-client'

type Choice = { id: string; title: string }
type Destination = { label: string; paired: boolean; choices: Choice[]; classes: Choice[] }

async function roomCommand<K extends 'list' | 'move' | 'undo' | 'default'>(
  classroomId: string,
  date: string,
  operation: K,
  extra: { room_id?: string; save_default?: boolean; revision?: number } = {},
) {
  return fetchJSON<BaraRoomResult<K>>('/api/teacher/attendance/rooms', {
    init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      classroom_id: classroomId, date, operation, ...extra,
    }) },
    errorMessage: 'Room attendance is unavailable',
  })
}

export function MoveRoom({ roomId }: { roomId: string }) {
  const [destination, setDestination] = useState<Destination | null>(null)
  const [classroomId, setClassroomId] = useState('')
  const [saveDefault, setSaveDefault] = useState(false)
  const [revision, setRevision] = useState<number | null>(null)
  const [defaultSaved, setDefaultSaved] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const date = getTodayInToronto()

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const result = await fetchJSON<{ classrooms: Choice[] }>('/api/teacher/classrooms', {
          errorMessage: 'Sign in as a teacher to move a class',
        })
        const lists = await Promise.allSettled(result.classrooms.map(async classroom => {
          const rooms = await roomCommand(classroom.id, date, 'list')
          const room = rooms.rooms.find(item => item.room_id === roomId)
          return { classroom, room, canMove: Boolean(rooms.meeting && rooms.meeting.room_id !== roomId) }
        }))
        if (!active) return
        const found = lists.flatMap(item => item.status === 'fulfilled' && item.value.room ? [item.value] : [])
        const choices = found.filter(item => item.canMove).map(item => item.classroom)
        const room = found[0]?.room
        const classes = found.map(item => item.classroom)
        setDestination(room ? { label: room.label, paired: room.paired, choices, classes } : null)
        setClassroomId(choices[0]?.id ?? classes[0]?.id ?? '')
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Could not load classes')
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [roomId, date])

  async function act(operation: 'move' | 'undo' | 'default') {
    setBusy(true)
    setError('')
    try {
      if (operation === 'move') {
        const result = await roomCommand(classroomId, date, 'move', { room_id: roomId, save_default: saveDefault })
        setRevision(result.revision)
      } else if (operation === 'default') {
        await roomCommand(classroomId, date, 'default', { room_id: roomId })
        setDefaultSaved(true)
      } else if (revision !== null) {
        await roomCommand(classroomId, date, 'undo', { revision })
        setRevision(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the room')
    } finally {
      setBusy(false)
    }
  }

  const open = Boolean(destination?.choices.length)
  const choices = open ? destination?.choices ?? [] : destination?.classes ?? []
  const selected = choices.find(item => item.id === classroomId)
  return <main className="mx-auto max-w-lg space-y-4 p-6">
    <h1 className="text-xl font-semibold">{destination ? `Move class to ${destination.label}` : 'Move class to this room'}</h1>
    {loading ? <p role="status">Loading open classes…</p> : error && !choices.length ? <p role="alert">{error}</p> : !choices.length ? <p>This room is unavailable.</p>
      : !destination?.paired ? <p>Pair this room in Pika’s Attendance rooms before assigning a class.</p> : <>
      {choices.length > 1 && <FormField label="Class"><Select value={classroomId} disabled={busy || revision !== null || defaultSaved} onChange={event => setClassroomId(event.target.value)} options={choices.map(choice => ({ value: choice.id, label: choice.title }))} /></FormField>}
      {open && revision === null && <Button variant="secondary" aria-pressed={saveDefault} disabled={busy} onClick={() => setSaveDefault(value => !value)}>Use this room for future meetings too</Button>}
      {error && <p role="alert">{error}</p>}
      {!open ? (defaultSaved
        ? <p role="status">Default room saved for {selected?.title}.</p>
        : <Button disabled={busy || !selected} onClick={() => void act('default')}>Set default for {selected?.title}</Button>)
        : revision === null
          ? <Button disabled={busy || !selected} onClick={() => void act('move')}>{selected ? `Move ${selected.title} here` : 'Move this meeting'}</Button>
          : <><p role="status">{selected?.title} moved to {destination?.label}.{saveDefault ? ' Default room saved.' : ''}</p><Button variant="secondary" disabled={busy} onClick={() => void act('undo')}>Undo move</Button></>}
    </>}
  </main>
}
