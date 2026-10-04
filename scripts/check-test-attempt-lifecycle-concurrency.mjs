#!/usr/bin/env node
// SOURCE ONLY. Explicit approval is required before local execution.
// Standalone on a fresh schema through244. Commits only its isolated shared
// fixture (required for two-session visibility); every race session rolls back.
// Finally deletes exact owned roots and verifies relevant-table fingerprints.
import { spawn } from 'node:child_process'

if (process.env.CORE244_ALLOW_LOCAL_VERIFICATION !== '1') throw new Error('Explicit local verification approval is required')
if (!['localhost', '127.0.0.1', '::1'].includes(process.env.PGHOST ?? '')) throw new Error('PGHOST must name a local disposable database')
const prefix = 'a2449000-0000-4000-8000-'
const ids = { teacher: prefix + '000000000001', student: prefix + '000000000002', classroom: prefix + '000000000010', test: prefix + '000000000011', question: prefix + '000000000101', response: prefix + '000000000201', attempt: prefix + '000000000301' }
const literal = (key) => `'${ids[key]}'::uuid`
const test = literal('test'), student = literal('student'), teacher = literal('teacher'), question = literal('question')
const stamp = `${process.pid}-${Date.now()}`
const active = new Set()
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
 if exists(select 1 from public.users where id in (${teacher},${student}))
 or exists(select 1 from public.classrooms where id=${literal('classroom')})
 or exists(select 1 from public.tests where id=${test})
 or exists(select 1 from public.test_questions where id=${question})
 or exists(select 1 from public.test_responses where id=${literal('response')})
 or exists(select 1 from public.test_attempts where id=${literal('attempt')}) then raise exception 'CORE244 fixture IDs already exist; refusing ownership'; end if;
end; $guard$;
insert into public.users(id,email,role) values(${teacher},'core244-race-teacher@example.test','teacher'),(${student},'core244-race-student@example.test','student');
insert into public.classrooms(id,teacher_id,title,class_code) values(${literal('classroom')},${teacher},'CORE244 isolated race fixture','CORE2441');
insert into public.classroom_enrollments(classroom_id,student_id) values(${literal('classroom')},${student});
insert into public.tests(id,classroom_id,title,status,points_possible,created_by) values(${test},${literal('classroom')},'CORE244 race','draft',5,${teacher});
insert into public.test_questions(id,test_id,question_type,question_text,options,correct_option,points,response_max_chars,position) values(${question},${test},'open_response','Review me','[]',null,5,5000,0);
update public.tests set status='closed' where id=${test};
insert into public.test_attempts(id,test_id,student_id,responses,is_submitted,submitted_at) values(${literal('attempt')},${test},${student},jsonb_build_object(${question}::text,jsonb_build_object('question_type','open_response','response_text','Reviewed answer')),true,now());
insert into public.test_responses(id,test_id,question_id,student_id,response_text,score,feedback,graded_at,graded_by) values(${literal('response')},${test},${question},${student},'Reviewed answer',4,'Reviewed',now(),${teacher});
commit;`
const teardown = `begin; set local lock_timeout='5s';
do $ownership$ begin
 if not exists(select 1 from public.classrooms where id=${literal('classroom')} and teacher_id=${teacher} and title='CORE244 isolated race fixture')
 or (select count(*) from public.users where (id=${teacher} and email='core244-race-teacher@example.test') or (id=${student} and email='core244-race-student@example.test')) <> 2 then raise exception 'CORE244 fixture ownership changed; refusing teardown'; end if;
end; $ownership$;
delete from public.classrooms where id=${literal('classroom')} and teacher_id=${teacher};
delete from public.users where (id=${teacher} and email='core244-race-teacher@example.test') or (id=${student} and email='core244-race-student@example.test');
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
let ownsFixture = false
const before = await fingerprint()
try {
  await sql(setup)
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
} finally {
  for (const child of active) child.kill('SIGTERM')
  if (ownsFixture) {
    await sql(teardown)
    if (await fingerprint() !== before) throw new Error('Relevant-table baseline changed after exact fixture teardown')
    process.stdout.write('Exact fixture teardown and baseline fingerprint: PASS\n')
  }
}
