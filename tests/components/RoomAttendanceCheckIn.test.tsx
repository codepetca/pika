import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { RoomAttendanceCheckIn } from '@/app/attendance/room/[roomId]/RoomAttendanceCheckIn'

afterEach(() => vi.unstubAllGlobals())

it('waits for explicit poster confirmation before sending a check-in', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ results: [] }))
  vi.stubGlobal('fetch', fetcher)
  const user = userEvent.setup()
  render(<RoomAttendanceCheckIn roomId="room1234567890123456" scanId="30000000-0000-4000-8000-000000000003" requireConfirmation />)
  expect(screen.getByRole('button', { name: 'Check in' })).toBeVisible()
  expect(fetcher).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Check in' }))
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
})

it('continues to automatically check in a live scan', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ results: [] }))
  vi.stubGlobal('fetch', fetcher)
  render(<RoomAttendanceCheckIn roomId="room1234567890123456" scanId="30000000-0000-4000-8000-000000000003" />)
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
})
