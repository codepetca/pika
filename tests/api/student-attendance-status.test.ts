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

describe('GET /api/student/attendance/status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireRole.mockResolvedValue({
      id: '30000000-0000-4000-8000-000000000001',
      role: 'student',
      email: 'student@example.com',
    })
    mocks.load.mockResolvedValue({
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
  })
})
