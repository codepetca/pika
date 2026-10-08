/** Dormant source preparation. Root's fixed-source review and explicit finite
 * SQL/request-manifest acceptance must precede execution. Import is inert.
 * SDK detail evidence only: no authenticated HTTP/browser/race/rollout claim. */
import assert from 'node:assert/strict'
import { createContextualProofTimings, extractContextualProofTimingArgs } from './contextual-proof-timings'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/database'
import { ApiError } from '../src/lib/api-error'
import { newAssignmentListProofFixture, assignmentListFixtureSetupSql } from './contextual-assignment-list-proof-fixture'
import { runAssignmentListEphemeralLifecycle, AssignmentListLifecycleError, type AssignmentListLifecycleAdapters } from './contextual-assignment-list-proof-lifecycle'
import { createAssignmentListNativeAdapters, loadAssignmentListReviewedMigrations, assignmentListExpectedResources,
  assignmentListRestorationPolicy, assignmentListDockerInventory } from './contextual-assignment-list-proof-platform'
import { assignmentListRevocationPlans } from './contextual-assignment-list-proof-revocations'
import { assignmentListProofWorkdir } from './contextual-assignment-list-proof-path'
import { validateAssignmentListProofTarget } from './check-contextual-assignment-list-reads'
import { parseAssignmentListLifecycleArgs } from './check-contextual-assignment-list-lifecycle'
import { validateIntegratedGuardResources } from './check-contextual-assignment-learner-integrated-lifecycle'
import { INTEGRATED_PNG } from './contextual-assignment-learner-integrated-proof-fixture'
import { newTestOwnerDetailFixture, TEST_OWNER_PROOF_CAPS, testOwnerDigest, testOwnerGuardSql, testOwnerSetupSql,
  testOwnerBindDocumentsSql, testOwnerSnapshotSql, testOwnerObjectPath, testOwnerReservationArgs, validateTestOwnerObjectReceipt,
  type TestOwnerDetailFixture } from './contextual-test-owner-detail-proof-fixture'

const API = 'http://127.0.0.1:54331'
type Target = ReturnType<typeof validateAssignmentListProofTarget>
type Session = Parameters<AssignmentListLifecycleAdapters['executeSql']>[0]
type RpcPlan = { name: 'begin_managed_storage_upload' | 'verify_managed_storage_upload'; args: Record<string, unknown> }
// Independently frozen exact projections from the reviewed detail implementation.
// Do not reflect arbitrary application select strings into transport authority.
const classroomFields = 'id,teacher_id,archived_at'
const classroomRelation = 'classrooms!tests_classroom_id_fkey!inner'
const controlFields = `id,classroom_id,${classroomRelation}(${classroomFields})`
const testFields = 'id,classroom_id,title,status,show_results,documents,position,points_possible,include_in_final,created_by,created_at,updated_at'
const payloadFields = `${testFields},${classroomRelation}(${classroomFields})`
const questionFields = 'id,test_id,artifact_id,source_artifact_id,question_type,question_text,options,correct_option,answer_key,sample_solution,points,response_max_chars,response_monospace,position,created_at,updated_at,ai_reference_cache_answers,ai_reference_cache_generated_at,ai_reference_cache_key,ai_reference_cache_model'
const draftRelation = 'drafts:assessment_drafts!assessment_drafts_classroom_id_fkey(id,assessment_id,assessment_type,classroom_id,version,content)'
const referenceRelation = 'refs:managed_storage_json_references!managed_storage_json_references_test_id_fkey(id,test_id,managed_object_id,storage_bucket,storage_path,reference_role,managed_object:managed_storage_objects!managed_storage_json_reference_identity_fkey(id,classroom_id,course_blueprint_id,provisional_owner_id,storage_bucket,storage_path,purpose,status,content_type))'
export const TEST_OWNER_PROJECTIONS = Object.freeze({ control: controlFields, payload: payloadFields,
  questions: `${payloadFields},questions:test_questions!test_questions_test_id_fkey(${questionFields})`,
  drafts: `${testFields},${classroomRelation}(${classroomFields},${draftRelation})`, refs: `${payloadFields},${referenceRelation}`,
  final: `${testFields},${classroomRelation}(${classroomFields},${draftRelation}),${referenceRelation}` })
const cleanupMarker = 'PASS isolated test-owner-detail exact teardown and unchanged canonical baseline.\n'

