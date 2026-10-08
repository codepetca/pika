/** Dormant finite SDK proof. Fixed-source review and explicit parent acceptance
 * precede execution. Import is inert; this is not HTTP/browser/race evidence. */
import assert from 'node:assert/strict'
import { createContextualProofTimings, extractContextualProofTimingArgs } from './contextual-proof-timings'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/database'
import { ApiError } from '../src/lib/api-error'
import { newAssignmentListProofFixture, assignmentListFixtureSetupSql } from './contextual-assignment-list-proof-fixture'
import { runAssignmentListEphemeralLifecycle, AssignmentListLifecycleError, type AssignmentListLifecycleAdapters } from './contextual-assignment-list-proof-lifecycle'
import { createAssignmentListNativeAdapters, loadAssignmentListReviewedMigrations, assignmentListExpectedResources,
  assignmentListRestorationPolicy, assignmentListDockerInventory } from './contextual-assignment-list-proof-platform'
import { assignmentListRevocationPlans } from './contextual-assignment-list-proof-revocations'
import { testOwnerListDockerInventory } from './contextual-test-owner-list-proof-inventory'
import { assignmentListProofWorkdir } from './contextual-assignment-list-proof-path'
import { validateAssignmentListProofTarget } from './check-contextual-assignment-list-reads'
import { parseAssignmentListLifecycleArgs } from './check-contextual-assignment-list-lifecycle'
import { validateIntegratedGuardResources } from './check-contextual-assignment-learner-integrated-lifecycle'
import { newTestOwnerListFixture, testOwnerListSetupSql, testOwnerListSnapshotSql, testOwnerDigest, testOwnerGuardSql,
  TEST_OWNER_LIST_CAPS, type TestOwnerListFixture } from './contextual-test-owner-list-proof-fixture'

const API = 'http://127.0.0.1:54331'
const root = 'id,teacher_id,archived_at'
const fields = 'id,classroom_id,title,status,show_results,documents,position,points_possible,include_in_final,created_by,created_at,updated_at,artifact_id,source_artifact_id,source_blueprint_version_id,blueprint_archived_at,gradebook_category_id,gradebook_maximum_override,gradebook_score_scale,gradebook_weight,questions_locked_at'
const controls = 'id,classroom_id,status,updated_at'
const relation = 'tests:tests!tests_classroom_id_fkey'
const draft = 'drafts:assessment_drafts!assessment_drafts_classroom_id_fkey(id,assessment_id,assessment_type,classroom_id,version,content)'
const participant = (table: string) => `participant:users!${table}_student_id_fkey!inner(id,enrollment:classroom_enrollments!classroom_enrollments_student_id_fkey!inner(classroom_id,student_id))`
export const TEST_OWNER_LIST_PROJECTIONS = Object.freeze({ root, tests: `${root},${relation}(${fields})`,
  roster: `${root},enrollments:classroom_enrollments!classroom_enrollments_classroom_id_fkey(classroom_id,student_id)`,
  questions: `${root},${relation}!inner(${controls},questions:test_questions!test_questions_test_id_fkey(id,test_id))`,
  attempts: `${root},${relation}!inner(${controls},attempts:test_attempts!test_attempts_test_id_fkey(id,test_id,student_id,is_submitted,${participant('test_attempts')}))`,
  responses: `${root},${relation}!inner(${controls},responses:test_responses!test_responses_test_id_fkey(id,test_id,student_id,selected_option,response_text,${participant('test_responses')}))`,
  availability: `${root},${relation}!inner(${controls},availability:test_student_availability!test_student_availability_test_id_fkey(id,test_id,student_id,state,${participant('test_student_availability')}))`,
  drafts: `${root},${relation}!inner(${controls}),${draft}`, final: `${root},${relation}!inner(${controls})` })
type Kind = 'questions' | 'attempts' | 'responses' | 'availability'
const kinds: Kind[] = ['questions', 'attempts', 'responses', 'availability']
const cleanupMarker = 'PASS isolated test-owner-list exact teardown and unchanged canonical baseline.\n'
type Session = Parameters<AssignmentListLifecycleAdapters['executeSql']>[0]
export function testOwnerListRequestManifest(f: TestOwnerListFixture) {
  return Object.freeze({ version: 1, fixture: f, projections: TEST_OWNER_LIST_PROJECTIONS, caps: TEST_OWNER_LIST_CAPS, method: 'GET', origin: API, path: '/rest/v1/classrooms', sdk: 'supabase-js-node/2.93.3' })
}

