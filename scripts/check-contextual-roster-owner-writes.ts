// Source-only until the root task installs reviewed 235. Local SDK/serialized proofs;
// exact random fixtures, no migration application, settings changes or provider calls.
import assert from 'node:assert/strict'
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'
import { ApiError } from '../src/lib/api-error'
import { getServiceRoleClient } from '../src/lib/supabase'
import { upsertContextualRoster, patchContextualRosterCounselor } from '../src/lib/server/contextual-roster-mutation'
import { rosterPersistedRowSchema, rosterUpsertEnvelopeSchema, type RosterStudent } from '../src/lib/validations/roster-mutations'

const container = 'supabase_db_pika'
const tag = `rosterwrite_${randomUUID().slice(0, 8)}`
const owner = randomUUID(), teacher = randomUUID(), learner = randomUUID(), classmate = randomUUID(), removed = randomUUID()
const classroom = randomUUID(), otherClassroom = randomUUID()
const learnerRoster = randomUUID(), classmateRoster = randomUUID(), removedRoster = randomUUID(), patchRoster = randomUUID()
const email = (label: string) => `${tag}_${label}@example.invalid`
const people = [[owner, 'owner', 'student'], [teacher, 'teacher', 'teacher'], [learner, 'learner', 'teacher'],
  [classmate, 'classmate', 'student'], [removed, 'removed', 'student']] as const
const classes = [[classroom, owner, 'primary', 'p'], [otherClassroom, teacher, 'other', 'o']] as const
const grants = [owner, teacher].map(subject => ({ subject, operation: randomUUID() }))
const q = (value: string) => `'${value.replaceAll("'", "''")}'`
const json = (value: unknown) => `${q(JSON.stringify(value))}::jsonb`
const ids = (values: readonly string[]) => values.map(q).join(',')
const peopleValues = people.map(([id, label]) => `(${q(id)}::uuid,${q(email(label))})`).join(',')
const grantValues = grants.map(({ subject, operation }) => `(${q(operation)}::uuid,${q(subject)}::uuid)`).join(',')
const classIds = classes.map(([id]) => id)
const personIds = people.map(([id]) => id)
const sessions: Session[] = []
const tables = ['users', 'classrooms', 'classroom_roster', 'classroom_roster_student_bindings', 'classroom_enrollments',
  'student_purge_fences', 'student_purge_operations', 'classroom_archive_revisions', 'account_plans', 'account_plan_audit',
  'effective_feature_entitlements', 'effective_feature_entitlement_audit', 'entries', 'gradebook_item_scores',
  'attendance_check_in_facts', 'attendance_record_projection', 'attendance_status_overrides'] as const

