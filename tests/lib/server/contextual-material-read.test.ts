import { describe, expect, it, vi } from 'vitest'
import { readContextualMaterials } from '@/lib/server/contextual-material-read'
import { materialReadRowSchema } from '@/lib/validations/material-reads'
import type { getServiceRoleClient } from '@/lib/supabase'

const actorId = '11111111-1111-4111-8111-111111111111'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
const timestamp = '2026-10-03T12:00:00.123456+00:00'
const doc = { type: 'doc', content: [{ type: 'paragraph', attrs: { alignment: 'center' }, content: [{ type: 'text', text: 'Text', marks: [{ type: 'link', attrs: { href: 'https://example.test', target: '_blank' } }] }] }, { type: 'image', attrs: { src: 'https://storage.example.test/image.png', alt: 'Reference', width: 400 } }] }
const material = (index = 1, position = 0, released_at: string | null = timestamp) => ({
  id: id(index), classroom_id: classroomId, title: 'Historical title', content: doc,
  is_draft: false, released_at, created_by: otherId, created_at: timestamp, updated_at: timestamp,
  position, artifact_id: otherId, source_artifact_id: null, blueprint_archived_at: null, source_blueprint_version_id: null,
})
type Permission = 'owner' | 'member'
const envelope = (data: unknown) => ({ data, error: null, status: 200, statusText: 'OK', count: null })
const classroom = (permission: Permission = 'member') => ({ id: classroomId, teacher_id: permission === 'owner' ? actorId : otherId, archived_at: null as string | null })
const root = (materials: unknown, permission: Permission = 'member') => ({
  ...classroom(permission), materials,
  ...(permission === 'member' ? { membership: [{ classroom_id: classroomId, student_id: actorId }] } : {}),
})
function client(pages: unknown[], permission: Permission = 'member', preflight?: { classroom?: unknown; enrollment?: unknown }) {
  const queries: Array<Array<[string, unknown[]]>> = []
  let page = 0
  const from = vi.fn((table: string) => {
    const methods: Array<[string, unknown[]]> = []
    const builder: Record<string, (...args: any[]) => any> = {}
    for (const name of ['select', 'eq', 'neq', 'is', 'or', 'order', 'limit']) {
      builder[name] = (...args: unknown[]) => {
        methods.push([name, args])
        if (name === 'select' && String(args[0]).includes('materials:')) queries.push(methods)
        return builder
      }
    }
    builder.maybeSingle = () => builder
    builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
      const select = String(methods.find(([name]) => name === 'select')?.[1][0])
      const result = select.includes('materials:') ? pages[page++]
        : table === 'classroom_enrollments'
          ? preflight && 'enrollment' in preflight ? preflight.enrollment : envelope({ classroom_id: classroomId, student_id: actorId })
          : preflight && 'classroom' in preflight ? preflight.classroom : envelope(classroom(permission))
      return Promise.resolve(result).then(resolve, reject)
    }
    return builder
  })
  return { supabase: { from } as unknown as ReturnType<typeof getServiceRoleClient>, from, queries }
}
const input = { actorId, classroomId }
const read = (pages: unknown[], permission: Permission = 'member', preflight?: { classroom?: unknown; enrollment?: unknown }) => {
  const fixture = client(pages, permission, preflight)
  return { ...fixture, result: readContextualMaterials({ ...input, permission, supabase: fixture.supabase }) }
}

