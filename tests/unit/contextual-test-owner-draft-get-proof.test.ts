import { describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newTestOwnerDraftGetFixture, testOwnerDraftGetSetupSql, testOwnerDraftGetSnapshotSql, TEST_OWNER_DRAFT_GET_CAPS } from '../../scripts/contextual-test-owner-draft-get-proof-fixture'
import { createTestOwnerDraftGetProofTransport, testOwnerDraftGetForcedReceipt, testOwnerDraftGetRequestManifest, validateTestOwnerDraftGetSetupSnapshot, verifyTestOwnerDraftGetEffects, parseTestOwnerDraftGetLifecycleArgs, testOwnerDraftGetUnionManifest, testOwnerDraftGetLifecycleMain, verifyTestOwnerDraftGetPrivilegeRestoration, testOwnerDraftGetSetupDiagnostic } from '../../scripts/check-contextual-test-owner-draft-get-lifecycle'
import { AssignmentListLifecycleError } from '../../scripts/contextual-assignment-list-proof-lifecycle'
import { getContextualTestDraft } from '../../src/lib/server/contextual-test-draft-get'
import { testOwnerDigest, testOwnerGuardSql } from '../../scripts/contextual-test-owner-draft-get-proof-fixture'
import { validateIntegratedGuardResources } from '../../scripts/check-contextual-assignment-learner-integrated-lifecycle'
import { assignmentListExpectedResources } from '../../scripts/contextual-assignment-list-proof-platform'
import type { AssignmentListResource } from '../../scripts/contextual-assignment-list-proof-lifecycle'
import type { Database } from '../../src/types/database'
import { execFileSync } from 'node:child_process'
import * as fixtureModule from '../../scripts/contextual-assignment-list-proof-fixture'
import * as platform from '../../scripts/contextual-assignment-list-proof-platform'
import * as lifecycle from '../../scripts/contextual-assignment-list-proof-lifecycle'
import * as inventoryModule from '../../scripts/contextual-test-owner-list-proof-inventory'
import * as sqlAdapterModule from '../../scripts/contextual-test-draft-get-native-contracts'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn(() => { throw new Error('Native execution forbidden offline') }), execFile: vi.fn(() => { throw new Error('Native execution forbidden offline') }), spawn: vi.fn(() => { throw new Error('Native execution forbidden offline') }) }))

