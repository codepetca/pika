import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/auth', () => ({ getCurrentUser: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => ({ kind: 'service-role' })) }))
vi.mock('@/lib/server/student-attendance-entry-context', () => ({ loadStudentAttendanceEntryClassroomName: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn((path: string) => { throw new Error(path) }) }))
vi.mock('@/app/attendance/check-in/[token]/StudentAttendanceCheckIn', () => ({ StudentAttendanceCheckIn: () => null }))
import { getCurrentUser } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { loadStudentAttendanceEntryClassroomName } from '@/lib/server/student-attendance-entry-context'
import ClassroomAttendanceCheckInPage from '@/app/attendance/classroom/[token]/page'

describe('classroom attendance sign-in handoff', () => {
  const token = 'a'.repeat(43)
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(loadStudentAttendanceEntryClassroomName).mockResolvedValue('Health for Life')
  })

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
    expect(page.props.classroomName).toBe(role === 'student' ? 'Health for Life' : undefined)
    if (role === 'student') {
      expect(loadStudentAttendanceEntryClassroomName).toHaveBeenCalledWith(expect.objectContaining({ entryToken: token, mode: 'classroom' }))
    } else {
      expect(loadStudentAttendanceEntryClassroomName).not.toHaveBeenCalled()
    }
    expect(redirect).not.toHaveBeenCalled()
  })
})
