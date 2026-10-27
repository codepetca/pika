import { readClassroomAdmissionRegistry } from '@/lib/server/classroom-admission-registry'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  requireAuth: vi.fn(),
  execute: vi.fn(),
  supabase: {},
}))

vi.mock('@/lib/server/classroom-admission-registry', () => ({ readClassroomAdmissionRegistry: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireRole: mocks.requireRole, requireAuth: mocks.requireAuth }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => mocks.supabase }))
vi.mock('@/lib/server/classroom-attendance-qr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/classroom-attendance-qr')>()
  return { ...actual, executeClassroomQrStudentCheckIn: mocks.execute }
})

import { POST } from '@/app/api/student/attendance/classroom-check-in/route'
import { ClassroomAttendanceQrError } from '@/lib/server/classroom-attendance-qr'

const user = { id: '30000000-0000-4000-8000-000000000001', email: 'student@example.com', role: 'student' }
const classroomQrToken = 'a'.repeat(43)
const attemptId = '11111111-1111-4111-8111-111111111111'

function request(body: unknown) {
  return new NextRequest('https://pika.codepet.ca/api/student/attendance/classroom-check-in', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

describe('POST /api/student/attendance/classroom-check-in', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', undefined)
    mocks.requireAuth.mockReset().mockResolvedValue(user)
    mocks.requireRole.mockReset()
    mocks.requireRole.mockResolvedValue(user)
    mocks.execute.mockResolvedValue({
      state: 'checked_in', title: 'You are checked in', description: 'Recorded',
      classroomName: 'PPZ3C — Health for Life',
      studentId: user.id, classroomId: '20000000-0000-4000-8000-000000000001',
      attendanceStatus: 'present', recordedAt: '2026-09-02T13:01:00.000Z',
      occurrenceBinding: 'a'.repeat(32), classDate: '2026-09-02',
      serverNow: '2026-09-02T13:02:00.000Z', validUntil: '2026-09-03T04:00:00.000Z',
    })
  })
  afterEach(() => vi.unstubAllEnvs())

  it.each(['student', 'teacher'])('passes an admitted %s actor to the classroom coordinator', async role => {
    const current = { ...user, role }
    mocks.requireAuth.mockResolvedValue(current)
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [user.id] }))
    expect((await POST(request({ classroomQrToken, attemptId }))).status).toBe(200)
    expect(mocks.requireRole).not.toHaveBeenCalled()
    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({ pikaUser: current }))
  })

  it('keeps later registry grants subject to the legacy student role gate', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 2, source: 'registry', bootstrapManifestSha256: 'a'.repeat(64) }))
    vi.mocked(readClassroomAdmissionRegistry).mockResolvedValue({ admitted: true, bootstrap_member: false } as never)
    mocks.requireAuth.mockResolvedValue({ ...user, role: 'teacher' })
    mocks.requireRole.mockRejectedValue(Object.assign(new Error('Forbidden'), { name: 'AuthorizationError' }))
    expect((await POST(request({ classroomQrToken, attemptId }))).status).toBe(403)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('retains the legacy teacher rejection when admission is absent', async () => {
    mocks.requireAuth.mockResolvedValue({ ...user, role: 'teacher' })
    mocks.requireRole.mockRejectedValue(Object.assign(new Error('Forbidden'), { name: 'AuthorizationError' }))
    expect((await POST(request({ classroomQrToken, attemptId }))).status).toBe(403)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('authenticates before failing closed for malformed admission', async () => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{')
    expect((await POST(request({ classroomQrToken, attemptId }))).status).toBe(503)
    mocks.requireAuth.mockRejectedValue(Object.assign(new Error('Unauthorized'), { name: 'AuthenticationError' }))
    expect((await POST(request({ classroomQrToken, attemptId }))).status).toBe(401)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('derives identity only from the authenticated student session', async () => {
    const response = await POST(request({ classroomQrToken, attemptId }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ classroomName: 'PPZ3C — Health for Life' })
    expect(mocks.requireRole).toHaveBeenCalledWith('student')
    expect(mocks.execute).toHaveBeenCalledWith({
      supabase: mocks.supabase, pikaUser: user, classroomQrToken, attemptId,
    })
  })

  it.each([
    ['invalid_or_revoked', 'invalid', 'This classroom QR is no longer valid'],
    ['not_open', 'closed', 'Attendance is not open'],
    ['not_enrolled', 'needs_staff', 'You haven’t joined this classroom yet'],
    ['not_on_roster', 'needs_staff', 'You’re not on this class roster'],
    ['roster_ambiguous', 'needs_staff', 'We couldn’t safely match your account'],
  ] as const)('maps %s without leaking classroom or Bara identifiers', async (code, state, title) => {
    mocks.execute.mockRejectedValue(new ClassroomAttendanceQrError(code))
    const response = await POST(request({ classroomQrToken, attemptId }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ state, title })
    expect(JSON.stringify(body)).not.toMatch(/11111111|roster_|occurrence_|check.in.token/i)
  })

  it('returns no description for a revoked classroom QR', async () => {
    mocks.execute.mockRejectedValue(new ClassroomAttendanceQrError('invalid_or_revoked'))
    const response = await POST(request({ classroomQrToken, attemptId }))
    expect(await response.json()).toEqual({
      state: 'invalid',
      title: 'This classroom QR is no longer valid',
    })
  })

  it('rejects client-supplied classroom or student identity fields', async () => {
    const response = await POST(request({
      classroomQrToken, attemptId, classroomId: 'attacker-choice', studentId: 'attacker-choice',
    }))
    expect(response.status).toBe(400)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
