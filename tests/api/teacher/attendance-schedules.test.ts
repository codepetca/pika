import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST, PUT } from '@/app/api/teacher/attendance/schedules/route'

const { requireRole, ownership, access, loadPolicy, supabase } = vi.hoisted(() => ({
  requireRole: vi.fn(), ownership: vi.fn(), access: vi.fn(), loadPolicy: vi.fn(),
  supabase: { from: vi.fn(), rpc: vi.fn() },
}))
vi.mock('@/lib/auth', () => ({ requireRole }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => supabase }))
vi.mock('@/lib/server/classrooms', () => ({ assertTeacherOwnsClassroom: ownership, assertTeacherCanMutateClassroom: ownership }))
vi.mock('@/lib/server/bara-attendance-scope', () => ({ assertBaraAttendanceClassroomAccess: access }))
vi.mock('@/lib/server/bara-attendance-policy', () => ({ loadTeacherAttendancePolicy: loadPolicy }))

const classroom = '20000000-0000-4000-8000-000000000002'
const schedule = '30000000-0000-4000-8000-000000000003'
const policy = { classroomId: classroom, timezone: 'America/Toronto', sessionStartsLocal: '09:00', sessionEndsLocal: '10:00',
  sessionEndDayOffset: 0, entryOpensMinutesBefore: 10, presentGraceMinutes: 5,
  entryClosesMinutesBeforeEnd: 0, absentMinutesBeforeEnd: 0, enabled: true, revision: 3,
  updatedAt: '2026-08-16T20:00:00.000Z' }
const named = { session_starts_local: '08:30', session_ends_local: '09:15', session_end_day_offset: 0,
  entry_opens_minutes_before: 10, present_grace_minutes: 5, entry_closes_minutes_before_end: 0, absent_minutes_before_end: 0 }
const request = (method: string, body: unknown) => new NextRequest('http://localhost/api/teacher/attendance/schedules', { method, body: JSON.stringify(body) })

describe('teacher attendance schedules', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireRole.mockResolvedValue({ id: 'teacher', role: 'teacher' })
    ownership.mockResolvedValue({ ok: true, classroom: { archived_at: null } })
    loadPolicy.mockResolvedValue(policy)
    access.mockResolvedValue({ state: 'ready' })
    supabase.rpc.mockResolvedValue({ data: { id: schedule, revision: 4 }, error: null })
  })
  it('loads the default and selected named schedule only after classroom authorization', async () => {
    supabase.from.mockImplementation((table: string) => ({ select: () => ({ eq: () => table === 'attendance_named_schedules'
      ? { order: async () => ({ data: [{ id: schedule, name: 'Short day', policy: named }], error: null }) }
      : { eq: () => ({ maybeSingle: async () => ({ data: { schedule_id: schedule }, error: null }) }) },
    }) }))
    const response = await GET(new NextRequest(`http://localhost/api/teacher/attendance/schedules?classroom_id=${classroom}&date=2026-11-03`))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ selectedId: schedule, schedules: [
      { id: null, name: 'Regular schedule', policy: { sessionStartsLocal: '09:00' } },
      { id: schedule, name: 'Short day', policy: { sessionStartsLocal: '08:30' } },
    ] })
    expect(ownership).toHaveBeenCalled()
  })
  it('passes a validated selection and expected revision to the atomic database command', async () => {
    const response = await PUT(request('PUT', { classroom_id: classroom, date: '2026-11-03', schedule_id: schedule, expected_revision: 3 }))
    expect(response.status).toBe(200)
    expect(supabase.rpc).toHaveBeenCalledWith('mutate_attendance_schedule_v1', expect.objectContaining({
      p_teacher_id: 'teacher', p_classroom_id: classroom, p_command: 'assign', p_date: '2026-11-03', p_schedule_id: schedule, p_expected_revision: 3,
    }))
  })
  it('rejects invalid timing before making a database mutation', async () => {
    const response = await POST(request('POST', { classroom_id: classroom, name: 'Short day', expected_revision: 3,
      policy: { ...policy, sessionStartsLocal: '10:00', sessionEndsLocal: '09:00' } }))
    expect(response.status).toBe(400)
    expect(supabase.rpc).not.toHaveBeenCalled()
  })
  it('does not disclose schedules to an unauthorized teacher', async () => {
    ownership.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })
    const response = await GET(new NextRequest(`http://localhost/api/teacher/attendance/schedules?classroom_id=${classroom}&date=2026-11-03`))
    expect(response.status).toBe(403)
    expect(supabase.from).not.toHaveBeenCalled()
  })
})
