import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/teacher/attendance/marks/route'
import { TeacherAttendanceCommandError } from '@/lib/server/bara-attendance-commands'

const {
  requireRole,
  assertTeacherCanMutateClassroom,
  executeTeacherAttendanceMarks,
  resolveVerifiedPikaAttendanceTeacher,
  supabase,
} = vi.hoisted(() => ({
  requireRole: vi.fn(),
  assertTeacherCanMutateClassroom: vi.fn(),
  executeTeacherAttendanceMarks: vi.fn(),
  resolveVerifiedPikaAttendanceTeacher: vi.fn(),
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
vi.mock('@/lib/server/bara-attendance-commands', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/bara-attendance-commands')>()
  return { ...actual, executeTeacherAttendanceMarks }
})
vi.mock('@/lib/server/bara-attendance-teacher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/bara-attendance-teacher')>()
  return { ...actual, resolveVerifiedPikaAttendanceTeacher }
})

const classroomId = '20000000-0000-4000-8000-000000000002'
const studentId = '10000000-0000-4000-8000-000000000001'
const requestId = '40000000-0000-4000-8000-000000000004'
const actor = { workosSubject: 'user_teacher', displayName: 'Teacher One' }

function request(body: unknown) {
  return new NextRequest('http://localhost/api/teacher/attendance/marks', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/teacher/attendance/marks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireRole.mockResolvedValue({ id: 'teacher-1', email: 'teacher@example.com', role: 'teacher' })
    resolveVerifiedPikaAttendanceTeacher.mockResolvedValue(actor)
    assertTeacherCanMutateClassroom.mockResolvedValue({
      ok: true,
      classroom: { id: classroomId, teacher_id: 'teacher-1', archived_at: null },
    })
    executeTeacherAttendanceMarks.mockResolvedValue({
      outcome: 'applied',
      sessionRevision: 5,
      appliedCount: 1,
      unchangedCount: 0,
    })
  })

  it('authorizes and sends only Pika student commands to the adapter', async () => {
    const response = await POST(request({
      classroom_id: classroomId,
      date: '2026-09-08',
      request_id: requestId,
      marks: [{ student_id: studentId, status: 'present' }],
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      outcome: 'applied',
      sessionRevision: 5,
      appliedCount: 1,
      unchangedCount: 0,
    })
    expect(executeTeacherAttendanceMarks).toHaveBeenCalledWith({
      supabase,
      teacherId: 'teacher-1',
      classroomId,
      classDate: '2026-09-08',
      requestId,
      actor,
      marks: [{ studentId, status: 'present' }],
    })
  })

  it('rejects duplicate students before calling Bara', async () => {
    const response = await POST(request({
      classroom_id: classroomId,
      date: '2026-09-08',
      request_id: requestId,
      marks: [
        { student_id: studentId, status: 'present' },
        { student_id: studentId, status: 'absent' },
      ],
    }))

    expect(response.status).toBe(400)
    expect(executeTeacherAttendanceMarks).not.toHaveBeenCalled()
  })

  it('rejects free-form correction reasons at the privacy boundary', async () => {
    const response = await POST(request({
      classroom_id: classroomId,
      date: '2026-09-08',
      request_id: requestId,
      marks: [{
        student_id: studentId,
        status: 'absent',
        reason_code: 'Student said they were at a medical appointment',
      }],
    }))
    expect(response.status).toBe(400)
    expect(executeTeacherAttendanceMarks).not.toHaveBeenCalled()
  })

  it('fails closed when a mapped student or authoritative revision changed', async () => {
    executeTeacherAttendanceMarks.mockRejectedValue(
      new TeacherAttendanceCommandError('roster_changed'),
    )
    const response = await POST(request({
      classroom_id: classroomId,
      date: '2026-09-08',
      request_id: requestId,
      marks: [{ student_id: studentId, status: 'late', reason_code: 'late_arrival' }],
    }))

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'Attendance changed; refresh and try again' })
  })

  it('does not send commands for archived or foreign classrooms', async () => {
    assertTeacherCanMutateClassroom.mockResolvedValue({
      ok: false, status: 403, error: 'Classroom is archived',
    })
    const response = await POST(request({
      classroom_id: classroomId,
      date: '2026-09-08',
      request_id: requestId,
      marks: [{ student_id: studentId, status: 'present' }],
    }))
    expect(response.status).toBe(403)
    expect(executeTeacherAttendanceMarks).not.toHaveBeenCalled()
  })
})
