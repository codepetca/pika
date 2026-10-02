#!/usr/bin/env node
// Local synthetic fixtures only; migration 226 must already be installed.
// This runner never applies migrations.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

const container = 'supabase_db_pika'
assert.equal(execFileSync('docker', ['inspect', container, '--format', '{{ index .Config.Labels "com.supabase.cli.project" }}'], { encoding: 'utf8' }).trim(), 'pika')
assert.match(execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' }), /:54322\s*$/m)

const tag = `lesson_date_${randomUUID().slice(0, 8)}`
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
const date = '2026-09-19'
const plan = '{"type":"doc","content":[]}'
const sessions = []
let created = false

function sql(statement) {
  return execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], {
    input: `set statement_timeout='15s'; set lock_timeout='4s'; ${statement}`,
    encoding: 'utf8',
  }).trim()
}

function save(actor, target, day, markdown, sequence = null, nonce = client) {
  const version = sequence === null ? 'null, null' : `'${nonce}', ${sequence}`
  return `select public.save_lesson_plan_for_owner_v1(
    '${actor}', '${target}', '${day}', '${markdown}', '${plan}'::jsonb,
    ${markdown.trim() === ''}, ${version})::text;`
}

function serviceSave(actor, target, day, markdown, sequence = null, nonce = client) {
  return `set local role service_role; ${save(actor, target, day, markdown, sequence, nonce)}`
}

function result(statement) {
  return JSON.parse(sql(`begin; ${statement} commit;`).split('\n')[0])
}

