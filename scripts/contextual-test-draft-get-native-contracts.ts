/** Inert source preparation. Root reviews this complete finite manifest before
 * invocation inside the original disposable-project lifecycle. No CLI entrypoint. */
import assert from 'node:assert/strict'
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, normalize, resolve } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { AssignmentListProofFixture } from './contextual-assignment-list-proof-fixture'
import type { AssignmentListResource } from './contextual-assignment-list-proof-lifecycle'
import { testOwnerListDockerInventory } from './contextual-test-owner-list-proof-inventory'
import { validateIntegratedGuardResources } from './check-contextual-assignment-learner-integrated-lifecycle'
import { testOwnerDigest, testOwnerGuardSql } from './contextual-test-owner-detail-proof-fixture'
import {
  DRAFT_GET_CAPS, newDraftGetFixture, draftGetFixtureStatements, draftGetFixtureSnapshotSql,
  draftGetContractsManifest, draftGetMigrationManifestSha256, runDraftGetContracts,
  type DraftGetDriver, type DraftGetSession, type DraftGetTarget,
} from './check-contextual-test-draft-get-db-contracts'
import { draftGetConcurrencyManifest, runDraftGetConcurrency } from './check-contextual-test-draft-get-concurrency'

const CAPS = Object.freeze({ controlCalls: 4000, actions: 200, sessions: 2, controlMs: 45000, closeMs: 12000,
  actionMs: 90000, totalMs: 900000, outputBytes: 8 * 1024 * 1024, stderrBytes: 65536, totalBytes: 64 * 1024 * 1024 })
const failure = () => new Error('Private native Test draft contracts failed; exact project disposal required')

const diagnosticStages = ['pending', 'setup', 'privilege-catalog', 'privilege-revoke', 'privilege-probe', 'privilege-restoration', 'rollback-contracts', 'bounds-drift', 'concurrency', 'complete'] as const
const diagnosticPhases = ['idle', 'guard', 'control', 'bootstrap', 'sql', 'verify', 'probe', 'frame', 'terminate', 'rollback', 'restoration'] as const
const diagnosticKinds = ['none', 'unknown', 'assertion', 'control-limit', 'control-command', 'control-timeout', 'action-limit', 'action-timeout', 'child-exit', 'child-error', 'frame-decode', 'output-limit', 'total-budget', 'termination', 'restoration'] as const
const diagnosticSchedules = ['none', 'contextual_create', 'contextual_repair', 'legacy_raw_insert', 'legacy_same_draft', 'legacy_other_draft_revision', 'start', 'save', 'publish', 'archive', 'owner_transfer', 'test_move', 'purge_fence'] as const
/** No exception, SQL, child output, identity or catalog value enters this receipt.
 * First-failure context survives later rollback/restoration/termination work. */