/** Independently frozen projections: never reflect an app query into authority. */
export function createTestOwnerListProofTransport(f: TestOwnerListFixture, rawTarget: unknown, projectId: string, original: typeof fetch, guard: () => Promise<void>) {
  assert.equal(projectId, `pika_assignment_list_${f.tag.slice(-12)}`)
  const target = validateAssignmentListProofTarget(rawTarget, projectId); assert.equal(target.API_URL, API)
  const manifest = testOwnerListRequestManifest(f); const manifestHash = testOwnerDigest(JSON.stringify(manifest))
  let context: { classroomId: string; actorId: string } | undefined; let preflight = false
  const stamps = new Map<string, string>()
  const counts = { network: 0, storage: 0, rpc: 0 }
  const evidence = { testsEmpty: 0, rosterEmpty: 0, questionsEmpty: 0, attemptsEmpty: 0, responsesEmpty: 0, availabilityEmpty: 0, draftsEmpty: 0, final: 0 }
  let phase = 'idle'
  let caseIndex = -1; let contextStarted: number | undefined; let guardMs = 0; let guardStarted: number | undefined; let frozenDiagnostic: string | undefined
  let projection: keyof typeof TEST_OWNER_LIST_PROJECTIONS | 'unknown' = 'unknown'
  let callerAborted = false; let failure: 'none' | 'aborted' | 'timeout' | 'rejected' = 'none'; let http = 0
  const boundedMs = (value: number) => Math.min(60000, Math.max(0, Math.trunc(value)))
  function readContext(classroomId: string, actorId: string) {
    assert(f.classes.some(c => c.id === classroomId)); assert(f.actors.some(a => a.id === actorId))
    context = { classroomId, actorId }; preflight = false; stamps.clear()
    caseIndex = f.cases.findIndex(c => c.classroomId === classroomId && c.actorId === actorId)
    contextStarted = Date.now(); guardMs = 0; guardStarted = undefined; frozenDiagnostic = undefined; projection = 'unknown'; callerAborted = false; failure = 'none'; http = 0
  }
  function validate(url: URL) {
    assert(context); const { classroomId, actorId } = context
    const select = url.searchParams.get('select'); assert(select && Object.values(TEST_OWNER_LIST_PROJECTIONS).includes(select))
    for (const key of new Set(url.searchParams.keys())) assert(url.searchParams.getAll(key).length <= (select === TEST_OWNER_LIST_PROJECTIONS.roster && key === 'enrollments.student_id' ? 2 : 1))
    const expected: Record<string, string> = { select, id: `eq.${classroomId}` }
    if (select === root && !url.searchParams.has('teacher_id')) { assert(!preflight); preflight = true }
    else { assert(preflight); assert.equal(f.classes.find(c => c.id === classroomId)!.owner, actorId); expected.teacher_id = `eq.${actorId}` }
    const batch = f.tests.filter(t => t.classroom_id === classroomId).sort((a, b) => a.id.localeCompare(b.id))
    const cursor = (key: string, ids: string[]) => { const value = url.searchParams.get(key); if (value) { assert(ids.includes(value.slice(3)) && value.startsWith('gt.')); expected[key] = value } }
    if (select === TEST_OWNER_LIST_PROJECTIONS.tests) {
      Object.assign(expected, { 'tests.classroom_id': `eq.${classroomId}`, 'tests.order': 'id.asc', 'tests.limit': '1000' }); cursor('tests.id', batch.map(t => t.id))
    } else if (select === TEST_OWNER_LIST_PROJECTIONS.roster) {
      Object.assign(expected, { 'enrollments.student_id': `neq.${actorId}`, 'enrollments.order': 'student_id.asc', 'enrollments.limit': '1000' })
      const values = url.searchParams.getAll('enrollments.student_id')
      assert.equal(values[0], `neq.${actorId}`)
      if (values.length === 2) assert(values[1].startsWith('gt.') && f.enrollments.some(e => e.classroomId === classroomId && e.actorId !== actorId && e !== f.enrollments[3] && values[1] === `gt.${e.actorId}`))
    } else if (select !== root) {
      assert(batch.length && batch.every(t => stamps.has(t.id)))
      Object.assign(expected, { 'tests.classroom_id': `eq.${classroomId}`, 'tests.id': `in.(${batch.map(t => t.id).join(',')})`,
        'tests.or': `(${batch.map(t => `and(id.eq.${t.id},status.eq.${t.status},updated_at.eq.${stamps.get(t.id)})`).join(',')})`, 'tests.order': 'id.asc', 'tests.limit': '50' })
      const kind = kinds.find(k => TEST_OWNER_LIST_PROJECTIONS[k] === select)
      if (kind) {
        const ref = `tests.${kind}`
        Object.assign(expected, { [`${ref}.order`]: 'id.asc', [`${ref}.limit`]: '100' })
        if (kind !== 'questions') Object.assign(expected, { [`${ref}.student_id`]: `neq.${actorId}`, [`${ref}.participant.enrollment.classroom_id`]: `eq.${classroomId}` })
        cursor(`${ref}.id`, f[kind].filter(r => batch.some(t => t.id === r.test_id)).map(r => r.id))
      } else if (select === TEST_OWNER_LIST_PROJECTIONS.drafts) {
        Object.assign(expected, { 'drafts.assessment_type': 'eq.test', 'drafts.classroom_id': `eq.${classroomId}`, 'drafts.assessment_id': `in.(${batch.map(t => t.id).join(',')})`, 'drafts.order': 'id.asc', 'drafts.limit': '1000' })
        cursor('drafts.id', f.drafts.filter(d => d.classroom_id === classroomId).map(d => d.id))
      }
    }
    const actual = new URLSearchParams(url.searchParams)
    if (select === TEST_OWNER_LIST_PROJECTIONS.roster) actual.set('enrollments.student_id', `neq.${actorId}`)
    assert.deepEqual(Object.fromEntries(actual), expected); return select
  }
  const safeFetch: typeof fetch = async (resource, init) => {
    try {
      projection = 'unknown'; callerAborted = false; failure = 'none'; http = 0
      phase = 'validate'; assert.equal(testOwnerDigest(JSON.stringify(manifest)), manifestHash); assert(!(resource instanceof Request))
      const url = new URL(String(resource)); assert.equal(url.origin, API); assert.equal(url.pathname, '/rest/v1/classrooms'); assert(!url.username && !url.password && !url.hash)
      assert.equal(init?.method ?? 'GET', 'GET'); assert(init?.body === undefined || init.body === null)
      assert(Object.keys(init ?? {}).every(k => ['method', 'headers', 'body', 'signal', 'redirect'].includes(k)))
      assert(init?.redirect === undefined || init.redirect === 'error'); assert(!init?.signal || init.signal instanceof AbortSignal)
      const headers = new Headers(init?.headers); assert.equal(headers.get('authorization'), `Bearer ${target.SERVICE_ROLE_KEY}`); assert.equal(headers.get('apikey'), target.SERVICE_ROLE_KEY)
      const allowed: Record<string, readonly string[]> = { authorization: [`Bearer ${target.SERVICE_ROLE_KEY}`], apikey: [target.SERVICE_ROLE_KEY], 'x-client-info': ['supabase-js-node/2.93.3'], accept: ['application/json'], 'accept-profile': ['public'], 'content-profile': ['public'], 'content-type': ['application/json'] }
      for (const [name, value] of headers) assert(allowed[name]?.includes(value))
      const select = validate(url); assert(++counts.network <= TEST_OWNER_LIST_CAPS.networkRequests)
      projection = (Object.keys(TEST_OWNER_LIST_PROJECTIONS) as Array<keyof typeof TEST_OWNER_LIST_PROJECTIONS>).find(key => TEST_OWNER_LIST_PROJECTIONS[key] === select) ?? 'unknown'
      phase = 'guard'; guardStarted = Date.now()
      try { await guard() } finally { guardMs = boundedMs(guardMs + boundedMs(Date.now() - guardStarted)); guardStarted = undefined }
      phase = 'dispatch'
      const timeout = AbortSignal.timeout(TEST_OWNER_LIST_CAPS.requestMs)
      const response = await original(resource, { ...init, redirect: 'error', signal: init?.signal ? AbortSignal.any([timeout, init.signal]) : timeout })
      http = Number.isInteger(response.status) && response.status >= 100 && response.status <= 599 ? response.status : 0
      assert(response.status < 300 || response.status >= 400); assert(!response.headers.has('location'))
      phase = 'decode'; const chunks: Uint8Array[] = []; let bytes = 0; const reader = response.body?.getReader()
      if (reader) for (;;) { const part = await reader.read(); if (part.done) break; bytes += part.value.length
        if (bytes > TEST_OWNER_LIST_CAPS.responseBytes) { await reader.cancel(); throw new Error('Response cap') } chunks.push(part.value) }
      const body = Buffer.concat(chunks)
      if (response.ok && context) {
        const decoded: unknown = JSON.parse(body.toString('utf8')); const row = Array.isArray(decoded) ? decoded.length === 1 ? decoded[0] : undefined : decoded
        if (row && typeof row === 'object') {
          const value = row as Record<string, unknown>
          if (select === TEST_OWNER_LIST_PROJECTIONS.tests && Array.isArray(value.tests)) {
            for (const item of value.tests) {
              assert(item && typeof item === 'object'); const t = item as Record<string, unknown>; const planned = f.tests.find(p => p.id === t.id)
              assert(planned && planned.classroom_id === context.classroomId && t.classroom_id === planned.classroom_id && t.status === planned.status)
              assert(typeof t.updated_at === 'string' && Number.isFinite(Date.parse(t.updated_at))); assert.equal(new Date(t.updated_at).toISOString(), f.now)
              stamps.set(planned.id, t.updated_at)
            }
            if (!value.tests.length) evidence.testsEmpty++
          }
          if (select === TEST_OWNER_LIST_PROJECTIONS.roster && Array.isArray(value.enrollments) && !value.enrollments.length) evidence.rosterEmpty++
          for (const kind of kinds) if (select === TEST_OWNER_LIST_PROJECTIONS[kind] && Array.isArray(value.tests) && value.tests.every(p => p && typeof p === 'object' && Array.isArray(p[kind]) && !p[kind].length)) evidence[`${kind}Empty`]++
          if (select === TEST_OWNER_LIST_PROJECTIONS.drafts && Array.isArray(value.drafts) && !value.drafts.length) evidence.draftsEmpty++
          if (select === TEST_OWNER_LIST_PROJECTIONS.final || select === root && url.searchParams.has('teacher_id')) evidence.final++
        }
      }
      phase = 'complete'; return new Response(body, { status: response.status, headers: response.headers })
    } catch (error) {
      callerAborted = init?.signal instanceof AbortSignal && init.signal.aborted
      failure = callerAborted || error instanceof Error && error.name === 'AbortError' ? 'aborted' : error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'rejected'
      throw new Error('Test owner list proof transport rejected; private details withheld')
    }
  }
  const diagnosticLine = () => `DIAG test-owner-list transport phase=${phase} requests=${Math.min(counts.network, TEST_OWNER_LIST_CAPS.networkRequests + 1)} case=${caseIndex >= 0 && caseIndex < 8 ? caseIndex : 'unknown'} projection=${projection} contextMs=${contextStarted === undefined ? 0 : boundedMs(Date.now() - contextStarted)} guardMs=${boundedMs(guardMs + (guardStarted === undefined ? 0 : boundedMs(Date.now() - guardStarted)))} callerAborted=${callerAborted} failure=${failure} http=${http}.\n`
  return { target, fetch: safeFetch, counts, evidence, readContext, diagnostic: () => frozenDiagnostic ?? diagnosticLine(), freezeDiagnostic: () => { frozenDiagnostic ??= diagnosticLine() } }
}

