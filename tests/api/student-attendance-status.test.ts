import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  requireAuth: vi.fn(),
  getServiceRoleClient: vi.fn(() => ({ kind: 'service-role' })),
  load: vi.fn(),
  loadMembership: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireRole: mocks.requireRole, requireAuth: mocks.requireAuth }))
vi.mock('@/lib/server/contextual-student-attendance', () => ({ loadContextualStudentAttendanceStatus: mocks.loadMembership }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: mocks.getServiceRoleClient }))
vi.mock('@/lib/server/bara-attendance-student-view', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/server/bara-attendance-student-view')
  >('@/lib/server/bara-attendance-student-view')
  return { ...actual, loadStudentAttendanceStatusView: mocks.load }
})

import { GET } from '@/app/api/student/attendance/status/route'
import { StudentAttendanceStatusReadError } from '@/lib/server/bara-attendance-student-view'
import { ApiError } from '@/lib/api-error'

describe('GET /api/student/attendance/status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.PIKA_CLASSROOM_EXPERIENCE_ADMISSION
    mocks.requireRole.mockResolvedValue({
      id: '30000000-0000-4000-8000-000000000001',
      role: 'student',
      email: 'student@example.com',
    })
    mocks.load.mockResolvedValue({
      studentId: '30000000-0000-4000-8000-000000000001',
      classrooms: [],
      nextRefreshAt: null,
      serverNow: '2026-08-23T13:30:00.000Z',
    })
  })
  afterEach(() => vi.unstubAllEnvs())

  it.each(['student', 'teacher'])('uses the membership snapshot for an admitted %s', async role => {
    const id = '30000000-0000-4000-8000-000000000001'
    mocks.requireAuth.mockResolvedValue({ id, role, email: 'learner@example.com' })
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [id] }))
    mocks.loadMembership.mockResolvedValue({ studentId: id, classrooms: [], nextRefreshAt: null, serverNow: '2026-10-21T13:00:00.000Z' })
    const response = await GET(new Request('https://pika.codepet.ca/api/student/attendance/status'))
    expect(response.status).toBe(200)
    expect(mocks.loadMembership).toHaveBeenCalledWith({ supabase: { kind: 'service-role' }, studentId: id })
    expect(mocks.requireRole).not.toHaveBeenCalled()
    expect(mocks.load).not.toHaveBeenCalled()
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('fails closed for invalid admission rather than using legacy projection', async () => {
    mocks.requireAuth.mockResolvedValue({ id: '30000000-0000-4000-8000-000000000001', role: 'student' })
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{')
    expect((await GET(new Request('https://pika.codepet.ca/api/student/attendance/status'))).status).toBe(503)
    expect(mocks.load).not.toHaveBeenCalled()
    expect(mocks.loadMembership).not.toHaveBeenCalled()
  })

  it('preserves authenticated identity headers on a shared snapshot failure', async () => {
    const id = '30000000-0000-4000-8000-000000000001'
    mocks.requireAuth.mockResolvedValue({ id, role: 'teacher', email: 'learner@example.com' })
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [id] }))
    mocks.loadMembership.mockRejectedValueOnce(new ApiError(503, 'private detail'))
    const response = await GET(new Request('https://pika.codepet.ca/api/student/attendance/status'))
    expect(response.status).toBe(503)
    expect(response.headers.get('x-pika-student-id')).toBe(id)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ error: 'Attendance status is temporarily unavailable' })
  })

  it('derives all scope from the signed-in student and accepts no classroom input', async () => {
    const response = await GET(new Request('https://pika.codepet.ca/api/student/attendance/status'))

    expect(response.status).toBe(200)
    expect(mocks.requireRole).toHaveBeenCalledWith('student')
    expect(mocks.load).toHaveBeenCalledWith({
      supabase: { kind: 'service-role' },
      studentId: '30000000-0000-4000-8000-000000000001',
    })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-pika-student-id')).toBe(
      '30000000-0000-4000-8000-000000000001',
    )
    await expect(response.json()).resolves.toMatchObject({
      studentId: '30000000-0000-4000-8000-000000000001',
    })
  })

  it('binds authenticated read failures to the same student', async () => {
    mocks.load.mockRejectedValueOnce(new StudentAttendanceStatusReadError('read_failed'))

    const response = await GET(new Request('https://pika.codepet.ca/api/student/attendance/status'))

    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-pika-student-id')).toBe(
      '30000000-0000-4000-8000-000000000001',
    )
  })
})
