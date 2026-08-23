import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/teacher/attendance/session/route'
import { TeacherAttendanceViewReadError } from '@/lib/server/bara-attendance-view'
import { TeacherAttendanceIdentityError } from '@/lib/server/bara-attendance-teacher'
import { BaraAttendanceCanaryError } from '@/lib/server/bara-attendance-canary'

const {
  requireRole,
  assertTeacherOwnsClassroom,
  assertTeacherCanMutateClassroom,
  loadTeacherAttendanceView,
  getBaraAttendanceIntegrationState,
  assertBaraAttendanceCanaryClassroom,
  executeTeacherAttendanceSessionCommand,
  resolveVerifiedPikaAttendanceTeacher,
  supabase,
} = vi.hoisted(() => ({
  requireRole: vi.fn(),
  assertTeacherOwnsClassroom: vi.fn(),
  assertTeacherCanMutateClassroom: vi.fn(),
  loadTeacherAttendanceView: vi.fn(),
  getBaraAttendanceIntegrationState: vi.fn(),
  assertBaraAttendanceCanaryClassroom: vi.fn(),
  executeTeacherAttendanceSessionCommand: vi.fn(),
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
vi.mock('@/lib/server/classrooms', () => ({
  assertTeacherOwnsClassroom,
  assertTeacherCanMutateClassroom,
}))
vi.mock('@/lib/server/bara-attendance-client', () => ({ getBaraAttendanceIntegrationState }))
vi.mock('@/lib/server/bara-attendance-canary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/bara-attendance-canary')>()
  return {
    ...actual,
    assertBaraAttendanceCanaryClassroom,
    getBaraAttendanceClassroomIntegrationState: getBaraAttendanceIntegrationState,
  }
})
vi.mock('@/lib/server/bara-attendance-view', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/bara-attendance-view')>()
  return { ...actual, loadTeacherAttendanceView }
})
vi.mock('@/lib/server/bara-attendance-commands', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/bara-attendance-commands')>()
  return { ...actual, executeTeacherAttendanceSessionCommand }
})
vi.mock('@/lib/server/bara-attendance-teacher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/bara-attendance-teacher')>()
  return { ...actual, resolveVerifiedPikaAttendanceTeacher }
})

const classroomId = '20000000-0000-4000-8000-000000000002'
const actor = { workosSubject: 'user_teacher', displayName: 'Teacher One' }

