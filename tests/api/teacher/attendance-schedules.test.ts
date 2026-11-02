import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST, PUT } from '@/app/api/teacher/attendance/schedules/route'

const { requireRole, sharedActor, ownership, access, loadPolicy, supabase } = vi.hoisted(() => ({
  requireRole: vi.fn(), sharedActor: vi.fn(), ownership: vi.fn(), access: vi.fn(), loadPolicy: vi.fn(),
  supabase: { from: vi.fn(), rpc: vi.fn() },
}))
vi.mock('@/lib/auth', () => ({ requireRole }))
vi.mock('@/lib/server/contextual-attendance-policy', () => ({ authorizeSharedAttendancePolicyActor: sharedActor }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => supabase }))
vi.mock('@/lib/server/classrooms', () => ({ assertTeacherOwnsClassroom: ownership, assertTeacherCanMutateClassroom: ownership }))
vi.mock('@/lib/server/bara-attendance-scope', () => ({ assertBaraAttendanceClassroomAccess: access, getBaraAttendanceScopeMode: () => 'teacher_entitlements' }))
vi.mock('@/lib/server/bara-attendance-client', () => ({ getBaraAttendanceIntegrationState: () => 'ready' }))
vi.mock('@/lib/server/bara-attendance-policy', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/server/bara-attendance-policy')>()), loadTeacherAttendancePolicy: loadPolicy }))

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
    sharedActor.mockResolvedValue({ mode: 'existing' })
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
  it('reads schedules for an admitted owner in one authorized database snapshot', async () => {
    const actorId = '40000000-0000-4000-8000-000000000004'
    sharedActor.mockResolvedValue({ mode: 'shared', user: { id: actorId, role: 'student' } })
    supabase.rpc.mockReturnValue({ abortSignal: async () => ({ error: null, data: {
      actor_id: actorId, classroom_id: classroom, scope_mode: 'teacher_entitlements', date: '2026-11-03', status: 'ready',
      policy: { classroom_id: classroom, timezone: 'America/Toronto', opens_local: '09:00:00', closes_local: '10:00:00', close_day_offset: 0,
        entry_opens_minutes_before: 10, present_grace_minutes: 5, entry_closes_minutes_before_end: 0, absent_minutes_before_end: 0,
        enabled: true, policy_revision: 3, updated_at: policy.updatedAt },
      schedules: [{ id: schedule, name: 'Short day', policy: named }], selected_id: schedule,
    } }) })
    const result = await GET(new NextRequest(`http://localhost/api/teacher/attendance/schedules?classroom_id=${classroom}&date=2026-11-03`))
    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({ selectedId: schedule, schedules: [{ id: null }, { id: schedule }] })
    expect(supabase.from).not.toHaveBeenCalled()
    expect(requireRole).not.toHaveBeenCalled()
  })
  it('does not disclose schedules when the contextual snapshot denies access', async () => {
    const actorId = '40000000-0000-4000-8000-000000000004'
    sharedActor.mockResolvedValue({ mode: 'shared', user: { id: actorId, role: 'student' } })
    supabase.rpc.mockReturnValue({ abortSignal: async () => ({ error: null, data: {
      actor_id: actorId, classroom_id: classroom, scope_mode: 'teacher_entitlements', date: '2026-11-03',
      status: 'forbidden', policy: null, schedules: [], selected_id: null,
    } }) })
    const result = await GET(new NextRequest(`http://localhost/api/teacher/attendance/schedules?classroom_id=${classroom}&date=2026-11-03`))
    expect(result.status).toBe(403)
    expect(supabase.from).not.toHaveBeenCalled()
  })
  it('allows an admitted classroom owner with a student account label to select a schedule', async () => {
    sharedActor.mockResolvedValue({ mode: 'shared', user: { id: 'teacher', role: 'student' } })
    const response = await PUT(request('PUT', { classroom_id: classroom, date: '2026-11-03', schedule_id: schedule, expected_revision: 3 }))
    expect(response.status).toBe(200)
    expect(requireRole).not.toHaveBeenCalled()
    expect(ownership).toHaveBeenCalledWith('teacher', classroom, { supabase })
    expect(supabase.rpc).toHaveBeenCalledWith('mutate_attendance_schedule_v1', expect.objectContaining({ p_teacher_id: 'teacher' }))
  })
  it('does not disclose schedules to an unauthorized teacher', async () => {
    ownership.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' })
    const response = await GET(new NextRequest(`http://localhost/api/teacher/attendance/schedules?classroom_id=${classroom}&date=2026-11-03`))
    expect(response.status).toBe(403)
    expect(supabase.from).not.toHaveBeenCalled()
  })
})
