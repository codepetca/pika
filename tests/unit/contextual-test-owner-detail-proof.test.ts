import { describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { AssignmentListLifecycleError } from '../../scripts/contextual-assignment-list-proof-lifecycle'
import { newTestOwnerDetailFixture, TEST_OWNER_PROOF_CAPS, testOwnerSetupSql, testOwnerBindDocumentsSql,
  testOwnerGuardSql, testOwnerObjectPath, testOwnerReservationArgs, validateTestOwnerObjectReceipt, testOwnerDigest } from '../../scripts/contextual-test-owner-detail-proof-fixture'
import { createTestOwnerProofTransport, testOwnerForcedReceipt, testOwnerFailureDiagnostic, TEST_OWNER_PROJECTIONS } from '../../scripts/check-contextual-test-owner-detail-lifecycle'
import { readContextualTestDetail } from '../../src/lib/server/contextual-test-detail-read'
import type { Database } from '../../src/types/database'
import { execFileSync } from 'node:child_process'
import * as platform from '../../scripts/contextual-assignment-list-proof-platform'
import * as lifecycle from '../../scripts/contextual-assignment-list-proof-lifecycle'
import * as originalFixture from '../../scripts/contextual-assignment-list-proof-fixture'
import { testOwnerDetailLifecycleMain } from '../../scripts/check-contextual-test-owner-detail-lifecycle'
import { INTEGRATED_PNG } from '../../scripts/contextual-assignment-learner-integrated-proof-fixture'

vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal<typeof import('node:child_process')>(), execFileSync: vi.fn() }))

function fixture() {
  const original = newAssignmentListProofFixture(new Date('2026-10-04T12:00:00Z'))
  const f = newTestOwnerDetailFixture(original)
  const projectId = `pika_assignment_list_${original.manifest.syntheticTag.slice(-12)}`
  const key = `e30.${Buffer.from(JSON.stringify({ iss: 'supabase-demo', role: 'service_role' })).toString('base64url')}.synthetic`
  const target = { API_URL: 'http://127.0.0.1:54331', DB_URL: 'postgresql://postgres:synthetic@127.0.0.1:54332/postgres', SERVICE_ROLE_KEY: key }
  const guard = vi.fn(async () => {})
  const fetcher = vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 }))
  const transport = createTestOwnerProofTransport(f, target, projectId, fetcher, guard)
  return { original, f, projectId, target, guard, fetcher, transport, headers: { apikey: key, authorization: `Bearer ${key}` } }
}

/** Offline source responses, not a database/HTTP proof. The installed SDK must
 * still build every real application query and decode Storage.info itself. */
function sourceFetch(f: ReturnType<typeof newTestOwnerDetailFixture>): typeof fetch {
  return async resource => {
    const url = new URL(String(resource)); const reply = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
    if (url.pathname.includes('/object/info/')) return reply({ name: url.pathname.split('/test-documents/')[1], bucket_id: 'test-documents', content_type: 'image/png', size: 68 })
    const test = f.tests.find(test => `eq.${test.id}` === url.searchParams.get('id'))!
    const control = { id: test.id, classroom_id: test.classroomId, classrooms: { id: test.classroomId, teacher_id: test.owner, archived_at: null } }
    const select = url.searchParams.get('select')
    if (select === TEST_OWNER_PROJECTIONS.control) return reply([control])
    const row = { ...control, title: test.title, status: test.status, show_results: false,
      documents: f.objects.filter(object => object.testId === test.id).map(object => ({ id: object.documentId, title: 'Synthetic PNG', source: 'upload', storage_bucket: 'test-documents', storage_path: testOwnerObjectPath(f, object), managed_object_id: object.id })),
      position: 0, points_possible: 0, include_in_final: true, created_by: test.owner, created_at: f.now, updated_at: f.now }
    if (select === TEST_OWNER_PROJECTIONS.questions) return reply([{ ...row, questions: f.questions.filter(q => q.testId === test.id && (!url.searchParams.has('questions.id') || q.id > url.searchParams.get('questions.id')!.slice(3))).sort((a, b) => a.id.localeCompare(b.id)).map(q => ({
      id: q.id, artifact_id: q.artifactId, source_artifact_id: null, test_id: q.testId, position: q.position, question_text: q.text, question_type: 'open_response', options: [], correct_option: null, answer_key: 'Synthetic canonical answer', sample_solution: 'Synthetic canonical solution', points: 1, response_max_chars: 5000, response_monospace: false,
      created_at: f.now, updated_at: f.now, ai_reference_cache_answers: null, ai_reference_cache_generated_at: null, ai_reference_cache_key: null, ai_reference_cache_model: null })) }])
    const drafts = f.drafts.filter(d => d.testId === test.id).map(d => ({ id: d.id, assessment_id: d.testId, assessment_type: 'test', classroom_id: d.classroomId, version: d.version, content: d.content }))
    const refs = f.objects.filter(o => o.testId === test.id).map((o, i) => ({ id: `00000000-0000-4000-8000-00000000000${i}`, test_id: test.id, managed_object_id: o.id, storage_bucket: 'test-documents', storage_path: testOwnerObjectPath(f, o), reference_role: 'teacher_document',
      managed_object: { id: o.id, classroom_id: o.classroomId, course_blueprint_id: null, provisional_owner_id: null, storage_bucket: 'test-documents', storage_path: testOwnerObjectPath(f, o), purpose: 'teacher_test_material', status: 'ready', content_type: o.contentType } })).filter(r => !url.searchParams.has('refs.id') || r.id > url.searchParams.get('refs.id')!.slice(3))
    if (select === TEST_OWNER_PROJECTIONS.drafts) return reply([{ ...row, classrooms: { ...row.classrooms, drafts } }])
    if (select === TEST_OWNER_PROJECTIONS.refs) return reply([{ ...row, refs }])
    if (select === TEST_OWNER_PROJECTIONS.final) return reply([{ ...row, classrooms: { ...row.classrooms, drafts }, refs }])
    return reply([row])
  }
}

