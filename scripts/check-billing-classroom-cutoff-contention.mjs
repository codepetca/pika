// This proof writes only to the offline clone owned by the replay runner.
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
const [container, owner] = process.argv.slice(2)
assert.match(container, /^[a-f0-9]{64}$/)
assert.match(owner, /^\d+:[A-Za-z0-9]+$/)
const run = (args, input) => {
  const result = spawnSync('docker', args, { input, encoding: 'utf8', timeout: 10000 })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}
const info = JSON.parse(run(['inspect', container]))[0]
assert.equal(info.Id, container)
assert.equal(info.Config.Labels['pika.repolight-analysis-access.owner'], owner)
assert.equal(info.HostConfig.NetworkMode, 'none')
const args = ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-XAtq', '-v', 'ON_ERROR_STOP=1']
const sql = input => run(args, input)
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
function session(name) {
  const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', data => { stdout += data })
  child.stderr.on('data', data => { stderr += data })
  const done = new Promise(resolve => child.on('close', resolve))
  const send = query => child.stdin.write(query + '\n')
  send(`set application_name='${name}'; set lock_timeout='8s'; set statement_timeout='10s';`)
  return {
    send,
    child,
    async marker(marker) {
      for (let i = 0; i < 120; i++) {
        if (stdout.split('\n').includes(marker)) return
        if (child.exitCode !== null) throw new Error(stderr)
        await wait(25)
      }
      throw new Error(`Missing ${marker} ${stderr}`)
    },
    async close() {
      child.stdin.end()
      assert.equal(await done, 0, stderr)
    },
  }
}

async function verifyDirectClassroomContention(ids) {
  const holder = session('billing-publication-classroom-holder')
  const entrant = session('billing-publication-direct-entrant')
  try {
    holder.send(`begin; select id from public.classrooms where id=${ids.classroom} for update; select 'ready';`)
    await holder.marker('ready')
    entrant.send(`do $$ begin
      update public.assignments set is_draft=false,released_at=clock_timestamp() where id=${ids.work};
      raise exception 'Legacy publication acquired a held classroom lock';
    exception when sqlstate 'PT409' then
      if sqlerrm<>'billing_assignment_publication_busy' then raise; end if;
    end $$; select 'busy';`)
    await entrant.marker('busy')
    await entrant.close()
    holder.send('commit;')
    await holder.close()
    console.log('PASS 310 direct publication returned a conflict while the classroom lock was held.')
  } finally {
    holder.child.kill()
    entrant.child.kill()
  }
}

async function verifyCutoff(version, buildCase) {
  const ids = Object.fromEntries(['owner', 'student', 'classroom', 'work'].map((name, index) => [
    name, `'b${version}0000-0000-4000-8000-00000000000${index + 1}'::uuid`,
  ]))
  const { fixture, operation, verifyUnchanged, verifyContention } = buildCase(ids)
  sql(`begin;
    update private.stripe_billing_settings set sandbox_enabled=true,classroom_new_work_cutoff_enabled=true where singleton;
    insert into public.users(id,email,role) values(${ids.owner},'race${version}-owner@example.invalid','teacher'),
      (${ids.student},'race${version}-learner@example.invalid','student');
    select public.set_account_plan_v1(gen_random_uuid(),${ids.owner},'free','test:billing-cutoff-race','fixture',0)
      where not exists(select 1 from public.account_plans where subject_user_id=${ids.owner});
    select public.billing_start_trial_v1(jsonb_build_object('subject_user_id',${ids.owner},'operation_id',gen_random_uuid()));
    insert into public.classrooms(id,teacher_id,title,class_code) values(${ids.classroom},${ids.owner},'Cutoff race','CUT${version}02');
    insert into public.classroom_enrollments(classroom_id,student_id) values(${ids.classroom},${ids.student});
    ${fixture};
    commit;`)
  await verifyContention?.(ids)
  const cutoff = Number(sql(`with point as (select clock_timestamp()+interval '6 seconds' as cutoff),
    trial as (update public.billing_trials set started_at=cutoff-interval '720 hours',ends_at=cutoff from point
      where subject_user_id=${ids.owner}),
    access as (update public.billing_account_access set starts_at=cutoff-interval '720 hours',access_ends_at=cutoff from point
      where subject_user_id=${ids.owner}),
    entitlement as (update public.effective_feature_entitlements set starts_at=cutoff-interval '720 hours',expires_at=cutoff from point
      where subject_user_id=${ids.owner} and feature_key='classrooms.create')
    select ceil(extract(epoch from cutoff)*1000) from point;`))
  const holder = session(`billing-cutoff-${version}-holder`)
  const entrant = session(`billing-cutoff-${version}-entrant`)
  try {
    holder.send(`begin; select pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||${ids.owner}::text,20620260924)); select 'ready';`)
    await holder.marker('ready')
    entrant.send(`do $$ begin
      perform ${operation};
      raise exception 'New work reused a pre-wait timestamp';
    exception when sqlstate 'PT403' then
      if sqlerrm<>'billing_classroom_new_work_unavailable' then raise; end if;
    end $$; select 'denied';`)
    let blocked = false
    for (let i = 0; i < 25; i++) {
      blocked = sql(`select count(*) from pg_stat_activity where application_name='billing-cutoff-${version}-entrant' and wait_event='advisory';`) === '1'
      if (blocked) break
      await wait(40)
    }
    assert.ok(blocked && Date.now() < cutoff, 'New work must enter the lock wait before expiry')
    await wait(Math.max(0, cutoff - Date.now() + 150))
    holder.send('commit;')
    await holder.close()
    await entrant.marker('denied')
    await entrant.close()
    verifyUnchanged()
    console.log(`PASS ${version} waited on the billing fence, crossed cutoff and left the work unchanged.`)
  } finally {
    holder.child.kill()
    entrant.child.kill()
  }
}

await verifyCutoff('308', ids => ({
  fixture: `insert into public.tests(id,classroom_id,title,status,points_possible,created_by)
    values(${ids.work},${ids.classroom},'Race','active',1,${ids.owner})`,
  operation: `public.start_test_attempt_revision_atomic(${ids.work},${ids.student})`,
  verifyUnchanged() {
    assert.equal(sql(`select count(*) from public.test_attempts where test_id=${ids.work};`), '0')
    assert.equal(sql(`select (questions_locked_at is null)::text from public.tests where id=${ids.work};`), 'true')
  },
}))

await verifyCutoff('310', ids => ({
  fixture: `insert into public.assignments(id,classroom_id,created_by,title,due_at)
    values(${ids.work},${ids.classroom},${ids.owner},'Race',clock_timestamp()+interval '1 day')`,
  operation: `public.release_assignment_for_owner_v1(${ids.owner},${ids.work},clock_timestamp(),false)`,
  verifyContention: verifyDirectClassroomContention,
  verifyUnchanged() {
    assert.equal(sql(`select (is_draft and released_at is null)::text from public.assignments where id=${ids.work};`), 'true')
  },
}))
