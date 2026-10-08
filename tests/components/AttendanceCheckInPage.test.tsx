import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/auth', () => ({ getCurrentUser: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => ({ kind: 'service-role' })) }))
vi.mock('@/lib/server/student-attendance-entry-context', () => ({ loadStudentAttendanceEntryClassroomName: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn((path: string) => { throw new Error(path) }) }))
vi.mock('@/app/attendance/check-in/[token]/StudentAttendanceCheckIn', () => ({ StudentAttendanceCheckIn: () => null }))
import { getCurrentUser } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { loadStudentAttendanceEntryClassroomName } from '@/lib/server/student-attendance-entry-context'
import AttendanceCheckInPage from '@/app/attendance/check-in/[token]/page'

describe('occurrence attendance display context', () => {
  const token = 'a'.repeat(100)
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(redirect).mockImplementation(path => { throw new Error(path) })
    vi.mocked(loadStudentAttendanceEntryClassroomName).mockResolvedValue('Health for Life')
  })

  it('requires authentication before loading a classroom name', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null)
    const path = `/login?next=${encodeURIComponent(`/attendance/check-in/${token}`)}`
    await expect(AttendanceCheckInPage({ params: Promise.resolve({ token }) })).rejects.toThrow(path)
    expect(loadStudentAttendanceEntryClassroomName).not.toHaveBeenCalled()
  })

  it.each(['student', 'teacher'] as const)('loads display context only for a student, with role %s', async role => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: 'user', email: 'person@example.com', role } as Awaited<ReturnType<typeof getCurrentUser>>)
    const page = await AttendanceCheckInPage({ params: Promise.resolve({ token }) })
    expect(page.props).toMatchObject({ entryToken: token, canCheckIn: role === 'student' })
    expect(page.props.classroomName).toBe(role === 'student' ? 'Health for Life' : undefined)
    if (role !== 'student') expect(loadStudentAttendanceEntryClassroomName).not.toHaveBeenCalled()
  })
})
