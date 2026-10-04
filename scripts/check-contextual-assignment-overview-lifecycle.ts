/** Read-only overview observer inside the reviewed disposable list lifecycle.
 * No operations at import; no additional fixture writes, platform targets,
 * teardown authority or changes to the existing list revocation contracts.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { createClient } from '@supabase/supabase-js'
import { ApiError } from '../src/lib/api-error'
import { readContextualAssignmentOverview } from '../src/lib/server/contextual-assignment-overview-read'
import type { Database } from '../src/types/database'
import { parseAssignmentListLifecycleArgs } from './check-contextual-assignment-list-lifecycle'
import { containedAssignmentListProofFetch, type AssignmentListProofManifest } from './check-contextual-assignment-list-reads'
import { newAssignmentListProofFixture, type AssignmentListProofFixture } from './contextual-assignment-list-proof-fixture'
import { AssignmentListLifecycleError, runAssignmentListEphemeralLifecycle } from './contextual-assignment-list-proof-lifecycle'
import { AssignmentListStartupError, assignmentListExpectedResources, assignmentListRestorationPolicy, createAssignmentListNativeAdapters, loadAssignmentListReviewedMigrations } from './contextual-assignment-list-proof-platform'
import { assignmentListProofWorkdir } from './contextual-assignment-list-proof-path'
import { assignmentListRevocationPlans } from './contextual-assignment-list-proof-revocations'

export function assignmentOverviewProofDiagnostic(input: { case: unknown; phase: unknown; statement: unknown; http: unknown; code: unknown }) {
  const closed = (value: unknown, values: string[]) => typeof value === 'string' && values.includes(value) ? value : 'none'
  const bounded = (value: unknown, maximum: number) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= maximum ? value : 0
  const name = closed(input.case, ['owner_student', 'owner_teacher', 'member_student', 'member_teacher', 'outsider', 'self_owner', 'archived_member', 'hidden_member'])
  const phase = closed(input.phase, ['list', 'control', 'assignment', 'enrollments', 'requirements', 'docs', 'artifacts', 'history', 'runs', 'items'])
  const code = typeof input.code === 'string' && /^(?:PGRST\d{3}|[A-Z0-9]{5})$/.test(input.code) ? input.code : 'none'
  return `case=${name} phase=${phase} statement=${bounded(input.statement, 1024)} http=${bounded(input.http, 599)} code=${code}`
}

export function assignmentOverviewProofExpectation(fixture: AssignmentListProofFixture, proofCase: AssignmentListProofManifest['cases'][number]) {
  assert(fixture.manifest.cases.some(c => isDeepStrictEqual(c, proofCase)))
  const assignment = fixture.assignments.find(a => a.classroom === proofCase.classroomId)
  if (!assignment) return null
  const classroom = fixture.classes.find(c => c.id === assignment.classroom)!
  assert(classroom && fixture.manifest.actors.some(a => a.id === proofCase.actorId))
  return {
    actorId: proofCase.actorId, assignmentId: assignment.id, classroomId: classroom.id,
    status: classroom.owner === proofCase.actorId ? 200 as const : 403 as const,
    studentIds: fixture.enrollments.filter(e => e.classroom === classroom.id && e.student !== classroom.owner).map(e => e.student).sort(),
    requirementIds: fixture.requirements.filter(r => r.assignment === assignment.id).map(r => r.id).sort(),
    submittedStudentIds: fixture.docs.filter(d => d.assignment === assignment.id && d.student !== classroom.owner).map(d => d.student).sort(),
  }
}

export async function assignmentOverviewLifecycleMain(args = process.argv.slice(2)) {
  const input = parseAssignmentListLifecycleArgs(args)
  const git = (args: string[]) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 }).trim()
  assert.equal(git(['rev-parse', 'HEAD']), input.head)
  assert.equal(git(['status', '--porcelain']), '')
  const repository = git(['rev-parse', '--show-toplevel'])
  assert.equal(repository, process.cwd())
  const fixture = newAssignmentListProofFixture()
  const projectId = `pika_assignment_list_${fixture.manifest.syntheticTag.slice(-12)}`
  const native = createAssignmentListNativeAdapters(fixture)
  let observed = 0
  // Closed diagnostic categories only: never log URLs, identifiers, credentials,
  // response rows, backend messages or SQL when a real SDK assertion fails.
  let diagnostic = { case: 'none', phase: 'none', statement: 0, http: 0, code: 'none' }
  try {
    await runAssignmentListEphemeralLifecycle({ fixture, projectId, workdir: assignmentListProofWorkdir(projectId),
      migrations: loadAssignmentListReviewedMigrations(repository), mode: input.mode,
      expectedResources: assignmentListExpectedResources(projectId),
      reviewedManifestSha256: createHash('sha256').update(JSON.stringify(fixture.manifest)).digest('hex'),
      restorationPolicies: assignmentListRevocationPlans(fixture).map(plan => assignmentListRestorationPolicy(fixture, plan)),
    }, { ...native, async runCase(request) {
      diagnostic = { case: request.proofCase.label, phase: 'list', statement: 0, http: 0, code: 'none' }
      const result = await native.runCase(request)
      const expected = assignmentOverviewProofExpectation(fixture, request.proofCase)
      if (!expected) return result
      let statements = 0
      const safeFetch = containedAssignmentListProofFetch(fetch, projectId)
      const client = createClient<Database>(request.target.API_URL, request.target.SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (resource, init) => {
          const url = new URL(resource instanceof Request ? resource.url : String(resource))
          assert.equal(url.pathname, '/rest/v1/assignments')
          assert.equal(url.searchParams.get('id'), `eq.${expected.assignmentId}`)
          assert(!url.searchParams.get('select')?.includes('*'))
          assert(init?.signal instanceof AbortSignal)
          diagnostic.statement = ++statements
          const select = url.searchParams.get('select') ?? ''
          diagnostic.phase = select.includes('enrollments:') ? 'enrollments' : select.includes('requirements:') ? 'requirements'
            : select.includes('artifacts:') ? 'artifacts' : select.includes('history:') ? 'history' : select.includes('docs:') ? 'docs'
              : select.includes('items:') ? 'items' : select.includes('runs:') ? 'runs' : select.includes('title,description') ? 'assignment' : 'control'
          if (statements > 1) {
            assert.equal(url.searchParams.get('classrooms.teacher_id'), `eq.${expected.actorId}`)
            assert.equal(url.searchParams.get('classroom_id'), `eq.${expected.classroomId}`)
          }
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
      const read = () => readContextualAssignmentOverview({ supabase: client, actorId: expected.actorId, assignmentId: expected.assignmentId })
      if (expected.status === 403) await assert.rejects(read, error => error instanceof ApiError && error.statusCode === 403)
      else {
        const body = await read()
        assert.equal(body.assignment.id, expected.assignmentId)
        assert.equal(body.classroom.id, expected.classroomId)
        assert.equal(body.classroom.teacher_id, expected.actorId)
        assert.deepEqual(body.students.map(s => s.student_id).sort(), expected.studentIds)
        assert.deepEqual(body.assignment.submission_requirements.map(r => r.id).sort(), expected.requirementIds)
        assert.deepEqual(body.students.filter(s => s.doc?.is_submitted).map(s => s.student_id).sort(), expected.submittedStudentIds)
        assert.equal(body.active_ai_grading_run, null)
        for (const student of body.students) {
          // Migration099's existing submission trigger creates a snapshot for
          // every submitted fixture document at the fixture's submitted_at.
          if (student.doc) {
            assert.equal(Date.parse(student.doc.submitted_at!), Date.parse(fixture.manifest.now))
            assert.equal(Date.parse(student.student_updated_at!), Date.parse(fixture.manifest.now))
          } else assert.equal(student.student_updated_at, null)
          assert.deepEqual(student.submission_artifacts, [])
          assert.deepEqual(student.artifacts, [])
        }
      }
      observed++
      return result
    } })
    assert.equal(observed, 7)
    process.stdout.write('PASS isolated assignment-overview seven SDK cases plus existing list cases/revocations.\nPASS isolated assignment-overview exact teardown and unchanged canonical baseline.\n')
  } catch (error) {
    if (error instanceof AssignmentListLifecycleError && error.primary?.stage === 'start' && error.primary.error instanceof AssignmentListStartupError) {
      process.stderr.write(`DIAG private startup receipt: ${error.primary.error.diagnosticPath}\n`)
    }
    if (input.mode !== 'normal' && error instanceof AssignmentListLifecycleError && error.primary?.stage === input.mode
      && error.primary.error instanceof Error && error.primary.error.message === 'Forced isolated lifecycle failure' && error.cleanupFailures.length === 0) {
      process.stdout.write('PASS isolated assignment-overview exact teardown and unchanged canonical baseline.\n')
      process.stderr.write(`FAIL forced isolated assignment-overview lifecycle: ${input.mode}.\n`)
      process.exitCode = 1
      return
    }
    if (error instanceof AssignmentListLifecycleError) {
      process.stderr.write(`DIAG isolated assignment-overview stage=${error.primary?.stage ?? 'cleanup'} cleanup=${error.cleanupFailures.map(f => f.stage).join(',') || 'none'}.\n`)
      if (error.primary?.stage === 'cases') process.stderr.write(`DIAG overview ${assignmentOverviewProofDiagnostic(diagnostic)}.\n`)
    }
    throw new Error('Isolated assignment-overview lifecycle failed; private details withheld')
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) assignmentOverviewLifecycleMain().catch(() => {
  process.stderr.write('FAIL isolated assignment-overview lifecycle; detailed output withheld.\n')
  process.exitCode = 1
})
