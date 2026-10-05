import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { AuthenticationError, AuthorizationError, requireAuth, requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherCanMutateClassroom } from '@/lib/server/classrooms'
import { POST as ADD } from '@/app/api/teacher/classrooms/[id]/roster/add/route'
import { POST as CSV } from '@/app/api/teacher/classrooms/[id]/roster/upload-csv/route'
import { PATCH, DELETE } from '@/app/api/teacher/classrooms/[id]/roster/[rosterId]/route'
import type { AuthenticatedUser } from '@/types'

vi.mock('@/lib/auth', async original => ({ ...await original<typeof import('@/lib/auth')>(), requireAuth: vi.fn(), requireRole: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
vi.mock('@/lib/server/classrooms', () => ({ assertTeacherCanMutateClassroom: vi.fn() }))
const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const rosterId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const timestamp = '2026-10-03T12:00:00.123456+00:00'
const row = { id: rosterId, classroom_id: classroomId, email: 'one@example.com', first_name: 'One', last_name: 'Learner',
  student_number: null, counselor_email: null, join_source: 'manual', created_at: timestamp, updated_at: timestamp,
  removed_at: null, removed_enrolled_at: null, removed_enrollment_id: null, removed_student_id: null,
  retained_attendance_participant_active: null, retained_manual_attendance_marks: null }
const student = { email: ' ONE@EXAMPLE.COM ', firstName: 'One', lastName: 'Learner' }
const user = (role: 'student' | 'teacher') => ({ id: actorId, role, email: 'actor@example.test' } as AuthenticatedUser)
const context = (withRoster = false) => ({ params: Promise.resolve({ id: classroomId, ...(withRoster ? { rosterId } : {}) }) })
const rpc = vi.fn(), from = vi.fn()
const operations = [
  { handler: ADD, method: 'POST', body: { students: [student] }, mode: 'manual' },
  { handler: CSV, method: 'POST', body: { csvData: 'First Name,Last Name,Email\nOne,Learner, ONE@EXAMPLE.COM ' }, mode: 'csv-preview' },
  { handler: CSV, method: 'POST', body: { csvData: 'First Name,Last Name,Email\nOne,Learner, ONE@EXAMPLE.COM ', confirmed: true }, mode: 'csv-confirmed' },
  { handler: PATCH, method: 'PATCH', body: { counselor_email: null, expected_updated_at: timestamp }, mode: 'patch' },
] as const
const request = (method: string, body?: unknown) => new NextRequest('http://localhost/api/teacher/roster', { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })

describe('shared roster owner write routes', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    vi.mocked(getServiceRoleClient).mockReturnValue({ rpc, from } as unknown as ReturnType<typeof getServiceRoleClient>)
    rpc.mockImplementation(async (name, input) => ({ data: name.startsWith('update_')
      ? { actor_id: actorId, classroom_id: classroomId, roster: row, binding: null }
      : { actor_id: actorId, classroom_id: classroomId, mode: input.p_mode, needs_confirmation: false,
        rows: [{ roster: { ...row, join_source: input.p_mode === 'manual' ? 'manual' : 'csv' }, binding: null }] }, error: null }))
  })
  afterEach(() => vi.unstubAllEnvs())
  it.each(operations.flatMap(operation => ['teacher', 'student'].map(role => ({ ...operation, role: role as 'teacher' | 'student' }))))('uses server actor for $role/$mode and only one transaction', async ({ handler, method, body, mode, role }) => {
    vi.mocked(requireAuth).mockResolvedValue(user(role))
    const response = await handler(request(method, body), context(method === 'PATCH'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(mode === 'patch' ? { success: true, roster: { id: rosterId, counselor_email: null, updated_at: timestamp } }
      : mode === 'manual' ? { success: true, upsertedCount: 1 } : { success: true, upsertedCount: 1, totalProcessed: 1 })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith(mode === 'patch' ? 'update_classroom_roster_counselor_for_owner_v1' : 'upsert_classroom_roster_for_owner_v1', expect.objectContaining({ p_actor_id: actorId, p_classroom_id: classroomId }))
    expect(requireRole).not.toHaveBeenCalled()
    expect(assertTeacherCanMutateClassroom).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
  })
  it.each(operations)('authenticates before malformed admission/params/body for $mode', async ({ handler, method }) => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{')
    vi.mocked(requireAuth).mockRejectedValue(new AuthenticationError())
    const then = vi.fn()
    const req = request(method)
    const json = vi.spyOn(req, 'json')
    expect((await handler(req, { params: { then } as unknown as ReturnType<typeof context>['params'] })).status).toBe(401)
    expect(then).not.toHaveBeenCalled()
    expect(json).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
  it.each(operations)('rejects malformed admission before $mode body', async ({ handler, method }) => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', '{')
    vi.mocked(requireAuth).mockResolvedValue(user('student'))
    const req = request(method)
    const json = vi.spyOn(req, 'json')
    expect((await handler(req, context(method === 'PATCH'))).status).toBe(503)
    expect(json).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
  it.each(operations)('rejects bad $mode params before body/database', async ({ handler, method, body }) => {
    vi.mocked(requireAuth).mockResolvedValue(user('student'))
    expect((await handler(request(method, body), { params: Promise.resolve({ id: 'bad', rosterId }) })).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })
  it.each(operations.flatMap(operation => ['42501', 'P0002', 'PT404', 'PT409', 'PT503', '55000', 'PGRST202'].map(code => ({ ...operation, code }))))('fails closed for $mode $code', async ({ handler, method, body, code }) => {
    vi.mocked(requireAuth).mockResolvedValue(user('student'))
    rpc.mockResolvedValue({ data: null, error: { code, message: 'private' } })
    const response = await handler(request(method, body), context(method === 'PATCH'))
    expect(response.status).toBe(({ '42501': 403, P0002: 404, PT404: 404, PT409: 409, '55000': 409 } as Record<string, number>)[code] ?? 503)
    expect(await response.text()).not.toContain('private')
    expect(from).not.toHaveBeenCalled()
    expect(requireRole).not.toHaveBeenCalled()
  })
  it('preserves partial manual missing-field errors', async () => {
    vi.mocked(requireAuth).mockResolvedValue(user('student'))
    const response = await ADD(request('POST', { students: [student, { email: 'missing@example.com' }] }), context())
    expect(await response.json()).toEqual({ success: true, upsertedCount: 1, errors: [{ email: 'missing@example.com', error: 'Missing required fields' }] })
    expect(rpc).toHaveBeenCalledWith('upsert_classroom_roster_for_owner_v1', expect.objectContaining({ p_students: [{ email: 'one@example.com', firstName: 'One', lastName: 'Learner', studentNumber: null, counselorEmail: null }] }))
  })
  it.each([{ students: [student], actorId }, { students: [student, student] }, { students: [{ ...student, firstName: 7 }] }])('rejects strict manual input %j', async body => {
    vi.mocked(requireAuth).mockResolvedValue(user('student'))
    expect((await ADD(request('POST', body), context())).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })
  it.each([{ csvData: 7 }, { csvData: 'x', confirmed: 'true' }, { csvData: 'x', role: 'teacher' }])('rejects strict CSV input %j', async body => {
    vi.mocked(requireAuth).mockResolvedValue(user('student'))
    expect((await CSV(request('POST', body), context())).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })
  it.each([{}, { expected_updated_at: timestamp }, { counselor_email: null, expected_updated_at: 'infinity' }, { counselor_email: null, expected_updated_at: timestamp, role: 'teacher' }])('rejects strict PATCH input %j', async body => {
    vi.mocked(requireAuth).mockResolvedValue(user('student'))
    expect((await PATCH(request('PATCH', body), context(true))).status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })
  it.each(operations.flatMap(operation => [undefined, JSON.stringify({ version: 1, admittedUserIds: [] })].map(config => ({ ...operation, config }))))('retains absent/unmatched $mode teacher guard', async ({ handler, method, body, config }) => {
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', config)
    vi.mocked(requireAuth).mockResolvedValue(user('student'))
    vi.mocked(requireRole).mockRejectedValue(new AuthorizationError())
    expect((await handler(request(method, body), context(method === 'PATCH'))).status).toBe(403)
    expect(requireRole).toHaveBeenCalledWith('teacher')
    expect(rpc).not.toHaveBeenCalled()
    if (config === undefined) expect(requireAuth).not.toHaveBeenCalled()
  })
  it('leaves DELETE on its original teacher guard even for an admitted student', async () => {
    vi.mocked(requireRole).mockRejectedValue(new AuthorizationError())
    expect((await DELETE(request('DELETE'), context(true))).status).toBe(403)
    expect(requireAuth).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })
})
