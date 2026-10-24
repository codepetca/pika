import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const args = process.argv.slice(2)
assert.equal(args.length, 4)
assert.equal(args[0], '--container-id')
assert.equal(args[2], '--owner')
const containerId = args[1]
const owner = args[3]
assert.match(containerId, /^[a-f0-9]{64}$/u)
assert.match(owner, /^[1-9][0-9]*:[A-Za-z0-9]+$/u)
const deadline = Date.now() + 30_000
function verifyTarget() {
  assert.ok(Date.now() < deadline, 'Visibility contention exceeded30seconds')
  const [target] = JSON.parse(execFileSync('docker', ['inspect', containerId], { encoding: 'utf8', timeout: 5000 }))
  assert.equal(target.Id, containerId)
  assert.equal(target.Config.Labels?.['pika.home-visibility.owner'], owner)
  assert.notEqual(target.Config.Labels?.['com.supabase.cli.project'], 'pika')
  assert.equal(target.HostConfig.NetworkMode, 'none')
  assert.equal(Object.keys(target.HostConfig.PortBindings ?? {}).length, 0)
  assert.equal(target.State.Running, true)
}
verifyTarget()
const sqlArgs = ['exec', '-i', containerId, 'psql', '-U', 'postgres', '-d', 'postgres', '-XqAt', '-v', 'ON_ERROR_STOP=1']
function sql(input) {
  verifyTarget()
  return execFileSync('docker', sqlArgs, { input, encoding: 'utf8', timeout: 5000, maxBuffer: 262144 }).trim()
}
function connection(label) {
  const child = spawn('docker', sqlArgs, { stdio: 'pipe' })
  let pending
  let serial = 0
  let stdout = ''
  let stderr = ''
  let failure
  let exited = false
  const closed = new Promise(resolve => child.on('close', code => {
    exited = true
    if (code !== 0 || pending) {
      failure ??= new Error(`Visibility ${label} exited${code}: ${stderr}`)
      pending?.reject(failure)
      pending = undefined
    }
    resolve()
  }))
  function abort(error) {
    failure ??= error
    pending?.reject(failure)
    pending = undefined
    child.stdin.destroy()
    child.kill('SIGTERM')
  }
  child.on('error', abort)
  child.stdin.on('error', abort)
  child.stderr.on('data', data => {
    stderr += data.toString()
    if (stderr.length > 262144) abort(new Error('Visibility stderr exceeded bound'))
  })
  child.stdout.on('data', data => {
    stdout += data.toString()
    if (stdout.length > 262144) return abort(new Error('Visibility stdout exceeded bound'))
    if (!pending) return
    const marker = `${pending.marker}\n`
    const index = stdout.indexOf(marker)
    if (index < 0) return
    assert.ok(index === 0 || stdout[index - 1] === '\n')
    assert.equal(stdout.slice(index + marker.length).trim(), '')
    const request = pending
    pending = undefined
    const result = stdout.slice(0, index).trim()
    stdout = ''
    request.resolve(result)
  })
  return {
    run(input) {
      assert.equal(pending, undefined)
      if (failure || exited) return Promise.reject(failure ?? new Error('Visibility connection closed'))
      return new Promise((resolve, reject) => {
        const marker = `visibility_${label}_${++serial}`
        pending = { marker, resolve, reject }
        child.stdin.write(`${input}\n\\echo ${marker}\n`)
      })
    },
    async close() { if (!exited) child.stdin.end('rollback;\n\\q\n'); await closed; if (failure) throw failure },
    abort,
  }
}