/** Independent finite transport; original observer and transport stay sealed. */
export function createTestOwnerProofTransport(f: TestOwnerDetailFixture, rawTarget: unknown, projectId: string, original: typeof fetch, guard: () => Promise<void>) {
  assert.match(projectId, /^pika_assignment_list_[a-f0-9]{12}$/)
  assert.equal(projectId, `pika_assignment_list_${f.tag.slice(-12)}`)
  const target = validateAssignmentListProofTarget(rawTarget, projectId); assert.equal(target.API_URL, API)
  let context: { testId: string; actorId: string } | undefined
  let frozenStamp: string | undefined; let rpc: RpcPlan | undefined
  const refs = new Map<string, string>()
  const uploaded = new Set<string>()
  const counts = { network: 0, storage: 0, rpc: 0, info: 0, bucket: 0 }
  const evidence = { questionEmpty: 0, refEmpty: 0, draftEmpty: 0, final: 0 }
  let phase = 'not-started'; let operation = 'unknown'; let status = 'unobserved'; let code = 'none'; let guardMs: number | undefined
  let appSignal: AbortSignal | null | undefined
  const knownCodes = new Set(['PGRST200', 'PGRST201', 'PGRST204', 'PGRST202', 'PGRST116', '23514', '23502', '23503', '23505', '42501', 'P0002', '22023', '40001'])
  function readContext(testId: string, actorId: string) {
    assert(f.tests.some(test => test.id === testId)); assert(f.actors.some(actor => actor.id === actorId)); assert(!rpc)
    context = { testId, actorId }; frozenStamp = undefined; refs.clear()
  }
  function planRpc(name: RpcPlan['name'], args: Record<string, unknown>) {
    assert(!rpc); const object = f.objects.find(row => row.id === args.p_object_id); assert(object)
    if (name === 'begin_managed_storage_upload') assert(isDeepStrictEqual(args, testOwnerReservationArgs(f, object)))
    else { assert.equal(name, 'verify_managed_storage_upload'); assert(isDeepStrictEqual(args, { p_object_id: object.id, p_content_sha256: testOwnerDigest(INTEGRATED_PNG) })) }
    rpc = { name, args: structuredClone(args) }
  }
  function validateRead(url: URL) {
    assert(context); const test = f.tests.find(row => row.id === context!.testId)!; const select = url.searchParams.get('select')
    assert(select && Object.values(TEST_OWNER_PROJECTIONS).includes(select)); assert.equal(new Set(url.searchParams.keys()).size, url.searchParams.size)
    const expected: Record<string, string> = { select, id: `eq.${test.id}` }
    if (select !== controlFields) {
      Object.assign(expected, { classroom_id: `eq.${test.classroomId}`, 'classrooms.id': `eq.${test.classroomId}`, 'classrooms.teacher_id': `eq.${context.actorId}` })
      if (select === payloadFields) assert(!frozenStamp)
      if (select !== payloadFields) { assert(frozenStamp); Object.assign(expected, { status: `eq.${test.status}`, updated_at: `eq.${frozenStamp}` }) }
    }
    if (select === TEST_OWNER_PROJECTIONS.questions) {
      Object.assign(expected, { 'questions.test_id': `eq.${test.id}`, 'questions.order': 'id.asc', 'questions.limit': '1000' })
      const cursor = url.searchParams.get('questions.id')
      if (cursor) { assert(f.questions.some(row => row.testId === test.id && cursor === `gt.${row.id}`)); expected['questions.id'] = cursor }
    }
    if (select === TEST_OWNER_PROJECTIONS.drafts || select === TEST_OWNER_PROJECTIONS.final) Object.assign(expected, {
      'classrooms.drafts.assessment_type': 'eq.test', 'classrooms.drafts.assessment_id': `eq.${test.id}`,
      'classrooms.drafts.classroom_id': `eq.${test.classroomId}`, 'classrooms.drafts.limit': '2' })
    if (select === TEST_OWNER_PROJECTIONS.refs || select === TEST_OWNER_PROJECTIONS.final) {
      const paths = f.objects.filter(object => object.testId === test.id).map(object => testOwnerObjectPath(f, object))
      Object.assign(expected, { 'refs.test_id': `eq.${test.id}`, 'refs.reference_role': 'eq.teacher_document', 'refs.storage_bucket': 'eq.test-documents',
        'refs.storage_path': paths.length ? `in.(${paths.join(',')})` : 'in.()', 'refs.order': 'id.asc', 'refs.limit': select === TEST_OWNER_PROJECTIONS.final ? '21' : '1000' })
      const cursor = url.searchParams.get('refs.id')
      if (cursor) { assert(select === TEST_OWNER_PROJECTIONS.refs && cursor.startsWith('gt.') && refs.get(cursor.slice(3)) === test.id); expected['refs.id'] = cursor }
    }
    assert.deepEqual(Object.fromEntries(url.searchParams), expected)
    return select
  }
  const safeFetch: typeof fetch = async (resource, init) => {
    try {
      phase = 'validate'; operation = 'unknown'; status = 'unobserved'; code = 'none'; guardMs = undefined; appSignal = init?.signal
      assert(!(resource instanceof Request)); const url = new URL(String(resource)); const method = init?.method ?? 'GET'
      assert(Object.keys(init ?? {}).every(key => ['method', 'headers', 'body', 'signal', 'redirect'].includes(key)))
      assert.equal(url.origin, API); assert(!url.username && !url.password && !url.hash); assert(init?.redirect === undefined || init.redirect === 'error')
      const headers = new Headers(init?.headers)
      assert.equal(headers.get('authorization'), `Bearer ${target.SERVICE_ROLE_KEY}`); assert.equal(headers.get('apikey'), target.SERVICE_ROLE_KEY)
      const allowedHeaders: Record<string, readonly string[]> = { authorization: [`Bearer ${target.SERVICE_ROLE_KEY}`], apikey: [target.SERVICE_ROLE_KEY],
        'x-client-info': ['supabase-js-node/2.93.3'], accept: ['application/json'], 'accept-profile': ['public'], 'content-profile': ['public'],
        'content-type': ['application/json', 'image/png'], 'cache-control': ['max-age=3600'], 'x-upsert': ['false'] }
      for (const [name, value] of headers) assert(allowedHeaders[name]?.includes(value))
      let select: string | undefined
      if (url.pathname === '/rest/v1/tests') { operation = 'test-read'; assert(method === 'GET' && !init?.body); select = validateRead(url) }
      else if (url.pathname.startsWith('/rest/v1/rpc/')) {
        operation = 'setup-rpc'; assert(method === 'POST' && !url.search && rpc)
        assert.equal(url.pathname, `/rest/v1/rpc/${rpc.name}`); assert(typeof init?.body === 'string' && isDeepStrictEqual(JSON.parse(init.body), rpc.args)); rpc = undefined; counts.rpc++
      } else {
        operation = 'storage'; assert(!url.search)
        const upload = f.objects.find(object => url.pathname === `/storage/v1/object/test-documents/${testOwnerObjectPath(f, object)}`)
        const info = f.objects.find(object => url.pathname === `/storage/v1/object/info/test-documents/${testOwnerObjectPath(f, object)}`)
        if (upload) {
          assert(method === 'POST' && headers.get('x-upsert') === 'false' && headers.get('content-type') === 'image/png')
          assert(init?.body instanceof Uint8Array && testOwnerDigest(init.body) === testOwnerDigest(INTEGRATED_PNG)); assert(!uploaded.has(upload.id)); uploaded.add(upload.id)
        } else if (info) {
          assert(method === 'GET' && !init?.body && context && info.testId === context.testId && info.contentType === null && frozenStamp)
          assert([...refs.values()].includes(context.testId)); counts.info++
        } else {
          assert(url.pathname === '/storage/v1/bucket/test-documents' && method === 'GET' && !init?.body && context && frozenStamp); counts.bucket++
        }
        assert(++counts.storage <= TEST_OWNER_PROOF_CAPS.storageRequests)
      }
      assert(++counts.network <= TEST_OWNER_PROOF_CAPS.networkRequests)
      phase = 'guard'; const start = Date.now(); try { await guard() } finally { guardMs = Math.max(0, Date.now() - start) }
      const timeout = AbortSignal.timeout(TEST_OWNER_PROOF_CAPS.requestMs); phase = 'dispatch'
      const response = await original(resource, { ...init, redirect: 'error', signal: init?.signal ? AbortSignal.any([timeout, init.signal]) : timeout })
      status = response.ok ? 'success' : 'error'; phase = 'decode'; assert(response.status < 300 || response.status >= 400); assert(!response.headers.has('location'))
      const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0
      if (reader) for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length
        if (size > TEST_OWNER_PROOF_CAPS.responseBytes) { await reader.cancel(); throw new Error('Response bound') } chunks.push(part.value) }
      const bytes = Buffer.concat(chunks)
      if (!response.ok) {
        code = 'unknown'
        try { const value = JSON.parse(bytes.toString('utf8')); if (typeof value?.code === 'string' && knownCodes.has(value.code)) code = value.code } catch { /* Closed labels only. */ }
      } else if (select && context) {
        const decoded: unknown = JSON.parse(bytes.toString('utf8')); const row = Array.isArray(decoded) ? decoded.length === 1 ? decoded[0] : undefined : decoded
        if (row && typeof row === 'object') {
          const value = row as Record<string, unknown>; const test = f.tests.find(test => test.id === context!.testId)!
          if (select === payloadFields) {
            const classroom = value.classrooms as Record<string, unknown> | undefined
            assert(value.id === test.id && value.classroom_id === test.classroomId && value.status === test.status && classroom?.id === test.classroomId && classroom.teacher_id === context.actorId)
            assert(typeof value.updated_at === 'string' && Number.isFinite(Date.parse(value.updated_at))); assert(!frozenStamp); frozenStamp = value.updated_at
          }
          if (select === TEST_OWNER_PROJECTIONS.questions && Array.isArray(value.questions) && value.questions.length === 0) evidence.questionEmpty++
          const classroom = value.classrooms as Record<string, unknown> | undefined
          if (classroom && Array.isArray(classroom.drafts) && classroom.drafts.length === 0) evidence.draftEmpty++
          if (Array.isArray(value.refs)) {
            if (value.refs.length === 0) evidence.refEmpty++
            for (const item of value.refs) {
              assert(item && typeof item === 'object'); const ref = item as Record<string, unknown>; const object = f.objects.find(object => object.id === ref.managed_object_id)
              assert(object && object.testId === context.testId && ref.test_id === context.testId && ref.storage_bucket === 'test-documents' && ref.storage_path === testOwnerObjectPath(f, object))
              assert(typeof ref.id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(ref.id))
              assert(!f.allocatedIds.includes(ref.id)); const prior = refs.get(ref.id); assert(prior === undefined || prior === context.testId); refs.set(ref.id, context.testId)
            }
          }
          if (select === TEST_OWNER_PROJECTIONS.final) evidence.final++
        }
      }
      phase = 'complete'; return new Response(bytes, { status: response.status, headers: response.headers })
    } catch { throw new Error('Test owner proof transport rejected; private details withheld') }
  }
  return { target, fetch: safeFetch, counts, evidence, readContext, planRpc, assertNoPendingRpc() { assert(!rpc) },
    diagnostic() { const time = guardMs === undefined ? 'unobserved' : guardMs < 1000 ? 'under-1s' : guardMs < 5000 ? 'under-5s' : guardMs < 15000 ? 'under-15s' : 'at-least-15s'
      return `DIAG test-owner-detail transport phase=${phase} operation=${operation} status=${status} code=${code} aborted=${appSignal?.aborted === true} guard=${time} requests=${counts.network}.\n` } }
}

