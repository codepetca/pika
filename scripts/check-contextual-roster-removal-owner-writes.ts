// Root-run only after reviewed236 and real generated types exist. Local-only
// actual SDK, observed locking and exact synthetic cleanup; never applies SQL.
import assert from 'node:assert/strict'
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'
import { ApiError } from '../src/lib/api-error'
import { getServiceRoleClient } from '../src/lib/supabase'
import { removeContextualRosterStudents } from '../src/lib/server/contextual-roster-removal'
import { contextualRosterRemovalEnvelopeSchema } from '../src/lib/validations/contextual-roster-removal'

const container = 'supabase_db_pika'
const tag = `removalwrite_${randomUUID().slice(0, 8)}`
const owner = randomUUID(), teacher = randomUUID(), bound = randomUUID(), unbound = randomUUID(), mate = randomUUID(), removed = randomUUID()
const classroom = randomUUID(), otherClassroom = randomUUID()
const boundRoster = randomUUID(), unboundRoster = randomUUID(), mateRoster = randomUUID(), removedRoster = randomUUID()
const inviteRoster = randomUUID(), otherRoster = randomUUID(), duplicateRoster = randomUUID()
const item = randomUUID(), assignment = randomUUID(), document = randomUUID(), test = randomUUID(), attempt = randomUUID()
const boundEnrollment = randomUUID(), unboundEnrollment = randomUUID(), mateEnrollment = randomUUID(), otherEnrollment = randomUUID(), removedGeneration = randomUUID()
const generations = [[boundEnrollment, classroom, bound], [unboundEnrollment, classroom, unbound],
  [mateEnrollment, classroom, mate], [otherEnrollment, otherClassroom, bound], [removedGeneration, classroom, removed]] as const
const email = (label: string) => `${tag}_${label}@example.invalid`
const people = [[owner, 'owner', 'student'], [teacher, 'teacher', 'teacher'], [bound, 'bound', 'teacher'],
  [unbound, 'unbound', 'teacher'], [mate, 'mate', 'student'], [removed, 'removed', 'student']] as const
const classes = [[classroom, owner, 'primary', 'p'], [otherClassroom, teacher, 'other', 'o']] as const
const grants = [owner, teacher].map(subject => ({ subject, operation: randomUUID() }))
const q = (value: string) => `'${value.replaceAll("'", "''")}'`
const ids = (values: readonly string[]) => values.map(q).join(',')
const classIds = classes.map(([id]) => id), personIds = people.map(([id]) => id)
const peopleValues = people.map(([id, label]) => `(${q(id)}::uuid,${q(email(label))})`).join(',')
const grantValues = grants.map(({ subject, operation }) => `(${q(operation)}::uuid,${q(subject)}::uuid)`).join(',')
const sessions: Session[] = []
const forcedMessage = 'Forced preserving-removal post-fixture cleanup proof'
const forcedBeforeCaptureMessage = 'Forced preserving-removal post-commit pre-capture cleanup proof'
let capturedFixtureGenerations: Record<string, unknown> = {}

function command(binary: string, args: string[], input?: string): string {
  try {
    return execFileSync(binary, args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 65_000, maxBuffer: 8_000_000 }).trim()
  } catch {
    // Never echo command/status/error objects: they can contain credentials.
    throw new Error('Local preserving-removal command failed')
  }
}
function sql(statement: string) {
  return command('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-XqAt',
    '-v', 'ON_ERROR_STOP=1'], `set statement_timeout='60s'; set lock_timeout='4s'; ${statement}`)
}
// Read real installed rows, hashing within PostgreSQL. No table contents are logged.
// The exclude set describes only the operation's authorized membership changes.
function fingerprint(mutable = true): unknown {
  return JSON.parse(sql(`create function pg_temp.removal_fingerprint() returns jsonb language plpgsql as $f$
    declare t record; result jsonb:='{}'; value jsonb;
    begin
      for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where c.relkind in ('r','p') and n.nspname in ('public','private','storage')
        ${mutable ? '' : `and not(n.nspname='public' and c.relname in ('classrooms','classroom_roster',
          'classroom_roster_student_bindings','classroom_enrollments','attendance_participant_mappings','classroom_archive_revisions'))`}
        order by n.nspname,c.relname
      loop
        execute format('select jsonb_build_object(''count'',count(*),''digest'',md5(coalesce(string_agg(md5((to_jsonb(r)%s)::text),'''' order by md5((to_jsonb(r)%s)::text)),''''))) from %I.%I r',
          ${mutable ? "''" : "case when t.nspname='private' and t.relname='pal_membership_generations' then '-''state''' else '' end"},
          ${mutable ? "''" : "case when t.nspname='private' and t.relname='pal_membership_generations' then '-''state''' else '' end"},t.nspname,t.relname) into value;
        result:=result||jsonb_build_object(t.nspname||'.'||t.relname,value);
      end loop;
      return result;
    end;$f$;select pg_temp.removal_fingerprint();`))
}
function row(table: 'classroom_roster' | 'classroom_enrollments', id: string): Record<string, unknown> {
  return z.record(z.unknown()).parse(JSON.parse(sql(`select to_jsonb(r) from public.${table} r where id=${q(id)};`)))
}
function binding(roster: string): unknown {
  return JSON.parse(sql(`select coalesce((select to_jsonb(b) from public.classroom_roster_student_bindings b where roster_id=${q(roster)}),'null'::jsonb);`))
}
const statusIs = (status: number) => (error: unknown) => error instanceof ApiError && error.statusCode === status
function generationState(): Record<string, unknown> {
  return z.record(z.unknown()).parse(JSON.parse(sql(`select coalesce(jsonb_object_agg(generation_id::text,to_jsonb(g)),'{}') from private.pal_membership_generations g;`)))
}
const remove = (rosterIds: string[], actorId = owner, classroomId = classroom) =>
  removeContextualRosterStudents({ actorId, classroomId, rosterIds })
