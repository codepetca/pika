import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const {
  requireRole,
  assertTeacherCanMutateClassroom,
  syncTeacherAttendanceSources,
  resolveVerifiedPikaAttendanceTeacher,
  assertBaraAttendanceCanaryClassroom,
  supabase,
} = vi.hoisted(() => ({
  requireRole: vi.fn(),
  assertTeacherCanMutateClassroom: vi.fn(),
  syncTeacherAttendanceSources: vi.fn(),
  resolveVerifiedPikaAttendanceTeacher: vi.fn(),
  assertBaraAttendanceCanaryClassroom: vi.fn(),
  supabase: { rpc: vi.fn() },
}))

vi.mock('@/lib/auth', () => ({ requireRole }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => supabase }))
vi.mock('@/lib/server/classrooms', () => ({ assertTeacherCanMutateClassroom }))
vi.mock('@/lib/server/bara-attendance-sync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/bara-attendance-sync')>()
  return { ...actual, syncTeacherAttendanceSources }
})
vi.mock('@/lib/server/bara-attendance-teacher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/bara-attendance-teacher')>()
  return { ...actual, resolveVerifiedPikaAttendanceTeacher }
})
vi.mock('@/lib/server/bara-attendance-canary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/bara-attendance-canary')>()
  return { ...actual, assertBaraAttendanceCanaryClassroom }
})

import { POST } from '@/app/api/teacher/attendance/sync/route'
import { BaraAttendanceSyncError } from '@/lib/server/bara-attendance-sync'
import { BaraAttendanceCanaryError } from '@/lib/server/bara-attendance-canary'

const classroomId = '20000000-0000-4000-8000-000000000002'
const actor = { workosSubject: 'user_teacher', displayName: 'Teacher One' }

function request(body: unknown) {
  return new NextRequest('http://localhost/api/teacher/attendance/sync', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/teacher/attendance/sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    assertBaraAttendanceCanaryClassroom.mockImplementation(() => undefined)
    requireRole.mockResolvedValue({ id: 'teacher-1', email: 'teacher@example.com', role: 'teacher' })
    resolveVerifiedPikaAttendanceTeacher.mockResolvedValue(actor)
    assertTeacherCanMutateClassroom.mockResolvedValue({ ok: true })
    syncTeacherAttendanceSources.mockResolvedValue({
      roster: { outcome: 'applied', revision: 2 },
      schedule: { outcome: 'applied', revision: 3 },
    })
  })

  it('authorizes and stages a bounded teacher-owned source window', async () => {
    const response = await POST(request({
      classroom_id: classroomId,
      window_start: '2026-09-01',
      window_end: '2026-12-31',
    }))
    expect(response.status).toBe(200)
    expect(syncTeacherAttendanceSources).toHaveBeenCalledWith({
      supabase,
      teacherId: 'teacher-1',
      classroomId,
      windowStart: '2026-09-01',
      windowEnd: '2026-12-31',
      verifiedActor: actor,
      integrationState: 'ready',
      scheduleThrough: null,
    })
    expect(assertBaraAttendanceCanaryClassroom).toHaveBeenCalledWith({
      teacherId: 'teacher-1', classroomId,
    })
  })

  it('stops before identity resolution outside the exact canary', async () => {
    assertBaraAttendanceCanaryClassroom.mockImplementation(() => {
      throw new BaraAttendanceCanaryError('disabled')
    })

    const response = await POST(request({
      classroom_id: classroomId,
      window_start: '2026-09-01',
      window_end: '2026-12-31',
    }))

    expect(response.status).toBe(404)
    expect(resolveVerifiedPikaAttendanceTeacher).not.toHaveBeenCalled()
    expect(syncTeacherAttendanceSources).not.toHaveBeenCalled()
  })

  it('rejects reversed and oversized windows before source preparation', async () => {
    expect((await POST(request({
      classroom_id: classroomId,
      window_start: '2026-12-31',
      window_end: '2026-09-01',
    }))).status).toBe(400)
    expect((await POST(request({
      classroom_id: classroomId,
      window_start: '2026-01-01',
      window_end: '2027-12-31',
    }))).status).toBe(400)
    expect(syncTeacherAttendanceSources).not.toHaveBeenCalled()
  })

  it('returns a retryable conflict when the source token changed', async () => {
    syncTeacherAttendanceSources.mockRejectedValue(
      new BaraAttendanceSyncError('source_changed'),
    )
    const response = await POST(request({
      classroom_id: classroomId,
      window_start: '2026-09-01',
      window_end: '2026-12-31',
    }))
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'Attendance source changed; retry the sync',
    })
  })
})