export function testOwnerForcedReceipt(mode: string, error: unknown, extensionComplete: boolean) {
  if (extensionComplete && ['after-fixture', 'before-capture'].includes(mode) && error instanceof AssignmentListLifecycleError
    && error.primary?.stage === mode && error.primary.error instanceof Error && error.primary.error.message === 'Forced isolated lifecycle failure' && !error.cleanupFailures.length)
    return { stdout: cleanupMarker, stderr: `FAIL forced isolated test-owner-detail lifecycle: ${mode}.\n`, exitCode: 1 }
  return null
}
export function testOwnerFailureDiagnostic(error: unknown, step: string) {
  const stages = new Set(['canonical-before', 'preflight', 'prepare', 'pre-start', 'start', 'capture', 'status', 'fixture', 'cases', 'revocations', 'after-fixture', 'before-capture'])
  const steps = new Set(['not-started', 'guard', 'extension-sql', 'reserve', 'upload', 'verify', 'bind-documents', 'setup-complete', 'matrix', 'matrix-complete'])
  const failure = error instanceof AssignmentListLifecycleError ? error : undefined
  return `DIAG isolated test-owner-detail stage=${failure?.primary && stages.has(failure.primary.stage) ? failure.primary.stage : 'unknown'} step=${steps.has(step) ? step : 'unknown'} cleanup=${failure ? failure.cleanupFailures.length ? 'present' : 'none' : 'unknown'}.\n`
}

