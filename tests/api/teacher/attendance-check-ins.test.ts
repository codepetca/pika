import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

import { POST } from '@/app/api/teacher/attendance/check-ins/route'
import { BaraAttendanceCanaryError } from '@/lib/server/bara-attendance-canary'
import { TeacherAttendanceCommandError } from '@/lib/server/bara-attendance-commands'

const {
  requireRole,
  assertTeacherCanMutateClassroom,
  assertBaraAttendanceClassroomAccess,
  resolveVerifiedPikaAttendanceTeacher,
  executeTeacherCheckInInvalidations,
  supabase,
} = vi.hoisted(() => ({
  requireRole: vi.fn(),
  assertTeacherCanMutateClassroom: vi.fn(),
  assertBaraAttendanceClassroomAccess: vi.fn(),
  resolveVerifiedPikaAttendanceTeacher: vi.fn(),
  executeTeacherCheckInInvalidations: vi.fn(),
  supabase: { from: vi.fn() },
}))

vi.mock('@/lib/auth', () => ({
  requireRole,
  AuthenticationError: class AuthenticationError extends Error {
    constructor() { super('Unauthorized'); this.name = 'AuthenticationError' }
  },
  AuthorizationError: class AuthorizationError extends Error {
    constructor() { super('Forbidden'); this.name = 'AuthorizationError' }
  },
}))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => supabase }))
vi.mock('@/lib/server/classrooms', () => ({ assertTeacherCanMutateClassroom }))
vi.mock('@/lib/server/bara-attendance-scope', () => ({ assertBaraAttendanceClassroomAccess }))
vi.mock('@/lib/server/bara-attendance-teacher', () => ({ resolveVerifiedPikaAttendanceTeacher }))
vi.mock('@/lib/server/bara-attendance-commands', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/bara-attendance-commands')>()
  return { ...actual, executeTeacherCheckInInvalidations }
})

const classroomId = '20000000-0000-4000-8000-000000000002'
const studentId = '10000000-0000-4000-8000-000000000001'
const requestId = '40000000-0000-4000-8000-000000000004'
const actor = { workosSubject: 'user_teacher', displayName: 'Teacher One' }

function request(body: unknown) {
  return new NextRequest('http://localhost/api/teacher/attendance/check-ins', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/teacher/attendance/check-ins', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireRole.mockResolvedValue({ id: 'teacher-1', email: 'teacher@example.com', role: 'teacher' })
    assertTeacherCanMutateClassroom.mockResolvedValue({
      ok: true,
      classroom: { id: classroomId, teacher_id: 'teacher-1', archived_at: null },
    })
    assertBaraAttendanceClassroomAccess.mockResolvedValue({ state: 'ready' })
    resolveVerifiedPikaAttendanceTeacher.mockResolvedValue(actor)
    executeTeacherCheckInInvalidations.mockResolvedValue({
      outcome: 'applied', appliedCount: 1, unchangedCount: 0,
    })
  })

  it('authorizes and requests audited QR check-in invalidation', async () => {
    const response = await POST(request({
      classroom_id: classroomId,
      date: '2026-09-08',
      request_id: requestId,
      student_ids: [studentId],
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      outcome: 'applied', appliedCount: 1, unchangedCount: 0,
    })
    expect(executeTeacherCheckInInvalidations).toHaveBeenCalledWith({
      supabase,
      teacherId: 'teacher-1',
      classroomId,
      classDate: '2026-09-08',
      requestId,
      studentIds: [studentId],
      actor,
      integrationState: 'ready',
    })
  })

  it('fails before identity lookup when attendance is outside the enabled scope', async () => {
    assertBaraAttendanceClassroomAccess.mockRejectedValue(new BaraAttendanceCanaryError('disabled'))

    const response = await POST(request({
      classroom_id: classroomId,
      date: '2026-09-08',
      request_id: requestId,
      student_ids: [studentId],
    }))

    expect(response.status).toBe(404)
    expect(resolveVerifiedPikaAttendanceTeacher).not.toHaveBeenCalled()
    expect(executeTeacherCheckInInvalidations).not.toHaveBeenCalled()
  })

  it('maps concurrent attendance changes to a refreshable conflict', async () => {
    executeTeacherCheckInInvalidations.mockRejectedValue(
      new TeacherAttendanceCommandError('roster_changed'),
    )

    const response = await POST(request({
      classroom_id: classroomId,
      date: '2026-09-08',
      request_id: requestId,
      student_ids: [studentId],
    }))

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'Attendance changed; refresh and try again' })
  })
})
