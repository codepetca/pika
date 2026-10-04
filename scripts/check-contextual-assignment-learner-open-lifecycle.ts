/** Read-only learner projection observer inside the unchanged reviewed001–240
 * disposable list lifecycle. Open uses a controlled non-network, nonmutating RPC stub.
 * This does NOT prove actual RPC/create/view/Pal/Storage/auth HTTP/browser behavior
 * or nonempty feedback/artifact/GitHub supplements. Importing executes nothing.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { createClient } from '@supabase/supabase-js'
import { ApiError } from '../src/lib/api-error'
import { openSharedAssignmentLearnerDoc } from '../src/lib/server/contextual-assignment-learner-open'
import type { Database } from '../src/types/database'
import { parseAssignmentListLifecycleArgs } from './check-contextual-assignment-list-lifecycle'
import { containedAssignmentListProofFetch, validateAssignmentListProofTarget, type AssignmentListProofManifest } from './check-contextual-assignment-list-reads'
import { newAssignmentListProofFixture, type AssignmentListProofFixture } from './contextual-assignment-list-proof-fixture'
import { AssignmentListLifecycleError, runAssignmentListEphemeralLifecycle } from './contextual-assignment-list-proof-lifecycle'
import { AssignmentListStartupError, assignmentListExpectedResources, assignmentListRestorationPolicy, createAssignmentListNativeAdapters, loadAssignmentListReviewedMigrations } from './contextual-assignment-list-proof-platform'
import { assignmentListProofWorkdir } from './contextual-assignment-list-proof-path'
import { assignmentListRevocationPlans, type AssignmentListRevocationPlan } from './contextual-assignment-list-proof-revocations'

type Target = Parameters<ReturnType<typeof createAssignmentListNativeAdapters>['runCase']>[0]['target']
type ProjectionCase = { label: string; actorId: string; assignmentId: string; classroomId: string; status: 200 | 403 | 404;
  docId: string | null; returned: boolean; requirementIds: string[] }
function expectedCase(f: AssignmentListProofFixture, label: string, actorId: string, assignmentId: string): ProjectionCase | null {
  assert(f.manifest.actors.some(actor => actor.id === actorId))
  const assignment = f.assignments.find(row => row.id === assignmentId); assert(assignment)
  const classroom = f.classes.find(row => row.id === assignment.classroom); assert(classroom)
  const member = f.enrollments.some(row => row.classroom === classroom.id && row.student === actorId)
  const doc = f.docs.find(row => row.assignment === assignment.id && row.student === actorId)
  const status = classroom.owner === actorId || !member ? 403 : assignment.isDraft || assignment.releasedAt !== null ? 404 : 200
  // A successful projection must never manufacture an ID for lazy creation.
  if (status === 200 && !doc) return null
  return { label, actorId, assignmentId, classroomId: classroom.id, status, docId: doc?.id ?? null, returned: doc?.returned ?? false,
    requirementIds: f.requirements.filter(row => row.assignment === assignmentId).map(row => row.id).sort() }
}
export function assignmentLearnerOpenProofExpectation(f: AssignmentListProofFixture, c: AssignmentListProofManifest['cases'][number]) {
  assert(f.manifest.cases.some(candidate => isDeepStrictEqual(candidate, c)))
  const assignment = f.assignments.find(row => row.classroom === c.classroomId)
  return assignment ? expectedCase(f, c.label, c.actorId, assignment.id) : null
}
export function assignmentLearnerOpenProofCases(f: AssignmentListProofFixture) {
  const cases = f.manifest.cases.map(c => assignmentLearnerOpenProofExpectation(f, c)).filter((c): c is ProjectionCase => c !== null)
  assert.equal(cases.length, 5)
  // These fixture gaps are deliberately NOT claimed covered: no Assignments in
  // archived/hidden Classes and no existing own documents for ClassB members.
  for (const c of f.manifest.cases.filter(c => c.classroomId !== f.classes[0].id && c.permission === 'member')) assert.equal(assignmentLearnerOpenProofExpectation(f, c), null)
  const teacher = f.manifest.actors[3]; assert.equal(teacher.role, 'teacher')
  const returned = f.docs.find(doc => doc.returned && doc.student === f.manifest.actors[2].id); assert(returned)
  const draft = f.assignments.find(row => row.isDraft); const future = f.assignments.find(row => row.releasedAt !== null); assert(draft && future)
  for (const [label, actorId, assignmentId] of [
    ['member_teacher_existing', teacher.id, f.assignments[0].id], ['returned_student', f.manifest.actors[2].id, returned.assignment],
    ['draft_member', f.manifest.actors[2].id, draft.id], ['scheduled_member', f.manifest.actors[2].id, future.id],
  ]) { const c = expectedCase(f, label, actorId, assignmentId); assert(c); cases.push(c) }
  assert.equal(cases.length, 9); assert.equal(cases.filter(c => c.status === 200).length, 3)
  return cases
}
export function assignmentLearnerOpenProofDiagnostic(input: { case: unknown; phase: unknown; statement: unknown; http: unknown; code: unknown }) {
  const closed = (value: unknown, values: string[]) => typeof value === 'string' && values.includes(value) ? value : 'none'
  const number = (value: unknown, max: number) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max ? value : 0
  return `case=${closed(input.case, ['owner_student', 'owner_teacher', 'member_student', 'outsider', 'self_owner', 'member_teacher_existing', 'returned_student', 'draft_member', 'scheduled_member'])} phase=${closed(input.phase, ['list', 'control', 'assignment', 'docs', 'grades', 'feedback', 'requirements', 'artifacts', 'identity', 'revocation'])} statement=${number(input.statement, 1024)} http=${number(input.http, 599)} code=${typeof input.code === 'string' && /^(?:PGRST\d{3}|[A-Z0-9]{5})$/.test(input.code) ? input.code : 'none'}`
}

/** Only exact ephemeral Assignment GETs reach fetch. RPC is sealed and cold;
 * fixture identities authorize the stub, while actual DB reads drive the DTO. */
