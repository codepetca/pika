import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/ui'
import { TeacherAttendanceRoomsDialog } from '@/app/classrooms/[classroomId]/TeacherAttendanceRoomsDialog'

const room = 'room1234567890123456'
const other = 'room1234567890123457'
const classroom = '11111111-1111-4111-8111-111111111111'
const rooms = [
  { room_id: room, label: 'Room 101', paired: true, can_manage: true },
  { room_id: other, label: 'Room 102', paired: true, can_manage: true },
  { room_id: 'unready', label: 'Room 103', paired: false, can_manage: false },
]
afterEach(() => { vi.unstubAllGlobals() })
const renderDialog = (onClose = vi.fn()) => render(<TooltipProvider><TeacherAttendanceRoomsDialog classroomId={classroom} date="2026-11-13" isOpen onClose={onClose} /></TooltipProvider>)

it('updates the meeting and future location, and undoes both', async () => {
  let meeting = room; let defaultRoom: string | null = room
  const calls: any[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body); calls.push(body)
    if (body.operation === 'move') { meeting = body.room_id; defaultRoom = body.room_id; return Response.json({ revision: 7 }) }
    if (body.operation === 'undo') meeting = room
    if (body.operation === 'default') defaultRoom = body.room_id
    return Response.json({ shared_catalog: true, rooms, default_room_id: defaultRoom, meeting: { room_id: meeting, revision: 1, accepting_until: null } })
  }))
  const user = userEvent.setup(); renderDialog()
  const picker = await screen.findByRole('combobox', { name: 'Attendance Location' })
  expect(screen.getAllByRole('combobox')).toHaveLength(1)
  expect(screen.getByRole('option', { name: 'Room 103 (unpaired)' })).toBeDisabled()
  expect(screen.queryByText(/Teacher room sticker/)).not.toBeInTheDocument()
  await user.selectOptions(picker, other)
  await waitFor(() => expect(picker).toHaveValue(other))
  expect(calls).toContainEqual(expect.objectContaining({ operation: 'move', room_id: other, save_default: true }))
  await user.click(await screen.findByRole('button', { name: 'Undo location change' }))
  await waitFor(() => expect(picker).toHaveValue(room))
  expect(calls).toContainEqual(expect.objectContaining({ operation: 'undo', revision: 7 }))
  expect(calls).toContainEqual(expect.objectContaining({ operation: 'default', room_id: room }))
})

it('keeps the confirmed location when a move fails without changing the future default separately', async () => {
  const calls: any[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body); calls.push(body)
    if (body.operation === 'move') return Response.json({ error: 'Location unavailable' }, { status: 409 })
    return Response.json({ shared_catalog: true, rooms, default_room_id: room, meeting: { room_id: room, revision: 1, accepting_until: null } })
  }))
  const user = userEvent.setup(); renderDialog()
  const picker = await screen.findByRole('combobox', { name: 'Attendance Location' })
  await user.selectOptions(picker, other)
  expect(await screen.findByRole('alert')).toHaveTextContent('Location unavailable')
  expect(picker).toHaveValue(room)
  expect(calls).toContainEqual(expect.objectContaining({ operation: 'move', room_id: other, save_default: true }))
  expect(calls.some(call => call.operation === 'default')).toBe(false)
  expect(screen.queryByRole('button', { name: 'Undo location change' })).not.toBeInTheDocument()
})