export function testOwnerListForcedReceipt(mode: string, error: unknown, complete: boolean) {
  if (complete && ['after-fixture', 'before-capture'].includes(mode) && error instanceof AssignmentListLifecycleError && error.primary?.stage === mode
    && error.primary.error instanceof Error && error.primary.error.message === 'Forced isolated lifecycle failure' && !error.cleanupFailures.length)
    return { stdout: cleanupMarker, stderr: `FAIL forced isolated test-owner-list lifecycle: ${mode}.\n`, exitCode: 1 }
  return null
}
const setupCheckpoints = ['shape', 'counts-users', 'counts-classrooms', 'counts-tests', 'counts-categories', 'counts-questions', 'counts-drafts', 'counts-attempts', 'counts-responses', 'counts-availability',
  'counts-enrollments', 'counts-roster', 'counts-archive-revisions', 'counts-objects', 'counts-references', 'counts-pal-events', 'counts-membership-outbox', 'counts-generations', 'counts-membership-settings', 'counts-signal-settings',
  'actors', 'classrooms', 'questions', 'work', 'drafts', 'revisions', 'categories', 'tests', 'generations', 'settings', 'complete'] as const
type SetupCheckpoint = typeof setupCheckpoints[number]
export function testOwnerListFailureDiagnostic(error: unknown, step: string, checkpoint?: string) {
  const stages = new Set(['canonical-before', 'preflight', 'prepare', 'pre-start', 'start', 'capture', 'status', 'fixture', 'cases', 'revocations', 'after-fixture', 'before-capture'])
  const failure = error instanceof AssignmentListLifecycleError ? error : undefined
  const safeStep = ['not-started', 'setup', 'setup-guard', 'setup-sql', 'setup-snapshot', 'setup-validate', 'setup-complete', 'matrix', 'matrix-before', 'matrix-denial',
    'matrix-request-count', 'matrix-owner', 'matrix-expected', 'matrix-after-read', 'matrix-equality', 'matrix-evidence', 'matrix-complete'].includes(step) ? step : 'unknown'
  const safeCheckpoint = setupCheckpoints.includes(checkpoint as SetupCheckpoint) ? checkpoint : 'unknown'
  return `DIAG isolated test-owner-list stage=${failure?.primary && stages.has(failure.primary.stage) ? failure.primary.stage : 'unknown'} step=${safeStep} checkpoint=${safeCheckpoint} cleanup=${failure ? failure.cleanupFailures.length ? 'present' : 'none' : 'unknown'}.\n`
}

