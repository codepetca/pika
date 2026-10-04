/** Native adapters for the separately reviewed disposable assignment-list proof.
 * Importing this module performs no commands. Credentials, SQL rows and command
 * stderr remain private. Never call this against an existing fixture project.
 */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createServer } from 'node:net'
import { createClient } from '@supabase/supabase-js'
import { ApiError } from '../src/lib/api-error'
import { readContextualAssignmentList } from '../src/lib/server/contextual-assignment-list-read'
import { containedAssignmentListProofFetch } from './check-contextual-assignment-list-reads'
import { observeAssignmentListRevocation, assignmentListRevocationPlans } from './contextual-assignment-list-proof-revocations'
import { validateAssignmentListEphemeralIdentity } from './contextual-assignment-list-proof-lifecycle'
import { assignmentListProofWorkdir } from './contextual-assignment-list-proof-path'
import type { AssignmentListLifecycleAdapters, AssignmentListResource } from './contextual-assignment-list-proof-lifecycle'
import type { AssignmentListProofFixture } from './contextual-assignment-list-proof-fixture'
import type { Database } from '../src/types/database'

const sha = (value: string) => createHash('sha256').update(value).digest('hex')
type Rows = Record<string, Array<Record<string, unknown>>>
type Cell = { schema: 'public' | 'private'; table: string; id: string; columns: string[] }
type Plan = ReturnType<typeof assignmentListRevocationPlans>[number]
const identity = (row: Record<string, unknown>, table: string) => String(row.id ?? row.generation_id ?? row.user_id ?? (table === 'public.classroom_archive_revisions' ? row.classroom_id : undefined) ?? JSON.stringify(row))
/** Callers must also prove cleanup gates OFF, no grading work and no Vault secrets.
 * The two installed SQL watchdogs then cannot issue network callbacks. */
