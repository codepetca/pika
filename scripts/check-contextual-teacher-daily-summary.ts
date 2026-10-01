// Local-only cached-summary contract. Synthetic fixtures; no AI, migrations or hosted credentials.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { readContextualTeacherLogSummary } from '../src/lib/server/contextual-teacher-daily-summary'
import type { Database } from '../src/types/database'

async function main() {
  const container = 'supabase_db_pika'
  assert.equal(execFileSync('docker', ['inspect', container, '--format', '{{ index .Config.Labels "com.supabase.cli.project" }}'], { encoding: 'utf8' }).trim(), 'pika')
  assert.match(execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' }), /:54322\s*$/m)
  const status = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
  assert.equal(status.API_URL, 'http://127.0.0.1:54321')
  assert.equal(typeof status.SERVICE_ROLE_KEY, 'string')
  const service = createClient<Database>(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  function sql(statement: string) {
    return execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-XAt', '-v', 'ON_ERROR_STOP=1'], {
      input: `set statement_timeout='15s'; set lock_timeout='3s'; ${statement}`, encoding: 'utf8',
    }).trim()
  }
  const tag = `tds_${randomUUID().slice(0, 8)}`
  const ownerStudent = randomUUID(), ownerTeacher = randomUUID(), outsider = randomUUID()
  const learnerStudent = randomUUID(), learnerTeacher = randomUUID()
  const userIds = [ownerStudent, ownerTeacher, outsider, learnerStudent, learnerTeacher]
  const idsSql = userIds.map(id => `'${id}'::uuid`).join(',')
  const operationsSql = [ownerStudent, ownerTeacher].map(subject => `('${randomUUID()}'::uuid,'${subject}'::uuid)`).join(',')
  const classA = randomUUID(), classB = randomUUID(), emptyClass = randomUUID()
  const classesSql = `'${classA}','${classB}','${emptyClass}'`
  const todaySql = "(clock_timestamp() at time zone 'America/Toronto')::date"
  const [today, previous] = sql(`select ${todaySql}, ${todaySql}-1;`).split('\n').at(-1)!.split('|')
  const currentItems = '{"policy_version":"high-priority-v1","overview":"fixture overview","action_items":[{"text":"A.L. reported an urgent wellbeing concern.","initials":"A.L."}]}'
  const currentMap = '{"A.L.":"Alpha Learner"}'
  function restoreCache() {
    sql(`insert into public.log_summaries(classroom_id,date,model,summary_items,initials_map,entry_count,entries_updated_at)
      values('${classA}','${today}','synthetic', '${currentItems}'::jsonb,'${currentMap}'::jsonb,2,
        (select max(updated_at) from public.entries where classroom_id='${classA}' and date='${today}'))
      on conflict(classroom_id,date) do update set summary_items=excluded.summary_items,initials_map=excluded.initials_map,
        entry_count=excluded.entry_count,entries_updated_at=excluded.entries_updated_at;`)
  }
  const summary = (actorId: string, classroomId: string, date = today, client = service) =>
    readContextualTeacherLogSummary({ supabase: client, actorId, classroomId, date })
  type Phase = 'stats' | 'count' | 'cache'
  function instrument(actorId: string, classroomId: string, date = today, transferBefore?: Phase) {
    const reads: Phase[] = []
    let applied = false
    const client = createClient<Database>(status.API_URL, status.SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async (input, init) => {
        const url = new URL(String(input))
        assert(!url.pathname.startsWith('/rest/v1/rpc/'), 'No unbound RPC fallback or generation')
        if (url.pathname === '/rest/v1/entries' || url.pathname === '/rest/v1/log_summaries') {
          const phase: Phase = url.pathname === '/rest/v1/log_summaries' ? 'cache' : init?.method === 'HEAD' ? 'count' : 'stats'
          reads.push(phase)
          assert(reads.length <= 3, 'No retry or unbound fallback')
          assert.equal(url.searchParams.get('classroom.teacher_id'), `eq.${actorId}`)
          assert.equal(url.searchParams.get('classroom_id'), `eq.${classroomId}`)
          assert.equal(url.searchParams.get('date'), `eq.${date}`)
          assert.match(url.searchParams.get('select') ?? '', /classroom:classrooms!inner\(id,\s*teacher_id\)/)
          if (phase === transferBefore) {
            sql(`update public.classrooms set teacher_id='${ownerTeacher}' where id='${classA}' and teacher_id='${ownerStudent}';`)
            applied = true
          }
        }
        return fetch(input, init)
      } },
    })
    return { client, reads, applied: () => applied }
  }
  let created = false
  try {
    sql(`begin;
      insert into public.users(id,email,role) values
        ('${ownerStudent}','${tag}_owner_student@example.invalid','student'),
        ('${ownerTeacher}','${tag}_owner_teacher@example.invalid','teacher'),
        ('${outsider}','${tag}_outsider@example.invalid','teacher'),
        ('${learnerStudent}','${tag}_learner_student@example.invalid','student'),
        ('${learnerTeacher}','${tag}_learner_teacher@example.invalid','teacher');
      set local role service_role;
      select public.set_effective_feature_entitlement_v1(operation_id,u,'classrooms.create','manual',true,
        clock_timestamp(),null,3,'test:teacher-daily-summary','teacher_daily_summary_fixture',
        coalesce((select revision from public.effective_feature_entitlements where subject_user_id=u and feature_key='classrooms.create'),0))
      from (values ${operationsSql}) fixture(operation_id,u);
      reset role;
      insert into public.classrooms(id,teacher_id,title,class_code) values
        ('${classA}','${ownerStudent}','${tag} A','${tag}_a'),
        ('${classB}','${ownerTeacher}','${tag} B','${tag}_b'),
        ('${emptyClass}','${ownerStudent}','${tag} empty','${tag}_empty');
      insert into public.classroom_enrollments(classroom_id,student_id) values
        ('${classA}','${learnerStudent}'),('${classA}','${learnerTeacher}'),('${classB}','${learnerStudent}');
      insert into public.class_days(classroom_id,date,is_class_day) values
        ('${classA}','${today}',true),('${classA}','${previous}',true),('${classB}','${today}',true);
      insert into public.entries(classroom_id,student_id,date,text,on_time,updated_at) values
        ('${classA}','${learnerStudent}','${today}','synthetic A one',true,'${today}T13:00:00.123900+00:00'),
        ('${classA}','${learnerTeacher}','${today}','synthetic A two',true,'${today}T12:00:00+00:00'),
        ('${classA}','${learnerStudent}','${previous}','synthetic previous',true,'${previous}T13:00:00+00:00'),
        ('${classB}','${learnerStudent}','${today}','synthetic B',true,clock_timestamp());
      insert into public.log_summaries(classroom_id,date,model,summary_items,initials_map,entry_count,entries_updated_at) values
        ('${classB}','${today}','synthetic','${currentItems}'::jsonb,'{"A.L.":"Other Classroom Learner"}'::jsonb,1,clock_timestamp()),
        ('${classA}','${previous}','synthetic','${currentItems}'::jsonb,'{"A.L.":"Previous Day Learner"}'::jsonb,1,clock_timestamp());
      commit;`)
    created = true
    restoreCache()
    const trace = instrument(ownerStudent, classA)
    const ready = await summary(ownerStudent, classA, today, trace.client)
    assert.equal(ready.summary_status, 'ready')
    assert(ready.summary)
    assert.deepEqual(Object.keys(ready).sort(), ['summary','summary_status'])
    assert.deepEqual(Object.keys(ready.summary).sort(), ['action_items','generated_at','overview'])
    assert.deepEqual(ready.summary.action_items, [{ text: 'Alpha Learner reported an urgent wellbeing concern.', studentName: 'Alpha Learner' }])
    assert.deepEqual(trace.reads, ['stats','count','cache'])
    assert(!JSON.stringify(ready).includes('Other Classroom Learner'))
    assert(!JSON.stringify(ready).includes('Previous Day Learner'))
    assert(JSON.stringify(await summary(ownerTeacher, classB)).includes('Other Classroom Learner'))
    assert(JSON.stringify(await summary(ownerStudent, classA, previous)).includes('Previous Day Learner'))
    const empty = instrument(ownerStudent, emptyClass)
    assert.deepEqual(await summary(ownerStudent, emptyClass, today, empty.client), { summary: null, summary_status: 'no_entries' })
    assert(!empty.reads.includes('cache'))
    await assert.rejects(summary(outsider, classA), { statusCode: 403 })
    await assert.rejects(summary(ownerTeacher, classA), { statusCode: 403 })
    await assert.rejects(summary(learnerStudent, classA), { statusCode: 403 })
    await assert.rejects(summary(learnerTeacher, classA), { statusCode: 403 })
    await assert.rejects(summary(ownerStudent, randomUUID()), { statusCode: 404 })
    sql(`update public.classrooms set archived_at=clock_timestamp() where id='${classA}';`)
    assert.equal((await summary(ownerStudent, classA)).summary_status, 'ready')
    sql(`update public.classrooms set archived_at=null where id='${classA}';`)
    process.stdout.write('PASS both owner role values, name restoration/projection, class/date isolation, bound exact count, empty/archived reads and member/non-owner denials\n')

    sql(`update public.log_summaries set entry_count=1 where classroom_id='${classA}' and date='${today}';`)
    assert.deepEqual(await summary(ownerStudent, classA), { summary: null, summary_status: 'pending' })
    restoreCache()
    sql(`update public.log_summaries set entries_updated_at='2000-01-01T00:00:00Z' where classroom_id='${classA}' and date='${today}';`)
    assert.equal((await summary(ownerStudent, classA)).summary_status, 'pending')
    sql(`update public.log_summaries set entries_updated_at='${today}T13:00:00.123100+00:00' where classroom_id='${classA}' and date='${today}';`)
    assert.equal((await summary(ownerStudent, classA)).summary_status, 'pending', 'Sub-millisecond stale cache must not appear ready')
    restoreCache()
    assert.equal((await summary(ownerStudent, classA)).summary_status, 'ready', 'Equal PostgreSQL microseconds remain fresh')
    sql(`update public.log_summaries set entries_updated_at='${today}T13:00:00.123901+00:00' where classroom_id='${classA}' and date='${today}';`)
    assert.equal((await summary(ownerStudent, classA)).summary_status, 'ready', 'Later PostgreSQL microseconds remain fresh')
    sql(`update public.log_summaries set summary_items='[]'::jsonb where classroom_id='${classA}' and date='${today}';`)
    assert.deepEqual(await summary(ownerStudent, classA), { summary: null, summary_status: 'unavailable' })
    restoreCache()
    sql(`update public.log_summaries set summary_items='{"policy_version":"high-priority-v1","action_items":[]}'::jsonb where classroom_id='${classA}' and date='${today}';`)
    assert.equal((await summary(ownerStudent, classA)).summary_status, 'pending')
    restoreCache()
    sql(`update public.log_summaries set initials_map='{"A.L.":42}'::jsonb where classroom_id='${classA}' and date='${today}';`)
    await assert.rejects(summary(ownerStudent, classA), { statusCode: 503 })
    for (const invalidMap of ['{}','{"A.L.":"Alpha Learner","":"Injected"}','{"A.L.":"  "}']) {
      sql(`update public.log_summaries set initials_map='${invalidMap}'::jsonb where classroom_id='${classA}' and date='${today}';`)
      await assert.rejects(summary(ownerStudent, classA), { statusCode: 503 })
    }
    restoreCache()
    sql(`update public.log_summaries set summary_items='{"policy_version":"high-priority-v1","overview":"fixture","action_items":[{"text":"? reported an urgent wellbeing concern.","initials":"?"}]}'::jsonb where classroom_id='${classA}' and date='${today}';`)
    await assert.rejects(summary(ownerStudent, classA), { statusCode: 503 }, 'Unresolved warning must not become a ready all-clear')
    sql(`delete from public.log_summaries where classroom_id='${classA}' and date='${today}';`)
    assert.deepEqual(await summary(ownerStudent, classA), { summary: null, summary_status: 'pending' })
    restoreCache()
    process.stdout.write('PASS PostgreSQL microsecond/cache count/update freshness, retired policy, missing overview/cache and malformed/unresolved/empty name-map fail-closed behavior; no AI calls\n')

    for (const phase of ['stats','count','cache'] as const) {
      const transfer = instrument(ownerStudent, classA, today, phase)
      const denied = await summary(ownerStudent, classA, today, transfer.client)
      assert(transfer.applied(), `Transfer before ${phase} was not exercised`)
      assert.equal(denied.summary, null, `Old owner may not receive cache or names after transfer before ${phase}`)
      assert.equal(denied.summary_status, phase === 'cache' ? 'pending' : 'no_entries')
      await assert.rejects(summary(ownerStudent, classA), { statusCode: 403 })
      assert.equal((await summary(ownerTeacher, classA)).summary_status, 'ready')
      sql(`update public.classrooms set teacher_id='${ownerStudent}' where id='${classA}' and teacher_id='${ownerTeacher}';`)
    }
    process.stdout.write('PASS committed owner transfer before stats, exact HEAD count and cache query; no stale-owner names or unbound fallback\n')
  } finally {
    if (created) {
      sql(`begin;
        delete from public.effective_feature_entitlement_audit a using (values ${operationsSql}) fixture(operation_id,u)
          where a.operation_id=fixture.operation_id and a.subject_user_id=fixture.u
            and a.actor_ref='test:teacher-daily-summary' and a.reason_code='teacher_daily_summary_fixture'
            and a.feature_key='classrooms.create'
            and exists(select 1 from public.users u where u.id=fixture.u and u.email like '${tag}_%@example.invalid');
        delete from public.classrooms where id in (${classesSql}) and teacher_id in ('${ownerStudent}','${ownerTeacher}');
        delete from public.users where id=any(array[${idsSql}]) and email like '${tag}_%@example.invalid';
        commit;`)
      assert.equal(sql(`select
        (select count(*) from public.users where id=any(array[${idsSql}]))+
        (select count(*) from public.classrooms where id in (${classesSql}))+
        (select count(*) from public.entries where classroom_id in (${classesSql}))+
        (select count(*) from public.log_summaries where classroom_id in (${classesSql}))+
        (select count(*) from public.class_days where classroom_id in (${classesSql}))+
        (select count(*) from public.classroom_enrollments where student_id=any(array[${idsSql}]))+
        (select count(*) from public.effective_feature_entitlements where subject_user_id=any(array[${idsSql}]))+
        (select count(*) from public.account_plans where subject_user_id=any(array[${idsSql}]))+
        (select count(*) from public.account_plan_audit where subject_user_id=any(array[${idsSql}]))+
        (select count(*) from public.effective_feature_entitlement_audit where subject_user_id=any(array[${idsSql}])
          or operation_id in (select operation_id from (values ${operationsSql}) fixture(operation_id,u)));`), 'SET\nSET\n0')
      process.stdout.write('PASS exact synthetic fixture/live-state/audit cleanup; no migration, reset/reseed, hosted or real-user change\n')
    }
  }
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
