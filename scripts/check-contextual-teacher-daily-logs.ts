// Local-only PostgREST contract. Exact random synthetic fixtures; never hosted credentials.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { readContextualTeacherLogs } from '../src/lib/server/contextual-teacher-daily-logs'
import type { Database } from '../src/types/database'

async function main() {
  const container = 'supabase_db_pika'
  assert.equal(execFileSync('docker', ['inspect', container, '--format', '{{ index .Config.Labels "com.supabase.cli.project" }}'], { encoding: 'utf8' }).trim(), 'pika')
  assert.match(execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' }), /:54322\s*$/m)
  const status = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
  assert.equal(status.API_URL, 'http://127.0.0.1:54321')
  assert.equal(typeof status.SERVICE_ROLE_KEY, 'string')
  const service = createClient<Database>(status.API_URL, status.SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  function sql(statement: string) {
    return execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-XAt', '-v', 'ON_ERROR_STOP=1'], {
      input: `set statement_timeout='15s'; set lock_timeout='3s'; ${statement}`, encoding: 'utf8',
    }).trim()
  }
  const tag = `tdl_${randomUUID().slice(0, 8)}`
  const ownerStudent = randomUUID(), ownerTeacher = randomUUID(), outsider = randomUUID()
  const entitlementOperations = [ownerStudent, ownerTeacher].map(subject => ({ subject, operation: randomUUID() }))
  const operationsSql = entitlementOperations.map(({ subject, operation }) => `('${operation}'::uuid,'${subject}'::uuid)`).join(',')
  const classA = randomUUID(), classB = randomUUID(), emptyClass = randomUUID()
  const learners = Array.from({ length: 1001 }, (_, index) => ({
    id: randomUUID(), enrollmentId: randomUUID(), index,
    email: `${tag}_learner_${String(index).padStart(4, '0')}@example.invalid`,
    role: index % 2 === 0 ? 'teacher' : 'student',
  }))
  const userIds = [ownerStudent, ownerTeacher, outsider, ...learners.map(learner => learner.id)]
  const idsSql = userIds.map(id => `'${id}'::uuid`).join(',')
  const todaySql = "(clock_timestamp() at time zone 'America/Toronto')::date"
  const dates = sql(`select string_agg((${todaySql}-n)::text,',' order by n) from generate_series(0,6) n;`).split('\n').at(-1)!.split(',')
  assert.equal(dates.length, 7)
  dates.forEach(date => assert.match(date, /^\d{4}-\d{2}-\d{2}$/))
  const today = dates[0]
  const logs = (actorId: string, classroomId: string, date?: string, client = service) => readContextualTeacherLogs({
    supabase: client, actorId, classroomId, date,
  })
  function instrument(beforeRoster?: string, rosterNumber = 1) {
    const requests: URL[] = []
    let rosterQueries = 0, applied = false
    const client = createClient<Database>(status.API_URL, status.SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async (input, init) => {
        const url = new URL(String(input))
        requests.push(url)
        if (url.pathname === '/rest/v1/classroom_enrollments') {
          rosterQueries += 1
          assert(rosterQueries <= 3, 'No repeated pagination or contextual retry/fallback')
          assert.equal(url.searchParams.get('classroom.teacher_id'), `eq.${ownerStudent}`)
          assert.equal(url.searchParams.get('classroom_id'), `eq.${classA}`)
          if (beforeRoster && rosterQueries === rosterNumber) {
            sql(beforeRoster)
            applied = true
          }
        }
        return fetch(input, init)
      } },
    })
    return { client, requests, applied: () => applied }
  }
  let created = false
  try {
    sql(`begin;
      insert into public.users(id,email,role) values
        ('${ownerStudent}','${tag}_owner_student@example.invalid','student'),
        ('${ownerTeacher}','${tag}_owner_teacher@example.invalid','teacher'),
        ('${outsider}','${tag}_outsider@example.invalid','teacher'),
        ${learners.map(learner => `('${learner.id}','${learner.email}','${learner.role}')`).join(',')};
      set local role service_role;
      select public.set_effective_feature_entitlement_v1(operation_id,u,
        'classrooms.create','manual',true,clock_timestamp(),null,3,'test:teacher-daily-logs','teacher_daily_logs_fixture',
        coalesce((select revision from public.effective_feature_entitlements where subject_user_id=u and feature_key='classrooms.create'),0))
      from (values ${operationsSql}) as fixture(operation_id,u);
      reset role;
      insert into public.classrooms(id,teacher_id,title,class_code) values
        ('${classA}','${ownerStudent}','${tag} A','${tag}_a'),
        ('${classB}','${ownerTeacher}','${tag} B','${tag}_b'),
        ('${emptyClass}','${ownerStudent}','${tag} empty','${tag}_empty');
      insert into public.classroom_enrollments(id,classroom_id,student_id) values
        ${learners.map(learner => `('${learner.enrollmentId}','${classA}','${learner.id}')`).join(',')},
        (gen_random_uuid(),'${classB}','${learners[0].id}');
      insert into public.student_profiles(user_id,first_name,last_name) values
        ${learners.filter(learner => learner.index !== 1).map(learner => `('${learner.id}','First${learner.index}','Last${learner.index}')`).join(',')};
      insert into public.class_days(classroom_id,date,is_class_day)
        select c,${todaySql}-n,true from unnest(array['${classA}'::uuid,'${classB}'::uuid]) c cross join generate_series(0,6) n;
      insert into public.entries(classroom_id,student_id,date,text,rich_content,on_time)
        select e.classroom_id,e.student_id,${todaySql}-n,'synthetic log '||n,'{"type":"doc","content":[]}'::jsonb,true
        from public.classroom_enrollments e cross join generate_series(0,6) n
        where e.classroom_id in ('${classA}','${classB}');
      commit;`)
    created = true

    const trace = instrument()
    const dated = await logs(ownerStudent, classA, today, trace.client)
    assert.equal(dated.classroom_id, classA)
    assert.equal(dated.date, today)
    assert.equal(dated.logs.length, 1001, 'Pagination must include the 1001st learner')
    assert.deepEqual(dated.logs.map(row => row.student_email), learners.map(learner => learner.email))
    assert.equal(dated.logs[0].student_first_name, 'First0')
    assert.equal(dated.logs[1].student_first_name, '', 'Missing optional profile retains legacy blank names')
    for (const row of dated.logs) {
      assert.equal(row.entry?.date, today)
      assert.equal(row.entry?.student_id, row.student_id)
      assert.equal(row.entry?.classroom_id, classA)
      assert.deepEqual(row.history_preview.map(entry => entry.date), dates.slice(0, 5), 'Five previews are required per learner, not per page')
      for (const entry of [row.entry, ...row.history_preview]) {
        assert(entry)
        assert.equal(entry.student_id, row.student_id)
        assert.equal(entry.classroom_id, classA)
        assert.deepEqual(Object.keys(entry).sort(), ['classroom_id','created_at','date','id','minutes_reported','mood','on_time','rich_content','student_id','text','updated_at','version'].sort())
      }
      assert.deepEqual(Object.keys(row).sort(), ['entry','history_preview','student_email','student_first_name','student_id','student_last_name'].sort())
    }
    assert.equal(trace.requests.filter(url => url.pathname === '/rest/v1/classroom_enrollments').length, 2)
    assert(!trace.requests.some(url => /\/rest\/v1\/(entries|users|student_profiles|rpc\/)/.test(url.pathname)), 'No unbound profile/entry/RPC or per-learner fallback')
    process.stdout.write('PASS 1001 learners across two bound pages; both global roles, optional profiles, per-learner five previews, projection and cross-class isolation\n')

    const undated = await logs(ownerTeacher, classB)
    assert.equal(undated.date, null)
    assert.equal(undated.logs.length, 1)
    assert.equal(undated.logs[0].entry, null)
    assert.deepEqual(undated.logs[0].history_preview.map(entry => entry.date), dates.slice(0, 5))
    assert.equal((await logs(ownerTeacher, classB, dates[3])).logs[0].entry?.date, dates[3])
    assert.deepEqual((await logs(ownerStudent, emptyClass, today)).logs, [])
    await assert.rejects(logs(outsider, classA, today), { statusCode: 403 })
    await assert.rejects(logs(learners[0].id, classA, today), { statusCode: 403 })
    await assert.rejects(logs(learners[1].id, classA, today), { statusCode: 403 })
    await assert.rejects(logs(ownerTeacher, classA, today), { statusCode: 403 })
    await assert.rejects(logs(ownerStudent, randomUUID(), today), { statusCode: 404 })
    sql(`update public.classrooms set archived_at=clock_timestamp() where id='${classA}';`)
    assert.equal((await logs(ownerStudent, classA, today)).logs.length, 1001)
    sql(`update public.classrooms set archived_at=null where id='${classA}';`)
    process.stdout.write('PASS undated and exact-date reads, empty roster, archived owner, non-owner denials and missing classroom\n')

    const removal = instrument(`delete from public.classroom_enrollments where id='${learners[0].enrollmentId}' and classroom_id='${classA}';`)
    const removed = await logs(ownerStudent, classA, today, removal.client)
    assert(removal.applied())
    assert.equal(removed.logs.length, 1000)
    assert(!removed.logs.some(row => row.student_id === learners[0].id))
    // Rejoin is a new membership generation; never resurrect a closed enrollment ID.
    learners[0].enrollmentId = randomUUID()
    sql(`insert into public.classroom_enrollments(id,classroom_id,student_id) values('${learners[0].enrollmentId}','${classA}','${learners[0].id}');`)

    const sortedEnrollments = [...learners].sort((a,b) => a.enrollmentId.localeCompare(b.enrollmentId))
    const removedAfterPage = sortedEnrollments[0], finalLearner = sortedEnrollments.at(-1)!
    const pageRemoval = instrument(`delete from public.classroom_enrollments where id='${removedAfterPage.enrollmentId}' and classroom_id='${classA}';`, 2)
    const paged = await logs(ownerStudent, classA, today, pageRemoval.client)
    assert(pageRemoval.applied())
    assert.equal(paged.logs.length, 1001, 'Already-read snapshot rows may remain; a deletion must not shift and skip the unread final learner')
    assert(paged.logs.some(row => row.student_id === finalLearner.id))
    removedAfterPage.enrollmentId = randomUUID()
    sql(`insert into public.classroom_enrollments(id,classroom_id,student_id) values('${removedAfterPage.enrollmentId}','${classA}','${removedAfterPage.id}');`)

    const transfer = instrument(`update public.classrooms set teacher_id='${ownerTeacher}' where id='${classA}';`)
    assert.deepEqual((await logs(ownerStudent, classA, today, transfer.client)).logs, [])
    assert(transfer.applied())
    await assert.rejects(logs(ownerStudent, classA, today), { statusCode: 403 })
    assert.equal((await logs(ownerTeacher, classA, today)).logs.length, 1001)
    process.stdout.write('PASS committed membership removal and owner transfer at the data page; keyset preserves unread rows across removal, no unbound fallback\n')
  } finally {
    if (created) {
      sql(`begin;
        delete from public.effective_feature_entitlement_audit a using (values ${operationsSql}) as fixture(operation_id,u)
          where a.operation_id=fixture.operation_id and a.subject_user_id=fixture.u
            and a.actor_ref='test:teacher-daily-logs' and a.reason_code='teacher_daily_logs_fixture'
            and a.feature_key='classrooms.create'
            and exists(select 1 from public.users u where u.id=fixture.u and u.email like '${tag}_%@example.invalid');
        delete from public.classrooms where id in ('${classA}','${classB}','${emptyClass}') and teacher_id in ('${ownerStudent}','${ownerTeacher}');
        delete from public.users where id=any(array[${idsSql}]) and email like '${tag}_%@example.invalid';
        commit;`)
      assert.equal(sql(`select
        (select count(*) from public.users where id=any(array[${idsSql}]))+
        (select count(*) from public.classrooms where id in ('${classA}','${classB}','${emptyClass}'))+
        (select count(*) from public.entries where classroom_id in ('${classA}','${classB}','${emptyClass}'))+
        (select count(*) from public.classroom_enrollments where student_id=any(array[${idsSql}]))+
        (select count(*) from public.student_profiles where user_id=any(array[${idsSql}]))+
        (select count(*) from public.class_days where classroom_id in ('${classA}','${classB}','${emptyClass}'))+
        (select count(*) from public.effective_feature_entitlements where subject_user_id=any(array[${idsSql}]))+
        (select count(*) from public.account_plans where subject_user_id=any(array[${idsSql}]))+
        (select count(*) from public.account_plan_audit where subject_user_id=any(array[${idsSql}]))+
        (select count(*) from public.effective_feature_entitlement_audit where subject_user_id=any(array[${idsSql}])
          or operation_id in (select operation_id from (values ${operationsSql}) as fixture(operation_id,u)));`), 'SET\nSET\n0')
      process.stdout.write('PASS exact synthetic fixture cleanup; no migration, reset, hosted operation or unrelated row changes\n')
    }
  }
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
