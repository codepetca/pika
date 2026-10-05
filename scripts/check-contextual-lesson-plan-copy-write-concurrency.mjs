#!/usr/bin/env node
// Local synthetic contract only, after separately approved migration 229.
// This runner never applies schema, resets, seeds, or targets a hosted database.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

const container = 'supabase_db_pika'
assert.equal(execFileSync('docker', ['inspect', container, '--format', '{{ index .Config.Labels "com.supabase.cli.project" }}'], { encoding: 'utf8' }).trim(), 'pika')
assert.match(execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' }), /:54322\s*$/m)
const tag = `lesson_copy_${randomUUID().slice(0, 8)}`
const student = randomUUID()
const teacher = randomUUID()
const outsider = randomUUID()
const classroom = randomUUID()
const teacherClassroom = randomUUID()
const nonce = randomUUID()
const blueprint = randomUUID()
const version = randomUUID()
const lineage = randomUUID()
const sourceLineage = randomUUID()
const purge = randomUUID()
const entitlementPairs = [student, teacher].map((subject) => ({ subject, operation: randomUUID() }))
const entitlementValues = entitlementPairs.map(({ subject, operation }) => `('${operation}'::uuid,'${subject}'::uuid)`).join(',')
const from = '2026-10-01'
const to = '2026-10-02'
const spare = '2026-10-03'
const fresh = '2026-10-04'
const forcedCleanup = process.argv.includes('--verify-cleanup-after-fixture')
const sessions = []
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`
const document = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
function sql(statement) {
  return execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], {
    input: `set statement_timeout='30s'; set lock_timeout='4s'; ${statement}`, encoding: 'utf8',
  }).trim()
}
assert.equal(sql("select exists(select 1 from supabase_migrations.schema_migrations where version='229');"), 't',
  'Migration 229 must be separately approved and applied before this runner')
for (const role of ['anon', 'authenticated']) {
  assert.equal(sql(`select has_function_privilege('${role}',
    'public.copy_lesson_plan_for_owner_v1(uuid,uuid,date,date)','EXECUTE');`), 'f')
}
function copy(actor = student, target = classroom, sourceDate = from, targetDate = to) {
  return `select public.copy_lesson_plan_for_owner_v1(${quote(actor)},${quote(target)},
    ${quote(sourceDate)},${quote(targetDate)})::text;`
}
const serviceCopy = (...args) => `set local role service_role; ${copy(...args)}`
function result(statement) { return JSON.parse(sql(`begin; ${statement} commit;`).split('\n')[0]) }
function save(date, text, actor = student, target = classroom, sequence = null) {
  return `select public.save_lesson_plan_for_owner_v1(${quote(actor)},${quote(target)},${quote(date)},
    ${quote(text)},${quote(JSON.stringify(document(text)))}::jsonb,false,
    ${sequence === null ? 'null,null' : `${quote(nonce)},${sequence}`});`
}
function state(target = classroom) {
  return JSON.parse(sql(`select jsonb_build_object(
    'plans',(select coalesce(jsonb_agg(to_jsonb(p) order by p.date),'[]'::jsonb)
      from public.lesson_plans p where p.classroom_id='${target}'),
    'heads',(select coalesce(jsonb_agg(to_jsonb(h) order by h.date,h.client_id),'[]'::jsonb)
      from public.lesson_plan_mutation_heads h where h.classroom_id='${target}'),
    'archive_revision',(select revision from public.classroom_archive_revisions where classroom_id='${target}'),
    'blueprint_revision',(select blueprint_source_revision from public.classrooms where id='${target}')
  )::text;`))
}
const plan = (target, date) => state(target).plans.find((row) => row.date === date)
class Session {
  constructor(name) {
    this.name = `${tag}_${name}`
    this.output = ''; this.errors = ''; this.pending = null; this.closed = false
    this.child = spawn('docker', ['exec', '-i', '-e', `PGAPPNAME=${this.name}`, container,
      'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'])
    this.child.stdout.on('data', (chunk) => {
      this.output += chunk.toString()
      if (this.pending && this.output.includes(this.pending.marker)) {
        const pending = this.pending; this.pending = null; clearTimeout(pending.timer)
        pending.resolve(this.output.slice(0, this.output.indexOf(pending.marker)).trim())
      }
    })
    this.child.stderr.on('data', (chunk) => { this.errors += chunk.toString() })
    this.child.stdin.on('error', (error) => this.fail(error))
    this.child.on('error', (error) => this.fail(error))
    this.done = new Promise((resolve) => this.child.on('close', (code) => {
      this.closed = true; this.fail(new Error(`${this.name} exited ${code}: ${this.errors}`)); resolve()
    }))
    sessions.push(this)
  }
  fail(error) { if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = null } }
  run(statement) {
    assert(!this.pending && !this.closed)
    this.output = ''; this.errors = ''
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
    const hard = setTimeout(() => this.child.kill('SIGKILL'), 8000)
    let bound
    try {
      await Promise.race([this.done, new Promise((_, reject) => {
        bound = setTimeout(() => reject(new Error(`Session close timeout: ${this.name}`)), 10_000)
      })])
    } finally { clearTimeout(force); clearTimeout(hard); clearTimeout(bound) }
  }
}
const observer = new Session('observer')
async function blocked(waiter, holder) {
  for (let count = 0; count < 100; count += 1) {
    if (await observer.run(`select exists(select 1 from pg_stat_activity w,pg_stat_activity h
      where w.application_name='${waiter.name}' and h.application_name='${holder.name}'
        and w.wait_event_type='Lock' and h.pid=any(pg_blocking_pids(w.pid)));`) === 't') return
    assert(waiter.pending, 'Contender completed before expected lock wait')
    await delay(30)
  }
  throw new Error('Expected pg_blocking_pids evidence was not observed')
}
try {
  sql(`begin;
    insert into public.users(id,email,role) values
      ('${student}','${tag}_student@example.invalid','student'),
      ('${teacher}','${tag}_teacher@example.invalid','teacher'),
      ('${outsider}','${tag}_outsider@example.invalid','teacher');
    set local role service_role;
    select public.set_effective_feature_entitlement_v1(operation_id,u,'classrooms.create','manual',true,
      clock_timestamp(),null,2,'test:229','${tag}',coalesce((select revision
        from public.effective_feature_entitlements where subject_user_id=u and feature_key='classrooms.create'),0))
      from (values ${entitlementValues}) fixture(operation_id,u);
    reset role;
    insert into public.classrooms(id,teacher_id,title,class_code) values
      ('${classroom}','${student}','${tag} student','${tag}_s'),
      ('${teacherClassroom}','${teacher}','${tag} teacher','${tag}_t');
    commit;`)
  if (forcedCleanup) throw new Error('Forced post-fixture cleanup proof')
  for (const [actor, target] of [[student, classroom], [teacher, teacherClassroom]]) {
    sql(`begin; set local role service_role; ${save(from, 'Source', actor, target, 1)} ${save(to, 'Old destination', actor, target, 1)} commit;`)
    const sourceBefore = plan(target, from)
    const destinationBefore = plan(target, to)
    const heads = state(target).heads
    const copied = result(serviceCopy(actor, target)).lesson_plan
    assert.equal(copied.content_markdown, sourceBefore.content_markdown)
    assert.deepEqual(copied.content, sourceBefore.content)
    for (const key of ['id', 'artifact_id', 'created_at', 'source_artifact_id', 'source_blueprint_version_id', 'blueprint_archived_at']) {
      assert.equal(copied[key], destinationBefore[key], `Copy changed destination ${key}`)
    }
    assert.deepEqual(plan(target, from), sourceBefore, 'Copy changed source')
    assert.deepEqual(state(target).heads, heads, 'Copy changed ordered heads')
    const inserted = result(serviceCopy(actor, target, from, fresh)).lesson_plan
    assert.notEqual(inserted.id, sourceBefore.id)
    assert.notEqual(inserted.artifact_id, sourceBefore.artifact_id)
    assert.equal(inserted.source_artifact_id, null)
    assert.equal(inserted.source_blueprint_version_id, null)
    assert.deepEqual(Object.keys(inserted).sort(), Object.keys(sourceBefore).sort())
  }
  for (const markdown of [null, '', '  ', 'Canonical\r\nMarkdown']) {
    sql(`update public.lesson_plans set content_markdown=${markdown === null ? 'null' : quote(markdown)}
      where classroom_id='${classroom}' and date='${from}';`)
    assert.equal(result(serviceCopy()).lesson_plan.content_markdown, markdown)
  }
  sql(`update public.lesson_plans set content='{"type":"doc"}'::jsonb,content_markdown=null
    where classroom_id='${classroom}' and date='${from}';`)
  assert.deepEqual(result(serviceCopy()).lesson_plan.content, { type: 'doc' })
  for (const invalid of [
    { type: 'doc', content: [null] },
    { type: 'doc', content: [{}] },
    { type: 'doc', content: [{ content: [] }] },
    { type: 'doc', content: [{ type: 'text', text: 1 }] },
    { type: 'doc', content: [{ type: 'x', marks: [{ type: 'bold', attrs: [] }] }] },
    { type: 'doc', content: [{ type: '😀'.repeat(51) }] },
  ]) {
    sql(`update public.lesson_plans set content=${quote(JSON.stringify(invalid))}::jsonb
      where classroom_id='${classroom}' and date='${from}';`)
    const before = state()
    assert.throws(() => sql(`begin; ${serviceCopy()} commit;`), /PT503/)
    assert.deepEqual(state(), before, 'Malformed source committed copy or revision')
  }
  sql(`begin; set local role service_role; ${save(from, 'Source restored')} commit;`)
  const deniedState = state()
  for (const [statement, code] of [
    [serviceCopy(outsider), /42501/],
    [serviceCopy(student, randomUUID()), /P0002/],
    [serviceCopy(student, classroom, spare, to), /PT404/],
    [serviceCopy(student, classroom, from, from), /22023/],
    [`set local role anon; ${copy()}`, /42501/],
    [`set local role authenticated; ${copy()}`, /42501/],
  ]) assert.throws(() => sql(`begin; ${statement} commit;`), code)
  assert.deepEqual(state(), deniedState)

  const status = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8' }))
  assert.equal(status.API_URL, 'http://127.0.0.1:54321')
  assert.equal(typeof status.SERVICE_ROLE_KEY, 'string')
  for (const [label, lock] of [
    ['parent', `select id from public.classrooms where id='${classroom}' for update`],
    ['source', `select id from public.lesson_plans where classroom_id='${classroom}' and date='${from}' for update`],
    ['destination', `select id from public.lesson_plans where classroom_id='${classroom}' and date='${to}' for update`],
  ]) {
    const holder = new Session(`${label}_holder`)
    await holder.run(`begin; ${lock};`)
    try {
      const before = state()
      assert.throws(() => sql(`begin; ${serviceCopy()} commit;`), /PT409/)
      const response = await fetch(`${status.API_URL}/rest/v1/rpc/copy_lesson_plan_for_owner_v1`, {
        method: 'POST', headers: { apikey: status.SERVICE_ROLE_KEY, Authorization: `Bearer ${status.SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_actor_id: student, p_classroom_id: classroom, p_from_date: from, p_to_date: to }),
        signal: AbortSignal.timeout(5000),
      })
      assert.equal(response.status, 409)
      assert.equal((await response.json()).code, 'PT409')
      assert.match(execFileSync('pnpm', ['exec', 'tsx', 'scripts/check-contextual-lesson-plan-copy-sdk.ts',
        student, outsider, classroom, from, to, ...(label === 'parent' ? ['conflict-only'] : [])], {
        encoding: 'utf8', timeout: 20_000,
      }), /PASS live copy SDK/)
      assert.deepEqual(state(), before)
    } finally { await holder.close() }
  }
  for (const [label, writer] of [
    ['date', save(from, 'Date writer first', student, classroom, 2)],
    ['bulk', `select public.save_lesson_plans_for_owner_v1('${student}','${classroom}',
      '${JSON.stringify([{ date: from, content_markdown: 'Bulk writer first', content: document('Bulk writer first') }])}'::jsonb,
      array[]::date[],null,null);`],
    ['direct', `update public.lesson_plans set content_markdown='Direct writer first',
      content='${JSON.stringify(document('Direct writer first'))}'::jsonb where classroom_id='${classroom}' and date='${from}';`],
  ]) {
    const holder = new Session(`${label}_first`)
    const copier = new Session(`copy_after_${label}`)
    await holder.run(`begin; set local role service_role; ${writer}`)
    const pending = copier.run(`begin; ${serviceCopy()}`)
    await blocked(copier, holder)
    await holder.run('commit;')
    const copied = JSON.parse(await pending).lesson_plan
    await copier.run('commit;')
    assert.deepEqual(copied.content, plan(classroom, from).content)
    assert.equal(copied.content_markdown, plan(classroom, from).content_markdown)
    await holder.close(); await copier.close()
    const copyFirst = new Session(`copy_before_${label}`)
    const writerAfter = new Session(`${label}_after`)
    const copiedBefore = JSON.parse(await copyFirst.run(`begin; ${serviceCopy()}`)).lesson_plan
    const laterWrite = writerAfter.run(`begin; set local role service_role; ${writer}`)
    await blocked(writerAfter, copyFirst)
    await copyFirst.run('commit;')
    await laterWrite; await writerAfter.run('commit;')
    assert.deepEqual(plan(classroom, to).content, copiedBefore.content)
    await copyFirst.close(); await writerAfter.close()
  }
  for (const date of [from, to]) {
    const deletion = new Session(`delete_${date}_first`)
    const copier = new Session(`copy_after_delete_${date}`)
    const oldDestination = plan(classroom, to)
    await deletion.run(`begin; delete from public.lesson_plans where classroom_id='${classroom}' and date='${date}';`)
    const pending = copier.run(`begin; ${serviceCopy()}`)
    const expectedMissing = date === from ? assert.rejects(pending, /PT404/) : null
    await blocked(copier, deletion)
    await deletion.run('commit;')
    const afterDelete = state()
    if (expectedMissing) {
      await expectedMissing
      assert.deepEqual(state(), afterDelete, 'Missing source changed the committed deletion state')
      assert.deepEqual(plan(classroom, to), oldDestination)
      sql(`begin; set local role service_role; ${save(from, 'Source restored after deletion')} commit;`)
    } else {
      const newDestination = JSON.parse(await pending).lesson_plan
      await copier.run('commit;')
      assert.notEqual(newDestination.id, oldDestination.id)
      assert.deepEqual(newDestination.content, plan(classroom, from).content)
      assert.deepEqual(state().heads, afterDelete.heads)
    }
    await deletion.close(); await copier.close()
  }
  sql(`delete from public.lesson_plans where classroom_id='${classroom}' and date='${fresh}';`)
  const insertedFirst = new Session('fresh_insert_first')
  const copyAfterInsert = new Session('copy_after_fresh_insert')
  await insertedFirst.run(`begin; insert into public.lesson_plans(classroom_id,date,content,content_markdown)
    values('${classroom}','${fresh}','${JSON.stringify(document('Fresh legacy insert'))}'::jsonb,'Fresh legacy insert');`)
  const pendingInsertCopy = copyAfterInsert.run(`begin; ${serviceCopy(student, classroom, from, fresh)}`)
  await blocked(copyAfterInsert, insertedFirst)
  await insertedFirst.run('commit;')
  const legacyIdentity = plan(classroom, fresh).id
  const afterInsertCopy = JSON.parse(await pendingInsertCopy).lesson_plan
  await copyAfterInsert.run('commit;')
  assert.equal(afterInsertCopy.id, legacyIdentity)
  assert.deepEqual(afterInsertCopy.content, plan(classroom, from).content)
  await insertedFirst.close(); await copyAfterInsert.close()
  sql(`delete from public.lesson_plans where classroom_id='${classroom}' and date='${fresh}';`)
  const copyBeforeInsert = new Session('copy_before_fresh_insert')
  const upsertAfter = new Session('fresh_upsert_after_copy')
  const copiedFresh = JSON.parse(await copyBeforeInsert.run(`begin; ${serviceCopy(student, classroom, from, fresh)}`)).lesson_plan
  const pendingUpsert = upsertAfter.run(`begin; insert into public.lesson_plans(classroom_id,date,content,content_markdown)
    values('${classroom}','${fresh}','${JSON.stringify(document('Legacy upsert after copy'))}'::jsonb,'Legacy upsert after copy')
    on conflict(classroom_id,date) do update set content=excluded.content,content_markdown=excluded.content_markdown;`)
  await blocked(upsertAfter, copyBeforeInsert)
  await copyBeforeInsert.run('commit;'); await pendingUpsert; await upsertAfter.run('commit;')
  assert.equal(plan(classroom, fresh).id, copiedFresh.id)
  assert.equal(plan(classroom, fresh).content_markdown, 'Legacy upsert after copy')
  await copyBeforeInsert.close(); await upsertAfter.close()
  const firstCopy = new Session('reverse_first')
  const reverseCopy = new Session('reverse_second')
  await firstCopy.run(`begin; ${serviceCopy()}`)
  const reversed = reverseCopy.run(`begin; ${serviceCopy(student, classroom, to, from)}`)
  await blocked(reverseCopy, firstCopy)
  await firstCopy.run('commit;')
  assert.equal(JSON.parse(await reversed).lesson_plan.date, from)
  await reverseCopy.run('commit;')
  await firstCopy.close(); await reverseCopy.close()

  for (const [label, update, restore] of [
    ['transfer', `teacher_id='${teacher}'`, `teacher_id='${student}'`],
    ['archive', 'archived_at=clock_timestamp()', 'archived_at=null'],
  ]) {
    const lifecycle = new Session(`${label}_first`)
    const copier = new Session(`${label}_denied`)
    const before = state()
    await lifecycle.run(`begin; update public.classrooms set ${update} where id='${classroom}';`)
    const pending = copier.run(`begin; ${serviceCopy()}`)
    const denied = assert.rejects(pending, /42501/)
    await blocked(copier, lifecycle)
    await lifecycle.run('commit;'); await denied
    assert.deepEqual(state().plans, before.plans)
    assert.deepEqual(state().heads, before.heads)
    await lifecycle.close(); await copier.close()
    sql(`update public.classrooms set ${restore} where id='${classroom}';`)
    const copyFirst = new Session(`${label}_copy_first`)
    const changeAfter = new Session(`${label}_after`)
    await copyFirst.run(`begin; ${serviceCopy()}`)
    const changed = changeAfter.run(`begin; update public.classrooms set ${update} where id='${classroom}'; select 'changed';`)
    await blocked(changeAfter, copyFirst)
    await copyFirst.run('commit;')
    assert.equal(await changed, 'changed'); await changeAfter.run('commit;')
    await copyFirst.close(); await changeAfter.close()
    sql(`update public.classrooms set ${restore} where id='${classroom}';`)
  }
  sql(`begin;
    insert into public.course_blueprints(id,teacher_id,title) values('${blueprint}','${student}','${tag} blueprint');
    insert into public.course_blueprint_versions(id,course_blueprint_id,version_number,source_draft_revision,snapshot_json,snapshot_sha256,created_by)
      select '${version}',id,1,content_revision,'{}'::jsonb,repeat('a',64),teacher_id from public.course_blueprints where id='${blueprint}';
    update public.lesson_plans set source_artifact_id='${lineage}',source_blueprint_version_id='${version}'
      where classroom_id='${classroom}' and date='${to}';
    commit;`)
  const linked = plan(classroom, to)
  const linkedCopy = result(serviceCopy()).lesson_plan
  for (const key of ['id', 'artifact_id', 'created_at', 'source_artifact_id', 'source_blueprint_version_id', 'blueprint_archived_at']) {
    assert.equal(linkedCopy[key], linked[key])
  }
  sql(`update public.lesson_plans set source_artifact_id='${sourceLineage}',source_blueprint_version_id='${version}'
    where classroom_id='${classroom}' and date='${from}';`)
  const linkedSource = plan(classroom, from)
  const unlinkedDestination = result(serviceCopy(student, classroom, from, spare)).lesson_plan
  assert.equal(unlinkedDestination.source_artifact_id, null)
  assert.equal(unlinkedDestination.source_blueprint_version_id, null)
  assert.deepEqual(plan(classroom, from), linkedSource)
  // Fault injection is rollback-only and bound exclusively to this random fixture.
  // It is NOT a claim that ordinary content-only copy hits the Blueprint purge guard.
  const beforeFailure = state()
  sql(`begin;
    create function pg_temp.reject_fixture_copy() returns trigger language plpgsql as $fault$
    begin
      if new.classroom_id='${classroom}'::uuid and new.date='${to}'::date then
        raise exception using errcode='55000',message='Synthetic late copy failure';
      end if;
      return new;
    end; $fault$;
    create trigger zz_${tag}_failure after update on public.lesson_plans
      for each row execute function pg_temp.reject_fixture_copy();
    do $proof$ declare before_state jsonb; after_state jsonb; begin
      select jsonb_build_object(
        'plans',(select jsonb_agg(to_jsonb(p) order by p.date) from public.lesson_plans p where classroom_id='${classroom}'),
        'heads',(select jsonb_agg(to_jsonb(h) order by h.date,h.client_id) from public.lesson_plan_mutation_heads h where classroom_id='${classroom}'),
        'archive',(select revision from public.classroom_archive_revisions where classroom_id='${classroom}'),
        'blueprint',(select blueprint_source_revision from public.classrooms where id='${classroom}')
      ) into before_state;
      begin perform public.copy_lesson_plan_for_owner_v1('${student}','${classroom}','${from}','${to}');
        raise exception 'Expected synthetic late copy failure';
      exception when sqlstate 'PT409' then null; end;
      select jsonb_build_object(
        'plans',(select jsonb_agg(to_jsonb(p) order by p.date) from public.lesson_plans p where classroom_id='${classroom}'),
        'heads',(select jsonb_agg(to_jsonb(h) order by h.date,h.client_id) from public.lesson_plan_mutation_heads h where classroom_id='${classroom}'),
        'archive',(select revision from public.classroom_archive_revisions where classroom_id='${classroom}'),
        'blueprint',(select blueprint_source_revision from public.classrooms where id='${classroom}')
      ) into after_state;
      if before_state is distinct from after_state then raise exception 'Copy failed to roll back inside transaction'; end if;
    end; $proof$;
    rollback;`)
  assert.deepEqual(state(), beforeFailure, 'Late trigger failure changed plans, heads or revisions')
  sql(`begin;
    insert into public.classroom_purge_operations(id,teacher_id,classroom_id,classroom_title,request_sha256,status,source_revision,impact_summary,retryable,error_code)
      select '${purge}','${student}',c.id,c.title,repeat('9',64),'failed',r.revision,'{}'::jsonb,true,'database_finalize_failed'
      from public.classrooms c join public.classroom_archive_revisions r on r.classroom_id=c.id where c.id='${classroom}';
    insert into public.classroom_purge_fences(classroom_id,operation_id,teacher_id) values('${classroom}','${purge}','${student}'); commit;`)
  const fenced = state()
  assert.throws(() => sql(`begin; ${serviceCopy()} commit;`), /PT409/)
  assert.deepEqual(state(), fenced)
  console.log('PASS migration 229 copy owner, content, identity, ordering, lifecycle, contention and rollback contracts')
} finally {
  const cleanup = observer.closed ? new Session('cleanup') : observer
  try {
    await Promise.allSettled(sessions.filter((session) => session !== cleanup).map((session) => session.close()))
    sql(`begin;
      create temp table copy_audit_cleanup_ops(operation_id uuid,subject_user_id uuid,primary key(operation_id,subject_user_id)) on commit drop;
      insert into copy_audit_cleanup_ops select audit.operation_id,audit.subject_user_id
        from public.account_plan_audit audit join public.users fixture on fixture.id=audit.subject_user_id
        where audit.actor_ref='system:user-provisioning' and audit.reason_code='default_free_account_provisioning'
          and ((fixture.id='${student}' and fixture.email='${tag}_student@example.invalid')
            or (fixture.id='${teacher}' and fixture.email='${tag}_teacher@example.invalid')
            or (fixture.id='${outsider}' and fixture.email='${tag}_outsider@example.invalid'));
      delete from public.classroom_purge_fences where classroom_id='${classroom}' and operation_id='${purge}' and teacher_id='${student}';
      delete from public.classroom_purge_operations where id='${purge}' and classroom_id='${classroom}' and teacher_id='${student}' and status='failed';
      delete from public.effective_feature_entitlement_audit audit using (values ${entitlementValues}) fixture(operation_id,u)
        where audit.operation_id=fixture.operation_id and audit.subject_user_id=fixture.u and audit.actor_ref='test:229'
          and audit.reason_code='${tag}' and audit.feature_key='classrooms.create'
          and exists(select 1 from public.users owner where owner.id=fixture.u
            and owner.email in ('${tag}_student@example.invalid','${tag}_teacher@example.invalid'));
      delete from public.effective_feature_entitlement_audit audit using copy_audit_cleanup_ops operation
        where audit.operation_id=operation.operation_id and audit.subject_user_id=operation.subject_user_id
          and audit.actor_ref='system:user-provisioning' and audit.reason_code='default_free_account_provisioning' and audit.feature_key='classrooms.create';
      delete from public.account_plan_audit audit using copy_audit_cleanup_ops operation
        where audit.operation_id=operation.operation_id and audit.subject_user_id=operation.subject_user_id
          and audit.actor_ref='system:user-provisioning' and audit.reason_code='default_free_account_provisioning';
      delete from public.classrooms where (id='${classroom}' and title='${tag} student' and class_code='${tag}_s')
        or (id='${teacherClassroom}' and title='${tag} teacher' and class_code='${tag}_t');
      delete from public.users where (id='${student}' and email='${tag}_student@example.invalid')
        or (id='${teacher}' and email='${tag}_teacher@example.invalid') or (id='${outsider}' and email='${tag}_outsider@example.invalid');
      commit;`)
    assert.equal(sql(`select
      (select count(*) from public.classrooms where id in ('${classroom}','${teacherClassroom}'))+
      (select count(*) from public.lesson_plans where classroom_id in ('${classroom}','${teacherClassroom}'))+
      (select count(*) from public.lesson_plan_mutation_heads where classroom_id in ('${classroom}','${teacherClassroom}'))+
      (select count(*) from public.classroom_archive_revisions where classroom_id in ('${classroom}','${teacherClassroom}'))+
      (select count(*) from public.course_blueprints where id='${blueprint}')+
      (select count(*) from public.course_blueprint_versions where id='${version}')+
      (select count(*) from public.classroom_purge_operations where id='${purge}')+
      (select count(*) from public.classroom_purge_fences where operation_id='${purge}')+
      (select count(*) from public.users where id in ('${student}','${teacher}','${outsider}'))+
      (select count(*) from public.account_plans where subject_user_id in ('${student}','${teacher}','${outsider}'))+
      (select count(*) from public.account_plan_audit where subject_user_id in ('${student}','${teacher}','${outsider}'))+
      (select count(*) from public.effective_feature_entitlements where subject_user_id in ('${student}','${teacher}','${outsider}'))+
      (select count(*) from public.effective_feature_entitlement_audit where subject_user_id in ('${student}','${teacher}','${outsider}'));
    `), '0')
    console.log('PASS exact synthetic fixture cleanup with zero residual rows')
  } finally { await cleanup.close() }
}
