/** Inert finite SDK proof entrypoint. Fixed-source review and explicit parent
 * acceptance precede native execution. This proves helper/RPC behavior only. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/database'
import { ApiError } from '../src/lib/api-error'
import { buildTestDraftContentFromRows } from '../src/lib/server/assessment-drafts'
import { validateTestDraftContent } from '../src/lib/validations/assessment-drafts'
import { getTestDraftIdentityResolutionOptions, projectPortableTestQuestionIds } from '../src/lib/test-question-identity'
import { contextualTestDraftGetSnapshotSchema } from '../src/lib/validations/contextual-test-draft-get'
import { newAssignmentListProofFixture, assignmentListFixtureSetupSql } from './contextual-assignment-list-proof-fixture'
import { runAssignmentListEphemeralLifecycle, AssignmentListLifecycleError, type AssignmentListLifecycleAdapters } from './contextual-assignment-list-proof-lifecycle'
import { createAssignmentListNativeAdapters, loadAssignmentListReviewedMigrations, assignmentListExpectedResources, assignmentListRestorationPolicy, assignmentListRowChanges, assignmentListDockerInventory } from './contextual-assignment-list-proof-platform'
import { assignmentListRevocationPlans } from './contextual-assignment-list-proof-revocations'
import { testOwnerListDockerInventory } from './contextual-test-owner-list-proof-inventory'
import { assignmentListProofWorkdir } from './contextual-assignment-list-proof-path'
import { validateAssignmentListProofTarget } from './check-contextual-assignment-list-reads'
import { parseAssignmentListLifecycleArgs } from './check-contextual-assignment-list-lifecycle'
import { validateIntegratedGuardResources } from './check-contextual-assignment-learner-integrated-lifecycle'
import { newTestOwnerDraftGetFixture, testOwnerDraftGetSetupSql, testOwnerDraftGetSnapshotSql, testOwnerDigest, testOwnerGuardSql, TEST_OWNER_DRAFT_GET_CAPS, type TestOwnerDraftGetFixture } from './contextual-test-owner-draft-get-proof-fixture'
import { buildDraftGetNativeContractsManifest, createDraftGetNativeContracts } from './contextual-test-draft-get-native-contracts'
import { generateTestDraftGetTypes } from './generate-contextual-test-draft-get-types'

const API = 'http://127.0.0.1:54331'
const paths = Object.freeze(['/rest/v1/rpc/snapshot_test_draft_for_owner_v1', '/rest/v1/rpc/finish_test_draft_get_for_owner_v1'])
const cleanupMarker = 'PASS isolated test-owner-draft-get exact teardown and unchanged canonical baseline.\n'
type Rows = Record<string, Array<Record<string, unknown>>>
type Session = Parameters<AssignmentListLifecycleAdapters['executeSql']>[0]
type Source = ReturnType<typeof contextualTestDraftGetSnapshotSchema.parse>
export function testOwnerDraftGetRequestManifest(f: TestOwnerDraftGetFixture) {
  return Object.freeze({ version: 1, fixture: f, caps: TEST_OWNER_DRAFT_GET_CAPS, origin: API, method: 'POST', paths, sdk: 'supabase-js-node/2.93.3',
    snapshotKeys: Object.freeze(['p_actor_id', 'p_test_id', 'p_deadline']), finalKeys: Object.freeze(['p_actor_id', 'p_test_id', 'p_classroom_id', 'p_expected_source_sha256', 'p_operation', 'p_content', 'p_deadline']) })
}
function candidate(source: Source) {
  if (source.draft && source.test.status === 'draft') {
    const valid = validateTestDraftContent(source.draft.content, { allowEmptyQuestionText: true })
    if (valid.valid) {
      const projected = projectPortableTestQuestionIds(valid.value, source.questions, getTestDraftIdentityResolutionOptions(valid.value)); assert(projected.ok)
      return projected.content
    }
  }
  const valid = validateTestDraftContent(buildTestDraftContentFromRows(source.test, source.questions), { allowEmptyQuestionText: true, requirePortableQuestionIdentity: true })
  assert(valid.valid); return valid.value
}
/** Independently bind the returned snapshot to the reviewed synthetic source;
 * arbitrary app requests cannot choose a Class/hash/operation/content. */
