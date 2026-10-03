import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getServiceRoleClient } from '@/lib/supabase'
import { upsertContextualRoster, patchContextualRosterCounselor } from '@/lib/server/contextual-roster-mutation'
import { rosterManualBodySchema, rosterCsvBodySchema, rosterCounselorBodySchema } from '@/lib/validations/roster-mutations'
import { decodeRosterCsv } from '@/lib/roster-csv'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const rosterId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const timestamp = '2026-10-03T12:00:00.123456+00:00'
const student = { email: 'one@example.com', firstName: 'One', lastName: 'Learner', studentNumber: null, counselorEmail: null }
const row = () => ({ id: rosterId, classroom_id: classroomId, email: student.email, first_name: 'One', last_name: 'Learner',
  student_number: null, counselor_email: null, join_source: 'manual', created_at: timestamp, updated_at: timestamp,
  removed_at: null, removed_enrolled_at: null, removed_enrollment_id: null, removed_student_id: null,
  retained_attendance_participant_active: null, retained_manual_attendance_marks: null })
const success = (roster = row(), extra = {}) => ({ data: { actor_id: actorId, classroom_id: classroomId,
  mode: 'manual', needs_confirmation: false, rows: [{ roster, binding: null }], ...extra }, error: null })
const rpc = vi.fn()
const upsert = () => upsertContextualRoster({ actorId, classroomId, students: [student], mode: 'manual' })