export function assignmentListSafeCronJobs(jobs: Array<Record<string, unknown>>): boolean {
  const allowed = new Map([
    ['pika-removed-student-cleanup-watchdog', 'select private.run_removed_student_cleanup_watchdog()'],
    ['pika-test-ai-grading-watchdog', 'select private.watchdog_test_ai_grading_runs()'],
  ])
  return jobs.every(job => job.active === false || (job.active === true && typeof job.jobname === 'string' && typeof job.command === 'string' && allowed.get(job.jobname) === job.command.trim()))
}
export function assignmentListRowChanges(before: Rows, after: Rows): Cell[] {
  const changes: Cell[] = []
  for (const name of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    const [schema, table] = name.split('.'); assert(schema && table)
    const previous = new Map((before[name] ?? []).map(row => [identity(row, name), row]))
    const current = new Map((after[name] ?? []).map(row => [identity(row, name), row]))
    assert.equal(previous.size, (before[name] ?? []).length); assert.equal(current.size, (after[name] ?? []).length)
    for (const id of [...new Set([...previous.keys(), ...current.keys()])].sort()) {
      const a = previous.get(id); const b = current.get(id)
      const columns = !a || !b ? ['__row__'] : [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().filter(key => JSON.stringify(a[key]) !== JSON.stringify(b[key]))
      if (columns.length) { assert(schema === 'public' || schema === 'private'); changes.push({ schema, table, id, columns }) }
    }
  }
  return changes
}
export function assignmentListExpectedResources(projectId: string) {
  validateAssignmentListEphemeralIdentity({ projectId, workdir: assignmentListProofWorkdir(projectId) })
  return [
    ...['db', 'storage', 'rest', 'auth', 'kong'].map(service => ({ kind: 'container' as const, name: `supabase_${service}_${projectId}` })),
    ...['db', 'storage'].map(service => ({ kind: 'volume' as const, name: `supabase_${service}_${projectId}` })),
    { kind: 'network' as const, name: `supabase_network_${projectId}` },
  ]
}
export function assignmentListRestorationPolicy(fixture: AssignmentListProofFixture, plan: Plan) {
  const allowedCells: Cell[] = [
    { schema: 'public', table: 'classrooms', id: plan.classroomId, columns: ['blueprint_source_revision', 'updated_at'] },
    { schema: 'public', table: 'classroom_archive_revisions', id: plan.classroomId, columns: ['revision', 'updated_at'] },
  ]
  if (plan.transition === 'member-remove') {
    const removals = assignmentListRevocationPlans(fixture).filter(p => p.transition === 'member-remove')
    const n = removals.findIndex(p => p.boundary === plan.boundary)
    const old = n === 0 ? fixture.enrollments.find(e => e.classroom === plan.classroomId && e.student === plan.actorId)!.id : fixture.replacementEnrollments[n - 1].id
    const replacement = fixture.replacementEnrollments[n].id
    allowedCells.push({ schema: 'public', table: 'classroom_enrollments', id: old, columns: ['__row__'] },
      { schema: 'public', table: 'classroom_enrollments', id: replacement, columns: ['__row__'] },
      { schema: 'private', table: 'pal_membership_generations', id: old, columns: ['state'] },
      { schema: 'private', table: 'pal_membership_generations', id: replacement, columns: ['__row__'] })
  }
  if (plan.transition === 'grade-withdraw' || plan.transition === 'feedback-withdraw') allowedCells.push({ schema: 'public', table: 'assignment_docs', id: fixture.docs.find(d => d.returned)!.id, columns: ['updated_at'] })
  return { transition: plan.transition, boundary: plan.boundary, allowedCells }
}

export class AssignmentListStartupError extends Error {
  constructor(public readonly diagnosticPath: string) { super('Private isolated startup failure'); this.name = 'AssignmentListStartupError' }
}
function boundedStartupTail(value: string) {
  const bytes = Buffer.from(value, 'utf8')
  let start = Math.max(0, bytes.length - 16384)
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++
  return bytes.subarray(start).toString('utf8')
}
/** Startup-only output never includes canonical snapshot rows; do not print it. */
export function writeAssignmentListStartupDiagnostic(projectId: string, evidence: { code: unknown; killed: boolean; stdout: string; stderr: string }) {
  const path = `${assignmentListProofWorkdir(projectId)}-startup.json`
  assert.equal(realpathSync(dirname(path)), dirname(path))
  const receipt = { stage: 'start', code: typeof evidence.code === 'string' || typeof evidence.code === 'number' ? evidence.code : null,
    killed: evidence.killed, stdout: boundedStartupTail(evidence.stdout), stderr: boundedStartupTail(evidence.stderr) }
  writeFileSync(path, JSON.stringify(receipt), { mode: 0o600, flag: 'wx' })
  return path
}
async function command(file: string, args: string[], options: { input?: string; timeout?: number; startupProjectId?: string } = {}): Promise<string> {
  if (options.startupProjectId) {
    assert.equal(file, 'supabase'); assert.equal(args[0], 'start'); assignmentListProofWorkdir(options.startupProjectId)
  }
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, { timeout: options.timeout ?? 20000, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        try {
          if (options.startupProjectId) return reject(new AssignmentListStartupError(writeAssignmentListStartupDiagnostic(options.startupProjectId, { code: error.code, killed: error.killed === true, stdout, stderr })))
        } catch { return reject(new Error('Private startup diagnostic failed')) }
        reject(new Error('Private platform command failed'))
      } else resolve(stdout.trim())
    })
    child.stdin?.on('error', () => reject(new Error('Private platform input failed')))
    child.stdin?.end(options.input)
  })
}
const containerTemplate = '{"id":{{json .Id}},"name":{{json .Name}},"labels":{{json .Config.Labels}},"mounts":{{json .Mounts}},"networks":{{json .NetworkSettings.Networks}},"bindings":{{json .HostConfig.PortBindings}},"created":{{json .Created}}}'
async function dockerInventory(): Promise<AssignmentListResource[]> {
  const ids = async (args: string[]) => (await command('docker', args)).split(/\s+/).filter(Boolean)
  const containers = await Promise.all((await ids(['ps', '-aq', '--no-trunc'])).map(async id => JSON.parse(await command('docker', ['inspect', id, '--format', containerTemplate]))))
  const volumes = await Promise.all((await ids(['volume', 'ls', '-q'])).map(async name => JSON.parse(await command('docker', ['volume', 'inspect', name]))[0]))
  const networks = await Promise.all((await ids(['network', 'ls', '-q', '--no-trunc'])).map(async id => JSON.parse(await command('docker', ['network', 'inspect', id]))[0]))
  const volumeId = (name: string) => { const volume = volumes.find(v => v.Name === name); assert(volume); return `volume:${name}:${volume.CreatedAt}` }
  const result: AssignmentListResource[] = containers.map(c => ({ kind: 'container', id: c.id, createdAt: c.created, name: c.name.replace(/^\//, ''), labels: c.labels ?? {},
    attachedIds: [...c.mounts.filter((m: { Type: string }) => m.Type === 'volume').map((m: { Name: string }) => volumeId(m.Name)),
      ...Object.values(c.networks ?? {}).map(n => (n as { NetworkID: string }).NetworkID)],
    ports: [...new Set(Object.values(c.bindings ?? {}).flatMap(bindings => (bindings as Array<{ HostPort: string }> | null ?? []).map(binding => Number(binding.HostPort))))].sort((a, b) => a - b) }))
  for (const v of volumes) result.push({ kind: 'volume', id: volumeId(v.Name), createdAt: v.CreatedAt, name: v.Name, labels: v.Labels ?? {}, ports: [], attachedIds: containers.filter(c => c.mounts.some((m: { Type: string; Name: string }) => m.Type === 'volume' && m.Name === v.Name)).map(c => c.id) })
  for (const n of networks) result.push({ kind: 'network', id: n.Id, createdAt: n.Created, name: n.Name, labels: n.Labels ?? {}, ports: [], attachedIds: Object.keys(n.Containers ?? {}) })
  return result.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))
}
async function occupied(port: number): Promise<boolean> {
  return new Promise(resolve => { const server = createServer(); server.once('error', () => resolve(true)); server.listen(port, '127.0.0.1', () => server.close(() => resolve(false))) })
}
const snapshotSql = (rows: boolean) => `begin isolation level repeatable read read only;
set local statement_timeout='20s';set local lock_timeout='3s';
select format('select jsonb_build_object(''table'',%L,''rows'',%s) from %I.%I r', n.nspname||'.'||c.relname,
 ${rows ? "'coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),''[]''::jsonb)'" : "'jsonb_build_object(''count'',count(*),''digest'',md5(coalesce(string_agg(md5(to_jsonb(r)::text),'''' order by md5(to_jsonb(r)::text)),'''')))'"},n.nspname,c.relname)
from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and n.nspname in ('public','private','storage') order by n.nspname,c.relname
\\gexec
select jsonb_build_object('metadata',jsonb_build_object(
 'functions',(select jsonb_agg(jsonb_build_array(n.nspname,p.proname,md5(pg_get_functiondef(p.oid)),p.proacl) order by p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='private' and p.proname in ('pal_membership_scope','guard_pal_membership_evidence','register_pal_membership','track_pal_membership_enrollment','track_pal_removed_roster')) or (n.nspname='public' and p.proname='resolve_pal_membership')),
 'triggers',(select jsonb_agg(jsonb_build_array(t.tgname,pg_get_triggerdef(t.oid),t.tgenabled) order by t.tgname) from pg_trigger t where t.tgrelid in ('private.pal_membership_generations'::regclass,'public.classroom_enrollments'::regclass,'public.classroom_roster'::regclass) and not t.tgisinternal),
 'rls_acl',(select jsonb_agg(jsonb_build_array(c.relname,c.relrowsecurity,c.relacl) order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname in ('pal_membership_generations','pal_membership_settings')),
 'singleton_index',pg_get_indexdef('public.classroom_roster_one_removed_membership_per_student'::regclass),
 'settings',(select md5(string_agg(name||'='||setting,chr(10) order by name)) from pg_settings)));
select 'select jsonb_build_object(''cron'',coalesce(jsonb_agg(to_jsonb(j) order by j.jobid),''[]''::jsonb)) from cron.job j' where to_regclass('cron.job') is not null
\\gexec
rollback;`
async function sql(projectId: string, input: string, applicationName: string) {
  assert(projectId === 'pika' || /^pika_assignment_list_[a-f0-9]{12}$/.test(projectId))
  const resources = await dockerInventory(); const db = resources.find(r => r.kind === 'container' && r.name === `supabase_db_${projectId}`)
  assert(db && db.labels['com.supabase.cli.project'] === projectId && db.labels['com.docker.compose.project'] === projectId)
  assert(db.ports.length > 0 && db.ports.every(p => p === (projectId === 'pika' ? 54322 : 54332)))
  return command('docker', ['exec', '-i', '-e', `PGAPPNAME=${applicationName}`, db.id, 'psql', '-U', 'postgres', '-d', 'postgres', '-XqAt', '-v', 'ON_ERROR_STOP=1'], { input, timeout: 60000 })
}
async function databaseSnapshot(projectId: string, rows: boolean) {
  const lines = (await sql(projectId, snapshotSql(rows), `${projectId}_snapshot`)).split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
  const tables = Object.fromEntries(lines.filter(row => row.table).map(row => [row.table, row.rows]))
  assert(Object.keys(tables).length > 0)
  const metadata = lines.find(row => row.metadata)?.metadata; assert(metadata)
  return { tables, metadata: JSON.stringify(metadata), cron: JSON.stringify(lines.find(row => row.cron)?.cron ?? []) }
}
export function loadAssignmentListReviewedMigrations(repository: string) {
  const folder = join(repository, 'supabase/migrations'); const names = readdirSync(folder).filter(name => /^\d{3}_.*\.sql$/.test(name)).sort()
  assert.equal(names.length, 239)
  return names.map((name, n) => { assert(name.startsWith(`${String(n + 1).padStart(3, '0')}_`)); const content = readFileSync(join(folder, name), 'utf8'); return { name, sql: content, sha256: sha(content) } })
}

