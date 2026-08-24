import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  getServiceRoleClient: vi.fn(() => ({ kind: 'service-role' })),
  load: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireRole: mocks.requireRole }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: mocks.getServiceRoleClient }))
vi.mock('@/lib/server/bara-attendance-student-view', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/server/bara-attendance-student-view')
  >('@/lib/server/bara-attendance-student-view')
  return { ...actual, loadStudentAttendanceStatusView: mocks.load }
})

import { GET } from '@/app/api/student/attendance/status/route'
import { StudentAttendanceStatusReadError } from '@/lib/server/bara-attendance-student-view'

describe('GET /api/student/attendance/status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
