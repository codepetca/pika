/** Read-only student-detail observer inside the reviewed disposable list lifecycle.
 * Reuses the immutable fixture and exact existing transition SQL. No operations at
 * import, extra DML, platform targets, signing/bytes or teardown authority.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { createClient } from '@supabase/supabase-js'
import { ApiError } from '../src/lib/api-error'
import { readContextualAssignmentStudentDetail } from '../src/lib/server/contextual-assignment-student-detail-read'
import type { Database } from '../src/types/database'
import { parseAssignmentListLifecycleArgs } from './check-contextual-assignment-list-lifecycle'
import { containedAssignmentListProofFetch, type AssignmentListProofManifest } from './check-contextual-assignment-list-reads'
import { newAssignmentListProofFixture, type AssignmentListProofFixture } from './contextual-assignment-list-proof-fixture'
import { AssignmentListLifecycleError, runAssignmentListEphemeralLifecycle } from './contextual-assignment-list-proof-lifecycle'
import { AssignmentListStartupError, assignmentListExpectedResources, assignmentListRestorationPolicy, createAssignmentListNativeAdapters, loadAssignmentListReviewedMigrations } from './contextual-assignment-list-proof-platform'
import { assignmentListProofWorkdir } from './contextual-assignment-list-proof-path'
import { assignmentListRevocationPlans, type AssignmentListRevocationPlan } from './contextual-assignment-list-proof-revocations'

export function assignmentStudentDetailProofDiagnostic(input: { case: unknown; phase: unknown; statement: unknown; http: unknown; code: unknown }) {
  const closed = (value: unknown, values: string[]) => typeof value === 'string' && values.includes(value) ? value : 'none'
  const bounded = (value: unknown, maximum: number) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= maximum ? value : 0
  const name = closed(input.case, ['owner_student', 'owner_teacher', 'member_student', 'member_teacher', 'outsider', 'self_owner', 'archived_member', 'hidden_member'])
  const phase = closed(input.phase, ['list', 'control', 'assignment', 'target', 'docs', 'requirements', 'artifacts', 'feedback', 'repo-target', 'repo-review', 'revocation'])
  const code = typeof input.code === 'string' && /^(?:PGRST\d{3}|[A-Z0-9]{5})$/.test(input.code) ? input.code : 'none'
  return `case=${name} phase=${phase} statement=${bounded(input.statement, 1024)} http=${bounded(input.http, 599)} code=${code}`
}

export function assignmentStudentDetailProofExpectation(fixture: AssignmentListProofFixture, proofCase: AssignmentListProofManifest['cases'][number]) {
  assert(fixture.manifest.cases.some(c => isDeepStrictEqual(c, proofCase)))
  const assignment = fixture.assignments.find(a => a.classroom === proofCase.classroomId)
  if (!assignment) return null
  const classroom = fixture.classes.find(c => c.id === assignment.classroom)!
  const studentId = classroom.id === fixture.classes[0].id ? fixture.manifest.actors[2].id : fixture.manifest.actors[0].id
  assert(classroom && fixture.enrollments.some(e => e.classroom === classroom.id && e.student === studentId))
  assert.notEqual(studentId, classroom.owner)
  return {
    actorId: proofCase.actorId, assignmentId: assignment.id, classroomId: classroom.id, studentId,
    status: classroom.owner === proofCase.actorId ? 200 as const : 403 as const,
    email: fixture.people.find(p => p.id === studentId)!.email,
    docId: fixture.docs.find(d => d.assignment === assignment.id && d.student === studentId)?.id ?? null,
    requirementIds: fixture.requirements.filter(r => r.assignment === assignment.id).map(r => r.id).sort(),
  }
}

export function assignmentStudentDetailRevocationBoundary(fixture: AssignmentListProofFixture, plan: AssignmentListRevocationPlan, url: URL) {
  if (plan.transition !== 'owner-transfer' && plan.transition !== 'member-remove') return false
  const select = url.searchParams.get('select') ?? ''
  if (plan.boundary === 'first') return select.includes('instructions_markdown')
  if (!select.includes('requirements:')) return false
  const assignment = fixture.assignments.find(a => a.classroom === plan.classroomId)!
  const ids = fixture.requirements.filter(r => r.assignment === assignment.id).map(r => r.id).sort()
  const cursor = url.searchParams.getAll('requirements.id').find(value => value.startsWith('gt.'))?.slice(3)
  return plan.boundary === 'later' ? cursor !== undefined && cursor !== ids.at(-1)
    : plan.boundary === 'terminal' && cursor !== undefined && cursor === ids.at(-1)
}

type Target = Parameters<ReturnType<typeof createAssignmentListNativeAdapters>['runCase']>[0]['target']

/** Reuse one exact original transition; restoration stays with the native observer. */
export async function observeAssignmentStudentDetailTransition(
  fixture: AssignmentListProofFixture, plan: AssignmentListRevocationPlan, sql: string,
  executeSql: (sql: string) => Promise<void>, read: (hook: (url: URL) => Promise<void>) => Promise<unknown>,
) {
  if (sql !== plan.revokeSql || (plan.transition !== 'owner-transfer' && plan.transition !== 'member-remove')) {
    await executeSql(sql)
    return false
  }
  let attempted = false; let fired = false
  await assert.rejects(() => read(async url => {
    if (!attempted && assignmentStudentDetailRevocationBoundary(fixture, plan, url)) {
      // An ambiguous commit is not retried. The original observer's finally
      // retains its exact scoped restore and independent fingerprint checks.
      attempted = true
      await executeSql(sql)
      fired = true
    }
  }), error => error instanceof ApiError && error.statusCode === 503)
  assert(fired, 'Required student-detail revocation boundary not reached')
  return true
}

