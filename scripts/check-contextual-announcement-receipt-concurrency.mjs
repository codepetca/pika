#!/usr/bin/env node
// Local random fixtures only. Requires separately reviewed and installed migration 233.
// Never applies schema, resets a database, activates admission, or targets production.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

const container = 'supabase_db_pika'
assert.equal(execFileSync('docker', ['inspect', container, '--format', '{{ index .Config.Labels "com.supabase.cli.project" }}'], { encoding: 'utf8' }).trim(), 'pika')
assert.match(execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' }), /:54322\s*$/m)
const tag = `ann_receipt_${randomUUID().slice(0, 8)}`
const owner = randomUUID(), member = randomUUID(), nextOwner = randomUUID(), outsider = randomUUID()
const classroom = randomUUID(), otherClassroom = randomUUID(), deletedClassroom = randomUUID()
const announcement = randomUUID(), scheduled = randomUUID(), draft = randomUUID(), foreign = randomUUID(), deletedAnnouncement = randomUUID()
const entitlementPairs = [owner, member, nextOwner].map(subject => ({ subject, operation: randomUUID() }))
const identities = [[owner, 'owner'], [member, 'member'], [nextOwner, 'next_owner'], [outsider, 'outsider']]
const classes = [[classroom, 'primary', owner], [otherClassroom, 'other', nextOwner], [deletedClassroom, 'deletion', owner]]
const q = value => `'${String(value).replaceAll("'", "''")}'`
const idList = values => values.map(q).join(',')
const entitlementValues = entitlementPairs.map(({ subject, operation }) => `(${q(operation)}::uuid,${q(subject)}::uuid)`).join(',')
const identityValues = identities.map(([id, label]) => `(${q(id)}::uuid,${q(`${tag}_${label}@example.invalid`)})`).join(',')
const sessions = []
function sql(statement) {
  return execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-XqAt',
    '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], {
    input: `set statement_timeout='45s'; set lock_timeout='8s'; ${statement}`,
    encoding: 'utf8', timeout: 50_000, maxBuffer: 5_000_000,
  }).trim()
}
assert.equal(sql("select exists(select 1 from supabase_migrations.schema_migrations where version='233');"), 't',
  'Install only separately reviewed migration 233 before running the fixture harness')
