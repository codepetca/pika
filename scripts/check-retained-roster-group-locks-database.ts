/** Source-reviewed local proof; execute only after separately authorized migration 239 application.
 * No fixtures or DML. This proves two-session advisory exclusion and downstream owner denial,
 * not positive group/page results, provider behavior, or a finalization race.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export type ChildFactory = (file: string, args: readonly string[]) => ChildProcessWithoutNullStreams
type Deadlines = { commandMs: number; statementMs: number; closeMs: number; totalMs: number }
const DEFAULT_DEADLINES: Deadlines = { commandMs: 10_000, statementMs: 65_000, closeMs: 5_000, totalMs: 180_000 }
const CONTAINER = 'supabase_db_pika'
const LIMIT = 4 * 1024 * 1024
const nativeFactory: ChildFactory = (file, args) => spawn(file, [...args], { stdio: 'pipe', shell: false })

export function parseLockProofArgs(args: string[]): { forceFailure: boolean } {
  if (args.length === 0) return { forceFailure: false }
  if (args.length === 1 && args[0] === '--force-failure') return { forceFailure: true }
  throw new Error('Invalid proof arguments')
}

export function validateLocalTarget(target: { project: string; ports: string; status: string }): void {
  try {
    const bindings = target.ports.trim().split(/\r?\n/)
    const status: unknown = JSON.parse(target.status)
    if (typeof status !== 'object' || status === null) throw new Error()
    const value = status as Record<string, unknown>
    if (typeof value.DB_URL !== 'string') throw new Error()
    const db = new URL(value.DB_URL)
    if (target.project.trim() !== 'pika' || bindings.length === 0
      || bindings.some(binding => !/^(127\.0\.0\.1|\[::1\]|0\.0\.0\.0|\[::\]):54322$/.test(binding))
      || value.API_URL !== 'http://127.0.0.1:54321'
      || !['postgres:', 'postgresql:'].includes(db.protocol)
      || !['127.0.0.1', 'localhost', '[::1]'].includes(db.hostname)
      || db.port !== '54322' || db.pathname !== '/postgres' || db.search || db.hash) throw new Error()
  } catch { throw new Error('Local proof target rejected') }
}

function command(factory: ChildFactory, file: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolveResult, reject) => {
    const child = factory(file, args)
    let output = '', settled = false
    const timer = setTimeout(() => fail(), timeoutMs)
    const fail = () => {
      if (settled) return
      settled = true; clearTimeout(timer); child.kill('SIGKILL')
      reject(new Error('Proof command failed'))
    }
    child.stdout.on('data', chunk => { output += String(chunk); if (output.length > LIMIT) fail() })
    child.stderr.on('data', () => { /* Credentials/errors remain private. */ })
    child.stdin.on('error', fail)
    child.on('error', fail)
    child.on('close', code => {
      if (settled) return
      if (code !== 0) { fail(); return }
      settled = true; clearTimeout(timer); resolveResult(output.trim())
    })
    child.stdin.end()
  })
}

class Session {
  readonly child: ChildProcessWithoutNullStreams
  readonly done: Promise<void>
  backendPid: number | undefined
  private closed = false
  private failed = false
  private output = ''
  private errors = ''
  private pending: { marker: string; timer: ReturnType<typeof setTimeout>; resolve: (value: { stdout: string; stderr: string }) => void; reject: (error: Error) => void } | undefined

  constructor(readonly name: string, factory: ChildFactory, private deadlines: Deadlines) {
    this.child = factory('docker', ['exec', '-i', '-e', `PGAPPNAME=${name}`, CONTAINER,
      'psql', '-U', 'postgres', '-d', 'postgres', '-XqAt', '-v', 'ON_ERROR_STOP=1'])
    this.done = new Promise(resolveDone => this.child.on('close', () => {
      this.closed = true; this.fail(); resolveDone()
    }))
    this.child.stdout.on('data', chunk => {
      this.output += String(chunk)
      if (this.output.length > LIMIT) { this.fail(); return }
      if (!this.pending) return
      const lines = this.output.split(/\r?\n/)
      const at = lines.indexOf(this.pending.marker)
      if (at < 0) return
      const pending = this.pending; this.pending = undefined; clearTimeout(pending.timer)
      pending.resolve({ stdout: lines.slice(0, at).join('\n').trim(), stderr: this.errors })
    })
    this.child.stderr.on('data', chunk => {
      this.errors += String(chunk); if (this.errors.length > LIMIT) this.fail()
    })
    this.child.on('error', () => this.fail())
    this.child.stdin.on('error', () => this.fail())
  }

  fail(): void {
    this.failed = true
    if (this.pending) {
      const pending = this.pending; this.pending = undefined; clearTimeout(pending.timer)
      pending.reject(new Error('Proof session failed'))
    }
  }