function fixture() {
  const original = newAssignmentListProofFixture(new Date('2026-10-04T12:00:00Z'))
  const f = newTestOwnerDraftGetFixture(original)
  const projectId = `pika_assignment_list_${original.manifest.syntheticTag.slice(-12)}`
  const key = `e30.${Buffer.from(JSON.stringify({ iss: 'supabase-demo', role: 'service_role' })).toString('base64url')}.synthetic`
  const target = { API_URL: 'http://127.0.0.1:54331', DB_URL: 'postgresql://postgres:synthetic@127.0.0.1:54332/postgres', SERVICE_ROLE_KEY: key }
  const guard = vi.fn(async () => {})
  const fetcher = vi.fn<typeof fetch>(async () => new Response('{}', { headers: { 'content-type': 'application/json' } }))
  const transport = createTestOwnerDraftGetProofTransport(f, target, projectId, fetcher, guard)
  return { original, f, projectId, target, guard, fetcher, transport, headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' } }
}

type Rows = Record<string, Array<Record<string, unknown>>>
function sourceRows(f: ReturnType<typeof newTestOwnerDraftGetFixture>): Rows {
  const categories = f.classes.flatMap((c, ci) => [['Attendance', 10, false], ['Term', 65, true], ['Final', 25, false]].map(([name, percentage, is_default], i) => ({
    id: `00000000-0000-4000-8000-${String(ci * 3 + i + 1).padStart(12, '0')}`, classroom_id: c.id, name, percentage, is_default, position: i, default_assessment_weight: 10 })))
  return {
    '__nontarget_fingerprints': [{ table: 'public.users', fingerprint: 'offline-only-complete-source-placeholder' }],
    'public.users': structuredClone(f.actors), 'public.classrooms': f.classes.map((c, i) => ({ id: c.id, teacher_id: c.owner, title: c.title, class_code: c.code,
      archived_at: c.archived ? f.now : null, feature_visibility: { classwork: false }, blueprint_source_revision: f.sideEffects[i].blueprintSourceRevision, updated_at: f.now })),
    'public.tests': structuredClone(f.tests), 'public.gradebook_categories': categories, 'public.test_questions': structuredClone(f.questions),
    'public.assessment_drafts': f.drafts.map(d => ({ ...structuredClone(d), created_at: f.now, updated_at: f.now })),
    'public.test_attempts': [], 'public.test_responses': [], 'public.test_student_availability': [], 'public.classroom_enrollments': structuredClone(f.enrollments),
    'public.classroom_roster': [], 'public.classroom_archive_revisions': f.sideEffects.map(e => ({ classroom_id: e.classroomId, revision: e.archiveRevision, updated_at: f.now })),
    'public.managed_storage_objects': [], 'public.managed_storage_json_references': [], 'public.pal_event_outbox': [], 'private.pal_membership_outbox': [],
    'private.pal_membership_generations': f.enrollments.map((e, i) => ({ generation_id: e.id, state: 'active', scope_digest: testOwnerDigest(`pika-membership-scope-v1:${e.classroom_id}:${e.student_id}`), pal_reference: `pika-membership-v1-${String(i).padStart(32, '0')}` })),
    'private.pal_membership_settings': [{ enabled: false }], 'private.pal_classroom_signal_settings': [{ enabled: false }],
  }
}
function sourceResponse(f: ReturnType<typeof newTestOwnerDraftGetFixture>, rows: Rows, actorId: string, testId: string) {
  const t = f.tests.find(t => t.id === testId)!, c = f.classes.find(c => c.id === t.classroom_id)!
  return { version: 1, actor_id: actorId, classroom: { id: c.id, teacher_id: c.owner, archived_at: c.archived ? f.now : null },
    test: Object.fromEntries(['id', 'classroom_id', 'title', 'show_results', 'status', 'blueprint_archived_at', 'questions_locked_at'].map(k => [k, t[k as keyof typeof t]])),
    draft: rows['public.assessment_drafts'].find(d => d.assessment_id === testId) ?? null, questions: f.questions.filter(q => q.test_id === testId),
    question_count: f.questions.filter(q => q.test_id === testId).length, source_sha256: testOwnerDigest(`offline-only:${actorId}:${testId}`) }
}

describe('finite owner draft GET offline authority', () => {
  it('derives setup revisions without counting a lock-only Test update as blueprint content', () => {
    const { f } = fixture(), contentWrites = 10 + f.questions.length + f.drafts.length
    expect(f.sideEffects[0]).toEqual({ classroomId: f.classes[0].id,
      blueprintSourceRevision: 1 + contentWrites, archiveRevision: 1 + 3 + 3 + 2 * contentWrites + 1 })
  })
  it('reports only closed setup stages and failure kinds, never private diagnostics', () => {
    const error = new AssignmentListLifecycleError({ stage: 'fixture', error: new Error('Private platform command failed') }, [])
    expect(testOwnerDraftGetSetupDiagnostic('app-write', error)).toBe('DIAG test-owner-draft-get setup=app-write lifecycle=fixture cleanup=none failure=platform-command.\n')
    expect(testOwnerDraftGetSetupDiagnostic('private-row-identity', new Error('private-key-or-SQL'))).toBe('DIAG test-owner-draft-get setup=unknown lifecycle=unknown cleanup=unknown failure=unknown.\n')
  })
  it('reports inherited lifecycle and cleanup stages without private errors or identities', () => {
    const error = new AssignmentListLifecycleError({ stage: 'status', error: new Error('Private platform command failed') },
      [{ stage: 'capture', error: new Error('private-credential-or-row') }])
    expect(testOwnerDraftGetSetupDiagnostic('pending', error)).toBe('DIAG test-owner-draft-get setup=pending lifecycle=status cleanup=present failure=platform-command.\n')
    const unsafe = new AssignmentListLifecycleError({ stage: 'private-identity-or-SQL', error: new Error('private-credential') }, [])
    expect(testOwnerDraftGetSetupDiagnostic('pending', unsafe)).toBe('DIAG test-owner-draft-get setup=pending lifecycle=unknown cleanup=none failure=unknown.\n')
  })
  it.each(['canonical-before', 'preflight', 'pre-start', 'status', 'fixture'])('reports the closed inherited phase %s', stage => {
    const error = new AssignmentListLifecycleError({ stage, error: new Error('Private platform command failed') }, [])
    expect(testOwnerDraftGetSetupDiagnostic('pending', error)).toBe(`DIAG test-owner-draft-get setup=pending lifecycle=${stage} cleanup=none failure=platform-command.\n`)
  })
  it('hash binds the complete disjoint app+SQL fixture union and rollback bulk inventory', () => {
    const x = fixture(), union = testOwnerDraftGetUnionManifest(x.original, x.f, '7570a9d60591183f0699001f47a6528045a392ee', process.cwd())
    expect(union.inventory).toEqual({ actors: 7, classes: 5, tests: 16, questions: 1009, initialDrafts: 10, enrollments: 5,
      triggerCategories: 15, archiveRevisionRows: 5, activeGenerations: 5, sdkCases: 15, sdkCreates: 3, sdkRepairs: 1, privilegeDriftProbes: 1, sqlBaseAllocatedIds: 15, sqlRollbackBulkIds: 10001 })
    expect(union.sql.fixture.allowedFixtureIds).toHaveLength(10016)
    expect(union.sql.fixture.allowedFixtureIds.every(id => !x.f.allocatedIds.includes(id) && !x.original.allocatedIds.includes(id))).toBe(true)
    expect(union.sql.setup).toContain('commit;'); expect(Object.isFrozen(union.inventory)).toBe(true)
  })
  it.each(['after-fixture', 'before-capture'])('rejects optional generation in forced mode %s', mode => {
    expect(() => parseTestOwnerDraftGetLifecycleArgs(['--reviewed-head', 'a'.repeat(40), '--mode', mode, '--generate-types'])).toThrow()
  })
  it('allows optional generation only at exact normal argument shape', () => {
    expect(parseTestOwnerDraftGetLifecycleArgs(['--reviewed-head', 'a'.repeat(40), '--mode', 'normal', '--generate-types']).generateTypes).toBe(true)
    expect(parseTestOwnerDraftGetLifecycleArgs(['--reviewed-head', 'a'.repeat(40), '--mode', 'normal']).generateTypes).toBe(false)
    expect(() => parseTestOwnerDraftGetLifecycleArgs(['--reviewed-head', 'a'.repeat(40), '--mode', 'normal', '--generate-types', '--force'])).toThrow()
    expect(() => parseTestOwnerDraftGetLifecycleArgs(['--reviewed-head', 'a'.repeat(40), '--mode', 'normal', '--generate-other'])).toThrow()
  })
  it('freezes disjoint UUID identities and exact finite ceilings', () => {
    const { original, f } = fixture()
    expect(f.actors).toHaveLength(4); expect(f.classes).toHaveLength(3); expect(f.tests).toHaveLength(12)
    expect(f.questions).toHaveLength(1008); expect(f.drafts).toHaveLength(7); expect(f.cases).toHaveLength(15)
    expect(new Set(f.allocatedIds).size).toBe(f.allocatedIds.length)
    expect(f.allocatedIds.every(id => !original.allocatedIds.includes(id))).toBe(true)
    expect(Object.isFrozen(f.cases[0])).toBe(true)
    expect(TEST_OWNER_DRAFT_GET_CAPS).toMatchObject({ sqlBytes: 524288, networkRequests: 30, rpcRequests: 30, storageRequests: 0, requestMs: 20000, contentBytes: 2097152, responseBytes: 8388608, exchangeBytes: 67108864 })
  })
  it('hash-binds separate finite SQL without guard weakening or arbitrary SQL', () => {
    const { f, projectId } = fixture(); const sql = testOwnerDraftGetSetupSql(f, projectId)
    expect(Buffer.byteLength(sql)).toBeLessThanOrEqual(TEST_OWNER_DRAFT_GET_CAPS.sqlBytes)
    expect(sql).not.toMatch(/disable trigger|truncate|set_config|update private\.|insert into storage|insert into public\.managed_storage/i)
    expect(sql).toContain('Test draft GET natural revision effects differ')
    const snapshot = testOwnerDraftGetSnapshotSql(f)
    for (const table of ['test_questions', 'assessment_drafts', 'classroom_archive_revisions', 'pal_membership_generations', 'managed_storage_objects', 'test_attempts', 'test_responses', 'test_student_availability']) expect(snapshot).toContain(table)
    const manifest = testOwnerDraftGetRequestManifest(f)
    expect(Object.isFrozen(manifest)).toBe(true)
    expect(manifest.paths).toEqual(['/rest/v1/rpc/snapshot_test_draft_for_owner_v1', '/rest/v1/rpc/finish_test_draft_get_for_owner_v1'])
  })
  it('accepts the installed SDK snapshot with one fresh guard', async () => {
    const x = fixture(); const c = x.f.cases[0]; x.transport.readContext(c.testId, c.actorId)
    const client = createClient(x.target.API_URL, x.target.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: x.transport.fetch } })
    await client.rpc('snapshot_test_draft_for_owner_v1', { p_actor_id: c.actorId, p_test_id: c.testId, p_deadline: new Date(Date.now() + 19000).toISOString() })
    expect(x.guard).toHaveBeenCalledOnce(); expect(x.fetcher).toHaveBeenCalledOnce()
    expect(x.fetcher.mock.calls[0][1]?.redirect).toBe('error')
  })
  it.each(['https://example.invalid/rest/v1/rpc/snapshot_test_draft_for_owner_v1', 'http://127.0.0.1:54321/rest/v1/rpc/snapshot_test_draft_for_owner_v1', 'http://127.0.0.1:54331/rest/v1/classrooms', 'http://127.0.0.1:54331/auth/v1/user', 'http://127.0.0.1:54331/storage/v1/bucket', 'http://127.0.0.1:54331/rest/v1/rpc/unknown'])('rejects origin/path before guard: %s', async url => {
    const x = fixture(); await expect(x.transport.fetch(url, { method: 'POST', headers: x.headers, body: '{}' })).rejects.toThrow('private details withheld')
    expect(x.guard).not.toHaveBeenCalled(); expect(x.fetcher).not.toHaveBeenCalled()
  })
  it.each(['after-fixture', 'before-capture'])('accepts only complete exact forced clean receipt: %s', mode => {
    const error = new AssignmentListLifecycleError({ stage: mode, error: new Error('Forced isolated lifecycle failure') }, [])
    const receipt = testOwnerDraftGetForcedReceipt(mode, error, true)
    expect(receipt?.exitCode).toBe(1); expect(`${receipt?.stdout}${receipt?.stderr}`.trim().split('\n')).toHaveLength(2)
    expect(testOwnerDraftGetForcedReceipt(mode, error, false)).toBeNull()
    expect(testOwnerDraftGetForcedReceipt(mode, new AssignmentListLifecycleError(error.primary, [{ stage: 'cleanup', error: new Error('PRIVATE') }]), true)).toBeNull()
    expect(testOwnerDraftGetForcedReceipt(mode, new AssignmentListLifecycleError({ stage: 'fixture', error: new Error('Forced isolated lifecycle failure') }, []), true)).toBeNull()
  })
})

