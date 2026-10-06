import { afterEach, describe, expect, it, vi } from 'vitest'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/types/database'
import { ApiError } from '../../src/lib/api-error'
import { createContextualTest } from '../../src/lib/server/contextual-test-create'
import { getFallbackAssessmentTitle } from '../../src/lib/assessment-titles'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newTestOwnerCreateFixture, TEST_OWNER_CREATE_SNAPSHOT_TABLES } from '../../scripts/contextual-test-owner-create-proof-fixture'
import { AssignmentListLifecycleError } from '../../scripts/contextual-assignment-list-proof-lifecycle'
import { createTestOwnerCreateProofTransport as reviewedFactory } from '../../scripts/contextual-test-owner-create-proof-transport'
import { createTestOwnerCreateProofTransport, testOwnerCreateRequestManifest, testOwnerCreateUnionManifest,
  testOwnerCreateCanonicalTableCatalog, validateTestOwnerCreateSnapshotCatalog, validateTestOwnerCreateGeneratedTypes,
  testOwnerCreateForcedReceipt, testOwnerCreateSetupDiagnostic, parseTestOwnerCreateLifecycleArgs,
  verifyTestOwnerCreatePrivilegeRestoration, testOwnerCreateMatrixCompletion,
  validateTestOwnerCreatePendingWitness } from '../../scripts/check-contextual-test-owner-create-lifecycle'