describe('finite Test owner proof fixture', () => {
  it('freezes a disjoint finite namespace and eight cases', () => {
    const { original, f } = fixture()
    expect(f.actors).toHaveLength(4); expect(f.classes).toHaveLength(2); expect(f.tests).toHaveLength(4)
    expect(f.questions).toHaveLength(4); expect(f.drafts).toHaveLength(2); expect(f.objects).toHaveLength(2); expect(f.cases).toHaveLength(8)
    expect(f.allocatedIds.every(id => !original.allocatedIds.includes(id))).toBe(true)
    expect(new Set(f.allocatedIds).size).toBe(f.allocatedIds.length)
    expect(Object.isFrozen(f)).toBe(true); expect(Object.isFrozen(f.cases[0])).toBe(true)
  })
  it('uses separately bounded exact setup and document binding SQL without weakening the original graph', () => {
    const { f, projectId } = fixture(); const setup = testOwnerSetupSql(f, projectId); const bind = testOwnerBindDocumentsSql(f, projectId)
    expect(Buffer.byteLength(setup)).toBeLessThanOrEqual(TEST_OWNER_PROOF_CAPS.sqlBytes)
    expect(Buffer.byteLength(bind)).toBeLessThanOrEqual(TEST_OWNER_PROOF_CAPS.sqlBytes)
    expect(setup).toContain('question_identity_version'); expect(bind).toContain('update public.tests')
    expect(`${setup}\n${bind}`).not.toMatch(/disable trigger|truncate|delete from|update private\.|reconcile_managed_storage_json_references|insert into public.managed_storage_objects|insert into public.managed_storage_json_references/i)
    expect(testOwnerDigest(setup)).toMatch(/^[a-f0-9]{64}$/)
  })
  it('retains all original guard predicates and additionally protects the private Test bucket', () => {
    const { projectId } = fixture(); const sql = testOwnerGuardSql(projectId)
    for (const marker of ['guard_pal_membership_evidence', 'guard_pal_signal_activation', 'pal_membership_settings', 'pal_classroom_signal_settings',
      'student_provider_cleanup_settings', 'removed_student_academic_settings', 'classroom_creation_entitlement_settings', 'vault.secrets',
      'test_ai_grading_runs', 'test_ai_grading_run_items', 'pika-removed-student-cleanup-watchdog', 'pika-test-ai-grading-watchdog', 'test-documents']) expect(sql).toContain(marker)
    expect(sql).not.toMatch(/update |alter |disable trigger/i)
    expect(sql.match(/begin read only/g)).toHaveLength(1)
  })
  it('verifies complete reservation and verification identities before using a receipt', () => {
    const { f } = fixture(); const object = f.objects[0]; const args = testOwnerReservationArgs(f, object)
    const receipt = { id: object.id, storage_bucket: args.p_storage_bucket, storage_path: args.p_storage_path, classroom_id: args.p_classroom_id,
      course_blueprint_id: null, provisional_owner_id: null, purpose: args.p_purpose, created_by_user_id: args.p_created_by_user_id,
      data_subject_user_id: null, resource_type: 'test', resource_id: args.p_resource_id, content_type: args.p_content_type, byte_size: 68,
      status: 'reserved', verified_at: null, ready_at: null, content_sha256: null }
    expect(() => validateTestOwnerObjectReceipt(f, object, receipt, 'reserved')).not.toThrow()
    for (const key of ['id', 'storage_path', 'storage_bucket', 'classroom_id', 'purpose', 'resource_type', 'resource_id', 'created_by_user_id', 'status'])
      expect(() => validateTestOwnerObjectReceipt(f, object, { ...receipt, [key]: 'substituted' }, 'reserved')).toThrow()
    expect(() => validateTestOwnerObjectReceipt(f, object, { ...receipt, status: 'verified', verified_at: f.now, content_sha256: 'wrong' }, 'verified')).toThrow()
  })
})