function command(binary: string, args: string[], input?: string): string {
  try {
    return execFileSync(binary, args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 40_000, maxBuffer: 8_000_000 }).trim()
  } catch (error: unknown) {
    const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : ''
    const code = /ERROR:\s+([A-Z0-9]{5}):/.exec(stderr)?.[1]
    // Never attach command output: CLI status contains service credentials.
    throw new Error(code ? `Local proof SQL rejected (${code})` : 'Local proof command failed')
  }
}
function sql(statement: string) {
  return command('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-XqAt',
    '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], `set statement_timeout='30s'; set lock_timeout='5s'; ${statement}`)
}
function baseline(): unknown {
  return JSON.parse(sql(`select jsonb_build_object(${tables.map(table => `${q(table)},(select count(*) from public.${table})`).join(',')});`))
}
function snapshot(): unknown {
  return JSON.parse(sql(`select jsonb_build_object(
    'roster',(select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]') from public.classroom_roster r where classroom_id in (${ids(classIds)})),
    'bindings',(select coalesce(jsonb_agg(to_jsonb(b) order by roster_id),'[]') from public.classroom_roster_student_bindings b where classroom_id in (${ids(classIds)})),
    'enrollments',(select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]') from public.classroom_enrollments e where classroom_id in (${ids(classIds)})),
    'revisions',(select coalesce(jsonb_agg(to_jsonb(r) order by classroom_id),'[]') from public.classroom_archive_revisions r where classroom_id in (${ids(classIds)})),
    'blueprint',(select jsonb_agg(jsonb_build_object('id',id,'revision',blueprint_source_revision) order by id) from public.classrooms where id in (${ids(classIds)})));`))
}
function row(id: string) {
  return rosterPersistedRowSchema.parse(JSON.parse(sql(`select to_jsonb(r) from public.classroom_roster r where id=${q(id)};`)))
}
function binding(id: string): unknown {
  return JSON.parse(sql(`select coalesce((select to_jsonb(b) from public.classroom_roster_student_bindings b where roster_id=${q(id)}),'null'::jsonb);`))
}
const archiveRevision = () => BigInt(sql(`select revision from public.classroom_archive_revisions where classroom_id=${q(classroom)};`))
const blueprintRevision = () => BigInt(sql(`select blueprint_source_revision from public.classrooms where id=${q(classroom)};`))
const student = (label: string, firstName = 'First'): RosterStudent => ({ email: email(label), firstName,
  lastName: 'Last', studentNumber: '42', counselorEmail: null })
const apiStatus = (status: number) => (error: unknown) => error instanceof ApiError && error.statusCode === status
const upsert = (students: RosterStudent[], mode: 'manual' | 'csv-preview' | 'csv-confirmed' = 'manual', actorId = owner, classroomId = classroom) =>
  upsertContextualRoster({ actorId, classroomId, students, mode })
async function write(students: RosterStudent[], mode: 'manual' | 'csv-preview' | 'csv-confirmed' = 'manual', actorId = owner, classroomId = classroom) {
  const result = await upsert(students, mode, actorId, classroomId)
  assert('success' in result && result.success)
  return result
}
const patch = (rosterId = learnerRoster, counselor_email: string | null = 'Counselor@Example.INVALID',
  actorId = owner, classroomId = classroom, expected_updated_at = row(rosterId).updated_at) =>
  patchContextualRosterCounselor({ actorId, classroomId, rosterId, body: { counselor_email, expected_updated_at } })
const rawUpsert = (students = [student('learner')], mode = 'manual') =>
  `select public.upsert_classroom_roster_for_owner_v1(${q(owner)},${q(classroom)},${json(students)},${q(mode)})::text;`
const rawPatch = () => `select public.update_classroom_roster_counselor_for_owner_v1(${q(owner)},${q(classroom)},
  ${q(learnerRoster)},'Changed@Example.INVALID',${q(row(learnerRoster).updated_at)})::text;`
const service = (statement: string) => `set local role service_role; ${statement}`

class Session {
  readonly name: string
  readonly child: ChildProcessWithoutNullStreams
  readonly done: Promise<void>
  closed = false
  private output = ''
  private pending: { marker: string; timer: NodeJS.Timeout; resolve: (result: string) => void; reject: (error: Error) => void } | null = null
  constructor(label: string) {
    this.name = `${tag}_${label}`
    this.child = spawn('docker', ['exec', '-i', '-e', `PGAPPNAME=${this.name}`, container, 'psql', '-U', 'postgres',
      '-d', 'postgres', '-XqAt', '-v', 'ON_ERROR_STOP=1'], { stdio: 'pipe' })
    this.child.stdout.on('data', chunk => {
      this.output += String(chunk)
      if (this.pending && this.output.includes(this.pending.marker)) {
        const pending = this.pending; this.pending = null; clearTimeout(pending.timer)
        pending.resolve(this.output.slice(0, this.output.indexOf(pending.marker)).trim())
      }
    })
    this.child.stderr.on('data', () => { /* Never echo captured SQL/credentials. */ })
    this.child.stdin.on('error', () => this.fail())
    this.child.on('error', () => this.fail())
    this.done = new Promise(resolve => this.child.on('close', () => { this.closed = true; this.fail(); resolve() }))
    sessions.push(this)
  }
  private fail() {
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(new Error('Local proof SQL session failed')); this.pending = null }
  }
  run(statement: string) {
    assert(!this.closed && !this.pending)
    this.output = ''
    const marker = `done_${randomUUID()}`
    return new Promise<string>((resolve, reject) => {
      this.pending = { marker, resolve, reject, timer: setTimeout(() => this.fail(), 20_000) }
      this.child.stdin.write(`set statement_timeout='15s'; set lock_timeout='10s'; ${statement}\n\\echo ${marker}\n`)
    })
  }
  async close() {
    if (!this.closed) this.child.stdin.end('ROLLBACK;\n\\q\n')
    const force = setTimeout(() => this.child.kill('SIGTERM'), 4000)
    const hard = setTimeout(() => this.child.kill('SIGKILL'), 7000)
    let timeout: NodeJS.Timeout | undefined
    try { await Promise.race([this.done, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Local proof session close failed')), 9000) })]) }
    finally { clearTimeout(force); clearTimeout(hard); clearTimeout(timeout) }
  }
}
async function holder(label: string, statement: string, proof: () => Promise<void>) {
  const session = new Session(label)
  try { await session.run(`begin; ${statement}`); await proof() } finally { await session.close() }
}
async function expectBlocked(observer: Session, waiter: Session, ownerSession: Session) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const waiting = await observer.run(`select exists(select 1 from pg_stat_activity w,pg_stat_activity h
      where w.application_name=${q(waiter.name)} and h.application_name=${q(ownerSession.name)}
        and w.wait_event_type='Lock' and h.pid=any(pg_blocking_pids(w.pid)));`)
    if (waiting === 't') return
    assert(!waiter.closed, 'Writer unexpectedly closed'); await delay(25)
  }
  throw new Error('Missing serialized blocking evidence')
}

async function main() {
  assert.equal(command('docker', ['inspect', container, '--format', '{{ index .Config.Labels "com.supabase.cli.project" }}']), 'pika')
  assert.match(command('docker', ['port', container, '5432/tcp']), /:54322\s*$/m)
  let rawStatus: unknown
  try { rawStatus = JSON.parse(command('supabase', ['status', '-o', 'json'])) } catch { throw new Error('Local Supabase status unavailable') }
  const status = z.object({ API_URL: z.literal('http://127.0.0.1:54321'), ANON_KEY: z.string().min(1), SERVICE_ROLE_KEY: z.string().min(1) }).safeParse(rawStatus)
  if (!status.success) throw new Error('Local Supabase target guard failed')
  process.env.NEXT_PUBLIC_SUPABASE_URL = status.data.API_URL
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = status.data.ANON_KEY
  process.env.SUPABASE_SECRET_KEY = status.data.SERVICE_ROLE_KEY
  const client = getServiceRoleClient()
  assert.equal(sql("select exists(select 1 from supabase_migrations.schema_migrations where version='235');"), 't', 'Reviewed235 must already be installed')
  const initialBaseline = baseline()
  try {
    sql(`begin;
      insert into public.users(id,email,role) values ${people.map(([id, label, role]) => `(${q(id)},${q(email(label))},${q(role)})`).join(',')};
      set local role service_role;
      select public.set_effective_feature_entitlement_v1(operation,u,'classrooms.create','manual',true,clock_timestamp(),null,3,
        'test:235',${q(tag)},coalesce((select revision from public.effective_feature_entitlements where subject_user_id=u and feature_key='classrooms.create'),0))
        from (values ${grantValues}) fixture(operation,u);
      reset role;
      insert into public.classrooms(id,teacher_id,title,class_code) values ${classes.map(([id, actor, label, suffix]) => `(${q(id)},${q(actor)},${q(`${tag} ${label}`)},${q(`${tag}_${suffix}`)})`).join(',')};
      insert into public.classroom_enrollments(classroom_id,student_id) values (${q(classroom)},${q(learner)}),(${q(classroom)},${q(classmate)});
      insert into public.classroom_roster(id,classroom_id,email,first_name,last_name,student_number,join_source,updated_at) values
        (${q(learnerRoster)},${q(classroom)},${q(email('learner'))},'First','Last','42','manual',clock_timestamp()),
        (${q(classmateRoster)},${q(classroom)},${q(email('classmate'))},'First','Last','42','manual',clock_timestamp()),
        (${q(patchRoster)},${q(classroom)},${q(email('patch'))},'Patch','Only',null,'manual','2026-10-04T12:34:56.123456Z');
      insert into public.classroom_roster(id,classroom_id,email,first_name,last_name,removed_at,removed_student_id,removed_enrollment_id,
        removed_enrolled_at,retained_manual_attendance_marks)
        values(${q(removedRoster)},${q(classroom)},${q(email('removed_historical'))},'Removed','Historical',clock_timestamp(),${q(removed)},${q(randomUUID())},
          '2026-01-01T00:00:00Z','{}'::jsonb);
      -- Teacher-valued learner intentionally starts without a stable binding.
      delete from public.classroom_roster_student_bindings where roster_id=${q(learnerRoster)} and classroom_id=${q(classroom)} and student_id=${q(learner)};
      commit;`)
    if (process.argv.includes('--verify-cleanup-after-fixture')) throw new Error('Forced post-fixture cleanup proof')
    const enrollments = sql(`select jsonb_agg(to_jsonb(e) order by id) from public.classroom_enrollments e where classroom_id=${q(classroom)};`)

    const micros = await patch(patchRoster, ' MiXeD@Example.INVALID ', owner, classroom, '2026-10-04T08:34:56.123456-04:00')
    assert.equal(micros.roster.counselor_email, 'MiXeD@Example.INVALID')
    await assert.rejects(patch(patchRoster, 'Again', owner, classroom, '2026-10-04T08:34:56.123455-04:00'), apiStatus(409))
    await assert.rejects(patch(patchRoster, 'Again', owner, classroom, '2026-10-04T08:34:56.123456-04:00'), apiStatus(409))
    assert.equal((await patch(patchRoster, ' ')).roster.counselor_email, null)
    const samePatchBefore = row(patchRoster), samePatchRevision = archiveRevision(), unchangedBlueprint = blueprintRevision()
    await patch(patchRoster, null)
    const samePatchAfter = row(patchRoster)
    assert.deepEqual({ ...samePatchAfter, updated_at: samePatchBefore.updated_at }, samePatchBefore)
    assert.equal(archiveRevision(), samePatchRevision + BigInt(1))
    assert.equal(blueprintRevision(), unchangedBlueprint)
    assert.equal((await write([student('invite')])).upsertedCount, 1)
    assert.equal((await write([student('teacher_invite')], 'manual', teacher, otherClassroom)).upsertedCount, 1)
    for (const actor of [learner, classmate]) {
      await assert.rejects(upsert([student('denied')], 'manual', actor), apiStatus(403))
      await assert.rejects(patch(learnerRoster, null, actor), apiStatus(403))
    }
    await assert.rejects(upsert([student('missing')], 'manual', owner, randomUUID()), apiStatus(404))
    await assert.rejects(patch(patchRoster, null, teacher, otherClassroom), apiStatus(404))
    sql(`update public.classrooms set archived_at=clock_timestamp() where id=${q(classroom)};`)
    await assert.rejects(upsert([student('archived')]), apiStatus(403))
    await assert.rejects(patch(patchRoster), apiStatus(403))
    sql(`update public.classrooms set archived_at=null where id=${q(classroom)};`)

    // Confirmation must not write even a binding repair or archive revision.
    assert.equal(binding(learnerRoster), null)
    const beforePreview = snapshot()
    const preview = await upsert([student('learner', 'Changed'), student('csvnew')], 'csv-preview')
    assert('needsConfirmation' in preview && preview.needsConfirmation)
    assert.equal(preview.updateCount, 1); assert.equal(preview.newCount, 1); assert.equal(preview.totalCount, 2)
    assert.deepEqual(preview.changes[0].incoming, { firstName: 'Changed', lastName: 'Last', studentNumber: '42', counselorEmail: null })
    assert.deepEqual(snapshot(), beforePreview)
    assert.equal((await write([student('learner', 'Changed'), student('csvnew')], 'csv-confirmed')).upsertedCount, 2)
    assert.deepEqual(binding(learnerRoster), { roster_id: learnerRoster, classroom_id: classroom, student_id: learner,
      created_at: z.object({ created_at: z.string() }).parse(binding(learnerRoster)).created_at })
    const stableBinding = binding(learnerRoster)
    const beforeNoChange = snapshot()
    const noChangeRevision = archiveRevision()
    const noChange = await upsert([student('learner', 'Changed')], 'csv-preview')
    assert('success' in noChange && noChange.success)
    assert.notDeepEqual(snapshot(), beforeNoChange, 'No-change preview retains immediate legacy upsert behavior')
    assert.deepEqual(binding(learnerRoster), stableBinding)
    assert.equal(archiveRevision(), noChangeRevision + BigInt(1))
    assert.equal(blueprintRevision(), unchangedBlueprint)
    // Binding wins over changed current email, and two distinct legitimate rows may share one learner.
    sql(`update public.users set email=${q(email('learner_changed'))} where id=${q(learner)} and email=${q(email('learner'))};`)
    sql(`update public.users set email=${q(email('learner'))} where id=${q(classmate)} and email=${q(email('classmate'))};`)
    await upsert([student('learner', 'Bound A despite current email B')])
    assert.deepEqual(binding(learnerRoster), stableBinding)
    sql(`update public.users set email=${q(email('classmate'))} where id=${q(classmate)} and email=${q(email('learner'))};`)
    await upsert([student('learner', 'Stable identity'), student('learner_changed', 'Second legitimate row')])
    assert.deepEqual(binding(learnerRoster), stableBinding)
    assert.equal(sql(`select count(*) from public.classroom_roster_student_bindings where classroom_id=${q(classroom)} and student_id=${q(learner)};`), '2')
    const bounded = student('unicode', '😀'.repeat(500))
    bounded.studentNumber = '😀'.repeat(128)
    await upsert([bounded])
    for (const badRows of [[student('duplicate'), { ...student('duplicate'), email: ` ${email('duplicate').toUpperCase()} ` }],
      [student('overlong', '😀'.repeat(501))], Array.from({ length: 1001 }, (_, index) => student(`bound_${index}`))]) {
      await assert.rejects(upsert(badRows), error => error instanceof z.ZodError)
    }
    const rawDuplicate = await client.rpc('upsert_classroom_roster_for_owner_v1', { p_actor_id: owner, p_classroom_id: classroom,
      p_students: [student('dupraw'), student('dupraw')], p_mode: 'manual' })
    assert.equal(rawDuplicate.error?.code, '22023'); assert.equal(rawDuplicate.status, 400)
    const rawDenied = await client.rpc('upsert_classroom_roster_for_owner_v1', { p_actor_id: learner, p_classroom_id: classroom,
      p_students: [student('deniedraw')], p_mode: 'manual' })
    assert.equal(rawDenied.error?.code, '42501'); assert.equal(rawDenied.status, 403)
    for (const label of ['removed_historical', 'removed']) {
      const before = snapshot()
      await assert.rejects(upsert([student(label)], 'csv-preview'), apiStatus(409))
      assert.deepEqual(snapshot(), before)
    }
    await assert.rejects(patch(removedRoster, null, owner, classroom, '2026-10-04T00:00:00Z'), apiStatus(409))
    process.stdout.write('PASS roster actual SDK roles, CSV atomic preview/confirmation, binding identity, Unicode bounds and exact PATCH timestamps\n')

    // All conflict statements return PT409 while the other session still owns its lock.
    for (const [label, lock] of [
      ['class', `select id from public.classrooms where id=${q(classroom)} for update;`],
      ['revision', `select classroom_id from public.classroom_archive_revisions where classroom_id=${q(classroom)} for update;`],
      ['legacy_roster_first', `select id from public.classroom_roster where id=${q(learnerRoster)} for update;`],
      ['binding', `select roster_id from public.classroom_roster_student_bindings where roster_id=${q(learnerRoster)} for update;`],
      ['enrollment', `select id from public.classroom_enrollments where classroom_id=${q(classroom)} and student_id=${q(learner)} for update;`],
      ['purge_subject_first', `select pg_advisory_xact_lock(hashtextextended('pika-student-purge-subject:'||${q(learner)},0));`],
      ['removed_email_first', `update public.users set email=${q(email('email_race'))} where id=${q(removed)};`],
    ]) {
      await holder(label, lock, async () => {
        const before = snapshot()
        await assert.rejects(upsert([student(label === 'removed_email_first' ? 'email_race' : 'learner')]), apiStatus(409))
        await assert.rejects(patch(learnerRoster), apiStatus(409))
        assert.deepEqual(snapshot(), before)
      })
    }
    // A committed removed-account email change must become an immediate denial.
    sql(`update public.users set email=${q(email('email_race'))} where id=${q(removed)};`)
    await assert.rejects(upsert([student('email_race')], 'csv-preview'), apiStatus(409))
    sql(`update public.users set email=${q(email('removed'))} where id=${q(removed)};`)
    // Operation-first locking holds both class and matching user against independent legacy changes.
    for (const [label, change] of [
      ['owner_transfer', `update public.classrooms set teacher_id=${q(teacher)} where id=${q(classroom)};`],
      ['archive', `update public.classrooms set archived_at=clock_timestamp() where id=${q(classroom)};`],
      ['users_email', `update public.users set email=${q(email('learner_next'))} where id=${q(learner)};`],
    ]) {
      const writer = new Session(`${label}_writer`), changer = new Session(`${label}_changer`), observer = new Session(`${label}_observer`)
      try {
        const raw = await writer.run(`begin; ${service(rawUpsert())}`)
        const parsed = rosterUpsertEnvelopeSchema.parse({ data: JSON.parse(raw), error: null })
        assert.equal(parsed.error, null)
        const pending = changer.run(`begin; ${change}`)
        await expectBlocked(observer, changer, writer)
        await writer.run('commit;'); await pending; await changer.run('commit;')
      } finally { await Promise.all([writer.close(), changer.close(), observer.close()]) }
      if (label === 'owner_transfer') await assert.rejects(upsert([student('former_owner')]), apiStatus(403))
      if (label === 'archive') await assert.rejects(upsert([student('archived_after')]), apiStatus(403))
      sql(`update public.classrooms set teacher_id=${q(owner)},archived_at=null where id=${q(classroom)};
        update public.users set email=${q(email('learner_changed'))} where id=${q(learner)};`)
    }
    // Stale PATCH after a serialized writer must never overwrite its committed counselor.
    const priorPatch = row(learnerRoster)
    await patch(learnerRoster, 'First@Example.INVALID')
    await assert.rejects(patch(learnerRoster, 'Lost@Example.INVALID', owner, classroom, priorPatch.updated_at), apiStatus(409))
    assert.equal(row(learnerRoster).counselor_email, 'First@Example.INVALID')
    assert.equal(sql(`select jsonb_agg(to_jsonb(e) order by id) from public.classroom_enrollments e where classroom_id=${q(classroom)};`), enrollments)
    process.stdout.write('PASS roster serialized class/revision/legacy-row/purge-subject/users-email locks, owner/archive rechecks and no enrollment creation\n')
    // Standalone SQL script owns exact-fence and suppressed/substituted/AFTER-trigger rollback proofs.
    assert.match(sql(`begin; ${service(rawPatch())} rollback;`), /counselor_email/)
  } finally {
    const closed = await Promise.allSettled(sessions.map(session => session.close()))
    if (closed.some(result => result.status === 'rejected')) throw new Error('Refusing cleanup while a proof session may remain open')
    assert.equal(sql(`select count(*) from pg_stat_activity where application_name like ${q(`${tag}%`)};`), '0')
    sql(`begin;
      create temp table roster_write_provision_ops(operation_id uuid,subject_user_id uuid,primary key(operation_id,subject_user_id)) on commit drop;
      insert into roster_write_provision_ops select audit.operation_id,audit.subject_user_id from public.account_plan_audit audit
        join (values ${peopleValues}) identity(id,email) on identity.id=audit.subject_user_id
        where audit.actor_ref='system:user-provisioning' and audit.reason_code='default_free_account_provisioning'
          and exists(select 1 from public.users u where u.id=identity.id and (u.email=identity.email
            or (u.id=${q(learner)} and u.email in (${ids([email('learner_changed'), email('learner_next')])}))
            or (u.id=${q(removed)} and u.email=${q(email('email_race'))})
            or (u.id=${q(classmate)} and u.email=${q(email('learner'))})));
      delete from public.effective_feature_entitlement_audit a using (values ${grantValues}) fixture(operation,u)
        where a.operation_id=fixture.operation and a.subject_user_id=fixture.u and a.actor_ref='test:235' and a.reason_code=${q(tag)};
      delete from public.effective_feature_entitlement_audit a using roster_write_provision_ops operation
        where a.operation_id=operation.operation_id and a.subject_user_id=operation.subject_user_id
          and a.actor_ref='system:user-provisioning' and a.reason_code='default_free_account_provisioning';
      delete from public.account_plan_audit a using roster_write_provision_ops operation
        where a.operation_id=operation.operation_id and a.subject_user_id=operation.subject_user_id
          and a.actor_ref='system:user-provisioning' and a.reason_code='default_free_account_provisioning';
      delete from public.classrooms c using (values ${classes.map(([id, , label, suffix]) => `(${q(id)}::uuid,${q(`${tag} ${label}`)},${q(`${tag}_${suffix}`)})`).join(',')}) fixture(id,title,class_code)
        where c.id=fixture.id and c.title=fixture.title and c.class_code=fixture.class_code and c.teacher_id in (${ids([owner, teacher])});
      delete from public.users u using (values ${peopleValues}) identity(id,email) where u.id=identity.id and (u.email=identity.email
        or (u.id=${q(learner)} and u.email in (${ids([email('learner_changed'), email('learner_next')])}))
        or (u.id=${q(removed)} and u.email=${q(email('email_race'))})
        or (u.id=${q(classmate)} and u.email=${q(email('learner'))}));
      commit;`)
    const residualTables = tables.filter(table => !['entries', 'gradebook_item_scores', 'attendance_check_in_facts', 'attendance_record_projection', 'attendance_status_overrides'].includes(table))
    // Global baselines include the untouched attendance/grade data; exact residuals cover every fixture identity.
    assert.equal(sql(`select
      (select count(*) from public.users where id in (${ids(personIds)}))+
      (select count(*) from public.classrooms where id in (${ids(classIds)}))+
      ${residualTables.filter(table => !['users','classrooms'].includes(table)).map(table => {
        const key = ['account_plans','account_plan_audit','effective_feature_entitlements','effective_feature_entitlement_audit'].includes(table) ? 'subject_user_id' : 'classroom_id'
        return `(select count(*) from public.${table} where ${key} in (${ids(key === 'subject_user_id' ? personIds : classIds)}))`
      }).join('+')};`), '0')
    assert.deepEqual(baseline(), initialBaseline)
    process.stdout.write('PASS exact synthetic roster owner-write cleanup, zero residual rows and global baseline counts\n')
  }
}
main().catch((error: unknown) => {
  process.stderr.write(error instanceof Error && error.message === 'Forced post-fixture cleanup proof'
    ? 'FAIL Forced roster post-fixture cleanup proof (expected for --verify-cleanup-after-fixture)\n'
    : 'FAIL local roster owner-write SDK proof (captured command and status data withheld)\n')
  process.exitCode = 1
})
