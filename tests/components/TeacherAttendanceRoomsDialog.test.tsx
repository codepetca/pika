import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/ui'
import { TeacherAttendanceRoomsDialog } from '@/app/classrooms/[classroomId]/TeacherAttendanceRoomsDialog'

const room = 'room1234567890123456'
const otherRoom = 'room1234567890123457'
const unpairedRoom = 'room1234567890123458'
const classroom = '11111111-1111-4111-8111-111111111111'
const list = {
  ok: true,
  rooms: [
    { room_id: room, label: 'Room 101', can_manage: true, paired: true },
    { room_id: otherRoom, label: 'Room 102', can_manage: true, paired: true },
    { room_id: unpairedRoom, label: 'Room 103', can_manage: true, paired: false },
  ],
  default_room_id: room,
  meeting: { room_id: room, revision: 0, accepting_until: null },
}

afterEach(() => { vi.unstubAllGlobals() })

it('moves the meeting on selection and can undo with the returned revision', async () => {
  const requests: any[] = []
  let meetingRoomId = room
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body)
    requests.push(body)
    if (body.operation === 'move') {
      meetingRoomId = body.room_id
      return Response.json({ ok: true, revision: 7 })
    }
    if (body.operation === 'undo') meetingRoomId = room
    if (body.operation === 'list') return Response.json({ ...list, meeting: { ...list.meeting, room_id: meetingRoomId } })
    return Response.json({ ok: true })
  }))
  const user = userEvent.setup()
  render(<TooltipProvider><TeacherAttendanceRoomsDialog classroomId={classroom} date="2026-11-13" isOpen onClose={vi.fn()} /></TooltipProvider>)
  const picker = await screen.findByRole('combobox', { name: 'This meeting' })
  const defaultPicker = screen.getByRole('combobox', { name: 'Default room' })
  expect(screen.getAllByRole('option', { name: 'Room 103 (unpaired)' })[0]).toBeDisabled()
  await user.selectOptions(picker, otherRoom)
  await waitFor(() => expect(picker).toBeEnabled())
  expect(picker).toHaveValue(otherRoom)
  expect(defaultPicker).toHaveValue(room)
  expect(requests.find(request => request.operation === 'move')).not.toHaveProperty('save_default')
  await user.click(await screen.findByRole('button', { name: 'Undo move' }))
  await waitFor(() => expect(picker).toHaveValue(room))
  expect(requests).toContainEqual(expect.objectContaining({ operation: 'undo', revision: 7, date: '2026-11-13' }))
  expect(requests).toContainEqual(expect.objectContaining({ operation: 'move', room_id: otherRoom }))
  expect(requests.some(request => request.operation === 'default')).toBe(false)
})

it('restores the assigned room when a move fails and allows retrying', async () => {
  let moves = 0
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body)
    if (body.operation === 'move') {
      moves += 1
      if (moves === 1) return Response.json({ error: 'Room unavailable' }, { status: 409 })
      return Response.json({ ok: true, revision: 7 })
    }
    return Response.json({ ...list, meeting: { ...list.meeting, room_id: moves > 1 ? otherRoom : room } })
  }))
  const user = userEvent.setup()
  render(<TooltipProvider><TeacherAttendanceRoomsDialog classroomId={classroom} date="2026-11-13" isOpen onClose={vi.fn()} /></TooltipProvider>)
  const picker = await screen.findByRole('combobox', { name: 'This meeting' })
  await user.selectOptions(picker, otherRoom)
  expect(await screen.findByRole('alert')).toHaveTextContent('Room unavailable')
  expect(picker).toHaveValue(room)
  await user.selectOptions(picker, otherRoom)
  await waitFor(() => expect(picker).toBeEnabled())
  expect(picker).toHaveValue(otherRoom)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})


