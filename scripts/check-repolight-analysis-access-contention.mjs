/** Actual two-session checks; only the owned offline replay container is accepted. */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'

const [container, owner] = process.argv.slice(2)
assert.match(container ?? '', /^[a-f0-9]{64}$/)
assert.match(owner ?? '', /^\d+:[A-Za-z0-9]+$/)
function command(args, input) {
  const r = spawnSync('docker', args, { input, encoding: 'utf8', timeout: 15000, maxBuffer: 2 ** 20 })
  assert.equal(r.status, 0, r.stderr)
  return r.stdout.trim()
}
const metadata = JSON.parse(command(['inspect', container]))[0]
assert.equal(metadata.Id, container)
assert.equal(metadata.Config.Labels['pika.repolight-analysis-access.owner'], owner)
assert.equal(metadata.HostConfig.NetworkMode, 'none')
const base = ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-XAt', '-v', 'ON_ERROR_STOP=1']
const sql = input => command(base, input)
const actor = "'f296c000-0000-4000-8000-000000000001'::uuid"
const fence = `select pg_advisory_xact_lock(hashtextextended('account-plan-subject:'||${actor}::text,20620260924));`
const access = `select public.get_repolight_analysis_access_v1(${actor});`
const trialActor = "'f296c000-0000-4000-8000-000000000002'::uuid"
const classroom = "'f296c000-0000-4000-8000-000000000010'::uuid"
const assignment = "'f296c000-0000-4000-8000-000000000020'::uuid"
const student = "'f296c000-0000-4000-8000-000000000003'::uuid"
const run = "'f296c000-0000-4000-8000-000000000040'::uuid"
const beginAnalysis = `public.begin_assignment_repolight_run_v1(${trialActor},${assignment},${student},${run},
  '{"connectionRef":"race_fixture","workspaceRef":"race_workspace","installationRef":"race_installation"}'::jsonb,
  '{"repositoryUrl":"https://github.com/example/project","period":{"startAt":"2026-09-01T04:00:00Z","endAt":"2026-10-25T04:00:00Z","timezone":"America/Toronto"},"scheduledProjectDates":null,"baselineReviewed":false,"exclusions":{"commitShas":[],"pathPrefixes":[],"botLogins":[]}}'::jsonb,
  (public.get_assignment_repolight_source_v1(${trialActor},${assignment},${student}))->'source')`
