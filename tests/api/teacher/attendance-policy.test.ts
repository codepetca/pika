import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, PUT } from '@/app/api/teacher/attendance/policy/route'
import { TeacherAttendancePolicyError } from '@/lib/server/bara-attendance-policy'
import { BaraAttendanceCanaryError } from '@/lib/server/bara-attendance-canary'

const {
  requireRole,
  assertTeacherOwnsClassroom,
  assertTeacherCanMutateClassroom,
  loadTeacherAttendancePolicy,
  saveTeacherAttendancePolicy,
  assertBaraAttendanceCanaryClassroom,
  supabase,
} = vi.hoisted(() => ({
  requireRole: vi.fn(),
  assertTeacherOwnsClassroom: vi.fn(),
  assertTeacherCanMutateClassroom: vi.fn(),
  loadTeacherAttendancePolicy: vi.fn(),
  saveTeacherAttendancePolicy: vi.fn(),
  assertBaraAttendanceCanaryClassroom: vi.fn(),
  supabase: { from: vi.fn(), rpc: vi.fn() },
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
vi.mock('@/lib/server/bara-attendance-policy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/bara-attendance-policy')>()
  return { ...actual, loadTeacherAttendancePolicy, saveTeacherAttendancePolicy }
})
vi.mock('@/lib/server/bara-attendance-canary', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/bara-attendance-canary')>()
  return { ...actual, assertBaraAttendanceCanaryClassroom }
})

const classroomId = '20000000-0000-4000-8000-000000000002'
const policy = {
  classroomId,
  timezone: 'America/Toronto',
  opensLocal: '08:45',
  closesLocal: '10:15',
  closeDayOffset: 0,
  enabled: true,
  revision: 1,
  updatedAt: '2026-08-16T20:00:00.000Z',
}

describe('/api/teacher/attendance/policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    assertBaraAttendanceCanaryClassroom.mockImplementation(() => undefined)
    requireRole.mockResolvedValue({ id: 'teacher-1', role: 'teacher' })
    assertTeacherOwnsClassroom.mockResolvedValue({ ok: true, classroom: { id: classroomId } })
    assertTeacherCanMutateClassroom.mockResolvedValue({ ok: true, classroom: { id: classroomId } })
    loadTeacherAttendancePolicy.mockResolvedValue(policy)
    saveTeacherAttendancePolicy.mockResolvedValue(policy)
  })

  it('returns the policy only after teacher ownership', async () => {
    const response = await GET(new NextRequest(
      `http://localhost/api/teacher/attendance/policy?classroom_id=${classroomId}`,
    ))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ policy })
    expect(assertTeacherOwnsClassroom).toHaveBeenCalledWith(
      'teacher-1', classroomId, { supabase },
    )
    expect(assertBaraAttendanceCanaryClassroom).toHaveBeenCalledWith({
      teacherId: 'teacher-1', classroomId,
    })
  })

  it('validates and saves a same-day policy with an expected revision', async () => {
    const response = await PUT(new NextRequest('http://localhost/api/teacher/attendance/policy', {
      method: 'PUT',
      body: JSON.stringify({
        classroom_id: classroomId,
        opens_local: '08:45',
        closes_local: '10:15',
        close_day_offset: 0,
        enabled: true,
        expected_revision: 1,
      }),
    }))
    expect(response.status).toBe(200)
    expect(saveTeacherAttendancePolicy).toHaveBeenCalledWith(expect.objectContaining({
      teacherId: 'teacher-1',
      classroomId,
      opensLocal: '08:45',
      closesLocal: '10:15',
      expectedRevision: 1,
    }))
  })

  it('does not read or save policy outside the exact canary', async () => {
    assertBaraAttendanceCanaryClassroom.mockImplementation(() => {
      throw new BaraAttendanceCanaryError('disabled')
    })

    const getResponse = await GET(new NextRequest(
      `http://localhost/api/teacher/attendance/policy?classroom_id=${classroomId}`,
    ))
    const putResponse = await PUT(new NextRequest('http://localhost/api/teacher/attendance/policy', {
      method: 'PUT',
      body: JSON.stringify({
        classroom_id: classroomId,
        opens_local: '08:45',
        closes_local: '10:15',
        close_day_offset: 0,
        enabled: true,
        expected_revision: 1,
      }),
    }))

    expect(getResponse.status).toBe(404)
    expect(putResponse.status).toBe(404)
    expect(loadTeacherAttendancePolicy).not.toHaveBeenCalled()
    expect(saveTeacherAttendancePolicy).not.toHaveBeenCalled()
  })

  it('rejects an inverted same-day window before storage', async () => {
    const response = await PUT(new NextRequest('http://localhost/api/teacher/attendance/policy', {
      method: 'PUT',
      body: JSON.stringify({
        classroom_id: classroomId,
        opens_local: '10:15',
        closes_local: '08:45',
        close_day_offset: 0,
        enabled: true,
        expected_revision: 1,
      }),
    }))
    expect(response.status).toBe(400)
    expect(saveTeacherAttendancePolicy).not.toHaveBeenCalled()
  })

  it('maps revision conflict and missing migration to stable public errors', async () => {
    saveTeacherAttendancePolicy.mockRejectedValueOnce(new TeacherAttendancePolicyError('conflict'))
    const conflict = await PUT(new NextRequest('http://localhost/api/teacher/attendance/policy', {
      method: 'PUT',
      body: JSON.stringify({
        classroom_id: classroomId,
        opens_local: '08:45',
        closes_local: '10:15',
        close_day_offset: 0,
        enabled: true,
        expected_revision: 1,
      }),
    }))
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toEqual({
      error: 'Attendance settings changed; refresh and try again',
    })

    loadTeacherAttendancePolicy.mockRejectedValueOnce(
      new TeacherAttendancePolicyError('migration_required'),
    )
    const unavailable = await GET(new NextRequest(
      `http://localhost/api/teacher/attendance/policy?classroom_id=${classroomId}`,
    ))
    expect(unavailable.status).toBe(503)
    expect(await unavailable.json()).toEqual({
      error: 'Attendance settings are temporarily unavailable',
    })
  })
})