function state(target) {
  return JSON.parse(sql(`select jsonb_build_object(
    'plan', (select to_jsonb(plan) from public.lesson_plans plan
      where plan.classroom_id='${target}' and plan.date='${date}'),
    'heads', (select coalesce(jsonb_agg(to_jsonb(head) order by head.client_id), '[]'::jsonb)
      from public.lesson_plan_mutation_heads head
      where head.classroom_id='${target}' and head.date='${date}'),
    'archive_revision', (select revision from public.classroom_archive_revisions
      where classroom_id='${target}'),
    'blueprint_revision', (select blueprint_source_revision from public.classrooms
      where id='${target}')
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
      const timer = setTimeout(() => this.fail(new Error(`Session timeout: ${this.name}`)), 20_000)
      this.pending = { marker, timer, resolve, reject }
      this.child.stdin.write(`${statement}\n\\echo ${marker}\n`)
    })
  }
  async close() {
    if (!this.closed) this.child.stdin.end('ROLLBACK;\n\\q\n')
    await this.done
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
  assert.equal(sql("select exists(select 1 from supabase_migrations.schema_migrations where version='226');"),
    't', 'Migration 226 must be separately applied before this runner')
  assert.equal(sql("select has_function_privilege('anon', 'public.save_lesson_plan_for_owner_v1(uuid,uuid,date,text,jsonb,boolean,uuid,bigint)', 'EXECUTE');"), 'f')
  assert.equal(sql("select has_function_privilege('authenticated', 'public.save_lesson_plan_for_owner_v1(uuid,uuid,date,text,jsonb,boolean,uuid,bigint)', 'EXECUTE');"), 'f')
  sql(`begin;
    insert into public.users(id,email,role) values
      ('${ownerStudent}','${tag}_student@example.invalid','student'),
      ('${ownerTeacher}','${tag}_teacher@example.invalid','teacher'),
      ('${outsider}','${tag}_outsider@example.invalid','teacher');
    set local role service_role;
    select public.set_effective_feature_entitlement_v1(operation_id, u,
      'classrooms.create','manual',true,clock_timestamp(),null,2,'test:226','${tag}',
      coalesce((select revision from public.effective_feature_entitlements
        where subject_user_id=u and feature_key='classrooms.create'),0))
    from (values ${entitlementValues}) fixture(operation_id,u);
    reset role;
    insert into public.classrooms(id,teacher_id,title,class_code) values
      ('${classroom}','${ownerStudent}','${tag} student','${tag}_s'),
      ('${teacherClassroom}','${ownerTeacher}','${tag} teacher','${tag}_t');
    commit;`)
  created = true

  for (const role of ['anon', 'authenticated']) {
    assert.throws(() => sql(`begin; set local role ${role};
      ${save(ownerStudent, classroom, date, 'Denied direct execute')} commit;`), /42501/)
  }

  for (const [actor, target] of [[ownerStudent, classroom], [ownerTeacher, teacherClassroom]]) {
    const inserted = result(serviceSave(actor, target, date, 'First', 1))
    assert.equal(inserted.applied, true)
    assert.equal(inserted.lesson_plan.classroom_id, target)
    assert.equal(inserted.lesson_plan.content_markdown, 'First')
    assert.equal(inserted.lesson_plan.source_artifact_id, null)
    assert.equal(inserted.lesson_plan.source_blueprint_version_id, null)
    const originalId = inserted.lesson_plan.id
    const artifact = inserted.lesson_plan.artifact_id
    const afterInsert = state(target)
    const equal = result(serviceSave(actor, target, date, 'Ignored', 1))
    assert.equal(equal.applied, false)
    assert.equal(equal.lesson_plan.content_markdown, 'First')
    assert.deepEqual(state(target), afterInsert, 'Equal sequence changed a row, head, or revision')
    const updated = result(serviceSave(actor, target, date, 'Second', 2))
    assert.equal(updated.lesson_plan.id, originalId)
    assert.equal(updated.lesson_plan.artifact_id, artifact)
    assert.equal(updated.lesson_plan.content_markdown, 'Second')
    assert(state(target).archive_revision > afterInsert.archive_revision)
    assert.equal(result(serviceSave(actor, target, date, 'Independent', 1, otherClient)).applied, true)
    assert.equal(result(serviceSave(actor, target, date, '', 3)).lesson_plan, null)
    const afterDelete = state(target)
    assert.equal(result(serviceSave(actor, target, date, 'Stale resurrection', 2)).applied, false)
    assert.deepEqual(state(target), afterDelete, 'Stale save resurrected or changed head/revision')
    const headsBeforeUnversioned = state(target).heads
    assert.equal(result(serviceSave(actor, target, date, 'Unversioned')).lesson_plan.content_markdown, 'Unversioned')
    assert.equal(result(serviceSave(actor, target, date, '')).lesson_plan, null)
    assert.deepEqual(state(target).heads, headsBeforeUnversioned, 'Unversioned calls changed mutation heads')
  }
  assert.throws(() => sql(`begin; ${serviceSave(outsider, classroom, date, 'Denied')} commit;`), /42501/)

  // A legacy row-first writer can hold either record before its triggers reach
  // the operation fence. The new writer must return promptly with PT409.
  result(serviceSave(ownerStudent, classroom, date, 'For lock checks'))
  for (const [label, lock] of [
    ['parent', `select id from public.classrooms where id='${classroom}' for update`],
    ['head', `select client_id from public.lesson_plan_mutation_heads where classroom_id='${classroom}' and date='${date}' and client_id='${client}' for update`],
    ['lesson', `select id from public.lesson_plans where classroom_id='${classroom}' and date='${date}' for update`],
  ]) {
    const holder = new Session(`${label}_holder`)
    await holder.run(`begin; ${lock};`)
    assert.throws(() => sql(`begin; ${serviceSave(ownerStudent, classroom, date, 'Must retry', 4)} commit;`), /PT409/)
    await holder.close()
  }

  // Prove PostgREST does not retry the translated lock conflict indefinitely.
  const status = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8' }))
  assert.equal(status.API_URL, 'http://127.0.0.1:54321')
  assert.equal(typeof status.SERVICE_ROLE_KEY, 'string')
  const restHolder = new Session('rest_row_holder')
  await restHolder.run(`begin; select id from public.lesson_plans
    where classroom_id='${classroom}' and date='${date}' for update;`)
  try {
    const started = Date.now()
    const response = await fetch(`${status.API_URL}/rest/v1/rpc/save_lesson_plan_for_owner_v1`, {
      method: 'POST',
      headers: {
        apikey: status.SERVICE_ROLE_KEY,
        Authorization: `Bearer ${status.SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_actor_id: ownerStudent,
        p_classroom_id: classroom,
        p_date: date,
        p_content_markdown: 'REST conflict',
        p_content: JSON.parse(plan),
        p_delete: false,
        p_client_id: client,
        p_sequence: 4,
      }),
      signal: AbortSignal.timeout(5000),
    })
    assert.equal(response.status, 409)
    assert.equal((await response.json()).code, 'PT409')
    assert(Date.now() - started < 5000, 'PostgREST conflict response was delayed')
    const adapterProof = execFileSync('pnpm', [
      'exec', 'tsx', 'scripts/check-contextual-lesson-plan-date-sdk.ts',
      ownerStudent, outsider, classroom, date,
    ], { encoding: 'utf8' })
    assert.match(adapterProof, /PASS live SDK nullable error envelope maps 404, 403 and 409/)
    console.log(adapterProof.trim())
  } finally {
    await restHolder.close()
  }

  const transfer = new Session('transfer_first')
  const writer = new Session('writer_second')
  await transfer.run(`begin; update public.classrooms set teacher_id='${ownerTeacher}' where id='${classroom}';`)
  const denied = writer.run(`begin; ${serviceSave(ownerStudent, classroom, date, 'No longer owner')}`)
  const denial = assert.rejects(denied, /42501/)
  await blocked(writer, transfer)
  await transfer.run('commit;')
  await denial
  await transfer.close()
  await writer.close()
  assert.equal(sql(`select content_markdown from public.lesson_plans where classroom_id='${classroom}' and date='${date}';`), 'For lock checks')

  // Restore this synthetic class so archive and ordering races can use its
  // original owner. Each expected wait is observed in pg_blocking_pids.
  sql(`update public.classrooms set teacher_id='${ownerStudent}' where id='${classroom}';`)
  const archiveFirst = new Session('archive_first')
  const deniedWriter = new Session('archive_denied_writer')
  await archiveFirst.run(`begin; update public.classrooms set archived_at=clock_timestamp() where id='${classroom}';`)
  const archivedSave = deniedWriter.run(`begin; ${serviceSave(ownerStudent, classroom, date, 'Denied by archive')}`)
  const archivedDenial = assert.rejects(archivedSave, /42501/)
  await blocked(deniedWriter, archiveFirst)
  await archiveFirst.run('commit;')
  await archivedDenial
  await archiveFirst.close()
  await deniedWriter.close()
  sql(`update public.classrooms set archived_at=null where id='${classroom}';`)

  const writeFirst = new Session('write_first')
  const archiveSecond = new Session('archive_second')
  assert.equal(JSON.parse(await writeFirst.run(`begin; ${serviceSave(ownerStudent, classroom, date, 'Before archive', 5)}`)).applied, true)
  const pendingArchive = archiveSecond.run(`begin; update public.classrooms set archived_at=clock_timestamp()
    where id='${classroom}'; select 'archived';`)
  await blocked(archiveSecond, writeFirst)
  await writeFirst.run('commit;')
  assert.equal(await pendingArchive, 'archived')
  await archiveSecond.run('commit;')
  await writeFirst.close()
  await archiveSecond.close()
  assert.equal(sql(`select content_markdown from public.lesson_plans where classroom_id='${classroom}' and date='${date}';`), 'Before archive')
  sql(`update public.classrooms set archived_at=null where id='${classroom}';`)

  const newer = new Session('newer_sequence')
  const older = new Session('older_sequence')
  assert.equal(JSON.parse(await newer.run(`begin; ${serviceSave(ownerStudent, classroom, date, 'Newer', 7)}`)).applied, true)
  const stale = older.run(`begin; ${serviceSave(ownerStudent, classroom, date, 'Older', 6)}`)
  await blocked(older, newer)
  await newer.run('commit;')
  assert.equal(JSON.parse(await stale).applied, false)
  await older.run('commit;')
  await newer.close()
  await older.close()
  assert.equal(sql(`select content_markdown from public.lesson_plans where classroom_id='${classroom}' and date='${date}';`), 'Newer')

  const writerFirst = new Session('writer_before_transfer')
  const transferSecond = new Session('transfer_after_writer')
  assert.equal(JSON.parse(await writerFirst.run(`begin; ${serviceSave(ownerStudent, classroom, date, 'Before transfer', 8)}`)).applied, true)
  const pendingTransfer = transferSecond.run(`begin; update public.classrooms set teacher_id='${ownerTeacher}'
    where id='${classroom}'; select 'transferred';`)
  await blocked(transferSecond, writerFirst)
  await writerFirst.run('commit;')
  assert.equal(await pendingTransfer, 'transferred')
  await transferSecond.run('commit;')
  await writerFirst.close()
  await transferSecond.close()
  assert.equal(sql(`select content_markdown from public.lesson_plans where classroom_id='${classroom}' and date='${date}';`), 'Before transfer')
  sql(`update public.classrooms set teacher_id='${ownerStudent}' where id='${classroom}';`)

  // Use the repository's real Blueprint Version fixture shape to exercise the
  // unchanged lesson lineage trigger under an unrelated Blueprint lock.
  sql(`begin;
    insert into public.course_blueprints(id,teacher_id,title)
      values('${blueprint}','${ownerStudent}','${tag} blueprint');
    insert into public.course_blueprint_versions(
      id,course_blueprint_id,version_number,source_draft_revision,
      snapshot_json,snapshot_sha256,created_by
    ) select '${blueprintVersion}',id,1,content_revision,'{}'::jsonb,
        repeat('a',64),teacher_id
      from public.course_blueprints where id='${blueprint}';
    update public.lesson_plans set source_artifact_id='${sourceArtifact}',
      source_blueprint_version_id='${blueprintVersion}'
      where classroom_id='${classroom}' and date='${date}';
    commit;`)
  const lineageBefore = state(classroom)
  assert.equal(lineageBefore.plan.source_blueprint_version_id, blueprintVersion)
  assert.equal(lineageBefore.plan.source_artifact_id, sourceArtifact)
  const lineageSave = result(serviceSave(ownerStudent, classroom, date, 'Preserve lineage', 9))
  assert.equal(lineageSave.lesson_plan.id, lineageBefore.plan.id)
  assert.equal(lineageSave.lesson_plan.artifact_id, lineageBefore.plan.artifact_id)
  assert.equal(lineageSave.lesson_plan.source_blueprint_version_id, blueprintVersion)
  assert.equal(lineageSave.lesson_plan.source_artifact_id, sourceArtifact)

  const blueprintHolder = new Session('blueprint_lock_holder')
  await blueprintHolder.run(`begin; select pg_advisory_xact_lock(hashtextextended(
    jsonb_build_array('course_blueprint_purge','${blueprint}'::uuid)::text,0));`)
  const beforeConflict = state(classroom)
  try {
    assert.throws(() => sql(`begin; ${serviceSave(ownerStudent, classroom, date, '', 10)} commit;`), /PT409/)
    assert.deepEqual(state(classroom), beforeConflict, 'Blueprint conflict committed a head or plan change')
    const status = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8' }))
    assert.equal(status.API_URL, 'http://127.0.0.1:54321')
    const started = Date.now()
    const response = await fetch(`${status.API_URL}/rest/v1/rpc/save_lesson_plan_for_owner_v1`, {
      method: 'POST',
      headers: {
        apikey: status.SERVICE_ROLE_KEY,
        Authorization: `Bearer ${status.SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_actor_id: ownerStudent, p_classroom_id: classroom, p_date: date,
        p_content_markdown: '', p_content: JSON.parse(plan), p_delete: true,
        p_client_id: client, p_sequence: 10,
      }),
      signal: AbortSignal.timeout(5000),
    })
    assert.equal(response.status, 409)
    assert.equal((await response.json()).code, 'PT409')
    assert(Date.now() - started < 5000, 'Blueprint REST conflict was delayed')
    assert.deepEqual(state(classroom), beforeConflict, 'Blueprint REST conflict committed data')
  } finally {
    await blueprintHolder.close()
  }
  assert.equal(result(serviceSave(ownerStudent, classroom, date, '', 10)).lesson_plan, null)
  result(serviceSave(ownerStudent, classroom, date, 'Classroom fence baseline'))
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
  const beforePurgeConflict = state(classroom)
  assert.throws(() => sql(`select public.guard_classroom_purge_lifecycle('${classroom}');`), /55000/)
  assert.throws(() => sql(`begin; ${serviceSave(ownerStudent, classroom, date, 'Fence denied', 11)} commit;`), /PT409/)
  assert.deepEqual(state(classroom), beforePurgeConflict, 'Classroom purge fence committed a head or plan change')
  sql(`begin;
    delete from public.classroom_purge_fences
      where classroom_id='${classroom}' and operation_id='${purgeOperation}'
        and teacher_id='${ownerStudent}';
    delete from public.classroom_purge_operations
      where id='${purgeOperation}' and classroom_id='${classroom}'
        and teacher_id='${ownerStudent}' and status='failed';
    commit;`)
  assert.equal(result(serviceSave(ownerStudent, classroom, date, 'Fence released', 11)).applied, true)
  console.log('PASS migration 226 synthetic actor, ordered, unversioned, privilege, transfer and archive contracts')
} finally {
  const cleanup = observer.closed ? new Session('cleanup') : observer
  try {
    await Promise.allSettled(sessions.filter((session) => session !== cleanup).map((session) => session.close()))
    if (created) {
      sql(`begin;
        delete from public.classroom_purge_fences
          where classroom_id='${classroom}' and operation_id='${purgeOperation}'
            and teacher_id='${ownerStudent}';
        delete from public.classroom_purge_operations
          where id='${purgeOperation}' and classroom_id='${classroom}'
            and teacher_id='${ownerStudent}' and status='failed';
        delete from public.effective_feature_entitlement_audit audit
          using (values ${entitlementValues}) fixture(operation_id,u)
          where audit.operation_id=fixture.operation_id and audit.subject_user_id=fixture.u
            and audit.actor_ref='test:226' and audit.reason_code='${tag}'
            and audit.feature_key='classrooms.create'
            and exists(select 1 from public.users owner
              where owner.id=fixture.u and owner.email in
                ('${tag}_student@example.invalid','${tag}_teacher@example.invalid'));
        delete from public.classrooms
          where (id='${classroom}' and title='${tag} student')
             or (id='${teacherClassroom}' and title='${tag} teacher');
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
        (select count(*) from public.effective_feature_entitlements where subject_user_id in ('${ownerStudent}','${ownerTeacher}'))+
        (select count(*) from public.effective_feature_entitlement_audit audit
          where audit.subject_user_id in ('${ownerStudent}','${ownerTeacher}')
             or audit.operation_id in (select fixture.operation_id from (values ${entitlementValues}) fixture(operation_id,u)));`), '0')
      console.log('PASS exact synthetic fixture cleanup with zero residual rows')
    }
  } finally {
    await cleanup.close()
  }
}