describe('finite Test owner transport', () => {
  it('rejects canonical, hosted, auth and unknown requests before guards or dispatch', async () => {
    const x = fixture()
    for (const url of ['http://127.0.0.1:54321/rest/v1/tests', 'https://example.invalid/rest/v1/tests', `${x.target.API_URL}/auth/v1/user`, `${x.target.API_URL}/rest/v1/users`])
      await expect(x.transport.fetch(url, { headers: x.headers })).rejects.toThrow('private details withheld')
    expect(x.guard).not.toHaveBeenCalled(); expect(x.fetcher).not.toHaveBeenCalled()
  })
  it('contains exact no-overwrite PNG upload and rejects alternate bytes', async () => {
    const x = fixture(); const path = testOwnerObjectPath(x.f, x.f.objects[0])
    await expect(x.transport.fetch(`${x.target.API_URL}/storage/v1/object/test-documents/${path}`, { method: 'POST', headers: { ...x.headers, 'content-type': 'image/png', 'x-upsert': 'false' }, body: new Uint8Array([1]) })).rejects.toThrow()
    expect(x.fetcher).not.toHaveBeenCalled()
  })
  it('requires a one-shot exact RPC intent and rejects extra body fields', async () => {
    const x = fixture(); const args = testOwnerReservationArgs(x.f, x.f.objects[0])
    x.transport.planRpc('begin_managed_storage_upload', args)
    await expect(x.transport.fetch(`${x.target.API_URL}/rest/v1/rpc/begin_managed_storage_upload`, { method: 'POST', headers: x.headers, body: JSON.stringify({ ...args, evil: true }) })).rejects.toThrow()
    expect(x.fetcher).not.toHaveBeenCalled()
  })
  it('executes the installed SDK through a finite preflight template, not a fabricated query builder', async () => {
    const x = fixture(); const test = x.f.tests[0]; x.transport.readContext(test.id, x.f.actors[0].id)
    const client = createClient(x.target.API_URL, x.target.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: x.transport.fetch } })
    await client.from('tests').select('id,classroom_id,classrooms!tests_classroom_id_fkey!inner(id,teacher_id,archived_at)').eq('id', test.id).maybeSingle()
    expect(x.guard).toHaveBeenCalledOnce(); expect(x.fetcher).toHaveBeenCalledOnce()
    const init = x.fetcher.mock.calls[0][1]; expect(init?.redirect).toBe('error'); expect(init?.signal).toBeTruthy()
  })
  it('never prints underlying errors or credentials in diagnostics', async () => {
    const x = fixture(); x.transport.readContext(x.f.tests[0].id, x.f.actors[0].id); x.guard.mockRejectedValueOnce(new Error('SECRET token'))
    await expect(x.transport.fetch(`${x.target.API_URL}/rest/v1/tests?id=eq.${x.f.tests[0].id}&select=id,classroom_id,classrooms!tests_classroom_id_fkey!inner(id,teacher_id,archived_at)`, { headers: x.headers })).rejects.toThrow()
    expect(x.transport.diagnostic()).not.toContain('SECRET'); expect(x.transport.diagnostic()).not.toContain(x.f.tests[0].id)
    expect(testOwnerFailureDiagnostic(new AssignmentListLifecycleError({ stage: 'SECRET', error: new Error('SECRET') }, []), 'SECRET')).not.toContain('SECRET')
  })
  it('rejects unknown headers before a guard or dispatch', async () => {
    const x = fixture(); x.transport.readContext(x.f.tests[0].id, x.f.actors[0].id)
    await expect(x.transport.fetch(`${x.target.API_URL}/rest/v1/tests?select=${TEST_OWNER_PROJECTIONS.control}&id=eq.${x.f.tests[0].id}`, { headers: { ...x.headers, 'x-unknown-control': 'true' } })).rejects.toThrow()
    expect(x.guard).not.toHaveBeenCalled()
  })
  it('rejects extra filters, changed methods, redirect/control options and SDK version drift before dispatch', async () => {
    const x = fixture(); x.transport.readContext(x.f.tests[0].id, x.f.actors[0].id)
    const url = `${x.target.API_URL}/rest/v1/tests?select=${TEST_OWNER_PROJECTIONS.control}&id=eq.${x.f.tests[0].id}`
    for (const [request, init] of [[`${url}&limit=1`, { headers: x.headers }], [url, { method: 'HEAD', headers: x.headers }],
      [url, { redirect: 'follow', headers: x.headers }], [url, { cache: 'force-cache', headers: x.headers }],
      [url, { headers: { ...x.headers, 'x-client-info': 'supabase-js-node/0.0.0' } }]] as Array<[string, RequestInit]>)
      await expect(x.transport.fetch(request, init)).rejects.toThrow()
    expect(x.guard).not.toHaveBeenCalled(); expect(x.fetcher).not.toHaveBeenCalled()
  })
  it('enforces exact network and response hard bounds without redirect escape', async () => {
    const x = fixture(); x.transport.readContext(x.f.tests[0].id, x.f.actors[0].id)
    const url = `${x.target.API_URL}/rest/v1/tests?select=${TEST_OWNER_PROJECTIONS.control}&id=eq.${x.f.tests[0].id}`
    x.fetcher.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://example.invalid' } }))
    await expect(x.transport.fetch(url, { headers: x.headers })).rejects.toThrow()
    x.fetcher.mockResolvedValueOnce(new Response(new Uint8Array(TEST_OWNER_PROOF_CAPS.responseBytes + 1)))
    await expect(x.transport.fetch(url, { headers: x.headers })).rejects.toThrow()
    for (let n = 2; n < TEST_OWNER_PROOF_CAPS.networkRequests; n++) await x.transport.fetch(url, { headers: x.headers })
    await expect(x.transport.fetch(url, { headers: x.headers })).rejects.toThrow()
    expect(x.fetcher).toHaveBeenCalledTimes(TEST_OWNER_PROOF_CAPS.networkRequests)
    expect(x.guard).toHaveBeenCalledTimes(TEST_OWNER_PROOF_CAPS.networkRequests)
  })
  it.each(Array.from({ length: 8 }, (_, index) => index))('runs real detail helper and installed SDK against fake finite sources, case %s', async index => {
    const x = fixture(); const item = x.f.cases[index]; const fetcher = vi.fn(sourceFetch(x.f))
    const transport = createTestOwnerProofTransport(x.f, x.target, x.projectId, fetcher, x.guard)
    const client = createClient<Database>(x.target.API_URL, x.target.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport.fetch } })
    transport.readContext(item.testId, item.actorId)
    const read = readContextualTestDetail({ supabase: client, actorId: item.actorId, testId: item.testId })
    if (item.status === 403) { await expect(read).rejects.toMatchObject({ statusCode: 403 }); expect(fetcher).toHaveBeenCalledOnce(); expect(transport.counts.storage).toBe(0) }
    else {
      const body = await read; const test = x.f.tests.find(t => t.id === item.testId)!
      expect(body.test.id).toBe(item.testId); expect(body.classroom.teacher_id).toBe(item.actorId)
      expect(transport.evidence.questionEmpty).toBeGreaterThan(0); expect(transport.evidence.refEmpty).toBeGreaterThan(0); expect(transport.evidence.final).toBeGreaterThan(0)
      expect(body.questions.map(q => q.id)).toEqual(x.f.questions.filter(q => q.testId === test.id).sort((a, b) => a.position - b.position).map(q => q.artifactId))
      expect(body.test.title).toBe(index === 2 ? x.f.drafts[0].content.title : test.title)
      if (index === 2) { expect(body.test.documents.map(d => d.upload_content_type)).toEqual(['image/png', 'image/png']); expect(transport.counts.info).toBe(1) }
      else expect(transport.counts.storage).toBe(0)
    }
    expect(x.guard.mock.calls.length).toBe(fetcher.mock.calls.length)
  })
})

