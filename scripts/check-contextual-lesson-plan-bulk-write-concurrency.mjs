#!/usr/bin/env node
// Synthetic local-only contract. Run only after separately authorized 227 application.
// Never applies a migration, resets a database, or touches a real account.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

const container = 'supabase_db_pika'
assert.equal(execFileSync('docker', ['inspect', container, '--format', '{{ index .Config.Labels "com.supabase.cli.project" }}'], { encoding: 'utf8' }).trim(), 'pika')
assert.match(execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' }), /:54322\s*$/m)

const tag = `lesson_bulk_${randomUUID().slice(0, 8)}`
const ownerStudent = randomUUID()
const ownerTeacher = randomUUID()
const outsider = randomUUID()
const classroom = randomUUID()
const teacherClassroom = randomUUID()
const client = randomUUID()
const otherClient = randomUUID()
const blueprint = randomUUID()
const blueprintVersion = randomUUID()
const sourceArtifact = randomUUID()
const purgeOperation = randomUUID()
const entitlementOperations = [
  { subject: ownerStudent, operation: randomUUID() },
  { subject: ownerTeacher, operation: randomUUID() },
]
const entitlementValues = entitlementOperations.map(({ subject, operation }) =>
  `('${operation}'::uuid,'${subject}'::uuid)`).join(',')
const first = '2026-09-19'
const second = '2026-09-20'
const linked = '2026-09-21'
const doc = { type: 'doc', content: [] }
const sessions = []
const verifyCleanupAfterFixture = process.argv.includes('--verify-cleanup-after-fixture')

function quote(value) { return `'${String(value).replaceAll("'", "''")}'` }
function sql(statement) {
  return execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], {
    input: `set statement_timeout='90s'; set lock_timeout='4s'; ${statement}`,
    encoding: 'utf8',
  }).trim()
}
function save(actor, target, plans, clears = [], sequence = null, nonce = client) {
  const version = sequence === null ? 'null, null' : `${quote(nonce)}, ${sequence}`
  const normalized = plans.map(({ date, markdown }) => ({ date, content_markdown: markdown, content: doc }))
  const dates = clears.length ? `array[${clears.map(quote).join(',')}]::date[]` : 'array[]::date[]'
  return `select public.save_lesson_plans_for_owner_v1(
    ${quote(actor)}, ${quote(target)}, ${quote(JSON.stringify(normalized))}::jsonb,
    ${dates}, ${version})::text;`
}
function serviceSave(actor, target, plans, clears = [], sequence = null, nonce = client) {
  return `set local role service_role; ${save(actor, target, plans, clears, sequence, nonce)}`
}
function result(statement) { return JSON.parse(sql(`begin; ${statement} commit;`).split('\n')[0]) }
function state(target) {
  return JSON.parse(sql(`select jsonb_build_object(
    'plans', (select coalesce(jsonb_agg(to_jsonb(plan) order by plan.date),'[]'::jsonb)
      from public.lesson_plans plan where plan.classroom_id=${quote(target)}),
    'heads', (select coalesce(jsonb_agg(to_jsonb(head) order by head.date,head.client_id),'[]'::jsonb)
      from public.lesson_plan_mutation_heads head where head.classroom_id=${quote(target)}),
    'archive_revision', (select revision from public.classroom_archive_revisions
      where classroom_id=${quote(target)}),
    'blueprint_revision', (select blueprint_source_revision from public.classrooms
      where id=${quote(target)})
  )::text;`))
}
class Session {
  constructor(name) {
    this.name = `${tag}_${name}`
    this.output = ''
    this.errors = ''
    this.pending = null
    this.closed = false
    this.child = spawn('docker', ['exec', '-i', '-e', `PGAPPNAME=${this.name}`, container,
      'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'])
    this.child.stdout.on('data', (chunk) => {
      this.output += chunk.toString()
      if (this.pending && this.output.includes(this.pending.marker)) {
        const pending = this.pending
        this.pending = null
        clearTimeout(pending.timer)
        pending.resolve(this.output.slice(0, this.output.indexOf(pending.marker)).trim())
      }
    })
    this.child.stderr.on('data', (chunk) => { this.errors += chunk.toString() })
    this.child.stdin.on('error', (error) => this.fail(error))
    this.child.on('error', (error) => this.fail(error))
    this.done = new Promise((resolve) => this.child.on('close', (code) => {
      this.closed = true
      this.fail(new Error(`${this.name} exited ${code}: ${this.errors}`))
      resolve()
    }))
    sessions.push(this)
  }
  fail(error) {
    if (!this.pending) return
    clearTimeout(this.pending.timer)
    this.pending.reject(error)
    this.pending = null
  }
  run(statement) {
    assert(!this.pending && !this.closed)
    this.output = ''
    this.errors = ''
    const marker = `done_${randomUUID()}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error(`Session timeout: ${this.name}`)), 25_000)
      this.pending = { marker, timer, resolve, reject }
      this.child.stdin.write(`set statement_timeout='20s'; set lock_timeout='8s'; ${statement}\n\\echo ${marker}\n`)
    })
  }
  async close() {
    if (!this.closed) this.child.stdin.end('ROLLBACK;\n\\q\n')
    const force = setTimeout(() => this.child.kill('SIGTERM'), 5000)
    const forceHard = setTimeout(() => this.child.kill('SIGKILL'), 8000)
    let bound
    try {
      await Promise.race([
        this.done,
        new Promise((_, reject) => {
          bound = setTimeout(() => reject(new Error(`Session close timeout: ${this.name}`)), 10_000)
        }),
      ])
    } finally {
      clearTimeout(force)
      clearTimeout(forceHard)
      clearTimeout(bound)
    }
  }
}

const observer = new Session('observer')
async function blocked(waiter, holder) {
  for (let count = 0; count < 100; count += 1) {
    const seen = await observer.run(`select exists (
      select 1 from pg_stat_activity w, pg_stat_activity h
      where w.application_name='${waiter.name}' and h.application_name='${holder.name}'
        and w.wait_event_type='Lock' and h.pid=any(pg_blocking_pids(w.pid))
    );`)
    if (seen === 't') return
    assert(waiter.pending, 'Contender completed before expected lock wait')
    await delay(30)
  }
  throw new Error('Expected pg_blocking_pids evidence was not observed')
}

try {
  assert.equal(sql("select exists(select 1 from supabase_migrations.schema_migrations where version='227');"),
    't', 'Migration 227 must be separately authorized and applied before this runner')
  for (const role of ['anon', 'authenticated']) {
    assert.equal(sql(`select has_function_privilege('${role}',
      'public.save_lesson_plans_for_owner_v1(uuid,uuid,jsonb,date[],uuid,bigint)', 'EXECUTE');`), 'f')
  }
  sql(`begin;
    insert into public.users(id,email,role) values
      ('${ownerStudent}','${tag}_student@example.invalid','student'),
      ('${ownerTeacher}','${tag}_teacher@example.invalid','teacher'),
      ('${outsider}','${tag}_outsider@example.invalid','teacher');
    set local role service_role;
    select public.set_effective_feature_entitlement_v1(operation_id, u,
      'classrooms.create','manual',true,clock_timestamp(),null,2,'test:227','${tag}',
      coalesce((select revision from public.effective_feature_entitlements
        where subject_user_id=u and feature_key='classrooms.create'),0))
    from (values ${entitlementValues}) fixture(operation_id,u);
    reset role;
    insert into public.classrooms(id,teacher_id,title,class_code) values
      ('${classroom}','${ownerStudent}','${tag} student','${tag}_s'),
      ('${teacherClassroom}','${ownerTeacher}','${tag} teacher','${tag}_t');
    commit;`)
  if (verifyCleanupAfterFixture) throw new Error('Forced post-fixture cleanup proof')

  for (const [actor, target] of [[ownerStudent, classroom], [ownerTeacher, teacherClassroom]]) {
    const response = result(serviceSave(actor, target,
      [{ date: first, markdown: 'First' }, { date: second, markdown: 'Second' }], [], 1))
    assert.deepEqual(response.results.map((entry) => [entry.date, entry.operation, entry.applied]),
      [[first, 'upsert', true], [second, 'upsert', true]])
    assert.deepEqual(Object.keys(response.results[0].lesson_plan).sort(), [
      'id', 'classroom_id', 'date', 'content', 'content_markdown', 'artifact_id',
      'source_artifact_id', 'source_blueprint_version_id', 'blueprint_archived_at',
      'created_at', 'updated_at',
    ].sort())
    const before = state(target)
    const equal = result(serviceSave(actor, target,
      [{ date: first, markdown: 'Ignored' }, { date: second, markdown: 'Ignored' }], [], 1))
    assert.deepEqual(equal.results.map((entry) => entry.applied), [false, false])
    assert.deepEqual(state(target), before, 'Equal nonce changed row, head, or revision')
    const independent = result(serviceSave(actor, target, [{ date: first, markdown: 'Other client' }],
      [], 1, otherClient))
    assert.equal(independent.results[0].applied, true)
    assert.equal(result(serviceSave(actor, target, [], [first], 2)).results[0].applied, true)
    const afterDelete = state(target)
    const stale = result(serviceSave(actor, target, [{ date: first, markdown: 'Stale' }], [], 1))
    assert.equal(stale.results[0].applied, false)
    assert.equal(stale.results[0].lesson_plan, null)
    assert.deepEqual(state(target), afterDelete)
    const heads = state(target).heads
    assert.equal(result(serviceSave(actor, target, [{ date: first, markdown: '' }])).results[0].applied, true)
    assert.equal(state(target).plans.find((entry) => entry.date === first)?.content_markdown, '',
      'Blank upsert must remain a row')
    assert.equal(result(serviceSave(actor, target, [], [first])).results[0].applied, true)
    assert.deepEqual(state(target).heads, heads, 'Unversioned bulk changed mutation heads')
  }
  const beforeDenials = state(classroom)
  assert.throws(() => sql(`begin; ${serviceSave(outsider, classroom,
    [{ date: first, markdown: 'Denied' }])} commit;`), /42501/)
  assert.throws(() => sql(`begin; ${serviceSave(ownerStudent, randomUUID(),
    [{ date: first, markdown: 'Denied missing' }])} commit;`), /P0002/)
  assert.deepEqual(state(classroom), beforeDenials, 'Denied writes changed fixture state')
  for (const role of ['anon', 'authenticated']) {
    assert.throws(() => sql(`begin; set local role ${role};
      ${save(ownerStudent, classroom, [{ date: first, markdown: 'Denied' }])} commit;`), /42501/)
  }
  assert.throws(() => sql(`begin; set local role service_role;
    select public.save_lesson_plans_for_owner_v1('${ownerStudent}','${classroom}',
      '[]'::jsonb, array[['2026-01-01'::date]], null, null); commit;`), /22023/)

  // The single-call 250+250 boundary exercises cardinality, sorted locks, and
  // ordered results without touching any account outside this exact fixture.
  const dates = Array.from({ length: 500 }, (_, index) =>
    new Date(Date.UTC(2026, 10, index + 1)).toISOString().slice(0, 10))
  const boundary = result(serviceSave(ownerStudent, classroom,
    dates.slice(0, 250).map((date) => ({ date, markdown: 'Boundary' })), dates.slice(250)))
  assert.equal(boundary.results.length, 500)
  assert.equal(boundary.results.filter((entry) => entry.applied).length, 500)
  assert.deepEqual(boundary.results.map((entry) => entry.date), dates)

  // Pre-existing parent, matching head, or plan locks must fail promptly.
  result(serviceSave(ownerStudent, classroom, [{ date: first, markdown: 'Lock baseline' }], [], 3))
  const status = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8' }))
  assert.equal(status.API_URL, 'http://127.0.0.1:54321')
  assert.equal(typeof status.SERVICE_ROLE_KEY, 'string')
  for (const [label, lock] of [
    ['parent', `select id from public.classrooms where id='${classroom}' for update`],
    ['head', `select client_id from public.lesson_plan_mutation_heads
      where classroom_id='${classroom}' and date='${first}' and client_id='${client}' for update`],
    ['plan', `select id from public.lesson_plans where classroom_id='${classroom}' and date='${first}' for update`],
  ]) {
    const holder = new Session(`${label}_holder`)
    await holder.run(`begin; ${lock};`)
    const before = state(classroom)
    assert.throws(() => sql(`begin; ${serviceSave(ownerStudent, classroom,
      [{ date: first, markdown: 'Retry' }], [], 4)} commit;`), /PT409/)
    assert.deepEqual(state(classroom), before)
    const started = Date.now()
    const response = await fetch(`${status.API_URL}/rest/v1/rpc/save_lesson_plans_for_owner_v1`, {
      method: 'POST',
      headers: { apikey: status.SERVICE_ROLE_KEY, Authorization: `Bearer ${status.SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json' },
      body: JSON.stringify({ p_actor_id: ownerStudent, p_classroom_id: classroom,
        p_plans: [{ date: first, content_markdown: 'REST conflict', content: doc }],
        p_cleared_dates: [], p_client_id: client, p_sequence: 12 }),
      signal: AbortSignal.timeout(5000),
    })
    assert.equal(response.status, 409)
    assert.equal((await response.json()).code, 'PT409')
    assert(Date.now() - started < 5000)
    const adapterProof = execFileSync('pnpm', [
      'exec', 'tsx', 'scripts/check-contextual-lesson-plan-bulk-sdk.ts',
      ownerStudent, outsider, classroom, first, client,
      ...(label === 'parent' ? ['conflict-only'] : []),
    ], { encoding: 'utf8' })
    assert.match(adapterProof, /PASS live bulk SDK/)
    assert.deepEqual(state(classroom), before)
    await holder.close()
  }

  const restHolder = new Session('rest_plan_holder')
  await restHolder.run(`begin; select id from public.lesson_plans
    where classroom_id='${classroom}' and date='${first}' for update;`)
  try {
    const started = Date.now()
    const response = await fetch(`${status.API_URL}/rest/v1/rpc/save_lesson_plans_for_owner_v1`, {
      method: 'POST',
      headers: { apikey: status.SERVICE_ROLE_KEY, Authorization: `Bearer ${status.SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json' },
      body: JSON.stringify({ p_actor_id: ownerStudent, p_classroom_id: classroom,
        p_plans: [{ date: first, content_markdown: 'REST conflict', content: doc }],
        p_cleared_dates: [], p_client_id: client, p_sequence: 4 }),
      signal: AbortSignal.timeout(5000),
    })
    assert.equal(response.status, 409)
    assert.equal((await response.json()).code, 'PT409')
    assert(Date.now() - started < 5000)
    const adapterProof = execFileSync('pnpm', [
      'exec', 'tsx', 'scripts/check-contextual-lesson-plan-bulk-sdk.ts',
      ownerStudent, outsider, classroom, first, client,
    ], { encoding: 'utf8' })
    assert.match(adapterProof, /PASS live bulk SDK/)
  } finally {
    await restHolder.close()
  }

  // Opposite request order must converge behind the classroom operation fence.
  const reverseFirst = new Session('reverse_first')
  const reverseSecond = new Session('reverse_second')
  assert.deepEqual(JSON.parse(await reverseFirst.run(`begin; ${serviceSave(ownerStudent, classroom,
    [{ date: second, markdown: 'First writer' }, { date: first, markdown: 'First writer' }], [], 6)}`))
    .results.map((entry) => entry.applied), [true, true])
  const reversePending = reverseSecond.run(`begin; ${serviceSave(ownerStudent, classroom,
    [{ date: first, markdown: 'Second writer' }, { date: second, markdown: 'Second writer' }], [], 7)}`)
  await blocked(reverseSecond, reverseFirst)
  await reverseFirst.run('commit;')
  assert.deepEqual(JSON.parse(await reversePending).results.map((entry) => entry.applied), [true, true])
  await reverseSecond.run('commit;')
  await reverseFirst.close()
  await reverseSecond.close()
  assert.equal(state(classroom).plans.find((entry) => entry.date === first)?.content_markdown, 'Second writer')

  // The unchanged 226 date writer participates in the same operation fence.
  const dateFirst = new Session('date_first')
  const bulkSecond = new Session('bulk_after_date')
  await dateFirst.run(`begin; set local role service_role;
    select public.save_lesson_plan_for_owner_v1('${ownerStudent}','${classroom}',
      '${first}','Date first','${JSON.stringify(doc)}'::jsonb,false,'${client}',8);`)
  const bulkPending = bulkSecond.run(`begin; ${serviceSave(ownerStudent, classroom,
    [{ date: second, markdown: 'Bulk after date' }, { date: first, markdown: 'Bulk after date' }], [], 9)}`)
  await blocked(bulkSecond, dateFirst)
  await dateFirst.run('commit;')
  assert.deepEqual(JSON.parse(await bulkPending).results.map((entry) => entry.applied), [true, true])
  await bulkSecond.run('commit;')
  await dateFirst.close()
  await bulkSecond.close()
  assert.equal(state(classroom).plans.find((entry) => entry.date === first)?.content_markdown, 'Bulk after date')

  // Legacy 125 can take the head before the row. The bulk prelock must reject
  // that in-flight head without advancing any other date in its request.
  const legacyOrdered = new Session('legacy_ordered_holder')
  await legacyOrdered.run(`begin; set local role service_role;
    select public.apply_ordered_lesson_plan_mutation('${classroom}','${first}',
      'Legacy ordered','${JSON.stringify(doc)}'::jsonb,false,'${client}',10);`)
  const beforeLegacyConflict = state(classroom)
  assert.throws(() => sql(`begin; ${serviceSave(ownerStudent, classroom,
    [{ date: second, markdown: 'Must roll back' }, { date: first, markdown: 'Must retry' }], [], 11)} commit;`), /PT409/)
  assert.deepEqual(state(classroom), beforeLegacyConflict)
  await legacyOrdered.close()

  // An unversioned legacy update may hold the plan row before the operation
  // trigger completes. Either ordering must converge to a retryable conflict.
  const legacyRow = new Session('legacy_row_holder')
  await legacyRow.run(`begin; update public.lesson_plans set content_markdown='Legacy row'
    where classroom_id='${classroom}' and date='${first}';`)
  const beforeLegacyRowConflict = state(classroom)
  assert.throws(() => sql(`begin; ${serviceSave(ownerStudent, classroom,
    [{ date: second, markdown: 'Must roll back' }, { date: first, markdown: 'Must retry' }])} commit;`), /PT409/)
  assert.deepEqual(state(classroom), beforeLegacyRowConflict)
  await legacyRow.close()

  // A transfer or archive committed first denies the old owner after an
  // observed lock wait. With the writer first, lifecycle changes wait on it.
  for (const [label, update, restore] of [
    ['transfer', `teacher_id='${ownerTeacher}'`, `teacher_id='${ownerStudent}'`],
    ['archive', 'archived_at=clock_timestamp()', 'archived_at=null'],
  ]) {
    const beforeDenied = state(classroom)
    const lifecycle = new Session(`${label}_first`)
    const writer = new Session(`${label}_denied`)
    await lifecycle.run(`begin; update public.classrooms set ${update} where id='${classroom}';`)
    const denied = writer.run(`begin; ${serviceSave(ownerStudent, classroom,
      [{ date: first, markdown: 'Denied' }])}`)
    const denial = assert.rejects(denied, /42501/)
    await blocked(writer, lifecycle)
    await lifecycle.run('commit;')
    await denial
    assert.deepEqual(state(classroom).plans, beforeDenied.plans,
      `${label} denial changed lesson plans`)
    assert.deepEqual(state(classroom).heads, beforeDenied.heads,
      `${label} denial changed mutation heads`)
    await lifecycle.close()
    await writer.close()
    sql(`update public.classrooms set ${restore} where id='${classroom}';`)

    const writerFirst = new Session(`${label}_writer_first`)
    const lifecycleSecond = new Session(`${label}_second`)
    assert.equal(JSON.parse(await writerFirst.run(`begin; ${serviceSave(ownerStudent,
      classroom, [{ date: first, markdown: `Before ${label}` }])}`)).results[0].applied, true)
    const pending = lifecycleSecond.run(`begin; update public.classrooms set ${update}
      where id='${classroom}'; select 'changed';`)
    await blocked(lifecycleSecond, writerFirst)
    await writerFirst.run('commit;')
    assert.equal(await pending, 'changed')
    await lifecycleSecond.run('commit;')
    await writerFirst.close()
    await lifecycleSecond.close()
    sql(`update public.classrooms set ${restore} where id='${classroom}';`)
  }

  // A later clear blocked by Blueprint lineage rolls back an earlier save,
  // its ordered head, and both classroom revision families.
  result(serviceSave(ownerStudent, classroom, [{ date: linked, markdown: 'Linked' }]))
  sql(`begin;
    insert into public.course_blueprints(id,teacher_id,title)
      values('${blueprint}','${ownerStudent}','${tag} blueprint');
    insert into public.course_blueprint_versions(
      id,course_blueprint_id,version_number,source_draft_revision,
      snapshot_json,snapshot_sha256,created_by
    ) select '${blueprintVersion}',id,1,content_revision,'{}'::jsonb,
        repeat('a',64),teacher_id from public.course_blueprints where id='${blueprint}';
    update public.lesson_plans set source_artifact_id='${sourceArtifact}',
      source_blueprint_version_id='${blueprintVersion}'
      where classroom_id='${classroom}' and date='${linked}';
    commit;`)
  const lineageBefore = state(classroom).plans.find((entry) => entry.date === linked)
  assert.equal(lineageBefore?.source_artifact_id, sourceArtifact)
  assert.equal(lineageBefore?.source_blueprint_version_id, blueprintVersion)
  const lineageSave = result(serviceSave(ownerStudent, classroom,
    [{ date: linked, markdown: 'Preserve lineage' }], [], 4)).results[0].lesson_plan
  assert.equal(lineageSave.id, lineageBefore.id)
  assert.equal(lineageSave.artifact_id, lineageBefore.artifact_id)
  assert.equal(lineageSave.source_artifact_id, sourceArtifact)
  assert.equal(lineageSave.source_blueprint_version_id, blueprintVersion)
  const blueprintHolder = new Session('blueprint_holder')
  await blueprintHolder.run(`begin; select pg_advisory_xact_lock(hashtextextended(
    jsonb_build_array('course_blueprint_purge','${blueprint}'::uuid)::text,0));`)
  const beforeConflict = state(classroom)
  try {
    assert.throws(() => sql(`begin; ${serviceSave(ownerStudent, classroom,
      [{ date: second, markdown: 'Earlier save' }], [linked], 5)} commit;`), /PT409/)
    assert.deepEqual(state(classroom), beforeConflict,
      'Late Blueprint conflict committed earlier plan, head, or revision')
    const started = Date.now()
    const response = await fetch(`${status.API_URL}/rest/v1/rpc/save_lesson_plans_for_owner_v1`, {
      method: 'POST',
      headers: { apikey: status.SERVICE_ROLE_KEY, Authorization: `Bearer ${status.SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json' },
      body: JSON.stringify({ p_actor_id: ownerStudent, p_classroom_id: classroom,
        p_plans: [{ date: second, content_markdown: 'Earlier REST save', content: doc }],
        p_cleared_dates: [linked], p_client_id: client, p_sequence: 5 }),
      signal: AbortSignal.timeout(5000),
    })
    assert.equal(response.status, 409)
    assert.equal((await response.json()).code, 'PT409')
    assert(Date.now() - started < 5000)
    assert.deepEqual(state(classroom), beforeConflict,
      'Late Blueprint REST conflict committed earlier plan, head, or revision')
  } finally {
    await blueprintHolder.close()
  }
  sql(`begin;
    insert into public.classroom_purge_operations(
      id,teacher_id,classroom_id,classroom_title,request_sha256,
      status,source_revision,impact_summary,retryable,error_code
    ) select '${purgeOperation}','${ownerStudent}',classroom.id,classroom.title,
        repeat('9',64),'failed',revision.revision,'{}'::jsonb,true,
        'database_finalize_failed'
      from public.classrooms classroom
      join public.classroom_archive_revisions revision on revision.classroom_id=classroom.id
      where classroom.id='${classroom}' and classroom.teacher_id='${ownerStudent}'
        and classroom.title='${tag} student';
    insert into public.classroom_purge_fences(classroom_id,operation_id,teacher_id)
      values('${classroom}','${purgeOperation}','${ownerStudent}');
    commit;`)
  const beforePurge = state(classroom)
  assert.throws(() => sql(`begin; ${serviceSave(ownerStudent, classroom,
    [{ date: second, markdown: 'Purge denied' }], [], 5)} commit;`), /PT409/)
  assert.deepEqual(state(classroom), beforePurge, 'Purge fence changed batch state')
  sql(`begin;
    delete from public.classroom_purge_fences
      where classroom_id='${classroom}' and operation_id='${purgeOperation}'
        and teacher_id='${ownerStudent}';
    delete from public.classroom_purge_operations
      where id='${purgeOperation}' and classroom_id='${classroom}'
        and teacher_id='${ownerStudent}' and status='failed';
    commit;`)
  assert.equal(result(serviceSave(ownerStudent, classroom,
    [{ date: second, markdown: 'Purge released' }], [], 5)).results[0].applied, true)
  console.log('PASS migration 227 synthetic batch, ordering, lifecycle, contention and rollback contracts')
} finally {
  const cleanup = observer.closed ? new Session('cleanup') : observer
  try {
    await Promise.allSettled(sessions.filter((session) => session !== cleanup).map((session) => session.close()))
    sql(`begin;
        create temp table bulk_audit_cleanup_ops (
          operation_id uuid,
          subject_user_id uuid,
          primary key (operation_id, subject_user_id)
        ) on commit drop;
        insert into bulk_audit_cleanup_ops (operation_id, subject_user_id)
          select audit.operation_id, audit.subject_user_id
          from public.account_plan_audit audit
          join public.users fixture_user on fixture_user.id=audit.subject_user_id
          where audit.actor_ref='system:user-provisioning'
            and audit.reason_code='default_free_account_provisioning'
            and (
              (fixture_user.id='${ownerStudent}' and fixture_user.email='${tag}_student@example.invalid')
              or (fixture_user.id='${ownerTeacher}' and fixture_user.email='${tag}_teacher@example.invalid')
              or (fixture_user.id='${outsider}' and fixture_user.email='${tag}_outsider@example.invalid')
            );
        delete from public.classroom_purge_fences
          where classroom_id='${classroom}' and operation_id='${purgeOperation}'
            and teacher_id='${ownerStudent}';
        delete from public.classroom_purge_operations
          where id='${purgeOperation}' and classroom_id='${classroom}'
            and teacher_id='${ownerStudent}' and status='failed';
        delete from public.effective_feature_entitlement_audit audit
          using (values ${entitlementValues}) fixture(operation_id,u)
          where audit.operation_id=fixture.operation_id and audit.subject_user_id=fixture.u
            and audit.actor_ref='test:227' and audit.reason_code='${tag}'
            and audit.feature_key='classrooms.create'
            and exists(select 1 from public.users owner where owner.id=fixture.u
              and owner.email in ('${tag}_student@example.invalid','${tag}_teacher@example.invalid'));
        delete from public.effective_feature_entitlement_audit audit
          using bulk_audit_cleanup_ops operation
          where audit.operation_id=operation.operation_id
            and audit.subject_user_id=operation.subject_user_id
            and audit.actor_ref='system:user-provisioning'
            and audit.reason_code='default_free_account_provisioning'
            and audit.feature_key='classrooms.create';
        delete from public.account_plan_audit audit
          using bulk_audit_cleanup_ops operation
          where audit.operation_id=operation.operation_id
            and audit.subject_user_id=operation.subject_user_id
            and audit.actor_ref='system:user-provisioning'
            and audit.reason_code='default_free_account_provisioning';
        do $cleanup$
        begin
          if exists (select 1 from public.account_plan_audit audit
            join bulk_audit_cleanup_ops operation
              on operation.operation_id=audit.operation_id
              and operation.subject_user_id=audit.subject_user_id)
            or exists (select 1 from public.effective_feature_entitlement_audit audit
              join bulk_audit_cleanup_ops operation
                on operation.operation_id=audit.operation_id
                and operation.subject_user_id=audit.subject_user_id)
          then
            raise exception 'Synthetic auto-provision audit cleanup incomplete';
          end if;
        end;
        $cleanup$;
        delete from public.classrooms
          where (id='${classroom}' and title='${tag} student' and class_code='${tag}_s')
             or (id='${teacherClassroom}' and title='${tag} teacher' and class_code='${tag}_t');
        delete from public.course_blueprints where id='${blueprint}'
          and teacher_id='${ownerStudent}' and title='${tag} blueprint';
        delete from public.users
          where (id='${ownerStudent}' and email='${tag}_student@example.invalid')
             or (id='${ownerTeacher}' and email='${tag}_teacher@example.invalid')
             or (id='${outsider}' and email='${tag}_outsider@example.invalid');
        commit;`)
      assert.equal(sql(`select
        (select count(*) from public.classrooms where id in ('${classroom}','${teacherClassroom}'))+
        (select count(*) from public.lesson_plans where classroom_id in ('${classroom}','${teacherClassroom}'))+
        (select count(*) from public.lesson_plan_mutation_heads where classroom_id in ('${classroom}','${teacherClassroom}'))+
        (select count(*) from public.classroom_archive_revisions where classroom_id in ('${classroom}','${teacherClassroom}'))+
        (select count(*) from public.course_blueprints where id='${blueprint}')+
        (select count(*) from public.course_blueprint_versions where id='${blueprintVersion}')+
        (select count(*) from public.classroom_purge_operations where id='${purgeOperation}')+
        (select count(*) from public.classroom_purge_fences where operation_id='${purgeOperation}')+
        (select count(*) from public.users where id in ('${ownerStudent}','${ownerTeacher}','${outsider}'))+
        (select count(*) from public.account_plans where subject_user_id in ('${ownerStudent}','${ownerTeacher}','${outsider}'))+
        (select count(*) from public.account_plan_audit where subject_user_id in ('${ownerStudent}','${ownerTeacher}','${outsider}'))+
        (select count(*) from public.effective_feature_entitlements where subject_user_id in ('${ownerStudent}','${ownerTeacher}','${outsider}'))+
        (select count(*) from public.effective_feature_entitlement_audit where subject_user_id in ('${ownerStudent}','${ownerTeacher}','${outsider}'));`), '0')
    console.log('PASS exact synthetic fixture cleanup with zero residual rows')
  } finally {
    await cleanup.close()
  }
}