/** Closed metadata only; preserves the matrix's original constructor assertion.
 * Own data descriptors avoid invoking an arbitrary SDK error getter. */
export function testOwnerListReadDiagnostic(error: unknown) {
  const kind = error instanceof ApiError ? 'api-error' : error instanceof Error ? 'other-error' : 'unknown'
  const value: unknown = error instanceof Error ? Object.getOwnPropertyDescriptor(error, 'statusCode')?.value : undefined
  const status = typeof value === 'number' && [400, 403, 404, 503].includes(value) ? value : 0
  return `DIAG test-owner-list read kind=${kind} status=${status}.\n`
}

type Snapshot = Record<string, Array<Record<string, unknown>>>
export function validateTestOwnerListSetupSnapshot(f: TestOwnerListFixture, input: unknown, checkpoint: (value: SetupCheckpoint) => void = () => {}) : Snapshot {
  checkpoint('shape')
  assert(input && typeof input === 'object' && !Array.isArray(input)); const snapshot = input as Snapshot
  const expectedCounts: Record<string, number> = { 'public.users': 5, 'public.classrooms': 3, 'public.tests': 4, 'public.gradebook_categories': 9, 'public.test_questions': 4,
    'public.assessment_drafts': 2, 'public.test_attempts': 4, 'public.test_responses': 5, 'public.test_student_availability': 5, 'public.classroom_enrollments': 4,
    'public.classroom_roster': 0, 'public.classroom_archive_revisions': 3, 'public.managed_storage_objects': 0, 'public.managed_storage_json_references': 0, 'public.pal_event_outbox': 0,
    'private.pal_membership_outbox': 0, 'private.pal_membership_generations': 5, 'private.pal_membership_settings': 1, 'private.pal_classroom_signal_settings': 1 }
  assert.deepEqual(Object.keys(snapshot).sort(), Object.keys(expectedCounts).sort())
  const countCheckpoints: SetupCheckpoint[] = ['counts-users', 'counts-classrooms', 'counts-tests', 'counts-categories', 'counts-questions', 'counts-drafts', 'counts-attempts', 'counts-responses', 'counts-availability',
    'counts-enrollments', 'counts-roster', 'counts-archive-revisions', 'counts-objects', 'counts-references', 'counts-pal-events', 'counts-membership-outbox', 'counts-generations', 'counts-membership-settings', 'counts-signal-settings']
  for (const [i, [table, count]] of Object.entries(expectedCounts).entries()) { checkpoint(countCheckpoints[i]); assert(Array.isArray(snapshot[table])); assert.equal(snapshot[table].length, count); assert(snapshot[table].every(r => r && typeof r === 'object' && !Array.isArray(r))) }
  function subset(table: string, plans: Array<{ id: string }>) {
    assert.equal(new Set(snapshot[table].map(r => r.id)).size, plans.length)
    for (const plan of plans) { const row = snapshot[table].find(r => r.id === plan.id); assert(row); for (const [key, value] of Object.entries(plan)) assert.deepEqual(row[key], value) }
  }
  checkpoint('actors'); subset('public.users', f.actors)
  checkpoint('classrooms')
  subset('public.classrooms', f.classes.map(c => ({ id: c.id, teacher_id: c.owner, title: c.title, class_code: c.code })))
  checkpoint('questions'); subset('public.test_questions', f.questions)
  checkpoint('work'); subset('public.test_attempts', f.attempts)
  subset('public.test_responses', f.responses); subset('public.test_student_availability', f.availability)
  checkpoint('drafts'); subset('public.assessment_drafts', f.drafts.map(d => ({ id: d.id, assessment_id: d.assessment_id, classroom_id: d.classroom_id, assessment_type: 'test', version: d.version, content: d.content, created_by: d.owner, updated_by: d.owner })))
  checkpoint('revisions')
  assert.equal(new Set(snapshot['public.classroom_archive_revisions'].map(r => r.classroom_id)).size, 3)
  for (const effect of f.sideEffects) {
    const classroom = snapshot['public.classrooms'].find(r => r.id === effect.classroomId)!
    assert.equal(classroom.blueprint_source_revision, effect.blueprintSourceRevision)
    const revision = snapshot['public.classroom_archive_revisions'].find(r => r.classroom_id === effect.classroomId); assert(revision)
    assert.deepEqual(Object.keys(revision).sort(), ['classroom_id', 'revision', 'updated_at'])
    assert.equal(revision.revision, effect.archiveRevision)
    assert(typeof revision.updated_at === 'string' && Number.isFinite(Date.parse(revision.updated_at)))
  }
  checkpoint('categories')
  const categories = snapshot['public.gradebook_categories']; const ids = new Set<string>()
  for (const c of f.classes) {
    const own = categories.filter(row => row.classroom_id === c.id); assert.equal(own.length, 3)
    for (const [name, percentage, position, isDefault] of [['Attendance', 10, 0, false], ['Term', 65, 1, true], ['Final', 25, 2, false]]) {
      const row = own.find(r => r.name === name); assert(row && row.percentage === percentage && row.position === position && row.is_default === isDefault && row.default_assessment_weight === 10)
      assert(typeof row.id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(row.id) && !ids.has(row.id) && !f.allocatedIds.includes(row.id)); ids.add(row.id)
    }
  }
  checkpoint('tests'); for (const t of f.tests) {
    const row = snapshot['public.tests'].find(r => r.id === t.id); assert(row)
    for (const [key, value] of Object.entries(t)) {
      if (key === 'created_at' || key === 'updated_at') { assert(typeof row[key] === 'string'); assert.equal(new Date(row[key]).toISOString(), value) }
      else assert.deepEqual(row[key], value)
    }
    assert(categories.some(c => c.id === row.gradebook_category_id && c.classroom_id === t.classroom_id && c.name === 'Term' && c.is_default === true))
    assert.deepEqual(Object.keys(row).sort(), fields.split(',').sort())
  }
  checkpoint('generations'); for (const e of f.enrollments) {
    const generation = snapshot['private.pal_membership_generations'].find(r => r.generation_id === e.id); assert(generation)
    assert.equal(generation.state, e === f.enrollments[3] ? 'removed' : 'active')
    assert.equal(generation.scope_digest, testOwnerDigest(`pika-membership-scope-v1:${e.classroomId}:${e.actorId}`))
    assert(typeof generation.pal_reference === 'string' && /^pika-membership-v1-[a-f0-9]{32}$/.test(generation.pal_reference))
    const enrollment = snapshot['public.classroom_enrollments'].find(r => r.id === e.id)
    if (e === f.enrollments[3]) assert(!enrollment)
    else assert(enrollment?.classroom_id === e.classroomId && enrollment.student_id === e.actorId)
  }
  assert.equal(new Set(snapshot['private.pal_membership_generations'].map(r => r.pal_reference)).size, 5)
  checkpoint('settings'); assert(snapshot['private.pal_membership_settings'][0].enabled === false && snapshot['private.pal_classroom_signal_settings'][0].enabled === false)
  checkpoint('complete')
  return snapshot
}

