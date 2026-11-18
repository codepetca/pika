import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { MoveRoom } from '@/app/attendance/room/[roomId]/move/MoveRoom'

const room = 'room1234567890123456'
afterEach(() => vi.unstubAllGlobals())
it('offers open eligible classes and undoes the selected move', async () => {
  const commands: any[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    let data: unknown
    if (url === '/api/teacher/classrooms') data = { classrooms: [{ id: 'a', title: 'Open class' }, { id: 'b', title: 'Closed class' }] }
    else {
      const command = JSON.parse(String(init?.body)); commands.push(command)
      data = command.operation === 'list' ? { rooms: [{ room_id: room, label: 'Room 220', paired: true }], meeting: command.classroom_id === 'a' ? { room_id: null } : null } : command.operation === 'move' ? { revision: 4 } : { ok: true }
    }
    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }))
  const user = userEvent.setup()
  render(<MoveRoom roomId={room} />)
  await user.click(await screen.findByRole('button', { name: 'Move Open class here' }))
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  await user.click(await screen.findByRole('button', { name: 'Undo move' }))
  expect(commands).toContainEqual(expect.objectContaining({ operation: 'move', classroom_id: 'a', room_id: room }))
  expect(commands).toContainEqual(expect.objectContaining({ operation: 'undo', classroom_id: 'a', revision: 4 }))
})

it('offers only classes for which this room is selectable and ready', async () => {
  const commands: any[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/teacher/classrooms') return Response.json({ classrooms: [
      { id: 'a', title: 'Legacy class' }, { id: 'b', title: 'Ready class' }, { id: 'c', title: 'Unready class' },
    ] })
    const command = JSON.parse(String(init?.body)); commands.push(command)
    const roomData = command.classroom_id === 'a' ? { paired: true, selectable: false }
      : command.classroom_id === 'b' ? { paired: false, attendance_ready: true } : { paired: true, attendance_ready: false }
    return Response.json(command.operation === 'list'
      ? { rooms: [{ room_id: room, label: 'Room 220', ...roomData }], meeting: { room_id: null } }
      : { revision: 4 })
  }))
  const user = userEvent.setup()
  render(<MoveRoom roomId={room} />)
  await user.click(await screen.findByRole('button', { name: 'Move Ready class here' }))
  expect(commands).toContainEqual(expect.objectContaining({ operation: 'move', classroom_id: 'b' }))
  expect(screen.queryByText('Legacy class')).not.toBeInTheDocument()
  expect(screen.queryByText('Unready class')).not.toBeInTheDocument()
})