assert.equal(sql("select to_regprocedure('public.mark_announcements_read_for_member_v1(uuid,uuid,timestamptz)') is not null;"), 't')
function mark(target = classroom, actor = member, cutoff = '2030-01-01T00:00:00Z') {
  return `select public.mark_announcements_read_for_member_v1(${q(actor)},${q(target)},${q(cutoff)})::text;`
}
const service = statement => `set local role service_role; ${statement}`
function result(raw, marked, inserted, target = classroom, actor = member) {
  assert.deepEqual(JSON.parse(raw), { actor_id: actor, classroom_id: target, marked, inserted })
}
function receiptCount(id = announcement, actor = member) {
  return Number(sql(`select count(*) from public.announcement_reads where announcement_id=${q(id)} and user_id=${q(actor)};`))
}
function receiptState() {
  return JSON.parse(sql(`select coalesce(jsonb_agg(to_jsonb(r) order by announcement_id,user_id),'[]'::jsonb)
    from public.announcement_reads r where announcement_id in (${idList([announcement, scheduled, draft, foreign, deletedAnnouncement])});`))
}
function assertReceipts(ids, actor = member) {
  const values = ids.length ? `array[${ids.map(id => `${q(id)}::uuid`).join(',')}]` : `'{}'::uuid[]`
  assert.equal(sql(`select count(*) from unnest(${values}) eligible(id) where not exists(
    select 1 from public.announcement_reads receipt where receipt.announcement_id=eligible.id and receipt.user_id=${q(actor)});`), '0')
  assert.equal(sql(`select count(*) from public.announcement_reads receipt where receipt.user_id=${q(actor)}
    and receipt.announcement_id in (${idList([announcement, scheduled, draft, foreign, deletedAnnouncement])})
    and not receipt.announcement_id=any(${values});`), '0')
}
class Session {
  constructor(label) {
    this.name = `${tag}_${label}`; this.output = ''; this.errors = ''; this.pending = null; this.closed = false
    this.child = spawn('docker', ['exec', '-i', '-e', `PGAPPNAME=${this.name}`, container,
      'psql', '-U', 'postgres', '-d', 'postgres', '-XqAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'])
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
      const timer = setTimeout(() => this.fail(new Error(`Session timeout: ${this.name}`)), 35_000)
      this.pending = { marker, timer, resolve, reject }
      this.child.stdin.write(`set statement_timeout='30s'; set lock_timeout='12s'; ${statement}\n\\echo ${marker}\n`)
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
  for (let i = 0; i < 120; i += 1) {
    if (await observer.run(`select exists(select 1 from pg_stat_activity w,pg_stat_activity h
      where w.application_name=${q(waiter.name)} and h.application_name=${q(holder.name)}
        and w.wait_event_type='Lock' and h.pid=any(pg_blocking_pids(w.pid)));`) === 't') return
    assert(waiter.pending, 'Contender finished before expected lock wait'); await delay(30)
  }
  throw new Error('Expected pg_blocking_pids evidence was not observed')
}
function reset() {
  sql(`begin;
    update public.classrooms set teacher_id=${q(owner)},archived_at=null where id=${q(classroom)} and title=${q(`${tag} primary`)};
    insert into public.classroom_enrollments(classroom_id,student_id) values(${q(classroom)},${q(member)}) on conflict do nothing;
    insert into public.announcements(id,classroom_id,created_by,content,is_draft,published_at,scheduled_for) values
      (${q(announcement)},${q(classroom)},${q(owner)},'Primary',false,'2020-01-01T00:00:00Z',null),
      (${q(scheduled)},${q(classroom)},${q(owner)},'Scheduled',false,'2031-01-01T00:00:00Z','2031-01-01T00:00:00Z'),
      (${q(draft)},${q(classroom)},${q(owner)},'Draft',true,null,null)
      on conflict(id) do update set classroom_id=excluded.classroom_id,content=excluded.content,
        is_draft=excluded.is_draft,published_at=excluded.published_at,scheduled_for=excluded.scheduled_for;
    delete from public.announcement_reads where user_id=${q(member)} and announcement_id in (${idList([announcement, scheduled, draft, foreign])});
    commit;`)
}
async function withSessions(label, body) {
  const first = new Session(`${label}_first`), second = new Session(`${label}_second`)
  try { await body(first, second) } finally { await Promise.allSettled([first.close(), second.close()]) }
}
try {
  sql(`begin;
    insert into public.users(id,email,role) values
      (${q(owner)},${q(`${tag}_owner@example.invalid`)},'student'),
      (${q(member)},${q(`${tag}_member@example.invalid`)},'teacher'),
      (${q(nextOwner)},${q(`${tag}_next_owner@example.invalid`)},'teacher'),
      (${q(outsider)},${q(`${tag}_outsider@example.invalid`)},'student');
    set local role service_role;
    select public.set_effective_feature_entitlement_v1(operation,u,'classrooms.create','manual',true,
      clock_timestamp(),null,2,'test:233',${q(tag)},
      coalesce((select revision from public.effective_feature_entitlements where subject_user_id=u and feature_key='classrooms.create'),0))
      from (values ${entitlementValues}) fixture(operation,u);
    reset role;
    insert into public.classrooms(id,teacher_id,title,class_code) values
      ${classes.map(([id, label, teacher]) => `(${q(id)},${q(teacher)},${q(`${tag} ${label}`)},${q(`${tag}_${label[0]}`)})`).join(',')};
    insert into public.classroom_enrollments(classroom_id,student_id) values
      (${q(classroom)},${q(member)}),(${q(deletedClassroom)},${q(member)});
    insert into public.announcements(id,classroom_id,created_by,content,is_draft,published_at,scheduled_for) values
      (${q(announcement)},${q(classroom)},${q(owner)},'Primary',false,'2020-01-01T00:00:00Z',null),
      (${q(scheduled)},${q(classroom)},${q(owner)},'Scheduled',false,'2031-01-01T00:00:00Z','2031-01-01T00:00:00Z'),
      (${q(draft)},${q(classroom)},${q(owner)},'Draft',true,null,null),
      (${q(foreign)},${q(otherClassroom)},${q(nextOwner)},'Other',false,'2020-01-01T00:00:00Z',null),
      (${q(deletedAnnouncement)},${q(deletedClassroom)},${q(owner)},'Delete class',false,'2020-01-01T00:00:00Z',null);
    commit;`)
  if (process.argv.includes('--verify-cleanup-after-fixture')) throw new Error('Forced post-fixture cleanup proof')
  for (const role of ['anon', 'authenticated']) assert.equal(sql(`select has_function_privilege(${q(role)},
    'public.mark_announcements_read_for_member_v1(uuid,uuid,timestamptz)','execute');`), 'f')
  for (const [actor, target, code] of [[owner, classroom, /42501/], [outsider, classroom, /42501/],
    [member, otherClassroom, /42501/], [member, randomUUID(), /P0002/]]) {
    assert.throws(() => sql(`begin; ${service(mark(target, actor))} commit;`), code)
  }
  assert.match(execFileSync('pnpm', ['exec', 'tsx', 'scripts/check-contextual-announcement-receipt-sdk.ts', member, classroom, announcement],
    { encoding: 'utf8', timeout: 25_000 }), /PASS live receipt SDK binding/)
  reset()
  sql(`update public.users set role='student' where id=${q(member)} and email=${q(`${tag}_member@example.invalid`)};`)
  assert.match(execFileSync('pnpm', ['exec', 'tsx', 'scripts/check-contextual-announcement-receipt-sdk.ts', member, classroom, announcement],
    { encoding: 'utf8', timeout: 25_000 }), /PASS live receipt SDK binding/)
  sql(`update public.users set role='teacher' where id=${q(member)} and email=${q(`${tag}_member@example.invalid`)};`)
  reset()

  // Admission locks and the actual whole-set result: hidden rows never receive receipts.
  result(sql(`begin; ${service(mark())} commit;`).split('\n').at(-1), 1, 1)
  assertReceipts([announcement])
  const originalReadAt = sql(`select read_at::text from public.announcement_reads where announcement_id=${q(announcement)} and user_id=${q(member)};`)
  result(sql(`begin; ${service(mark())} commit;`).split('\n').at(-1), 1, 0)
  assert.equal(sql(`select read_at::text from public.announcement_reads where announcement_id=${q(announcement)} and user_id=${q(member)};`), originalReadAt)
  reset()

  // Parent/resource locks acquired before this RPC must fail promptly and atomically.
  for (const [label, lock] of [['classroom', `select id from public.classrooms where id=${q(classroom)} for update;`],
    ['announcement', `select id from public.announcements where id=${q(announcement)} for update;`]]) {
    await withSessions(`${label}_nowait`, async holder => {
      await holder.run(`begin; ${lock}`)
      const before = receiptState()
      assert.throws(() => sql(`begin; ${service(mark())} commit;`), /PT409/)
      assert.deepEqual(receiptState(), before)
    })
  }
  reset()
  await withSessions('sdk_parent_conflict', async holder => {
    await holder.run(`begin; select id from public.classrooms where id=${q(classroom)} for update;`)
    assert.match(execFileSync('pnpm', ['exec', 'tsx', 'scripts/check-contextual-announcement-receipt-sdk.ts', member, classroom, announcement, 'conflict'],
      { encoding: 'utf8', timeout: 25_000 }), /PASS live receipt SDK browser ACL and 409/)
  })

  // Removal first: committed membership loss is checked after the shared fence wait.
  await withSessions('remove_first', async (removal, reader) => {
    await removal.run(`begin; delete from public.classroom_enrollments where classroom_id=${q(classroom)} and student_id=${q(member)};`)
    const pending = reader.run(`begin; ${service(mark())}`)
    const denied = assert.rejects(pending, /42501/)
    await blocked(reader, removal); await removal.run('commit;'); await denied
    assert.equal(receiptCount(), 0)
  })
  reset()
  // Receipt first: the enrollment DELETE waits on its FOR SHARE row lock.
  await withSessions('mark_first_remove', async (first, removal) => {
    result(await first.run(`begin; ${service(mark())}`), 1, 1)
    const pending = removal.run(`begin; delete from public.classroom_enrollments
      where classroom_id=${q(classroom)} and student_id=${q(member)};`)
    await blocked(removal, first); await first.run('commit;'); await pending; await removal.run('commit;')
  })
  assert.equal(receiptCount(), 1)
  reset()

  // Move the membership to another Class; the old Class is denied and the new
  // Class binds only its own announcement. Re-add uses a fresh enrollment ID.
  await withSessions('rebind_first', async (move, reader) => {
    await move.run(`begin;
      delete from public.classroom_enrollments where classroom_id=${q(classroom)} and student_id=${q(member)};
      insert into public.classroom_enrollments(classroom_id,student_id) values(${q(otherClassroom)},${q(member)});`)
    const pending = reader.run(`begin; ${service(mark())}`)
    const denied = assert.rejects(pending, /42501/)
    await blocked(reader, move); await move.run('commit;'); await denied
  })
  assert.equal(receiptCount(), 0)
  result(sql(`begin; ${service(mark(otherClassroom))} commit;`), 1, 1, otherClassroom)
  assertReceipts([foreign])
  sql(`delete from public.classroom_enrollments where classroom_id=${q(otherClassroom)} and student_id=${q(member)};`)
  reset()
  await withSessions('mark_first_rebind', async (reader, move) => {
    result(await reader.run(`begin; ${service(mark())}`), 1, 1)
    const pending = move.run(`begin;
      delete from public.classroom_enrollments where classroom_id=${q(classroom)} and student_id=${q(member)};
      insert into public.classroom_enrollments(classroom_id,student_id) values(${q(otherClassroom)},${q(member)});`)
    await blocked(move, reader); await reader.run('commit;'); await pending; await move.run('commit;')
  })
  assert.equal(receiptCount(), 1)
  assert.throws(() => sql(`begin; ${service(mark())} commit;`), /42501/)
  result(sql(`begin; ${service(mark(otherClassroom))} commit;`), 1, 1, otherClassroom)
  assertReceipts([announcement, foreign])
  sql(`delete from public.classroom_enrollments where classroom_id=${q(otherClassroom)} and student_id=${q(member)};`)
  reset()

  // Simulate the subject-first purge ordering. The RPC's pair acquisition must
  // fail promptly rather than wait while holding the classroom operation fence.
  for (const [label, fence] of [
    ['subject', `pika-student-purge-subject:${member}`],
    ['pair', `pika-student-purge:${classroom}:${member}`],
  ]) await withSessions(`${label}_first`, async holder => {
    await holder.run(`begin; select pg_advisory_xact_lock(hashtextextended(${q(fence)},0));`)
    assert.throws(() => sql(`begin; ${service(mark())} commit;`), /PT409/)
    assert.equal(receiptCount(), 0)
  })

  for (const [label, change, restore] of [
    ['archive', 'archived_at=clock_timestamp()', 'archived_at=null'],
    ['transfer_to_member', `teacher_id=${q(member)}`, `teacher_id=${q(owner)}`],
  ]) {
    await withSessions(`${label}_first`, async (lifecycle, reader) => {
      await lifecycle.run(`begin; update public.classrooms set ${change} where id=${q(classroom)};`)
      const pending = reader.run(`begin; ${service(mark())}`)
      const denied = assert.rejects(pending, /42501/)
      await blocked(reader, lifecycle); await lifecycle.run('commit;'); await denied
      assert.equal(receiptCount(), 0)
    })
    sql(`update public.classrooms set ${restore} where id=${q(classroom)};`)
    await withSessions(`mark_first_${label}`, async (reader, lifecycle) => {
      result(await reader.run(`begin; ${service(mark())}`), 1, 1)
      const pending = lifecycle.run(`begin; update public.classrooms set ${change} where id=${q(classroom)};`)
      await blocked(lifecycle, reader); await reader.run('commit;'); await pending; await lifecycle.run('commit;')
    })
    assert.equal(receiptCount(), 1)
    sql(`update public.classrooms set ${restore} where id=${q(classroom)};`)
    reset()
  }

  await withSessions('class_delete_first', async (deletion, reader) => {
    await deletion.run(`begin; delete from public.classrooms where id=${q(deletedClassroom)};`)
    const pending = reader.run(`begin; ${service(mark(deletedClassroom))}`)
    const denied = assert.rejects(pending, /P0002/)
    await blocked(reader, deletion); await deletion.run('commit;'); await denied
  })
  assert.equal(receiptCount(deletedAnnouncement), 0)
  sql(`insert into public.classrooms(id,teacher_id,title,class_code) values
    (${q(deletedClassroom)},${q(owner)},${q(`${tag} deletion`)},${q(`${tag}_d`)});
    insert into public.classroom_enrollments(classroom_id,student_id) values(${q(deletedClassroom)},${q(member)});
    insert into public.announcements(id,classroom_id,created_by,content,is_draft,published_at)
      values(${q(deletedAnnouncement)},${q(deletedClassroom)},${q(owner)},'Delete class',false,'2020-01-01T00:00:00Z');`)
  await withSessions('mark_first_class_delete', async (reader, deletion) => {
    result(await reader.run(`begin; ${service(mark(deletedClassroom))}`), 1, 1, deletedClassroom)
    const pending = deletion.run(`begin; delete from public.classrooms where id=${q(deletedClassroom)};`)
    await blocked(deletion, reader); await reader.run('commit;'); await pending; await deletion.run('commit;')
  })
  assert.equal(receiptCount(deletedAnnouncement), 0)

  // Legacy DML starts with the resource row; its trigger fence serializes the RPC.
  for (const [label, statement] of [
    ['delete', `delete from public.announcements where id=${q(announcement)};`],
    ['rebind', `update public.announcements set classroom_id=${q(otherClassroom)} where id=${q(announcement)};`],
    ['draft', `update public.announcements set is_draft=true,published_at=null,scheduled_for=null where id=${q(announcement)};`],
    ['reschedule', `update public.announcements set scheduled_for='2031-01-01T00:00:00Z',
      published_at='2031-01-01T00:00:00Z' where id=${q(announcement)};`],
  ]) {
    reset()
    await withSessions(`${label}_first`, async (legacy, reader) => {
      await legacy.run(`begin; ${statement}`)
      const pending = reader.run(`begin; ${service(mark())}`)
      await blocked(reader, legacy); await legacy.run('commit;')
      result(await pending, 0, 0); await reader.run('commit;')
    })
    assert.equal(receiptCount(), 0)
    reset()
    await withSessions(`mark_first_${label}`, async (reader, legacy) => {
      result(await reader.run(`begin; ${service(mark())}`), 1, 1)
      const pending = legacy.run(`begin; ${statement}`)
      await blocked(legacy, reader); await reader.run('commit;'); await pending; await legacy.run('commit;')
    })
  }
  reset()
  // Row-first legacy lock cannot create a lock-order cycle: NOWAIT returns 409.
  await withSessions('legacy_row_first', async legacy => {
    await legacy.run(`begin; select id from public.announcements where id=${q(announcement)} for update;`)
    assert.throws(() => sql(`begin; ${service(mark())} commit;`), /PT409/)
    assert.equal(receiptCount(), 0)
  })

  // The admitted owner RPC uses the same class fence as member receipts.
  const ownerDraft = `select public.update_announcement_for_owner_v1(${q(owner)},${q(classroom)},
    ${q(announcement)},'{"is_draft":true}'::jsonb)::text;`
  await withSessions('owner_rpc_first', async (writer, reader) => {
    await writer.run(`begin; ${service(ownerDraft)}`)
    const pending = reader.run(`begin; ${service(mark())}`)
    await blocked(reader, writer); await writer.run('commit;')
    result(await pending, 0, 0); await reader.run('commit;')
  })
  assert.equal(receiptCount(), 0)
  reset()
  await withSessions('receipt_first_owner_rpc', async (reader, writer) => {
    result(await reader.run(`begin; ${service(mark())}`), 1, 1)
    const pending = writer.run(`begin; ${service(ownerDraft)}`)
    await blocked(writer, reader); await reader.run('commit;'); await pending; await writer.run('commit;')
  })
  assert.equal(receiptCount(), 1)
  reset()

  // Same actor, same receipt: one transaction waits on the other and then reports zero inserted.
  await withSessions('duplicate_receipt', async (first, second) => {
    result(await first.run(`begin; ${service(mark())}`), 1, 1)
    const pending = second.run(`begin; ${service(mark())}`)
    await blocked(second, first); await first.run('commit;')
    const readAt = sql(`select read_at::text from public.announcement_reads where announcement_id=${q(announcement)} and user_id=${q(member)};`)
    result(await pending, 1, 0); await second.run('commit;')
    assert.equal(sql(`select read_at::text from public.announcement_reads where announcement_id=${q(announcement)} and user_id=${q(member)};`), readAt)
  })
  reset()

  // A legacy receipt writer holds an uncommitted duplicate key. The RPC waits
  // and then preserves the existing receipt/read_at rather than returning a false insert.
  await withSessions('receipt_insert_first', async (legacy, reader) => {
    await legacy.run(`begin; insert into public.announcement_reads(announcement_id,user_id)
      values(${q(announcement)},${q(member)});`)
    const pending = reader.run(`begin; ${service(mark())}`)
    await blocked(reader, legacy); await legacy.run('commit;')
    const readAt = sql(`select read_at::text from public.announcement_reads
      where announcement_id=${q(announcement)} and user_id=${q(member)};`)
    result(await pending, 1, 0); await reader.run('commit;')
    assert.equal(sql(`select read_at::text from public.announcement_reads
      where announcement_id=${q(announcement)} and user_id=${q(member)};`), readAt)
  })
  await withSessions('existing_receipt_row_lock', async holder => {
    await holder.run(`begin; select id from public.announcement_reads
      where announcement_id=${q(announcement)} and user_id=${q(member)} for update;`)
    const readAt = sql(`select read_at::text from public.announcement_reads
      where announcement_id=${q(announcement)} and user_id=${q(member)};`)
    result(sql(`begin; ${service(mark())} commit;`), 1, 0)
    assert.equal(sql(`select read_at::text from public.announcement_reads
      where announcement_id=${q(announcement)} and user_id=${q(member)};`), readAt)
  })
  reset()

  // A trusted cutoff stays fixed while the operation is blocked across its boundary.
  await withSessions('cutoff_crossing', async (fence, reader) => {
    const due = new Date(Date.now() + 350).toISOString()
    sql(`update public.announcements set scheduled_for=${q(due)},published_at=${q(due)} where id=${q(scheduled)};`)
    const cutoff = new Date(Date.now()).toISOString()
    await fence.run(`begin; select pg_advisory_xact_lock(hashtextextended(${q(`pika-classroom-operation:${classroom}`)},0));`)
    const pending = reader.run(`begin; ${service(mark(classroom, member, cutoff))}`)
    await blocked(reader, fence); await delay(Math.max(0, Date.parse(due) - Date.now()) + 100)
    await fence.run('commit;'); result(await pending, 1, 1); await reader.run('commit;')
    assert.equal(receiptCount(scheduled), 0)
    result(sql(`begin; ${service(mark(classroom, member, new Date().toISOString()))} commit;`).split('\n').at(-1), 2, 1)
    assertReceipts([announcement, scheduled])
  })
  reset()

  // No PostgREST page cap: one call must bind every eligible row, including >1,000.
  sql(`insert into public.announcements(id,classroom_id,created_by,content,is_draft,published_at)
    select gen_random_uuid(),${q(classroom)},${q(owner)},'Bulk '||n::text,false,'2020-01-01T00:00:00Z'
    from generate_series(1,1002) n;`)
  result(sql(`begin; ${service(mark())} commit;`).split('\n').at(-1), 1003, 1003)
  assert.equal(sql(`select count(*) from public.announcements a where a.classroom_id=${q(classroom)}
    and not a.is_draft and (a.scheduled_for is null or a.scheduled_for<='2030-01-01T00:00:00Z')
    and not exists(select 1 from public.announcement_reads r where r.announcement_id=a.id and r.user_id=${q(member)});`), '0')
  result(sql(`begin; ${service(mark())} commit;`).split('\n').at(-1), 1003, 0)
  console.log('PASS receipt SDK, ACL, lifecycle/removal/resource races, duplicate, cutoff and complete 1003-row set')
} finally {
  await Promise.allSettled(sessions.map(session => session.close()))
  // Exact UUID/email/class-code identities; capture provisioning operation IDs before deleting users.
  sql(`begin;
    create temp table receipt_fixture_provision_ops(operation_id uuid,subject_user_id uuid,primary key(operation_id,subject_user_id)) on commit drop;
    insert into receipt_fixture_provision_ops select audit.operation_id,audit.subject_user_id
      from public.account_plan_audit audit join (values ${identityValues}) identity(id,email)
        on identity.id=audit.subject_user_id
      join public.users fixture on fixture.id=identity.id and fixture.email=identity.email
      where audit.actor_ref='system:user-provisioning' and audit.reason_code='default_free_account_provisioning';
    delete from public.effective_feature_entitlement_audit audit using (values ${entitlementValues}) fixture(operation,u)
      where audit.operation_id=fixture.operation and audit.subject_user_id=fixture.u
        and audit.actor_ref='test:233' and audit.reason_code=${q(tag)} and audit.feature_key='classrooms.create';
    delete from public.effective_feature_entitlement_audit audit using receipt_fixture_provision_ops operation
      where audit.operation_id=operation.operation_id and audit.subject_user_id=operation.subject_user_id
        and audit.actor_ref='system:user-provisioning' and audit.reason_code='default_free_account_provisioning'
        and audit.feature_key='classrooms.create';
    delete from public.account_plan_audit audit using receipt_fixture_provision_ops operation
      where audit.operation_id=operation.operation_id and audit.subject_user_id=operation.subject_user_id
        and audit.actor_ref='system:user-provisioning' and audit.reason_code='default_free_account_provisioning';
    delete from public.classrooms classroom using (values
      ${classes.map(([id, label]) => `(${q(id)}::uuid,${q(`${tag} ${label}`)},${q(`${tag}_${label[0]}`)})`).join(',')}
    ) fixture(id,title,class_code)
      where classroom.id=fixture.id and classroom.title=fixture.title and classroom.class_code=fixture.class_code;
    delete from public.users fixture using (values ${identityValues}) identity(id,email)
      where fixture.id=identity.id and fixture.email=identity.email;
    commit;`)
  assert.equal(sql(`select (select count(*) from public.users where id in (${idList(identities.map(([id]) => id))}))+
    (select count(*) from public.classrooms where id in (${idList(classes.map(([id]) => id))}))+
    (select count(*) from public.announcements where classroom_id in (${idList(classes.map(([id]) => id))})
      or id in (${idList([announcement,scheduled,draft,foreign,deletedAnnouncement])}))+
    (select count(*) from public.announcement_reads where user_id in (${idList(identities.map(([id]) => id))})
      or announcement_id in (${idList([announcement,scheduled,draft,foreign,deletedAnnouncement])}))+
    (select count(*) from public.classroom_archive_revisions where classroom_id in (${idList(classes.map(([id]) => id))}))+
    (select count(*) from public.account_plans where subject_user_id in (${idList(identities.map(([id]) => id))}))+
    (select count(*) from public.account_plan_audit where subject_user_id in (${idList(identities.map(([id]) => id))}))+
    (select count(*) from public.effective_feature_entitlements where subject_user_id in (${idList(identities.map(([id]) => id))}))+
    (select count(*) from public.effective_feature_entitlement_audit where subject_user_id in (${idList(identities.map(([id]) => id))})
      or operation_id in (select operation from (values ${entitlementValues}) fixture(operation,u)));`), '0')
  console.log('PASS exact synthetic receipt fixture cleanup with zero residual rows')
}