describe('complete finite mocked SDK matrix', () => {
  it('observes raw PostgREST privilege failure without substituting the response or dispatching a final RPC', async () => {
    const x = fixture(), rows = sourceRows(x.f), before = structuredClone(rows)
    const c = x.f.cases.find(c => c.status === 200 && c.operation === 'inspect')!
    x.fetcher.mockResolvedValue(new Response(JSON.stringify({ code: '42501', message: 'private privilege drift', details: null, hint: null }), { status: 403 }))
    x.transport.readContext(c.testId, c.actorId, rows)
    const client = createClient<Database>(x.target.API_URL, x.target.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: x.transport.fetch } })
    await expect(getContextualTestDraft({ supabase: client, actorId: c.actorId, testId: c.testId })).rejects.toMatchObject({ statusCode: 503 })
    expect(x.transport.evidence.rawPrivilegeFailures).toBe(1)
    expect(x.transport.counts.rpc).toBe(1); expect(x.guard).toHaveBeenCalledOnce(); expect(x.fetcher).toHaveBeenCalledOnce()
    expect(rows).toEqual(before)
  })
  it.each(Array.from({ length: 15 }, (_, i) => i))('runs actual helper through the installed SDK with no native call, case %s', async i => {
    const x = fixture(), rows = sourceRows(x.f), before = structuredClone(rows), c = x.f.cases[i]
    const fetcher = vi.fn<typeof fetch>(async (resource, init) => {
      const body = JSON.parse(String(init?.body)), url = new URL(String(resource))
      const test = x.f.tests.find(t => t.id === c.testId)!, classroom = x.f.classes.find(r => r.id === c.classroomId)!
      if (classroom.owner !== c.actorId || classroom.archived) return new Response(JSON.stringify({ code: 'PT403', message: 'Forbidden', details: null, hint: null }), { status: 403 })
      if (url.pathname.includes('/snapshot_')) return new Response(JSON.stringify(sourceResponse(x.f, rows, c.actorId, c.testId)))
      const prior = rows['public.assessment_drafts'].find(d => d.assessment_id === c.testId)
      const now = new Date().toISOString()
      const draft = c.operation === 'create' ? { id: `10000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, assessment_type: 'test', assessment_id: c.testId,
        classroom_id: c.classroomId, content: body.p_content, version: 1, created_by: c.actorId, updated_by: c.actorId, created_at: now, updated_at: now }
        : { ...prior!, content: body.p_content, ...(c.operation === 'repair' ? { version: Number(prior!.version) + 1, updated_by: c.actorId, updated_at: now } : {}) }
      if (c.operation !== 'inspect') {
        if (prior) rows['public.assessment_drafts'].splice(rows['public.assessment_drafts'].indexOf(prior), 1, draft); else rows['public.assessment_drafts'].push(draft)
        const cr = rows['public.classrooms'].find(r => r.id === c.classroomId)!, ar = rows['public.classroom_archive_revisions'].find(r => r.classroom_id === c.classroomId)!
        cr.blueprint_source_revision = Number(cr.blueprint_source_revision) + 1; cr.updated_at = now; ar.revision = Number(ar.revision) + 2; ar.updated_at = now
      }
      return new Response(JSON.stringify({ version: 1, actor_id: c.actorId, classroom_id: c.classroomId, test_id: c.testId, operation: c.operation, draft, editingPolicy: { structureLocked: test.questions_locked_at !== null } }))
    })
    const transport = createTestOwnerDraftGetProofTransport(x.f, x.target, x.projectId, fetcher, x.guard)
    transport.readContext(c.testId, c.actorId, rows)
    const client = createClient<Database>(x.target.API_URL, x.target.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport.fetch } })
    const read = getContextualTestDraft({ supabase: client, actorId: c.actorId, testId: c.testId })
    if (c.status === 403) await expect(read).rejects.toMatchObject({ statusCode: 403 })
    else {
      const response = await read; verifyTestOwnerDraftGetEffects(x.f, c, before, rows, response, x.original.allocatedIds)
      if (c.label === 'valid-projection') {
        expect(response.draft.content.questions.map(q => q.id)).toEqual([x.f.questions.find(q => q.test_id === c.testId)!.source_artifact_id, x.f.drafts.find(d => d.assessment_id === c.testId)!.content.questions![1].id])
        expect(response.draft.content.source_markdown).toBe('Synthetic source\n')
      }
      if (['active-invalid', 'closed-invalid'].includes(c.label)) expect(response.draft.content.title).toBe(x.f.tests[i].title)
      if (c.label === 'complete-1001-source') {
        expect(transport.evidence.complete1001Source).toBe(1)
        expect(response.draft.content.questions).toHaveLength(0); expect(rows).toEqual(before)
      }
    }
    expect(transport.counts.rpc).toBe(c.status === 200 ? 2 : 1)
    expect(x.guard).toHaveBeenCalledTimes(transport.counts.rpc); expect(transport.counts.storage).toBe(0)
    if (c.status !== 200 || c.operation === 'inspect') expect(rows).toEqual(before)
  })
  it.each(['actor', 'test', 'class', 'hash', 'operation', 'content', 'deadline', 'extra-key'])('rejects forged final %s before guard or dispatch', async kind => {
    const x = fixture(), c = x.f.cases[0], rows = sourceRows(x.f), source = sourceResponse(x.f, rows, c.actorId, c.testId)
    x.fetcher.mockResolvedValue(new Response(JSON.stringify(source))); x.transport.readContext(c.testId, c.actorId, rows)
    const deadline = new Date(Date.now() + 19000).toISOString()
    await x.transport.fetch('http://127.0.0.1:54331/rest/v1/rpc/snapshot_test_draft_for_owner_v1', { method: 'POST', headers: x.headers, body: JSON.stringify({ p_actor_id: c.actorId, p_test_id: c.testId, p_deadline: deadline }) })
    const body: Record<string, unknown> = { p_actor_id: c.actorId, p_test_id: c.testId, p_classroom_id: c.classroomId, p_expected_source_sha256: source.source_sha256, p_operation: 'create', p_content: {}, p_deadline: deadline }
    const keys: Record<string, string> = { actor: 'p_actor_id', test: 'p_test_id', class: 'p_classroom_id', hash: 'p_expected_source_sha256', operation: 'p_operation', content: 'p_content', deadline: 'p_deadline', 'extra-key': 'extra' }
    body[keys[kind]] = 'forged'
    await expect(x.transport.fetch('http://127.0.0.1:54331/rest/v1/rpc/finish_test_draft_get_for_owner_v1', { method: 'POST', headers: x.headers, body: JSON.stringify(body) })).rejects.toThrow('private details withheld')
    expect(x.guard).toHaveBeenCalledOnce(); expect(x.fetcher).toHaveBeenCalledOnce()
  })
  it.each(['extra-key', 'actor', 'test', 'deadline', 'method', 'header', 'query', 'aborted'])('rejects malformed first request %s without a guard', async kind => {
    const x = fixture(), c = x.f.cases[0]; x.transport.readContext(c.testId, c.actorId)
    const body: Record<string, unknown> = { p_actor_id: c.actorId, p_test_id: c.testId, p_deadline: new Date(Date.now() + 19000).toISOString() }
    if (kind === 'extra-key') body.unexpected = true
    if (kind === 'actor') body.p_actor_id = x.f.actors[2].id
    if (kind === 'test') body.p_test_id = x.f.tests[1].id
    if (kind === 'deadline') body.p_deadline = new Date(Date.now() + 60000).toISOString()
    const init: RequestInit = { method: kind === 'method' ? 'GET' : 'POST', headers: { ...x.headers, ...(kind === 'header' ? { 'x-private': 'forged' } : {}) }, body: JSON.stringify(body) }
    if (kind === 'aborted') init.signal = AbortSignal.abort()
    await expect(x.transport.fetch(`http://127.0.0.1:54331/rest/v1/rpc/snapshot_test_draft_for_owner_v1${kind === 'query' ? '?filter=forged' : ''}`, init)).rejects.toThrow('private details withheld')
    expect(x.guard).not.toHaveBeenCalled(); expect(x.fetcher).not.toHaveBeenCalled()
  })
  it('never dispatches after guard failure or deadline consumption', async () => {
    const x = fixture(), c = x.f.cases[0]; x.transport.readContext(c.testId, c.actorId)
    x.guard.mockRejectedValue(new Error('PRIVATE resource/guard failure'))
    await expect(x.transport.fetch('http://127.0.0.1:54331/rest/v1/rpc/snapshot_test_draft_for_owner_v1', { method: 'POST', headers: x.headers,
      body: JSON.stringify({ p_actor_id: c.actorId, p_test_id: c.testId, p_deadline: new Date(Date.now() + 19000).toISOString() }) })).rejects.toThrow('private details withheld')
    expect(x.fetcher).not.toHaveBeenCalled()
    x.transport.readContext(c.testId, c.actorId)
    vi.useFakeTimers(); x.guard.mockImplementation(async () => { vi.advanceTimersByTime(20001) })
    try { await expect(x.transport.fetch('http://127.0.0.1:54331/rest/v1/rpc/snapshot_test_draft_for_owner_v1', { method: 'POST', headers: x.headers,
      body: JSON.stringify({ p_actor_id: c.actorId, p_test_id: c.testId, p_deadline: new Date(Date.now() + 19000).toISOString() }) })).rejects.toThrow('private details withheld') }
    finally { vi.useRealTimers() }
    expect(x.fetcher).not.toHaveBeenCalled()
  })
  it('enforces the finite global RPC ceiling before the next guard or dispatch', async () => {
    const x = fixture(), c = x.f.cases[0], rows = sourceRows(x.f)
    x.fetcher.mockImplementation(async () => new Response(JSON.stringify(sourceResponse(x.f, rows, c.actorId, c.testId))))
    for (let i = 0; i < TEST_OWNER_DRAFT_GET_CAPS.rpcRequests; i++) {
      x.transport.readContext(c.testId, c.actorId, rows)
      await x.transport.fetch(`${x.target.API_URL}/rest/v1/rpc/snapshot_test_draft_for_owner_v1`, { method: 'POST', headers: x.headers,
        body: JSON.stringify({ p_actor_id: c.actorId, p_test_id: c.testId, p_deadline: new Date(Date.now() + 19000).toISOString() }) })
    }
    x.transport.readContext(c.testId, c.actorId, rows)
    await expect(x.transport.fetch(`${x.target.API_URL}/rest/v1/rpc/snapshot_test_draft_for_owner_v1`, { method: 'POST', headers: x.headers,
      body: JSON.stringify({ p_actor_id: c.actorId, p_test_id: c.testId, p_deadline: new Date(Date.now() + 19000).toISOString() }) })).rejects.toThrow('private details withheld')
    expect(x.guard).toHaveBeenCalledTimes(30); expect(x.fetcher).toHaveBeenCalledTimes(30)
  })
  it.each(['redirect-status', 'redirect-header', 'response-overflow'])('rejects response boundary %s', async kind => {
    const x = fixture(), c = x.f.cases[0]; x.transport.readContext(c.testId, c.actorId)
    if (kind === 'redirect-status') x.fetcher.mockResolvedValue(new Response('{}', { status: 302 }))
    if (kind === 'redirect-header') x.fetcher.mockResolvedValue(new Response('{}', { headers: { location: 'https://example.invalid/PRIVATE' } }))
    if (kind === 'response-overflow') x.fetcher.mockImplementation(async () => new Response(new Uint8Array(TEST_OWNER_DRAFT_GET_CAPS.responseBytes + 1)))
    await expect(x.transport.fetch(`${x.target.API_URL}/rest/v1/rpc/snapshot_test_draft_for_owner_v1`, { method: 'POST', headers: x.headers,
      body: JSON.stringify({ p_actor_id: c.actorId, p_test_id: c.testId, p_deadline: new Date(Date.now() + 19000).toISOString() }) })).rejects.toThrow('private details withheld')
    expect(x.guard).toHaveBeenCalledOnce(); expect(x.fetcher).toHaveBeenCalledOnce()
  })
  it.each(['unexpected-table', 'missing-draft', 'extra-work', 'revision', 'blueprint', 'membership-state', 'settings', 'question', 'category', 'timestamp'])('rejects exact setup inventory drift %s', kind => {
    const { f } = fixture(), rows = sourceRows(f); expect(() => validateTestOwnerDraftGetSetupSnapshot(f, rows)).not.toThrow()
    if (kind === 'unexpected-table') rows['public.foreign'] = []
    if (kind === 'missing-draft') rows['public.assessment_drafts'].pop()
    if (kind === 'extra-work') rows['public.test_attempts'].push({ id: 'forged' })
    if (kind === 'revision') rows['public.classroom_archive_revisions'][0].revision = 0
    if (kind === 'blueprint') rows['public.classrooms'][0].blueprint_source_revision = 0
    if (kind === 'membership-state') rows['private.pal_membership_generations'][0].state = 'removed'
    if (kind === 'settings') rows['private.pal_membership_settings'][0].enabled = true
    if (kind === 'question') rows['public.test_questions'][0].question_text = 'forged'
    if (kind === 'category') rows['public.gradebook_categories'][0].classroom_id = f.actors[0].id
    if (kind === 'timestamp') rows['public.assessment_drafts'][0].updated_at = 'forged'
    expect(() => validateTestOwnerDraftGetSetupSnapshot(f, rows)).toThrow()
  })
  it.each(['guard_pal_membership_evidence', 'guard_pal_signal_activation', 'pal_membership_settings', 'pal_classroom_signal_settings', 'student_provider_cleanup_settings', 'removed_student_academic_settings', 'classroom_creation_entitlement_settings', 'test_ai_grading_runs', 'test_ai_grading_run_items', 'vault.secrets', 'cron.job'])('retains sealed private guard/control source %s', name => {
    const { projectId } = fixture(); const sql = testOwnerGuardSql(projectId)
    expect(sql).toContain(name); expect(sql).not.toMatch(/update |alter |disable trigger|set_config/i)
  })
  it.each(['draft-id', 'draft-version', 'actor-stamp', 'created-stamp', 'extra-draft', 'question', 'test', 'other-class', 'blueprint', 'archive', 'private-generation', 'global-fingerprint'])('rejects write effect drift %s', kind => {
    const { f } = fixture(), c = f.cases[0], before = sourceRows(f), after = structuredClone(before)
    const now = new Date(Date.parse(f.now) + 1000).toISOString()
    const draft: Record<string, unknown> = { id: '10000000-0000-4000-8000-000000000001', assessment_type: 'test', assessment_id: c.testId, classroom_id: c.classroomId,
      content: { synthetic: true }, version: 1, created_by: c.actorId, updated_by: c.actorId, created_at: now, updated_at: now }
    after['public.assessment_drafts'].push(draft)
    after['public.classrooms'][0].blueprint_source_revision = Number(after['public.classrooms'][0].blueprint_source_revision) + 1; after['public.classrooms'][0].updated_at = now
    after['public.classroom_archive_revisions'][0].revision = Number(after['public.classroom_archive_revisions'][0].revision) + 2; after['public.classroom_archive_revisions'][0].updated_at = now
    const response = { draft, editingPolicy: { structureLocked: false } }
    expect(() => verifyTestOwnerDraftGetEffects(f, c, before, after, response)).not.toThrow()
    if (kind === 'draft-id') draft.id = f.actors[0].id
    if (kind === 'draft-version') draft.version = 2
    if (kind === 'actor-stamp') draft.updated_by = f.actors[2].id
    if (kind === 'created-stamp') draft.created_at = f.now
    if (kind === 'extra-draft') after['public.assessment_drafts'].push({ ...draft, id: 'extra' })
    if (kind === 'question') after['public.test_questions'][0].question_text = 'forged'
    if (kind === 'test') after['public.tests'][0].title = 'forged'
    if (kind === 'other-class') after['public.classrooms'][1].title = 'forged'
    if (kind === 'blueprint') after['public.classrooms'][0].blueprint_source_revision = 999
    if (kind === 'archive') after['public.classroom_archive_revisions'][0].revision = 999
    if (kind === 'private-generation') after['private.pal_membership_generations'][0].state = 'removed'
    if (kind === 'global-fingerprint') after.__nontarget_fingerprints[0].fingerprint = 'forged'
    expect(() => verifyTestOwnerDraftGetEffects(f, c, before, after, response)).toThrow()
  })
  it.each(['missing', 'extra', 'foreign-attachment', 'labels', 'ports', 'identity', 'creation', 'attachment-drift'])('rejects full resource closure drift %s offline', kind => {
    const { projectId } = fixture()
    const graph: AssignmentListResource[] = assignmentListExpectedResources(projectId).map((r, i) => ({ ...r, id: `synthetic-resource-${i}`, createdAt: '2026-10-05', labels: { 'com.supabase.cli.project': projectId, 'com.docker.compose.project': projectId }, attachedIds: [], ports: r.name === `supabase_db_${projectId}` ? [54332] : r.name === `supabase_kong_${projectId}` ? [54331] : [] }))
    const db = graph.find(r => r.name === `supabase_db_${projectId}`)!, baseline = validateIntegratedGuardResources(graph, projectId, db.id), changed = structuredClone(graph)
    if (kind === 'missing') changed.pop()
    if (kind === 'extra') changed.push({ ...changed[0], id: 'extra', name: 'foreign' })
    if (kind === 'foreign-attachment') changed.push({ ...changed[0], id: 'foreign', labels: {}, attachedIds: [db.id] })
    if (kind === 'labels') changed[0].labels['com.docker.compose.project'] = 'foreign'
    if (kind === 'ports') changed[0].ports = [54322]
    if (kind === 'identity') changed[0].id = 'changed'
    if (kind === 'creation') changed[0].createdAt = 'changed'
    if (kind === 'attachment-drift') changed[0].attachedIds.push('foreign')
    expect(() => validateIntegratedGuardResources(changed, projectId, db.id, baseline)).toThrow()
  })
})

describe('sealed lifecycle offline composition', () => {
  it.each([false, true])('compares application rows after failed SDK callback and grant restoration, including drift=%s', async drift => {
    const x = fixture(), before = sourceRows(x.f), after = structuredClone(before), events: string[] = []
    const sdkError = new Error('synthetic SDK failure')
    const probe = async () => {
      events.push('revoke')
      try {
        events.push('SDK-failure')
        if (drift) after['public.tests'][0].title = 'synthetic drift'
        throw sdkError
      } finally { events.push('grant-restored'); events.push('SQL-fixture-verified') }
    }
    const snapshot = vi.fn(async () => { events.push('app-snapshot'); return after })
    const running = verifyTestOwnerDraftGetPrivilegeRestoration(before, snapshot, probe)
    if (drift) await expect(running).rejects.toThrow('Application privilege-probe rows changed')
    else await expect(running).rejects.toBe(sdkError)
    expect(snapshot).toHaveBeenCalledOnce()
    expect(events).toEqual(['revoke', 'SDK-failure', 'grant-restored', 'SQL-fixture-verified', 'app-snapshot'])
  })
  it.each(['after-fixture', 'before-capture', 'partial-sql-setup', 'bad-resource', 'bad-private-guard', 'bad-snapshot'] as const)('finishes both exact fixture setups before original forced checkpoint: %s', async scenario => {
    const x = fixture(), head = 'a'.repeat(40), mode = scenario === 'before-capture' ? 'before-capture' : 'after-fixture'
    const resources: AssignmentListResource[] = assignmentListExpectedResources(x.projectId).map((r, i) => ({ ...r, id: String(i + 1).padStart(64, '0'), createdAt: 'synthetic',
      labels: { 'com.supabase.cli.project': x.projectId, 'com.docker.compose.project': x.projectId }, attachedIds: [], ports: r.name === `supabase_db_${x.projectId}` ? [54332] : [] }))
    const db = resources.find(r => r.name === `supabase_db_${x.projectId}`)!, session = { projectId: x.projectId, containerId: db.id, dbPort: 54332 as const, applicationName: `${x.projectId}_fixture` }
    const events: string[] = [], native = { executeSql: vi.fn(async () => { events.push('sql') }), command: vi.fn(async () => x.target), runCase: vi.fn(),
      canonicalSnapshot: vi.fn(), teardown: vi.fn(), inventory: vi.fn(), prepare: vi.fn(), verifyEphemeral: vi.fn(), runRevocation: vi.fn(), verifyRestoration: vi.fn(), removeWorkdir: vi.fn() }
    const exit = process.exitCode, pal = process.env.PAL_ENABLED
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true), err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    vi.spyOn(fixtureModule, 'newAssignmentListProofFixture').mockReturnValue(x.original)
    vi.spyOn(platform, 'createAssignmentListNativeAdapters').mockReturnValue(native as unknown as ReturnType<typeof platform.createAssignmentListNativeAdapters>)
    vi.spyOn(inventoryModule, 'testOwnerListDockerInventory').mockResolvedValue(scenario === 'bad-resource' ? resources.slice(1) : resources)
    const sqlManifest = sqlAdapterModule.buildDraftGetNativeContractsManifest(x.original, head, process.cwd())
    const sqlSetup = vi.fn(async () => { events.push('sql-fixture'); if (scenario === 'partial-sql-setup') throw new Error('PRIVATE cause')
      return { fixtureSha256: testOwnerDigest(JSON.stringify(sqlManifest.fixture)), setupSha256: testOwnerDigest(sqlManifest.setup) } })
    const sqlRun = vi.fn()
    const sqlPrivilegeProbe = vi.fn()
    vi.spyOn(sqlAdapterModule, 'createDraftGetNativeContracts').mockReturnValue({ manifest: sqlManifest, setup: sqlSetup, run: sqlRun, probeSnapshotPrivilegeDrift: sqlPrivilegeProbe })
    vi.mocked(execFileSync).mockImplementation((file, args, options) => {
      if (file === 'git') return args?.[0] === 'status' ? '' : args?.[1] === 'HEAD' ? head : process.cwd()
      const sql = (options as { input: string }).input
      if (sql === testOwnerGuardSql(x.projectId)) { if (scenario === 'bad-private-guard') throw new Error('PRIVATE guard'); return 'ok\n' }
      expect(sql).toBe(testOwnerDraftGetSnapshotSql(x.f)); const rows = sourceRows(x.f)
      if (scenario === 'bad-snapshot') rows['public.test_questions'].pop()
      return JSON.stringify(rows)
    })
    vi.spyOn(lifecycle, 'runAssignmentListEphemeralLifecycle').mockImplementation(async (input, adapters) => {
      expect(input.fixture).toBe(x.original); expect(input.fixture.manifest.cases).toHaveLength(9); expect(input.restorationPolicies).toHaveLength(14)
      for (const name of ['canonicalSnapshot', 'teardown', 'inventory', 'prepare', 'verifyEphemeral', 'runRevocation', 'verifyRestoration', 'removeWorkdir'] as const) expect(adapters[name]).toBe(native[name])
      await adapters.command({ args: ['status'], workdir: input.workdir, timeoutMs: 1 })
      await adapters.executeSql({ ...session, sql: fixtureModule.assignmentListFixtureSetupSql(x.original, x.projectId) })
      expect(native.executeSql).toHaveBeenCalledTimes(2)
      expect(native.executeSql.mock.calls[1]).toEqual([{ ...session, sql: testOwnerDraftGetSetupSql(x.f, x.projectId) }])
      expect(sqlSetup).toHaveBeenCalledOnce(); events.push('original-checkpoint')
      throw new AssignmentListLifecycleError({ stage: mode, error: new Error('Forced isolated lifecycle failure') }, [])
    })
    try {
      const running = testOwnerDraftGetLifecycleMain(['--reviewed-head', head, '--mode', mode])
      if (scenario === 'after-fixture' || scenario === 'before-capture') {
        await running; expect(events).toEqual(['sql', 'sql', 'sql-fixture', 'original-checkpoint'])
        expect(process.exitCode).toBe(1); expect(sqlRun).not.toHaveBeenCalled(); expect(sqlPrivilegeProbe).not.toHaveBeenCalled(); expect(native.runCase).not.toHaveBeenCalled()
        expect(out.mock.calls.flat().join('')).toBe('PASS isolated test-owner-draft-get exact teardown and unchanged canonical baseline.\n')
        expect(err.mock.calls.flat().join('')).toBe(`FAIL forced isolated test-owner-draft-get lifecycle: ${mode}.\n`)
      } else {
        await expect(running).rejects.toThrow('private details withheld'); expect(out).not.toHaveBeenCalled(); expect(events).not.toContain('original-checkpoint')
        expect(err.mock.calls.flat().join('')).not.toContain('PRIVATE')
      }
    } finally { vi.restoreAllMocks(); process.exitCode = exit; if (pal === undefined) delete process.env.PAL_ENABLED; else process.env.PAL_ENABLED = pal }
  })
})
