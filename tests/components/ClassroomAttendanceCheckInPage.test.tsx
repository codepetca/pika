import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/auth', () => ({ getCurrentUser: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn((path: string) => { throw new Error(path) }) }))
vi.mock('@/app/attendance/check-in/[token]/StudentAttendanceCheckIn', () => ({ StudentAttendanceCheckIn: () => null }))
import { getCurrentUser } from '@/lib/auth'
import { redirect } from 'next/navigation'
import ClassroomAttendanceCheckInPage from '@/app/attendance/classroom/[token]/page'

describe('classroom attendance sign-in handoff', () => {
  const token = 'a'.repeat(43)
  beforeEach(() => vi.resetAllMocks())

  it('preserves the opaque classroom path through login', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)
    vi.mocked(redirect).mockImplementation(path => { throw new Error(path) })
    const path = `/login?next=${encodeURIComponent(`/attendance/classroom/${token}`)}`
    await expect(ClassroomAttendanceCheckInPage({ params: Promise.resolve({ token }) })).rejects.toThrow(path)
    expect(redirect).toHaveBeenCalledWith(path)
  })

  it.each(['student', 'teacher'] as const)('only allows student check-in after %s authentication', async role => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 'user', email: 'person@example.com', role } as Awaited<ReturnType<typeof getCurrentUser>>)
    const page = await ClassroomAttendanceCheckInPage({ params: Promise.resolve({ token }) })
    expect(page.props).toMatchObject({ entryToken: token, mode: 'classroom', canCheckIn: role === 'student' })
    expect(redirect).not.toHaveBeenCalled()
  })
})