export async function testOwnerDetailLifecycleMain(args = process.argv.slice(2)) {
  const timingArgs = extractContextualProofTimingArgs(args)
  const input = parseAssignmentListLifecycleArgs(timingArgs.lifecycleArgs)
  const git = (values: string[]) => execFileSync('git', values, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 }).trim()
  assert.equal(git(['rev-parse', 'HEAD']), input.head); assert.equal(git(['status', '--porcelain']), ''); const repository = git(['rev-parse', '--show-toplevel']); assert.equal(repository, process.cwd())
  const original = newAssignmentListProofFixture(); const f = newTestOwnerDetailFixture(original)
  const projectId = `pika_assignment_list_${original.manifest.syntheticTag.slice(-12)}`
  let native = createAssignmentListNativeAdapters(original, { ephemeralSnapshot: 'metadata' }); const originalSetup = assignmentListFixtureSetupSql(original, projectId)
  const setupSql = testOwnerSetupSql(f, projectId); const bindSql = testOwnerBindDocumentsSql(f, projectId)
  const sqlHashes = new Map([[setupSql, testOwnerDigest(setupSql)], [bindSql, testOwnerDigest(bindSql)]])
  let target: Target | undefined; let bound: Session | undefined; let extensionComplete = false; let matrixComplete = false; let step = 'not-started'
  let resourceClosure: Awaited<ReturnType<typeof assignmentListDockerInventory>> | undefined
  let transport: ReturnType<typeof createTestOwnerProofTransport> | undefined
  let client: ReturnType<typeof createClient<Database>> | undefined
  const timings = createContextualProofTimings({ path: timingArgs.timingsPath, reviewedSha: input.head, profile: 'test-owner-detail', mode: input.mode })
  native = timings.decorate(native)
  const originalPal = process.env.PAL_ENABLED; process.env.PAL_ENABLED = 'false'
  async function guard() {
    assert(target && bound); const inventory = await assignmentListDockerInventory()
    resourceClosure = validateIntegratedGuardResources(inventory, projectId, bound.containerId, resourceClosure)
    const output = execFileSync('docker', ['exec', '-i', '-e', `PGAPPNAME=${projectId}_fixture`, bound.containerId, 'psql', '-U', 'postgres', '-d', 'postgres', '-XqAt', '-v', 'ON_ERROR_STOP=1'],
      { input: testOwnerGuardSql(projectId), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 45000, maxBuffer: TEST_OWNER_PROOF_CAPS.responseBytes })
    assert.equal(output.trim(), 'ok')
  }
  async function extensionSql(sql: string) {
    assert(sqlHashes.has(sql) && testOwnerDigest(sql) === sqlHashes.get(sql)); await guard(); assert(bound)
    await native.executeSql({ ...bound, sql })
  }
  async function rpc(name: RpcPlan['name'], values: Record<string, unknown>) {
    assert(transport && client); transport.planRpc(name, values)
    const result = await client.rpc(name as 'begin_managed_storage_upload', values as never); transport.assertNoPendingRpc(); assert(!result.error)
    return result.data as unknown
  }
  async function snapshot() {
    await guard(); assert(bound)
    const output = execFileSync('docker', ['exec', '-i', '-e', `PGAPPNAME=${projectId}_fixture`, bound.containerId, 'psql', '-U', 'postgres', '-d', 'postgres', '-XqAt', '-v', 'ON_ERROR_STOP=1'],
      { input: testOwnerSnapshotSql(f), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 45000, maxBuffer: TEST_OWNER_PROOF_CAPS.responseBytes })
    const value: unknown = JSON.parse(output.trim()); assert(value && typeof value === 'object'); return testOwnerDigest(JSON.stringify(value))
  }
  async function setup() {
    step = 'extension-sql'; await extensionSql(setupSql); assert(client && transport)
    for (const object of f.objects) {
      step = 'reserve'; validateTestOwnerObjectReceipt(f, object, await rpc('begin_managed_storage_upload', testOwnerReservationArgs(f, object)), 'reserved')
      step = 'upload'; const path = testOwnerObjectPath(f, object)
      const uploaded = await client.storage.from('test-documents').upload(path, INTEGRATED_PNG, { contentType: 'image/png', upsert: false })
      assert(!uploaded.error && uploaded.data?.path === path)
      assert.equal(uploaded.data.fullPath, `test-documents/${path}`); assert(typeof uploaded.data.id === 'string' && uploaded.data.id.length > 0)
      step = 'verify'; validateTestOwnerObjectReceipt(f, object, await rpc('verify_managed_storage_upload', { p_object_id: object.id, p_content_sha256: testOwnerDigest(INTEGRATED_PNG) }), 'verified')
    }
    step = 'bind-documents'; await extensionSql(bindSql); await guard(); extensionComplete = true; step = 'setup-complete'
  }
  async function matrix() {
    assert(extensionComplete && !matrixComplete && transport && client)
    const { readContextualTestDetail } = await import('../src/lib/server/contextual-test-detail-read')
    step = 'matrix'
    for (const proofCase of f.cases) {
      const before = await snapshot(); const beforeStorage = transport.counts.storage
      transport.readContext(proofCase.testId, proofCase.actorId)
      const read = () => readContextualTestDetail({ supabase: client!, actorId: proofCase.actorId, testId: proofCase.testId })
      if (proofCase.status === 403) { await assert.rejects(read, error => error instanceof ApiError && error.statusCode === 403); assert.equal(transport.counts.storage, beforeStorage) }
      else {
        const body = await read(); const test = f.tests.find(test => test.id === proofCase.testId)!; const questions = f.questions.filter(question => question.testId === test.id).sort((a, b) => a.position - b.position)
        assert.equal(body.test.id, test.id); assert.equal(body.test.classroom_id, test.classroomId); assert.equal(body.classroom.teacher_id, proofCase.actorId)
        assert.deepEqual(body.questions.map(question => question.id), questions.map(question => question.artifactId))
        if (test.id === f.tests[2].id) {
          assert.equal(body.test.title, f.drafts[0].content.title); assert.equal(body.draft_version, 7)
          assert.deepEqual(body.test.documents.map(doc => doc.upload_content_type), ['image/png', 'image/png'])
          assert.deepEqual(body.questions.map(question => question.question_text), f.drafts[0].content.questions.map(question => question.question_text))
        } else if (test.id === f.tests[3].id) { assert.equal(body.test.title, test.title); assert.deepEqual(body.questions.map(question => question.question_text), questions.map(question => question.text)); assert.equal(body.draft_version, 7) }
        else { assert.equal(body.draft_version, null); assert.deepEqual(body.test.documents, []) }
      }
      assert.equal(await snapshot(), before)
    }
    assert(transport.evidence.questionEmpty >= 4 && transport.evidence.refEmpty >= 4 && transport.evidence.draftEmpty >= 2 && transport.evidence.final >= 4)
    assert.equal(transport.counts.info, 1); assert.equal(transport.counts.bucket, 0)
    matrixComplete = true; step = 'matrix-complete'
  }
  try {
    await timings.run(async () => {
      await runAssignmentListEphemeralLifecycle({ fixture: original, projectId, workdir: assignmentListProofWorkdir(projectId), migrations: loadAssignmentListReviewedMigrations(repository), mode: input.mode,
        expectedResources: assignmentListExpectedResources(projectId), reviewedManifestSha256: testOwnerDigest(JSON.stringify(original.manifest)),
        restorationPolicies: assignmentListRevocationPlans(original).map(plan => assignmentListRestorationPolicy(original, plan)) },
      { ...native, async command(request) { const result = await native.command(request); if (request.args[0] === 'status') target = validateAssignmentListProofTarget(result, projectId); return result },
        async executeSql(request) { await native.executeSql(request); if (request.sql === originalSetup) {
          assert(!bound && target); bound = { ...request }; transport = createTestOwnerProofTransport(f, target, projectId, fetch, guard)
          client = createClient<Database>(target.API_URL, target.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport.fetch } }); await setup()
        } }, async runCase(request) { const result = await native.runCase(request); if (!matrixComplete) await matrix(); return result } })
      assert(extensionComplete && matrixComplete)
    })
    process.stdout.write(`PASS isolated test-owner-detail eight actual SDK cases; no auth HTTP/browser/race/public-legacy claim.\n${cleanupMarker}`)
  } catch (error) {
    const receipt = testOwnerForcedReceipt(input.mode, error, extensionComplete)
    if (receipt) { process.stdout.write(receipt.stdout); process.stderr.write(receipt.stderr); process.exitCode = receipt.exitCode; return }
    process.stderr.write(testOwnerFailureDiagnostic(error, step)); if (transport) process.stderr.write(transport.diagnostic())
    throw new Error('Test owner detail lifecycle failed; private details withheld')
  } finally { if (originalPal === undefined) delete process.env.PAL_ENABLED; else process.env.PAL_ENABLED = originalPal }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) testOwnerDetailLifecycleMain().catch(() => {
  process.stderr.write('FAIL isolated test-owner-detail lifecycle; private details withheld.\n'); process.exitCode = 1
})