export function createAssignmentLearnerOpenProofClient(f: AssignmentListProofFixture, expected: ProjectionCase, rawTarget: Target,
  originalFetch: typeof fetch, hook?: (url: URL) => Promise<void>, diagnostic?: { phase: string; statement: number; http: number; code: string }) {
  assert(assignmentLearnerOpenProofCases(f).some(c => isDeepStrictEqual(c, expected)))
  const projectId = `pika_assignment_list_${f.manifest.syntheticTag.slice(-12)}`
  const target = validateAssignmentListProofTarget(rawTarget, projectId)
  const safeFetch = containedAssignmentListProofFetch(originalFetch, projectId)
  const sent: Array<{ origin: string; path: string }> = []
  const counts = { assignmentReads: 0, controlledRpcStubs: 0,
    get networkRpc() { return sent.filter(request => request.path.startsWith('/rest/v1/rpc/')).length },
    get storage() { return sent.filter(request => request.path.startsWith('/storage/')).length },
    get provider() { return sent.filter(request => request.origin !== target.API_URL || !request.path.startsWith('/rest/v1/')).length },
  }
  const guardedFetch: typeof fetch = async (resource, init) => {
    const url = new URL(resource instanceof Request ? resource.url : String(resource))
    assert.equal(url.origin, target.API_URL); assert.equal(url.pathname, '/rest/v1/assignments')
    assert.equal(init?.method ?? 'GET', 'GET'); assert(init?.signal instanceof AbortSignal)
    assert.equal(url.searchParams.get('id'), `eq.${expected.assignmentId}`)
    const select = url.searchParams.get('select') ?? ''; assert(select.length > 0 && !select.includes('*'))
    if (counts.assignmentReads > 0) {
      assert.equal(url.searchParams.get('classroom_id'), `eq.${expected.classroomId}`)
      assert.equal(url.searchParams.get('classrooms.membership.student_id'), `eq.${expected.actorId}`)
      assert(url.searchParams.getAll('classrooms.teacher_id').includes(`neq.${expected.actorId}`))
      assert.equal(url.searchParams.get('classrooms.archived_at'), 'is.null'); assert.equal(url.searchParams.get('is_draft'), 'eq.false')
    }
    counts.assignmentReads++
    if (diagnostic) {
      diagnostic.statement = counts.assignmentReads
      diagnostic.phase = select.includes('requirements:') ? 'requirements' : select.includes('artifacts:') ? 'artifacts'
        : select.includes('github_identity:') ? 'identity' : select.includes('grades:') ? 'grades' : select.includes('feedback:') ? 'feedback'
          : select.includes('docs:') ? 'docs' : select.includes('instructions_markdown') ? 'assignment' : 'control'
    }
    if (hook) await hook(url)
    sent.push({ origin: url.origin, path: url.pathname })
    const response = await safeFetch(resource, init)
    if (diagnostic) {
      diagnostic.http = response.status
      if (!response.ok) {
        const body: unknown = await response.clone().json().catch(() => null)
        const code = body && typeof body === 'object' && 'code' in body ? body.code : null
        diagnostic.code = typeof code === 'string' && /^(?:PGRST\d{3}|[A-Z0-9]{5})$/.test(code) ? code : 'none'
      }
    }
    return response
  }
  const client = createClient<Database>(target.API_URL, target.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: guardedFetch } })
  const rpc = (name: string, args: unknown) => {
    assert.equal(name, 'open_assignment_doc_for_member_v1'); assert(expected.status === 200 && expected.docId)
    assert(args && typeof args === 'object' && !Array.isArray(args))
    const values = args as Record<string, unknown>
    assert.deepEqual(Object.keys(values).sort(), ['p_actor_id', 'p_assignment_id', 'p_pal_event', 'p_viewed_at'])
    assert.equal(values.p_actor_id, expected.actorId); assert.equal(values.p_assignment_id, expected.assignmentId); assert.equal(values.p_pal_event, null)
    assert(typeof values.p_viewed_at === 'string' && Number.isFinite(Date.parse(values.p_viewed_at)))
    const doc = f.docs.find(row => row.id === expected.docId && row.assignment === expected.assignmentId && row.student === expected.actorId); assert(doc)
    const assignment = f.assignments.find(row => row.id === expected.assignmentId && row.classroom === expected.classroomId && !row.isDraft && row.releasedAt === null); assert(assignment)
    let signal: AbortSignal | undefined; let consumed = false
    const builder = Object.freeze({
      abortSignal(value: AbortSignal) { assert(value instanceof AbortSignal && !signal && !consumed); signal = value; return builder },
      then(resolve: (result: unknown) => unknown, reject: (error: unknown) => unknown) {
        return Promise.resolve().then(() => {
          assert(signal && !signal.aborted && !consumed); consumed = true; counts.controlledRpcStubs++
          return { data: { ok: true, created: false, viewed_at_changed: false,
            assignment: { id: assignment.id, classroom_id: assignment.classroom, is_draft: false, created_at: f.manifest.now, released_at: null,
              description: '', instructions_markdown: 'Synthetic read instructions', rich_instructions: null },
            // Match the immutable setup SQL's existing JSONB content; never
            // synthesize a document ID or omit evidence the real reader bounds.
            doc: { id: doc.id, assignment_id: doc.assignment, student_id: doc.student, viewed_at: null,
              content: { type: 'doc', content: [] } } }, error: null }
        }).then(resolve, reject)
      },
    })
    return builder
  }
  Object.defineProperty(client, 'rpc', { value: rpc, writable: false, configurable: false })
  return { client, counts, fetch: guardedFetch }
}

