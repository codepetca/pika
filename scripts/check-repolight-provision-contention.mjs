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
const actor = "'f298c000-0000-4000-8000-000000000001'::uuid"
const subject = 'f298c000-0000-4000-8000-000000000001'
const claim = `select public.repolight_provision_outbox_v1('claim',jsonb_build_object('teacherId',${actor}));`
const sessions = []
function candidate() { return `jsonb_build_object('teacherId',${actor},'tenantRef','opaque298-race','operationRef','f298c000-0000-4000-8000-000000000010','keyId','f298c000-0000-4000-8000-000000000011','secretHash',repeat('b',64),'connectionRef','race298','apiOrigin','https://reports.example.test','installationRef','race298','encryptedKey',jsonb_build_object('ciphertext','encrypted'),'operationKind','provision','expectedKeyId',null,'state','pending','workspaceRef',null)` }
const prepare = `public.prepare_repolight_managed_connection_v1(${actor},${candidate()})`
const activate = `public.activate_repolight_managed_connection_v1(${actor},${candidate()},'workspace298-race')`
const expectDenied = expression => `do $$begin perform ${expression};raise exception 'Cutoff admitted provisioning';exception when insufficient_privilege then null;end$$;`
try {
  sql(`begin;update private.repolight_settings set managed_provisioning_enabled=true,legacy_plan_access_enabled=false where singleton;
    insert into public.users(id,email,role) values(${actor},'repolight298-race@example.invalid','student');
    select public.set_account_plan_v1(gen_random_uuid(),${actor},'plus','test:298-race','fixture',coalesce((select revision from public.account_plans where subject_user_id=${actor}),0));commit;`)
  const firstClaim=JSON.parse(sql(claim))
  assert.equal(firstClaim.teacherId,subject)
  // Hold the queue row so finish reads the OLD epoch, then waits before writing
  // its denial. Enabling eligibility must neither wait on that row nor lose the
  // late denial: the next bounded repair sees the retained old lease epoch.
  let holder=new Session('repolight298-epoch-holder');sessions.push(holder)
  holder.send(`begin;select 1 from private.repolight_provision_outbox where teacher_id=${actor} for update;select 'row-held';`)
  await holder.marker('row-held')
  let contender=new Session('repolight298-denial-contender');sessions.push(contender)
  contender.send(`select public.repolight_provision_outbox_v1('finish','${JSON.stringify({teacherId:subject,leaseToken:firstClaim.leaseToken,outcome:'ineligible'})}'::jsonb);select 'denial-finished';`)
  await blocked(contender,'billing-settings')
  sql('update private.repolight_settings set legacy_plan_access_enabled=true where singleton;')
  holder.send('commit;');await holder.finish()
  await contender.marker('denial-finished');await contender.finish()
  const repaired=JSON.parse(sql(claim));assert.equal(repaired.attempt,1)
  assert.equal(sql(`select state from private.repolight_provision_outbox where teacher_id=${actor};`),'processing')

  // A disable which wins the settings fence stops a waiting prepare, even when
  // a worker already owns an outbox lease.
  holder=new Session('repolight298-disable-holder');sessions.push(holder)
  holder.send("begin;update private.repolight_settings set managed_provisioning_enabled=false where singleton;select 'disabled-held';")
  await holder.marker('disabled-held')
  contender=new Session('repolight298-prepare-contender');sessions.push(contender)
  contender.send(`${expectDenied(prepare)}select 'prepare-denied';`)
  await blocked(contender,'billing-settings')
  holder.send('commit;');await holder.finish()
  await contender.marker('prepare-denied');await contender.finish()
  assert.equal(sql(`select count(*) from private.repolight_managed_connections where teacher_id=${actor};`),'0')

  // An authorized prepare holds the settings share fence through its commit.
  // The subsequent disable waits, then prevents activation of the saved key.
  sql('update private.repolight_settings set managed_provisioning_enabled=true where singleton;')
  holder=new Session('repolight298-prepare-holder');sessions.push(holder)
  holder.send(`begin;select ${prepare};select 'prepared-held';`)
  await holder.marker('prepared-held')
  contender=new Session('repolight298-disable-contender');sessions.push(contender)
  contender.send("update private.repolight_settings set managed_provisioning_enabled=false where singleton;select 'disabled-committed';")
  await blocked(contender,'billing-settings')
  holder.send('commit;');await holder.finish()
  await contender.marker('disabled-committed');await contender.finish()
  sql(expectDenied(activate))
  assert.equal(sql(`select state from private.repolight_managed_connections where teacher_id=${actor};`),'pending')
  // Activation itself takes the same settings fence before owner locks.
  sql('update private.repolight_settings set managed_provisioning_enabled=true where singleton;')
  holder=new Session('repolight298-activation-disable-holder');sessions.push(holder)
  holder.send("begin;update private.repolight_settings set managed_provisioning_enabled=false where singleton;select 'activation-disable-held';")
  await holder.marker('activation-disable-held')
  contender=new Session('repolight298-activation-contender');sessions.push(contender)
  contender.send(`${expectDenied(activate)}select 'activation-denied';`)
  await blocked(contender,'billing-settings')
  holder.send('commit;');await holder.finish()
  await contender.marker('activation-denied');await contender.finish()
  assert.equal(sql(`select state from private.repolight_managed_connections where teacher_id=${actor};`),'pending')
  console.log('PASS actual296–298 gate epoch/late-denial and prepare/activation cutoff interleavings.')
} finally {
  for(const session of sessions) if(session.child.exitCode===null) session.child.kill('SIGTERM')
}