describe('GET /api/teacher/attendance/session', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireRole.mockResolvedValue({ id: 'teacher-1', email: 'teacher@example.com', role: 'teacher' })
    resolveVerifiedPikaAttendanceTeacher.mockResolvedValue(actor)
    assertTeacherOwnsClassroom.mockResolvedValue({
      ok: true,
      classroom: { id: classroomId, teacher_id: 'teacher-1', archived_at: null },
    })
    assertTeacherCanMutateClassroom.mockResolvedValue({
      ok: true,
      classroom: { id: classroomId, teacher_id: 'teacher-1', archived_at: null },
    })
    getBaraAttendanceIntegrationState.mockReturnValue('disabled')
    loadTeacherAttendanceView.mockResolvedValue({
      classroomId,
      classDate: '2026-09-08',
      integration: 'disabled',
      session: {
        state: 'not_scheduled', opensAt: null, closesAt: null, revision: null, commandFailed: false,
      },
      sync: { state: 'unavailable', confirmedAt: null },
      students: [],
    })
    executeTeacherAttendanceSessionCommand.mockResolvedValue({
      outcome: 'applied', state: 'open', revision: 2,
    })
  })

  it('authenticates and authorizes before returning the closed Pika view model', async () => {
    const response = await GET(new NextRequest(
      `http://localhost/api/teacher/attendance/session?classroom_id=${classroomId}&date=2026-09-08`,
    ))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ integration: 'disabled', students: [] })
    expect(requireRole).toHaveBeenCalledWith('teacher')
    expect(assertTeacherOwnsClassroom).toHaveBeenCalledWith(
      'teacher-1', classroomId, { supabase },
    )
    expect(loadTeacherAttendanceView).toHaveBeenCalledWith(expect.objectContaining({
      supabase,
      classroomId,
      classDate: '2026-09-08',
      integration: 'disabled',
    }))
  })

  it('rejects malformed or extra query fields at the boundary', async () => {
    const response = await GET(new NextRequest(
      `http://localhost/api/teacher/attendance/session?classroom_id=${classroomId}&date=09-08-2026&provider=convex`,
    ))

    expect(response.status).toBe(400)
    expect(loadTeacherAttendanceView).not.toHaveBeenCalled()
  })

  it('does not read attendance when the teacher does not own the classroom', async () => {
    assertTeacherOwnsClassroom.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })
    const response = await GET(new NextRequest(
      `http://localhost/api/teacher/attendance/session?classroom_id=${classroomId}&date=2026-09-08`,
    ))

    expect(response.status).toBe(403)
    expect(loadTeacherAttendanceView).not.toHaveBeenCalled()
  })

  it('returns the disabled view without opening the canary for an archived classroom', async () => {
    assertTeacherOwnsClassroom.mockResolvedValue({
      ok: true,
      classroom: {
        id: classroomId,
        teacher_id: 'teacher-1',
        archived_at: '2026-08-21T12:00:00.000Z',
      },
    })
    getBaraAttendanceIntegrationState.mockReturnValue('ready')

    const response = await GET(new NextRequest(
      `http://localhost/api/teacher/attendance/session?classroom_id=${classroomId}&date=2026-09-08`,
    ))

    expect(response.status).toBe(200)
    expect(loadTeacherAttendanceView).toHaveBeenCalledWith(expect.objectContaining({
      integration: 'disabled',
    }))
    expect(getBaraAttendanceIntegrationState).not.toHaveBeenCalled()
  })

  it('maps missing or invalid projection storage to a privacy-safe 503', async () => {
    loadTeacherAttendanceView.mockRejectedValue(
      new TeacherAttendanceViewReadError('migration_required'),
    )
    const response = await GET(new NextRequest(
      `http://localhost/api/teacher/attendance/session?classroom_id=${classroomId}&date=2026-09-08`,
    ))

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'Attendance is temporarily unavailable' })
  })

  it('authorizes and translates a manual session command without returning service IDs', async () => {
    assertTeacherCanMutateClassroom.mockResolvedValue({
      ok: true,
      classroom: { id: classroomId, teacher_id: 'teacher-1', archived_at: null },
    })
    const requestId = '40000000-0000-4000-8000-000000000004'
    const response = await POST(new NextRequest(
      'http://localhost/api/teacher/attendance/session',
      {
        method: 'POST',
        body: JSON.stringify({
          classroom_id: classroomId,
          date: '2026-09-08',
          request_id: requestId,
          command: 'open',
        }),
      },
    ))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ outcome: 'applied', state: 'open', revision: 2 })
    expect(executeTeacherAttendanceSessionCommand).toHaveBeenCalledWith({
      supabase,
      teacherId: 'teacher-1',
      classroomId,
      classDate: '2026-09-08',
      requestId,
      command: 'open',
      actor,
      integrationState: 'ready',
    })
    expect(resolveVerifiedPikaAttendanceTeacher).toHaveBeenCalledWith({
      supabase,
      pikaUser: { id: 'teacher-1', email: 'teacher@example.com', role: 'teacher' },
    })
  })

  it('does not call Bara when the live WorkOS subject no longer matches Pika', async () => {
    resolveVerifiedPikaAttendanceTeacher.mockRejectedValue(
      new TeacherAttendanceIdentityError('identity_not_linked'),
    )
    const response = await POST(new NextRequest(
      'http://localhost/api/teacher/attendance/session',
      {
        method: 'POST',
        body: JSON.stringify({
          classroom_id: classroomId,
          date: '2026-09-08',
          request_id: '40000000-0000-4000-8000-000000000004',
          command: 'open',
        }),
      },
    ))

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'Attendance identity is not linked' })
    expect(executeTeacherAttendanceSessionCommand).not.toHaveBeenCalled()
  })

  it('rejects a non-canary classroom before resolving the WorkOS actor', async () => {
    assertBaraAttendanceCanaryClassroom.mockImplementationOnce(() => {
      throw new BaraAttendanceCanaryError('disabled')
    })
    const response = await POST(new NextRequest(
      'http://localhost/api/teacher/attendance/session',
      {
        method: 'POST',
        body: JSON.stringify({
          classroom_id: classroomId,
          date: '2026-09-08',
          request_id: '40000000-0000-4000-8000-000000000004',
          command: 'open',
        }),
      },
    ))

    expect(response.status).toBe(404)
    expect(resolveVerifiedPikaAttendanceTeacher).not.toHaveBeenCalled()
    expect(executeTeacherAttendanceSessionCommand).not.toHaveBeenCalled()
  })
})