export function assignmentLearnerOpenRevocationBoundary(f: AssignmentListProofFixture, plan: AssignmentListRevocationPlan, url: URL) {
  if (!['owner-transfer', 'member-remove'].includes(plan.transition)) return false
  const select = url.searchParams.get('select') ?? ''
  if (plan.boundary === 'first') return select.includes('instructions_markdown')
  if (!select.includes('requirements:')) return false
  const assignment = f.assignments.find(row => row.classroom === plan.classroomId); assert(assignment)
  const ids = f.requirements.filter(row => row.assignment === assignment.id).map(row => row.id).sort()
  const cursor = url.searchParams.getAll('requirements.id').find(value => value.startsWith('gt.'))?.slice(3)
  return plan.boundary === 'later' ? cursor !== undefined && cursor !== ids.at(-1) : plan.boundary === 'terminal' && cursor === ids.at(-1)
}
/** SAME original approved SQL once. Native list observer alone restores/fingerprints. */
export async function observeAssignmentLearnerOpenTransition(f: AssignmentListProofFixture, plan: AssignmentListRevocationPlan, sql: string,
  executeSql: (sql: string) => Promise<void>, read: (hook: (url: URL) => Promise<void>) => Promise<unknown>) {
  assert(assignmentListRevocationPlans(f).some(original => isDeepStrictEqual(original, plan)))
  assert(sql === plan.revokeSql || sql === plan.restoreSql)
  if (sql !== plan.revokeSql || !['owner-transfer', 'member-remove'].includes(plan.transition)) { await executeSql(sql); return false }
  let attempted = false; let fired = false
  await assert.rejects(() => read(async url => {
    if (!attempted && assignmentLearnerOpenRevocationBoundary(f, plan, url)) { attempted = true; await executeSql(sql); fired = true }
  }), error => error instanceof ApiError && error.statusCode === 503)
  assert(fired, 'Required learner projection revocation boundary not reached')
  return true
}
export function assignmentLearnerOpenForcedReceipt(mode: 'normal' | 'after-fixture' | 'before-capture', error: unknown) {
  if (mode === 'normal' || !(error instanceof AssignmentListLifecycleError) || error.primary?.stage !== mode
    || !(error.primary.error instanceof Error) || error.primary.error.message !== 'Forced isolated lifecycle failure' || error.cleanupFailures.length) return null
  return { stdout: 'PASS isolated assignment-learner-open projection exact teardown and unchanged canonical baseline.\n',
    stderr: `FAIL forced isolated assignment-learner-open projection lifecycle: ${mode}.\n`, exitCode: 1 }
}
export async function assignmentLearnerOpenLifecycleMain(args = process.argv.slice(2)) {
  const input = parseAssignmentListLifecycleArgs(args)
  const git = (args: string[]) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 }).trim()
  assert.equal(git(['rev-parse', 'HEAD']), input.head); assert.equal(git(['status', '--porcelain']), '')
  const repository = git(['rev-parse', '--show-toplevel']); assert.equal(repository, process.cwd())
  const fixture = newAssignmentListProofFixture(); const cases = assignmentLearnerOpenProofCases(fixture)
  const projectId = `pika_assignment_list_${fixture.manifest.syntheticTag.slice(-12)}`
  const native = createAssignmentListNativeAdapters(fixture)
  const originalPal = process.env.PAL_ENABLED; process.env.PAL_ENABLED = 'false'
  let observed = 0; let revoked = 0; let stubs = 0; let projected = false
  let diagnostic = { case: 'none', phase: 'none', statement: 0, http: 0, code: 'none' }
  async function read(target: Target, expected: ProjectionCase, hook?: (url: URL) => Promise<void>) {
    const proof = createAssignmentLearnerOpenProofClient(fixture, expected, target, fetch, hook, diagnostic)
    try { return await openSharedAssignmentLearnerDoc({ supabase: proof.client, actorId: expected.actorId, assignmentId: expected.assignmentId }) }
    finally {
      stubs += proof.counts.controlledRpcStubs
      assert.equal(proof.counts.networkRpc, 0); assert.equal(proof.counts.storage, 0); assert.equal(proof.counts.provider, 0)
    }
  }
  try {
    await runAssignmentListEphemeralLifecycle({ fixture, projectId, workdir: assignmentListProofWorkdir(projectId), migrations: loadAssignmentListReviewedMigrations(repository), mode: input.mode,
      expectedResources: assignmentListExpectedResources(projectId), reviewedManifestSha256: createHash('sha256').update(JSON.stringify(fixture.manifest)).digest('hex'),
      restorationPolicies: assignmentListRevocationPlans(fixture).map(plan => assignmentListRestorationPolicy(fixture, plan)),
    }, { ...native, async runCase(request) {
      diagnostic = { case: request.proofCase.label, phase: 'list', statement: 0, http: 0, code: 'none' }
      const result = await native.runCase(request)
      if (projected) return result
      projected = true
      for (const expected of cases) {
        diagnostic = { case: expected.label, phase: 'control', statement: 0, http: 0, code: 'none' }
        if (expected.status !== 200) await assert.rejects(() => read(request.target, expected), error => error instanceof ApiError && error.statusCode === expected.status)
        else {
          const body = await read(request.target, expected)
          assert.equal(body.assignment.id, expected.assignmentId); assert.equal(body.assignment.classroom_id, expected.classroomId)
          assert.equal(body.doc.id, expected.docId); assert.equal(body.doc.assignment_id, expected.assignmentId); assert.equal(body.doc.student_id, expected.actorId)
          assert.equal(body.wasFirstView, false); assert(!('pal_delivery' in body))
          assert.equal(body.doc.score_completion, expected.returned ? 0 : null); assert.equal(body.doc.score_thinking, expected.returned ? 0 : null); assert.equal(body.doc.score_workflow, expected.returned ? 0 : null)
          assert.equal(body.doc.feedback, expected.returned ? 'Synthetic feedback' : null)
          assert.equal(body.doc.returned_at === null, !expected.returned)
          assert(!('teacher_feedback_draft' in body.doc)); assert(!('ai_grading_provenance' in body.doc))
          assert.deepEqual(body.submission_requirements.map(row => row.id).sort(), expected.requirementIds)
          assert.deepEqual(body.submission_artifacts, []); assert.deepEqual(body.feedback_entries, []); assert.equal(body.github_identity, null)
        }
        observed++
      }
      return result
    }, async runRevocation(request) {
      return native.runRevocation({ ...request, async executeSql(sql) {
        diagnostic = { case: 'member_student', phase: 'revocation', statement: 0, http: 0, code: 'none' }
        const expected = cases.find(c => c.label === 'member_student'); assert(expected && expected.status === 200 && expected.docId)
        if (await observeAssignmentLearnerOpenTransition(fixture, request.plan, sql, request.executeSql, hook => read(request.target, expected, hook))) revoked++
      } })
    } })
    assert.equal(observed, 9); assert.equal(revoked, 6); assert.equal(stubs, 9)
    process.stdout.write('PASS isolated assignment-learner-open nine read/projection cases and six original revocations; nine controlled RPC stubs created=false view=false; zero network RPC/Storage/provider calls; existing list cases/revocations preserved.\nPASS isolated assignment-learner-open projection exact teardown and unchanged canonical baseline.\n')
  } catch (error) {
    const forced = assignmentLearnerOpenForcedReceipt(input.mode, error)
    if (forced) { process.stdout.write(forced.stdout); process.stderr.write(forced.stderr); process.exitCode = forced.exitCode; return }
    if (error instanceof AssignmentListLifecycleError) {
      const stages = ['canonical-before', 'preflight', 'prepare', 'pre-start', 'start', 'capture', 'status', 'fixture', 'cases', 'revocations', 'cleanup']
      const stage = stages.includes(error.primary?.stage ?? '') ? error.primary!.stage : 'cleanup'
      process.stderr.write(`DIAG isolated assignment-learner-open stage=${stage} cleanupFailures=${Math.min(error.cleanupFailures.length, 100)}.\n`)
      if (stage === 'cases' || stage === 'revocations') process.stderr.write(`DIAG learner-open ${assignmentLearnerOpenProofDiagnostic(diagnostic)}.\n`)
      if (stage === 'start' && error.primary?.error instanceof AssignmentListStartupError) process.stderr.write('DIAG isolated assignment-learner-open private startup receipt retained by native adapter.\n')
    }
    throw new Error('Isolated assignment-learner-open projection lifecycle failed; private details withheld')
  } finally { if (originalPal === undefined) delete process.env.PAL_ENABLED; else process.env.PAL_ENABLED = originalPal }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) assignmentLearnerOpenLifecycleMain().catch(() => {
  process.stderr.write('FAIL isolated assignment-learner-open projection lifecycle; detailed output withheld.\n'); process.exitCode = 1
})