const original = newAssignmentListProofFixture(new Date('2026-10-06T04:00:00Z'))
const f = newTestOwnerCreateFixture(original), project = `pika_assignment_list_${f.tag.slice(-12)}`
const key = `e30.${Buffer.from(JSON.stringify({ iss: 'supabase-demo', role: 'service_role' })).toString('base64url')}.synthetic`
const target = { API_URL: 'http://127.0.0.1:54331', DB_URL: 'postgresql://postgres:synthetic@127.0.0.1:54332/postgres', SERVICE_ROLE_KEY: key }
type Rows = Record<string, Record<string, unknown>[]>
const tableKeys = [...new Set([...TEST_OWNER_CREATE_SNAPSHOT_TABLES, 'storage.objects', 'storage.buckets'])].sort()
const digest = (s: string) => createHash('sha256').update(s).digest('hex')
const id = (s: string) => { const h = digest(`lifecycle-test:${s}`); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}` }
function envelope(c = f.cases[0], title = c.input.title!.trim(), position = 0) {
  const stamp = new Date().toISOString()
  const test = { id: id(c.label + 'test'), artifact_id: id(c.label + 'artifact'), classroom_id: c.classroomId,
    created_by: c.actorId, title, show_results: false, status: 'draft', documents: [], position, points_possible: 100, include_in_final: true,
    created_at: stamp, updated_at: stamp, source_artifact_id: null, source_blueprint_version_id: null, blueprint_archived_at: null,
    questions_locked_at: null, gradebook_category_id: id(c.classroomId + 'category1'), gradebook_maximum_override: null, gradebook_score_scale: 1, gradebook_weight: 27 }
  return { version: 1, actor_id: c.actorId, classroom_id: c.classroomId, test_id: test.id, test,
    draft: { id: id(c.label + 'draft'), assessment_type: 'test', assessment_id: test.id, classroom_id: c.classroomId, version: 1,
      content: { title, show_results: false, question_identity_version: 1, questions: [], source_format: 'markdown' },
      created_by: c.actorId, updated_by: c.actorId, created_at: stamp, updated_at: stamp } }
}
function initialRows(): Rows {
  const rows = Object.fromEntries(TEST_OWNER_CREATE_SNAPSHOT_TABLES.map(t => [t, []])) as Rows
  rows['public.tests'] = f.tests.map(t => ({ ...envelope().test, ...t, created_at: f.now, updated_at: f.now }))
  rows['public.users'] = f.actors.map(a => ({ ...a, immutable_extra: true }))
  rows['public.classrooms'] = f.classes.map(c => ({ id: c.id, teacher_id: c.owner, title: c.title,
    archived_at: c.archived ? f.now : null, blueprint_source_revision: 9, updated_at: f.now }))
  rows['public.classroom_archive_revisions'] = f.classes.map(c => ({ classroom_id: c.id, revision: 15, updated_at: f.now }))
  rows['public.classroom_enrollments'] = f.enrollments.map(e => ({ ...e, created_at: f.now }))
  rows['public.gradebook_categories'] = f.classes.flatMap(c => [0, 1, 2].map(i => ({ id: id(c.id + `category${i}`), classroom_id: c.id,
    position: i, is_default: i === 1, default_assessment_weight: i === 1 ? 27 : 10, immutable_extra: true })))
  rows.__nontarget_fingerprints = tableKeys.map(table => ({ table, fingerprint: 'unchanged' }))
  return rows
}
function add(rows: Rows, e: ReturnType<typeof envelope>) {
  rows['public.tests'].push(e.test); rows['public.assessment_drafts'].push(e.draft)
  const classroom = rows['public.classrooms'].find(r => r.id === e.classroom_id)!, archive = rows['public.classroom_archive_revisions'].find(r => r.classroom_id === e.classroom_id)!
  classroom.blueprint_source_revision = Number(classroom.blueprint_source_revision) + 2; classroom.updated_at = e.test.created_at
  archive.revision = Number(archive.revision) + 4; archive.updated_at = e.test.created_at
}
function client(transport: ReturnType<typeof createTestOwnerCreateProofTransport>) {
  return createClient<Database>(target.API_URL, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport.fetch } })
}
afterEach(() => vi.useRealTimers())

describe('source-only owner CREATE lifecycle sibling', () => {
  it('reuses the exact reviewed transport factory, not an alternate lifecycle fetch engine', () => {
    expect(createTestOwnerCreateProofTransport).toBe(reviewedFactory)
    const source = readFileSync(resolve(process.cwd(), 'scripts/check-contextual-test-owner-create-lifecycle.ts'), 'utf8')
    expect(source).not.toMatch(/const safeFetch|reader\.read\(|reader\.cancel\(|registerTestOwnerCreateWitness\(|getFallbackAssessmentTitle\(/)
    expect(source).toContain("export { createTestOwnerCreateProofTransport } from './contextual-test-owner-create-proof-transport'")
  })
  it('seals one shared fixture,250 source,15 requests and separate app setup/native presence hashes', () => {
    const m = testOwnerCreateRequestManifest(f)
    expect(m.paths).toEqual(['/rest/v1/rpc/create_test_for_owner_v1'])
    expect(m.keys).toEqual(['p_actor_id', 'p_classroom_id', 'p_title', 'p_deadline'])
    expect(m.caps.storageRequests).toBe(0)
    const union = testOwnerCreateUnionManifest(original, f, 'a'.repeat(40), process.cwd())
    expect(union.application.fixture).toBe(f); expect(union.sql.fixture).toBe(f)
    expect(union.inventory).toMatchObject({ sdkCases: 14, sdkCreates: 8, rpcRequests: 15, storageRequests: 0, races: 9 })
    expect(union.applicationSetupSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(union.applicationSnapshotSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(union.sql.setup).not.toContain('insert into public.tests')
    expect(union.sql.privilege.revoke).toContain('create_test_for_owner_v1')
    expect(Object.isFrozen(union.sql.concurrency.schedules)).toBe(true)
  })
  it('gets expected table catalog only from canonical rowDigests and rejects malformed/foreign keys', () => {
    const canonical = { rowDigests: JSON.stringify(Object.fromEntries(tableKeys.map(t => [t, 'xml-digest']))) }
    expect(testOwnerCreateCanonicalTableCatalog(canonical)).toEqual(tableKeys)
    expect(Object.isFrozen(testOwnerCreateCanonicalTableCatalog(canonical))).toBe(true)
    for (const rowDigests of ['[]', '{}', '{"vault.secrets":"x"}', 'not-json']) expect(() => testOwnerCreateCanonicalTableCatalog({ rowDigests })).toThrow()
    const rows = initialRows(); expect(validateTestOwnerCreateSnapshotCatalog(rows, tableKeys)).toBe(rows)
    for (const bad of [rows.__nontarget_fingerprints.slice(1), [...rows.__nontarget_fingerprints, rows.__nontarget_fingerprints[0]],
      [...rows.__nontarget_fingerprints, { table: 'public.injected', fingerprint: 'x' }]]) expect(() => validateTestOwnerCreateSnapshotCatalog({ ...rows, __nontarget_fingerprints: bad }, tableKeys)).toThrow()
  })
  it('accepts only fixed CLI args and normal-only generation', () => {
    const args = ['--reviewed-head', 'a'.repeat(40), '--mode', 'normal']
    expect(parseTestOwnerCreateLifecycleArgs(args)).toMatchObject({ mode: 'normal', generateTypes: false })
    expect(parseTestOwnerCreateLifecycleArgs([...args, '--generate-types']).generateTypes).toBe(true)
    expect(() => parseTestOwnerCreateLifecycleArgs([...args.slice(0, 3), 'after-fixture', '--generate-types'])).toThrow()
    expect(() => parseTestOwnerCreateLifecycleArgs([...args, '--target', 'production'])).toThrow()
  })
  it.each(['after-fixture', 'before-capture'])('requires full setup and exact inherited clean forced error: %s', mode => {
    const e = new AssignmentListLifecycleError({ stage: mode, error: new Error('Forced isolated lifecycle failure') }, [])
    expect(testOwnerCreateForcedReceipt(mode, e, true)).toEqual({ stdout: 'PASS isolated test-owner-create exact teardown and unchanged canonical baseline.\n',
      stderr: `FAIL forced isolated test-owner-create lifecycle: ${mode}.\n`, exitCode: 1 })
    expect(testOwnerCreateForcedReceipt(mode, e, false)).toBeNull()
    expect(testOwnerCreateForcedReceipt('normal', e, true)).toBeNull()
    expect(testOwnerCreateForcedReceipt(mode, new AssignmentListLifecycleError(e.primary, [{ stage: 'teardown', error: Error('PRIVATE') }]), true)).toBeNull()
    expect(testOwnerCreateForcedReceipt(mode, new AssignmentListLifecycleError({ stage: mode, error: Error('different') }, []), true)).toBeNull()
  })
  it('always compares application rows after ambiguous capability probe failure', async () => {
    const snapshot = vi.fn(async () => ({ rows: [] }))
    await expect(verifyTestOwnerCreatePrivilegeRestoration({ rows: [] }, snapshot, async () => { throw Error('ambiguous') })).rejects.toThrow('ambiguous')
    expect(snapshot).toHaveBeenCalledOnce()
    await expect(verifyTestOwnerCreatePrivilegeRestoration({ rows: [] }, async () => ({ rows: [{ changed: true }] }), async () =>
      ({ privilegeRestored: true, fixtureUnchanged: true, createAclSha256: 'a'.repeat(64) }))).rejects.toThrow()
  })
  it('retains the primary and equality failures together, including undefined primary rejection', async () => {
    const primary = Error('primary private failure')
    const result = verifyTestOwnerCreatePrivilegeRestoration({ rows: [] }, async () => { throw Error('snapshot private failure') }, async () => { throw primary })
    await expect(result).rejects.toBeInstanceOf(AggregateError)
    try { await result } catch (error) { expect((error as AggregateError).errors[0]).toBe(primary); expect((error as AggregateError).errors).toHaveLength(2) }
    await expect(verifyTestOwnerCreatePrivilegeRestoration({ rows: [] }, async () => ({ rows: [] }), async () => { throw undefined })).rejects.toBeUndefined()
  })
  it('checks actual public Functions CREATE argument types with AST, rejecting comments/other schemas/manual signatures', () => {
    const source = 'export type Json = unknown; export type Database = { public: { Functions: { create_test_for_owner_v1: { Args: { p_actor_id: string; p_classroom_id: string; p_title: string; p_deadline: string }; Returns: Json } } } }'
    expect(validateTestOwnerCreateGeneratedTypes(source, digest(source))).toBe(true)
    for (const bad of [source.replace('p_title: string', 'p_title: number'), source.replace('p_deadline: string', 'p_deadline?: string'),
      source.replace('public:', 'private:'), source.replace('create_test_for_owner_v1:', 'old_function:'), source.replace('Returns: Json', 'Returns: string'), '// ' + source]) expect(() => validateTestOwnerCreateGeneratedTypes(bad, digest(bad))).toThrow()
    expect(() => validateTestOwnerCreateGeneratedTypes(source, '0'.repeat(64))).toThrow()
  })
  it('closes diagnostics over fixed stages/coordinates and never raw errors, rows or credentials', () => {
    const error = new assert.AssertionError({ message: 'PRIVATE SQL SECRET', actual: target, expected: 'PRIVATE', operator: 'deepStrictEqual' })
    error.stack = 'AssertionError SECRET\n    at runner (/private/repo/scripts/check-contextual-test-create-concurrency.ts:195:1)'
    const d = testOwnerCreateSetupDiagnostic('complete', new AssignmentListLifecycleError({ stage: 'cases', error }, []))
    expect(d).toContain('location=check-contextual-test-create-concurrency.ts:195')
    expect(d).not.toMatch(/PRIVATE|SECRET|synthetic|\/private\/repo/)
    expect(testOwnerCreateSetupDiagnostic('PRIVATE', Error('SECRET'))).toContain('setup=unknown')
  })
  it('runs all14 installed-SDK/helper cases plus raw42501 with an internal verified ledger', async () => {
    const rows = initialRows(); let c: typeof f.cases[number] | typeof f.privilegeProbe = f.cases[0]
    const guard = vi.fn(async () => {})
    const fetcher = vi.fn<typeof fetch>(async (_resource, init) => {
      const body = JSON.parse(String(init?.body))
      if (c.expectedHTTP !== 201) return new Response(JSON.stringify({ code: c === f.privilegeProbe ? '42501' : `PT${c.expectedHTTP}`, message: 'synthetic', details: null, hint: null }), { status: c === f.privilegeProbe ? 403 : c.expectedHTTP })
      const old = rows['public.tests'].filter(t => t.classroom_id === c.classroomId), position = (old.length ? Math.max(...old.map(t => Number(t.position))) : -1) + 1
      const e = envelope(c, body.p_title, position); add(rows, e)
      return new Response(JSON.stringify(e))
    })
    const transport = createTestOwnerCreateProofTransport(f, target, project, fetcher, guard), supabase = client(transport)
    expect(transport).not.toHaveProperty('ledger'); expect(transport).not.toHaveProperty('witnesses')
    const executed: string[] = []
    const run = async (proofCase: typeof c) => {
      c = proofCase; const before = structuredClone(rows), start = Date.now(); transport.readContext(c.label, start)
      let result: unknown
      if (c.expectedHTTP === 201) {
        result = await createContextualTest({ supabase, actorId: c.actorId, input: c.input, deadline: start + 20000 })
        validateTestOwnerCreatePendingWitness(transport, c.label, testOwnerCreateRequestManifest(f).rollbackReservedIds)
      }
      else await expect(createContextualTest({ supabase, actorId: c.actorId, input: c.input, deadline: start + 20000 })).rejects.toMatchObject({ statusCode: c.expectedHTTP })
      transport.verifyEffects(before, structuredClone(rows), result)
      executed.push(c.label)
    }
    for (const proofCase of f.cases.slice(0, 13)) await run(proofCase)
    await run(f.privilegeProbe); await run(f.cases[13]); expect(testOwnerCreateMatrixCompletion(f, transport, executed)).toEqual({ sdkCases: 14, sdkCreates: 8, rpcRequests: 15, storageRequests: 0 })
    expect(transport.counts).toMatchObject({ network: 15, rpc: 15, storage: 0 })
    expect(transport.getVerifiedLedger()).toHaveLength(8); expect(transport.evidence).toMatchObject({ rawPrivilegeFailures: 1 })
    expect(rows['public.tests']).toHaveLength(1009); expect(rows['public.assessment_drafts']).toHaveLength(8)
    expect(guard).toHaveBeenCalledTimes(30)
    expect(fetcher).toHaveBeenCalledTimes(15)
    expect(() => testOwnerCreateMatrixCompletion(f, transport, executed.slice(0, 14))).toThrow()
    expect(() => testOwnerCreateMatrixCompletion(f, transport, [...executed.slice(0, 13), executed[14], executed[13]])).toThrow()
    expect(() => transport.readContext(f.cases[0].label, Date.now())).toThrow()
  })
  it('rejects malformed successes/lost acknowledgements without retry or granting ledger authority', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ version: 1 })))
    const transport = createTestOwnerCreateProofTransport(f, target, project, fetcher, async () => {}), start = Date.now()
    transport.readContext(f.cases[0].label, start)
    await expect(createContextualTest({ supabase: client(transport), actorId: f.cases[0].actorId, input: f.cases[0].input, deadline: start + 20000 })).rejects.toBeInstanceOf(ApiError)
    expect(fetcher).toHaveBeenCalledOnce(); expect(() => transport.verifyEffects(initialRows(), initialRows(), undefined)).toThrow()
    expect(transport.getVerifiedLedger()).toHaveLength(0)
  })
  it('does not promote a valid provisional RPC witness before full committed effects verification', async () => {
    const rows = initialRows(), c = f.cases[0], e = envelope(c)
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(e)))
    const transport = createTestOwnerCreateProofTransport(f, target, project, fetcher, async () => {}), start = Date.now()
    transport.readContext(c.label, start)
    const result = await createContextualTest({ supabase: client(transport), actorId: c.actorId, input: c.input, deadline: start + 20000 })
    expect(transport.getVerifiedLedger()).toHaveLength(0)
    expect(() => transport.verifyEffects(rows, rows, result)).toThrow()
    expect(transport.getVerifiedLedger()).toHaveLength(0)
    expect(() => transport.readContext(f.cases[1].label, Date.now())).toThrow()
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('rejects successful IDs reserved for the finite rollback legacy holder', async () => {
    const c = f.cases[0], e = envelope(c), reserved = testOwnerCreateRequestManifest(f).rollbackReservedIds[0]
    e.test.id = reserved; e.test_id = reserved; e.draft.assessment_id = reserved
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(e)))
    const transport = createTestOwnerCreateProofTransport(f, target, project, fetcher, async () => {}), start = Date.now()
    transport.readContext(c.label, start)
    await createContextualTest({ supabase: client(transport), actorId: c.actorId, input: c.input, deadline: start + 20000 })
    expect(() => validateTestOwnerCreatePendingWitness(transport, c.label, testOwnerCreateRequestManifest(f).rollbackReservedIds)).toThrow()
    expect(transport.getVerifiedLedger()).toHaveLength(0); expect(fetcher).toHaveBeenCalledOnce()
  })
  it.each(['https://remote.supabase.co/rest/v1/rpc/create_test_for_owner_v1', `${target.API_URL}/rest/v1/tests`,
    `${target.API_URL}/storage/v1/object/test-documents/a`, `${target.API_URL}/rest/v1/rpc/create_test_for_owner_v1?extra=1`])('refuses out-of-manifest destination before dispatch: %s', async url => {
    const fetcher = vi.fn<typeof fetch>(), transport = createTestOwnerCreateProofTransport(f, target, project, fetcher, async () => {}), start = Date.now(), c = f.cases[0]
    transport.readContext(c.label, start)
    await expect(transport.fetch(url, { method: 'POST', headers: { authorization: `Bearer ${key}`, apikey: key },
      body: JSON.stringify({ p_actor_id: c.actorId, p_classroom_id: c.classroomId, p_title: c.input.title, p_deadline: new Date(start + 20000).toISOString() }) })).rejects.toThrow(/private details withheld/)
    expect(fetcher).not.toHaveBeenCalled(); expect(transport.counts.rpc).toBe(0)
  })
  it('uses reviewed lost-ack failure semantics without fabricating a post-response guard or retry', async () => {
    const guard = vi.fn(async () => {}), fetcher = vi.fn<typeof fetch>(async () => { throw Error('PRIVATE lost acknowledgement') })
    const transport = createTestOwnerCreateProofTransport(f, target, project, fetcher, guard), start = Date.now(), c = f.cases[0]
    transport.readContext(c.label, start)
    await expect(createContextualTest({ supabase: client(transport), actorId: c.actorId, input: c.input, deadline: start + 20000 })).rejects.toMatchObject({ statusCode: 503 })
    expect(guard).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledOnce()
    expect(transport.getVerifiedLedger()).toHaveLength(0); expect(() => transport.readContext(c.label, Date.now())).toThrow()
    expect(transport.diagnostic()).not.toContain('PRIVATE')
  })
  it('retains one absolute start+20s deadline and rejects renewal before any fetch', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-06T04:10:00Z'))
    const fetcher = vi.fn<typeof fetch>(), transport = createTestOwnerCreateProofTransport(f, target, project, fetcher, async () => {})
    const start = Date.now(); transport.readContext(f.cases[0].label, start); vi.setSystemTime(new Date(start + 1000))
    await expect(createContextualTest({ supabase: client(transport), actorId: f.cases[0].actorId, input: f.cases[0].input })).rejects.toMatchObject({ statusCode: 503 })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('binds fallback title to actual Toronto second/day rollover in the bounded start-to-dispatch window', async () => {
    vi.useFakeTimers(); const start = Date.parse('2026-10-07T03:59:59.900Z'); vi.setSystemTime(new Date(start))
    const c = f.cases.find(c => c.label === 'omitted-title')!, rows = initialRows()
    const fetcher = vi.fn<typeof fetch>(async (_resource, init) => {
      const body = JSON.parse(String(init?.body)); expect(body.p_title).toBe(getFallbackAssessmentTitle(new Date(start + 200)))
      const e = envelope(c, body.p_title); add(rows, e); return new Response(JSON.stringify(e))
    })
    const transport = createTestOwnerCreateProofTransport(f, target, project, fetcher, async () => {}), before = structuredClone(rows)
    transport.readContext(c.label, start); vi.setSystemTime(new Date(start + 200))
    const result = await createContextualTest({ supabase: client(transport), actorId: c.actorId, input: c.input, deadline: start + 20000 })
    transport.verifyEffects(before, rows, result); expect(transport.getVerifiedLedger()).toHaveLength(1)
  })
})