export function createDraftGetNativeDiagnostic(now: () => number = Date.now) {
  const started = now()
  let stage: typeof diagnosticStages[number] = 'pending', phase: typeof diagnosticPhases[number] = 'idle'
  let schedule: typeof diagnosticSchedules[number] = 'none'
  let cleanup: 'none' | 'running' | 'complete' | 'failed' = 'none'
  let cleanupKind: typeof diagnosticKinds[number] = 'none'
  const bounded = (value: unknown, max: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(0, Math.floor(value))) : 0
  const enumValue = <T extends string>(values: readonly T[], value: unknown, fallback: T): T => values.includes(value as T) ? value as T : fallback
  function context() { return { stage, phase, schedule, elapsedMs: bounded(now() - started, CAPS.totalMs + CAPS.controlMs) } }
  let primary: ReturnType<typeof context> & { kind: typeof diagnosticKinds[number]; exitCode: number } | undefined
  return Object.freeze({
    stage(value: unknown) { stage = enumValue(diagnosticStages, value, 'pending') },
    phase(value: unknown) { phase = enumValue(diagnosticPhases, value, 'idle') },
    schedule(value: unknown) { schedule = enumValue(diagnosticSchedules, value, 'none') },
    fail(value: unknown, exitCode?: unknown) {
      primary ??= { ...context(), kind: enumValue(diagnosticKinds, value, 'unknown'), exitCode: typeof exitCode === 'number' && Number.isInteger(exitCode) && exitCode >= 0 && exitCode <= 255 ? exitCode : -1 }
    },
    cleanupStart() { if (cleanup !== 'failed') cleanup = 'running' },
    cleanupEnd(value?: unknown) {
      if (value !== undefined) { cleanup = 'failed'; if (cleanupKind === 'none') cleanupKind = enumValue(diagnosticKinds, value, 'unknown') }
      else if (cleanup !== 'failed') cleanup = 'complete'
    },
    receipt() { return Object.freeze({ ...(primary ?? { ...context(), kind: 'none', exitCode: -1 }), cleanup, cleanupKind }) },
    format() { return `DIAG test-owner-draft-get native ${JSON.stringify(this.receipt())}.\n` },
  })
}
const contextTemplate = '{"endpoints":{{json .Endpoints}},"tlsMaterial":{{json .TLSMaterial}}}'
const boot = `set statement_timeout='8s';set lock_timeout='1s';set idle_in_transaction_session_timeout='180s';
do $session$ begin if exists(select 1 from pg_stat_activity where application_name=current_setting('application_name') and pid<>pg_backend_pid())
then raise exception 'Reserved proof session already exists';end if;end;$session$;
select jsonb_build_object('pid',pg_backend_pid(),'started',(select backend_start from pg_stat_activity where pid=pg_backend_pid()),'name',current_setting('application_name'),'database',current_database(),'user',current_user);`
export function draftGetNativeTerminationSql() {
  return `begin;set local statement_timeout='8s';set local lock_timeout='1s';
select jsonb_build_object('present',exists(select 1 from pg_stat_activity where pid=:'owned_pid'::integer and backend_start=:'owned_started'::timestamptz),
'terminated',coalesce((select pg_terminate_backend(pid,5000) from pg_stat_activity where pid=:'owned_pid'::integer
and backend_start=:'owned_started'::timestamptz and application_name=:'owned_name' and datname='postgres' and usename='postgres' and pid<>pg_backend_pid()),false));rollback;`
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}
function snapshotPrivilegeSql() {
  const signature = 'public.snapshot_test_draft_for_owner_v1(uuid,uuid,timestamp with time zone)'
  const catalog = `begin read only;set local lock_timeout='1s';set local statement_timeout='8s';
select jsonb_build_object('owner',pg_get_userbyid(p.proowner),'definition',pg_get_functiondef(p.oid),
'acl',(select coalesce(jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(a.grantor),
'grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
'privilege_type',a.privilege_type,'is_grantable',a.is_grantable)
order by a.grantor,a.grantee,a.privilege_type,a.is_grantable),'[]'::jsonb)
from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a))
from pg_proc p where p.oid='${signature}'::regprocedure;rollback;`
  const revoke = `begin;set local lock_timeout='1s';set local statement_timeout='8s';
do $acl$ declare p record;begin select * into strict p from pg_proc where oid='${signature}'::regprocedure;
if pg_get_userbyid(p.proowner)<>'postgres'
or (select count(*) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))))<>2
or exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 where a.grantor<>p.proowner or a.grantee not in (p.proowner,'service_role'::regrole::oid) or a.privilege_type<>'EXECUTE' or a.is_grantable)
or not has_function_privilege('service_role','${signature}','execute')
then raise exception 'Snapshot ACL differs';end if;end;$acl$;
revoke execute on function ${signature} from service_role;commit;`
  const restore = `begin;set local lock_timeout='1s';set local statement_timeout='8s';
grant execute on function ${signature} to service_role;commit;`
  return freeze({ catalog, revoke, restore, expectedOwner: 'postgres', expectedRoles: ['postgres', 'service_role'],
    expectedEvidence: { status: 503, rpcCalls: 1, rawCode: '42501' }, probes: 1 })
}
type SnapshotCatalog = { owner: string; definition: string; acl: { grantor: string; grantee: string; privilege_type: string; is_grantable: boolean }[] }
function decodeSnapshotCatalog(rows: readonly { result?: unknown }[]): SnapshotCatalog {
  assert.equal(rows.length, 1)
  const value = rows[0].result; assert(value && typeof value === 'object' && !Array.isArray(value))
  const row = value as Record<string, unknown>
  assert.deepEqual(Object.keys(row).sort(), ['acl', 'definition', 'owner'])
  assert(typeof row.owner === 'string' && typeof row.definition === 'string' && row.definition.length > 0 && Array.isArray(row.acl))
  for (const value of row.acl) {
    assert(value && typeof value === 'object' && !Array.isArray(value))
    assert.deepEqual(Object.keys(value).sort(), ['grantee', 'grantor', 'is_grantable', 'privilege_type'])
    assert(typeof value.grantor === 'string' && typeof value.grantee === 'string' && typeof value.privilege_type === 'string' && typeof value.is_grantable === 'boolean')
  }
  return row as SnapshotCatalog
}
export function buildDraftGetNativeContractsManifest(original: AssignmentListProofFixture, reviewedHead: string, repository: string) {
  assert.match(reviewedHead, /^[a-f0-9]{40}$/)
  const fixture = newDraftGetFixture(original.manifest.syntheticTag.slice(-12))
  const originalIds = new Set(original.allocatedIds)
  assert(fixture.allowedFixtureIds.every(id => !originalIds.has(id)))
  const guard = testOwnerGuardSql(fixture.projectId)
  const setup = `${guard}\nbegin;set local lock_timeout='1s';set local statement_timeout='30s';\n${draftGetFixtureStatements(fixture)}\ncommit;`
  const contracts = draftGetContractsManifest(fixture)
  const concurrency = draftGetConcurrencyManifest(fixture)
  const snapshot = draftGetFixtureSnapshotSql(fixture)
  const sourceSha256 = testOwnerDigest(readFileSync(resolve(repository, 'supabase/migrations/247_contextual_test_draft_owner_get.sql'), 'utf8'))
  return freeze({ version: 1, reviewedHead, migrationManifestSha256: draftGetMigrationManifestSha256(repository), sourceSha256,
    fixture, guard, setup, contracts, concurrency, snapshot, bootstrap: boot, termination: draftGetNativeTerminationSql(),
    close: 'rollback;', capabilities: CAPS, framing: 'psql-echo-monotonic-v1', contextTemplate, privilege: snapshotPrivilegeSql() })
}
type Manifest = ReturnType<typeof buildDraftGetNativeContractsManifest>
export function validateDraftGetNativeSql(manifest: Manifest, sql: string) {
  if (typeof sql !== 'string' || Buffer.byteLength(sql) > DRAFT_GET_CAPS.sqlBytes) return false
  const fixed = [manifest.setup, manifest.snapshot, manifest.bootstrap, manifest.close, manifest.privilege.catalog, manifest.privilege.revoke, manifest.contracts.contracts,
    manifest.contracts.boundsAndDrift, manifest.concurrency.begin, manifest.concurrency.rollback,
    ...manifest.concurrency.schedules.flatMap(s => [s.snapshotSql, s.holderSql, ...(s.afterSql ? [s.afterSql] : [])])]
  if (fixed.includes(sql) && sql !== 'contextual') return true
  return manifest.concurrency.schedules.some(s => [s.finalTemplate, s.rejectTemplate].some(template => {
    const needle = `'${'0'.repeat(64)}'`; const first = template.indexOf(needle)
    if (first < 0 || template.indexOf(needle, first + 1) >= 0) return false
    const prefix = template.slice(0, first); const suffix = template.slice(first + needle.length)
    return sql.startsWith(prefix) && sql.endsWith(suffix) && /^'[a-f0-9]{64}'$/.test(sql.slice(prefix.length, sql.length - suffix.length))
  }))
}
type Backend = { pid: number; started: string; name: string; database: 'postgres'; user: 'postgres' }
function backend(value: unknown, name: string): Backend {
  assert(value && typeof value === 'object' && !Array.isArray(value)); const row = value as Record<string, unknown>
  assert.deepEqual(Object.keys(row).sort(), ['database', 'name', 'pid', 'started', 'user'])
  assert(Number.isSafeInteger(row.pid) && Number(row.pid) > 0 && Number(row.pid) <= 2147483647)
  assert(typeof row.started === 'string' && /^\d{4}-\d{2}-\d{2}T[0-9:.]+[+-][0-9:]+$/.test(row.started) && Number.isFinite(Date.parse(row.started)))
  assert.equal(row.name, name); assert.equal(row.database, 'postgres'); assert.equal(row.user, 'postgres')
  return row as Backend
}

