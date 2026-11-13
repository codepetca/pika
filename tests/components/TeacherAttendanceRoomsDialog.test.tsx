import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { TeacherAttendanceRoomsDialog } from '@/app/classrooms/[classroomId]/TeacherAttendanceRoomsDialog'

const room = 'room1234567890123456'
const classroom = '11111111-1111-4111-8111-111111111111'
const list = { ok: true, rooms: [{ room_id: room, label: 'Room 101', can_manage: true, paired: true }], default_room_id: null, meeting: { room_id: null, revision: 0, accepting_until: null } }

afterEach(() => { vi.unstubAllGlobals() })

it('moves the selected meeting and can undo with the returned revision', async () => {
  const requests: any[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body); requests.push(body)
    return new Response(JSON.stringify(body.operation === 'move' ? { ok: true, revision: 7 } : body.operation === 'list' ? list : { ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }))
  const user = userEvent.setup()
  render(<TeacherAttendanceRoomsDialog classroomId={classroom} date="2026-11-13" isOpen onClose={vi.fn()} />)
  await screen.findByLabelText('Room')
  await user.click(screen.getByRole('button', { name: 'Also use as the default for future meetings' }))
  await user.click(screen.getByRole('button', { name: 'Move this meeting' }))
  await user.click(await screen.findByRole('button', { name: 'Undo move' }))
  await waitFor(() => expect(requests).toContainEqual(expect.objectContaining({ operation: 'undo', revision: 7, date: '2026-11-13' })))
  expect(requests).toContainEqual(expect.objectContaining({ operation: 'move', room_id: room, save_default: true }))
})
