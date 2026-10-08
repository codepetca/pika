/** Inert finite installed-SDK member-list proof. Independent fixed-source review
 * and explicit coordinator acceptance are required before invoking this file. */
import assert from 'node:assert/strict'
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
import { assignmentListProofWorkdir } from './contextual-assignment-list-proof-path'
import { validateAssignmentListProofTarget } from './check-contextual-assignment-list-reads'
import { parseAssignmentListLifecycleArgs } from './check-contextual-assignment-list-lifecycle'
import { validateIntegratedGuardResources } from './check-contextual-assignment-learner-integrated-lifecycle'
import { testOwnerListDockerInventory } from './contextual-test-owner-list-proof-inventory'
import { classroomTestQuotaProofCatalog } from './classroom-test-quota-proof-catalog'
import { newTestMemberListFixture, testMemberListSetupSql, testMemberListSnapshotSql, testMemberListGuardSql,
  validateTestMemberListSetupSnapshot, testMemberListExpectedResult, testOwnerDigest, TEST_MEMBER_LIST_CAPS,
  TEST_MEMBER_LIST_TEST_FIELDS, type TestMemberListFixture } from './contextual-test-member-list-proof-fixture'

const API = 'http://127.0.0.1:54331'
const preflight = 'id,teacher_id,archived_at'
const root = 'id,teacher_id,archived_at,feature_visibility,membership:classroom_enrollments!classroom_enrollments_classroom_id_fkey!inner(classroom_id,student_id)'
const relation = 'tests:tests!tests_classroom_id_fkey'
const controls = 'id,classroom_id,status,updated_at'
export const TEST_MEMBER_LIST_PROJECTIONS = Object.freeze({ preflight, root, tests: `${root},${relation}(${TEST_MEMBER_LIST_TEST_FIELDS})`,
  attempts: `${root},${relation}!inner(${controls},attempts:test_attempts!test_attempts_test_id_fkey(id,test_id,student_id,is_submitted,returned_at,closed_for_grading_at))`,
  responses: `${root},${relation}!inner(${controls},responses:test_responses!test_responses_test_id_fkey(id,test_id,student_id,selected_option,response_text))`,
  availability: `${root},${relation}!inner(${controls},availability:test_student_availability!test_student_availability_test_id_fkey(id,test_id,student_id,state))`,
  final: `${root},${relation}!inner(${controls})` })
const kinds = ['attempts', 'responses', 'availability'] as const
const cleanupMarker = 'PASS isolated test-member-list exact teardown and unchanged canonical baseline.\n'
type Session = Parameters<AssignmentListLifecycleAdapters['executeSql']>[0]
type Canonical = Awaited<ReturnType<AssignmentListLifecycleAdapters['canonicalSnapshot']>>
function freeze<T>(value: T): T { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }; return value }
export function testMemberListRequestManifest(f: TestMemberListFixture) {
  return freeze({ version: 1, fixture: f, projections: TEST_MEMBER_LIST_PROJECTIONS, caps: TEST_MEMBER_LIST_CAPS,
    method: 'GET', origin: API, path: '/rest/v1/classrooms', sdk: 'supabase-js-node/2.93.3',
    preflight: 'one exact-id identity-only statement; no member or payload authority', modes: ['normal', 'after-fixture', 'before-capture'] })
}
export function testMemberListCanonicalCatalog(input: { rowDigests: string }) {
  assert(typeof input.rowDigests === 'string' && Buffer.byteLength(input.rowDigests) <= TEST_MEMBER_LIST_CAPS.responseBytes)
  const value: unknown = JSON.parse(input.rowDigests); assert(value && typeof value === 'object' && !Array.isArray(value))
  const names = Object.keys(value).sort(); assert(names.length > 0 && names.length <= TEST_MEMBER_LIST_CAPS.tables)
  assert(names.every(t => /^(public|private|storage)\.[a-z_0-9]+$/.test(t))); return Object.freeze(names)
}
/** Supplemental equality never removes or replaces the inherited baseline. The
 * prior private once-captured receipt remains coordinator-owned, outside source. */
