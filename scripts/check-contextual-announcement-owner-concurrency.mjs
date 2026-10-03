#!/usr/bin/env node
// Local random fixtures only; requires separately reviewed/applied migration232.
// Never applies schema, seeds, resets, activates cohorts or targets production.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

const container = 'supabase_db_pika'
assert.equal(execFileSync('docker', ['inspect', container, '--format', '{{ index .Config.Labels "com.supabase.cli.project" }}'], { encoding: 'utf8' }).trim(), 'pika')
assert.match(execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' }), /:54322\s*$/m)
const tag = `ann_write_${randomUUID().slice(0, 8)}`
const owner = randomUUID(), teacher = randomUUID(), outsider = randomUUID(), member = randomUUID()
const classroom = randomUUID(), teacherClassroom = randomUUID()
const deletedClassroom = randomUUID(), deletedAnnouncement = randomUUID()
const announcement = randomUUID(), otherAnnouncement = randomUUID()
const entitlementPairs = [owner, teacher].map(subject => ({ subject, operation: randomUUID() }))
const entitlementValues = entitlementPairs.map(({ subject, operation }) => `('${operation}'::uuid,'${subject}'::uuid)`).join(',')
const quote = value => `'${String(value).replaceAll("'", "''")}'`
const sessions = []
function sql(statement) {
  return execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-XqAt',
    '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], {
    input: `set statement_timeout='30s'; set lock_timeout='4s'; ${statement}`, encoding: 'utf8', timeout: 35_000,
  }).trim()
}
assert.equal(sql("select exists(select 1 from supabase_migrations.schema_migrations where version='232');"), 't', 'Apply only separately approved migration232 before this harness')
function create(actor = owner, target = classroom, schedule = 'null') {
  return `select public.create_announcement_for_owner_v1('${actor}','${target}','Created',false,${schedule},null)::text;`
}
function patch(actor = owner, target = classroom, id = announcement, body = { content: 'Changed' }) {
  return `select public.update_announcement_for_owner_v1('${actor}','${target}','${id}',${quote(JSON.stringify(body))}::jsonb)::text;`
}
function remove(actor = owner, target = classroom, id = announcement) {
  return `select public.delete_announcement_for_owner_v1('${actor}','${target}','${id}')::text;`
}
const service = statement => `set local role service_role; ${statement}`
function state() {
  return JSON.parse(sql(`select jsonb_build_object(
    'announcements',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from public.announcements a where classroom_id in ('${classroom}','${teacherClassroom}')),
    'reads',(select coalesce(jsonb_agg(to_jsonb(r) order by id),'[]'::jsonb) from public.announcement_reads r where announcement_id in ('${announcement}','${otherAnnouncement}')),
    'revisions',(select jsonb_agg(to_jsonb(r) order by classroom_id) from public.classroom_archive_revisions r where classroom_id in ('${classroom}','${teacherClassroom}'))
  );`))
}
class Session {
  constructor(name) {
    this.name = `${tag}_${name}`; this.output = ''; this.errors = ''; this.pending = null; this.closed = false
    this.child = spawn('docker', ['exec', '-i', '-e', `PGAPPNAME=${this.name}`, container, 'psql', '-U', 'postgres', '-d', 'postgres', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'])
    this.child.stdout.on('data', chunk => {
      this.output += chunk.toString()
      if (this.pending && this.output.includes(this.pending.marker)) {
        const pending = this.pending; this.pending = null; clearTimeout(pending.timer)
        pending.resolve(this.output.slice(0, this.output.indexOf(pending.marker)).trim())
      }
    })
    this.child.stderr.on('data', chunk => { this.errors += chunk.toString() })
    this.child.stdin.on('error', error => this.fail(error))
    this.child.on('error', error => this.fail(error))
    this.done = new Promise(resolve => this.child.on('close', code => {
      this.closed = true; this.fail(new Error(`${this.name} exited ${code}: ${this.errors}`)); resolve()
    }))
    sessions.push(this)
  }
  fail(error) { if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = null } }
  run(statement) {
    assert(!this.pending && !this.closed)
    this.output = ''; this.errors = ''; const marker = `done_${randomUUID()}`
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
    try { await Promise.race([this.done, new Promise((_, reject) => { bound = setTimeout(() => reject(new Error('Session close timeout')), 10_000) })]) }
    finally { clearTimeout(force); clearTimeout(hard); clearTimeout(bound) }
  }
}
const observer = new Session('observer')
async function blocked(waiter, holder) {
  for (let i = 0; i < 100; i += 1) {
    if (await observer.run(`select exists(select 1 from pg_stat_activity w,pg_stat_activity h where w.application_name='${waiter.name}' and h.application_name='${holder.name}' and w.wait_event_type='Lock' and h.pid=any(pg_blocking_pids(w.pid)));`) === 't') return
    assert(waiter.pending, 'Contender finished before expected lock wait'); await delay(30)
  }
  throw new Error('Expected blocker evidence not observed')
}
function restoreAnnouncement(target = classroom, id = announcement, author = owner) {
  sql(`insert into public.announcements(id,classroom_id,created_by,content,is_draft,published_at)
    values('${id}','${target}','${author}','Original',false,'2020-01-01T00:00:00Z')
    on conflict(id) do update set classroom_id=excluded.classroom_id,content=excluded.content;
    insert into public.announcement_reads(announcement_id,user_id) values('${id}','${member}') on conflict(announcement_id,user_id) do nothing;`)
}
try {
  sql(`begin;
    insert into public.users(id,email,role) values
      ('${owner}','${tag}_owner@example.invalid','student'),('${teacher}','${tag}_teacher@example.invalid','teacher'),
      ('${outsider}','${tag}_outsider@example.invalid','teacher'),('${member}','${tag}_member@example.invalid','teacher');
    set local role service_role;
    select public.set_effective_feature_entitlement_v1(operation,u,'classrooms.create','manual',true,clock_timestamp(),null,2,'test:232','${tag}',
      coalesce((select revision from public.effective_feature_entitlements where subject_user_id=u and feature_key='classrooms.create'),0))
      from (values ${entitlementValues}) fixture(operation,u);
    reset role;
    insert into public.classrooms(id,teacher_id,title,class_code) values
      ('${classroom}','${owner}','${tag} owner','${tag}_o'),('${teacherClassroom}','${teacher}','${tag} teacher','${tag}_t');
    insert into public.classroom_enrollments(classroom_id,student_id) values('${classroom}','${member}'); commit;`)
  restoreAnnouncement(); restoreAnnouncement(teacherClassroom, otherAnnouncement, teacher)
  if (process.argv.includes('--verify-cleanup-after-fixture')) throw new Error('Forced post-fixture cleanup proof')
  for (const [actor, target, id] of [[owner, classroom, announcement], [teacher, teacherClassroom, otherAnnouncement]]) {
    assert.match(execFileSync('pnpm', ['exec', 'tsx', 'scripts/check-contextual-announcement-owner-sdk.ts', actor, outsider, target, id], { encoding: 'utf8', timeout: 25_000 }), /PASS live announcement SDK create/)
  }
  for (const role of ['anon', 'authenticated']) for (const signature of [
    'create_announcement_for_owner_v1(uuid,uuid,text,boolean,timestamptz,text)',
    'update_announcement_for_owner_v1(uuid,uuid,uuid,jsonb)', 'delete_announcement_for_owner_v1(uuid,uuid,uuid)',
  ]) assert.equal(sql(`select has_function_privilege('${role}','public.${signature}','execute');`), 'f')
  for (const statement of [create(member), patch(member), remove(member)]) assert.throws(() => sql(`begin; ${service(statement)} commit;`), /42501/)
  for (const [label, lock] of [['parent', `select id from public.classrooms where id='${classroom}' for update;`],
    ['resource', `select id from public.announcements where id='${announcement}' for update;`]]) {
    const holder = new Session(`${label}_holder`)
    await holder.run(`begin; ${lock}`)
    try {
      const before = state()
      for (const statement of [patch(), remove(), ...(label === 'parent' ? [create()] : [])]) assert.throws(() => sql(`begin; ${service(statement)} commit;`), /PT409/)
      if (label === 'parent') assert.match(execFileSync('pnpm', ['exec', 'tsx', 'scripts/check-contextual-announcement-owner-sdk.ts', owner, outsider, classroom, announcement, 'conflict'], { encoding: 'utf8', timeout: 25_000 }), /PASS live announcement SDK strict/)
      assert.deepEqual(state(), before)
    } finally { await holder.close() }
  }
  // Lifecycle first: wait on the operation fence, then authorize committed state.
  for (const [label, update, restore] of [['transfer', `teacher_id='${teacher}'`, `teacher_id='${owner}'`],
    ['archive', 'archived_at=clock_timestamp()', 'archived_at=null']]) {
    for (const [operation, statement] of [['create', create()], ['patch', patch()], ['delete', remove()]]) {
      const lifecycle = new Session(`${label}_${operation}_first`), writer = new Session(`${operation}_after_${label}`)
      const before = state()
      await lifecycle.run(`begin; update public.classrooms set ${update} where id='${classroom}';`)
      const pending = writer.run(`begin; ${service(statement)}`), denied = assert.rejects(pending, /42501/)
      await blocked(writer, lifecycle); await lifecycle.run('commit;'); await denied
      assert.deepEqual(state().announcements, before.announcements)
      assert.deepEqual(state().reads, before.reads)
      await lifecycle.close(); await writer.close()
      sql(`update public.classrooms set ${restore} where id='${classroom}';`)
      // RPC first: lifecycle cannot advance until the admitted mutation commits.
      const first = new Session(`${operation}_before_${label}`), later = new Session(`${label}_after_${operation}`)
      await first.run(`begin; ${service(statement)}`)
      const changed = later.run(`begin; update public.classrooms set ${update} where id='${classroom}';`)
      await blocked(later, first); await first.run('commit;'); await changed; await later.run('commit;')
      await first.close(); await later.close(); sql(`update public.classrooms set ${restore} where id='${classroom}';`)
      restoreAnnouncement()
    }
  }
  // Legacy resource DML first; its trigger owns the shared classroom fence.
  for (const [label, statement, code] of [
    ['rebind', `update public.announcements set classroom_id='${teacherClassroom}' where id='${announcement}';`, /PT404/],
    ['delete', `delete from public.announcements where id='${announcement}';`, /PT404/],
    ['edit', `update public.announcements set content='Legacy edit' where id='${announcement}';`, null],
  ]) {
    restoreAnnouncement()
    const legacy = new Session(`${label}_first`), writer = new Session(`patch_after_${label}`)
    await legacy.run(`begin; ${statement}`)
    const pending = writer.run(`begin; ${service(patch())}`), denied = code ? assert.rejects(pending, code) : null
    await blocked(writer, legacy); await legacy.run('commit;')
    if (denied) await denied
    else { assert.equal(JSON.parse(await pending).announcement.content, 'Changed'); await writer.run('commit;') }
    await legacy.close(); await writer.close()
    restoreAnnouncement()
  }
  // Two contextual operations serialize publication against the actual locked row.
  for (const [label, second] of [['patch', patch(owner, classroom, announcement, { title: 'Second' })], ['delete', remove()]]) {
    restoreAnnouncement()
    const first = new Session(`patch_before_${label}`), next = new Session(`${label}_after_patch`)
    await first.run(`begin; ${service(patch(owner, classroom, announcement, { is_draft: true }))}`)
    const pending = next.run(`begin; ${service(second)}`)
    await blocked(next, first); await first.run('commit;')
    const result = JSON.parse(await pending); await next.run('commit;')
    if (label === 'patch') { assert.equal(result.announcement.is_draft, true); assert.equal(result.announcement.published_at, null) }
    else assert.equal(result.deleted, true)
    await first.close(); await next.close()
  }
  // Whole-class deletion, both orders, with a separately tagged synthetic class.
  for (const [label, statement] of [['create', create(owner, deletedClassroom)],
    ['patch', patch(owner, deletedClassroom, deletedAnnouncement)],
    ['delete', remove(owner, deletedClassroom, deletedAnnouncement)]]) {
    const install = () => sql(`insert into public.classrooms(id,teacher_id,title,class_code)
      values('${deletedClassroom}','${owner}','${tag} deletion','${tag}_d');
      insert into public.announcements(id,classroom_id,created_by,content,is_draft,published_at)
      values('${deletedAnnouncement}','${deletedClassroom}','${owner}','Original',false,clock_timestamp());`)
    install()
    const deletion = new Session(`class_delete_before_${label}`), writer = new Session(`${label}_after_class_delete`)
    await deletion.run(`begin; delete from public.classrooms where id='${deletedClassroom}';`)
    const pending = writer.run(`begin; ${service(statement)}`), denied = assert.rejects(pending, /P0002/)
    await blocked(writer, deletion); await deletion.run('commit;'); await denied
    await deletion.close(); await writer.close()
    assert.equal(sql(`select count(*) from public.announcements where classroom_id='${deletedClassroom}';`), '0')
    install()
    const first = new Session(`${label}_before_class_delete`), last = new Session(`class_delete_after_${label}`)
    await first.run(`begin; ${service(statement)}`)
    const removed = last.run(`begin; delete from public.classrooms where id='${deletedClassroom}';`)
    await blocked(last, first); await first.run('commit;'); await removed; await last.run('commit;')
    await first.close(); await last.close()
    assert.equal(sql(`select count(*) from public.announcements where classroom_id='${deletedClassroom}';`), '0')
  }
  restoreAnnouncement()
  // Accepted schedule may cross its boundary during an operation-fence wait.
  const fence = new Session('schedule_fence'), scheduled = new Session('schedule_after_wait')
  await fence.run(`begin; select pg_advisory_xact_lock(hashtextextended('pika-classroom-operation:${classroom}',0));`)
  const due = new Date(Date.now() + 250).toISOString()
  const scheduledWrite = scheduled.run(`begin; ${service(create(owner, classroom, quote(due)))}`)
  await blocked(scheduled, fence); await delay(300); await fence.run('commit;')
  assert.equal(Date.parse(JSON.parse(await scheduledWrite).announcement.scheduled_for), Date.parse(due))
  await scheduled.run('commit;'); await fence.close(); await scheduled.close()
  // Rollback-only fault trigger proves receipts and revision rollback before outer rollback.
  const beforeFault = state()
  sql(`begin;
    create function pg_temp.reject_fixture_announcement() returns trigger language plpgsql as $fault$
    begin if old.id='${announcement}'::uuid then raise exception using errcode='55000',message='Synthetic late failure'; end if; return old; end; $fault$;
    create trigger zz_${tag}_failure after delete on public.announcements for each row execute function pg_temp.reject_fixture_announcement();
    do $proof$ declare before_state jsonb; after_state jsonb; begin
      select jsonb_build_object('row',(select to_jsonb(a) from public.announcements a where id='${announcement}'),
        'reads',(select jsonb_agg(to_jsonb(r)) from public.announcement_reads r where announcement_id='${announcement}'),
        'revision',(select revision from public.classroom_archive_revisions where classroom_id='${classroom}')) into before_state;
      begin perform public.delete_announcement_for_owner_v1('${owner}','${classroom}','${announcement}');
        raise exception 'Expected late failure'; exception when sqlstate 'PT409' then null; end;
      select jsonb_build_object('row',(select to_jsonb(a) from public.announcements a where id='${announcement}'),
        'reads',(select jsonb_agg(to_jsonb(r)) from public.announcement_reads r where announcement_id='${announcement}'),
        'revision',(select revision from public.classroom_archive_revisions where classroom_id='${classroom}')) into after_state;
      if before_state is distinct from after_state then raise exception 'Late failure committed row/receipt/revision changes'; end if;
    end; $proof$; rollback;`)
  assert.deepEqual(state(), beforeFault)
  console.log('PASS announcement owner cross-role SDK, lifecycle/resource races, contention, schedule wait and rollback contracts')
} finally {
  await Promise.allSettled(sessions.map(session => session.close()))
  sql(`begin;
    create temp table ann_write_provision_ops(operation_id uuid,subject_user_id uuid,primary key(operation_id,subject_user_id)) on commit drop;
    insert into ann_write_provision_ops select audit.operation_id,audit.subject_user_id from public.account_plan_audit audit join public.users fixture on fixture.id=audit.subject_user_id
      where fixture.id in ('${owner}','${teacher}','${member}','${outsider}') and fixture.email in ('${tag}_owner@example.invalid','${tag}_teacher@example.invalid','${tag}_member@example.invalid','${tag}_outsider@example.invalid')
        and audit.actor_ref='system:user-provisioning' and audit.reason_code='default_free_account_provisioning';
    delete from public.effective_feature_entitlement_audit audit using (values ${entitlementValues}) fixture(operation,u)
      where audit.operation_id=fixture.operation and audit.subject_user_id=fixture.u and audit.actor_ref='test:232' and audit.reason_code='${tag}' and audit.feature_key='classrooms.create';
    delete from public.effective_feature_entitlement_audit audit using ann_write_provision_ops operation
      where audit.operation_id=operation.operation_id and audit.subject_user_id=operation.subject_user_id and audit.actor_ref='system:user-provisioning' and audit.reason_code='default_free_account_provisioning' and audit.feature_key='classrooms.create';
    delete from public.account_plan_audit audit using ann_write_provision_ops operation
      where audit.operation_id=operation.operation_id and audit.subject_user_id=operation.subject_user_id and audit.actor_ref='system:user-provisioning' and audit.reason_code='default_free_account_provisioning';
    delete from public.classrooms where (id='${classroom}' and teacher_id in ('${owner}','${teacher}') and title='${tag} owner' and class_code='${tag}_o')
      or (id='${teacherClassroom}' and teacher_id='${teacher}' and title='${tag} teacher' and class_code='${tag}_t')
      or (id='${deletedClassroom}' and teacher_id='${owner}' and title='${tag} deletion' and class_code='${tag}_d');
    delete from public.users where (id='${owner}' and email='${tag}_owner@example.invalid') or (id='${teacher}' and email='${tag}_teacher@example.invalid')
      or (id='${member}' and email='${tag}_member@example.invalid') or (id='${outsider}' and email='${tag}_outsider@example.invalid'); commit;`)
  assert.equal(sql(`select (select count(*) from public.users where id in ('${owner}','${teacher}','${member}','${outsider}'))+
    (select count(*) from public.classrooms where id in ('${classroom}','${teacherClassroom}','${deletedClassroom}'))+
    (select count(*) from public.announcements where classroom_id in ('${classroom}','${teacherClassroom}','${deletedClassroom}'))+
    (select count(*) from public.announcement_reads where announcement_id in ('${announcement}','${otherAnnouncement}','${deletedAnnouncement}'))+
    (select count(*) from public.classroom_archive_revisions where classroom_id in ('${classroom}','${teacherClassroom}','${deletedClassroom}'))+
    (select count(*) from public.account_plans where subject_user_id in ('${owner}','${teacher}','${member}','${outsider}'))+
    (select count(*) from public.account_plan_audit where subject_user_id in ('${owner}','${teacher}','${member}','${outsider}'))+
    (select count(*) from public.effective_feature_entitlements where subject_user_id in ('${owner}','${teacher}','${member}','${outsider}'))+
    (select count(*) from public.effective_feature_entitlement_audit where subject_user_id in ('${owner}','${teacher}','${member}','${outsider}'));`), '0')
  console.log('PASS exact synthetic announcement fixture cleanup with zero residual rows')
}
