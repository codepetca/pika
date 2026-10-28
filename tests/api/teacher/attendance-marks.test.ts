import { readClassroomAdmissionRegistry } from '@/lib/server/classroom-admission-registry'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/teacher/attendance/marks/route'
import { TeacherAttendanceCommandError } from '@/lib/server/bara-attendance-commands'
import { BaraAttendanceCanaryError } from '@/lib/server/bara-attendance-canary'

const {
  requireRole,
  requireAuth,
  assertTeacherCanMutateClassroom,
  executeTeacherAttendanceMarks,
  resolveVerifiedPikaAttendanceTeacher,
  assertBaraAttendanceCanaryClassroom,
  supabase,
} = vi.hoisted(() => ({
  requireRole: vi.fn(),
  requireAuth: vi.fn(),
  assertTeacherCanMutateClassroom: vi.fn(),
  executeTeacherAttendanceMarks: vi.fn(),
  resolveVerifiedPikaAttendanceTeacher: vi.fn(),
  assertBaraAttendanceCanaryClassroom: vi.fn(),
  supabase: { from: vi.fn() },
}))

vi.mock('@/lib/auth', () => ({
  requireRole,
  requireAuth,
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
vi.mock('@/lib/server/bara-attendance-canary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/bara-attendance-canary')>()
  return { ...actual, assertBaraAttendanceCanaryClassroom }
})

vi.mock('@/lib/server/classroom-admission-registry', () => ({ readClassroomAdmissionRegistry: vi.fn() }))

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
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', undefined)
    assertBaraAttendanceCanaryClassroom.mockImplementation(() => undefined)
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
  afterEach(() => vi.unstubAllEnvs())

  it('retains the legacy marks protocol for later registry grants', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 2, source: 'registry', bootstrapManifestSha256: 'a'.repeat(64) }))
    vi.mocked(readClassroomAdmissionRegistry).mockResolvedValue({ admitted: true, bootstrap_member: false } as never)
    requireAuth.mockResolvedValue({ id: requestId, email: 'owner@example.com', role: 'teacher' })
    requireRole.mockResolvedValue({ id: requestId, email: 'owner@example.com', role: 'teacher' })
    const response = await POST(request({ classroom_id: classroomId, date: '2026-09-08', request_id: requestId,
      marks: [{ student_id: studentId, status: 'present' }] }))
    expect(response.status).toBe(200)
    expect(executeTeacherAttendanceMarks.mock.calls[0][0]).not.toHaveProperty('membershipAware')
    const generationRequest = await POST(request({ classroom_id: classroomId, date: '2026-09-08', request_id: requestId,
      marks: [{ student_id: studentId, expected_generation_id: classroomId, status: 'present' }] }))
    expect(generationRequest.status).toBe(400)
  })

  it('retains the teacher role gate for a later registry-admitted student-label owner', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 2, source: 'registry', bootstrapManifestSha256: 'a'.repeat(64) }))
    vi.mocked(readClassroomAdmissionRegistry).mockResolvedValue({ admitted: true, bootstrap_member: false } as never)
    requireAuth.mockResolvedValue({ id: requestId, email: 'owner@example.com', role: 'student' })
    requireRole.mockRejectedValue(Object.assign(new Error('Forbidden'), { name: 'AuthorizationError' }))
    expect((await POST(request({ classroom_id: classroomId, date: '2026-09-08', request_id: requestId,
      marks: [{ student_id: studentId, status: 'present' }] }))).status).toBe(403)
    expect(executeTeacherAttendanceMarks).not.toHaveBeenCalled()
  })

  it.each(['teacher', 'student'])('binds admitted %s owner marks to their supplied exact generation', async role => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [requestId] }))
    requireAuth.mockResolvedValue({ id: requestId, email: 'owner@example.com', role })
    const response = await POST(request({ classroom_id: classroomId, date: '2026-09-08', request_id: requestId,
      marks: [{ student_id: studentId, expected_generation_id: classroomId, status: 'automatic' }] }))
    expect(response.status).toBe(200)
    expect(requireRole).not.toHaveBeenCalled()
    expect(assertTeacherCanMutateClassroom).toHaveBeenCalledWith(requestId, classroomId, { supabase })
    expect(executeTeacherAttendanceMarks).toHaveBeenCalledWith(expect.objectContaining({
      teacherId: requestId, membershipAware: true,
      marks: [{ studentId, expectedGenerationId: classroomId, status: 'automatic' }],
    }))
  })

  it('requires every shared target and accepts no caller-selected admission mode', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [requestId] }))
    requireAuth.mockResolvedValue({ id: requestId, email: 'owner@example.com', role: 'student' })
    for (const body of [
      { marks: [{ student_id: studentId, status: 'present' }] },
      { marks: [{ student_id: studentId, status: 'present', expected_generation_id: null }] },
      { membershipAware: false, marks: [{ student_id: studentId, status: 'present', expected_generation_id: classroomId }] },
      { marks: [{ student_id: studentId, status: 'present', expected_generation_id: classroomId }, { student_id: studentId, status: 'absent', expected_generation_id: classroomId }] },
    ]) {
      expect((await POST(request({ classroom_id: classroomId, date: '2026-09-08', request_id: requestId, ...body }))).status).toBe(400)
    }
    expect(executeTeacherAttendanceMarks).not.toHaveBeenCalled()
  })

  it('rejects the generation field for an unadmitted legacy request', async () => {
    expect((await POST(request({ classroom_id: classroomId, date: '2026-09-08', request_id: requestId,
      marks: [{ student_id: studentId, expected_generation_id: classroomId, status: 'present' }] }))).status).toBe(400)
    expect(executeTeacherAttendanceMarks).not.toHaveBeenCalled()
  })

  it('retains the teacher role guard for an unmatched student actor before validation', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [] }))
    requireAuth.mockResolvedValue({ id: requestId, email: 'member@example.com', role: 'student' })
    requireRole.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { name: 'AuthorizationError' }))
    expect((await POST(request({}))).status).toBe(403)
    expect(requireRole).toHaveBeenCalledWith('teacher')
    expect(executeTeacherAttendanceMarks).not.toHaveBeenCalled()
  })

  it('fails closed for malformed admission after authentication', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{')
    requireAuth.mockResolvedValue({ id: requestId, email: 'owner@example.com', role: 'teacher' })
    expect((await POST(request({}))).status).toBe(503)
    expect(requireAuth).toHaveBeenCalledOnce()
    expect(requireRole).not.toHaveBeenCalled()
    expect(executeTeacherAttendanceMarks).not.toHaveBeenCalled()
  })

  it('keeps actual shared ownership and stale-target failures authoritative', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [requestId] }))
    requireAuth.mockResolvedValue({ id: requestId, email: 'owner@example.com', role: 'student' })
    const body = { classroom_id: classroomId, date: '2026-09-08', request_id: requestId,
      marks: [{ student_id: studentId, expected_generation_id: classroomId, status: 'present' }] }
    assertTeacherCanMutateClassroom.mockResolvedValueOnce({ ok: false, status: 403, error: 'Forbidden' })
    expect((await POST(request(body))).status).toBe(403)
    expect(executeTeacherAttendanceMarks).not.toHaveBeenCalled()
    executeTeacherAttendanceMarks.mockRejectedValue(new TeacherAttendanceCommandError('roster_changed'))
    expect((await POST(request(body))).status).toBe(409)
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
      integrationState: 'ready',
      marks: [{ studentId, status: 'present' }],
    })
    expect(assertBaraAttendanceCanaryClassroom).toHaveBeenCalledWith({
      teacherId: 'teacher-1', classroomId,
    })
  })

  it('stops before identity resolution when the classroom is outside the canary', async () => {
    assertBaraAttendanceCanaryClassroom.mockImplementation(() => {
      throw new BaraAttendanceCanaryError('disabled')
    })

    const response = await POST(request({
      classroom_id: classroomId,
      date: '2026-09-08',
      request_id: requestId,
      marks: [{ student_id: studentId, status: 'present' }],
    }))

    expect(response.status).toBe(404)
    expect(resolveVerifiedPikaAttendanceTeacher).not.toHaveBeenCalled()
    expect(executeTeacherAttendanceMarks).not.toHaveBeenCalled()
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