export async function assignmentStudentDetailLifecycleMain(args = process.argv.slice(2)) {
  const input = parseAssignmentListLifecycleArgs(args)
  const git = (args: string[]) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 }).trim()
  assert.equal(git(['rev-parse', 'HEAD']), input.head)
  assert.equal(git(['status', '--porcelain']), '')
  const repository = git(['rev-parse', '--show-toplevel'])
  assert.equal(repository, process.cwd())
  const fixture = newAssignmentListProofFixture()
  const projectId = `pika_assignment_list_${fixture.manifest.syntheticTag.slice(-12)}`
  const native = createAssignmentListNativeAdapters(fixture)
  let observed = 0; let selfObserved = 0; let revoked = 0
  let diagnostic = { case: 'none', phase: 'none', statement: 0, http: 0, code: 'none' }
  function reader(target: Target, expected: { actorId: string; assignmentId: string; classroomId: string; studentId: string }, hook?: (url: URL) => Promise<void>) {
    let statements = 0
    const safeFetch = containedAssignmentListProofFetch(fetch, projectId)
    const client = createClient<Database>(target.API_URL, target.SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (resource, init) => {
        const url = new URL(resource instanceof Request ? resource.url : String(resource))
        assert.equal(url.pathname, '/rest/v1/assignments')
        assert.equal(url.searchParams.get('id'), `eq.${expected.assignmentId}`)
        const select = url.searchParams.get('select') ?? ''
        assert(!select.includes('*'))
        assert(init?.signal instanceof AbortSignal)
        diagnostic.statement = ++statements
        diagnostic.phase = select.includes('requirements:') ? 'requirements' : select.includes('artifacts:') ? 'artifacts'
          : select.includes('feedback:') ? 'feedback' : select.includes('reviews:') ? 'repo-review' : select.includes('targets:') ? 'repo-target'
            : select.includes('docs:') ? 'docs' : select.includes('instructions_markdown') ? 'assignment' : 'control'
        if (statements > 1) {
          assert.equal(url.searchParams.get('classrooms.teacher_id'), `eq.${expected.actorId}`)
          assert.equal(url.searchParams.get('classroom_id'), `eq.${expected.classroomId}`)
          assert.equal(url.searchParams.get('classrooms.target.student_id'), `eq.${expected.studentId}`)
        }
        if (hook) await hook(url)
        const response = await safeFetch(resource, init)
        diagnostic.http = response.status
        if (!response.ok) {
          const body: unknown = await response.clone().json().catch(() => null)
          const code = body && typeof body === 'object' && 'code' in body ? body.code : null
          diagnostic.code = typeof code === 'string' && /^(?:PGRST\d{3}|[A-Z0-9]{5})$/.test(code) ? code : 'none'
        }
        return response
      } },
    })
    return () => readContextualAssignmentStudentDetail({ supabase: client, actorId: expected.actorId, assignmentId: expected.assignmentId, studentId: expected.studentId })
  }
  try {
    await runAssignmentListEphemeralLifecycle({ fixture, projectId, workdir: assignmentListProofWorkdir(projectId),
      migrations: loadAssignmentListReviewedMigrations(repository), mode: input.mode,
      expectedResources: assignmentListExpectedResources(projectId),
      reviewedManifestSha256: createHash('sha256').update(JSON.stringify(fixture.manifest)).digest('hex'),
      restorationPolicies: assignmentListRevocationPlans(fixture).map(plan => assignmentListRestorationPolicy(fixture, plan)),
    }, { ...native, async runCase(request) {
      diagnostic = { case: request.proofCase.label, phase: 'list', statement: 0, http: 0, code: 'none' }
      const result = await native.runCase(request)
      const expected = assignmentStudentDetailProofExpectation(fixture, request.proofCase)
      if (!expected) return result
      const read = reader(request.target, expected)
      if (expected.status === 403) await assert.rejects(read, error => error instanceof ApiError && error.statusCode === 403)
      else {
        const body = await read()
        assert.equal(body.assignment.id, expected.assignmentId)
        assert.equal(body.classroom.id, expected.classroomId)
        assert.equal(body.classroom.teacher_id, expected.actorId)
        assert(!('archived_at' in body.classroom))
        assert.equal(body.student.id, expected.studentId)
        assert.equal(body.student.email, expected.email)
        assert.equal(body.student.name, null)
        assert.deepEqual(body.assignment.submission_requirements.map(r => r.id).sort(), expected.requirementIds)
        assert.equal(body.doc?.id ?? null, expected.docId)
        if (body.doc) {
          assert.equal(body.doc.assignment_id, expected.assignmentId)
          assert.equal(body.doc.student_id, expected.studentId)
          assert.equal(body.doc.feedback, 'Synthetic feedback')
          assert.equal(body.doc.score_completion, 8)
          assert.equal(body.doc.score_thinking, 9)
          assert.equal(body.doc.score_workflow, 10)
          assert.equal(body.doc.returned_at, null)
          assert.equal(Date.parse(body.doc.submitted_at!), Date.parse(fixture.manifest.now))
        }
        assert.deepEqual(body.submission_artifacts, [])
        assert.deepEqual(body.feedback_entries, [])
        assert.equal(body.repo_target.target, null)
        assert.equal(body.repo_target.latest_result, null)
      }
      observed++
      if (request.proofCase.label === 'self_owner') {
        diagnostic = { case: 'self_owner', phase: 'control', statement: 0, http: 0, code: 'none' }
        await assert.rejects(reader(request.target, { ...expected, studentId: expected.actorId }), error => error instanceof ApiError && error.statusCode === 403)
        selfObserved++
      }
      return result
    }, async runRevocation(request) {
      // One original transition and restoration serves BOTH readers. The detail
      // observer injects the SAME already-approved SQL at its own boundary before
      // the existing list observer continues. No second remove/retry or new DML.
      return native.runRevocation({ ...request, async executeSql(sql) {
        const plan = request.plan
        const classroom = fixture.classes.find(c => c.id === plan.classroomId)!
        const assignment = fixture.assignments.find(a => a.classroom === classroom.id)!
        diagnostic = { case: 'owner_student', phase: 'revocation', statement: 0, http: 0, code: 'none' }
        if (await observeAssignmentStudentDetailTransition(fixture, plan, sql, request.executeSql, hook => reader(request.target, {
          actorId: classroom.owner, assignmentId: assignment.id, classroomId: classroom.id, studentId: fixture.manifest.actors[2].id,
        }, hook)())) revoked++
      } })
    } })
    assert.equal(observed, 7); assert.equal(selfObserved, 1); assert.equal(revoked, 6)
    process.stdout.write('PASS isolated assignment-student-detail eight SDK cases and six live revocations plus existing list cases/revocations.\nPASS isolated assignment-student-detail exact teardown and unchanged canonical baseline.\n')
  } catch (error) {
    if (error instanceof AssignmentListLifecycleError && error.primary?.stage === 'start' && error.primary.error instanceof AssignmentListStartupError) process.stderr.write(`DIAG private startup receipt: ${error.primary.error.diagnosticPath}\n`)
    if (input.mode !== 'normal' && error instanceof AssignmentListLifecycleError && error.primary?.stage === input.mode
      && error.primary.error instanceof Error && error.primary.error.message === 'Forced isolated lifecycle failure' && error.cleanupFailures.length === 0) {
      process.stdout.write('PASS isolated assignment-student-detail exact teardown and unchanged canonical baseline.\n')
      process.stderr.write(`FAIL forced isolated assignment-student-detail lifecycle: ${input.mode}.\n`)
      process.exitCode = 1
      return
    }
    if (error instanceof AssignmentListLifecycleError) {
      process.stderr.write(`DIAG isolated assignment-student-detail stage=${error.primary?.stage ?? 'cleanup'} cleanup=${error.cleanupFailures.map(f => f.stage).join(',') || 'none'}.\n`)
      if (error.primary?.stage === 'cases' || error.primary?.stage === 'revocations') process.stderr.write(`DIAG student-detail ${assignmentStudentDetailProofDiagnostic(diagnostic)}.\n`)
    }
    throw new Error('Isolated assignment-student-detail lifecycle failed; private details withheld')
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) assignmentStudentDetailLifecycleMain().catch(() => {
  process.stderr.write('FAIL isolated assignment-student-detail lifecycle; detailed output withheld.\n')
  process.exitCode = 1
})