async function denied(rosterIds: string[], status: number, actorId = owner, classroomId = classroom, expectedMessage?: string) {
  const before = fingerprint()
  await assert.rejects(remove(rosterIds, actorId, classroomId), error => statusIs(status)(error)
    && (expectedMessage === undefined || (error instanceof ApiError && error.message === expectedMessage)))
  assert.deepEqual(fingerprint(), before)
}
const rawRemove = (rosterIds = [boundRoster]) => `set local role service_role;
  select public.remove_classroom_students_for_owner_v1(${q(owner)},${q(classroom)},array[${ids(rosterIds)}]::uuid[])::text; reset role;`

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
    this.child.stderr.on('data', () => { /* Keep captured SQL private. */ })
    this.child.stdin.on('error', () => this.fail())
    this.child.on('error', () => this.fail())
    this.done = new Promise(resolve => this.child.on('close', () => { this.closed = true; this.fail(); resolve() }))
    sessions.push(this)
  }
  private fail() {
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(new Error('Local removal session failed')); this.pending = null }
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
    try { await Promise.race([this.done, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Local removal session close failed')), 9000) })]) }
    finally { clearTimeout(force); clearTimeout(hard); clearTimeout(timeout) }
  }
}
async function holder(label: string, statement: string, proof: () => Promise<void>) {
  const session = new Session(label)
  try { await session.run(`begin; ${statement}`); await proof() } finally { await session.close() }
}
async function expectBlocked(observer: Session, waiter: Session, writer: Session) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const blocked = await observer.run(`select exists(select 1 from pg_stat_activity w,pg_stat_activity h
      where w.application_name=${q(waiter.name)} and h.application_name=${q(writer.name)}
        and w.wait_event_type='Lock' and h.pid=any(pg_blocking_pids(w.pid)));`)
    if (blocked === 't') return
    assert(!waiter.closed, 'Changer closed before observed block'); await delay(25)
  }
  throw new Error('Missing observed lock evidence')
}