export async function testOwnerListLifecycleMain(args = process.argv.slice(2)) {
  const timingArgs = extractContextualProofTimingArgs(args)
  const input = parseAssignmentListLifecycleArgs(timingArgs.lifecycleArgs)
  const git = (values: string[]) => execFileSync('git', values, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 }).trim()
  assert.equal(git(['rev-parse', 'HEAD']), input.head); assert.equal(git(['status', '--porcelain']), ''); const repository = git(['rev-parse', '--show-toplevel']); assert.equal(repository, process.cwd())
  const original = newAssignmentListProofFixture(); const f = newTestOwnerListFixture(original); const projectId = `pika_assignment_list_${original.manifest.syntheticTag.slice(-12)}`
  let native = createAssignmentListNativeAdapters(original, { ephemeralSnapshot: 'metadata' }); const originalSetup = assignmentListFixtureSetupSql(original, projectId)
  const setupSql = testOwnerListSetupSql(f, projectId); const snapshotSql = testOwnerListSnapshotSql(f)
  const setupHash = testOwnerDigest(setupSql); const snapshotHash = testOwnerDigest(snapshotSql)
  let target: ReturnType<typeof validateAssignmentListProofTarget> | undefined; let session: Session | undefined; let complete = false; let matrixComplete = false; let step = 'not-started'; let checkpoint: SetupCheckpoint | undefined
  let closure: Awaited<ReturnType<typeof assignmentListDockerInventory>> | undefined
  let transport: ReturnType<typeof createTestOwnerListProofTransport> | undefined; let client: ReturnType<typeof createClient<Database>> | undefined; let readDiagnostic: string | undefined
  const timings = createContextualProofTimings({ path: timingArgs.timingsPath, reviewedSha: input.head, profile: 'test-owner-list', mode: input.mode })
  native = timings.decorate(native)
  const originalPal = process.env.PAL_ENABLED; process.env.PAL_ENABLED = 'false'
  async function guard() {
    assert(target && session); closure = validateIntegratedGuardResources(await testOwnerListDockerInventory(), projectId, session.containerId, closure)
    const result = execFileSync('docker', ['exec', '-i', '-e', `PGAPPNAME=${projectId}_fixture`, session.containerId, 'psql', '-U', 'postgres', '-d', 'postgres', '-XqAt', '-v', 'ON_ERROR_STOP=1'],
      { input: testOwnerGuardSql(projectId), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 45000, maxBuffer: TEST_OWNER_LIST_CAPS.responseBytes })
    assert.equal(result.trim(), 'ok')
  }
  async function snapshot() {
    assert.equal(testOwnerDigest(snapshotSql), snapshotHash); await guard(); assert(session)
    const result = execFileSync('docker', ['exec', '-i', '-e', `PGAPPNAME=${projectId}_fixture`, session.containerId, 'psql', '-U', 'postgres', '-d', 'postgres', '-XqAt', '-v', 'ON_ERROR_STOP=1'],
      { input: snapshotSql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 45000, maxBuffer: TEST_OWNER_LIST_CAPS.responseBytes }).trim()
    assert(Buffer.byteLength(result) <= TEST_OWNER_LIST_CAPS.responseBytes); return result
  }
  async function setup() {
    step = 'setup-guard'; assert.equal(testOwnerDigest(setupSql), setupHash); await guard(); assert(session)
    step = 'setup-sql'; await native.executeSql({ ...session, sql: setupSql })
    step = 'setup-snapshot'; const captured = await snapshot()
    step = 'setup-validate'; validateTestOwnerListSetupSnapshot(f, JSON.parse(captured), value => { checkpoint = value }); complete = true; step = 'setup-complete'
  }
  async function matrix() {
    assert(complete && !matrixComplete && client && transport); step = 'matrix'
    const { readContextualTestList } = await import('../src/lib/server/contextual-test-list-read')
    for (const proofCase of f.cases) {
      step = 'matrix-before'; readDiagnostic = undefined
      const before = await snapshot(); const rows = validateTestOwnerListSetupSnapshot(f, JSON.parse(before)); transport.readContext(proofCase.classroomId, proofCase.actorId)
      const count = transport.counts.network
      const read = async () => {
        try { return await readContextualTestList({ supabase: client!, actorId: proofCase.actorId, classroomId: proofCase.classroomId }) }
        catch (error) { readDiagnostic = testOwnerListReadDiagnostic(error); transport!.freezeDiagnostic(); throw error }
      }
      if (proofCase.status === 403) {
        step = 'matrix-denial'; await assert.rejects(read, error => error instanceof ApiError && error.statusCode === 403)
        step = 'matrix-request-count'; assert.equal(transport.counts.network - count, 1)
      }
      else {
        step = 'matrix-owner'
        const result = await read()
        const expected = f.tests.filter(t => t.classroom_id === proofCase.classroomId).sort((a, b) => b.position - a.position || Date.parse(b.created_at) - Date.parse(a.created_at) || a.id.localeCompare(b.id)).map(t => {
          const persisted = rows['public.tests'].find(r => r.id === t.id)!; const index = f.tests.indexOf(t); const overlay = index === 0 ? f.drafts[0].content : undefined
          return { ...persisted, title: overlay?.title ?? t.title, show_results: overlay?.show_results ?? t.show_results, assessment_type: 'test',
            documents: index === 1 ? [{ id: t.documents[0].id, title: 'Instructions', source: 'text', content: 'Synthetic instructions.' }] : [], stats: f.stats[index] }
        })
        step = 'matrix-expected'; assert.deepEqual(result, { tests: expected })
      }
      step = 'matrix-after-read'; const after = await snapshot()
      step = 'matrix-equality'; assert.equal(after, before)
    }
    step = 'matrix-evidence'
    for (const key of Object.keys(transport.evidence) as Array<keyof typeof transport.evidence>) assert(transport.evidence[key] > 0)
    assert.equal(transport.counts.storage, 0); assert.equal(transport.counts.rpc, 0); matrixComplete = true; step = 'matrix-complete'
  }
  try {
    await timings.run(async () => {
      await runAssignmentListEphemeralLifecycle({ fixture: original, projectId, workdir: assignmentListProofWorkdir(projectId), migrations: loadAssignmentListReviewedMigrations(repository), mode: input.mode,
        expectedResources: assignmentListExpectedResources(projectId), reviewedManifestSha256: testOwnerDigest(JSON.stringify(original.manifest)),
        restorationPolicies: assignmentListRevocationPlans(original).map(plan => assignmentListRestorationPolicy(original, plan)) },
      { ...native, async command(request) { const result = await native.command(request); if (request.args[0] === 'status') target = validateAssignmentListProofTarget(result, projectId); return result },
        async executeSql(request) { await native.executeSql(request); if (request.sql === originalSetup) {
          assert(!session && target); session = { ...request }; transport = createTestOwnerListProofTransport(f, target, projectId, fetch, guard)
          client = createClient<Database>(target.API_URL, target.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport.fetch } }); await setup()
        } }, async runCase(request) { const result = await native.runCase(request); if (!matrixComplete) await matrix(); return result } })
      assert(complete && matrixComplete)
    })
    process.stdout.write(`PASS isolated test-owner-list eight actual SDK cases; no auth HTTP/browser/race/public-legacy claim.\n${cleanupMarker}`)
  } catch (error) {
    const receipt = testOwnerListForcedReceipt(input.mode, error, complete)
    if (receipt) { process.stdout.write(receipt.stdout); process.stderr.write(receipt.stderr); process.exitCode = receipt.exitCode; return }
    process.stderr.write(testOwnerListFailureDiagnostic(error, step, checkpoint)); if (transport) process.stderr.write(transport.diagnostic()); if (readDiagnostic) process.stderr.write(readDiagnostic)
    throw new Error('Test owner list lifecycle failed; private details withheld')
  } finally { if (originalPal === undefined) delete process.env.PAL_ENABLED; else process.env.PAL_ENABLED = originalPal }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) testOwnerListLifecycleMain().catch(() => {
  process.stderr.write('FAIL isolated test-owner-list lifecycle; private details withheld.\n'); process.exitCode = 1
})
