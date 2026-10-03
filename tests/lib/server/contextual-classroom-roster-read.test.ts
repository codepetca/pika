import { createClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { readContextualClassroomRoster } from '@/lib/server/contextual-classroom-roster-read'
import type { Database } from '@/types/database'
import { contextualClassroomRosterClassroomEnvelopeSchema, contextualClassroomRosterPageEnvelopeSchema } from '@/lib/validations/contextual-classroom-roster-read'

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const timestamp = '2026-10-03T12:00:00.123456+00:00'
const classroom = { id: classroomId, teacher_id: actorId, archived_at: null }
const rosterRow = (n = 1) => ({
  id: id(n), classroom_id: classroomId, email: `person${n}@example.test`,
  student_number: null, first_name: null, last_name: null, counselor_email: null,
  join_source: 'manual', created_at: timestamp, updated_at: timestamp, removed_at: null,
  binding: null as null | { classroom_id: string; roster_id: string; student_id: string },
})
const enrollment = (n = 1) => ({
  id: id(n + 2000), classroom_id: classroomId, student_id: id(n + 4000), created_at: timestamp,
  student: { id: id(n + 4000), email: `person${n}@example.test` },
})
const root = (alias: 'roster' | 'enrollments', rows: unknown[]) => ({ ...classroom, [alias]: rows })
function fixture(pages: unknown[], preflight: unknown = classroom) {
  const urls: URL[] = []
  const responses = [preflight, ...pages]
  const fetch = vi.fn(async (url: RequestInfo | URL) => {
    urls.push(new URL(String(url)))
    const response = responses.shift()
    if (response instanceof Error) throw response
    if (response instanceof Response) return response
    return new Response(JSON.stringify(response === null ? [] : [response]), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
  const supabase = createClient<Database>('http://localhost:54321', 'unit-test-key', {
    global: { fetch }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const availability = vi.fn(async (_actorId: string, _classroomId: string, _studentIds: string[]) => [] as string[])
  return { urls, fetch, availability, run: () => readContextualClassroomRoster({ supabase, actorId, classroomId, resolvePurgeAvailability: availability }) }
}
function complete(rows: unknown[], enrollments: unknown[] = []) {
  return [root('roster', rows), root('roster', []), ...(enrollments.length ? [root('enrollments', enrollments)] : []), root('enrollments', [])]
}

describe('shared classroom roster management read', () => {
  it('preserves the complete projection, nullable metadata and display email; only stable joined IDs reach availability', async () => {
    const bound = { ...rosterRow(), email: ' Edited@Example.test ', first_name: 'Ada', join_source: 'csv', binding: { classroom_id: classroomId, roster_id: id(1), student_id: id(4001) } }
    const unbound = { ...rosterRow(2), email: ' PERSON2@EXAMPLE.TEST ', join_source: 'historical' }
    const noEnrollment = { ...rosterRow(3), binding: { classroom_id: classroomId, roster_id: id(3), student_id: id(4003) } }
    const f = fixture(complete([bound, unbound, noEnrollment], [enrollment(), enrollment(2)]))
    f.availability.mockResolvedValue([id(4001)])
    const result = await f.run()
    expect(result).toEqual({ roster: [
      { id: id(1), email: bound.email, student_number: null, first_name: 'Ada', last_name: null, counselor_email: null, join_source: 'csv', created_at: timestamp, updated_at: timestamp, joined: true, student_id: id(4001), joined_at: timestamp },
      { id: id(2), email: unbound.email, student_number: null, first_name: null, last_name: null, counselor_email: null, join_source: 'manual', created_at: timestamp, updated_at: timestamp, joined: true, student_id: null, joined_at: timestamp },
      { id: id(3), email: noEnrollment.email, student_number: null, first_name: null, last_name: null, counselor_email: null, join_source: 'manual', created_at: timestamp, updated_at: timestamp, joined: false, student_id: null, joined_at: null },
    ], student_purge_enabled_ids: [id(4001)] })
    expect(f.availability).toHaveBeenCalledWith(actorId, classroomId, [id(4001)])
    for (const url of f.urls.slice(1)) {
      expect(url.pathname).toBe('/rest/v1/classrooms')
      expect(url.searchParams.get('id')).toBe(`eq.${classroomId}`)
      expect(url.searchParams.get('teacher_id')).toBe(`eq.${actorId}`)
      expect(url.searchParams.get('select')).not.toMatch(/role|profile|retained|attendance/)
    }
    expect(f.urls[1].searchParams.get('select')).toContain('binding:classroom_roster_student_bindings!classroom_roster_student_bindings_roster_id_fkey(classroom_id,roster_id,student_id)')
    expect(f.urls[1].searchParams.get('roster.removed_at')).toBe('is.null')
    expect(f.urls[1].searchParams.get('roster.order')).toBe('id.asc')
    expect(f.urls[1].searchParams.get('roster.limit')).toBe('1000')
    expect(f.urls[2].searchParams.get('roster.id')).toBe(`gt.${id(3)}`)
    expect(f.urls[3].searchParams.get('select')).toContain('student:users!classroom_enrollments_student_id_fkey(id,email)')
    expect(f.urls[3].searchParams.get('enrollments.order')).toBe('id.asc')
    expect(f.urls[3].searchParams.get('enrollments.limit')).toBe('1000')
  })

  it('retains bound identity when both roster and account emails change, and prevents bound email fallback', async () => {
    const row = { ...rosterRow(), binding: { classroom_id: classroomId, roster_id: id(1), student_id: id(4001) } }
    const joined = { ...enrollment(), student: { id: id(4001), email: 'new@example.test' } }
    await expect(fixture(complete([row], [joined])).run()).resolves.toMatchObject({ roster: [{ joined: true, student_id: id(4001) }] })
    await expect(fixture(complete([{ ...row, binding: { ...row.binding, student_id: otherId } }], [enrollment()])).run()).resolves.toMatchObject({ roster: [{ joined: false, student_id: null }] })
  })

  it('allows archived owners and roots with no children or bindings', async () => {
    const archived = { ...classroom, archived_at: timestamp }
    const f = fixture([{ ...root('roster', []), archived_at: timestamp }, { ...root('enrollments', []), archived_at: timestamp }], archived)
    await expect(f.run()).resolves.toEqual({ roster: [], student_purge_enabled_ids: [] })
    expect(f.urls).toHaveLength(3)
    expect(f.urls.every(url => !url.searchParams.has('archived_at'))).toBe(true)
  })

  it('fully keysets more than 1000 roster rows, bindings and enrollments through short and terminal pages', async () => {
    const rows = Array.from({ length: 1002 }, (_, index) => ({ ...rosterRow(index + 1), binding: { classroom_id: classroomId, roster_id: id(index + 1), student_id: id(index + 4001) } }))
    const members = Array.from({ length: 1002 }, (_, index) => enrollment(index + 1))
    const f = fixture([
      root('roster', rows.slice(0, 1000)), root('roster', rows.slice(1000, 1001)), root('roster', rows.slice(1001)), root('roster', []),
      root('enrollments', members.slice(0, 1000)), root('enrollments', members.slice(1000)), root('enrollments', []),
    ])
    expect((await f.run()).roster).toHaveLength(1002)
    expect(f.availability.mock.calls[0]).toEqual([actorId, classroomId, members.map(row => row.student_id)])
    expect(f.urls[2].searchParams.get('roster.id')).toBe(`gt.${id(1000)}`)
    expect(f.urls[6].searchParams.get('enrollments.id')).toBe(`gt.${id(3000)}`)
    expect(f.urls.every(url => !url.searchParams.has('offset') && !url.searchParams.has('roster.offset'))).toBe(true)
  })

  it.each([0, 1, 2, 3])('discards all data on owner loss before payload statement %i, including empty terminal pages', async index => {
    const pages = complete([rosterRow()], [enrollment()])
    pages[index] = null as unknown as ReturnType<typeof root>
    const f = fixture(pages)
    await expect(f.run()).rejects.toMatchObject({ statusCode: 403 })
    expect(f.availability).not.toHaveBeenCalled()
  })

  it.each([
    { value: null, statusCode: 404 },
    { value: { ...classroom, teacher_id: otherId }, statusCode: 403 },
    { value: { ...classroom, id: otherId }, statusCode: 503 },
    { value: { ...classroom, archived_at: 'bad' }, statusCode: 503 },
    { value: { ...classroom, extra: true }, statusCode: 503 },
  ])('uses preflight only for precise missing/nonowner status %#', async ({ value, statusCode }) => {
    const f = fixture([], value)
    await expect(f.run()).rejects.toMatchObject({ statusCode })
    expect(f.urls).toHaveLength(1)
  })

  it.each([
    { id: 'bad' }, { classroom_id: otherId }, { email: null }, { first_name: undefined }, { student_number: 1 },
    { created_at: 'infinity' }, { updated_at: null }, { join_source: undefined }, { removed_at: timestamp },
    { binding: [] }, { binding: {} }, { binding: { classroom_id: otherId, roster_id: id(1), student_id: id(4001) } },
    { binding: { classroom_id: classroomId, roster_id: otherId, student_id: id(4001) } },
    { binding: { classroom_id: classroomId, roster_id: id(1), student_id: 'bad' } }, { unknown: true },
  ])('rejects malformed, removed or substituted roster and binding evidence %#', async patch => {
    await expect(fixture(complete([{ ...rosterRow(), ...patch }])).run()).rejects.toMatchObject({ statusCode: 503 })
  })

  it.each([
    { id: 'bad' }, { classroom_id: otherId }, { student_id: otherId }, { student: null },
    { student: { id: otherId, email: 'a@example.test' } }, { student: { id: id(4001), email: null } },
    { created_at: 'bad' }, { student: { id: id(4001), email: 'a@example.test', role: 'teacher' } },
  ])('rejects malformed enrollment/user identity %#', async patch => {
    await expect(fixture(complete([], [{ ...enrollment(), ...patch }])).run()).rejects.toMatchObject({ statusCode: 503 })
  })

  it.each([
    root('roster', null as unknown as unknown[]), { ...root('roster', []), id: otherId },
    { ...root('roster', []), teacher_id: otherId }, { ...root('roster', []), extra: true },
    root('roster', Array.from({ length: 1001 }, (_, i) => rosterRow(i + 1))),
  ])('rejects malformed or substituted root/cardinality evidence %#', async page => {
    await expect(fixture([page]).run()).rejects.toMatchObject({ statusCode: 503 })
  })

  it('rejects duplicate and out-of-order UUID keys within and across both collection pages', async () => {
    for (const alias of ['roster', 'enrollments'] as const) {
      const row = alias === 'roster' ? rosterRow : enrollment
      for (const rows of [[row(1), row(1)], [row(2), row(1)]]) {
        const prefix = alias === 'enrollments' ? [root('roster', [])] : []
        await expect(fixture([...prefix, root(alias, rows)]).run()).rejects.toMatchObject({ statusCode: 503 })
        await expect(fixture([...prefix, ...rows.map(value => root(alias, [value]))]).run()).rejects.toMatchObject({ statusCode: 503 })
      }
    }
    await expect(fixture(complete([], [enrollment(), { ...enrollment(2), student_id: id(4001), student: enrollment().student }])).run()).rejects.toMatchObject({ statusCode: 503 })
  })

  it('preserves distinct roster rows bound to the same learner and deduplicates eligible availability IDs', async () => {
    const binding = { classroom_id: classroomId, roster_id: id(1), student_id: id(4001) }
    const f = fixture(complete([{ ...rosterRow(), binding }, { ...rosterRow(2), binding: { ...binding, roster_id: id(2) } }], [enrollment()]))
    f.availability.mockResolvedValue([id(4001)])
    await expect(f.run()).resolves.toMatchObject({ roster: [
      { id: id(1), student_id: id(4001), joined: true }, { id: id(2), student_id: id(4001), joined: true },
    ], student_purge_enabled_ids: [id(4001)] })
    expect(f.availability).toHaveBeenCalledWith(actorId, classroomId, [id(4001)])
  })

  it.each([undefined, null, {}, ['bad'], [otherId], [id(4001), id(4001)]])('fails closed for malformed, duplicate or widened availability %#', async value => {
    const row = { ...rosterRow(), binding: { classroom_id: classroomId, roster_id: id(1), student_id: id(4001) } }
    const f = fixture(complete([row], [enrollment()]))
    f.availability.mockResolvedValue(value as string[])
    await expect(f.run()).rejects.toMatchObject({ statusCode: 503 })
  })

  it('rejects a noncanonical availability UUID even when its normalized form is eligible', async () => {
    const row = { ...rosterRow(), binding: { classroom_id: classroomId, roster_id: id(1), student_id: otherId } }
    const member = { ...enrollment(), student_id: otherId, student: { id: otherId, email: 'changed@example.test' } }
    const f = fixture(complete([row], [member]))
    f.availability.mockResolvedValue([otherId.toUpperCase()])
    await expect(f.run()).rejects.toMatchObject({ statusCode: 503 })
  })

  it.each(['42P01', 'PGRST205', '42703', 'PGRST204'])('never falls back on admitted missing schema %s', async code => {
    const f = fixture([new Response(JSON.stringify({ code, message: 'missing schema', details: null, hint: null }), { status: 400 })])
    await expect(f.run()).rejects.toMatchObject({ statusCode: 503 })
    expect(f.urls).toHaveLength(2)
    expect(f.availability).not.toHaveBeenCalled()
  })

  it.each([
    undefined, null, {}, [], { data: classroom }, { error: null }, { data: undefined, error: null },
    { data: classroom, error: false }, { data: classroom, error: {} }, { data: classroom, error: null, unexpected: true },
    { data: classroom, error: null, status: 500 }, { data: classroom, error: null, count: -1 },
    Object.create({ data: classroom, error: null }), Object.assign(Object.create({ error: null }), { data: classroom }),
  ])('strictly validates complete SDK envelopes %#', value => {
    expect(contextualClassroomRosterClassroomEnvelopeSchema.safeParse(value).success).toBe(false)
    expect(contextualClassroomRosterPageEnvelopeSchema.safeParse(value).success).toBe(false)
  })

  it('maps SDK transport and availability exceptions to unavailable without fallback', async () => {
    await expect(fixture([new Error('transport')]).run()).rejects.toMatchObject({ statusCode: 503 })
    const f = fixture(complete([]))
    f.availability.mockRejectedValue(new Error('settings unavailable'))
    await expect(f.run()).rejects.toMatchObject({ statusCode: 503 })
  })
})
