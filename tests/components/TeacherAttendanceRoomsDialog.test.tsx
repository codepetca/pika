import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
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
  render(<TeacherAttendanceRoomsDialog classroomId={classroom} date="2026-11-13" isOpen onClose={vi.fn()} />)
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
  render(<TeacherAttendanceRoomsDialog classroomId={classroom} date="2026-11-13" isOpen onClose={vi.fn()} />)
  const picker = await screen.findByRole('combobox', { name: 'This meeting' })
  await user.selectOptions(picker, otherRoom)
  expect(await screen.findByRole('alert')).toHaveTextContent('Room unavailable')
  expect(picker).toHaveValue(room)
  await user.selectOptions(picker, otherRoom)
  await waitFor(() => expect(picker).toBeEnabled())
  expect(picker).toHaveValue(otherRoom)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})