export function createTestOwnerDraftGetProofTransport(f: TestOwnerDraftGetFixture, rawTarget: unknown, projectId: string, original: typeof fetch, guard: () => Promise<void>) {
  assert.equal(projectId, `pika_assignment_list_${f.tag.slice(-12)}`)
  const target = validateAssignmentListProofTarget(rawTarget, projectId); assert.equal(target.API_URL, API)
  const manifest = testOwnerDraftGetRequestManifest(f); const hash = testOwnerDigest(JSON.stringify(manifest))
  const counts = { network: 0, rpc: 0, storage: 0, exchangeBytes: 0 }
  const evidence = { emptySource: 0, nonemptySource: 0, complete1001Source: 0, rawPrivilegeFailures: 0 }
  let context: TestOwnerDraftGetFixture['cases'][number] | undefined; let source: Source | undefined; let deadline: string | undefined
  let before: Rows | undefined; let dispatched = 0; let phase = 'idle'; let operation = 'unknown'
  function readContext(testId: string, actorId: string, rows?: Rows) {
    context = f.cases.find(c => c.testId === testId && c.actorId === actorId); assert(context)
    source = undefined; deadline = undefined; dispatched = 0; before = rows ? structuredClone(rows) : undefined; phase = 'context'; operation = 'unknown'
  }
  function bindSnapshot(value: unknown) {
    assert(context); const parsed = contextualTestDraftGetSnapshotSchema.parse(value)
    const test = f.tests.find(t => t.id === context!.testId)!; const classroom = f.classes.find(c => c.id === context!.classroomId)!
    assert.equal(parsed.actor_id, context.actorId)
    assert.deepEqual({ ...parsed.classroom, archived_at: parsed.classroom.archived_at === null ? null : new Date(parsed.classroom.archived_at).toISOString() }, { id: classroom.id, teacher_id: classroom.owner, archived_at: classroom.archived ? f.now : null })
    assert.deepEqual({ ...parsed.test, blueprint_archived_at: parsed.test.blueprint_archived_at === null ? null : new Date(parsed.test.blueprint_archived_at).toISOString(), questions_locked_at: parsed.test.questions_locked_at === null ? null : new Date(parsed.test.questions_locked_at).toISOString() }, Object.fromEntries(['id', 'classroom_id', 'title', 'show_results', 'status', 'blueprint_archived_at', 'questions_locked_at'].map(key => [key, test[key as keyof typeof test]])))
    const plannedQuestions = f.questions.filter(q => q.test_id === test.id).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    assert.deepEqual(parsed.questions, plannedQuestions); assert.equal(parsed.question_count, plannedQuestions.length)
    if (parsed.question_count === 0) evidence.emptySource++
    else evidence.nonemptySource++
    if (context.label === 'complete-1001-source') { assert.equal(parsed.question_count, 1001); evidence.complete1001Source++ }
    if (before) assert.deepEqual(parsed.draft, before['public.assessment_drafts'].find(d => d.assessment_type === 'test' && d.assessment_id === test.id) ?? null)
    else {
      const plannedDraft = f.drafts.find(d => d.assessment_id === test.id)
      assert.equal(parsed.draft === null, !plannedDraft)
      if (plannedDraft) for (const [key, value] of Object.entries(plannedDraft)) assert.deepEqual(parsed.draft![key as keyof NonNullable<Source['draft']>], value)
    }
    source = parsed
  }
  const safeFetch: typeof fetch = async (resource, init) => {
    try {
      phase = 'validate'; assert.equal(testOwnerDigest(JSON.stringify(manifest)), hash); assert(context && !(resource instanceof Request))
      const url = new URL(String(resource)); assert.equal(url.origin, API); assert(paths.includes(url.pathname)); assert(!url.search && !url.hash && !url.username && !url.password)
      assert.equal(init?.method, 'POST'); assert(typeof init.body === 'string' && Buffer.byteLength(init.body) <= TEST_OWNER_DRAFT_GET_CAPS.contentBytes + 4096)
      assert(Object.keys(init).every(k => ['method', 'headers', 'body', 'signal', 'redirect'].includes(k))); assert(init.redirect === undefined || init.redirect === 'error')
      assert(!init.signal || init.signal instanceof AbortSignal); assert(!init.signal?.aborted)
      const headers = new Headers(init.headers)
      assert.equal(headers.get('authorization'), `Bearer ${target.SERVICE_ROLE_KEY}`); assert.equal(headers.get('apikey'), target.SERVICE_ROLE_KEY)
      const allowed: Record<string, readonly string[]> = { authorization: [`Bearer ${target.SERVICE_ROLE_KEY}`], apikey: [target.SERVICE_ROLE_KEY], 'x-client-info': ['supabase-js-node/2.93.3'], accept: ['application/json'], 'accept-profile': ['public'], 'content-profile': ['public'], 'content-type': ['application/json'] }
      for (const [name, value] of headers) assert(allowed[name]?.includes(value))
      const body: Record<string, unknown> = JSON.parse(init.body)
      assert(typeof body.p_deadline === 'string' && Number.isFinite(Date.parse(body.p_deadline)))
      const remaining = Date.parse(body.p_deadline) - Date.now(); assert(remaining > 0 && remaining <= TEST_OWNER_DRAFT_GET_CAPS.requestMs)
      if (url.pathname === paths[0]) {
        assert.equal(dispatched, 0); assert.deepEqual(Object.keys(body).sort(), [...manifest.snapshotKeys].sort())
        assert.deepEqual(body, { p_actor_id: context.actorId, p_test_id: context.testId, p_deadline: body.p_deadline }); deadline = body.p_deadline
        operation = 'snapshot'
      } else {
        assert.equal(dispatched, 1); assert(source && context.status === 200); assert.equal(body.p_deadline, deadline)
        assert.deepEqual(Object.keys(body).sort(), [...manifest.finalKeys].sort())
        assert.deepEqual(body, { p_actor_id: context.actorId, p_test_id: context.testId, p_classroom_id: context.classroomId,
          p_expected_source_sha256: source.source_sha256, p_operation: context.operation, p_content: candidate(source), p_deadline: deadline })
        assert(Buffer.byteLength(JSON.stringify(body.p_content)) <= TEST_OWNER_DRAFT_GET_CAPS.contentBytes); operation = context.operation
      }
      assert(++counts.network <= TEST_OWNER_DRAFT_GET_CAPS.networkRequests); assert(++counts.rpc <= TEST_OWNER_DRAFT_GET_CAPS.rpcRequests); assert(++dispatched <= 2)
      phase = 'guard'; await guard()
      assert(!init.signal?.aborted && Date.now() < Date.parse(deadline!))
      phase = 'dispatch'; const timeout = AbortSignal.timeout(Math.max(1, Date.parse(deadline!) - Date.now()))
      const response = await original(resource, { ...init, redirect: 'error', signal: init.signal ? AbortSignal.any([timeout, init.signal]) : timeout })
      assert(response.status < 300 || response.status >= 400); assert(!response.headers.has('location'))
      phase = 'decode'; const chunks: Uint8Array[] = []; let bytes = 0; const reader = response.body?.getReader()
      if (reader) for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.length
        if (bytes > TEST_OWNER_DRAFT_GET_CAPS.responseBytes || bytes > TEST_OWNER_DRAFT_GET_CAPS.exchangeBytes - counts.exchangeBytes) { await reader.cancel(); throw new Error('Response cap') }; chunks.push(part.value) }
      counts.exchangeBytes += bytes; const data = Buffer.concat(chunks)
      // Transport observes all successful first-phase sources before final
      // authority. Rejected service responses are left to the real helper.
      if (response.ok && url.pathname === paths[0]) bindSnapshot(JSON.parse(data.toString('utf8')))
      if (!response.ok) {
        const rejected: unknown = JSON.parse(data.toString('utf8'))
        if (rejected && typeof rejected === 'object' && !Array.isArray(rejected)
          && (rejected as Record<string, unknown>).code === '42501') evidence.rawPrivilegeFailures++
      }
      phase = 'complete'; return new Response(data, { status: response.status, headers: response.headers })
    } catch { throw new Error('Test owner draft GET proof transport rejected; private details withheld') }
  }
  return { target, fetch: safeFetch, counts, evidence, readContext, diagnostic: () => `DIAG test-owner-draft-get transport phase=${['idle', 'context', 'validate', 'guard', 'dispatch', 'decode', 'complete'].includes(phase) ? phase : 'unknown'} operation=${['unknown', 'snapshot', 'inspect', 'create', 'repair'].includes(operation) ? operation : 'unknown'} requests=${Math.min(counts.network, TEST_OWNER_DRAFT_GET_CAPS.networkRequests + 1)}.\n` }
}
export function testOwnerDraftGetForcedReceipt(mode: string, error: unknown, complete: boolean) {
  if (complete && ['after-fixture', 'before-capture'].includes(mode) && error instanceof AssignmentListLifecycleError && error.primary?.stage === mode
    && error.primary.error instanceof Error && error.primary.error.message === 'Forced isolated lifecycle failure' && !error.cleanupFailures.length)
    return { stdout: cleanupMarker, stderr: `FAIL forced isolated test-owner-draft-get lifecycle: ${mode}.\n`, exitCode: 1 }
  return null
}
export function testOwnerDraftGetSetupDiagnostic(stage: unknown, error: unknown) {
  const stages = ['pending', 'app-guard', 'app-write', 'app-snapshot', 'app-verify', 'sql-prepare', 'sql-setup', 'complete']
  const phase = typeof stage === 'string' && stages.includes(stage) ? stage : 'unknown'
  const lifecycle = error instanceof AssignmentListLifecycleError ? error : undefined
  const primaryStages = ['canonical-before', 'preflight', 'prepare', 'pre-start', 'start', 'capture', 'status', 'fixture', 'cases', 'revocations', 'after-fixture', 'before-capture']
  const primary = lifecycle?.primary?.stage
  const inherited = typeof primary === 'string' && primaryStages.includes(primary) ? primary : 'unknown'
  const cleanup = lifecycle ? lifecycle.cleanupFailures.length ? 'present' : 'none' : 'unknown'
  const cause = lifecycle ? lifecycle.primary?.error : error
  const kind = cause instanceof assert.AssertionError ? 'assertion'
    : cause instanceof Error && cause.message === 'Private platform command failed' ? 'platform-command' : 'unknown'
  return `DIAG test-owner-draft-get setup=${phase} lifecycle=${inherited} cleanup=${cleanup} failure=${kind}.\n`
}
export function parseTestOwnerDraftGetLifecycleArgs(args: string[]) {
  const generateTypes = args.length === 5 && args[4] === '--generate-types'
  const input = parseAssignmentListLifecycleArgs(generateTypes ? args.slice(0, 4) : args)
  assert(!generateTypes || input.mode === 'normal')
  return { ...input, generateTypes }
}
export function testOwnerDraftGetUnionManifest(original: ReturnType<typeof newAssignmentListProofFixture>, f: TestOwnerDraftGetFixture, reviewedHead: string, repository: string) {
  const sql = buildDraftGetNativeContractsManifest(original, reviewedHead, repository)
  const appIds = new Set(f.allocatedIds), originalIds = new Set(original.allocatedIds)
  assert(sql.fixture.allowedFixtureIds.every(id => !appIds.has(id) && !originalIds.has(id)))
  return Object.freeze({ version: 1, reviewedHead, originalSha256: testOwnerDigest(JSON.stringify(original.manifest)),
    application: testOwnerDraftGetRequestManifest(f), sql,
    inventory: Object.freeze({ actors: 7, classes: 5, tests: 16, questions: 1009, initialDrafts: 10, enrollments: 5,
      triggerCategories: 15, archiveRevisionRows: 5, activeGenerations: 5, sdkCases: 15, sdkCreates: 3, sdkRepairs: 1, privilegeDriftProbes: 1, sqlBaseAllocatedIds: 15, sqlRollbackBulkIds: 10001 }) })
}
export function validateTestOwnerDraftGetSetupSnapshot(f: TestOwnerDraftGetFixture, input: unknown): Rows {
  assert(input && typeof input === 'object' && !Array.isArray(input)); const rows = input as Rows
  const expected: Record<string, number> = { 'public.users': 4, 'public.classrooms': 3, 'public.tests': 12, 'public.gradebook_categories': 9, 'public.test_questions': 1008,
    'public.assessment_drafts': 7, 'public.test_attempts': 0, 'public.test_responses': 0, 'public.test_student_availability': 0, 'public.classroom_enrollments': 4,
    'public.classroom_roster': 0, 'public.classroom_archive_revisions': 3, 'public.managed_storage_objects': 0, 'public.managed_storage_json_references': 0,
    'public.pal_event_outbox': 0, 'private.pal_membership_outbox': 0, 'private.pal_membership_generations': 4, 'private.pal_membership_settings': 1, 'private.pal_classroom_signal_settings': 1,
    '__nontarget_fingerprints': Array.isArray(rows.__nontarget_fingerprints) ? rows.__nontarget_fingerprints.length : -1 }
  assert(expected.__nontarget_fingerprints > 0)
  assert.equal(new Set(rows.__nontarget_fingerprints.map(r => r.table)).size, expected.__nontarget_fingerprints)
  assert(rows.__nontarget_fingerprints.every(r => typeof r.table === 'string' && /^(public|private|storage)\.[a-zA-Z0-9_]+$/.test(r.table) && typeof r.fingerprint === 'string' && r.fingerprint.length > 0))
  assert.deepEqual(Object.keys(rows).sort(), Object.keys(expected).sort())
  for (const [table, count] of Object.entries(expected)) { assert(Array.isArray(rows[table])); assert.equal(rows[table].length, count); assert(rows[table].every(r => r && typeof r === 'object' && !Array.isArray(r))) }
  function subset(table: string, plans: Array<{ id: string }>) {
    assert.equal(new Set(rows[table].map(r => r.id)).size, plans.length)
    for (const plan of plans) { const row = rows[table].find(r => r.id === plan.id); assert(row); for (const [key, value] of Object.entries(plan)) {
      if (value !== null && (key === 'blueprint_archived_at' || key === 'questions_locked_at')) assert.equal(new Date(String(row[key])).toISOString(), value)
      else assert.deepEqual(row[key], value)
    } }
  }
  subset('public.users', f.actors); subset('public.tests', f.tests); subset('public.test_questions', f.questions); subset('public.assessment_drafts', f.drafts); subset('public.classroom_enrollments', f.enrollments)
  for (const [i, c] of f.classes.entries()) {
    const row = rows['public.classrooms'].find(r => r.id === c.id); assert(row)
    assert.equal(row.teacher_id, c.owner); assert.equal(row.title, c.title); assert.equal(row.class_code, c.code)
    assert.equal(row.archived_at === null, !c.archived); if (c.archived) assert.equal(new Date(String(row.archived_at)).toISOString(), f.now)
    assert((row.feature_visibility as Record<string, unknown>).classwork === false)
    assert.equal(row.blueprint_source_revision, f.sideEffects[i].blueprintSourceRevision)
    const revision = rows['public.classroom_archive_revisions'].find(r => r.classroom_id === c.id); assert(revision)
    assert.deepEqual(Object.keys(revision).sort(), ['classroom_id', 'revision', 'updated_at']); assert.equal(revision.revision, f.sideEffects[i].archiveRevision)
    assert(Number.isFinite(Date.parse(String(revision.updated_at))))
    const categories = rows['public.gradebook_categories'].filter(r => r.classroom_id === c.id); assert.equal(categories.length, 3)
    for (const [name, percentage, position, isDefault] of [['Attendance', 10, 0, false], ['Term', 65, 1, true], ['Final', 25, 2, false]]) {
      const category = categories.find(r => r.name === name); assert(category && category.percentage === percentage && category.position === position && category.is_default === isDefault && category.default_assessment_weight === 10)
      assert(typeof category.id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(category.id) && !f.allocatedIds.includes(category.id))
    }
  }
  assert.equal(new Set(rows['public.gradebook_categories'].map(r => r.id)).size, 9)
  for (const e of f.enrollments) {
    const generation = rows['private.pal_membership_generations'].find(r => r.generation_id === e.id); assert(generation)
    assert.equal(generation.state, 'active'); assert.equal(generation.scope_digest, testOwnerDigest(`pika-membership-scope-v1:${e.classroom_id}:${e.student_id}`))
    assert(typeof generation.pal_reference === 'string' && /^pika-membership-v1-[a-f0-9]{32}$/.test(generation.pal_reference))
  }
  assert.equal(new Set(rows['private.pal_membership_generations'].map(r => r.pal_reference)).size, 4)
  assert(rows['private.pal_membership_settings'][0].enabled === false && rows['private.pal_classroom_signal_settings'][0].enabled === false)
  for (const d of rows['public.assessment_drafts']) for (const key of ['created_at', 'updated_at']) assert(Number.isFinite(Date.parse(String(d[key]))))
  return rows
}
export function verifyTestOwnerDraftGetEffects(f: TestOwnerDraftGetFixture, proofCase: TestOwnerDraftGetFixture['cases'][number], before: Rows, after: Rows, response: unknown, originalIds: readonly string[] = []) {
  if (proofCase.status !== 200 || proofCase.operation === 'inspect') { assert.deepEqual(after, before); return }
  assert(response && typeof response === 'object'); const result = response as { draft: Record<string, unknown>; editingPolicy: { structureLocked: boolean } }
  assert.deepEqual(Object.keys(result).sort(), ['draft', 'editingPolicy'])
  const row = after['public.assessment_drafts'].find(d => d.assessment_id === proofCase.testId && d.assessment_type === 'test'); assert(row)
  assert.deepEqual(row, result.draft); assert.equal(row.classroom_id, proofCase.classroomId)
  const prior = before['public.assessment_drafts'].find(d => d.assessment_id === proofCase.testId && d.assessment_type === 'test')
  if (proofCase.operation === 'create') {
    assert(!prior); assert.equal(row.version, 1); assert.equal(row.created_by, proofCase.actorId); assert.equal(row.updated_by, proofCase.actorId)
    assert.equal(row.created_at, row.updated_at); assert(typeof row.id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(row.id))
    assert(!f.allocatedIds.includes(row.id) && !originalIds.includes(row.id))
  } else {
    assert(prior); assert.equal(row.id, prior.id); assert.equal(row.version, Number(prior.version) + 1)
    assert.equal(row.created_by, prior.created_by); assert.equal(row.created_at, prior.created_at); assert.equal(row.updated_by, proofCase.actorId)
    assert(Date.parse(String(row.updated_at)) >= Date.parse(String(prior.updated_at)))
  }
  assert.deepEqual(after.__nontarget_fingerprints, before.__nontarget_fingerprints)
  const changes = assignmentListRowChanges(Object.fromEntries(Object.entries(before).filter(([k]) => k !== '__nontarget_fingerprints')), Object.fromEntries(Object.entries(after).filter(([k]) => k !== '__nontarget_fingerprints')))
  assert(changes.every(c => c.schema === 'public' && (
    c.table === 'assessment_drafts' && c.id === row.id && c.columns.every(k => proofCase.operation === 'create' ? k === '__row__' : ['content', 'version', 'updated_by', 'updated_at'].includes(k))
    || c.table === 'classrooms' && c.id === proofCase.classroomId && c.columns.every(k => ['blueprint_source_revision', 'updated_at'].includes(k))
    || c.table === 'classroom_archive_revisions' && c.id === proofCase.classroomId && c.columns.every(k => ['revision', 'updated_at'].includes(k)))))
  assert.equal(changes.length, 3)
  assert.equal(after['public.assessment_drafts'].length - before['public.assessment_drafts'].length, proofCase.operation === 'create' ? 1 : 0)
  for (const [table, identity, column, delta] of [['public.classrooms', 'id', 'blueprint_source_revision', 1], ['public.classroom_archive_revisions', 'classroom_id', 'revision', 2]] as const) {
    const a = before[table].find(r => r[identity] === proofCase.classroomId)!; const b = after[table].find(r => r[identity] === proofCase.classroomId)!; assert.equal(Number(b[column]) - Number(a[column]), delta)
    assert(Number.isFinite(Date.parse(String(b.updated_at))) && Date.parse(String(b.updated_at)) >= Date.parse(String(a.updated_at)))
  }
}

