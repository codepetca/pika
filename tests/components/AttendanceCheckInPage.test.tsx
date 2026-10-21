import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
  const userId = '30000000-0000-4000-8000-000000000001'
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', undefined)
    vi.mocked(redirect).mockImplementation(path => { throw new Error(path) })
    vi.mocked(loadStudentAttendanceEntryClassroomName).mockResolvedValue('Health for Life')
  })
  afterEach(() => vi.unstubAllEnvs())

  it.each(['student', 'teacher'] as const)('admits the configured %s account to the existing QR consumer', async role => {
    const user = { id: userId, email: 'person@example.com', role }
    vi.mocked(getCurrentUser).mockResolvedValue(user)
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [userId] }))
    const page = await AttendanceCheckInPage({ params: Promise.resolve({ token }) })
    expect(page.props).toMatchObject({ entryToken: token, canCheckIn: true, classroomName: 'Health for Life' })
    expect(loadStudentAttendanceEntryClassroomName).toHaveBeenCalledWith(expect.objectContaining({ pikaUser: user, entryToken: token }))
  })

  it('fails closed on invalid admission before loading display metadata', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: userId, email: 'person@example.com', role: 'student' })
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{')
    await expect(AttendanceCheckInPage({ params: Promise.resolve({ token }) })).rejects.toThrow('admission configuration')
    expect(loadStudentAttendanceEntryClassroomName).not.toHaveBeenCalled()
  })

  it('preserves the teacher guard with a configured but unadmitted cohort', async () => {
    vi.mocked(getCurrentUser).mockResolvedValue({ id: userId, email: 'person@example.com', role: 'teacher' })
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [] }))
    const page = await AttendanceCheckInPage({ params: Promise.resolve({ token }) })
    expect(page.props).toMatchObject({ canCheckIn: false, classroomName: undefined })
    expect(loadStudentAttendanceEntryClassroomName).not.toHaveBeenCalled()
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
