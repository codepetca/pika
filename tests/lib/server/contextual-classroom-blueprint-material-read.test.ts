import { describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { readContextualClassroomBlueprintMaterials } from '@/lib/server/contextual-classroom-blueprint-material-read'
import type { getServiceRoleClient } from '@/lib/supabase'
import type { Database } from '@/types/database'

const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const classroomId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const blueprintId = '33333333-3333-4333-8333-333333333333'
const versionId = '44444444-4444-4444-8444-444444444444'
const otherId = '55555555-5555-4555-8555-555555555555'
const material = { artifact_id: otherId, title: 'Saved lesson', content_markdown: '# Lesson', position: 5 }
const preflight = () => ({ id: classroomId, teacher_id: actorId })
const root = () => ({
  ...preflight(), source_blueprint_id: blueprintId,
  blueprint: { id: blueprintId, teacher_id: actorId, versions: [{
    id: versionId, course_blueprint_id: blueprintId, version_number: 7,
    snapshot_json: { materials: [material], authoring_guidance: 'private', assessments: [{ answer_key: 'private' }] },
  }] },
})
const envelope = (data: unknown) => ({ data, error: null, count: null, status: 200, statusText: 'OK' })
function database(results: unknown[] = [envelope(preflight()), envelope(root())]) {
  const builders: Array<ReturnType<typeof builder>> = []
  function builder() {
    const chain = {
      select: vi.fn((_fields: string) => chain), eq: vi.fn((_key: string, _value: string) => chain),
      order: vi.fn((_column: string, _options: unknown) => chain), limit: vi.fn((_count: number, _options: unknown) => chain),
      maybeSingle: vi.fn(async () => results.shift()),
    }
    return chain
  }
  const from = vi.fn((_table: string) => { const chain = builder(); builders.push(chain); return chain })
  return { from, builders }
}
function read(db: ReturnType<typeof database>, overrides = {}) {
  return readContextualClassroomBlueprintMaterials({
    supabase: db as unknown as ReturnType<typeof getServiceRoleClient>, actorId, classroomId, ...overrides,
  })
}
function mutateRoot(mutate: (row: ReturnType<typeof root>) => void) {
  const row = root(); mutate(row)
  return database([envelope(preflight()), envelope(row)])
}

describe('contextual linked Blueprint material read', () => {
  it('binds both current owners and latest saved version in one classroom payload query', async () => {
    const db = database()
    expect(await read(db)).toEqual({ materials: { version_id: versionId, version_number: 7, materials: [material] } })
    expect(db.from.mock.calls).toEqual([['classrooms'], ['classrooms']])
    const payload = db.builders[1]
    expect(payload.select).toHaveBeenCalledWith(expect.stringContaining('blueprint:course_blueprints!classrooms_source_blueprint_id_fkey'))
    expect(payload.select).toHaveBeenCalledWith(expect.stringContaining('versions:course_blueprint_versions!course_blueprint_versions_course_blueprint_id_fkey'))
    expect(payload.eq.mock.calls).toEqual([['id', classroomId], ['teacher_id', actorId], ['blueprint.teacher_id', actorId]])
    expect(payload.order).toHaveBeenCalledWith('version_number', { ascending: false, referencedTable: 'blueprint.versions' })
    expect(payload.limit).toHaveBeenCalledWith(1, { referencedTable: 'blueprint.versions' })
    expect(payload.select.mock.calls[0][0]).not.toContain('source_blueprint_version_id')
  })

  it('uses only identity preflight, allowing archived owners without requiring a mutable Draft', async () => {
    const db = database(); await read(db)
    expect(db.builders[0].select).toHaveBeenCalledWith('id,teacher_id')
    expect(db.builders[1].select.mock.calls[0][0]).not.toMatch(/archived_at|draft|content_revision/)
  })

  it('canonicalizes authenticated and requested UUIDs', async () => {
    const db = database()
    await read(db, { actorId: actorId.toUpperCase(), classroomId: classroomId.toUpperCase() })
    expect(db.builders[1].eq).toHaveBeenCalledWith('id', classroomId)
  })

  it.each([{ actorId: 'invalid' }, { classroomId: 'invalid' }])('rejects invalid helper identities %j before any query', async (input) => {
    const db = database()
    await expect(read(db, input)).rejects.toMatchObject({ statusCode: 400 })
    expect(db.from).not.toHaveBeenCalled()
  })

  it.each([{ data: null, status: 404 }, { data: { ...preflight(), teacher_id: otherId }, status: 403 }])('denies absent/nonowned preflight %#', async ({ data, status }) => {
    const db = database([envelope(data)])
    await expect(read(db)).rejects.toMatchObject({ statusCode: status })
    expect(db.from).toHaveBeenCalledTimes(1)
  })

  it('never treats a successful preflight as authority after ownership transfer', async () => {
    await expect(read(database([envelope(preflight()), envelope(null)]))).rejects.toMatchObject({ statusCode: 403 })
  })

  it.each([
    undefined,
    { data: preflight() },
    { data: preflight(), error: { code: 'XX000', message: 'private' } },
    envelope({ ...preflight(), id: otherId }),
    envelope({ ...preflight(), teacher_id: 'invalid' }),
    envelope({ ...preflight(), unexpected: 'private' }),
  ])('rejects malformed preflight evidence %# before any payload query', async result => {
    const db = database([result])
    await expect(read(db)).rejects.toMatchObject({ statusCode: 503 })
    expect(db.from).toHaveBeenCalledTimes(1)
  })

  it('returns null only for a currently bound no-link classroom', async () => {
    const db = database([envelope(preflight()), envelope({ ...preflight(), source_blueprint_id: null, blueprint: null })])
    expect(await read(db)).toEqual({ materials: null })
    expect(db.from).toHaveBeenCalledTimes(2)
  })

  it('denies a linked Blueprint filtered out by current ownership', async () => {
    await expect(read(database([envelope(preflight()), envelope({ ...preflight(), source_blueprint_id: blueprintId, blueprint: null })]))).rejects.toMatchObject({ statusCode: 404 })
  })

  it('rejects a Blueprint payload attached to a no-link classroom', async () => {
    const row = { ...root(), source_blueprint_id: null }
    await expect(read(database([envelope(preflight()), envelope(row)]))).rejects.toMatchObject({ statusCode: 503 })
  })

  it('uses the current owned link if rebinding occurred before the payload statement', async () => {
    const db = mutateRoot(row => { row.source_blueprint_id = otherId; row.blueprint.id = otherId; row.blueprint.versions[0].course_blueprint_id = otherId })
    expect(await read(db)).toMatchObject({ materials: { version_id: versionId } })
  })

  it.each([
    (row: ReturnType<typeof root>) => { row.id = otherId },
    (row: ReturnType<typeof root>) => { row.teacher_id = otherId },
    (row: ReturnType<typeof root>) => { row.source_blueprint_id = otherId },
    (row: ReturnType<typeof root>) => { row.blueprint.id = otherId },
    (row: ReturnType<typeof root>) => { row.blueprint.teacher_id = otherId },
    (row: ReturnType<typeof root>) => { row.blueprint.versions[0].id = 'invalid' },
    (row: ReturnType<typeof root>) => { row.blueprint.versions[0].course_blueprint_id = otherId },
    (row: ReturnType<typeof root>) => { row.blueprint.versions = [] },
    (row: ReturnType<typeof root>) => { row.blueprint.versions.push(row.blueprint.versions[0]) },
  ])('rejects substituted/absent payload evidence %#', async mutate => {
    await expect(read(mutateRoot(mutate))).rejects.toMatchObject({ statusCode: 503 })
  })

  it('sorts only the material projection without returning private snapshot or binding fields', async () => {
    const first = { ...material, artifact_id: versionId, position: 0 }
    const db = mutateRoot(row => { row.blueprint.versions[0].snapshot_json.materials.push(first) })
    expect(await read(db)).toEqual({ materials: { version_id: versionId, version_number: 7, materials: [first, material] } })
  })

  it('preserves historical absence of materials as an empty saved list', async () => {
    const row = { ...root(), blueprint: { ...root().blueprint, versions: [{ ...root().blueprint.versions[0], snapshot_json: { metadata: {} } }] } }
    expect(await read(database([envelope(preflight()), envelope(row)]))).toEqual({ materials: { version_id: versionId, version_number: 7, materials: [] } })
  })

  it.each([null, [], 'bad', { materials: null }, { materials: {} }, { materials: [{ ...material, title: ' ' }] }, { materials: [{ ...material, content_markdown: 12 }] }, { materials: [{ ...material, position: -1 }] }, { materials: [{ ...material, artifact_id: 'bad' }] }, { materials: [{ ...material, unexpected: 'private' }] }])('fails malformed present snapshot/material fields closed: %j', async snapshot_json => {
    const row = root()
    const version = { ...row.blueprint.versions[0], snapshot_json }
    const payload = { ...row, blueprint: { ...row.blueprint, versions: [version] } }
    await expect(read(database([envelope(preflight()), envelope(payload)]))).rejects.toMatchObject({ statusCode: 503 })
  })

  it.each([0, -1, 1.5, '7', null, Number.MAX_SAFE_INTEGER + 1])('rejects malformed version numbers %j without coercion', async version_number => {
    const row = root()
    const payload = { ...row, blueprint: { ...row.blueprint, versions: [{ ...row.blueprint.versions[0], version_number }] } }
    await expect(read(database([envelope(preflight()), envelope(payload)]))).rejects.toMatchObject({ statusCode: 503 })
  })

  it.each([500, 501])('enforces the existing %i-material boundary without partial output', async count => {
    const db = mutateRoot(row => { row.blueprint.versions[0].snapshot_json.materials = Array.from({ length: count }, () => material) })
    if (count === 500) expect((await read(db)).materials?.materials).toHaveLength(500)
    else await expect(read(db)).rejects.toMatchObject({ statusCode: 503 })
  })

  it.each([undefined, {}, { data: root() }, { data: root(), error: { message: 'denied' } }, { data: root(), error: null, extra: 'unverified' }])('rejects malformed SDK envelope %#', async result => {
    await expect(read(database([envelope(preflight()), result]))).rejects.toMatchObject({ statusCode: 503 })
  })

  it.each([
    { ...envelope(root()), status: 500 },
    { ...envelope(root()), count: '1' },
    envelope({ ...root(), unexpected: 'private' }),
    envelope({ ...root(), blueprint: { ...root().blueprint, unexpected: 'private' } }),
    envelope({ ...root(), blueprint: [{ ...root().blueprint }] }),
    envelope({ ...root(), blueprint: { ...root().blueprint, versions: null } }),
  ])('rejects malformed payload envelope or embed cardinality %#', async result => {
    await expect(read(database([envelope(preflight()), result]))).rejects.toMatchObject({ statusCode: 503 })
  })

  it('maps thrown SDK failures to generic 503 without private detail', async () => {
    const db = database()
    db.from.mockImplementation(() => { throw new Error('private source') })
    await expect(read(db)).rejects.toMatchObject({ statusCode: 503, message: 'Unable to verify linked Blueprint materials' })
  })

  it('maps payload SDK rejection to generic 503 without legacy recovery', async () => {
    const db = database()
    // Keep a real fluent preflight double, then throw on the independent payload query.
    const preflightDb = database([envelope(preflight())])
    db.from.mockReset().mockImplementationOnce(() => preflightDb.from('classrooms'))
      .mockImplementationOnce(() => { throw new Error('private version') })
    await expect(read(db)).rejects.toMatchObject({ statusCode: 503, message: 'Unable to verify linked Blueprint materials' })
    expect(db.from).toHaveBeenCalledTimes(2)
  })

  it('serializes the nested owner filter and latest-version order/limit through the genuine installed SDK', async () => {
    const urls: URL[] = []
    const responses = [preflight(), root()]
    const supabase = createClient<Database>('http://localhost:54321', 'synthetic-unit-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async input => {
        urls.push(new URL(String(input)))
        return new Response(JSON.stringify(responses.shift()), { status: 200, headers: { 'Content-Type': 'application/json' } })
      } },
    })
    expect(await readContextualClassroomBlueprintMaterials({ supabase, actorId, classroomId })).toMatchObject({ materials: { version_id: versionId } })
    expect(urls[1].pathname).toBe('/rest/v1/classrooms')
    expect(urls[1].searchParams.get('teacher_id')).toBe(`eq.${actorId}`)
    expect(urls[1].searchParams.get('blueprint.teacher_id')).toBe(`eq.${actorId}`)
    expect(urls[1].searchParams.get('blueprint.versions.order')).toBe('version_number.desc')
    expect(urls[1].searchParams.get('blueprint.versions.limit')).toBe('1')
    expect(urls[1].searchParams.get('select')).toContain('snapshot_json')
  })
})