async function main() {
  assert.equal(command('docker', ['inspect', container, '--format', '{{ index .Config.Labels "com.supabase.cli.project" }}']), 'pika')
  assert.match(command('docker', ['port', container, '5432/tcp']), /:54322\s*$/m)
  const rawStatus: unknown = JSON.parse(command('supabase', ['status', '-o', 'json']))
  const status = z.object({ API_URL: z.literal('http://127.0.0.1:54321'),
    DB_URL: z.string().refine(value => {
      try { const url = new URL(value); return ['postgres', 'postgresql'].includes(url.protocol.slice(0, -1))
        && ['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === '54322' && url.pathname === '/postgres' }
      catch { return false }
    }), ANON_KEY: z.string().min(1), SERVICE_ROLE_KEY: z.string().min(1) }).safeParse(rawStatus)
  if (!status.success) throw new Error('Local preserving-removal target guard failed')
  process.env.NEXT_PUBLIC_SUPABASE_URL = status.data.API_URL
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = status.data.ANON_KEY
  process.env.SUPABASE_SECRET_KEY = status.data.SERVICE_ROLE_KEY
  const client = getServiceRoleClient()
  assert.equal(sql("select exists(select 1 from supabase_migrations.schema_migrations where version='236');"), 't')
  assert.equal(sql(`select not coalesce((select automatic_enabled or enabled or live_enabled from private.student_provider_cleanup_settings where singleton),false);`), 't')
  assert.equal(sql(`select tgenabled from pg_trigger where tgrelid='private.pal_membership_generations'::regclass
    and tgname='guard_pal_membership_evidence' and not tgisinternal;`), 'O')
  const initialBaseline = fingerprint()
  assert.equal(sql(`select count(*) from private.pal_membership_generations where generation_id in
    (${ids(generations.map(([id]) => id))});`), '0', 'Preallocated fixture generations must be absent before setup')
  const initialGenerationBaseline = z.object({ count: z.number().int(), digest: z.string().regex(/^[a-f0-9]{32}$/) })
    .parse(z.record(z.unknown()).parse(initialBaseline)['private.pal_membership_generations'])
  try {
    sql(`begin;
      insert into public.users(id,email,role) values ${people.map(([id, label, role]) => `(${q(id)},${q(email(label))},${q(role)})`).join(',')};
      set local role service_role;
      select public.set_effective_feature_entitlement_v1(operation,u,'classrooms.create','manual',true,clock_timestamp(),null,3,
        'test:236',${q(tag)},coalesce((select revision from public.effective_feature_entitlements where subject_user_id=u and feature_key='classrooms.create'),0))
        from (values ${grantValues}) fixture(operation,u);
      reset role;
      insert into public.classrooms(id,teacher_id,title,class_code) values ${classes.map(([id, actor, label, suffix]) => `(${q(id)},${q(actor)},${q(`${tag} ${label}`)},${q(`${tag}_${suffix}`)})`).join(',')};
      insert into public.classroom_enrollments(id,classroom_id,student_id,manual_attendance_marks,created_at) values
        (${q(boundEnrollment)},${q(classroom)},${q(bound)},'{"2026-09-30":"late"}','2026-09-01T13:14:15.123456Z'),
        (${q(unboundEnrollment)},${q(classroom)},${q(unbound)},'{"2026-09-30":"present"}','2026-09-02T13:14:15.123456Z'),
        (${q(mateEnrollment)},${q(classroom)},${q(mate)},'{}',clock_timestamp()),(${q(otherEnrollment)},${q(otherClassroom)},${q(bound)},'{}',clock_timestamp());
      insert into public.classroom_roster(id,classroom_id,email,first_name,last_name,student_number,join_source) values
        ${[[boundRoster, classroom, 'bound'], [unboundRoster, classroom, 'unbound'], [mateRoster, classroom, 'mate'],
          [inviteRoster, classroom, 'invite'], [otherRoster, otherClassroom, 'bound']].map(([id, klass, label]) =>
          `(${q(id)},${q(klass)},${q(email(label))},'Historical','Learner','42','manual')`).join(',')};
      insert into public.classroom_roster(id,classroom_id,email,first_name,last_name,removed_at,removed_student_id,removed_enrollment_id,
        removed_enrolled_at,retained_manual_attendance_marks) values(${q(removedRoster)},${q(classroom)},${q(email('removed_historical'))},
        'Removed','Historical',clock_timestamp(),${q(removed)},${q(removedGeneration)},'2026-01-01T00:00:00Z','{}');
      delete from public.classroom_roster_student_bindings where roster_id=${q(unboundRoster)} and student_id=${q(unbound)};
      insert into public.classroom_roster_student_bindings(roster_id,classroom_id,student_id) values
        (${q(boundRoster)},${q(classroom)},${q(bound)}),(${q(otherRoster)},${q(otherClassroom)},${q(bound)}) on conflict(roster_id) do nothing;
      insert into public.attendance_participant_mappings(classroom_id,student_id) values
        (${q(classroom)},${q(bound)}),(${q(classroom)},${q(unbound)}),(${q(classroom)},${q(mate)}),(${q(otherClassroom)},${q(bound)});
      insert into public.entries(classroom_id,student_id,date,text,on_time) values(${q(classroom)},${q(bound)},'2026-09-30','Synthetic retained daily work',true);
      insert into public.gradebook_items(id,classroom_id,title,points_possible,created_by) values(${q(item)},${q(classroom)},'Retained grade',10,${q(owner)});
      insert into public.gradebook_item_scores(item_id,classroom_id,student_id,earned) values(${q(item)},${q(classroom)},${q(bound)},7.5);
      insert into public.assignments(id,classroom_id,title,due_at,created_by) values(${q(assignment)},${q(classroom)},'Retained assignment','2026-10-10T00:00:00Z',${q(owner)});
      insert into public.assignment_docs(id,assignment_id,student_id,content) values(${q(document)},${q(assignment)},${q(bound)},'{"type":"doc","content":[]}'::jsonb);
      insert into public.assignment_doc_history(assignment_doc_id,snapshot,word_count,char_count,trigger) values(${q(document)},'{"type":"doc","content":[]}',0,0,'baseline');
      insert into public.tests(id,classroom_id,title,created_by) values(${q(test)},${q(classroom)},'Retained test',${q(owner)});
      insert into public.test_attempts(id,test_id,student_id) values(${q(attempt)},${q(test)},${q(bound)});
      insert into public.test_attempt_history(test_attempt_id,snapshot,trigger) values(${q(attempt)},'{}','baseline');
      commit;`)
    if (process.argv.includes('--verify-cleanup-after-commit-before-capture')) throw new Error(forcedBeforeCaptureMessage)
    capturedFixtureGenerations = z.record(z.unknown()).parse(JSON.parse(sql(`select coalesce(jsonb_object_agg(generation_id::text,to_jsonb(g)),'{}')
      from private.pal_membership_generations g where generation_id in (${ids(generations.map(([id]) => id))});`)))
    assert.equal(Object.keys(capturedFixtureGenerations).length, generations.length)
    if (process.argv.includes('--verify-cleanup-after-fixture')) throw new Error(forcedMessage)
    for (const actor of [teacher, bound, unbound, mate]) await denied([boundRoster], 403, actor)
    await denied([boundRoster], 403, owner, randomUUID())
    await denied([otherRoster], 409)
    await denied([randomUUID()], 409)
    await denied([inviteRoster], 409) // plausible unbound membership
    sql(`update public.classrooms set archived_at=clock_timestamp() where id=${q(classroom)};`)
    await denied([boundRoster], 403)
    sql(`update public.classrooms set archived_at=null where id=${q(classroom)};`)
    const rawDenied = await client.rpc('remove_classroom_students_for_owner_v1', { p_actor_id: bound,
      p_classroom_id: classroom, p_roster_ids: [boundRoster] })
    assert.equal(rawDenied.error?.code, '42501'); assert.equal(rawDenied.status, 403)
    const rawInvalid = await client.rpc('remove_classroom_students_for_owner_v1', { p_actor_id: owner,
      p_classroom_id: classroom, p_roster_ids: [] })
    assert.equal(rawInvalid.error?.code, '22023'); assert.equal(rawInvalid.status, 400)

    // Both duplicate policies retain164 unique tombstones/173 exactly-one cleanup.
    sql(`insert into public.classroom_roster(id,classroom_id,email,first_name,last_name) values
      (${q(duplicateRoster)},${q(classroom)},${q(email('duplicate'))},'Duplicate','Bound');
      insert into public.classroom_roster_student_bindings(roster_id,classroom_id,student_id) values(${q(duplicateRoster)},${q(classroom)},${q(bound)});`)
    const duplicateMessage = 'This student has multiple roster rows. Resolve the duplicate roster entries before removing them.'
    await denied([boundRoster], 409, owner, classroom, duplicateMessage)
    await denied([boundRoster, duplicateRoster], 409, owner, classroom, duplicateMessage)
    sql(`delete from public.classroom_roster where id=${q(duplicateRoster)} and classroom_id=${q(classroom)} and email=${q(email('duplicate'))};`)
    // Normalized user-email ambiguity is real despite the case-sensitive UNIQUE.
    sql(`update public.users set email=${q(email('unbound').toUpperCase())} where id=${q(mate)};`)
    await denied([unboundRoster], 409)
    sql(`update public.users set email=${q(email('mate'))} where id=${q(mate)};`)

    // Every conflict must fail while the holder still owns the exact lock.
    for (const [label, lock] of [
      ['class', `select id from public.classrooms where id=${q(classroom)} for update;`],
      ['legacy_row', `select id from public.classroom_roster where id=${q(boundRoster)} for update;`],
      ['binding', `select roster_id from public.classroom_roster_student_bindings where roster_id=${q(boundRoster)} for update;`],
      ['enrollment', `select id from public.classroom_enrollments where classroom_id=${q(classroom)} and student_id=${q(bound)} for update;`],
      ['mapping', `select student_id from public.attendance_participant_mappings where classroom_id=${q(classroom)} and student_id=${q(bound)} for update;`],
      ['revision', `select classroom_id from public.classroom_archive_revisions where classroom_id=${q(classroom)} for update;`],
      ['generation', `select generation_id from private.pal_membership_generations where generation_id=${q(boundEnrollment)} for update;`],
      ['purge_subject', `select pg_advisory_xact_lock(hashtextextended('pika-student-purge-subject:'||${q(bound)},0));`],
      ['purge_pair', `select pg_advisory_xact_lock(hashtextextended('pika-student-purge:'||${q(classroom)}||':'||${q(bound)},0));`],
      ['matching_user', `update public.users set email=${q(email('unbound_changed'))} where id=${q(unbound)};`],
      ['nonmatching_user', `update public.users set email=${q(email('invite'))} where id=${q(mate)};`],
      ['retained_user', `update public.users set email=${q(email('retained_changed'))} where id=${q(removed)};`],
    ]) await holder(label, lock, () => denied([boundRoster, unboundRoster], 409))
    process.stdout.write('PASS SDK conflict rollback while exact class/roster/binding/enrollment/mapping/revision/purge/users locks are held\n')

    // Operation-first locks: raw RPC transaction completes but remains open.
    // Changers demonstrably wait on its PID; rollback releases the writer and
    // rollback of changers leaves all fixture rows ready for actual SDK success.
    for (const [label, change] of [
      ['class', `update public.classrooms set teacher_id=${q(teacher)} where id=${q(classroom)};`],
      ['archive', `update public.classrooms set archived_at=clock_timestamp() where id=${q(classroom)};`],
      ['roster', `select id from public.classroom_roster where id=${q(boundRoster)} for update;`],
      ['binding', `select roster_id from public.classroom_roster_student_bindings where roster_id=${q(boundRoster)} for update;`],
      ['enrollment', `select id from public.classroom_enrollments where classroom_id=${q(classroom)} and student_id=${q(mate)} for update;`],
      ['mapping', `select student_id from public.attendance_participant_mappings where classroom_id=${q(classroom)} and student_id=${q(mate)} for update;`],
      ['revision', `select classroom_id from public.classroom_archive_revisions where classroom_id=${q(classroom)} for update;`],
      ['generation', `select generation_id from private.pal_membership_generations where generation_id=${q(boundEnrollment)} for update;`],
      ['users', `update public.users set email=${q(email('invite'))} where id=${q(mate)};`],
    ]) {
      const writer = new Session(`${label}_writer`), changer = new Session(`${label}_changer`), observer = new Session(`${label}_observer`)
      try {
        const raw = await writer.run(`begin; ${rawRemove()}`)
        const parsed = contextualRosterRemovalEnvelopeSchema.parse({ data: JSON.parse(raw), error: null })
        assert.equal(parsed.error, null)
        const pending = changer.run(`begin; ${change}`)
        await expectBlocked(observer, changer, writer)
        await writer.run('rollback;'); await pending; await changer.run('rollback;')
      } finally { await Promise.all([writer.close(), changer.close(), observer.close()]) }
    }
    process.stdout.write('PASS observed operation-first locks against owner/archive/roster/binding/enrollment/mapping/revision/nonmatching-user changes\n')

    const untouched = fingerprint(false), stableBinding = binding(boundRoster), expectedGenerations = generationState()
    const historical = row('classroom_roster', boundRoster)
    const enrollmentId = sql(`select id from public.classroom_enrollments where classroom_id=${q(classroom)} and student_id=${q(bound)};`)
    const enrollment = row('classroom_enrollments', enrollmentId)
    // Stable binding beats the current normalized email now owned by a classmate.
    sql(`update public.users set email=${q(email('bound_changed'))} where id=${q(bound)};
      update public.users set email=${q(email('bound'))} where id=${q(mate)};`)
    const priorWork = fingerprint(false)
    assert.deepEqual(await remove([boundRoster, boundRoster.toUpperCase()]), { success: true, requested_count: 1, removed_count: 1 })
    const retained = row('classroom_roster', boundRoster)
    assert.equal(retained.removed_student_id, bound); assert.equal(retained.removed_enrollment_id, enrollment.id)
    assert.equal(retained.removed_enrolled_at, enrollment.created_at)
    assert.deepEqual(retained.retained_manual_attendance_marks, enrollment.manual_attendance_marks)
    assert.equal(retained.retained_attendance_participant_active, true)
    assert.equal(typeof retained.removed_at, 'string')
    const allowed = new Set(['removed_at', 'removed_student_id', 'removed_enrollment_id', 'removed_enrolled_at',
      'retained_manual_attendance_marks', 'retained_attendance_participant_active', 'updated_at'])
    for (const [key, value] of Object.entries(historical)) if (!allowed.has(key)) assert.deepEqual(retained[key], value)
    assert.deepEqual(binding(boundRoster), stableBinding)
    assert.equal(sql(`select count(*) from public.classroom_enrollments where id=${q(enrollmentId)};`), '0')
    assert.equal(sql(`select active from public.attendance_participant_mappings where classroom_id=${q(classroom)} and student_id=${q(bound)};`), 'f')
    assert.deepEqual(fingerprint(false), priorWork)
    expectedGenerations[boundEnrollment] = { ...z.record(z.unknown()).parse(expectedGenerations[boundEnrollment]), state: 'removed' }
    assert.deepEqual(generationState(), expectedGenerations)
    sql(`update public.users set email=${q(email('mate'))} where id=${q(mate)};
      update public.users set email=${q(email('bound'))} where id=${q(bound)};`)
    assert.deepEqual(fingerprint(false), untouched)
    const retry = fingerprint()
    assert.deepEqual(await remove([boundRoster, removedRoster]), { success: true, requested_count: 2, removed_count: 0 })
    assert.deepEqual(fingerprint(), retry)
    assert.deepEqual(await remove([unboundRoster]), { success: true, requested_count: 1, removed_count: 1 })
    expectedGenerations[unboundEnrollment] = { ...z.record(z.unknown()).parse(expectedGenerations[unboundEnrollment]), state: 'removed' }
    assert.deepEqual(generationState(), expectedGenerations)
    assert.equal(z.object({ student_id: z.string() }).parse(binding(unboundRoster)).student_id, unbound)
    assert.deepEqual(await remove([inviteRoster]), { success: true, requested_count: 1, removed_count: 1 })
    assert.equal(sql(`select count(*) from public.classroom_roster where id=${q(inviteRoster)};`), '0')
    assert.equal(sql(`select count(*) from public.classroom_enrollments where classroom_id=${q(classroom)} and student_id=${q(mate)};`), '1')
    assert.equal(sql(`select count(*) from public.classroom_enrollments where classroom_id=${q(otherClassroom)} and student_id=${q(bound)};`), '1')
    assert.deepEqual(await remove([otherRoster], teacher, otherClassroom), { success: true, requested_count: 1, removed_count: 1 })
    expectedGenerations[otherEnrollment] = { ...z.record(z.unknown()).parse(expectedGenerations[otherEnrollment]), state: 'removed' }
    assert.deepEqual(generationState(), expectedGenerations)
    assert.deepEqual(fingerprint(false), untouched)
    process.stdout.write('PASS actual SDK both owner roles, bound/unbound teacher learners, retained identity/history, dedup/retry/invitation and class isolation\n')
  } finally {
    const closed = await Promise.allSettled(sessions.map(session => session.close()))
    if (closed.some(result => result.status === 'rejected')) throw new Error('Refusing cleanup while a proof session may remain open')
    assert.equal(sql(`select count(*) from pg_stat_activity where application_name like ${q(`${tag}%`)};`), '0')
    const capturedGenerationValues = generations.map(([id, klass, person]) => {
      const original = capturedFixtureGenerations[id]
      // A failed/ambiguous capture must not block independently verified cleanup.
      // Only a validated original reference becomes a further comparison fence.
      const parsed = z.object({ generation_id: z.literal(id),
        pal_reference: z.string().regex(/^pika-membership-v1-[a-f0-9]{32}$/) }).safeParse(original)
      const reference = parsed.success ? q(parsed.data.pal_reference) : 'null::text'
      return `(${q(id)}::uuid,${q(klass)}::uuid,${q(person)}::uuid,${reference})`
    }).join(',')
    // Validate every remaining synthetic user/class before ANY destructive cleanup.
    // Audit rows are non-cascading; capture exact provisioning operation IDs.
    sql(`begin;
      -- Snapshot uncaptured references BEFORE other deletes, under the same
      -- exclusive NOWAIT lock used for the narrowly scoped168 guard bypass.
      -- All candidate UUIDs were proven absent before fixture setup.
      lock table private.pal_membership_generations in access exclusive mode nowait;
      create temp table removal_generation_snapshot on commit drop as
        select g.* from private.pal_membership_generations g
        join (values ${capturedGenerationValues}) f(id,c,u,ref) on g.generation_id=f.id;
      do $generation_guard$ begin
        if (select tgenabled from pg_trigger where tgrelid='private.pal_membership_generations'::regclass
          and tgname='guard_pal_membership_evidence' and not tgisinternal) is distinct from 'O' then
          raise exception 'Generation guard original state changed'; end if;
        if exists(select 1 from removal_generation_snapshot g join (values ${capturedGenerationValues}) f(id,c,u,ref)
          on g.generation_id=f.id where g.scope_digest is distinct from private.pal_membership_scope(f.c,f.u)
            or g.pal_reference !~ '^pika-membership-v1-[a-f0-9]{32}$'
            or (f.ref is not null and g.pal_reference is distinct from f.ref)
            or g.state not in ('active','removed')) then raise exception 'Synthetic generation binding changed'; end if;
        if (select jsonb_build_object('count',count(*),'digest',md5(coalesce(string_agg(md5(to_jsonb(g)::text),'' order by md5(to_jsonb(g)::text)),'')))
          from private.pal_membership_generations g where generation_id not in (${ids(generations.map(([id]) => id))}))
          is distinct from ${q(JSON.stringify(initialGenerationBaseline))}::jsonb then
          raise exception 'Untouched generation baseline changed before cleanup'; end if;
      end;$generation_guard$;
      do $guard$ begin
        if exists(select 1 from public.users u where id in (${ids(personIds)}) and not (email in (${ids(people.map(([, label]) => email(label)))})
          or (id=${q(bound)} and email=${q(email('bound_changed'))}) or (id=${q(mate)} and email in (${ids([email('bound'), email('unbound').toUpperCase()])}))))
          or exists(select 1 from public.classrooms c where id in (${ids(classIds)}) and not
            ((id=${q(classroom)} and title=${q(`${tag} primary`)} and class_code=${q(`${tag}_p`)})
             or (id=${q(otherClassroom)} and title=${q(`${tag} other`)} and class_code=${q(`${tag}_o`)}))) then
          raise exception 'Exact fixture identity guard failed'; end if;
      end;$guard$;
      create temp table removal_provision_ops(operation_id uuid,subject_user_id uuid,primary key(operation_id,subject_user_id)) on commit drop;
      insert into removal_provision_ops select a.operation_id,a.subject_user_id from public.account_plan_audit a
        where a.subject_user_id in (${ids(personIds)}) and a.actor_ref='system:user-provisioning' and a.reason_code='default_free_account_provisioning';
      delete from public.effective_feature_entitlement_audit a using (values ${grantValues}) f(operation,u)
        where a.operation_id=f.operation and a.subject_user_id=f.u and a.actor_ref='test:236' and a.reason_code=${q(tag)};
      delete from public.effective_feature_entitlement_audit a using removal_provision_ops p where a.operation_id=p.operation_id
        and a.subject_user_id=p.subject_user_id and a.actor_ref='system:user-provisioning' and a.reason_code='default_free_account_provisioning';
      delete from public.account_plan_audit a using removal_provision_ops p where a.operation_id=p.operation_id
        and a.subject_user_id=p.subject_user_id and a.actor_ref='system:user-provisioning' and a.reason_code='default_free_account_provisioning';
      -- Pal outbox has no user FK. Only synthetic IDs and exact local source
      -- bindings are eligible; refuse unexpected output instead of broad deletion.
      do $outbox_guard$ begin
        if exists(select 1 from public.pal_event_outbox where student_id in (${ids(personIds)}))
          or exists(select 1 from private.removed_student_cleanup_jobs where classroom_id in (${ids(classIds)})) then
          raise exception 'Unexpected provider outbox/cleanup job; refuse automatic deletion'; end if;
      end;$outbox_guard$;
      delete from public.classrooms c using (values ${classes.map(([id, , label, suffix]) =>
        `(${q(id)}::uuid,${q(`${tag} ${label}`)},${q(`${tag}_${suffix}`)})`).join(',')}) f(id,title,class_code)
        where c.id=f.id and c.title=f.title and c.class_code=f.class_code and c.teacher_id in (${ids([owner, teacher])});
      delete from public.users u using (values ${peopleValues}) p(id,email) where u.id=p.id and
        (u.email=p.email or (u.id=${q(bound)} and u.email=${q(email('bound_changed'))})
          or (u.id=${q(mate)} and u.email in (${ids([email('bound'), email('unbound').toUpperCase()])})));
      -- Classroom cascades legitimately invoke168 and retire still-active
      -- enrollments. Admit that one state transition into the locked snapshot;
      -- every generation identity/scope/reference field remains exact.
      do $generation_transition$ begin
        if exists(select 1 from removal_generation_snapshot s left join private.pal_membership_generations g
          on g.generation_id=s.generation_id where g.generation_id is null
            or (to_jsonb(g)-'state') is distinct from (to_jsonb(s)-'state')
            or not (g.state=s.state or (s.state='active' and g.state='removed'))) then
          raise exception 'Synthetic generation changed during classroom cleanup'; end if;
      end;$generation_transition$;
      update removal_generation_snapshot s set state=g.state from private.pal_membership_generations g where g.generation_id=s.generation_id;
      --168 evidence has no cascade and normally forbids deletion. Bypass ONLY
      -- its DELETE guard, matching every field of the verified locked snapshot.
      alter table private.pal_membership_generations disable trigger guard_pal_membership_evidence;
      delete from private.pal_membership_generations g using removal_generation_snapshot s
        where g.generation_id=s.generation_id and to_jsonb(g)=to_jsonb(s);
      alter table private.pal_membership_generations enable trigger guard_pal_membership_evidence;
      do $generation_enabled$ begin
        if (select tgenabled from pg_trigger where tgrelid='private.pal_membership_generations'::regclass
          and tgname='guard_pal_membership_evidence' and not tgisinternal) is distinct from 'O' then
          raise exception 'Generation guard was not restored'; end if;
        if exists(select 1 from private.pal_membership_generations where generation_id in (${ids(generations.map(([id]) => id))})) then
          raise exception 'Fixture generation residue; rollback entire cleanup'; end if;
        if (select jsonb_build_object('count',count(*),'digest',md5(coalesce(string_agg(md5(to_jsonb(g)::text),'' order by md5(to_jsonb(g)::text)),'')))
          from private.pal_membership_generations g) is distinct from ${q(JSON.stringify(initialGenerationBaseline))}::jsonb then
          raise exception 'Untouched generation baseline changed during cleanup'; end if;
      end;$generation_enabled$;
      commit;`)
    assert.equal(sql(`select tgenabled from pg_trigger where tgrelid='private.pal_membership_generations'::regclass
      and tgname='guard_pal_membership_evidence' and not tgisinternal;`), 'O')
    assert.equal(sql(`select (select count(*) from public.users where id in (${ids(personIds)}))+
      (select count(*) from public.classrooms where id in (${ids(classIds)}))+
      (select count(*) from public.classroom_roster where classroom_id in (${ids(classIds)}))+
      (select count(*) from public.classroom_roster_student_bindings where classroom_id in (${ids(classIds)}))+
      (select count(*) from public.classroom_enrollments where classroom_id in (${ids(classIds)}))+
      (select count(*) from public.attendance_participant_mappings where classroom_id in (${ids(classIds)}))+
      (select count(*) from public.classroom_archive_revisions where classroom_id in (${ids(classIds)}))+
      (select count(*) from public.student_purge_fences where classroom_id in (${ids(classIds)}))+
      (select count(*) from public.student_purge_operations where classroom_id in (${ids(classIds)}))+
      (select count(*) from public.pal_event_outbox where student_id in (${ids(personIds)}))+
      (select count(*) from private.removed_student_cleanup_jobs where classroom_id in (${ids(classIds)}))+
      (select count(*) from private.pal_membership_generations where generation_id in (${ids(generations.map(([id]) => id))}))+
      (select count(*) from public.account_plan_audit where subject_user_id in (${ids(personIds)}))+
      (select count(*) from public.effective_feature_entitlement_audit where subject_user_id in (${ids(personIds)}));`), '0')
    assert.deepEqual(fingerprint(), initialBaseline)
    process.stdout.write('PASS exact synthetic roster removal cleanup, zero residual rows and global baseline counts\n')
  }
}
main().catch((error: unknown) => {
  process.stderr.write(error instanceof Error && error.message === forcedMessage
    ? 'FAIL Forced roster removal post-fixture cleanup proof (expected for --verify-cleanup-after-fixture)\n'
    : error instanceof Error && error.message === forcedBeforeCaptureMessage
      ? 'FAIL Forced roster removal post-commit pre-capture cleanup proof (expected for --verify-cleanup-after-commit-before-capture)\n'
    : 'FAIL local preserving-removal SDK proof (captured command/status data withheld)\n')
  process.exitCode = 1
})
