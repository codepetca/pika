// Local-only PostgREST contract. Random synthetic fixtures; no migrations or hosted credentials.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import {
  readContextualTeacherEntry,
  readContextualTeacherStudentHistory,
} from '../src/lib/server/contextual-teacher-daily-read'
import type { Database } from '../src/types/database'

async function main() {
  const container = 'supabase_db_pika'
  assert.equal(execFileSync('docker', ['inspect', container, '--format', '{{ index .Config.Labels "com.supabase.cli.project" }}'], { encoding: 'utf8' }).trim(), 'pika')
  assert.match(execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' }), /:54322\s*$/m)
  const status = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
  assert.equal(status.API_URL, 'http://127.0.0.1:54321', 'Only the exact local API may receive fixtures or credentials')
  assert.equal(typeof status.SERVICE_ROLE_KEY, 'string', 'Local CLI must provide a service-role credential')
  const service = createClient<Database>(status.API_URL, status.SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  function sql(statement: string) {
    return execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-XAt', '-v', 'ON_ERROR_STOP=1'], {
      input: `set statement_timeout = '15s'; set lock_timeout = '3s'; ${statement}`, encoding: 'utf8',
    }).trim()
  }
  const ownerStudent = randomUUID(), ownerTeacher = randomUUID()
  const entitlementOperations = [ownerStudent, ownerTeacher].map(subject => ({ subject, operation: randomUUID() }))
  const operationsSql = entitlementOperations.map(({ subject, operation }) => `('${operation}'::uuid,'${subject}'::uuid)`).join(',')
  const learnerTeacher = randomUUID(), learnerStudent = randomUUID(), outsider = randomUUID()
  const classA = randomUUID(), classB = randomUUID()
  const entryA = randomUUID(), previousA = randomUUID(), peerA = randomUUID(), entryB = randomUUID()
  const tag = `tdr_${randomUUID().slice(0, 8)}`
  const todaySql = "(clock_timestamp() at time zone 'America/Toronto')::date"
  const dates = sql(`select ${todaySql}, ${todaySql} - 1;`).split('\n').at(-1)!.split('|')
  const [today, previous] = dates
  assert.match(today, /^\d{4}-\d{2}-\d{2}$/)
  assert.match(previous, /^\d{4}-\d{2}-\d{2}$/)
  const entry = (actorId: string, entryId: string, client = service) => readContextualTeacherEntry({
    supabase: client, actorId, entryId,
  })
  const history = (actorId: string, classroomId: string, studentId: string, client = service) => readContextualTeacherStudentHistory({
    supabase: client, actorId, classroomId, studentId, limit: 10,
  })
  let created = false
  try {
    sql(`begin;
      insert into public.users(id,email,role) values
        ('${ownerStudent}','${tag}_owner_student@example.invalid','student'),
        ('${ownerTeacher}','${tag}_owner_teacher@example.invalid','teacher'),
        ('${learnerTeacher}','${tag}_learner_teacher@example.invalid','teacher'),
        ('${learnerStudent}','${tag}_learner_student@example.invalid','student'),
        ('${outsider}','${tag}_outsider@example.invalid','teacher');
      set local role service_role;
      select public.set_effective_feature_entitlement_v1(operation_id, u,
        'classrooms.create','manual',true,clock_timestamp(),null,2,'test:teacher-daily-read','teacher_daily_read_fixture',
        coalesce((select revision from public.effective_feature_entitlements where subject_user_id=u and feature_key='classrooms.create'),0))
      from (values ${operationsSql}) as fixture(operation_id,u);
      reset role;
      insert into public.classrooms(id,teacher_id,title,class_code) values
        ('${classA}','${ownerStudent}','${tag} A','${tag}_a'),
        ('${classB}','${ownerTeacher}','${tag} B','${tag}_b');
      insert into public.classroom_enrollments(classroom_id,student_id) values
        ('${classA}','${learnerTeacher}'),('${classA}','${learnerStudent}'),('${classB}','${learnerTeacher}');
      insert into public.class_days(classroom_id,date,is_class_day) values
        ('${classA}',${todaySql},true),('${classA}',${todaySql} - 1,true),('${classB}',${todaySql},true);
      insert into public.entries(id,classroom_id,student_id,date,text,rich_content,on_time) values
        ('${entryA}','${classA}','${learnerTeacher}',${todaySql},'Target current log','{"type":"doc","content":[]}',true),
        ('${previousA}','${classA}','${learnerTeacher}',${todaySql} - 1,'Target previous log','{"type":"doc","content":[]}',true),
        ('${peerA}','${classA}','${learnerStudent}',${todaySql},'Other learner log','{"type":"doc","content":[]}',true),
        ('${entryB}','${classB}','${learnerTeacher}',${todaySql},'Other classroom log','{"type":"doc","content":[]}',true);
      commit;`)
    created = true
    const selected = await entry(ownerStudent, entryA)
    assert.equal(selected.id, entryA)
    assert.deepEqual(selected.student, { email: `${tag}_learner_teacher@example.invalid` })
    assert(!('classroom' in selected), 'Ownership metadata must be stripped')
    assert.equal((await entry(ownerTeacher, entryB)).id, entryB)
    assert.deepEqual((await history(ownerStudent, classA, learnerTeacher)).map(row => row.id), [entryA, previousA])
    assert.deepEqual((await history(ownerStudent, classA, learnerStudent)).map(row => row.id), [peerA])
    assert.deepEqual((await history(ownerTeacher, classB, learnerTeacher)).map(row => row.id), [entryB])
    await assert.rejects(entry(outsider, entryA), { statusCode: 403 })
    await assert.rejects(entry(learnerTeacher, entryA), { statusCode: 403 })
    await assert.rejects(history(ownerTeacher, classA, learnerTeacher), { statusCode: 403 })
    await assert.rejects(history(ownerStudent, classA, outsider), { statusCode: 404 })
    const dated = await readContextualTeacherStudentHistory({ supabase: service, actorId: ownerStudent, classroomId: classA, studentId: learnerTeacher, date: today, limit: 10 })
    assert.deepEqual(dated.map(row => row.id), [entryA])
    const earlier = await readContextualTeacherStudentHistory({ supabase: service, actorId: ownerStudent, classroomId: classA, studentId: learnerTeacher, beforeDate: today, limit: 1 })
    assert.deepEqual(earlier.map(row => row.id), [previousA])
    assert(!('classroom' in earlier[0]), 'History relationship metadata must be stripped')
    process.stdout.write('PASS real teacher reads: both owner/learner role values, projection, dates, isolation and denials\n')

    sql(`update public.classrooms set archived_at=clock_timestamp() where id='${classA}';`)
    assert.equal((await entry(ownerStudent, entryA)).id, entryA)
    assert.deepEqual((await history(ownerStudent, classA, learnerTeacher)).map(row => row.id), [entryA, previousA])
    sql(`update public.classrooms set archived_at=null where id='${classA}';`)
    process.stdout.write('PASS archived owner retains entry and enrolled-learner history reads\n')

    function beforeEntries(statement: string) {
      let applied = false
      const client = createClient<Database>(status.API_URL, status.SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: async (input, init) => {
          if (new URL(String(input)).pathname === '/rest/v1/entries') {
            assert(!applied, 'No retry or unbound fallback may issue another entry SELECT')
            sql(statement)
            applied = true
          }
          return fetch(input, init)
        } },
      })
      return { client, applied: () => applied }
    }
    const removal = beforeEntries(`delete from public.classroom_enrollments where classroom_id='${classA}' and student_id='${learnerTeacher}';`)
    assert.deepEqual(await history(ownerStudent, classA, learnerTeacher, removal.client), [])
    assert(removal.applied(), 'Enrollment-removal race was not exercised')
    await assert.rejects(history(ownerStudent, classA, learnerTeacher), { statusCode: 404 })
    assert.equal((await entry(ownerStudent, entryA)).id, entryA, 'Historical drill-down does not require current enrollment')
    sql(`insert into public.classroom_enrollments(classroom_id,student_id) values('${classA}','${learnerTeacher}');`)

    const transfer = beforeEntries(`update public.classrooms set teacher_id='${ownerTeacher}' where id='${classA}';`)
    assert.deepEqual(await history(ownerStudent, classA, learnerTeacher, transfer.client), [])
    assert(transfer.applied(), 'Ownership-transfer race was not exercised')
    await assert.rejects(entry(ownerStudent, entryA), { statusCode: 403 })
    assert.equal((await entry(ownerTeacher, entryA)).id, entryA)
    sql(`update public.classrooms set teacher_id='${ownerStudent}' where id='${classA}';`)
    const entryTransfer = beforeEntries(`update public.classrooms set teacher_id='${ownerTeacher}' where id='${classA}';`)
    await assert.rejects(entry(ownerStudent, entryA, entryTransfer.client), { statusCode: 403 })
    assert(entryTransfer.applied(), 'Entry ownership-transfer check was not exercised')
    process.stdout.write('PASS committed removal/ownership transfer at data read; no stale-preflight disclosure or fallback\n')
  } finally {
    if (created) {
      sql(`begin;
        delete from public.effective_feature_entitlement_audit a using (values ${operationsSql}) as fixture(operation_id,u)
          where a.operation_id=fixture.operation_id and a.subject_user_id=fixture.u
            and a.actor_ref='test:teacher-daily-read' and a.reason_code='teacher_daily_read_fixture'
            and a.feature_key='classrooms.create'
            and exists(select 1 from public.users u where u.id=fixture.u and u.email like '${tag}_%@example.invalid');
        delete from public.classrooms where id in ('${classA}','${classB}') and teacher_id in ('${ownerStudent}','${ownerTeacher}');
        delete from public.users where id in ('${ownerStudent}','${ownerTeacher}','${learnerTeacher}','${learnerStudent}','${outsider}') and email like '${tag}_%@example.invalid';
        commit;`)
      assert.equal(sql(`select
        (select count(*) from public.users where id in ('${ownerStudent}','${ownerTeacher}','${learnerTeacher}','${learnerStudent}','${outsider}')) +
        (select count(*) from public.classrooms where id in ('${classA}','${classB}')) +
        (select count(*) from public.entries where id in ('${entryA}','${previousA}','${peerA}','${entryB}')) +
        (select count(*) from public.classroom_enrollments where classroom_id in ('${classA}','${classB}')) +
        (select count(*) from public.class_days where classroom_id in ('${classA}','${classB}')) +
        (select count(*) from public.effective_feature_entitlements where subject_user_id in ('${ownerStudent}','${ownerTeacher}')) +
        (select count(*) from public.account_plans where subject_user_id in ('${ownerStudent}','${ownerTeacher}','${learnerTeacher}','${learnerStudent}','${outsider}')) +
        (select count(*) from public.account_plan_audit where subject_user_id in ('${ownerStudent}','${ownerTeacher}','${learnerTeacher}','${learnerStudent}','${outsider}')) +
        (select count(*) from public.effective_feature_entitlement_audit where subject_user_id in ('${ownerStudent}','${ownerTeacher}')
          or operation_id in (select operation_id from (values ${operationsSql}) as fixture(operation_id,u)));`), 'SET\nSET\n0')
      process.stdout.write('PASS fixture cleanup; only this run’s synthetic IDs removed\n')
    }
  }
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
