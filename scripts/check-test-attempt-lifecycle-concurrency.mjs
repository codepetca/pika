#!/usr/bin/env node
// SOURCE ONLY. Explicit approval is required before local execution.
// Standalone on a fresh schema through244. Commits only its isolated shared
// fixture and its temporary authority drift (required for cross-session visibility).
// Ordinary races roll back; committed authority drift is restored before cleanup.
// Finally deletes exact owned roots and verifies relevant-table fingerprints.
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'

if (process.env.CORE244_ALLOW_LOCAL_VERIFICATION !== '1') throw new Error('Explicit local verification approval is required')
if (!['localhost', '127.0.0.1', '::1'].includes(process.env.PGHOST ?? '')) throw new Error('PGHOST must name a local disposable database')
const prefix = 'a2449000-0000-4000-8000-'
const ids = { teacher: prefix + '000000000001', otherTeacher: prefix + '000000000003', student: prefix + '000000000002', classroom: prefix + '000000000010', test: prefix + '000000000011', question: prefix + '000000000101', response: prefix + '000000000201', attempt: prefix + '000000000301' }
const literal = (key) => `'${ids[key]}'::uuid`
const test = literal('test'), student = literal('student'), teacher = literal('teacher'), question = literal('question')
const stamp = `${process.pid}-${Date.now()}`
const runSignature = randomUUID()
const teacherEmail = `core244-${runSignature}-teacher@example.test`
const studentEmail = `core244-${runSignature}-student@example.test`
const otherTeacherEmail = `core244-${runSignature}-other-teacher@example.test`
const classroomTitle = `CORE244 isolated race fixture ${runSignature}`
const testTitle = `CORE244 race ${runSignature}`
const active = new Set()
const completions = new WeakMap()
function openSession(name) {
  const child = spawn('psql', ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'], { env: { ...process.env, PGAPPNAME: name, PGCONNECT_TIMEOUT: '5' }, stdio: ['pipe', 'pipe', 'pipe'] })
  active.add(child)
  let output = '', diagnostic = ''
  const listeners = new Set()
  child.stdout.on('data', (data) => { output += data; for (const listener of listeners) listener() })
  child.stderr.on('data', (data) => { diagnostic += data })
  const done = new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code) => { active.delete(child); code === 0 ? resolve(output.trim()) : reject(new Error(`Local harness session failed (${code}): ${diagnostic}`)) })
  })
  // Readiness errors are handled by callers; avoid an unhandled rejection while
  // a competing session is being observed.
  done.catch(() => {})
  completions.set(child, done)
  const ready = (token) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { listeners.delete(check); reject(new Error(`Session readiness timed out: ${name}`)) }, 8000)
    const check = () => { if (output.includes(token)) { clearTimeout(timer); listeners.delete(check); resolve() } }
    listeners.add(check); check()
    done.then(() => { clearTimeout(timer); if (!output.includes(token)) reject(new Error(`Session ended before ${token}`)) }, (error) => { clearTimeout(timer); reject(error) })
  })
  return { child, done, ready, write: (sql) => child.stdin.write(sql + '\n'), end: (sql) => child.stdin.end(sql + '\n') }
}
async function sql(source) {
  const session = openSession(`pika-core244-observer-${stamp}`)
  session.end(source)
  return session.done
}
const fingerprint = () => sql(`select md5(string_agg(table_name || ':' || fingerprint, ',' order by table_name)) from (
 ${['users', 'classrooms', 'classroom_enrollments', 'tests', 'test_questions', 'test_attempts', 'test_responses', 'test_student_availability'].map((table) => `select '${table}' table_name, md5(coalesce(string_agg(md5(to_jsonb(row)::text), '' order by to_jsonb(row)::text), '')) fingerprint from public.${table} row`).join(' union all ')}
) fingerprints;`)
const setup = `begin; set local lock_timeout='5s';
do $guard$ begin
 if exists(select 1 from public.users where id in (${teacher},${student},${literal('otherTeacher')}))
 or exists(select 1 from public.classrooms where id=${literal('classroom')})
 or exists(select 1 from public.tests where id=${test})
 or exists(select 1 from public.test_questions where id=${question})
 or exists(select 1 from public.test_responses where id=${literal('response')})
 or exists(select 1 from public.test_attempts where id=${literal('attempt')}) then raise exception 'CORE244 fixture IDs already exist; refusing ownership'; end if;
end; $guard$;
insert into public.users(id,email,role) values(${teacher},'${teacherEmail}','teacher'),(${student},'${studentEmail}','student'),(${literal('otherTeacher')},'${otherTeacherEmail}','teacher');
insert into public.classrooms(id,teacher_id,title,class_code) values(${literal('classroom')},${teacher},'${classroomTitle}','CORE2441');
insert into public.classroom_enrollments(classroom_id,student_id) values(${literal('classroom')},${student});
insert into public.tests(id,classroom_id,title,status,points_possible,created_by) values(${test},${literal('classroom')},'${testTitle}','draft',5,${teacher});
insert into public.test_questions(id,test_id,question_type,question_text,options,correct_option,points,response_max_chars,position) values(${question},${test},'open_response','Review me','[]',null,5,5000,0);
update public.tests set status='closed' where id=${test};
insert into public.test_attempts(id,test_id,student_id,responses,is_submitted,submitted_at) values(${literal('attempt')},${test},${student},jsonb_build_object(${question}::text,jsonb_build_object('question_type','open_response','response_text','Reviewed answer')),true,now());
insert into public.test_responses(id,test_id,question_id,student_id,response_text,score,feedback,graded_at,graded_by) values(${literal('response')},${test},${question},${student},'Reviewed answer',4,'Reviewed',now(),${teacher});
commit;`
// A failed acknowledgement is not proof that COMMIT failed. These signature
// checks are read-only and cannot adopt another run's fixed IDs on collision.
const ownershipPredicate = `
 (select count(*) from public.users where (id=${teacher} and email='${teacherEmail}' and role='teacher')
   or (id=${student} and email='${studentEmail}' and role='student')
   or (id=${literal('otherTeacher')} and email='${otherTeacherEmail}' and role='teacher')) = 3
 and exists(select 1 from public.classrooms where id=${literal('classroom')} and teacher_id=${teacher} and title='${classroomTitle}' and class_code='CORE2441')
 and (select count(*) from public.tests where classroom_id=${literal('classroom')}) = 1
 and exists(select 1 from public.tests where id=${test} and classroom_id=${literal('classroom')} and created_by=${teacher} and title='${testTitle}')
 and (select count(*) from public.test_questions where test_id=${test}) = 1
 and exists(select 1 from public.test_questions where id=${question} and test_id=${test} and question_type='open_response')
 and (select count(*) from public.test_attempts where test_id=${test}) = 1
 and exists(select 1 from public.test_attempts where id=${literal('attempt')} and test_id=${test} and student_id=${student})
 and (select count(*) from public.test_responses where test_id=${test}) = 1
 and exists(select 1 from public.test_responses where id=${literal('response')} and test_id=${test} and question_id=${question} and student_id=${student})
 and not exists(select 1 from public.classroom_enrollments where classroom_id=${literal('classroom')} and student_id<>${student})
 and not exists(select 1 from public.test_student_availability where test_id=${test} and student_id<>${student})`
