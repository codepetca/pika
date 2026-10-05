/**
 * Root-run, local-only, READ-ONLY installed-SDK/PostgREST proof source.
 * Requires a separately reviewed scoped synthetic fixture manifest; this runner
 * neither provisions fixtures nor changes relationships to manufacture races.
 * No execution or runtime-success claim accompanies this source-only slice.
 *
 * pnpm exec tsx scripts/check-contextual-assignment-list-reads.ts \
 *   --fixture /absolute/reviewed-fixture.json --reviewed-fixture-sha256 <digest>
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assignmentListProofWorkdir } from './contextual-assignment-list-proof-path'
import { createClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { readContextualAssignmentList } from '../src/lib/server/contextual-assignment-list-read'
import { ApiError } from '../src/lib/api-error'
import type { Database } from '../src/types/database'

const uuid = z.string().uuid()
const rowExpectation = z.object({ id: uuid, totalStudents: z.number().int().nonnegative(), submitted: z.number().int().nonnegative(),
  requirementIds: z.array(uuid), }).strict()
const caseSchema = z.object({
  actorId: uuid, classroomId: uuid, label: z.enum(['owner_student', 'owner_teacher', 'member_student', 'member_teacher', 'outsider', 'self_owner', 'archived_member', 'hidden_member']),
  permission: z.enum(['owner', 'member']), expectedStatus: z.enum(['200', '403', '404']), assignmentIds: z.array(uuid),
  stats: z.array(rowExpectation).optional(),
}).strict()
const manifestSchema = z.object({
  version: z.literal(1), syntheticTag: z.string().regex(/^assignmentlist_[a-f0-9]{12}$/), now: z.string().datetime({ offset: true }),
  actors: z.array(z.object({ id: uuid, email: z.string().email(), role: z.enum(['student', 'teacher']) }).strict()).min(5).max(20),
  classrooms: z.array(z.object({ id: uuid, title: z.string() }).strict()).min(2).max(10),
  cases: z.array(caseSchema).min(8).max(32),
}).strict()
export type AssignmentListProofManifest = z.infer<typeof manifestSchema>
export const ASSIGNMENT_LIST_PROOF_API = 'http://127.0.0.1:54321'
export const ASSIGNMENT_LIST_ISOLATED_PROOF_API = 'http://127.0.0.1:54331'
export function validateAssignmentListProofProject(projectId: string) {
  assert(projectId === 'pika' || /^pika_assignment_list_[a-f0-9]{12}$/.test(projectId))
  return projectId === 'pika' ? { projectId, api: ASSIGNMENT_LIST_PROOF_API, port: '54322', apiPort: '54321' }
    : { projectId, api: ASSIGNMENT_LIST_ISOLATED_PROOF_API, port: '54332', apiPort: '54331' }
}
export function assignmentListProofDiagnostic(stage: unknown, category: unknown, status?: unknown) {
  const stages = ['unknown', 'target', 'fixture', 'read', 'revocation', 'cleanup']
  const categories = ['assertion', 'command', 'transport', 'cleanup', 'unexpected']
  return `DIAG assignment-list stage=${stages.includes(String(stage)) ? stage : 'unknown'} category=${categories.includes(String(category)) ? category : 'unexpected'} status=${typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599 ? status : 'none'}`
}
export function validateAssignmentListProofTarget(value: unknown, projectId = 'pika') {
  try {
    const project = validateAssignmentListProofProject(projectId)
    const result = z.object({ API_URL: z.literal(project.api), SERVICE_ROLE_KEY: z.string().min(20), DB_URL: z.string() }).parse(value)
    const u = new URL(result.DB_URL)
    assert(['postgres:', 'postgresql:'].includes(u.protocol) && u.hostname === '127.0.0.1' && u.port === project.port
      && u.pathname === '/postgres' && !u.search && !u.hash && u.username === 'postgres')
    const parts = result.SERVICE_ROLE_KEY.split('.'); assert.equal(parts.length, 3)
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    assert.equal(claims.iss, 'supabase-demo'); assert.equal(claims.role, 'service_role')
    return result
  } catch { throw new Error('Local assignment-list target guard failed') }
}
export function decodeAssignmentListProofManifest(value: unknown): AssignmentListProofManifest {
  try {
    const fixture = manifestSchema.parse(value)
    const actors = new Map(fixture.actors.map(a => [a.id, a])); const classrooms = new Map(fixture.classrooms.map(c => [c.id, c]))
    assert.equal(actors.size, fixture.actors.length); assert.equal(classrooms.size, fixture.classrooms.length)
    for (const actor of actors.values()) assert(actor.email.startsWith(fixture.syntheticTag + '_') && actor.email.endsWith('@example.invalid'))
    for (const classroom of classrooms.values()) assert(classroom.title.startsWith(fixture.syntheticTag + ' '))
    for (const label of ['owner_student', 'owner_teacher', 'member_student', 'member_teacher', 'outsider', 'self_owner', 'archived_member', 'hidden_member']) assert(fixture.cases.some(c => c.label === label))
    for (const scenario of fixture.cases) {
      assert(actors.has(scenario.actorId)); assert(classrooms.has(scenario.classroomId))
      assert.equal(new Set(scenario.assignmentIds).size, scenario.assignmentIds.length)
      assert.equal(new Set(scenario.stats?.map(s => s.id)).size, scenario.stats?.length ?? 0)
      for (const stat of scenario.stats ?? []) {
        assert(scenario.permission === 'owner' && scenario.expectedStatus === '200' && scenario.assignmentIds.includes(stat.id))
        assert.equal(new Set(stat.requirementIds).size, stat.requirementIds.length)
        assert(stat.submitted <= stat.totalStudents)
      }
    }
    assert(fixture.cases.some(c => c.assignmentIds.length > 1000))
    assert(fixture.cases.some(c => c.stats?.some(s => s.totalStudents > 1000 && s.submitted > 1000 && s.requirementIds.length > 1000)))
    return fixture
  } catch { throw new Error('Reviewed assignment-list fixture rejected') }
}
/** No provider, Storage, authentication, redirects or unbounded transport. */
export function containedAssignmentListProofFetch(original: typeof fetch, projectId = 'pika'): typeof fetch {
  const project = validateAssignmentListProofProject(projectId)
  return async (input, init) => {
    try {
      const url = new URL(input instanceof Request ? input.url : String(input))
      assert(url.origin === project.api && !url.username && !url.password && !url.hash && url.pathname.startsWith('/rest/v1/'))
      const timeout = AbortSignal.timeout(12000)
      const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout
      return await original(input, { ...init, redirect: 'error', signal })
    } catch { throw new Error('Local assignment-list transport rejected') }
  }
}
function assertContainers(projectId: string) {
  const project = validateAssignmentListProofProject(projectId)
  for (const [name, internal, external] of [[`supabase_db_${projectId}`, '5432/tcp', project.port], [`supabase_kong_${projectId}`, '8000/tcp', project.apiPort]]) {
    try {
      const run = (args: string[]) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 }).trim()
      assert.equal(run(['inspect', name, '--format', '{{.State.Running}}']), 'true')
      assert.equal(run(['inspect', name, '--format', '{{ index .Config.Labels "com.supabase.cli.project" }}']), projectId)
      const ports = run(['port', name, internal]).split(/\r?\n/)
      assert(ports.length > 0 && ports.every(port => port.endsWith(`:${external}`)))
    } catch { throw new Error('Local assignment-list container guard failed') }
  }
}
function localStatus(projectId: string, workdir?: string) {
  let raw: string
  try { raw = execFileSync('supabase', ['status', ...(workdir ? ['--workdir', workdir] : []), '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 }) }
  catch { throw new Error('Local assignment-list target discovery failed') }
  try { return validateAssignmentListProofTarget(JSON.parse(raw), projectId) }
  catch { throw new Error('Local assignment-list target guard failed') }
}
export async function assignmentListProofMain() {
  const args = process.argv.slice(2)
  assert(args.length === 4 || args.length === 8)
  assert.equal(args[0], '--fixture'); assert.equal(args[2], '--reviewed-fixture-sha256')
  assert(isAbsolute(args[1])); assert.match(args[3], /^[a-f0-9]{64}$/)
  const bytes = readFileSync(args[1]); assert(bytes.byteLength <= 1024 * 1024)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), args[3])
  const fixture = decodeAssignmentListProofManifest(JSON.parse(bytes.toString('utf8')))
  let projectId = 'pika'; let workdir: string | undefined
  if (args.length === 8) {
    assert.equal(args[4], '--isolated-project'); assert.equal(args[6], '--isolated-workdir')
    projectId = args[5]; workdir = args[7]
    assert.equal(projectId, `pika_assignment_list_${fixture.syntheticTag.slice(-12)}`)
    assert.equal(workdir, assignmentListProofWorkdir(projectId))
    validateAssignmentListProofProject(projectId)
  }
  const actors = new Map(fixture.actors.map(a => [a.id, a])); const classrooms = new Map(fixture.classrooms.map(c => [c.id, c]))
  assert.equal(actors.size, fixture.actors.length); assert.equal(classrooms.size, fixture.classrooms.length)
  for (const actor of actors.values()) assert(actor.email.startsWith(fixture.syntheticTag + '_') && actor.email.endsWith('@example.invalid'))
  for (const classroom of classrooms.values()) assert(classroom.title.startsWith(fixture.syntheticTag + ' '))
  for (const label of ['owner_student', 'owner_teacher', 'member_student', 'member_teacher', 'outsider', 'self_owner', 'archived_member', 'hidden_member']) assert(fixture.cases.some(c => c.label === label))
  assert(fixture.cases.some(c => c.assignmentIds.length > 1000))
  assert(fixture.cases.some(c => c.stats?.some(s => s.totalStudents > 1000 && s.submitted > 1000 && s.requirementIds.length > 1000)))
  assertContainers(projectId)
  const local = localStatus(projectId, workdir)
  const safeFetch = containedAssignmentListProofFetch(fetch, projectId)
  const service = createClient<Database>(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: safeFetch } })
  // Confirm the exact root-reviewed synthetic namespace before any payload read.
  for (const actor of actors.values()) {
    const response = await service.from('users').select('id,email,role').eq('id', actor.id).single()
    assert.equal(response.error, null); assert.deepEqual(response.data, actor)
  }
  for (const classroom of classrooms.values()) {
    const response = await service.from('classrooms').select('id,title').eq('id', classroom.id).single()
    assert.equal(response.error, null); assert.deepEqual(response.data, classroom)
  }
  let statements = 0; let cases = 0
  for (const scenario of fixture.cases) {
    assert(actors.has(scenario.actorId)); assert(classrooms.has(scenario.classroomId))
    const urls: URL[] = []
    const client = createClient<Database>(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: {
      fetch: async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input)); urls.push(url); statements++
        assert.equal(url.origin, local.API_URL); assert.equal(url.pathname, '/rest/v1/classrooms')
        assert.equal(url.searchParams.get('id'), `eq.${scenario.classroomId}`)
        assert(!url.searchParams.get('select')?.includes('*')); assert(init?.signal instanceof AbortSignal)
        if (urls.length > 1) {
          assert.equal(url.searchParams.get('teacher_id'), `${scenario.permission === 'owner' ? 'eq' : 'neq'}.${scenario.actorId}`)
          if (scenario.permission === 'member') {
            assert.equal(url.searchParams.get('archived_at'), 'is.null')
            assert.equal(url.searchParams.get('membership.student_id'), `eq.${scenario.actorId}`)
          }
        }
        return safeFetch(input, init)
      },
    } })
    const run = () => readContextualAssignmentList({ supabase: client, actorId: scenario.actorId, classroomId: scenario.classroomId, permission: scenario.permission, now: new Date(fixture.now) })
    if (scenario.expectedStatus !== '200') {
      await assert.rejects(run, error => error instanceof ApiError && error.statusCode === Number(scenario.expectedStatus))
    } else {
      const result = await run()
      assert.deepEqual(result.assignments.map(a => a.id), scenario.assignmentIds)
      for (const expected of scenario.stats ?? []) {
        const row = result.assignments.find(a => a.id === expected.id); assert(row)
        assert.equal((row.stats as { total_students: number }).total_students, expected.totalStudents)
        assert.equal((row.stats as { submitted: number }).submitted, expected.submitted)
        assert.deepEqual((row.submission_requirements as Array<{ id: string }>).map(r => r.id), expected.requirementIds)
      }
      for (const row of result.assignments) {
        if (scenario.permission !== 'member' || !row.doc) continue
        const doc = row.doc as Record<string, unknown>
        for (const key of ['authenticity_score', 'authenticity_flags', 'teacher_feedback_draft', 'ai_feedback_suggestion', 'ai_feedback_model']) assert.equal(doc[key], null)
        assert(!('ai_grading_provenance' in doc)); assert(!('ai_grading_review' in doc))
        if (!doc.returned_at) for (const key of ['score_completion', 'score_thinking', 'score_workflow', 'graded_at', 'graded_by']) assert.equal(doc[key], null)
      }
      assert(!urls.at(-1)?.searchParams.get('select')?.includes('assignments:'))
    }
    cases++
  }
  process.stdout.write(`PASS local assignment-list SDK proof: ${cases} reviewed synthetic cases, ${statements} statements; no fixture writes\n`)
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  assignmentListProofMain().catch(() => { process.stderr.write('FAIL local assignment-list SDK proof; detailed fixture/credential output withheld\n'); process.exitCode = 1 })
}