describe('current-relationship shared material reads', () => {
  it.each(['owner', 'member'] as const)('returns an authorized empty or all-hidden %s root', async permission => {
    const { result, queries } = read([envelope(root([], permission))], permission)
    await expect(result).resolves.toEqual({ materials: [] })
    expect(queries).toHaveLength(1)
    expect(queries[0]).toContainEqual(['eq', ['id', classroomId]])
    expect(String(queries[0][0][1][0])).toContain('materials:classwork_materials!classwork_materials_classroom_id_fkey(')
    expect(String(queries[0][0][1][0])).not.toContain('classwork_materials_classroom_id_fkey!inner')
  })

  it('binds every owner page to current ownership and preserves all fourteen fields and rich content', async () => {
    const row = { ...material(), is_draft: true, released_at: null, title: '  ', artifact_id: id(50), source_artifact_id: id(51), blueprint_archived_at: timestamp, source_blueprint_version_id: id(52) }
    const { result, queries, from } = read([envelope(root([row], 'owner')), envelope(root([], 'owner'))], 'owner')
    await expect(result).resolves.toEqual({ materials: [row] })
    expect(Object.keys(row)).toHaveLength(14)
    expect(from.mock.calls.every(([table]) => table === 'classrooms')).toBe(true)
    for (const query of queries) {
      expect(query).toContainEqual(['eq', ['teacher_id', actorId]])
      expect(query).toContainEqual(['order', ['position', { ascending: true, referencedTable: 'materials' }]])
      expect(query).toContainEqual(['order', ['created_at', { ascending: true, referencedTable: 'materials' }]])
      expect(query).toContainEqual(['order', ['id', { ascending: true, referencedTable: 'materials' }]])
      expect(query).toContainEqual(['limit', [1000, { referencedTable: 'materials' }]])
      expect(query.some(([, args]) => ['materials.created_by', 'materials.is_draft', 'archived_at', 'materials.blueprint_archived_at'].includes(String(args[0])))).toBe(false)
      expect(String(query[0][1][0])).not.toContain('membership:')
    }
  })

  it('binds every member page to one active non-owner membership and only the draft predicate', async () => {
    const row = { ...material(), released_at: '2099-01-01T00:00:00Z', blueprint_archived_at: timestamp }
    const { result, queries } = read([envelope(root([row])), envelope(root([]))])
    await expect(result).resolves.toEqual({ materials: [row] })
    for (const query of queries) {
      expect(query).toContainEqual(['neq', ['teacher_id', actorId]])
      expect(query).toContainEqual(['is', ['archived_at', null]])
      expect(query).toContainEqual(['eq', ['membership.student_id', actorId]])
      expect(query).toContainEqual(['eq', ['materials.is_draft', false]])
      expect(query).toContainEqual(['order', ['released_at', { ascending: true, nullsFirst: false, referencedTable: 'materials' }]])
      expect(query).toContainEqual(['limit', [1000, { referencedTable: 'materials' }]])
      expect(String(query[0][1][0])).toContain('membership:classroom_enrollments!classroom_enrollments_classroom_id_fkey!inner(classroom_id,student_id)')
      expect(query.filter(([name]) => name === 'or').length).toBeLessThanOrEqual(1)
      expect(query.some(([, args]) => String(args[0]).includes('blueprint_archived_at.'))).toBe(false)
    }
  })

  it('keysets owner position, full microsecond creation time and UUID ties without rounding', async () => {
    const later = '2026-10-03T12:00:00.123457+00:00'
    const rows = [material(1, -2), material(2, -2), { ...material(3, -2), created_at: later }, material(4, -1)]
    const { result, queries } = read([...rows.map(row => envelope(root([row], 'owner'))), envelope(root([], 'owner'))], 'owner')
    await expect(result).resolves.toEqual({ materials: rows })
    expect(queries[1]).toContainEqual(['or', [`position.gt.-2,and(position.eq.-2,created_at.gt.${timestamp}),and(position.eq.-2,created_at.eq.${timestamp},id.gt.${id(1)})`, { referencedTable: 'materials' }]])
    expect(queries[3]).toContainEqual(['or', [`position.gt.-2,and(position.eq.-2,created_at.gt.${later}),and(position.eq.-2,created_at.eq.${later},id.gt.${id(3)})`, { referencedTable: 'materials' }]])
  })

  it('keysets member position, precise release time, nulls-last and UUID ties', async () => {
    const later = '2026-10-03T12:00:00.123457+00:00'
    const rows = [material(1, -1), material(2, -1), material(3, -1, later), material(4, -1, null), material(5, -1, null), material(6, 0)]
    const { result, queries } = read([...rows.map(row => envelope(root([row]))), envelope(root([]))])
    await expect(result).resolves.toEqual({ materials: rows })
    expect(queries[1]).toContainEqual(['or', [`position.gt.-1,and(position.eq.-1,released_at.gt.${timestamp}),and(position.eq.-1,released_at.is.null),and(position.eq.-1,released_at.eq.${timestamp},id.gt.${id(1)})`, { referencedTable: 'materials' }]])
    expect(queries[4]).toContainEqual(['or', [`position.gt.-1,and(position.eq.-1,released_at.is.null,id.gt.${id(4)})`, { referencedTable: 'materials' }]])
    expect(queries[6].filter(([name]) => name === 'or')).toHaveLength(1)
  })

  it.each(['owner', 'member'] as const)('continues through 1000 rows, a short nonempty page and an authorized terminal %s page', async permission => {
    const rows = Array.from({ length: 1002 }, (_, index) => material(index + 1))
    const { result, queries } = read([envelope(root(rows.slice(0, 1000), permission)), envelope(root(rows.slice(1000, 1001), permission)), envelope(root(rows.slice(1001), permission)), envelope(root([], permission))], permission)
    await expect(result).resolves.toEqual({ materials: rows })
    expect(queries).toHaveLength(4)
  })

  it.each(['owner', 'member'] as const)('discards accumulated %s data on first, later or terminal relationship loss', async permission => {
    for (const pages of [[envelope(null)], [envelope(root([material()], permission)), envelope(null)], [envelope(root([material()], permission)), envelope(root([material(2)], permission)), envelope(null)]]) {
      await expect(read(pages, permission).result).rejects.toMatchObject({ statusCode: 403 })
    }
  })

  it('permits archived owners but denies archived members and historical owner self-enrollment', async () => {
    const archived = { ...classroom('owner'), archived_at: timestamp }
    await expect(read([envelope({ ...root([], 'owner'), archived_at: timestamp })], 'owner', { classroom: envelope(archived) }).result).resolves.toEqual({ materials: [] })
    const archivedMember = read([], 'member', { classroom: envelope({ ...classroom(), archived_at: timestamp }) })
    await expect(archivedMember.result).rejects.toMatchObject({ statusCode: 403 })
    expect(archivedMember.queries).toHaveLength(0)
    const ownerAsMember = read([], 'member', { classroom: envelope(classroom('owner')) })
    await expect(ownerAsMember.result).rejects.toMatchObject({ statusCode: 403 })
    expect(ownerAsMember.from).not.toHaveBeenCalledWith('classroom_enrollments')
  })

  it('accepts signed int32 positions and null/future release times without title authoring constraints', async () => {
    const rows = [material(1, -2147483648, null), { ...material(2, 2147483647, '2099-01-01T00:00:00Z'), title: ' '.repeat(5000) }]
    await expect(read([envelope(root(rows)), envelope(root([]))]).result).resolves.toEqual({ materials: rows })
  })

  it.each([
    undefined, null, {}, [], { data: undefined, error: null }, { data: null }, { error: null }, { data: null, error: false }, { data: null, error: {} },
    { ...envelope(root([])), unexpected: true }, { ...envelope(root([])), error: { code: '42501' } },
    Object.create(envelope(root([]))), Object.assign(Object.create({ error: null }), { data: root([]) }),
    envelope({ ...root([]), unknown: true }), envelope({ ...root([]), id: otherId }),
    envelope({ ...root([]), teacher_id: actorId }), envelope({ ...root([]), archived_at: timestamp }),
    envelope({ ...root([]), membership: [] }), envelope({ ...root([]), membership: null }),
    envelope({ ...root([]), membership: [{ classroom_id: otherId, student_id: actorId }] }),
    envelope({ ...root([]), membership: [{ classroom_id: classroomId, student_id: otherId }] }),
    envelope({ ...root([]), membership: [{ classroom_id: classroomId, student_id: actorId, unknown: true }] }),
    envelope({ ...root([]), membership: [{ classroom_id: classroomId, student_id: actorId }, { classroom_id: classroomId, student_id: actorId }] }),
    envelope(root({})), envelope(root(null)), envelope(root(Array.from({ length: 1001 }, (_, index) => material(index)))),
  ])('rejects malformed SDK/root/membership evidence without any partial response %#', async page => {
    await expect(read([page]).result).rejects.toMatchObject({ statusCode: 503 })
  })

  it.each([
    { unknown: true }, { id: 'bad' }, { classroom_id: otherId }, { created_by: 'bad' }, { title: null }, { title: undefined },
    { is_draft: true }, { is_draft: undefined }, { released_at: 'infinity' }, { released_at: '2026-99-99T00:00:00Z' },
    { created_at: 'bad' }, { updated_at: null }, { position: undefined }, { position: null }, { position: 1.5 },
    { position: -2147483649 }, { position: 2147483648 }, { position: '1' },
    { artifact_id: 'bad' }, { source_artifact_id: 'bad' }, { source_blueprint_version_id: 'bad' }, { blueprint_archived_at: 'bad' },
    { content: null }, { content: JSON.stringify(doc) }, { content: {} }, { content: { type: 'doc', content: [null] } },
    { content: { type: 'doc', content: [{ type: 'paragraph', content: 'bad' }] } },
    { content: { type: 'doc', content: [{ type: 'text', text: 42 }] } },
    { content: { type: 'doc', content: [{ type: 'text', text: 'Text', marks: [{ type: 'bold', attrs: [] }] }] } },
  ])('rejects malformed material fields and draft leakage %#', async patch => {
    await expect(read([envelope(root([{ ...material(), ...patch }]))]).result).rejects.toMatchObject({ statusCode: 503 })
  })

  it.each(['owner', 'member'] as const)('rejects null artifact identity in a complete authorized %s response', async permission => {
    const row = { ...material(), artifact_id: null }
    await expect(read([envelope(root([row], permission)), envelope(root([], permission))], permission).result).rejects.toMatchObject({ statusCode: 503 })
  })

  it.each([
    [material(), material()], [material(2), material(1)], [material(1, 1), material(2, 0)],
    [material(1, 0, null), material(2)],
    [material(1, 0, '2026-10-03T12:00:00.123457Z'), material(2)],
  ].map(rows => ({ rows })))('rejects duplicate or backward member composite keys within or across pages %#', async ({ rows }) => {
    await expect(read([envelope(root(rows))]).result).rejects.toMatchObject({ statusCode: 503 })
    await expect(read(rows.map(row => envelope(root([row])))).result).rejects.toMatchObject({ statusCode: 503 })
  })

  it('rejects backward owner creation times at microsecond precision and repeats across changed keys', async () => {
    const later = { ...material(), created_at: '2026-10-03T12:00:00.123457Z' }
    await expect(read([envelope(root([later, material(2)], 'owner'))], 'owner').result).rejects.toMatchObject({ statusCode: 503 })
    await expect(read([envelope(root([material()])), envelope(root([material(1, 1)]))]).result).rejects.toMatchObject({ statusCode: 503 })
  })

  it('compares equivalent timestamp offsets before UUID tie-breaking', async () => {
    const equivalent = '2026-10-03T08:00:00.123456-04:00'
    await expect(read([envelope(root([material(), material(2, 0, equivalent)])), envelope(root([]))]).result).resolves.toEqual({ materials: [material(), material(2, 0, equivalent)] })
    await expect(read([envelope(root([material(2), material(1, 0, equivalent)]))]).result).rejects.toMatchObject({ statusCode: 503 })
  })

  it.each([
    { preflight: { classroom: envelope(null) }, statusCode: 404 },
    { preflight: { classroom: { data: null } }, statusCode: 503 },
    { preflight: { classroom: Object.create(envelope(classroom())) }, statusCode: 503 },
    { preflight: { classroom: envelope({ ...classroom(), id: otherId }) }, statusCode: 503 },
    { preflight: { classroom: envelope({ ...classroom(), unexpected: true }) }, statusCode: 503 },
    { preflight: { enrollment: envelope(null) }, statusCode: 403 },
    { preflight: { enrollment: { data: null } }, statusCode: 503 },
    { preflight: { enrollment: envelope({ classroom_id: otherId, student_id: actorId }) }, statusCode: 503 },
    { preflight: { enrollment: envelope({ classroom_id: classroomId, student_id: otherId }) }, statusCode: 503 },
  ])('retains precise preflight statuses without using preflight as payload evidence %#', async ({ preflight, statusCode }) => {
    const { result, queries } = read([], 'member', preflight)
    await expect(result).rejects.toMatchObject({ statusCode })
    expect(queries).toHaveLength(0)
  })

  it('rejects a wrong owner before data pages and malformed/substituted owner payload evidence', async () => {
    await expect(read([], 'owner', { classroom: envelope(classroom()) }).result).rejects.toMatchObject({ statusCode: 403 })
    await expect(read([envelope({ ...root([], 'owner'), teacher_id: otherId })], 'owner').result).rejects.toMatchObject({ statusCode: 503 })
    await expect(read([envelope({ ...root([], 'owner'), membership: [] })], 'owner').result).rejects.toMatchObject({ statusCode: 503 })
  })

  it('discards earlier valid rows after malformed later payload and missing-position/table errors', async () => {
    for (const failure of [envelope(root([{ ...material(2), content: null }])), { data: null, error: { code: 'PGRST204', message: 'position missing' } }, { data: null, error: { code: 'PGRST205', message: 'classwork_materials missing' } }]) {
      const fixture = read([envelope(root([material()])), failure])
      await expect(fixture.result).rejects.toMatchObject({ statusCode: 503 })
      expect(fixture.from).not.toHaveBeenCalledWith('classwork_materials')
    }
  })

  it.each([{ actorId: 'bad' }, { classroomId: 'bad' }])('rejects invalid UUIDs before any SDK query %#', async invalid => {
    const fixture = client([])
    await expect(readContextualMaterials({ ...input, ...invalid, permission: 'member', supabase: fixture.supabase })).rejects.toMatchObject({ statusCode: 400 })
    expect(fixture.from).not.toHaveBeenCalled()
  })

  it('canonicalizes uppercase actor/classroom/lineage UUIDs', async () => {
    const row = { ...material(), artifact_id: otherId.toUpperCase() }
    const fixture = client([envelope(root([row], 'owner')), envelope(root([], 'owner'))], 'owner')
    await expect(readContextualMaterials({ actorId: actorId.toUpperCase(), classroomId: classroomId.toUpperCase(), permission: 'owner', supabase: fixture.supabase })).resolves.toEqual({ materials: [{ ...row, artifact_id: otherId }] })
    for (const query of fixture.queries) expect(query).toContainEqual(['eq', ['id', classroomId]])
  })

  it('maps construction and rejected SDK reads to generic 503', async () => {
    const fixture = client([])
    fixture.from.mockImplementationOnce(() => { throw new Error('private details') })
    await expect(readContextualMaterials({ ...input, permission: 'member', supabase: fixture.supabase })).rejects.toMatchObject({ statusCode: 503, message: 'Unable to verify classroom materials' })
    await expect(read([Promise.resolve().then(() => { throw new Error('private details') })]).result).rejects.toMatchObject({ statusCode: 503 })
  })
})

describe('material read full-row decoder', () => {
  it('preserves valid Tiptap attributes, marks and image references unchanged', () => {
    expect(materialReadRowSchema.parse(material()).content).toEqual(doc)
  })
})