/** No database/resources exist yet. Partial writes remain exclusively ours. */
export function prepareAssignmentListProjectFiles(
  plan: Parameters<AssignmentListLifecycleAdapters['prepare']>[0],
  migrations: Parameters<AssignmentListLifecycleAdapters['prepare']>[1],
  checkpoint?: (stage: 'directory' | 'migration') => void,
) {
  validateAssignmentListEphemeralIdentity(plan)
  for (const migration of migrations) assert.match(migration.name, /^\d{3}_[a-z0-9_]+\.sql$/)
  const workdir = plan.workdir
  assert.equal(realpathSync(dirname(workdir)), dirname(workdir)); assert(!existsSync(workdir))
  mkdirSync(workdir, { mode: 0o700 })
  try {
    checkpoint?.('directory')
    mkdirSync(join(workdir, 'supabase/migrations'), { recursive: true, mode: 0o700 })
    writeFileSync(join(workdir, 'supabase/config.toml'), plan.config, { mode: 0o600, flag: 'wx' })
    for (const migration of migrations) {
      writeFileSync(join(workdir, 'supabase/migrations', migration.name), migration.sql, { mode: 0o600, flag: 'wx' })
      checkpoint?.('migration')
    }
    return { workdir, realpath: realpathSync(workdir), created: true, configSha256: sha(readFileSync(join(workdir, 'supabase/config.toml'), 'utf8')),
      migrations: migrations.map(m => ({ name: m.name, sha256: sha(readFileSync(join(workdir, 'supabase/migrations', m.name), 'utf8')) })), envFiles: [], symlinks: [] }
  } catch (error) {
    assert.equal(realpathSync(workdir), workdir)
    rmSync(workdir, { recursive: true })
    throw error
  }
}