sql(`begin;
insert into public.users(id,email,role) values
 ('d2910000-0000-4000-8000-000000000001','visibility-lock-owner@example.invalid','teacher'),
 ('d2910000-0000-4000-8000-000000000002','visibility-lock-member@example.invalid','teacher');
insert into public.effective_feature_entitlements(subject_user_id,feature_key,source,enabled,starts_at,quota_limit,revision)
 select id,'classrooms.create','manual',true,'2020-01-01',null,1 from public.users where id in
 ('d2910000-0000-4000-8000-000000000001','d2910000-0000-4000-8000-000000000002')
 on conflict(subject_user_id,feature_key) do update set enabled=true,expires_at=null,quota_limit=null;
insert into public.classrooms(id,teacher_id,title,class_code) values
 ('d2910000-0000-4000-8000-000000000010','d2910000-0000-4000-8000-000000000001','Visibility lock proof','HVL291');
insert into public.classroom_enrollments(id,classroom_id,student_id) values
 ('d2910000-0000-4000-8000-000000000020','d2910000-0000-4000-8000-000000000010','d2910000-0000-4000-8000-000000000002');
commit;`)
const holder = connection('holder')
const waiter = connection('waiter')
const timer = setTimeout(() => {
  const error = new Error('Visibility contention deadline exceeded')
  holder.abort(error)
  waiter.abort(error)
}, 30000)
try {
  await holder.run(`begin; set local statement_timeout='5s'; set local role service_role;
select public.set_classroom_home_visibility_v1('d2910000-0000-4000-8000-000000000002',
 'd2910000-0000-4000-8000-000000000010','d2910000-0000-4000-8000-000000000020',true);
reset role;`)
  await waiter.run("set application_name='pika_home_visibility_waiter'; set statement_timeout='5s'; set lock_timeout='2s';")
  // The real write holds class/enrollment SHARE row locks. Each independent
  // mutation below must actually wait on one, then fail its bounded timeout.
  for (const [label, mutation] of [
    ['remove-rejoin', `delete from public.classroom_enrollments where id='d2910000-0000-4000-8000-000000000020';
      insert into public.classroom_enrollments(classroom_id,student_id) values ('d2910000-0000-4000-8000-000000000010','d2910000-0000-4000-8000-000000000002');`],
    ['owner', "update public.classrooms set teacher_id='d2910000-0000-4000-8000-000000000002' where id='d2910000-0000-4000-8000-000000000010';"],
    ['archive', "update public.classrooms set archived_at=clock_timestamp() where id='d2910000-0000-4000-8000-000000000010';"],
  ]) {
    verifyTarget()
    const query = waiter.run(`do $proof$ declare started timestamptz:=clock_timestamp(); begin
      begin ${mutation} raise exception 'Mutation crossed visibility transaction';
      exception when lock_not_available then
        if clock_timestamp()-started<interval '1 second' then raise exception 'No actual lock wait'; end if;
      end;
    end; $proof$;`)
    let observed = false
    for (let attempt = 0; attempt < 20; attempt++) {
      if (sql("select count(*) from pg_stat_activity where application_name='pika_home_visibility_waiter' and wait_event_type='Lock'") === '1') { observed = true; break }
      await delay(50)
    }
    await query
    assert.ok(observed, `${label} actual lock wait was not observed`)
    console.log(`PASS ${label}: actual second-session lock wait and bounded denial`)
  }
  const state = JSON.parse(sql(`select jsonb_build_object('owner',teacher_id,'archived',archived_at,
    'enrollment',(select id from public.classroom_enrollments where classroom_id=c.id and student_id='d2910000-0000-4000-8000-000000000002'))
    from public.classrooms c where id='d2910000-0000-4000-8000-000000000010'`))
  assert.deepEqual(state, { owner: 'd2910000-0000-4000-8000-000000000001', archived: null, enrollment: 'd2910000-0000-4000-8000-000000000020' })
  await holder.run('rollback;')
  assert.equal(sql("select count(*) from private.classroom_home_hidden_enrollments where enrollment_id='d2910000-0000-4000-8000-000000000020'"), '0')
  verifyTarget()
} finally {
  clearTimeout(timer)
  const results = await Promise.allSettled([holder.close(), waiter.close()])
  for (const result of results) if (result.status === 'rejected') throw result.reason
}
