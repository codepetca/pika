import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST, PUT } from '@/app/api/teacher/manual-attendance/route'
import { ManualAttendanceStoreError } from '@/lib/server/manual-attendance'

const {
  requireRole,
  assertTeacherOwnsClassroom,
  assertTeacherCanMutateClassroom,
  loadManualAttendanceView,
  saveManualAttendanceMarks,
  saveManualAttendanceSettings,
  supabase,
} = vi.hoisted(() => ({
  requireRole: vi.fn(),
  assertTeacherOwnsClassroom: vi.fn(),
  assertTeacherCanMutateClassroom: vi.fn(),
  loadManualAttendanceView: vi.fn(),
  saveManualAttendanceMarks: vi.fn(),
  saveManualAttendanceSettings: vi.fn(),
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
vi.mock('@/lib/server/manual-attendance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/manual-attendance')>()
  return {
    ...actual,
    loadManualAttendanceView,
    saveManualAttendanceMarks,
    saveManualAttendanceSettings,
  }
})

const classroomId = '20000000-0000-4000-8000-000000000002'
const studentId = '30000000-0000-4000-8000-000000000003'
const view = {
  classroomId,
  classDate: '2026-05-06',
  settings: {
    sourceMode: 'log',
    sessionStartsLocal: null,
    sessionEndsLocal: null,
    revision: 3,
  },
  overrides: [{ studentId, status: 'late' }],
}

describe('/api/teacher/manual-attendance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireRole.mockResolvedValue({ id: 'teacher-1', role: 'teacher' })
    assertTeacherOwnsClassroom.mockResolvedValue({ ok: true, classroom: { id: classroomId } })
    assertTeacherCanMutateClassroom.mockResolvedValue({ ok: true, classroom: { id: classroomId } })
    loadManualAttendanceView.mockResolvedValue(view)
    saveManualAttendanceSettings.mockResolvedValue(view.settings)
    saveManualAttendanceMarks.mockResolvedValue(undefined)
  })

  it('returns the Pika-owned view only after teacher ownership', async () => {
    const response = await GET(new NextRequest(
      `http://localhost/api/teacher/manual-attendance?classroom_id=${classroomId}&date=2026-05-06`,
    ))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(view)
    expect(assertTeacherOwnsClassroom).toHaveBeenCalledWith(
      'teacher-1', classroomId, { supabase },
    )
  })

  it('saves paired passive time and attendance source settings', async () => {
    const response = await PUT(new NextRequest('http://localhost/api/teacher/manual-attendance', {
      method: 'PUT',
      body: JSON.stringify({
        classroom_id: classroomId,
        expected_revision: 3,
        source_mode: 'manual',
        session_starts_local: '09:00',
        session_ends_local: '10:00',
      }),
    }))
    expect(response.status).toBe(200)
    expect(saveManualAttendanceSettings).toHaveBeenCalledWith(expect.objectContaining({
      teacherId: 'teacher-1', classroomId, sourceMode: 'manual',
      expectedRevision: 3,
      sessionStartsLocal: '09:00', sessionEndsLocal: '10:00',
    }))
  })

  it('rejects passive attendance sessions longer than 12 hours before storage', async () => {
    const response = await PUT(new NextRequest('http://localhost/api/teacher/manual-attendance', {
      method: 'PUT',
      body: JSON.stringify({
        classroom_id: classroomId,
        expected_revision: 3,
        source_mode: 'manual',
        session_starts_local: '08:00',
        session_ends_local: '20:01',
      }),
    }))

    expect(response.status).toBe(400)
    expect(saveManualAttendanceSettings).not.toHaveBeenCalled()
  })

  it('saves a bounded set of teacher overrides', async () => {
    const response = await POST(new NextRequest('http://localhost/api/teacher/manual-attendance', {
      method: 'POST',
      body: JSON.stringify({
        classroom_id: classroomId,
        date: '2026-05-06',
        student_ids: [studentId],
        status: 'absent',
      }),
    }))
    expect(response.status).toBe(200)
    expect(saveManualAttendanceMarks).toHaveBeenCalledWith(expect.objectContaining({
      teacherId: 'teacher-1', classroomId, classDate: '2026-05-06',
      studentIds: [studentId], status: 'absent',
    }))
  })

  it('reports an unapplied migration without exposing store details', async () => {
    loadManualAttendanceView.mockRejectedValue(new ManualAttendanceStoreError('migration_required'))
    const response = await GET(new NextRequest(
      `http://localhost/api/teacher/manual-attendance?classroom_id=${classroomId}&date=2026-05-06`,
    ))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: 'Manual attendance is not available until its Pika migration is applied',
    })
  })

  it('returns a refresh conflict for stale settings and roster races', async () => {
    saveManualAttendanceSettings.mockRejectedValueOnce(
      new ManualAttendanceStoreError('stale_revision'),
    )
    const stale = await PUT(new NextRequest('http://localhost/api/teacher/manual-attendance', {
      method: 'PUT',
      body: JSON.stringify({
        classroom_id: classroomId,
        expected_revision: 3,
        source_mode: 'manual',
        session_starts_local: null,
        session_ends_local: null,
      }),
    }))
    expect(stale.status).toBe(409)
    expect(await stale.json()).toEqual({
      error: 'Manual attendance settings changed; refresh and try again',
    })

    saveManualAttendanceMarks.mockRejectedValueOnce(
      new ManualAttendanceStoreError('roster_changed'),
    )
    const roster = await POST(new NextRequest('http://localhost/api/teacher/manual-attendance', {
      method: 'POST',
      body: JSON.stringify({
        classroom_id: classroomId,
        date: '2026-05-06',
        student_ids: [studentId],
        status: 'present',
      }),
    }))
    expect(roster.status).toBe(409)
    expect(await roster.json()).toEqual({ error: 'The roster changed; refresh and try again' })
  })

  it('returns a refresh conflict when the selected date is no longer a class day', async () => {
    saveManualAttendanceMarks.mockRejectedValueOnce(
      new ManualAttendanceStoreError('class_day_changed'),
    )
    const response = await POST(new NextRequest('http://localhost/api/teacher/manual-attendance', {
      method: 'POST',
      body: JSON.stringify({
        classroom_id: classroomId,
        date: '2026-05-06',
        student_ids: [studentId],
        status: 'present',
      }),
    }))

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'This date is no longer a class day; refresh and try again',
    })
  })
})
