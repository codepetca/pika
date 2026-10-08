import { describe, expect, it } from 'vitest'
import { readContextualClassroomDetail } from '@/lib/server/contextual-classroom-detail'
import {
  contextualClassroomDetailClassroomEnvelopeSchema,
  contextualClassroomDetailOwnerEnvelopeSchema,
  contextualClassroomDetailRowSchema,
  contextualClassroomDetailMemberEnvelopeSchema,
} from '@/lib/validations/contextual-classroom-detail'
import { hydrateClassroomRecord } from '@/lib/server/classrooms'
import { actorId, classroomId, otherId, timestamp, classroom, membership, preflight, detailFixture } from '../../helpers/contextual-classroom-detail'

function fixture(payload: unknown, permission: 'owner' | 'member' = 'owner', first: unknown = preflight()) {
  const f = detailFixture([first, payload])
  return { ...f, run: () => readContextualClassroomDetail({ supabase: f.supabase, actorId, classroomId, permission }) }
}
const joined = { ...classroom, teacher_id: otherId, membership: [membership] }

describe('current-relationship-bound classroom details', () => {
  it('explicitly selects every persisted field and preserves the hydrated owner response', async () => {
    const f = fixture(classroom)
    expect(await f.run()).toEqual(hydrateClassroomRecord(classroom))
    const url = f.urls[1]
    expect(url.pathname).toBe('/rest/v1/classrooms')
    expect(url.searchParams.get('id')).toBe(`eq.${classroomId}`)
    expect(url.searchParams.get('teacher_id')).toBe(`eq.${actorId}`)
    expect(url.searchParams.has('archived_at')).toBe(false)
    expect(url.searchParams.get('select')?.split(',').sort()).toEqual(Object.keys(classroom).sort())
    expect(url.searchParams.get('select')).not.toContain('*')
    expect(f.urls[0].searchParams.get('select')).toBe('id,teacher_id,archived_at')
  })

  it('binds current membership with the real FK, blanks raw drafts, strips guidance and evidence', async () => {
    const f = fixture(joined, 'member', preflight({ ...classroom, teacher_id: otherId }))
    const result = await f.run()
    const { authoring_guidance_version_id: _guidance, ...expected } = hydrateClassroomRecord({ ...classroom, teacher_id: otherId, course_overview_markdown: '', course_outline_markdown: '' })
    expect(result).toEqual(expected)
    expect(result).not.toHaveProperty('membership')
    const url = f.urls[1]
    expect(url.searchParams.get('select')).toContain('membership:classroom_enrollments!classroom_enrollments_classroom_id_fkey!inner(classroom_id,student_id)')
    expect(url.searchParams.get('id')).toBe(`eq.${classroomId}`)
    expect(url.searchParams.get('teacher_id')).toBe(`neq.${actorId}`)
    expect(url.searchParams.get('archived_at')).toBe('is.null')
    expect(url.searchParams.get('membership.classroom_id')).toBe(`eq.${classroomId}`)
    expect(url.searchParams.get('membership.student_id')).toBe(`eq.${actorId}`)
  })

  it('allows archive changes for owners and denies owner self-enrollment and archived members', async () => {
    await expect(fixture({ ...classroom, archived_at: timestamp }).run()).resolves.toMatchObject({ archived_at: timestamp })
    const owner = fixture(joined, 'member')
    await expect(owner.run()).rejects.toMatchObject({ statusCode: 403 })
    expect(owner.urls).toHaveLength(1)
    const archived = fixture(joined, 'member', { ...preflight(), teacher_id: otherId, archived_at: timestamp })
    await expect(archived.run()).rejects.toMatchObject({ statusCode: 403 })
    expect(archived.urls).toHaveLength(1)
  })

  it.each(['owner', 'member'] as const)('denies deletion or relationship loss at the %s payload read', async permission => {
    const f = fixture(null, permission, { ...preflight(), teacher_id: permission === 'owner' ? actorId : otherId })
    await expect(f.run()).rejects.toMatchObject({ statusCode: 403 })
    expect(f.urls).toHaveLength(2)
  })

  it.each([
    { row: null, statusCode: 404 }, { row: { ...preflight(), teacher_id: otherId }, statusCode: 403 },
    { row: { ...preflight(), id: otherId }, statusCode: 503 }, { row: { ...preflight(), archived_at: 'bad' }, statusCode: 503 },
    { row: { ...preflight(), extra: true }, statusCode: 503 },
  ])('classifies missing, forbidden and invalid preflight %#', async ({ row, statusCode }) => {
    const f = fixture(classroom, 'owner', row)
    await expect(f.run()).rejects.toMatchObject({ statusCode })
    expect(f.urls).toHaveLength(1)
  })

  it.each([
    { id: otherId }, { teacher_id: otherId }, { id: classroomId.toUpperCase() }, { archived_at: 'bad' },
    { authoring_guidance_version_id: 'bad' }, { source_blueprint_version_id: 4 }, { created_at: 'infinity' },
    { allow_enrollment: 'true' }, { position: 1.5 }, { blueprint_source_revision: null },
    { manual_attendance_revision: '4' }, { manual_attendance_source_mode: null },
    { manual_attendance_session_starts_local: 9 }, { manual_attendance_session_ends_local: undefined },
    { actual_site_config: undefined }, { feature_visibility: undefined }, { course_outline_markdown: null },
    { title: undefined }, { start_date: 'invalid' }, { secret: 'unexpected' },
  ])('fails closed on missing, malformed or substituted persisted fields %#', async patch => {
    await expect(fixture({ ...classroom, ...patch }).run()).rejects.toMatchObject({ statusCode: 503 })
  })

  it.each([
    { teacher_id: actorId }, { archived_at: timestamp }, { membership: [] }, { membership: [membership, membership] },
    { membership: membership }, { membership: null }, { membership: [{ ...membership, student_id: otherId }] },
    { membership: [{ ...membership, classroom_id: otherId }] }, { membership: [{ ...membership, extra: true }] },
    { membership: [{ ...membership, classroom_id: classroomId.toUpperCase() }] },
  ])('fails closed on substituted member root or enrollment evidence %#', async patch => {
    await expect(fixture({ ...joined, ...patch }, 'member', { ...preflight(), teacher_id: otherId }).run()).rejects.toMatchObject({ statusCode: 503 })
  })

  it('requires a single classroom even from malformed SDK cardinality', async () => {
    const multiple = new Response(JSON.stringify([classroom, classroom]), { status: 200 })
    await expect(fixture(multiple).run()).rejects.toMatchObject({ statusCode: 503 })
  })

  it.each(['42P01', 'PGRST205', '42703', 'PGRST204'])('fails closed on missing schema %s', async code => {
    await expect(fixture(new Response(JSON.stringify({ code, message: 'missing schema' }), { status: 400 })).run()).rejects.toMatchObject({ statusCode: 503 })
  })

  it('maps transport errors to unavailable and normalizes valid request UUIDs', async () => {
    await expect(fixture(new Error('transport')).run()).rejects.toMatchObject({ statusCode: 503 })
    const f = detailFixture([preflight(), classroom])
    await expect(readContextualClassroomDetail({ supabase: f.supabase, actorId, classroomId: classroomId.toUpperCase(), permission: 'owner' })).resolves.toHaveProperty('id', classroomId)
    await expect(readContextualClassroomDetail({ supabase: f.supabase, actorId: 'bad', classroomId, permission: 'owner' })).rejects.toMatchObject({ statusCode: 400 })
  })

  it('preserves historical JSON hydration defaults and all manual attendance compatibility fields', async () => {
    const row = { ...classroom, actual_site_config: null, feature_visibility: null, source_blueprint_origin: null }
    expect(await fixture(row).run()).toEqual(hydrateClassroomRecord(row))
    expect(await fixture({ ...classroom, manual_attendance_session_starts_local: null, manual_attendance_session_ends_local: null }).run()).toMatchObject({
      manual_attendance_revision: 4, manual_attendance_source_mode: 'manual',
      manual_attendance_session_starts_local: null, manual_attendance_session_ends_local: null,
    })
  })

  it.each(Object.keys(classroom))('requires persisted field %s', field => {
    const incomplete = Object.fromEntries(Object.entries(classroom).filter(([key]) => key !== field))
    expect(contextualClassroomDetailRowSchema.safeParse(incomplete).success).toBe(false)
  })

  it('accepts real SDK metadata and rejects contradictory single-row counts', () => {
    const metadata = { error: null, count: null, status: 200, statusText: 'OK' }
    expect(contextualClassroomDetailOwnerEnvelopeSchema.safeParse({ data: classroom, ...metadata }).success).toBe(true)
    expect(contextualClassroomDetailMemberEnvelopeSchema.safeParse({ data: joined, ...metadata }).success).toBe(true)
    expect(contextualClassroomDetailClassroomEnvelopeSchema.safeParse({ data: null, ...metadata, count: 0 }).success).toBe(true)
    for (const count of [0, 2]) {
      expect(contextualClassroomDetailOwnerEnvelopeSchema.safeParse({ data: classroom, ...metadata, count }).success).toBe(false)
    }
    expect(contextualClassroomDetailClassroomEnvelopeSchema.safeParse({ data: null, ...metadata, count: 1 }).success).toBe(false)
  })

  it.each([
    undefined, null, [], {}, { data: preflight() }, { error: null }, { data: undefined, error: null },
    { data: preflight(), error: false }, { data: preflight(), error: null, status: 500 },
    { data: preflight(), error: null, extra: true }, { data: preflight(), error: null, count: -1 },
    Object.create({ data: preflight(), error: null }), Object.assign(Object.create({ error: null }), { data: preflight() }),
  ])('validates complete own-field SDK envelopes %#', value => {
    expect(contextualClassroomDetailClassroomEnvelopeSchema.safeParse(value).success).toBe(false)
    expect(contextualClassroomDetailOwnerEnvelopeSchema.safeParse(value).success).toBe(false)
  })
})