export function createAssignmentListNativeAdapters(fixture: AssignmentListProofFixture): AssignmentListLifecycleAdapters {
  const projectId = `pika_assignment_list_${fixture.manifest.syntheticTag.slice(-12)}`
  const workdir = assignmentListProofWorkdir(projectId)
  const createdDirectories = new Set<string>()
  let beforeTransition: Rows | undefined
  return {
    async canonicalSnapshot() {
      const baseline = await databaseSnapshot('pika', false)
      const resources = (await dockerInventory()).filter(r => r.labels['com.supabase.cli.project'] === 'pika')
      assert(resources.length > 0)
      return { rowDigests: JSON.stringify(baseline.tables), guard168Metadata: baseline.metadata, settings: baseline.metadata, cronJobs: baseline.cron, resources: JSON.stringify(resources) }
    },
    async inventory() {
      return { resources: await dockerInventory(), occupiedPorts: (await Promise.all([54340, 54331, 54332].map(async port => ({ port, busy: await occupied(port) })))).filter(r => r.busy).map(r => r.port), workdirExists: existsSync(workdir) }
    },
    async prepare(plan, migrations) {
      assert.equal(plan.workdir, workdir)
      const prepared = prepareAssignmentListProjectFiles(plan, migrations)
      createdDirectories.add(workdir)
      return prepared
    },
    async command(request) {
      assert.equal(request.workdir, workdir)
      const output = await command('supabase', [...request.args], { timeout: request.timeoutMs, ...(request.args[0] === 'start' ? { startupProjectId: projectId } : {}) })
      return request.args[0] === 'status' ? JSON.parse(output) : undefined
    },
    async verifyEphemeral(input) {
      const resources = await dockerInventory(); const db = resources.find(r => r.kind === 'container' && r.name === `supabase_db_${projectId}`); assert(db)
      const gates = await sql(projectId, `select jsonb_build_object('guard',exists(select 1 from pg_trigger where tgrelid='private.pal_membership_generations'::regclass and tgname='guard_pal_membership_evidence' and tgenabled='O'),
        'off',not ((select enabled from private.pal_membership_settings where singleton) or (select enabled from private.pal_classroom_signal_settings where singleton) or (select enabled or live_enabled or automatic_enabled from private.student_provider_cleanup_settings where singleton) or (select enabled from private.removed_student_academic_settings where singleton) or (select strict_enforcement_enabled from private.classroom_creation_entitlement_settings where singleton)),
        'no_work',not exists(select 1 from public.test_ai_grading_runs) and not exists(select 1 from public.test_ai_grading_run_items),
        'no_secrets',not exists(select 1 from vault.secrets));`, input.applicationName)
      const result = JSON.parse(gates); const snapshot = await databaseSnapshot(projectId, false)
      const jobs = JSON.parse(snapshot.cron) as Array<Record<string, unknown>>
      return { projectId, containerId: db.id, applicationName: input.applicationName, dbPort: 54332, guard168Enabled: result.guard === true, persistedGatesOff: result.off === true, activeNetworkCronAbsent: result.no_work === true && result.no_secrets === true && assignmentListSafeCronJobs(jobs) }
    },
    async executeSql(input) {
      assert.equal(input.projectId, projectId); assert.equal(input.applicationName, `${projectId}_fixture`)
      const db = (await dockerInventory()).find(r => r.kind === 'container' && r.name === `supabase_db_${projectId}`)
      assert.equal(db?.id, input.containerId)
      await sql(projectId, input.sql, input.applicationName)
    },
    async runCase({ proofCase, target }) {
      assert(proofCase.expectedStatus === '200' || proofCase.expectedStatus === '403')
      const urls: URL[] = []
      const safeFetch = containedAssignmentListProofFetch(fetch, projectId)
      const client = createClient<Database>(target.API_URL, target.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (request, init) => {
        const url = new URL(request instanceof Request ? request.url : String(request)); urls.push(url)
        assert.equal(url.pathname, '/rest/v1/classrooms'); assert.equal(url.searchParams.get('id'), `eq.${proofCase.classroomId}`); assert(!url.searchParams.get('select')?.includes('*'))
        if (urls.length > 1) { assert.equal(url.searchParams.get('teacher_id'), `${proofCase.permission === 'owner' ? 'eq' : 'neq'}.${proofCase.actorId}`)
          if (proofCase.permission === 'member') { assert.equal(url.searchParams.get('archived_at'), 'is.null'); assert.equal(url.searchParams.get('membership.student_id'), `eq.${proofCase.actorId}`) } }
        return safeFetch(request, init)
      } } })
      const read = () => readContextualAssignmentList({ supabase: client, actorId: proofCase.actorId, classroomId: proofCase.classroomId, permission: proofCase.permission, now: new Date(fixture.manifest.now) })
      if (proofCase.expectedStatus !== '200') await assert.rejects(read, error => error instanceof ApiError && error.statusCode === Number(proofCase.expectedStatus))
      else {
        const result = await read(); assert.deepEqual(result.assignments.map(row => row.id), proofCase.assignmentIds)
        for (const expected of proofCase.stats ?? []) { const row = result.assignments.find(a => a.id === expected.id)!; assert(row)
          assert.equal((row.stats as { total_students: number }).total_students, expected.totalStudents); assert.equal((row.stats as { submitted: number }).submitted, expected.submitted)
          assert.deepEqual((row.submission_requirements as Array<{ id: string }>).map(r => r.id), expected.requirementIds) }
        for (const row of result.assignments) if (proofCase.permission === 'member' && row.doc) {
          const doc = row.doc as Record<string, unknown>
          for (const key of ['authenticity_score', 'authenticity_flags', 'teacher_feedback_draft', 'ai_feedback_suggestion', 'ai_feedback_model']) assert.equal(doc[key], null)
          assert(!('ai_grading_provenance' in doc) && !('ai_grading_review' in doc))
          if (!doc.returned_at) for (const key of ['score_completion', 'score_thinking', 'score_workflow', 'graded_at', 'graded_by']) assert.equal(doc[key], null)
        }
        assert(!urls.at(-1)?.searchParams.get('select')?.includes('assignments:'))
      }
      return { actorId: proofCase.actorId, classroomId: proofCase.classroomId, status: proofCase.expectedStatus }
    },
    async runRevocation(input) {
      beforeTransition = (await databaseSnapshot(projectId, true)).tables as Rows
      return observeAssignmentListRevocation({ ...input, originalFetch: fetch, transition: input.executeSql })
    },
    async verifyRestoration({ plan }) {
      assert(beforeTransition)
      const after = (await databaseSnapshot(projectId, true)).tables as Rows
      const changes = assignmentListRowChanges(beforeTransition, after)
      const policy = assignmentListRestorationPolicy(fixture, plan)
      const permitted = (cell: Cell) => policy.allowedCells.some(allow => allow.schema === cell.schema && allow.table === cell.table && allow.id === cell.id && cell.columns.every(column => allow.columns.includes(column)))
      assert(changes.every(permitted), 'restoration-scope')
      const filter = (rows: Rows) => JSON.stringify(Object.fromEntries(Object.entries(rows).map(([name, values]) => [name, values.filter(row => !policy.allowedCells.some(c => `${c.schema}.${c.table}` === name && c.id === identity(row, name)))])))
      const nonTargetBefore = sha(filter(beforeTransition)); const nonTargetAfter = sha(filter(after)); assert.equal(nonTargetBefore, nonTargetAfter, 'restoration-nontarget')
      // All business fields compare equal; only enumerated trigger bookkeeping
      // and fresh enrollment/generation rows may differ after restoration.
      const classroom = after['public.classrooms'].find(row => row.id === plan.classroomId)!; assert.equal(classroom.teacher_id, fixture.classes[0].owner, 'restoration-owner'); assert.equal(classroom.archived_at, null, 'restoration-archive')
      assert((classroom.feature_visibility as Record<string, unknown>).classwork !== false, 'restoration-visibility')
      assert(after['public.classroom_enrollments'].some(row => row.classroom_id === plan.classroomId && row.student_id === fixture.manifest.actors[2].id), 'restoration-member')
      return { nonTargetBefore, nonTargetAfter, semanticRestored: true, changedCells: changes }
    },
    async teardown(input) {
      assert.equal(input.projectId, projectId)
      const current = await dockerInventory()
      for (const captured of input.resources) { const resource = current.find(r => r.id === captured.id && r.kind === captured.kind); assert(resource && JSON.stringify(resource) === JSON.stringify(captured)) }
      if (input.stopArgs) await command('supabase', input.stopArgs, { timeout: 120000 })
      else {
        for (const kind of ['container', 'network', 'volume'] as const) for (const resource of input.resources.filter(r => r.kind === kind)) {
          if (kind === 'container') await command('docker', ['rm', '-f', resource.id])
          else if (kind === 'network') await command('docker', ['network', 'rm', resource.id])
          else await command('docker', ['volume', 'rm', resource.name])
        }
      }
    },
    async removeWorkdir(input) {
      assert(createdDirectories.has(input.workdir)); assert.equal(input.workdir, workdir); assert.equal(input.realpath, realpathSync(workdir)); assert.equal(input.realpath, workdir)
      rmSync(workdir, { recursive: true }); createdDirectories.delete(workdir)
    },
  }
}