/** The SQL adapter restores its grant/catalog/fixture in its own finally. The
 * application fixture has a different scope, so its comparison must run even
 * when the SDK callback or adapter restoration rejects. No writes or SQL here. */
export async function verifyTestOwnerDraftGetPrivilegeRestoration(
  before: Rows, snapshot: () => Promise<Rows>,
  probe: () => Promise<{ privilegeRestored: boolean; fixtureUnchanged: boolean; snapshotAclSha256: string }>,
) {
  try {
    const receipt = await probe()
    assert(receipt.privilegeRestored && receipt.fixtureUnchanged)
    assert.match(receipt.snapshotAclSha256, /^[a-f0-9]{64}$/)
    return receipt
  } finally {
    assert.deepEqual(await snapshot(), before, 'Application privilege-probe rows changed')
  }
}

export async function testOwnerDraftGetLifecycleMain(args = process.argv.slice(2)) {
  const input = parseTestOwnerDraftGetLifecycleArgs(args)
  const git = (values: string[]) => execFileSync('git', values, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 }).trim()
  assert.equal(git(['rev-parse', 'HEAD']), input.head); assert.equal(git(['status', '--porcelain']), ''); const repository = git(['rev-parse', '--show-toplevel']); assert.equal(repository, process.cwd())
  const migrations = loadAssignmentListReviewedMigrations(repository); assert.equal(migrations.length, 247)
  const original = newAssignmentListProofFixture(); const f = newTestOwnerDraftGetFixture(original); const projectId = `pika_assignment_list_${original.manifest.syntheticTag.slice(-12)}`
  const native = createAssignmentListNativeAdapters(original); const originalSetup = assignmentListFixtureSetupSql(original, projectId)
  const setupSql = testOwnerDraftGetSetupSql(f, projectId); const snapshotSql = testOwnerDraftGetSnapshotSql(f)
  const setupHash = testOwnerDigest(setupSql); const snapshotHash = testOwnerDigest(snapshotSql)
  const union = testOwnerDraftGetUnionManifest(original, f, input.head, repository); const unionHash = testOwnerDigest(JSON.stringify(union))
  let target: ReturnType<typeof validateAssignmentListProofTarget> | undefined; let session: Session | undefined; let complete = false; let matrixComplete = false
  let closure: Awaited<ReturnType<typeof assignmentListDockerInventory>> | undefined
  let transport: ReturnType<typeof createTestOwnerDraftGetProofTransport> | undefined; let client: ReturnType<typeof createClient<Database>> | undefined
  let sqlContracts: ReturnType<typeof createDraftGetNativeContracts> | undefined; let sqlComplete = false
  let setupStage = 'pending'
  let typesReceipt: Awaited<ReturnType<typeof generateTestDraftGetTypes>> | undefined
  const originalPal = process.env.PAL_ENABLED; process.env.PAL_ENABLED = 'false'
  function privateSql(sql: string) {
    assert(session && [testOwnerGuardSql(projectId), snapshotSql].includes(sql))
    return execFileSync('docker', ['exec', '-i', '-e', `PGAPPNAME=${projectId}_fixture`, session.containerId, 'psql', '-U', 'postgres', '-d', 'postgres', '-XqAt', '-v', 'ON_ERROR_STOP=1'],
      { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 45000, maxBuffer: TEST_OWNER_DRAFT_GET_CAPS.responseBytes }).trim()
  }
  async function guard() {
    assert(target && session); closure = validateIntegratedGuardResources(await testOwnerListDockerInventory(), projectId, session.containerId, closure)
    assert.equal(privateSql(testOwnerGuardSql(projectId)), 'ok')
  }
  async function snapshot(): Promise<Rows> {
    assert.equal(testOwnerDigest(snapshotSql), snapshotHash); await guard(); const captured = privateSql(snapshotSql)
    assert(Buffer.byteLength(captured) <= TEST_OWNER_DRAFT_GET_CAPS.responseBytes); return JSON.parse(captured)
  }
  async function setup() {
    setupStage = 'app-guard'; assert.equal(testOwnerDigest(setupSql), setupHash); await guard(); assert(session)
    setupStage = 'app-write'; await native.executeSql({ ...session, sql: setupSql })
    setupStage = 'app-snapshot'; const setupRows = await snapshot()
    setupStage = 'app-verify'; validateTestOwnerDraftGetSetupSnapshot(f, setupRows); assert(closure)
    assert.equal(testOwnerDigest(JSON.stringify(union)), unionHash)
    setupStage = 'sql-prepare'
    sqlContracts = createDraftGetNativeContracts({ repository, reviewedHead: input.head, original, capturedResources: closure, containerId: session.containerId,
      acceptedManifestSha256: testOwnerDigest(JSON.stringify(union.sql)) })
    setupStage = 'sql-setup'; const receipt = await sqlContracts.setup(); assert.equal(receipt.fixtureSha256, testOwnerDigest(JSON.stringify(union.sql.fixture)))
    assert.equal(receipt.setupSha256, testOwnerDigest(union.sql.setup)); complete = true; setupStage = 'complete'
  }
  async function matrix() {
    assert(complete && !matrixComplete && client && transport)
    const { getContextualTestDraft } = await import('../src/lib/server/contextual-test-draft-get')
    for (const proofCase of f.cases) {
      const before = await snapshot(); transport.readContext(proofCase.testId, proofCase.actorId, before); const count = transport.counts.rpc
      const read = () => getContextualTestDraft({ supabase: client!, actorId: proofCase.actorId, testId: proofCase.testId })
      let result: Awaited<ReturnType<typeof getContextualTestDraft>> | undefined
      if (proofCase.status === 403) await assert.rejects(read, e => e instanceof ApiError && e.statusCode === 403)
      else { result = await read(); assert.deepEqual(Object.keys(result).sort(), ['draft', 'editingPolicy']); assert.equal(result.editingPolicy.structureLocked, f.tests.find(t => t.id === proofCase.testId)!.questions_locked_at !== null) }
      assert.equal(transport.counts.rpc - count, proofCase.status === 200 ? 2 : 1)
      verifyTestOwnerDraftGetEffects(f, proofCase, before, await snapshot(), result, original.allocatedIds)
    }
    assert.equal(transport.counts.storage, 0); assert.equal(transport.counts.rpc, 24)
    assert(transport.evidence.emptySource > 0 && transport.evidence.nonemptySource > 0); assert.equal(transport.evidence.complete1001Source, 1)
    assert(sqlContracts)
    const beforePrivilege = await snapshot()
    const privilegeCase = f.cases.find(c => c.status === 200 && c.operation === 'inspect'); assert(privilegeCase)
    await verifyTestOwnerDraftGetPrivilegeRestoration(beforePrivilege, snapshot, () => sqlContracts!.probeSnapshotPrivilegeDrift(async () => {
      const rpcBefore = transport!.counts.rpc, errorsBefore = transport!.evidence.rawPrivilegeFailures
      transport!.readContext(privilegeCase.testId, privilegeCase.actorId, beforePrivilege)
      await assert.rejects(() => getContextualTestDraft({ supabase: client!, actorId: privilegeCase.actorId, testId: privilegeCase.testId }),
        e => e instanceof ApiError && e.statusCode === 503)
      assert.equal(transport!.counts.rpc - rpcBefore, 1)
      assert.equal(transport!.evidence.rawPrivilegeFailures - errorsBefore, 1)
      return { status: 503 as const, rpcCalls: 1 as const, rawCode: '42501' as const }
    }))
    assert.equal(transport.counts.rpc, 25); assert.equal(transport.evidence.rawPrivilegeFailures, 1)
    assert(sqlContracts); const beforeContracts = await snapshot(); const receipt = await sqlContracts.run()
    assert(receipt.fixtureUnchanged); assert.equal(receipt.manifestSha256, testOwnerDigest(JSON.stringify(union.sql)))
    assert.deepEqual(await snapshot(), beforeContracts); sqlComplete = true; matrixComplete = true
    if (input.generateTypes) {
      assert(input.mode === 'normal' && complete && matrixComplete && sqlComplete)
      typesReceipt = await generateTestDraftGetTypes({ repository, reviewedHead: input.head, projectId, guard })
    }
  }
  try {
    await runAssignmentListEphemeralLifecycle({ fixture: original, projectId, workdir: assignmentListProofWorkdir(projectId), migrations, mode: input.mode,
      expectedResources: assignmentListExpectedResources(projectId), reviewedManifestSha256: testOwnerDigest(JSON.stringify(original.manifest)),
      restorationPolicies: assignmentListRevocationPlans(original).map(plan => assignmentListRestorationPolicy(original, plan)) },
    { ...native, async command(request) { const result = await native.command(request); if (request.args[0] === 'status') target = validateAssignmentListProofTarget(result, projectId); return result },
      async executeSql(request) { await native.executeSql(request); if (request.sql === originalSetup) { assert(!session && target); session = { ...request }
        transport = createTestOwnerDraftGetProofTransport(f, target, projectId, fetch, guard)
        client = createClient<Database>(target.API_URL, target.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport.fetch } }); await setup() } },
      async runCase(request) { const result = await native.runCase(request); if (!matrixComplete) await matrix(); return result } })
    assert(complete && matrixComplete && sqlComplete)
    process.stdout.write(`PASS isolated test-owner-draft-get fifteen actual installed-SDK helper/RPC cases including complete 1001-question source; exact restored privilege-drift probe; rollback SQL contracts and two-session schedules.\n${cleanupMarker}`)
    return Object.freeze({ types: typesReceipt ?? null })
  } catch (error) {
    const receipt = testOwnerDraftGetForcedReceipt(input.mode, error, complete)
    if (receipt) { process.stdout.write(receipt.stdout); process.stderr.write(receipt.stderr); process.exitCode = receipt.exitCode; return }
    process.stderr.write(testOwnerDraftGetSetupDiagnostic(setupStage, error))
    if (transport) process.stderr.write(transport.diagnostic()); throw new Error('Test owner draft GET lifecycle failed; private details withheld')
  } finally { if (originalPal === undefined) delete process.env.PAL_ENABLED; else process.env.PAL_ENABLED = originalPal }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) testOwnerDraftGetLifecycleMain().catch(() => {
  process.stderr.write('FAIL isolated test-owner-draft-get lifecycle; private details withheld.\n'); process.exitCode = 1
})