describe('shared owner roster write boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(getServiceRoleClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof getServiceRoleClient>)
    rpc.mockResolvedValue(success())
  })
  it('binds only server actor and bounded canonical rows', async () => {
    expect(await upsert()).toEqual({ success: true, upsertedCount: 1 })
    expect(rpc).toHaveBeenCalledWith('upsert_classroom_roster_for_owner_v1', {
      p_actor_id: actorId, p_classroom_id: classroomId, p_students: [student], p_mode: 'manual',
    })
  })
  it.each(['42501', 'P0002', 'PT404', '22023', 'PT409', '40001', '40P01', '55P03', '55000', 'PT503', 'PGRST202', 'XX000'])('maps %s without retry', async code => {
    rpc.mockResolvedValue({ data: null, error: { code, message: 'private' } })
    const statusCode = ({ '42501': 403, P0002: 404, PT404: 404, '22023': 400, PT409: 409, '40001': 409, '40P01': 409, '55P03': 409, '55000': 409 } as Record<string, number>)[code] ?? 503
    await expect(upsert()).rejects.toMatchObject({ statusCode })
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it.each([null, {}, { data: null, error: null }, success(row(), { actor_id: rosterId }),
    success(row(), { classroom_id: rosterId }), success(row(), { mode: 'csv-confirmed' }),
    success(row(), { rows: [] }), success(row(), { rows: [{ roster: row(), binding: null }, { roster: row(), binding: null }] }),
    success({ ...row(), email: 'other@example.com' }), success({ ...row(), removed_at: timestamp }),
    success({ ...row(), first_name: 'Substituted' }), success({ ...row(), updated_at: 'infinity' }),
    success(row(), { extra: true }), { ...success(), error: { code: '42501' } },
  ])('rejects substituted or malformed response %#', async response => {
    rpc.mockResolvedValue(response)
    await expect(upsert()).rejects.toMatchObject({ statusCode: 503 })
  })
  it.each(Object.keys(row()))('requires full persisted field %s', async key => {
    const incomplete: Record<string, unknown> = row()
    delete incomplete[key]
    rpc.mockResolvedValue(success(incomplete as ReturnType<typeof row>))
    await expect(upsert()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('rejects a binding outside the exact row/class', async () => {
    rpc.mockResolvedValue(success(row(), { rows: [{ roster: row(), binding: { roster_id: actorId, classroom_id: classroomId, student_id: actorId, created_at: timestamp } }] }))
    await expect(upsert()).rejects.toMatchObject({ statusCode: 503 })
  })
  it('retains stable binding evidence without guessing from current account emails', async () => {
    const binding = { roster_id: rosterId, classroom_id: classroomId, student_id: actorId, created_at: timestamp }
    rpc.mockResolvedValue(success(row(), { rows: [{ roster: row(), binding }] }))
    expect(await upsert()).toEqual({ success: true, upsertedCount: 1 })
    expect(rpc).toHaveBeenCalledTimes(1)
  })
  it('projects patch and preserves microseconds, offset and email case', async () => {
    const body = rosterCounselorBodySchema.parse({ counselor_email: '  Office@Example.com  ', expected_updated_at: '2026-10-03T08:00:00.123456-04:00' })
    const roster = { ...row(), counselor_email: 'Office@Example.com' }
    rpc.mockResolvedValue({ data: { actor_id: actorId, classroom_id: classroomId, roster, binding: null }, error: null })
    expect(await patchContextualRosterCounselor({ actorId, classroomId, rosterId, body })).toEqual({ success: true, roster: { id: rosterId, counselor_email: 'Office@Example.com', updated_at: timestamp } })
    expect(rpc).toHaveBeenCalledWith('update_classroom_roster_counselor_for_owner_v1', {
      p_actor_id: actorId, p_classroom_id: classroomId, p_roster_id: rosterId,
      p_counselor_email: 'Office@Example.com', p_expected_updated_at: '2026-10-03T08:00:00.123456-04:00',
    })
  })
  it('checks preview arithmetic, unique incoming email and changed values', async () => {
    const current = { firstName: 'Old', lastName: 'Learner', studentNumber: null, counselorEmail: null }
    const incoming = { firstName: 'One', lastName: 'Learner', studentNumber: null, counselorEmail: null }
    const data = { actor_id: actorId, classroom_id: classroomId, mode: 'csv-preview', needs_confirmation: true,
      changes: [{ email: student.email, current, incoming }], update_count: 1, new_count: 0, total_count: 1 }
    rpc.mockResolvedValue({ data, error: null })
    expect(await upsertContextualRoster({ actorId, classroomId, students: [student], mode: 'csv-preview' })).toEqual({ needsConfirmation: true, changes: data.changes, updateCount: 1, newCount: 0, totalCount: 1 })
    for (const bad of [{ update_count: 2 }, { new_count: 1 }, { total_count: 2 }, { changes: [{ email: student.email, current: incoming, incoming }] }]) {
      rpc.mockResolvedValue({ data: { ...data, ...bad }, error: null })
      await expect(upsertContextualRoster({ actorId, classroomId, students: [student], mode: 'csv-preview' })).rejects.toMatchObject({ statusCode: 503 })
    }
  })
})

describe('roster input contracts and legacy CSV decoding', () => {
  it('retains partial missing-field errors and normalizes primary/secondary emails', () => {
    const parsed = rosterManualBodySchema.parse({ students: [{ email: ' ONE@EXAMPLE.COM ', firstName: 'One', lastName: 'Learner', counselorEmail: ' OFFICE@EXAMPLE.COM ' }, { email: 'missing@example.com' }] })
    expect(parsed.students[0]).toEqual({ ...student, counselorEmail: 'office@example.com' })
    expect(parsed.errors).toEqual([{ email: 'missing@example.com', error: 'Missing required fields' }])
  })
  it('preserves the original email in partial errors, including null missing fields', () => {
    const parsed = rosterManualBodySchema.parse({ students: [student, { email: ' MISSING@EXAMPLE.COM ', firstName: null }, { email: null }] })
    expect(parsed.errors).toEqual([{ email: ' MISSING@EXAMPLE.COM ', error: 'Missing required fields' }, { email: null, error: 'Missing required fields' }])
  })
  it.each([null, 1, true, [], {}, { students: [] }, { students: [{ email: 7, firstName: 'A', lastName: 'B' }] },
    { students: [student, { ...student, email: ' ONE@EXAMPLE.COM ' }] }, { students: [student], actorId },
    { students: [{ ...student, firstName: '🐦'.repeat(501) }] }, { students: [{ ...student, firstName: '\ud800' }] },
    { students: [{ ...student, email: ' ' }] }, { students: Array(1001).fill(student) }])('rejects invalid manual input %#', value => {
    expect(rosterManualBodySchema.safeParse(value).success).toBe(false)
  })
  it('uses Unicode codepoints rather than UTF16 for bounds', () => {
    expect(rosterManualBodySchema.safeParse({ students: [{ ...student, firstName: '🐦'.repeat(500) }] }).success).toBe(true)
  })
  it.each(['infinity', '2026-02-30T00:00:00Z', '2026-10-03', '2026-10-03T25:00:00Z', '2026-10-03T00:00:00+24:00', '0000-01-01T00:00:00Z'])('rejects nonfinite/noncalendar timestamp %s', value => {
    expect(rosterCounselorBodySchema.safeParse({ counselor_email: null, expected_updated_at: value }).success).toBe(false)
  })
  it('requires counselor field and rejects unrelated keys', () => {
    expect(rosterCounselorBodySchema.safeParse({ expected_updated_at: timestamp }).success).toBe(false)
    expect(rosterCounselorBodySchema.safeParse({ counselor_email: null, expected_updated_at: timestamp, actorId }).success).toBe(false)
    expect(rosterCounselorBodySchema.parse({ counselor_email: ' ', expected_updated_at: timestamp }).counselor_email).toBeNull()
  })
  it('preserves optional student number, header punctuation, quotes and incomplete-row skipping', () => {
    expect(decodeRosterCsv('First Name,Last Name,Email,Secondary email\n" One ",Learner, ONE@EXAMPLE.COM , OFFICE@EXAMPLE.COM \nIncomplete,,x')).toEqual([{ ...student, counselorEmail: 'office@example.com' }])
    expect(decodeRosterCsv('Student Number,First Name,Last Name,Email\n12,"O""ne",Learner,one@example.com')).toEqual([{ ...student, firstName: 'O"ne', studentNumber: '12' }])
  })
  it('bounds raw UTF8 CSV and strict confirmation flag', () => {
    expect(rosterCsvBodySchema.safeParse({ csvData: '🐦'.repeat(262145) }).success).toBe(false)
    expect(rosterCsvBodySchema.safeParse({ csvData: 'x', confirmed: 'true' }).success).toBe(false)
    expect(() => decodeRosterCsv('First,Last,Email\nOne,Learner,one@example.com\nTwo,Learner,ONE@example.com')).toThrow()
  })
})