export function createDraftGetNativeContracts(input: {
  repository: string; reviewedHead: string; original: AssignmentListProofFixture;
  capturedResources: readonly AssignmentListResource[]; containerId: string; acceptedManifestSha256: string;
}) {
  input = Object.freeze({ ...input })
  const manifest = buildDraftGetNativeContractsManifest(input.original, input.reviewedHead, input.repository)
  assert.equal(input.acceptedManifestSha256, testOwnerDigest(JSON.stringify(manifest)))
  assert.match(input.containerId, /^[a-f0-9]{64}$/)
  assert(isAbsolute(input.repository) && realpathSync(input.repository) === input.repository)
  const project = manifest.fixture.projectId
  const closure = structuredClone(input.capturedResources)
  const start = Date.now(); let controls = 0; let actions = 0; let exchanged = 0; let failed = false; let setupDone = false; let ran = false; let probed = false
  const sessions = new Set<NativeSession>()
  const diagnostic = createDraftGetNativeDiagnostic()
  let scheduleIndex = 0, concurrencyStarted = 0
  function recordError(error: unknown) { diagnostic.fail(error instanceof assert.AssertionError ? 'assertion' : 'unknown') }
  function nativeFailure(kind: typeof diagnosticKinds[number] = 'unknown', exitCode?: unknown) { diagnostic.fail(kind, exitCode); return failure() }
  let endpoint: { host: string; identity: number[] } | undefined
  function check() {
    if (Date.now() - start >= CAPS.totalMs) diagnostic.fail('total-budget')
    if (controls > CAPS.controlCalls - 32) diagnostic.fail('control-limit')
    assert(!failed && Date.now() - start < CAPS.totalMs && controls <= CAPS.controlCalls - 32)
  }
  function dockerArgs(name: string, variables: string[] = []) {
    assert([`${project}_fixture`, `${project}_draft_contracts`, `${project}_draft_holder`, `${project}_draft_contender`].includes(name))
    assert(endpoint)
    return ['--host', endpoint.host, 'exec', '-i', '-e', `PGAPPNAME=${name}`, input.containerId, 'psql', '-U', 'postgres', '-d', 'postgres',
      '-XqAt', '-P', 'pager=off', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=terse', ...variables]
  }
  function command(file: 'git' | 'docker', args: string[], sql?: string, timeout = CAPS.controlMs): Promise<string> {
    diagnostic.phase('control')
    if (controls >= CAPS.controlCalls) diagnostic.fail('control-limit')
    assert(++controls <= CAPS.controlCalls)
    return new Promise((resolveResult, reject) => {
      let inputFailed = false
      const child = execFile(file, args, { cwd: input.repository, encoding: 'utf8', timeout, killSignal: 'SIGKILL', maxBuffer: CAPS.outputBytes }, (error, stdout) => {
        if (error || inputFailed || Buffer.byteLength(stdout) > CAPS.outputBytes) reject(nativeFailure(Buffer.byteLength(stdout) > CAPS.outputBytes ? 'output-limit' : error?.killed ? 'control-timeout' : 'control-command', error?.code))
        else { exchanged += Buffer.byteLength(stdout); exchanged > CAPS.totalBytes ? reject(nativeFailure('output-limit')) : resolveResult(stdout.trim()) }
      })
      child.stdin?.on('error', () => { inputFailed = true; child.kill('SIGKILL') })
      child.stdin?.end(sql)
    })
  }
  async function verifyEndpoint() {
    assert(!Object.keys(process.env).some(name => /^(?:DOCKER_(?:HOST|CONTEXT|CONFIG|API_VERSION|TLS.*|CERT_PATH|CUSTOM_HEADERS)|(?:.*_)?PROXY)$/i.test(name)))
    const raw = JSON.parse(await command('docker', ['context', 'inspect', '--format', manifest.contextTemplate])) as {
      endpoints?: { docker?: { Host?: unknown; SkipTLSVerify?: unknown } }; tlsMaterial?: unknown;
    }
    assert(raw.endpoints && Object.keys(raw.endpoints).join(',') === 'docker')
    assert(raw.tlsMaterial === null || (typeof raw.tlsMaterial === 'object' && Object.keys(raw.tlsMaterial as object).length === 0))
    const docker = raw.endpoints.docker; assert(docker && Object.keys(docker).every(key => key === 'Host' || key === 'SkipTLSVerify'))
    assert(docker.SkipTLSVerify === false || docker.SkipTLSVerify === undefined)
    assert(typeof docker.Host === 'string' && docker.Host.startsWith('unix:///') && !/[\x00-\x20\x7f%?#]/.test(docker.Host))
    const path = docker.Host.slice('unix://'.length); assert(isAbsolute(path) && normalize(path) === path)
    const canonical = realpathSync(path); assert(isAbsolute(canonical) && normalize(canonical) === canonical && !/[\x00-\x20\x7f%?#]/.test(canonical))
    const socket = statSync(canonical); assert(socket.isSocket())
    const observed = { host: `unix://${canonical}`, identity: [socket.dev, socket.ino, socket.mode, socket.rdev] }
    if (endpoint) assert.deepEqual(observed, endpoint); else endpoint = observed
  }
  async function inventory(cleanup = false) {
    if (!cleanup) check()
    assert.equal(await command('git', ['rev-parse', 'HEAD']), input.reviewedHead)
    assert.equal(await command('git', ['rev-parse', '--show-toplevel']), input.repository)
    assert.equal(await command('git', ['status', '--porcelain']), '')
    assert.equal(draftGetMigrationManifestSha256(input.repository), manifest.migrationManifestSha256)
    assert.equal(testOwnerDigest(readFileSync(resolve(input.repository, 'supabase/migrations/247_contextual_test_draft_owner_get.sql'), 'utf8')), manifest.sourceSha256)
    await verifyEndpoint()
    const all = await testOwnerListDockerInventory()
    validateIntegratedGuardResources(all, project, input.containerId, closure as AssignmentListResource[])
    await verifyEndpoint()
    if (!cleanup) check()
  }
  async function guard(cleanup = false) {
    diagnostic.phase('guard')
    try {
      await inventory(cleanup)
      assert.equal(await command('docker', dockerArgs(`${project}_fixture`), manifest.guard), 'ok')
      if (!cleanup) check()
    } catch (error) { diagnostic.phase('guard'); recordError(error); throw error }
  }
  // On any failed dispatch, all exact owned backends are terminated and both
  // local docker children are reaped. A failed remote confirmation fails closed.
  async function terminate(owned: Backend) {
    await guard(true)
    const variables = ['-v', `owned_pid=${owned.pid}`, '-v', `owned_started=${owned.started}`, '-v', `owned_name=${owned.name}`]
    const text = await command('docker', dockerArgs(`${project}_fixture`, variables), manifest.termination, CAPS.closeMs)
    diagnostic.phase('terminate')
    const value = JSON.parse(text) as { present?: unknown; terminated?: unknown }
    assert.deepEqual(Object.keys(value).sort(), ['present', 'terminated'])
    assert(value.present === false || value.terminated === true, 'Remote termination unconfirmed')
  }
  async function closeAll() {
    failed = true
    const results = await Promise.allSettled([...sessions].map(session => session.destroy()))
    if (results.some(result => result.status === 'rejected')) throw nativeFailure()
  }
  class NativeSession implements DraftGetSession {
    readonly name: string
    private child: ChildProcessWithoutNullStreams
    private owned?: Backend
    private ended = false
    private closed: Promise<void>
    private active?: { reject: (error: Error) => void; finish: () => void; timer: ReturnType<typeof setTimeout>; end: string; lines: string[]; bytes: number }
    private partial = ''; private stderr = 0; private frame = 0; private closing?: Promise<void>
    private decoder = new StringDecoder('utf8')
    constructor(name: string) {
      this.name = name
      this.child = spawn('docker', dockerArgs(name), { cwd: input.repository, stdio: ['pipe', 'pipe', 'pipe'] })
      this.closed = new Promise(resolveClose => this.child.once('close', (code: unknown) => { if (this.active && !this.closing) diagnostic.fail('child-exit', code); this.ended = true; this.reject(); resolveClose() }))
      this.child.on('error', () => { if (!this.closing) diagnostic.fail('child-error'); this.reject(); void closeAll().catch(() => {}) })
      this.child.stdin.on('error', () => { if (!this.closing) diagnostic.fail('child-error'); this.reject(); void closeAll().catch(() => {}) })
      this.child.stdout.on('data', (chunk: Buffer) => {
        try {
          diagnostic.phase('frame')
          assert(Buffer.isBuffer(chunk)); if (chunk.length > CAPS.outputBytes - Buffer.byteLength(this.partial)) diagnostic.fail('output-limit')
          assert(chunk.length <= CAPS.outputBytes - Buffer.byteLength(this.partial))
          this.partial += this.decoder.write(chunk)
          for (;;) {
            const newline = this.partial.indexOf('\n'); if (newline < 0) break
            const line = this.partial.slice(0, newline).replace(/\r$/, ''); this.partial = this.partial.slice(newline + 1)
            assert(this.active)
            if (line === this.active.end) { this.active.finish(); continue }
            this.active.bytes += Buffer.byteLength(line); exchanged += Buffer.byteLength(line)
            if (this.active.bytes > CAPS.outputBytes || exchanged > CAPS.totalBytes) diagnostic.fail('output-limit')
            assert(this.active.bytes <= CAPS.outputBytes && exchanged <= CAPS.totalBytes)
            if (line) this.active.lines.push(line)
          }
        } catch { diagnostic.fail('frame-decode'); this.reject(); void closeAll().catch(() => {}) }
      })
      this.child.stderr.on('data', (chunk: Buffer) => { this.stderr += chunk.length; if (this.stderr > CAPS.stderrBytes) { diagnostic.fail('output-limit'); this.reject(); void closeAll().catch(() => {}) } })
    }
    private reject() { if (this.active) { clearTimeout(this.active.timer); this.active.reject(nativeFailure()); this.active = undefined } }
    private raw(sql: string, timeoutMs: number): Promise<readonly { result?: unknown }[]> {
      assert(!this.ended && !this.active); assert(timeoutMs > 0 && timeoutMs <= CAPS.actionMs)
      const marker = `__draft_get_end_${++this.frame}__`
      return new Promise((resolveRows, reject) => {
        const timer = setTimeout(() => { diagnostic.fail('action-timeout'); this.reject(); void closeAll().catch(() => {}) }, timeoutMs)
        this.active = { timer, reject, end: marker, bytes: 0, lines: [], finish: () => {
          const active = this.active!; this.active = undefined; clearTimeout(timer)
          try { resolveRows(active.lines.map(line => {
            try { return { result: JSON.parse(line) as unknown } }
            catch { assert(/^[a-f0-9-]{36}$/.test(line) || /^-?[0-9]+$/.test(line) || line === 'ok'); return { result: line } }
          })) } catch { reject(nativeFailure('frame-decode')); void closeAll().catch(() => {}) }
        } }
        this.child.stdin.write(`${sql}\n\\echo ${marker}\n`)
      })
    }
    async initialize() {
      await guard()
      diagnostic.phase('bootstrap')
      const rows = await this.raw(manifest.bootstrap, CAPS.closeMs)
      assert.equal(rows.length, 1); this.owned = backend(rows[0].result, this.name)
    }
    async execute(sql: string, timeoutMs: number) {
      if (sql === manifest.contracts.contracts) diagnostic.stage('rollback-contracts')
      if (sql === manifest.contracts.boundsAndDrift) diagnostic.stage('bounds-drift')
      try { check(); assert(validateDraftGetNativeSql(manifest, sql)); if (actions >= CAPS.actions) diagnostic.fail('action-limit'); assert(++actions <= CAPS.actions); await guard(); check(); diagnostic.phase(sql === manifest.close ? 'rollback' : 'sql'); return await this.raw(sql, timeoutMs) }
      catch (error) { recordError(error); await closeAll(); throw nativeFailure() }
    }
    async destroy() {
      if (this.closing) return this.closing
      this.closing = (async () => {
        diagnostic.cleanupStart()
        this.reject()
        let remoteError: unknown
        try { if (this.owned) await terminate(this.owned); else if (!this.ended) remoteError = nativeFailure() }
        catch (error) { remoteError = error }
        this.child.stdin.destroy(); this.child.stdout.destroy(); this.child.stderr.destroy(); this.child.kill('SIGKILL')
        await new Promise<void>((resolveClose, rejectClose) => {
          const timer = setTimeout(() => { diagnostic.cleanupEnd('termination'); rejectClose(nativeFailure('termination')) }, CAPS.closeMs)
          this.closed.then(() => { clearTimeout(timer); resolveClose() }, rejectClose)
        })
        sessions.delete(this); this.partial = ''
        diagnostic.cleanupEnd(remoteError ? 'termination' : undefined)
        if (remoteError) throw nativeFailure('termination')
      })()
      return this.closing
    }
    async rollbackAndClose(timeoutMs: number) {
      if (this.closing) return this.closing
      try { if (!failed && !this.ended && !this.active) await this.execute(manifest.close, timeoutMs) }
      finally { await this.destroy() }
    }
  }
  function target(acceptedManifestSha256: string): DraftGetTarget {
    return Object.freeze({ projectId: project, apiUrl: 'http://127.0.0.1:54331', databaseHost: '127.0.0.1', databasePort: 54332,
      containerId: input.containerId, containerProjectLabel: project, disposable: true,
      reviewedHead: input.reviewedHead, migrationManifestSha256: manifest.migrationManifestSha256,
      reviewedSourceSha256: manifest.sourceSha256, acceptedManifestSha256 })
  }
  function driver(bound: DraftGetTarget): DraftGetDriver {
    return {
      async verifyTarget() { await guard(); return bound },
      async openSession(name) {
        if (concurrencyStarted && name === `${project}_draft_holder`) diagnostic.schedule(manifest.concurrency.schedules[scheduleIndex++]?.label)
        check(); assert(sessions.size < CAPS.sessions && ![...sessions].some(s => s.name === name)); await guard(); check()
        const session = new NativeSession(name); sessions.add(session)
        try { await session.initialize(); return session } catch (error) { recordError(error); await closeAll(); throw nativeFailure() }
      },
    }
  }
  async function single(sql: string, setup = false) {
    const d = driver(target(input.acceptedManifestSha256)); const session = await d.openSession(`${project}_${setup ? 'fixture' : 'draft_contracts'}`)
    try { return await session.execute(sql, CAPS.actionMs) } finally { await session.rollbackAndClose(CAPS.closeMs) }
  }
  async function restorationControl(sql: string) {
    assert([manifest.privilege.catalog, manifest.privilege.restore, manifest.snapshot].includes(sql))
    assert(++actions <= CAPS.actions)
    // Cleanup is allowed after a failed SDK/dispatch; all immutable bindings and
    // original safety guards still pass before the fixed restoration operation.
    await guard(true)
    const name = `${project}_${sql === manifest.snapshot ? 'draft_contracts' : 'fixture'}`
    const output = await command('docker', dockerArgs(name), sql, CAPS.closeMs)
    diagnostic.phase('restoration')
    return output ? [{ result: JSON.parse(output) as unknown }] : []
  }
  return Object.freeze({ manifest,
    diagnostic: () => diagnostic.format(),
    async setup() {
      diagnostic.stage('setup')
      try {
        assert(!setupDone && !ran); check()
        await single(manifest.setup, true); setupDone = true
        return Object.freeze({ fixtureSha256: testOwnerDigest(JSON.stringify(manifest.fixture)), setupSha256: testOwnerDigest(manifest.setup) })
      } catch (error) { recordError(error); throw error }
    },
    async probeSnapshotPrivilegeDrift(probe: () => Promise<{ status: 503; rpcCalls: 1; rawCode: '42501' }>) {
      try {
        assert(setupDone && !ran && !probed && sessions.size === 0); probed = true; check()
        diagnostic.stage('privilege-catalog')
        const rowsBefore = await single(manifest.snapshot)
        const catalogRows = await single(manifest.privilege.catalog)
        diagnostic.phase('verify')
        const catalogBefore = decodeSnapshotCatalog(catalogRows)
        assert.equal(catalogBefore.owner, manifest.privilege.expectedOwner)
        assert.equal(catalogBefore.acl.length, 2)
        assert.deepEqual(catalogBefore.acl.map(row => row.grantee).sort(), [...manifest.privilege.expectedRoles].sort())
        assert(catalogBefore.acl.every(row => row.grantor === catalogBefore.owner && row.privilege_type === 'EXECUTE' && !row.is_grantable))
        let restoreRequired = false
        try {
          // Set before dispatch so an ambiguous COMMIT response still restores.
          restoreRequired = true
          diagnostic.stage('privilege-revoke')
          await single(manifest.privilege.revoke, true)
          await guard(); check()
          diagnostic.stage('privilege-probe'); diagnostic.phase('probe')
          assert.deepEqual(await probe(), manifest.privilege.expectedEvidence)
          check()
        } catch (error) { recordError(error); failed = true; throw nativeFailure()
        } finally {
          if (restoreRequired) {
            diagnostic.stage('privilege-restoration'); diagnostic.cleanupStart()
            try {
              await restorationControl(manifest.privilege.restore)
              assert.deepEqual(decodeSnapshotCatalog(await restorationControl(manifest.privilege.catalog)), catalogBefore)
              assert.deepEqual(await restorationControl(manifest.snapshot), rowsBefore)
              diagnostic.cleanupEnd()
            } catch { diagnostic.fail('restoration'); diagnostic.cleanupEnd('restoration'); failed = true; throw nativeFailure() }
          }
        }
        return Object.freeze({ privilegeRestored: true, fixtureUnchanged: true,
          snapshotAclSha256: testOwnerDigest(JSON.stringify(catalogBefore)) })
      } catch (error) { recordError(error); throw error }
    },
    async run() {
      diagnostic.stage('rollback-contracts')
      try {
        assert(setupDone && !ran); ran = true; check()
        const before = await single(manifest.snapshot)
        const contractTarget = target(testOwnerDigest(JSON.stringify(manifest.contracts)))
        const contracts = await runDraftGetContracts(manifest.fixture, contractTarget, input.repository, driver(contractTarget))
        assert.deepEqual(await single(manifest.snapshot), before, 'Rollback contract whole-row equality differs')
        const raceTarget = target(testOwnerDigest(JSON.stringify(manifest.concurrency)))
        diagnostic.stage('concurrency'); concurrencyStarted = Date.now()
        const races = await runDraftGetConcurrency(manifest.fixture, raceTarget, input.repository, driver(raceTarget))
        assert.deepEqual(await single(manifest.snapshot), before, 'Rollback schedule whole-row equality differs')
        assert.equal(sessions.size, 0)
        diagnostic.stage('complete')
        return Object.freeze({ contracts, races, fixtureUnchanged: true, manifestSha256: input.acceptedManifestSha256 })
      } catch (error) { if (error instanceof assert.AssertionError && error.message === 'Finite total harness budget exhausted') diagnostic.fail('total-budget'); else recordError(error); throw error }
    },
  })
}