it('retries only the unfinished default restoration after a partial undo', async () => {
  let meeting = room; let defaultRoom: string | null = room; let fail = true
  const calls: any[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body); calls.push(body)
    if (body.operation === 'move') { meeting = other; defaultRoom = other; return Response.json({ revision: 7 }) }
    if (body.operation === 'undo') meeting = room
    if (body.operation === 'default') { if (fail) { fail = false; return Response.json({ error: 'Unavailable' }, { status: 503 }) } defaultRoom = body.room_id }
    return Response.json({ shared_catalog: true, rooms, default_room_id: defaultRoom, meeting: { room_id: meeting, revision: 1, accepting_until: null } })
  }))
  const onClose = vi.fn()
  const user = userEvent.setup(); renderDialog(onClose)
  const picker = await screen.findByRole('combobox', { name: 'Attendance Location' })
  await user.selectOptions(picker, other)
  await user.click(await screen.findByRole('button', { name: 'Undo location change' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Retry to finish')
  expect(picker).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Close' }))
  expect(onClose).toHaveBeenCalledOnce()
  await user.click(screen.getByRole('button', { name: 'Retry undo' }))
  await waitFor(() => expect(picker).toBeEnabled())
  expect(picker).toHaveValue(room)
  expect(calls.filter(call => call.operation === 'undo')).toHaveLength(1)
  expect(calls.filter(call => call.operation === 'default')).toHaveLength(2)
})

it('uses the default operation when there is no meeting', async () => {
  let defaultRoom: string | null = null; const calls: any[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body); calls.push(body)
    if (body.operation === 'default') defaultRoom = body.room_id
    return Response.json({ shared_catalog: true, rooms, default_room_id: defaultRoom, meeting: null })
  }))
  const user = userEvent.setup(); renderDialog()
  const picker = await screen.findByRole('combobox', { name: 'Attendance Location' })
  await user.selectOptions(picker, room)
  await waitFor(() => expect(picker).toHaveValue(room))
  expect(calls).toContainEqual(expect.objectContaining({ operation: 'default', room_id: room }))
  expect(calls.some(call => call.operation === 'move')).toBe(false)
  await user.click(await screen.findByRole('button', { name: 'Undo location change' }))
  await waitFor(() => expect(picker).toHaveValue(''))
  expect(calls).toContainEqual(expect.objectContaining({ operation: 'default', room_id: null }))
})

it('blocks further writes when a post-write refresh fails until refreshed', async () => {
  let meeting = room; let defaultRoom = room; let failRead = false
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body)
    if (body.operation === 'move') { meeting = other; defaultRoom = other; failRead = true; return Response.json({ revision: 7 }) }
    if (body.operation === 'list' && failRead) { failRead = false; return Response.json({ error: 'Unavailable' }, { status: 503 }) }
    return Response.json({ shared_catalog: true, rooms, default_room_id: defaultRoom, meeting: { room_id: meeting, revision: 1, accepting_until: null } })
  }))
  const user = userEvent.setup(); renderDialog()
  const picker = await screen.findByRole('combobox', { name: 'Attendance Location' })
  await user.selectOptions(picker, other)
  expect(await screen.findByRole('alert')).toHaveTextContent('Refresh to continue')
  expect(picker).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Refresh location' }))
  await waitFor(() => expect(picker).toBeEnabled())
  expect(picker).toHaveValue(other)
})

it('opens the selected student poster and preserves undo on return', async () => {
  let meeting = room; let defaultRoom = room
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body)
    if (body.operation === 'move') { meeting = other; defaultRoom = other; return Response.json({ revision: 7 }) }
    if (body.operation === 'poster') return Response.json({ label: 'Room 102', student_poster_url: null })
    return Response.json({ shared_catalog: true, rooms, default_room_id: defaultRoom, meeting: { room_id: meeting, revision: 1, accepting_until: null } })
  }))
  const user = userEvent.setup(); renderDialog()
  await user.selectOptions(await screen.findByRole('combobox', { name: 'Attendance Location' }), other)
  await user.click(await screen.findByRole('button', { name: 'Print student poster' }))
  expect(await screen.findByText('Ask an administrator to enable the student QR for this room.')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Close' }))
  expect(await screen.findByRole('button', { name: 'Undo location change' })).toBeEnabled()
  expect(screen.getByRole('combobox', { name: 'Attendance Location' })).toHaveValue(other)
})
