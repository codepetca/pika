import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ user: vi.fn(), redirect: vi.fn((path: string): never => { throw new Error(path) }) }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))
vi.mock('@/lib/auth', () => ({ getCurrentUser: mocks.user }))
import RoomPage from '@/app/attendance/room/[roomId]/page'

const roomId = 'abcd1234abcd1234'
const props = { params: Promise.resolve({ roomId }), searchParams: Promise.resolve({}) }
describe('proofless room destination', () => {
  beforeEach(() => vi.resetAllMocks())
  it('preserves the clean room destination through login', async () => {
    mocks.user.mockResolvedValue(null)
    await expect(RoomPage(props)).rejects.toThrow(`/login?next=${encodeURIComponent(`/attendance/room/${roomId}`)}`)
  })
  it('routes the teacher to move after login', async () => {
    mocks.user.mockResolvedValue({ role: 'teacher' })
    await expect(RoomPage(props)).rejects.toThrow(`/attendance/room/${roomId}/move`)
  })
  it('renders a student without a scan', async () => {
    mocks.user.mockResolvedValue({ role: 'student' })
    const element = await RoomPage(props)
    expect(element.props.scanId).toBeNull()
  })
})