export function validateTestMemberListCanonicalCheckpoint(actual: unknown, expected: unknown) {
  const keys = ['rowDigests', 'guard168Metadata', 'settings', 'cronJobs', 'resources'].sort()
  for (const value of [actual, expected]) {
    assert(value && typeof value === 'object' && !Array.isArray(value)); assert.deepEqual(Object.keys(value).sort(), keys)
    assert(Object.values(value).every(v => typeof v === 'string' && v.length > 0))
  }
  assert.deepEqual(actual, expected)
}

/** Literal source manifest, never derived from application queries. Metadata
 * preflight is one-shot. Every later statement proves member/Class authority. */
export function createTestMemberListProofTransport(f: TestMemberListFixture, rawTarget: unknown, projectId: string,
  original: typeof fetch, guard: () => Promise<void>, chargeBytes: (bytes: number) => void = () => {}) {
  assert.equal(projectId, `pika_assignment_list_${f.tag.slice(-12)}`)
  const target = validateAssignmentListProofTarget(rawTarget, projectId); assert.equal(target.API_URL, API)
  const manifest = testMemberListRequestManifest(f), hash = testOwnerDigest(JSON.stringify(manifest))
  let context: TestMemberListFixture['cases'][number] | undefined, stage: 'none' | 'preflight' | 'control' | 'payload' = 'none'
  const stamps = new Map<string, string>()
  const counts = { network: 0, storage: 0, rpc: 0, exchangeBytes: 0 }
  const evidence = { testsEmpty: 0, attemptsEmpty: 0, responsesEmpty: 0, availabilityEmpty: 0, final: 0, rootFinal: 0 }
  let phase = 'idle', projection: keyof typeof TEST_MEMBER_LIST_PROJECTIONS | 'unknown' = 'unknown', caseIndex = -1
  let started = 0, guardStarted = 0, guardMs = 0, http = 0, failure: 'none' | 'aborted' | 'timeout' | 'rejected' = 'none', frozen: string | undefined
  const boundedMs = (n: number) => Math.max(0, Math.min(60000, Math.trunc(n)))
  function readContext(classroomId: string, actorId: string) {
    caseIndex = f.cases.findIndex(c => c.classroomId === classroomId && c.actorId === actorId); assert(caseIndex >= 0)
    context = f.cases[caseIndex]; stage = 'preflight'; stamps.clear(); started = Date.now(); guardMs = 0; guardStarted = 0
    projection = 'unknown'; phase = 'idle'; failure = 'none'; http = 0; frozen = undefined
  }
  function validate(url: URL) {
    assert(context); const c = f.classes.find(c => c.id === context!.classroomId)!; assert(c)
    const actorId = context.actorId, classroomId = context.classroomId, select = url.searchParams.get('select')
    assert(select && Object.values(TEST_MEMBER_LIST_PROJECTIONS).includes(select))
    for (const key of new Set(url.searchParams.keys())) assert.equal(url.searchParams.getAll(key).length, key === 'teacher_id' && select !== preflight ? 2 : 1)
    const expected: Record<string, string> = { select, id: `eq.${classroomId}` }
    if (select === preflight) { assert.equal(stage, 'preflight'); stage = 'control' }
    else {
      assert(stage === 'control' || stage === 'payload'); assert(c.owner !== actorId && c.archived_at === null)
      const teacher = url.searchParams.getAll('teacher_id'); assert.deepEqual(teacher, [`neq.${actorId}`, `eq.${c.owner}`])
      Object.assign(expected, { teacher_id: `neq.${actorId}`, archived_at: 'is.null', 'membership.classroom_id': `eq.${classroomId}`, 'membership.student_id': `eq.${actorId}` })
      if (stage === 'control') { assert.equal(select, root); stage = 'payload' }
      else Object.assign(expected, { feature_visibility: `eq.${JSON.stringify(c.feature_visibility)}` })
      const batch = f.tests.filter(t => t.classroom_id === classroomId && t.status !== 'draft').sort((a, b) => a.id.localeCompare(b.id))
      const cursor = (key: string, ids: readonly string[]) => { const value = url.searchParams.get(key); if (value !== null) { assert(value.startsWith('gt.') && ids.includes(value.slice(3))); expected[key] = value } }
      if (select === TEST_MEMBER_LIST_PROJECTIONS.tests) {
        assert(c.feature_visibility.tests)
        Object.assign(expected, { 'tests.classroom_id': `eq.${classroomId}`, 'tests.status': 'in.(active,closed)', 'tests.order': 'id.asc', 'tests.limit': '1000' })
        cursor('tests.id', batch.map(t => t.id))
      } else if (select !== root) {
        assert(c.feature_visibility.tests && batch.length && batch.every(t => stamps.has(t.id)))
        Object.assign(expected, { 'tests.classroom_id': `eq.${classroomId}`, 'tests.status': 'in.(active,closed)', 'tests.id': `in.(${batch.map(t => t.id).join(',')})`,
          'tests.or': `(${batch.map(t => `and(id.eq.${t.id},status.eq.${t.status},updated_at.eq.${stamps.get(t.id)})`).join(',')})`, 'tests.order': 'id.asc', 'tests.limit': '50' })
        const kind = kinds.find(k => TEST_MEMBER_LIST_PROJECTIONS[k] === select)
        if (kind) {
          const ref = `tests.${kind}`; Object.assign(expected, { [`${ref}.student_id`]: `eq.${actorId}`, [`${ref}.order`]: 'id.asc', [`${ref}.limit`]: '100' })
          cursor(`${ref}.id`, f[kind].filter(r => r.student_id === actorId && batch.some(t => t.id === r.test_id)).map(r => r.id))
        }
      }
    }
    const actual = new URLSearchParams(url.searchParams)
    if (select !== preflight) actual.set('teacher_id', `neq.${context.actorId}`)
    assert.deepEqual(Object.fromEntries(actual), expected)
    return select
  }
  const safeFetch: typeof fetch = async (resource, init) => {
    try {
      phase = 'validate'; http = 0; failure = 'none'; projection = 'unknown'
      assert.equal(testOwnerDigest(JSON.stringify(manifest)), hash); assert(!(resource instanceof Request))
      const url = new URL(String(resource)); assert.equal(url.origin, API); assert.equal(url.pathname, '/rest/v1/classrooms'); assert(!url.username && !url.password && !url.hash)
      assert.equal(init?.method ?? 'GET', 'GET'); assert(init?.body === null || init?.body === undefined)
      assert(Object.keys(init ?? {}).every(k => ['method', 'headers', 'body', 'signal', 'redirect'].includes(k)))
      assert(init?.redirect === undefined || init.redirect === 'error'); assert(!init?.signal || init.signal instanceof AbortSignal)
      const headers = new Headers(init?.headers); assert.equal(headers.get('authorization'), `Bearer ${target.SERVICE_ROLE_KEY}`); assert.equal(headers.get('apikey'), target.SERVICE_ROLE_KEY)
      const allowed: Record<string, readonly string[]> = { authorization: [`Bearer ${target.SERVICE_ROLE_KEY}`], apikey: [target.SERVICE_ROLE_KEY],
        'x-client-info': ['supabase-js-node/2.93.3'], accept: ['application/json'], 'accept-profile': ['public'], 'content-profile': ['public'], 'content-type': ['application/json'] }
      for (const [name, value] of headers) assert(allowed[name]?.includes(value))
      const select = validate(url); assert(++counts.network <= TEST_MEMBER_LIST_CAPS.networkRequests)
      projection = (Object.keys(TEST_MEMBER_LIST_PROJECTIONS) as Array<keyof typeof TEST_MEMBER_LIST_PROJECTIONS>).find(k => TEST_MEMBER_LIST_PROJECTIONS[k] === select) ?? 'unknown'
      phase = 'guard'; guardStarted = Date.now(); try { await guard() } finally { guardMs += Date.now() - guardStarted; guardStarted = 0 }
      phase = 'dispatch'; const timeout = AbortSignal.timeout(TEST_MEMBER_LIST_CAPS.requestMs)
      const response = await original(resource, { ...init, redirect: 'error', signal: init?.signal ? AbortSignal.any([timeout, init.signal]) : timeout })
      http = response.status; assert(response.status < 300 || response.status >= 400); assert(!response.headers.has('location'))
      phase = 'decode'; const chunks: Uint8Array[] = []; let bytes = 0; const reader = response.body?.getReader()
      try {
        if (reader) for (;;) {
          const part = await reader.read(); if (part.done) break
          bytes += part.value.length; counts.exchangeBytes += part.value.length
          if (bytes > TEST_MEMBER_LIST_CAPS.responseBytes || counts.exchangeBytes > TEST_MEMBER_LIST_CAPS.totalBytes) throw new Error('Response cap')
          chargeBytes(part.value.length); chunks.push(part.value)
        }
      } catch (error) { await reader?.cancel().catch(() => {}); throw error }
      finally { reader?.releaseLock() }
      const body = Buffer.concat(chunks)
      if (response.ok) {
        const decoded: unknown = JSON.parse(body.toString('utf8')), row = Array.isArray(decoded) && decoded.length === 1 ? decoded[0] : undefined
        if (row && typeof row === 'object') {
          const value = row as Record<string, unknown>
          if (select === TEST_MEMBER_LIST_PROJECTIONS.tests && Array.isArray(value.tests)) {
            if (!value.tests.length) evidence.testsEmpty++
            for (const raw of value.tests) {
              assert(raw && typeof raw === 'object'); const t = raw as Record<string, unknown>, planned = f.tests.find(t => t.id === raw.id)
              assert(planned && planned.classroom_id === context!.classroomId && planned.status !== 'draft' && t.classroom_id === planned.classroom_id && t.status === planned.status)
              assert(typeof t.updated_at === 'string' && new Date(t.updated_at).toISOString() === f.now)
              const stamp = stamps.get(planned.id); if (stamp !== undefined) assert.equal(stamp, t.updated_at); else stamps.set(planned.id, t.updated_at)
            }
          }
          for (const kind of kinds) if (select === TEST_MEMBER_LIST_PROJECTIONS[kind] && Array.isArray(value.tests)
            && value.tests.length > 0 && value.tests.every(p => p && typeof p === 'object' && Array.isArray(p[kind]) && !p[kind].length)) evidence[`${kind}Empty`]++
          if (select === TEST_MEMBER_LIST_PROJECTIONS.final) evidence.final++
          if (select === root && url.searchParams.has('feature_visibility')) evidence.rootFinal++
        }
      }
      phase = 'complete'; return new Response(body, { status: response.status, headers: response.headers })
    } catch (error) {
      failure = init?.signal instanceof AbortSignal && init.signal.aborted || error instanceof Error && error.name === 'AbortError' ? 'aborted'
        : error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'rejected'
      throw new Error('Private member list proof transport rejected')
    }
  }
  const diagnostic = () => frozen ?? `DIAG test-member-list transport phase=${phase} case=${caseIndex >= 0 && caseIndex < 9 ? caseIndex : 'unknown'} projection=${projection} requests=${Math.min(counts.network, TEST_MEMBER_LIST_CAPS.networkRequests + 1)} contextMs=${boundedMs(started ? Date.now() - started : 0)} guardMs=${boundedMs(guardMs + (guardStarted ? Date.now() - guardStarted : 0))} failure=${failure} http=${http}.\n`
  return { target, fetch: safeFetch, counts, evidence, readContext, diagnostic, freezeDiagnostic: () => { frozen ??= diagnostic() } }
}
export function testMemberListForcedReceipt(mode: string, error: unknown, complete: boolean) {
  if (complete && ['after-fixture', 'before-capture'].includes(mode) && error instanceof AssignmentListLifecycleError && error.primary?.stage === mode
    && error.primary.error instanceof Error && error.primary.error.message === 'Forced isolated lifecycle failure' && !error.cleanupFailures.length)
    return { stdout: cleanupMarker, stderr: `FAIL forced isolated test-member-list lifecycle: ${mode}.\n`, exitCode: 1 }
  return null
}