it('uses shared room readiness and hides Bara-managed room controls', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...list, shared_catalog: true, rooms: [
    { ...list.rooms[0], paired: false, attendance_ready: true },
    { ...list.rooms[1], selectable: false },
  ] })))
  render(<TooltipProvider><TeacherAttendanceRoomsDialog classroomId={classroom} date="2026-11-13" isOpen onClose={vi.fn()} /></TooltipProvider>)
  await screen.findByRole('combobox', { name: 'This meeting' })
  expect(screen.getAllByRole('option', { name: 'Room 101' })[0]).toBeEnabled()
  expect(screen.getAllByRole('option', { name: 'Room 102' })[0]).toBeDisabled()
  expect(screen.queryByRole('button', { name: 'Create room' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Pair room display' })).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Room display notice')).not.toBeInTheDocument()
})

it('loads the selected shared room poster on demand and prints only the room poster', async () => {
  const fetcher = vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body)
    return Response.json(body.operation === 'poster'
      ? { ok: true, label: 'Room 101', student_poster_url: `https://bara.example/rooms/${room}/scan?poster=${'a'.repeat(40)}` }
      : { ...list, shared_catalog: true })
  })
  vi.stubGlobal('fetch', fetcher)
  const print = vi.fn(); vi.stubGlobal('print', print)
  const user = userEvent.setup()
  render(<TooltipProvider><TeacherAttendanceRoomsDialog classroomId={classroom} date="2026-11-13" isOpen onClose={vi.fn()} /></TooltipProvider>)
  await user.click(await screen.findByRole('button', { name: 'Print student poster' }))
  const dialog = await screen.findByRole('dialog', { name: 'Student attendance poster' })
  await waitFor(() => expect(dialog.querySelector('[aria-label="Room 101 check in for attendance QR code"]')).toBeTruthy())
  expect(fetcher.mock.calls.map(call => JSON.parse(call[1].body).operation)).toEqual(['list', 'poster'])
  expect(document.querySelector('[data-classroom-qr-print-heading]')).toHaveTextContent('Room 101')
  expect(document.querySelector('[data-classroom-qr-print-hours]')).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Poster settings' }))
  await user.click(screen.getByRole('menuitem', { name: 'Print poster' }))
  expect(print).toHaveBeenCalledOnce()
  expect(document.body.dataset.printClassroomQr).toBe('true')
  window.dispatchEvent(new Event('afterprint'))
})

it('shows guidance instead of a printable QR when a poster is disabled', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => Response.json(JSON.parse(init.body).operation === 'poster'
    ? { ok: true, label: 'Room 101', student_poster_url: null } : { ...list, shared_catalog: true })))
  const user = userEvent.setup()
  render(<TooltipProvider><TeacherAttendanceRoomsDialog classroomId={classroom} date="2026-11-13" isOpen onClose={vi.fn()} /></TooltipProvider>)
  await user.click(await screen.findByRole('button', { name: 'Print student poster' }))
  expect(await screen.findByText('Ask an administrator to enable the student QR for this room.')).toBeVisible()
  expect(document.querySelector('[data-classroom-qr-print]')).toBeNull()
})

it('discards an old room poster response after the preview closes', async () => {
  let resolveOld!: (response: Response) => void
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body)
    if (body.operation === 'poster' && body.room_id === room) return new Promise<Response>(resolve => { resolveOld = resolve })
    if (body.operation === 'poster') return Response.json({ ok: true, label: 'Room 102', student_poster_url: `https://bara.example/rooms/${otherRoom}/scan?poster=${'b'.repeat(40)}` })
    return Response.json({ ...list, shared_catalog: true })
  }))
  const user = userEvent.setup()
  render(<TooltipProvider><TeacherAttendanceRoomsDialog classroomId={classroom} date="2026-11-13" isOpen onClose={vi.fn()} /></TooltipProvider>)
  await user.click(await screen.findByRole('button', { name: 'Print student poster' }))
  await user.click(screen.getByRole('button', { name: 'Close' }))
  await user.selectOptions(await screen.findByRole('combobox', { name: 'Default room' }), otherRoom)
  await user.click(screen.getByRole('button', { name: 'Print student poster' }))
  await screen.findAllByLabelText('Room 102 check in for attendance QR code')
  resolveOld(Response.json({ ok: true, label: 'Room 101', student_poster_url: `https://bara.example/rooms/${room}/scan?poster=${'a'.repeat(40)}` }))
  await waitFor(() => expect(document.querySelector('[data-classroom-qr-print-heading]')).toHaveTextContent('Room 102'))
})