  run(sql: string): Promise<{ stdout: string; stderr: string }> {
    if (this.closed || this.failed || this.pending) return Promise.reject(new Error('Proof session unavailable'))
    this.output = ''; this.errors = ''
    const marker = `proof_${randomUUID().replaceAll('-', '_')}`
    return new Promise((resolveResult, reject) => {
      const timer = setTimeout(() => { this.fail(); this.child.kill('SIGKILL') }, this.deadlines.statementMs)
      this.pending = { marker, timer, resolve: resolveResult, reject }
      this.child.stdin.write(`${sql}\n\\echo ${marker}\n`)
    })
  }

  async initialize(): Promise<void> {
    const output = await this.run("set statement_timeout='60s'; set lock_timeout='3s'; set idle_in_transaction_session_timeout='90s'; select pg_backend_pid();")
    if (!/^[1-9][0-9]*$/.test(output.stdout)) throw new Error('Proof session identity missing')
    this.backendPid = Number(output.stdout)
  }

  async close(): Promise<boolean> {
    if (this.closed) return true
    this.child.stdin.end('ROLLBACK;\n\\q\n')
    let timer: ReturnType<typeof setTimeout> | undefined
    const orderly = await Promise.race([
      this.done.then(() => true),
      new Promise<boolean>(resolveClose => { timer = setTimeout(() => {
        this.child.kill('SIGKILL'); resolveClose(false)
      }, this.deadlines.closeMs) }),
    ])
    clearTimeout(timer)
    return orderly
  }
}

const q = (uuid: string) => `'${uuid}'::uuid`
const PREFLIGHT = `do $proof$ declare signature text:='public.discover_retained_student_cleanup_groups(uuid,uuid,uuid,uuid,boolean,text)';
  helper text:='private.retained_roster_cleanup_group(uuid,uuid,uuid,uuid)'; role_name text;
begin
  if not exists(select 1 from supabase_migrations.schema_migrations where version='239')
    or to_regprocedure(signature) is null or to_regprocedure(helper) is null then raise exception 'Reviewed239 required'; end if;
  foreach role_name in array array['anon','authenticated','service_role'] loop
    if has_function_privilege(role_name,helper,'execute')
      or has_function_privilege(role_name,signature,'execute') is distinct from (role_name='service_role') then
      raise exception 'Proof ACL rejected'; end if;
  end loop;
  if exists(select 1 from pg_proc p,lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where p.oid in (to_regprocedure(signature),to_regprocedure(helper)) and a.grantee=0 and a.privilege_type='EXECUTE') then
    raise exception 'Proof PUBLIC ACL rejected'; end if;
  if coalesce((select enabled or live_enabled or automatic_enabled from private.student_provider_cleanup_settings where singleton),false)
    or coalesce((select enabled from private.removed_student_academic_settings where singleton),false) then
    raise exception 'Cleanup settings must remain disabled'; end if;
end; $proof$;`

// All data is hashed inside PostgreSQL and captured privately; no temporary functions/tables or settings toggles.
export const RETAINED_GROUP_PROOF_FINGERPRINT_SQL = `-- PROOF_FINGERPRINT: private stdout only
begin isolation level repeatable read read only;
select format('select jsonb_build_object(''table'',%L,''count'',count(*),''digest'',md5(coalesce(string_agg(md5(to_jsonb(r)::text),'''' order by md5(to_jsonb(r)::text)),''''))) from %I.%I r',
  n.nspname||'.'||c.relname,n.nspname,c.relname)
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where c.relkind in ('r','p') and n.nspname in ('public','private','storage') order by n.nspname,c.relname
\\gexec
  select jsonb_build_object(
    'metadata',jsonb_build_object(
    'functions',(select jsonb_object_agg(signature,md5(pg_get_functiondef(signature::regprocedure))) from unnest(array[
      'private.pal_membership_scope(uuid,uuid)','private.guard_pal_membership_evidence()',
      'private.register_pal_membership(uuid,uuid,uuid,text)','private.track_pal_membership_enrollment()',
      'private.track_pal_removed_roster()','public.resolve_pal_membership(uuid,uuid)']) signatures(signature)),
    'triggers',(select jsonb_agg(jsonb_build_object('definition',md5(pg_get_triggerdef(t.oid)),'enabled',t.tgenabled) order by t.tgname)
      from pg_trigger t where t.tgfoid=any(array['private.guard_pal_membership_evidence()'::regprocedure,
        'private.track_pal_membership_enrollment()'::regprocedure,'private.track_pal_removed_roster()'::regprocedure])),
    'tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,'acl',c.relacl) order by c.relname)
      from pg_class c where c.oid in ('private.pal_membership_generations'::regclass,'private.pal_membership_settings'::regclass)),
    'settings',(select md5(string_agg(name||'='||setting,chr(10) order by name)) from pg_settings),
    'singleton_index',md5(pg_get_indexdef('public.classroom_roster_one_removed_membership_per_student'::regclass))
  ));
rollback;`

async function fingerprint(session: Session): Promise<string> {
  const result = await session.run(RETAINED_GROUP_PROOF_FINGERPRINT_SQL)
  if (!result.stdout) throw new Error('Proof baseline missing')
  try { return JSON.stringify(result.stdout.split(/\r?\n/).map(line => JSON.parse(line))) }
  catch { throw new Error('Proof baseline invalid') }
}