export async function testMemberListLifecycleMain(args = process.argv.slice(2)) {
  const input = parseAssignmentListLifecycleArgs(args)
  const git = (args: string[]) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 }).trim()
  assert.equal(git(['rev-parse', 'HEAD']), input.head); assert.equal(git(['status', '--porcelain']), '')
  const repository = git(['rev-parse', '--show-toplevel']); assert.equal(repository, process.cwd())
  const migrations = loadAssignmentListReviewedMigrations(repository); assert.equal(migrations.length, 253)
  const original = newAssignmentListProofFixture(), f = newTestMemberListFixture(original), projectId = `pika_assignment_list_${original.manifest.syntheticTag.slice(-12)}`
  const native = createAssignmentListNativeAdapters(original), originalSetup = assignmentListFixtureSetupSql(original, projectId)
  const setupSql = testMemberListSetupSql(f, projectId), snapshotSql = testMemberListSnapshotSql(f), guardSql = testMemberListGuardSql(projectId)
  const union = freeze({ version: 1, reviewedHead: input.head, originalSha256: testOwnerDigest(JSON.stringify(original.manifest)),
    member: testMemberListRequestManifest(f), setupSha256: testOwnerDigest(setupSql), snapshotSha256: testOwnerDigest(snapshotSql), guardSha256: testOwnerDigest(guardSql),
    migrations: migrations.map(({ name, sha256 }) => ({ name, sha256 })) }), unionSha = testOwnerDigest(JSON.stringify(union))
  let session: Session | undefined, target: ReturnType<typeof validateAssignmentListProofTarget> | undefined
  let closure: Awaited<ReturnType<typeof assignmentListDockerInventory>> | undefined, canonical: Canonical | undefined, expectedTables: readonly string[] | undefined
  let transport: ReturnType<typeof createTestMemberListProofTransport> | undefined, client: ReturnType<typeof createClient<Database>> | undefined
  let complete = false, matrixComplete = false, step = 'pending', actions = 0, controlsCount = 0, bytes = 0
  const started = Date.now(), originalPal = process.env.PAL_ENABLED; process.env.PAL_ENABLED = 'false'
  const check = () => { assert(Date.now() - started < TEST_MEMBER_LIST_CAPS.totalMs && actions <= TEST_MEMBER_LIST_CAPS.actions && controlsCount <= TEST_MEMBER_LIST_CAPS.controls); assert.equal(testOwnerDigest(JSON.stringify(union)), unionSha) }
  const charge = (n: number) => { assert(Number.isSafeInteger(n) && n >= 0); bytes += n; assert(bytes <= TEST_MEMBER_LIST_CAPS.totalBytes); check() }
  function privateSql(sql: string) {
    check(); assert(session && [snapshotSql, guardSql].includes(sql)); assert(++actions <= TEST_MEMBER_LIST_CAPS.actions)
    const result = execFileSync('docker', ['exec', '-i', '-e', `PGAPPNAME=${projectId}_fixture`, session.containerId, 'psql', '-U', 'postgres', '-d', 'postgres', '-XqAt', '-v', 'ON_ERROR_STOP=1'],
      { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: Math.min(TEST_MEMBER_LIST_CAPS.controlMs, TEST_MEMBER_LIST_CAPS.totalMs - (Date.now() - started)), maxBuffer: TEST_MEMBER_LIST_CAPS.responseBytes }).trim()
    charge(Buffer.byteLength(result)); return result
  }
  async function guard() {
    check(); assert(target && session); assert(++controlsCount <= TEST_MEMBER_LIST_CAPS.controls)
    assert.equal(git(['rev-parse', 'HEAD']), input.head); assert.equal(git(['status', '--porcelain']), ''); assert.equal(git(['rev-parse', '--show-toplevel']), repository)
    assert.deepEqual(loadAssignmentListReviewedMigrations(repository).map(({ name, sha256 }) => ({ name, sha256 })), union.migrations)
    closure = validateIntegratedGuardResources(await testOwnerListDockerInventory(), projectId, session.containerId, closure)
    assert.equal(privateSql(guardSql), 'ok')
  }
  async function snapshot() {
    assert(expectedTables && testOwnerDigest(snapshotSql) === union.snapshotSha256); await guard()
    const source = privateSql(snapshotSql); validateTestMemberListSetupSnapshot(f, JSON.parse(source), expectedTables); return source
  }
  async function setup() {
    step = 'setup-guard'; await guard(); assert(session && expectedTables)
    step = 'setup-sql'; assert.equal(testOwnerDigest(setupSql), union.setupSha256); assert(++actions <= TEST_MEMBER_LIST_CAPS.actions); await native.executeSql({ ...session, sql: setupSql })
    step = 'setup-snapshot'; await snapshot(); complete = true; step = 'setup-complete'
  }
  async function matrix() {
    assert(complete && !matrixComplete && client && transport && expectedTables)
    const { readContextualStudentTestList } = await import('../src/lib/server/contextual-student-test-list-read')
    for (const c of f.cases) {
      step = 'matrix-before'; const before = await snapshot(), rows = validateTestMemberListSetupSnapshot(f, JSON.parse(before), expectedTables)
      transport.readContext(c.classroomId, c.actorId); const count = transport.counts.network
      const read = async () => { try { return await readContextualStudentTestList({ supabase: client!, actorId: c.actorId, classroomId: c.classroomId }) }
        catch (error) { transport!.freezeDiagnostic(); throw error } }
      if (c.status === 403) {
        step = 'matrix-denial'; await assert.rejects(read, error => error instanceof ApiError && error.statusCode === 403)
        const classroom = f.classes.find(row => row.id === c.classroomId)!; assert.equal(transport.counts.network - count, classroom.owner === c.actorId || classroom.archived_at !== null ? 1 : 2)
      } else { step = 'matrix-member'; assert.deepEqual(await read(), testMemberListExpectedResult(f, c, rows)) }
      step = 'matrix-equality'; assert.equal(await snapshot(), before)
    }
    step = 'matrix-evidence'; for (const n of Object.values(transport.evidence)) assert(n > 0)
    assert.equal(transport.counts.storage, 0); assert.equal(transport.counts.rpc, 0); matrixComplete = true; step = 'matrix-complete'
  }
  try {
    await runAssignmentListEphemeralLifecycle({ fixture: original, projectId, workdir: assignmentListProofWorkdir(projectId), migrations, mode: input.mode,
      expectedResources: assignmentListExpectedResources(projectId), reviewedManifestSha256: testOwnerDigest(JSON.stringify(original.manifest)),
      restorationPolicies: assignmentListRevocationPlans(original).map(plan => assignmentListRestorationPolicy(original, plan)) }, {
      ...native,
      async canonicalSnapshot(request) {
        const captured = await native.canonicalSnapshot(request)
        if (canonical) validateTestMemberListCanonicalCheckpoint(captured, canonical)
        else {
          validateTestMemberListCanonicalCheckpoint(captured, captured); canonical = structuredClone(captured)
          const catalog = testMemberListCanonicalCatalog(captured)
          assert.equal(catalog.length, 183); assert(!catalog.includes('private.classroom_test_quota_settings'))
          expectedTables = classroomTestQuotaProofCatalog(catalog, migrations); assert.equal(expectedTables.length, 184)
        }
        return captured // All five original fields remain in the sealed lifecycle.
      },
      async command(request) { const result = await native.command(request); if (request.args[0] === 'status') target = validateAssignmentListProofTarget(result, projectId); return result },
      async executeSql(request) { await native.executeSql(request); if (request.sql === originalSetup) {
        assert(!session && target && expectedTables); session = { ...request }
        transport = createTestMemberListProofTransport(f, target, projectId, fetch, guard, charge)
        client = createClient<Database>(target.API_URL, target.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport.fetch } }); await setup()
      } },
      async runCase(request) { const result = await native.runCase(request); if (!matrixComplete) await matrix(); return result },
    })
    assert(complete && matrixComplete)
    process.stdout.write(`PASS isolated test-member-list nine actual SDK cases; no auth HTTP/browser/race/public-legacy claim.\n${cleanupMarker}`)
  } catch (error) {
    const receipt = testMemberListForcedReceipt(input.mode, error, complete)
    if (receipt) { process.stdout.write(receipt.stdout); process.stderr.write(receipt.stderr); process.exitCode = receipt.exitCode; return }
    const allowed = ['pending', 'setup-guard', 'setup-sql', 'setup-snapshot', 'setup-complete', 'matrix-before', 'matrix-denial', 'matrix-member', 'matrix-equality', 'matrix-evidence', 'matrix-complete']
    process.stderr.write(`DIAG isolated test-member-list step=${allowed.includes(step) ? step : 'unknown'} cleanup=${error instanceof AssignmentListLifecycleError ? error.cleanupFailures.length ? 'present' : 'none' : 'unknown'}.\n`)
    if (transport) process.stderr.write(transport.diagnostic())
    throw new Error('Private member list lifecycle failed')
  } finally { if (originalPal === undefined) delete process.env.PAL_ENABLED; else process.env.PAL_ENABLED = originalPal }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) testMemberListLifecycleMain().catch(() => {
  process.stderr.write('FAIL isolated test-member-list lifecycle; private details withheld.\n'); process.exitCode = 1
})
