import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ cookie: vi.fn(), user: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: mocks.cookie }) }))
vi.mock('@/lib/auth', () => ({ getCurrentUser: mocks.user }))
import RoomPage from '@/app/attendance/room/[roomId]/page'

const roomId = 'room1234567890123456'
const scanId = '30000000-0000-4000-8000-000000000003'
const cookie = { roomId, scanId, continuation: 'a'.repeat(40), browserKey: 'b'.repeat(43), poster: true }
const renderPage = () => RoomPage({ params: Promise.resolve({ roomId }), searchParams: Promise.resolve({ scan: scanId }) })
beforeEach(() => { mocks.user.mockResolvedValue({ role: 'student' }); mocks.cookie.mockReturnValue({ value: JSON.stringify(cookie) }) })
it('requires confirmation only for the matching validated poster cookie', async () => {
  expect((await renderPage()).props.requireConfirmation).toBe(true)
  mocks.cookie.mockReturnValue({ value: JSON.stringify({ ...cookie, roomId: 'anotherroom123456789' }) })
  expect((await renderPage()).props.requireConfirmation).toBe(false)
  mocks.cookie.mockReturnValue({ value: JSON.stringify({ ...cookie, scanId: '30000000-0000-4000-8000-000000000004' }) })
  expect((await renderPage()).props.requireConfirmation).toBe(false)
  mocks.cookie.mockReturnValue({ value: JSON.stringify({ ...cookie, poster: false }) })
  expect((await renderPage()).props.requireConfirmation).toBe(false)
})