describe('Test proof forced receipts', () => {
  it.each(['after-fixture', 'before-capture'])('accepts only full setup plus exact %s forced checkpoint and clean teardown', mode => {
    const error = new AssignmentListLifecycleError({ stage: mode, error: new Error('Forced isolated lifecycle failure') }, [])
    const receipt = testOwnerForcedReceipt(mode, error, true)
    expect(receipt?.exitCode).toBe(1); expect(`${receipt?.stdout}${receipt?.stderr}`.trim().split('\n')).toHaveLength(2)
    expect(testOwnerForcedReceipt(mode, error, false)).toBeNull()
    expect(testOwnerForcedReceipt(mode, new AssignmentListLifecycleError(error.primary, [{ stage: 'cleanup', error: new Error('private') }]), true)).toBeNull()
  })
})

describe('offline lifecycle composition', () => {
  it.each(['normal', 'after-fixture', 'before-capture', 'snapshot-drift', 'upload-path-substitution'] as const)('completes both PNGs before sealed lifecycle checkpoint, %s', async scenario => {
    const mode = scenario === 'snapshot-drift' || scenario === 'upload-path-substitution' ? 'normal' : scenario
    const x = fixture(); const events: string[] = []; const head = 'a'.repeat(40); const exit = process.exitCode; const pal = process.env.PAL_ENABLED
    const resources = platform.assignmentListExpectedResources(x.projectId).map((r, n) => ({ ...r, id: String(n + 1).padStart(64, '0'), createdAt: 'synthetic',
      labels: { 'com.supabase.cli.project': x.projectId, 'com.docker.compose.project': x.projectId }, ports: r.name === `supabase_db_${x.projectId}` ? [54332] : [], attachedIds: [] }))
    const session = { projectId: x.projectId, containerId: resources.find(r => r.name === `supabase_db_${x.projectId}`)!.id, dbPort: 54332 as const, applicationName: `${x.projectId}_fixture` }
    const nativeSql = vi.fn(async () => { events.push('sql') }); const nativeCase = vi.fn(async () => { events.push('original-case') })
    const native = { executeSql: nativeSql, runCase: nativeCase, command: vi.fn(async () => x.target), canonicalSnapshot: vi.fn(), teardown: vi.fn(),
      inventory: vi.fn(), prepare: vi.fn(), verifyEphemeral: vi.fn(), runRevocation: vi.fn(), verifyRestoration: vi.fn(), removeWorkdir: vi.fn() }
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true); const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    vi.spyOn(originalFixture, 'newAssignmentListProofFixture').mockReturnValue(x.original)
    vi.spyOn(platform, 'createAssignmentListNativeAdapters').mockReturnValue(native as unknown as ReturnType<typeof platform.createAssignmentListNativeAdapters>)
    vi.spyOn(platform, 'loadAssignmentListReviewedMigrations').mockReturnValue([])
    vi.spyOn(platform, 'assignmentListDockerInventory').mockResolvedValue(resources)
    let snapshots = 0
    vi.mocked(execFileSync).mockImplementation((_file, args, options) => {
      if (_file === 'git') return args?.[0] === 'status' ? '' : args?.[1] === 'HEAD' ? head : process.cwd()
      const sql = (options as { input: string }).input
      if (sql === testOwnerGuardSql(x.projectId)) return 'ok\n'
      snapshots++
      return scenario === 'snapshot-drift' && snapshots === 2 ? '{"synthetic-bookkeeping-change":true}\n' : '{}\n'
    })
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (resource, init) => {
      const url = new URL(String(resource)); const reply = (v: unknown) => new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } })
      if (url.pathname.startsWith('/rest/v1/rpc/')) {
        const args = JSON.parse(String(init?.body)); const object = x.f.objects.find(o => o.id === args.p_object_id)!
        const reserve = testOwnerReservationArgs(x.f, object); const verified = url.pathname.endsWith('/verify_managed_storage_upload')
        events.push(verified ? 'verify' : 'reserve')
        return reply({ id: object.id, storage_bucket: reserve.p_storage_bucket, storage_path: reserve.p_storage_path, classroom_id: object.classroomId,
          course_blueprint_id: null, provisional_owner_id: null, purpose: reserve.p_purpose, created_by_user_id: object.owner, data_subject_user_id: null,
          resource_type: 'test', resource_id: object.testId, content_type: object.contentType, byte_size: 68, status: verified ? 'verified' : 'reserved',
          verified_at: verified ? x.f.now : null, ready_at: null, content_sha256: verified ? testOwnerDigest(INTEGRATED_PNG) : null })
      }
      if (url.pathname.startsWith('/storage/v1/object/test-documents/')) {
        events.push('upload'); expect(init?.body).toEqual(INTEGRATED_PNG)
        return reply({ Id: 'synthetic', Key: scenario === 'upload-path-substitution' ? 'test-documents/substituted' : url.pathname.slice('/storage/v1/object/'.length) })
      }
      return sourceFetch(x.f)(resource, init)
    }))
    const sealed = vi.spyOn(lifecycle, 'runAssignmentListEphemeralLifecycle').mockImplementation(async (input, adapters) => {
      expect(input.fixture).toBe(x.original); expect(input.projectId).toBe(x.projectId); expect(input.mode).toBe(mode)
      expect(adapters.canonicalSnapshot).toBe(native.canonicalSnapshot); expect(adapters.teardown).toBe(native.teardown)
      for (const name of ['inventory', 'prepare', 'verifyEphemeral', 'runRevocation', 'verifyRestoration', 'removeWorkdir'] as const) expect(adapters[name]).toBe(native[name])
      expect(input.fixture.manifest.cases).toHaveLength(9)
      expect(input.restorationPolicies).toHaveLength(14)
      await adapters.command({ args: ['status'], workdir: input.workdir, timeoutMs: 1 })
      await adapters.executeSql({ ...session, sql: originalFixture.assignmentListFixtureSetupSql(x.original, x.projectId) })
      expect(events).toEqual(['sql', 'sql', 'reserve', 'upload', 'verify', 'reserve', 'upload', 'verify', 'sql'])
      events.push('checkpoint')
      if (mode !== 'normal') throw new AssignmentListLifecycleError({ stage: mode, error: new Error('Forced isolated lifecycle failure') }, [])
      await adapters.runCase({} as Parameters<typeof adapters.runCase>[0])
    })
    try {
      const running = testOwnerDetailLifecycleMain(['--reviewed-head', head, '--mode', mode])
      if (scenario === 'snapshot-drift' || scenario === 'upload-path-substitution') {
        await expect(running).rejects.toThrow('private details withheld')
        expect(stdout).not.toHaveBeenCalled(); expect(stderr.mock.calls.flat().join('')).not.toContain('synthetic-bookkeeping-change')
        expect(stderr.mock.calls.flat().join('')).not.toContain(x.f.tests[0].id)
        if (scenario === 'upload-path-substitution') expect(events).not.toContain('verify')
        return
      }
      await running
      expect(sealed).toHaveBeenCalledOnce(); expect(nativeSql).toHaveBeenCalledTimes(3)
      if (mode === 'normal') { expect(nativeCase).toHaveBeenCalledOnce(); expect(stderr).not.toHaveBeenCalled(); expect(stdout.mock.calls.flat().join('')).toContain('eight actual SDK cases') }
      else { expect(process.exitCode).toBe(1); expect(nativeCase).not.toHaveBeenCalled(); expect(stdout.mock.calls.flat().join('')).toBe('PASS isolated test-owner-detail exact teardown and unchanged canonical baseline.\n'); expect(stderr.mock.calls.flat().join('')).toBe(`FAIL forced isolated test-owner-detail lifecycle: ${mode}.\n`) }
    } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); process.exitCode = exit; if (pal === undefined) delete process.env.PAL_ENABLED; else process.env.PAL_ENABLED = pal }
  })
  it('rejects malformed CLI before any shell command', async () => {
    vi.mocked(execFileSync).mockClear()
    await expect(testOwnerDetailLifecycleMain(['--reviewed-head', 'bad', '--mode', 'normal'])).rejects.toThrow()
    expect(execFileSync).not.toHaveBeenCalled()
  })
  it.each(['head', 'dirty'])('rejects %s before native platform construction', async state => {
    const native = vi.spyOn(platform, 'createAssignmentListNativeAdapters')
    vi.mocked(execFileSync).mockImplementation((_file, args) => args?.[0] === 'status' ? ' M synthetic' : 'b'.repeat(40))
    try { await expect(testOwnerDetailLifecycleMain(['--reviewed-head', state === 'head' ? 'a'.repeat(40) : 'b'.repeat(40), '--mode', 'normal'])).rejects.toThrow(); expect(native).not.toHaveBeenCalled() }
    finally { native.mockRestore() }
  })
})
