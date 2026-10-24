import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST, PUT } from '@/app/api/teacher/manual-attendance/route'
import { ManualAttendanceStoreError } from '@/lib/server/manual-attendance'

const {
  requireRole,
  requireAuth,
  assertTeacherOwnsClassroom,
  assertTeacherCanMutateClassroom,
  loadManualAttendanceView,
  saveManualAttendanceMarks,
  saveManualAttendanceSettings,
  supabase,
} = vi.hoisted(() => ({
  requireRole: vi.fn(),
  requireAuth: vi.fn(),
  assertTeacherOwnsClassroom: vi.fn(),
  assertTeacherCanMutateClassroom: vi.fn(),
  loadManualAttendanceView: vi.fn(),
  saveManualAttendanceMarks: vi.fn(),
  saveManualAttendanceSettings: vi.fn(),
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
const ownerId = '10000000-0000-4000-8000-000000000001'
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
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', undefined)
    requireRole.mockResolvedValue({ id: 'teacher-1', role: 'teacher' })
    assertTeacherOwnsClassroom.mockResolvedValue({ ok: true, classroom: { id: classroomId } })
    assertTeacherCanMutateClassroom.mockResolvedValue({ ok: true, classroom: { id: classroomId } })
    loadManualAttendanceView.mockResolvedValue(view)
    saveManualAttendanceSettings.mockResolvedValue(view.settings)
    saveManualAttendanceMarks.mockResolvedValue(undefined)
  })
  afterEach(() => vi.unstubAllEnvs())

  const operations = [
    { method: 'GET', handler: GET, store: loadManualAttendanceView },
    { method: 'PUT', handler: PUT, store: saveManualAttendanceSettings },
    { method: 'POST', handler: POST, store: saveManualAttendanceMarks },
  ] as const
  function request(method: 'GET' | 'PUT' | 'POST', invalid = false) {
    const url = 'http://localhost/api/teacher/manual-attendance'
    if (method === 'GET') return new NextRequest(invalid ? url
      : `${url}?classroom_id=${classroomId}&date=2026-05-06`)
    return new NextRequest(url, { method, body: JSON.stringify(invalid ? {} : method === 'PUT'
      ? { classroom_id: classroomId, expected_revision: 3, source_mode: 'manual',
        session_starts_local: null, session_ends_local: null }
      : { classroom_id: classroomId, date: '2026-05-06', student_ids: [studentId], status: 'present' }) })
  }
  function admit(role: 'teacher' | 'student') {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [ownerId] }))
    requireAuth.mockResolvedValue({ id: ownerId, role, email: 'owner@example.com' })
    requireRole.mockRejectedValue(Object.assign(new Error('Forbidden'), { name: 'AuthorizationError' }))
  }

  describe.each(operations)('$method contextual ownership', ({ method, handler, store }) => {
    it.each(['student', 'teacher'] as const)('allows an admitted %s owner without changing identity', async role => {
      admit(role)
      expect((await handler(request(method))).status).toBe(200)
      expect(requireAuth).toHaveBeenCalledOnce()
      expect(requireRole).not.toHaveBeenCalled()
      expect(method === 'GET' ? assertTeacherOwnsClassroom : assertTeacherCanMutateClassroom)
        .toHaveBeenCalledWith(ownerId, classroomId, { supabase })
      expect(store).toHaveBeenCalledOnce()
      if (method !== 'GET') expect(store).toHaveBeenCalledWith(expect.objectContaining({ teacherId: ownerId }))
    })

    it.each([403, 404, 503])('stops before storage on ownership failure %s', async status => {
      admit('student')
      const guard = method === 'GET' ? assertTeacherOwnsClassroom : assertTeacherCanMutateClassroom
      guard.mockResolvedValue({ ok: false, status, error: 'Classroom access unavailable' })
      const response = await handler(request(method))
      expect(response.status).toBe(status)
      expect(await response.json()).toEqual({ error: 'Classroom access unavailable' })
      expect(store).not.toHaveBeenCalled()
    })

    it.each([undefined, JSON.stringify({ version: 1, admittedUserIds: [] })])(
      'retains the legacy teacher gate when not admitted (%s)', async config => {
        vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', config)
        requireAuth.mockResolvedValue({ id: ownerId, role: 'student' })
        requireRole.mockRejectedValue(Object.assign(new Error('Forbidden'), { name: 'AuthorizationError' }))
        expect((await handler(request(method, true))).status).toBe(403)
        expect(requireRole).toHaveBeenCalledWith('teacher')
        expect(store).not.toHaveBeenCalled()
      },
    )

    it('fails closed on invalid admission before request validation or storage', async () => {
      admit('student')
      vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{')
      expect((await handler(request(method, true))).status).toBe(503)
      expect(requireAuth).toHaveBeenCalledOnce()
      expect(requireRole).not.toHaveBeenCalled()
      expect(store).not.toHaveBeenCalled()
    })

    it('authenticates before interpreting malformed admission', async () => {
      vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{')
      requireAuth.mockRejectedValue(Object.assign(new Error('Unauthorized'), { name: 'AuthenticationError' }))
      expect((await handler(request(method, true))).status).toBe(401)
      expect(store).not.toHaveBeenCalled()
    })

    it('keeps request validation for admitted owners', async () => {
      admit('student')
      expect((await handler(request(method, true))).status).toBe(400)
      expect(store).not.toHaveBeenCalled()
    })

    it('retains the existing teacher path when a configured cohort does not include the actor', async () => {
      vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [] }))
      requireAuth.mockResolvedValue({ id: ownerId, role: 'teacher' })
      expect((await handler(request(method))).status).toBe(200)
      expect(requireRole).toHaveBeenCalledWith('teacher')
      expect(method === 'GET' ? assertTeacherOwnsClassroom : assertTeacherCanMutateClassroom)
        .toHaveBeenCalledWith('teacher-1', classroomId, { supabase })
    })
  })

  it('retains archived owner reads without allowing archived mutations', async () => {
    admit('student')
    assertTeacherOwnsClassroom.mockResolvedValue({ ok: true,
      classroom: { id: classroomId, teacher_id: ownerId, archived_at: '2026-05-06T12:00:00Z' } })
    expect((await GET(request('GET'))).status).toBe(200)
    expect(assertTeacherCanMutateClassroom).not.toHaveBeenCalled()
  })

  it.each([
    { method: 'PUT' as const, handler: PUT, store: saveManualAttendanceSettings, code: 'stale_revision' as const },
    { method: 'POST' as const, handler: POST, store: saveManualAttendanceMarks, code: 'roster_changed' as const },
    { method: 'POST' as const, handler: POST, store: saveManualAttendanceMarks, code: 'class_day_changed' as const },
  ])('preserves $code conflict handling for admitted owners', async ({ method, handler, store, code }) => {
    admit('student')
    store.mockRejectedValue(new ManualAttendanceStoreError(code))
    expect((await handler(request(method))).status).toBe(409)
  })

  it.each(operations.filter(operation => operation.method !== 'GET'))(
    '$method denies archived classroom mutations for admitted owners', async ({ method, handler, store }) => {
      admit('student')
      assertTeacherCanMutateClassroom.mockResolvedValue({ ok: false, status: 403, error: 'Classroom is archived' })
      const response = await handler(request(method))
      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({ error: 'Classroom is archived' })
      expect(store).not.toHaveBeenCalled()
    },
  )

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
