import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const {
  requireRole,
  authorizeSharedAttendancePolicyActor,
  protocolAdmission,
  assertTeacherCanMutateClassroom,
  syncTeacherAttendanceSources,
  resolveVerifiedPikaAttendanceTeacher,
  resolveVerifiedPikaAttendanceOwner,
  assertBaraAttendanceCanaryClassroom,
  supabase,
} = vi.hoisted(() => ({
  requireRole: vi.fn(),
  authorizeSharedAttendancePolicyActor: vi.fn(),
  protocolAdmission: vi.fn(),
  assertTeacherCanMutateClassroom: vi.fn(),
  syncTeacherAttendanceSources: vi.fn(),
  resolveVerifiedPikaAttendanceTeacher: vi.fn(),
  resolveVerifiedPikaAttendanceOwner: vi.fn(),
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
  return { ...actual, resolveVerifiedPikaAttendanceTeacher, resolveVerifiedPikaAttendanceOwner }
})
vi.mock('@/lib/server/classroom-experience-admission', () => ({ resolveAttendanceProtocolCompatibility: protocolAdmission }))
vi.mock('@/lib/server/contextual-attendance-policy', () => ({ authorizeSharedAttendancePolicyActor }))
vi.mock('@/lib/server/bara-attendance-canary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/bara-attendance-canary')>()
  return { ...actual, assertBaraAttendanceCanaryClassroom }
})

import { POST } from '@/app/api/teacher/attendance/sync/route'
import { BaraAttendanceSyncError } from '@/lib/server/bara-attendance-sync'
import { BaraAttendanceCanaryError } from '@/lib/server/bara-attendance-canary'
import { TeacherAttendanceIdentityError } from '@/lib/server/bara-attendance-teacher'

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
    authorizeSharedAttendancePolicyActor.mockResolvedValue({ mode: 'existing' })
    protocolAdmission.mockResolvedValue({ status: 'not-admitted' })
    assertBaraAttendanceCanaryClassroom.mockImplementation(() => undefined)
    requireRole.mockResolvedValue({ id: 'teacher-1', email: 'teacher@example.com', role: 'teacher' })
    resolveVerifiedPikaAttendanceTeacher.mockResolvedValue(actor)
    resolveVerifiedPikaAttendanceOwner.mockResolvedValue(actor)
    assertTeacherCanMutateClassroom.mockResolvedValue({ ok: true })
    syncTeacherAttendanceSources.mockResolvedValue({
      roster: { outcome: 'applied', revision: 2 },
      schedule: { outcome: 'applied', revision: 3 },
    })
  })

  it('uses the legacy teacher identity and source protocol for a shared actor outside the bootstrap set', async () => {
    authorizeSharedAttendancePolicyActor.mockResolvedValue({ mode: 'shared', user: {
      id: '30000000-0000-4000-8000-000000000003', email: 'owner@example.com', role: 'teacher',
    } })
    protocolAdmission.mockResolvedValue({ status: 'not-admitted' })
    requireRole.mockResolvedValue({ id: '30000000-0000-4000-8000-000000000003', email: 'owner@example.com', role: 'teacher' })
    const response = await POST(request({ classroom_id: classroomId, window_start: '2026-09-01', window_end: '2026-12-31' }))
    expect(response.status).toBe(200)
    expect(resolveVerifiedPikaAttendanceTeacher).toHaveBeenCalled()
    expect(resolveVerifiedPikaAttendanceOwner).not.toHaveBeenCalled()
    expect(syncTeacherAttendanceSources.mock.calls[0][0]).not.toHaveProperty('membershipAware')
  })

  it('retains the teacher role gate for a later admitted student-label owner', async () => {
    authorizeSharedAttendancePolicyActor.mockResolvedValue({ mode: 'shared', user: {
      id: '30000000-0000-4000-8000-000000000003', email: 'owner@example.com', role: 'student',
    } })
    requireRole.mockRejectedValue(Object.assign(new Error('Forbidden'), { name: 'AuthorizationError' }))
    const response = await POST(request({ classroom_id: classroomId, window_start: '2026-09-01', window_end: '2026-12-31' }))
    expect(response.status).toBe(403)
    expect(syncTeacherAttendanceSources).not.toHaveBeenCalled()
    expect(resolveVerifiedPikaAttendanceOwner).not.toHaveBeenCalled()
    expect(resolveVerifiedPikaAttendanceTeacher).not.toHaveBeenCalled()
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

  it('uses current ownership and the membership-aware sync for an admitted owner with a student label', async () => {
    const user = { id: '30000000-0000-4000-8000-000000000003', email: 'owner@example.com', role: 'student' }
    protocolAdmission.mockResolvedValue({ status: 'admitted' })
    authorizeSharedAttendancePolicyActor.mockResolvedValue({ mode: 'shared', user })
    const response = await POST(request({ classroom_id: classroomId, window_start: '2026-09-01', window_end: '2026-12-31' }))
    expect(response.status).toBe(200)
    expect(requireRole).not.toHaveBeenCalled()
    expect(assertTeacherCanMutateClassroom).toHaveBeenCalledWith(user.id, classroomId, { supabase })
    expect(resolveVerifiedPikaAttendanceOwner).toHaveBeenCalledWith({ supabase, pikaUser: user })
    expect(resolveVerifiedPikaAttendanceTeacher).not.toHaveBeenCalled()
    expect(syncTeacherAttendanceSources).toHaveBeenCalledWith(expect.objectContaining({
      teacherId: user.id, membershipAware: true, verifiedActor: actor,
    }))
  })

  it.each([403, 404])('does not treat admission as ownership (%s)', async (status) => {
    protocolAdmission.mockResolvedValue({ status: 'admitted' })
    authorizeSharedAttendancePolicyActor.mockResolvedValue({ mode: 'shared', user: {
      id: '30000000-0000-4000-8000-000000000003', email: 'owner@example.com', role: 'student',
    } })
    assertTeacherCanMutateClassroom.mockResolvedValue({ ok: false, status, error: 'Forbidden' })
    const response = await POST(request({ classroom_id: classroomId, window_start: '2026-09-01', window_end: '2026-12-31' }))
    expect(response.status).toBe(status)
    expect(resolveVerifiedPikaAttendanceOwner).not.toHaveBeenCalled()
    expect(syncTeacherAttendanceSources).not.toHaveBeenCalled()
  })

  it('does not accept a client-selected membership mode', async () => {
    const response = await POST(request({
      classroom_id: classroomId, window_start: '2026-09-01', window_end: '2026-12-31', membershipAware: true,
    }))
    expect(response.status).toBe(400)
    expect(syncTeacherAttendanceSources).not.toHaveBeenCalled()
  })

  it('does not sync an admitted owner whose WorkOS identity no longer matches', async () => {
    protocolAdmission.mockResolvedValue({ status: 'admitted' })
    authorizeSharedAttendancePolicyActor.mockResolvedValue({ mode: 'shared', user: {
      id: '30000000-0000-4000-8000-000000000003', email: 'owner@example.com', role: 'student',
    } })
    resolveVerifiedPikaAttendanceOwner.mockRejectedValue(new TeacherAttendanceIdentityError('identity_not_linked'))
    const response = await POST(request({ classroom_id: classroomId, window_start: '2026-09-01', window_end: '2026-12-31' }))
    expect(response.status).toBe(409)
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
