import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { TeacherAttendanceRoomsDialog } from '@/app/classrooms/[classroomId]/TeacherAttendanceRoomsDialog'

const room = 'room1234567890123456'
const classroom = '11111111-1111-4111-8111-111111111111'
const list = { display_setup_url: 'https://bara.test/display', ok: true, rooms: [{ room_id: room, label: 'Room 101', can_manage: true, paired: true }], default_room_id: null, meeting: { room_id: null, revision: 0, accepting_until: null } }

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

it('normalizes a pasted code and pairs the selected room', async () => {
  const requests: any[] = []
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body); requests.push(body)
    return new Response(JSON.stringify(body.operation === 'list' ? list : { ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }))
  const user = userEvent.setup()
  render(<TeacherAttendanceRoomsDialog classroomId={classroom} date="2026-11-13" isOpen onClose={vi.fn()} />)
  expect(await screen.findByRole('link', { name: 'https://bara.test/display' })).toBeInTheDocument()
  expect(screen.getByText('Pairing a new display will disconnect the current display.')).toBeInTheDocument()
  await user.type(screen.getByLabelText('Display pairing code'), 'abcd- 2345')
  await user.click(screen.getByRole('button', { name: 'Pair display' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Room 101 display paired')
  expect(requests).toContainEqual(expect.objectContaining({ operation: 'pair_code', room_id: room, pairing_code: 'ABCD2345' }))
})