function expectDenied(call: string, state: '40001' | '42501', message: string, service = false): string {
  return `begin; ${service ? 'set local role service_role;' : ''}
do $proof$ begin
  begin
    perform ${call};
    raise exception 'Proof unexpectedly admitted call';
  exception when others then
    if SQLSTATE <> '${state}' or SQLERRM <> '${message}' then
      raise exception using errcode='${state}',message='Proof denial differs';
    end if;
  end;
end; $proof$; rollback;`
}

export async function runRetainedRosterGroupLockProof(options: {
  factory?: ChildFactory; forceFailure?: boolean; deadlines?: Deadlines
} = {}): Promise<void> {
  const factory = options.factory ?? nativeFactory
  const deadlines = options.deadlines ?? DEFAULT_DEADLINES
  for (const value of Object.values(deadlines)) if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid proof deadline')
  const project = await command(factory, 'docker', ['inspect', CONTAINER, '--format', '{{ index .Config.Labels "com.supabase.cli.project" }}'], deadlines.commandMs)
  const ports = await command(factory, 'docker', ['port', CONTAINER, '5432/tcp'], deadlines.commandMs)
  const status = await command(factory, 'supabase', ['status', '-o', 'json'], deadlines.commandMs)
  validateLocalTarget({ project, ports, status })
  const tag = `pika_rg_lock_${randomUUID().replaceAll('-', '')}`
  const sessions: Session[] = []
  let failed = true
  const abort = () => { for (const session of sessions) { session.fail(); session.child.kill('SIGKILL') } }
  const timer = setTimeout(abort, deadlines.totalMs)
  process.once('SIGINT', abort); process.once('SIGTERM', abort)
  try {
    const contender = new Session(`${tag}_contender`, factory, deadlines); sessions.push(contender)
    await contender.initialize()
    await contender.run(PREFLIGHT)
    const baseline = await fingerprint(contender)
    const classroom = randomUUID(), otherClassroom = randomUUID(), student = randomUUID(), actor = randomUUID(), generation = randomUUID()
    // Verify the fresh identifiers refer to no persisted identity; never create a user/classroom/generation.
    await contender.run(`do $proof$ begin
      if exists(select 1 from public.classrooms where id in (${q(classroom)},${q(otherClassroom)}))
        or exists(select 1 from public.users where id in (${q(student)},${q(actor)}))
        or exists(select 1 from private.pal_membership_generations where generation_id=${q(generation)}) then
        raise exception 'Fresh proof identity collision'; end if;
    end; $proof$;`)
    const locker = new Session(`${tag}_locker`, factory, deadlines); sessions.push(locker)
    await locker.initialize()
    // The echo receipt is emitted only after the actual installed helper has returned with locks held.
    await locker.run(`begin; select private.try_lock_classroom_membership_change(${q(classroom)},${q(student)});`)
    const group = (course: string) => `private.retained_roster_cleanup_group(${q(actor)},${q(course)},${q(student)},${q(generation)})`
    const discovery = `public.discover_retained_student_cleanup_groups(${q(actor)},${q(classroom)},${q(student)},null,true,null)`
    await contender.run(expectDenied(group(classroom), '40001', 'classroom_operation_busy'))
    await contender.run(expectDenied(discovery, '40001', 'classroom_operation_busy', true))
    await contender.run(expectDenied(group(otherClassroom), '40001', 'student_operation_busy'))
    if (options.forceFailure) throw new Error('Forced proof failure')
    await locker.run('ROLLBACK;')
    await contender.run(expectDenied(group(classroom), '42501', 'student_provider_cleanup_forbidden'))
    await contender.run(expectDenied(discovery, '42501', 'student_provider_cleanup_forbidden', true))
    await contender.run(expectDenied(group(otherClassroom), '42501', 'student_provider_cleanup_forbidden'))
    if (baseline !== await fingerprint(contender)) throw new Error('Proof baseline changed')
    failed = false
  } finally {
    clearTimeout(timer); process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort)
    const closed = await Promise.all(sessions.map(session => session.close()))
    if (failed || closed.some(value => !value)) {
      // Docker CLI termination alone does not guarantee psql termination. Fence cleanup to this run's exact names/PIDs.
      const owned = sessions.map(session => `(application_name='${session.name}'${session.backendPid ? ` and pid=${session.backendPid}` : ''})`).join(' or ')
      if (owned) await command(factory, 'docker', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-XqAt', '-v', 'ON_ERROR_STOP=1',
        '-c', `set statement_timeout='3s'; select pg_terminate_backend(pid) from pg_stat_activity where pid<>pg_backend_pid() and (${owned});`], deadlines.commandMs)
      if (!failed) throw new Error('Proof session teardown failed')
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  Promise.resolve().then(() => runRetainedRosterGroupLockProof(parseLockProofArgs(process.argv.slice(2))))
    .then(() => process.stdout.write('PASS retained roster two-session advisory exclusion, downstream owner denial and unchanged baseline.\n'))
    .catch(() => { process.stderr.write('FAIL retained roster group lock proof; captured target/SQL data withheld.\n'); process.exitCode = 1 })
}