const residueQueries = {
  users: `select * from public.users where id in (${teacher},${student},${literal('otherTeacher')})`,
  classrooms: `select * from public.classrooms where id=${literal('classroom')}`,
  classroom_enrollments: `select * from public.classroom_enrollments where classroom_id=${literal('classroom')}`,
  tests: `select * from public.tests where id=${test} or classroom_id=${literal('classroom')}`,
  test_questions: `select * from public.test_questions where id=${question} or test_id=${test}`,
  test_attempts: `select * from public.test_attempts where id=${literal('attempt')} or test_id=${test}`,
  test_responses: `select * from public.test_responses where id=${literal('response')} or test_id=${test}`,
  test_student_availability: `select * from public.test_student_availability where test_id=${test}`,
}
const residueSnapshot = `jsonb_build_object(${Object.entries(residueQueries).map(([table, query]) =>
  `'${table}', (select coalesce(jsonb_agg(jsonb_build_object('id', to_jsonb(row)->>'id', 'fingerprint', md5(to_jsonb(row)::text)) order by to_jsonb(row)::text), '[]'::jsonb) from (${query}) row)`).join(',')})`
async function probeFixtureOwnership() {
  return JSON.parse(await sql(`select jsonb_build_object('owned', (${ownershipPredicate}), 'residue', ${residueSnapshot});`))
}
const teardown = `begin; set local lock_timeout='5s';
do $ownership$ begin
 perform 1 from public.classrooms where id=${literal('classroom')} for update;
 perform 1 from public.users where id in (${teacher},${student},${literal('otherTeacher')}) order by id for update;
 if not (${ownershipPredicate}) then raise exception 'CORE244 fixture ownership changed; refusing teardown'; end if;
end; $ownership$;
delete from public.classrooms where id=${literal('classroom')} and teacher_id=${teacher} and title='${classroomTitle}';
delete from public.users where (id=${teacher} and email='${teacherEmail}') or (id=${student} and email='${studentEmail}') or (id=${literal('otherTeacher')} and email='${otherTeacherEmail}');
commit;`
const clear = `select public.clear_test_open_response_grades_atomic(${test},${teacher},array[${student}],(select jsonb_agg(jsonb_build_object('response_id',id,'expected_response_revision',revision)) from public.test_responses where test_id=${test} and student_id=${student} and question_id=${question}),now());`
const reopen = `select public.update_test_student_access_atomic(${test},array[${student}],'open',${teacher});`
const returnCall = `public.return_test_attempts_checked_atomic(${test},array[${student}],${teacher})`
async function race(name, firstMutation, secondAssertion) {
  const aName = `pika-core244-a-${stamp}`, bName = `pika-core244-b-${stamp}`
  const a = openSession(aName)
  const b = openSession(bName)
  try {
    a.write(`begin; set local idle_in_transaction_session_timeout='15s'; set local statement_timeout='12s'; ${firstMutation} select 'CORE244_READY';`)
    await a.ready('CORE244_READY')
    b.end(`begin; set local lock_timeout='10s'; set local statement_timeout='12s'; ${secondAssertion} rollback;`)
    let observed = false
    const deadline = Date.now() + 7000
    while (Date.now() < deadline) {
      const waiting = await sql(`select exists(select 1 from pg_stat_activity a join pg_stat_activity b on true
        where a.application_name='${aName}' and b.application_name='${bName}'
        and b.wait_event_type='Lock' and b.wait_event='advisory' and a.pid=any(pg_blocking_pids(b.pid)));`)
      if (waiting === 't') { observed = true; break }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    if (!observed) throw new Error(`${name}: B never waited on A's advisory lock (lock-removal negative control)`)
    // Release only after observing the exact wait. No elapsed-time/pg_sleep proof.
    a.end('rollback;')
    await Promise.all([a.done, b.done])
    process.stdout.write(`${name}: PASS (observed B advisory wait on A; both rolled back)\n`)
  } finally {
    for (const session of [a,b]) if (active.has(session.child)) session.child.kill('SIGTERM')
    await Promise.allSettled([a.done,b.done])
  }
}
const returnAfterRollback = `do $assert$ declare result jsonb; begin result := ${returnCall}; if result->>'returned_count' <> '1' then raise exception 'Unexpected post-rollback eligibility: %',result; end if; end; $assert$;`
const academicSnapshot = `jsonb_build_object(
 'availability', (select coalesce(jsonb_agg(to_jsonb(row) order by student_id), '[]'::jsonb) from public.test_student_availability row where test_id=${test}),
 'responses', (select coalesce(jsonb_agg(to_jsonb(row) order by id), '[]'::jsonb) from public.test_responses row where test_id=${test}),
 'attempts', (select coalesce(jsonb_agg(to_jsonb(row) order by id), '[]'::jsonb) from public.test_attempts row where test_id=${test}),
 'test_status', (select status from public.tests where id=${test}))`
async function authorityRace(name, mutation, restoration, expectedCode) {
  const aName = `pika-core244-authority-a-${stamp}`, bName = `pika-core244-authority-b-${stamp}`
  const a = openSession(aName), b = openSession(bName)
  let committed = false
  try {
    a.write(`begin; set local idle_in_transaction_session_timeout='15s'; set local statement_timeout='12s';
      select 1 from public.classrooms where id=${literal('classroom')} for update; ${mutation} select 'CORE244_AUTHORITY_READY';`)
    await a.ready('CORE244_AUTHORITY_READY')
    b.end(`begin; set local lock_timeout='10s'; set local statement_timeout='12s';
      do $assert$ declare before_work jsonb := ${academicSnapshot}; begin
        begin perform public.update_test_student_access_atomic(${test},array[${student}],'open',${teacher});
          raise exception 'Stale authority reopen was accepted';
        exception when sqlstate '${expectedCode}' then null; end;
        if ${academicSnapshot} is distinct from before_work then
          raise exception 'Authority refusal changed availability/responses/closure/Return/revision';
        end if;
      end; $assert$; rollback;`)
    let observed = false
    const deadline = Date.now() + 7000
    while (Date.now() < deadline) {
      const waiting = await sql(`select exists(select 1 from pg_stat_activity a join pg_stat_activity b on true
        where a.application_name='${aName}' and b.application_name='${bName}' and b.wait_event_type='Lock'
          and a.pid=any(pg_blocking_pids(b.pid))
          and exists(select 1 from pg_locks waiting where waiting.pid=b.pid and not waiting.granted
            and waiting.locktype='transactionid' and waiting.transactionid=a.backend_xid)
          and exists(select 1 from pg_locks parent where parent.pid=b.pid and parent.granted
            and parent.relation='public.classrooms'::regclass and parent.mode='RowShareLock'));`)
      if (waiting === 't') { observed = true; break }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    if (!observed) throw new Error(`${name}: B never waited on A's locked Classroom (parent-lock negative control)`)
    // The enrollment/authority change becomes current before B is released.
    a.end('commit;')
    await a.done
    committed = true
    await b.done
    process.stdout.write(`${name}: PASS (observed Classroom wait, committed drift, atomic refusal)\n`)
  } finally {
    for (const session of [a,b]) if (active.has(session.child)) session.child.kill('SIGTERM')
    await Promise.allSettled([a.done,b.done])
    // Recheck acknowledgement too: a disconnected COMMIT can still be durable.
    if (committed || await sql(`select not exists(select 1 from public.classroom_enrollments where classroom_id=${literal('classroom')} and student_id=${student})
      or exists(select 1 from public.classrooms where id=${literal('classroom')} and (teacher_id<>${teacher} or archived_at is not null));`) === 't') {
      await sql(`begin; ${restoration} commit;`)
    }
  }
}
let ownsFixture = false
let setupAttempted = false
const before = await fingerprint()
try {
  setupAttempted = true
  await sql(setup)
  // Simulates successful server COMMIT followed by failed client acknowledgement.
  // Throw before ownership is armed, exercising the same recovery as sql failure.
  if (process.env.CORE244_FORCE_SETUP_ACK_FAILURE === '1') throw new Error('Forced setup COMMIT acknowledgement failure (ownership recovery control)')
  ownsFixture = true
  if (process.env.CORE244_FORCE_FAILURE === '1') throw new Error('Forced failure after fixture setup (teardown control)')
  await sql(`begin; do $revision$ declare before_clear bigint; begin
    perform ${returnCall};
    select draft_revision into before_clear from public.test_attempts where test_id=${test} and student_id=${student};
    perform public.clear_test_open_response_grades_atomic(${test},${teacher},array[${student}],
      (select jsonb_agg(jsonb_build_object('response_id',id,'expected_response_revision',revision)) from public.test_responses where test_id=${test} and student_id=${student} and question_id=${question}),now());
    if exists(select 1 from public.test_attempts where test_id=${test} and student_id=${student} and (returned_at is not null or draft_revision <= before_clear)) then raise exception 'Clear did not revoke Return and its prior revision'; end if;
    end; $revision$; rollback;`)
  await race('reopen before Return', reopen, returnAfterRollback)
  await race('grade clear before Return', clear, returnAfterRollback)
  await race('Return before grade clear', `select ${returnCall};`, `${clear} do $assert$ declare result jsonb; begin result := ${returnCall}; if result->>'skipped_count' <> '1' then raise exception 'Cleared grade was returned: %',result; end if; if (select returned_at from public.test_attempts where test_id=${test} and student_id=${student}) is not null then raise exception 'Stale disclosure marker survived'; end if; end; $assert$;`)
  await race('Return before reopen', `select ${returnCall};`, `${reopen} do $assert$ begin begin perform ${returnCall}; raise exception 'Reopened attempt returned'; exception when serialization_failure then null; end; end; $assert$;`)
  // Build the destructive-reopen branch: started, unsubmitted, teacher-closed,
  // returned, and still holding a scored response. All fields are fingerprinted.
  await sql(`begin;
    update public.test_attempts set is_submitted=false, submitted_at=null, closed_for_grading_at=now(), closed_for_grading_by=${teacher}, returned_at=now(), returned_by=${teacher} where id=${literal('attempt')};
    insert into public.test_student_availability(test_id,student_id,state,updated_by) values(${test},${student},'closed',${teacher}); commit;`)
  const enrollment = await sql(`select to_jsonb(row)::text from public.classroom_enrollments row where classroom_id=${literal('classroom')} and student_id=${student};`)
  await sql(`begin; do $positive$ declare previous_revision bigint; begin
    select draft_revision into previous_revision from public.test_attempts where id=${literal('attempt')};
    perform public.update_test_student_access_atomic(${test},array[${student},${student}],'open',${teacher});
    if exists(select 1 from public.test_responses where test_id=${test})
      or exists(select 1 from public.test_attempts where id=${literal('attempt')} and
        (closed_for_grading_at is not null or returned_at is not null or draft_revision <= previous_revision))
      or not exists(select 1 from public.test_student_availability where test_id=${test} and student_id=${student} and state='open')
    then raise exception 'Current enrolled owner could not reopen retained work'; end if;
  end; $positive$; rollback;`)
  await authorityRace('membership removal before reopen',
    `delete from public.classroom_enrollments where classroom_id=${literal('classroom')} and student_id=${student};`,
    `insert into public.classroom_enrollments select * from jsonb_populate_record(null::public.classroom_enrollments, '${enrollment.replaceAll("'", "''")}'::jsonb);`, '40001')
  await authorityRace('archive before reopen',
    `update public.classrooms set archived_at=now() where id=${literal('classroom')};`,
    `update public.classrooms set archived_at=null where id=${literal('classroom')};`, '42501')
  await authorityRace('owner drift before reopen',
    `update public.classrooms set teacher_id=${literal('otherTeacher')} where id=${literal('classroom')};`,
    `update public.classrooms set teacher_id=${teacher} where id=${literal('classroom')};`, '42501')
} finally {
  const unfinished = [...active]
  for (const child of unfinished) child.kill('SIGTERM')
  await Promise.allSettled(unfinished.map((child) => completions.get(child)))
  if (setupAttempted && !ownsFixture) {
    const probe = await probeFixtureOwnership()
    if (probe.owned) ownsFixture = true
    else if (Object.values(probe.residue).some((rows) => rows.length > 0)) {
      throw new Error(`CORE244 setup outcome is not owned by this run; refusing deletion. Exact residue fingerprint: ${JSON.stringify(probe.residue)}`)
    }
  }
  if (ownsFixture) {
    await sql(teardown)
    const remaining = await probeFixtureOwnership()
    if (Object.values(remaining.residue).some((rows) => rows.length > 0)) throw new Error(`CORE244 exact fixture residue after teardown: ${JSON.stringify(remaining.residue)}`)
    if (await fingerprint() !== before) throw new Error('Relevant-table baseline changed after exact fixture teardown')
    process.stdout.write('Exact fixture teardown and baseline fingerprint: PASS\n')
  }
}