const deniedAdmission = `do $$ begin perform ${beginAnalysis}; raise exception 'Disabled sandbox admitted new analysis'; exception when sqlstate 'P2961' then null; end $$;`
const plan = name => `select public.set_account_plan_v1(gen_random_uuid(),${actor},'${name}','test:access-race','fixture',(select revision from public.account_plans where subject_user_id=${actor}));`
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
class Session {
  constructor(name) {
    this.name = name
    this.output = ''; this.error = ''
    this.child = spawn('docker', base, { stdio: ['pipe', 'pipe', 'pipe'] })
    this.child.stdout.on('data', bytes => { this.output += bytes })
    this.child.stderr.on('data', bytes => { this.error += bytes })
    this.done = new Promise(resolve => this.child.on('close', code => resolve(code)))
    this.send(`set application_name='${name}'; set lock_timeout='5s'; set statement_timeout='8s';`)
  }
  send(query) { this.child.stdin.write(query + '\n') }
  async marker(value) {
    for (let i = 0; i < 150; i++) {
      if (this.output.split('\n').includes(value)) return
      if (this.child.exitCode !== null) throw new Error(this.error)
      await wait(20)
    }
    throw new Error(`Missing barrier ${value}: ${this.error}`)
  }
  async finish() {
    this.child.stdin.end()
    assert.equal(await this.done, 0, this.error)
  }
}
async function blocked(session, kind = 'advisory') {
  for (let i = 0; i < 30; i++) {
    const event = kind === 'billing-settings' ? "wait_event_type='Lock' and wait_event in ('tuple','transactionid')" : "wait_event='advisory'"
    const result = sql(`select count(*) from pg_stat_activity where application_name='${session.name}' and ${event};`)
    if (result === '1') return
    await wait(30)
  }
  throw new Error(`Contender never waited on the ${kind} fence`)
}
const sessions = []
try {
  sql(`begin;
    update private.repolight_settings set plan_enforcement_enabled=true,legacy_plan_access_enabled=true where singleton;
    insert into public.users(id,email,role) values(${actor},'access-race296@example.invalid','teacher');
    do $$ begin if not exists(select 1 from public.account_plans where subject_user_id=${actor}) then
      perform public.set_account_plan_v1(gen_random_uuid(),${actor},'free','test:access-race','fixture',0); end if; end $$;
    ${plan('plus')} commit;`)

  // A downgrade which wins the fence must be visible to a waiting admission.
  let holder = new Session('repolight296-plan-holder'); sessions.push(holder)
  holder.send(`begin; ${plan('free')} select 'downgrade-ready';`)
  await holder.marker('downgrade-ready')
  let contender = new Session('repolight296-access-contender'); sessions.push(contender)
  contender.send(`${access} select 'access-done';`)
  await blocked(contender)
  holder.send('commit;'); await holder.finish()
  await contender.marker('access-done'); await contender.finish()
  let result = JSON.parse(contender.output.split('\n').find(line => line.startsWith('{')))
  assert.equal(result.allowed, false); assert.equal(result.reason, 'plan_not_included')

  // If admission wins, the writer waits for its transaction; later admissions
  // observe the committed downgrade. No network operation lives in this tx.
  sql(plan('plus'))
  holder = new Session('repolight296-access-holder'); sessions.push(holder)
  holder.send(`begin; ${access} select 'admission-ready';`)
  await holder.marker('admission-ready')
  result = JSON.parse(holder.output.split('\n').find(line => line.startsWith('{')))
  assert.equal(result.allowed, true)
  contender = new Session('repolight296-plan-contender'); sessions.push(contender)
  contender.send(`${plan('free')} select 'plan-done';`)
  await blocked(contender)
  holder.send('commit;'); await holder.finish()
  await contender.marker('plan-done'); await contender.finish()
  assert.equal(JSON.parse(sql(access)).allowed, false)

  // Time must be sampled after a plan-lock wait, not at function entry.
  sql(`${plan('plus')}
    update public.effective_feature_entitlements set expires_at=clock_timestamp()+interval '1 second'
      where subject_user_id=${actor} and feature_key='classrooms.create';`)
  holder = new Session('repolight296-expiry-holder'); sessions.push(holder)
  holder.send(`begin; ${fence} select 'expiry-ready';`)
  await holder.marker('expiry-ready')
  contender = new Session('repolight296-expiry-contender'); sessions.push(contender)
  contender.send(`${access} select 'expiry-done';`)
  await blocked(contender)
  await wait(1100)
  holder.send('commit;'); await holder.finish()
  await contender.marker('expiry-done'); await contender.finish()
  result = JSON.parse(contender.output.split('\n').find(line => line.startsWith('{')))
  assert.equal(result.allowed, false); assert.equal(result.reason, 'expired')

  sql(`begin;
    update private.repolight_settings set billing_access_enabled=true,enabled=true where singleton;
    update private.stripe_billing_settings set sandbox_enabled=true where singleton;
    insert into public.users(id,email,role) values
      (${trialActor},'access-race296-trial@example.invalid','teacher'),
      (${student},'access-race296-learner@example.invalid','student');
    do $$ begin if not exists(select 1 from public.account_plans where subject_user_id=${trialActor}) then
      perform public.set_account_plan_v1(gen_random_uuid(),${trialActor},'free','test:access-race','fixture',0); end if; end $$;
    select public.billing_start_trial_v1(jsonb_build_object('subject_user_id',${trialActor},'operation_id',gen_random_uuid()));
    insert into public.classrooms(id,teacher_id,title,class_code) values(${classroom},${trialActor},'Sandbox admission race','R296RC');
    insert into public.classroom_enrollments(classroom_id,student_id) values(${classroom},${student});
    insert into public.assignments(id,classroom_id,title,description,due_at,created_by,is_draft,released_at)
      values(${assignment},${classroom},'Sandbox race','','2026-10-25T04:00:00Z',${trialActor},false,'2026-09-01T04:00:00Z');
    insert into public.assignment_docs(assignment_id,student_id,repo_url) values(${assignment},${student},'https://github.com/example/project');
    commit;`)

  // A disable which wins the settings row prevents the actual begin RPC from
  // admitting work after it commits. An MVCC read without FOR SHARE fails here.
  holder = new Session('repolight296-disable-holder'); sessions.push(holder)
  holder.send("begin; update private.stripe_billing_settings set sandbox_enabled=false where singleton; select 'disable-ready';")
  await holder.marker('disable-ready')
  contender = new Session('repolight296-billing-contender'); sessions.push(contender)
  contender.send(`${deniedAdmission} select 'disabled-admission-denied';`)
  await blocked(contender, 'billing-settings')
  holder.send('commit;'); await holder.finish()
  await contender.marker('disabled-admission-denied'); await contender.finish()
  assert.equal(sql(`select count(*) from public.assignment_repolight_runs where id=${run};`), '0')
  assert.equal(JSON.parse(sql(`select public.get_repolight_analysis_access_v1(${trialActor});`)).reason, 'billing_access_disabled')

  // If admission wins, disabling must wait for its transaction, preserving a
  // clear database ordering. Future admissions observe the disabled setting.
  sql('update private.stripe_billing_settings set sandbox_enabled=true where singleton;')
  holder = new Session('repolight296-billing-holder'); sessions.push(holder)
  holder.send(`begin; select ${beginAnalysis}; select 'billing-admission-ready';`)
  await holder.marker('billing-admission-ready')
  contender = new Session('repolight296-disable-contender'); sessions.push(contender)
  contender.send("update private.stripe_billing_settings set sandbox_enabled=false where singleton; select 'disable-done';")
  await blocked(contender, 'billing-settings')
  holder.send('commit;'); await holder.finish()
  await contender.marker('disable-done'); await contender.finish()
  assert.equal(sql(`select count(*) from public.assignment_repolight_runs where id=${run};`), '1')
  sql(deniedAdmission)
  console.log('PASS actual sandbox-disable/analysis admission contention in both winning orders.')
  console.log('PASS actual plan/admission contention in both orders and expiry after lock wait.')
} finally {
  for (const session of sessions) {
    if (session.child.exitCode === null) session.child.kill('SIGTERM')
  }
  // This whole database is disposable. Committed race fixtures are destroyed
  // with the exact owned container by the invoking harness, never the shared DB.
}
