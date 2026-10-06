/** Inert source preparation. Root reviews this complete finite manifest before
 * invocation inside the original disposable-project lifecycle. No CLI entrypoint. */
import assert from 'node:assert/strict'
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, normalize, resolve } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import type { AssignmentListProofFixture } from './contextual-assignment-list-proof-fixture'
import type { AssignmentListResource } from './contextual-assignment-list-proof-lifecycle'
import { draftSaveProofDockerInventory } from './contextual-test-draft-save-proof-inventory'
import { validateIntegratedGuardResources } from './check-contextual-assignment-learner-integrated-lifecycle'
import { testOwnerDigest, testOwnerGuardSql } from './contextual-test-owner-detail-proof-fixture'
import {
  DRAFT_SAVE_CAPS, newDraftSaveFixture, draftSaveFixtureStatements, draftSaveFixtureSnapshotSql,
  draftSaveContractsManifest, draftSaveMigrationManifestSha256, runDraftSaveContracts,
  type DraftSaveDriver, type DraftSaveSession, type DraftSaveTarget,
} from './check-contextual-test-draft-save-db-contracts'
import { draftSaveConcurrencyManifest, runDraftSaveConcurrency } from './check-contextual-test-draft-save-concurrency'
import { newTestOwnerCreateFixture, testOwnerCreateSnapshotSql, type TestOwnerCreateFixture } from './contextual-test-owner-create-proof-fixture'
import { testOwnerCreateContractsManifest } from './contextual-test-owner-create-db-contracts'
import { testOwnerCreateConcurrencyManifest, validateTestOwnerCreateConcurrencySql, validateOwnerCreateTarget, runTestOwnerCreateConcurrency } from './check-contextual-test-create-concurrency'
import { contextualTestCreateTestSchema, contextualTestCreateDraftSchema } from '../src/lib/validations/contextual-test-create'

const CAPS = Object.freeze({ controlCalls: 4000, actions: 200, sessions: 2, controlMs: 45000, closeMs: 12000,
  actionMs: 90000, totalMs: 900000, outputBytes: 8 * 1024 * 1024, stderrBytes: 65536, totalBytes: 64 * 1024 * 1024 })
const failure = () => new Error('Private native Test draft contracts failed; exact project disposal required')
const contextTemplate = '{"endpoints":{{json .Endpoints}},"tlsMaterial":{{json .TLSMaterial}}}'
const sqlstates = new Set(['PT400', 'PT403', 'PT404', 'PT409', 'PT499', 'PT503', '42501', '55P03', '40P01', '40001', '57014',
  'P0001', '23502', '23503', '23505', '23514', '22P02', '25P02', '57P01', '57P02', '57P03'])
type Phase = 'idle' | 'setup' | 'privilege' | 'snapshot' | 'contracts' | 'contracts-verify' | 'races' | 'races-verify' | 'complete'
type Role = 'none' | 'fixture' | 'contracts' | 'holder' | 'contender'
type Fault = 'guard' | 'timeout' | 'child-exit' | 'protocol' | 'budget' | 'unknown'
// Retain only one allowlisted code. Untrusted stderr lines are bounded and
// discarded; neither their text nor an exception is part of the diagnostic.
function captureSqlstate() {
  let line = ''; let discard = false; let observed: string | undefined
  function consume() {
    if (!discard && observed === undefined) {
      const match = line.match(/^(?:psql:<stdin>:[1-9]\d{0,6}: )?(?:ERROR|FATAL):[ \t]+([A-Z0-9]{5})[ \t\r]*$/)
      if (match) observed = sqlstates.has(match[1]) ? match[1] : 'unknown'
    }
    line = ''; discard = false
  }
  return { push(chunk: Buffer | string) {
    for (const character of chunk.toString()) {
      if (character === '\n') consume()
      else if (!discard) { if (line.length < 128) line += character; else { line = ''; discard = true } }
    }
  }, code() { consume(); return observed ?? 'unknown' } }
}
const boot = `set statement_timeout='8s';set lock_timeout='1s';set idle_in_transaction_session_timeout='180s';
do $session$ begin if exists(select 1 from pg_stat_activity where application_name=current_setting('application_name') and pid<>pg_backend_pid())
then raise exception 'Reserved proof session already exists';end if;end;$session$;
select jsonb_build_object('pid',pg_backend_pid(),'started',(select backend_start from pg_stat_activity where pid=pg_backend_pid()),'name',current_setting('application_name'),'database',current_database(),'user',current_user);`
export function draftSaveNativeTerminationSql() {
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
function snapshotPrivilegeSql(kind: 'snapshot' | 'create' = 'snapshot') {
  const signature = kind === 'snapshot' ? 'public.snapshot_test_draft_save_for_owner_v1(uuid,uuid,timestamp with time zone)'
    : 'public.create_test_for_owner_v1(uuid,uuid,text,timestamp with time zone)'
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
then raise exception '${kind === 'snapshot' ? 'Snapshot' : 'Create'} ACL differs';end if;end;$acl$;
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
export function buildDraftSaveNativeContractsManifest(original: AssignmentListProofFixture, reviewedHead: string, repository: string) {
  assert.match(reviewedHead, /^[a-f0-9]{40}$/)
  const fixture = newDraftSaveFixture(original.manifest.syntheticTag.slice(-12))
  const originalIds = new Set(original.allocatedIds)
  assert(fixture.allowedFixtureIds.every(id => !originalIds.has(id)))
  const guard = testOwnerGuardSql(fixture.projectId)
  const setup = `${guard}\nbegin;set local lock_timeout='1s';set local statement_timeout='30s';\n${draftSaveFixtureStatements(fixture)}\ncommit;`
  const contracts = draftSaveContractsManifest(fixture)
  const concurrency = draftSaveConcurrencyManifest(fixture)
  const snapshot = draftSaveFixtureSnapshotSql(fixture)
  const sourceSha256 = testOwnerDigest(readFileSync(resolve(repository, 'supabase/migrations/249_contextual_test_draft_owner_save.sql'), 'utf8'))
  return freeze({ version: 1, reviewedHead, migrationManifestSha256: draftSaveMigrationManifestSha256(repository), sourceSha256,
    fixture, guard, setup, contracts, concurrency, snapshot, bootstrap: boot, termination: draftSaveNativeTerminationSql(),
    close: 'rollback;', capabilities: CAPS, framing: 'psql-echo-monotonic-v1', contextTemplate, privilege: snapshotPrivilegeSql() })
}
type Manifest = ReturnType<typeof buildDraftSaveNativeContractsManifest>
export function validateDraftSaveNativeSql(manifest: Manifest, sql: string) {
  if (typeof sql !== 'string' || Buffer.byteLength(sql) > DRAFT_SAVE_CAPS.sqlBytes) return false
  const fixed = [manifest.setup, manifest.snapshot, manifest.bootstrap, manifest.close, manifest.privilege.catalog, manifest.privilege.revoke, manifest.contracts.contracts,
    manifest.contracts.boundsAndDrift, manifest.concurrency.begin, manifest.concurrency.rollback, manifest.concurrency.observe,
    ...manifest.concurrency.schedules.flatMap(s => [s.snapshotSql, s.holderSql, ...(s.afterSql ? [s.afterSql] : [])])]
  if (fixed.includes(sql) && sql !== 'contextual') return true
  return manifest.concurrency.schedules.some(s => [s.finalTemplate, s.rejectTemplate].some(template => {
    const needle = `'${'0'.repeat(64)}'`; const first = template.indexOf(needle)
    if (first < 0 || template.indexOf(needle, first + 1) >= 0) return false
    const prefix = template.slice(0, first); const suffix = template.slice(first + needle.length)
    return sql.startsWith(prefix) && sql.endsWith(suffix) && /^'[a-f0-9]{64}'$/.test(sql.slice(prefix.length, sql.length - suffix.length))
  }))
}

/** One shared CREATE fixture is already durably installed by the original
 * lifecycle's reviewed512KiB hook. Native setup is presence-only, never a second
 * insertion or permission to raise the persistent engine's256KiB SQL limit. */
export function buildTestOwnerCreateNativeContractsManifest(original: AssignmentListProofFixture, fixture: TestOwnerCreateFixture,
  reviewedHead: string, repository: string) {
  assert.match(reviewedHead, /^[a-f0-9]{40}$/)
  assert.deepEqual(fixture, newTestOwnerCreateFixture(original))
  assert(Object.isFrozen(fixture))
  const projectId = `pika_assignment_list_${fixture.tag.slice(-12)}`
  const q = (value: string) => `'${value.replaceAll("'", "''")}'`
  const classIds = fixture.classes.map(c => `${q(c.id)}::uuid`).join(',')
  const actorIds = fixture.actors.map(a => `${q(a.id)}::uuid`).join(',')
  const guard = testOwnerGuardSql(projectId)
  const setup = `${guard}\nbegin read only;set local lock_timeout='1s';set local statement_timeout='8s';
do $presence$ begin
 if current_database()<>'postgres' or current_user<>'postgres'
 or to_regprocedure('public.create_test_for_owner_v1(uuid,uuid,text,timestamp with time zone)') is null
 or (select count(*) from public.users where id=any(array[${actorIds}]) and email like ${q(fixture.tag + '%@example.invalid')})<>4
 or (select count(*) from public.classrooms where id=any(array[${classIds}]))<>4
 or (select count(*) from public.tests where classroom_id=any(array[${classIds}]))<>1001
 or (select count(*) from public.classroom_enrollments where classroom_id=any(array[${classIds}]))<>4
 or (select count(*) from public.gradebook_categories where classroom_id=any(array[${classIds}]))<>12
 or (select count(*) from public.classroom_archive_revisions where classroom_id=any(array[${classIds}]))<>4
 or exists(select 1 from public.assessment_drafts where classroom_id=any(array[${classIds}]))
 then raise exception 'Migration250 fixture presence differs';end if;
end;$presence$;rollback;`
  const contracts = testOwnerCreateContractsManifest(fixture)
  const concurrency = testOwnerCreateConcurrencyManifest(fixture)
  const snapshot = testOwnerCreateSnapshotSql(fixture)
  const sourceSha256 = testOwnerDigest(readFileSync(resolve(repository, 'supabase/migrations/250_contextual_test_owner_create.sql'), 'utf8'))
  assert(Buffer.byteLength(setup) <= DRAFT_SAVE_CAPS.sqlBytes)
  assert(Buffer.byteLength(snapshot) <= DRAFT_SAVE_CAPS.sqlBytes)
  return freeze({ version: 1, reviewedHead, migrationManifestSha256: draftSaveMigrationManifestSha256(repository), sourceSha256,
    fixture, guard, setup, contracts, concurrency, snapshot, bootstrap: boot, termination: draftSaveNativeTerminationSql(),
    close: 'rollback;', capabilities: CAPS, framing: 'psql-echo-monotonic-v1', contextTemplate, privilege: snapshotPrivilegeSql('create') })
}
type CreateManifest = ReturnType<typeof buildTestOwnerCreateNativeContractsManifest>
/** Plain EXPLAIN is structural planning evidence, not execution timing. Index
 * DDL is separately verified by the rollback catalog contract and cannot stand
 * in for this exact populated-Class Limit -> forward ordered index scan. */
export function validateTestOwnerCreateAllocatorPlan(value: unknown, fixture: TestOwnerCreateFixture) {
  function record(value: unknown): Record<string, unknown> {
    assert(value && typeof value === 'object' && !Array.isArray(value)); return value as Record<string, unknown>
  }
  function allowed(row: Record<string, unknown>, keys: readonly string[]) { assert(Object.keys(row).every(key => keys.includes(key))) }
  const catalog = record(value)
  assert.deepEqual(Object.keys(catalog).sort(), ['draft_columns', 'function', 'index', 'plan', 'test_columns'])
  assert(typeof catalog.function === 'string' && /^[a-f0-9]{32}$/.test(catalog.function))
  assert(typeof catalog.index === 'string' && catalog.index.length <= 4096
    && catalog.index.startsWith('CREATE INDEX idx_tests_classroom_position_owner_create ON public.tests USING btree '))
  for (const [columns, expected] of [[catalog.test_columns, Object.keys(contextualTestCreateTestSchema.shape)],
    [catalog.draft_columns, Object.keys(contextualTestCreateDraftSchema.shape)]] as const) {
    assert(Array.isArray(columns) && columns.every(column => typeof column === 'string'))
    assert.deepEqual([...columns].sort(), [...expected].sort())
  }
  assert(Array.isArray(catalog.plan) && catalog.plan.length === 1)
  const envelope = record(catalog.plan[0]); assert.deepEqual(Object.keys(envelope), ['Plan'])
  const limit = record(envelope.Plan)
  allowed(limit, ['Node Type', 'Parallel Aware', 'Async Capable', 'Plans'])
  assert.equal(limit['Node Type'], 'Limit'); assert.equal(limit['Parallel Aware'], false)
  assert(limit['Async Capable'] === undefined || limit['Async Capable'] === false)
  assert(Array.isArray(limit.Plans) && limit.Plans.length === 1)
  const scan = record(limit.Plans[0])
  allowed(scan, ['Node Type', 'Parent Relationship', 'Parallel Aware', 'Async Capable', 'Scan Direction', 'Index Name', 'Relation Name', 'Alias', 'Index Cond'])
  assert(['Index Scan', 'Index Only Scan'].includes(String(scan['Node Type'])))
  assert.equal(scan['Parent Relationship'], 'Outer'); assert.equal(scan['Parallel Aware'], false)
  assert(scan['Async Capable'] === undefined || scan['Async Capable'] === false)
  assert.equal(scan['Scan Direction'], 'Forward'); assert.equal(scan['Index Name'], 'idx_tests_classroom_position_owner_create')
  assert.equal(scan['Relation Name'], 'tests'); assert.equal(scan.Alias, 'test')
  assert.equal(scan['Index Cond'], `(classroom_id = '${fixture.classes[3].id}'::uuid)`)
  return true
}
export function validateTestOwnerCreateNativeSql(manifest: CreateManifest, sql: string) {
  if (typeof sql !== 'string' || Buffer.byteLength(sql) > DRAFT_SAVE_CAPS.sqlBytes) return false
  return [manifest.setup, manifest.snapshot, manifest.bootstrap, manifest.close, manifest.privilege.catalog, manifest.privilege.revoke,
    manifest.contracts.contracts, manifest.contracts.catalogAndPlan].includes(sql)
    || validateTestOwnerCreateConcurrencySql(manifest.concurrency, sql)
}
async function runTestOwnerCreateContracts(manifest: CreateManifest, bound: DraftSaveTarget, repository: string, d: DraftSaveDriver) {
  validateOwnerCreateTarget(bound, manifest.fixture, repository)
  assert.equal(bound.acceptedManifestSha256, testOwnerDigest(JSON.stringify(manifest.contracts)))
  assert.deepEqual(await d.verifyTarget(), bound)
  const session = await d.openSession(`${bound.projectId}_draft_contracts`)
  try {
    const evidence: unknown[] = []
    for (const sql of [manifest.contracts.contracts, manifest.contracts.catalogAndPlan]) {
      assert.deepEqual(await d.verifyTarget(), bound)
      const rows = await session.execute(sql, manifest.contracts.caps.actionMs)
      assert.equal(rows.length, 1)
      assert(Buffer.byteLength(JSON.stringify(rows)) <= 65536)
      evidence.push(rows[0].result)
    }
    const [result, catalog] = evidence
    assert(result && typeof result === 'object' && !Array.isArray(result))
    const row = result as Record<string, unknown>
    assert.equal(row.version, 1); assert.equal(row.native_execution, true); assert.equal(row.rollback_only, true)
    assert.equal(row.fixture_tag, manifest.fixture.tag)
    assert(Array.isArray(row.checks) && row.checks.length >= 30 && row.checks.length <= 128)
    assert.equal(row.check_count, row.checks.length)
    assert.equal(new Set(row.checks.map(c => c.label)).size, row.checks.length)
    for (const check of row.checks) {
      assert(check && typeof check === 'object' && !Array.isArray(check))
      assert.deepEqual(Object.keys(check).sort(), ['code', 'label', 'ok'])
      if (check.label === 'missing-actor-skipped-fk') assert.deepEqual(check, { label: 'missing-actor-skipped-fk', ok: false, code: 'SKIP0' })
      else assert(check.ok === true && check.code === '00000')
    }
    assert.deepEqual(row.deferred, manifest.contracts.remainingNativeObligations)
    validateTestOwnerCreateAllocatorPlan(catalog, manifest.fixture)
    return Object.freeze({ kind: 'rollback-contracts' as const, checkCount: row.check_count,
      evidenceSha256: testOwnerDigest(JSON.stringify(evidence)), sourceSha256: bound.reviewedSourceSha256 })
  } finally { await session.rollbackAndClose(CAPS.closeMs) }
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

type NativeOwnerInput = {
  repository: string; reviewedHead: string; original: AssignmentListProofFixture;
  capturedResources: readonly AssignmentListResource[]; containerId: string; acceptedManifestSha256: string;
}
type NativeManifestShape = Omit<Manifest, 'fixture' | 'contracts' | 'concurrency'> & { fixture: object }
type NativeOwnerProfile<M extends NativeManifestShape, C, R> = Readonly<{
  manifest: M;
  project: string;
  sourceFile: '249_contextual_test_draft_owner_save.sql' | '250_contextual_test_owner_create.sql';
  label: 'test-owner-draft-save' | 'test-owner-create';
  validateSql(sql: string): boolean;
  contractsSha256: string;
  racesSha256: string;
  runContracts(target: DraftSaveTarget, driver: DraftSaveDriver): Promise<C>;
  runRaces(target: DraftSaveTarget, driver: DraftSaveDriver): Promise<R>;
}>

/** The only exported factories select source-owned closed profiles. Never accept
 * caller-supplied SQL callbacks, migration paths or resource protocols. The
 * default249 manifest, runner and privilege API retain their existing meaning. */
export function createDraftSaveNativeContracts(input: NativeOwnerInput) {
  const manifest = buildDraftSaveNativeContractsManifest(input.original, input.reviewedHead, input.repository)
  return createNativeOwnerContracts(input, {
    manifest, project: manifest.fixture.projectId, sourceFile: '249_contextual_test_draft_owner_save.sql', label: 'test-owner-draft-save',
    validateSql: sql => validateDraftSaveNativeSql(manifest, sql),
    contractsSha256: testOwnerDigest(JSON.stringify(manifest.contracts)),
    racesSha256: testOwnerDigest(JSON.stringify(manifest.concurrency)),
    runContracts: (bound, d) => runDraftSaveContracts(manifest.fixture, bound, input.repository, d),
    runRaces: (bound, d) => runDraftSaveConcurrency(manifest.fixture, bound, input.repository, d),
  })
}

export function createTestOwnerCreateNativeContracts(input: NativeOwnerInput & { fixture: TestOwnerCreateFixture }) {
  const manifest = buildTestOwnerCreateNativeContractsManifest(input.original, input.fixture, input.reviewedHead, input.repository)
  const engine = createNativeOwnerContracts(input, {
    manifest, project: `pika_assignment_list_${manifest.fixture.tag.slice(-12)}`, sourceFile: '250_contextual_test_owner_create.sql', label: 'test-owner-create',
    validateSql: sql => validateTestOwnerCreateNativeSql(manifest, sql),
    contractsSha256: testOwnerDigest(JSON.stringify(manifest.contracts)), racesSha256: testOwnerDigest(JSON.stringify(manifest.concurrency)),
    runContracts: (bound, d) => runTestOwnerCreateContracts(manifest, bound, input.repository, d),
    runRaces: (bound, d) => runTestOwnerCreateConcurrency(manifest.fixture, bound, input.repository, d),
  })
  const { probeSnapshotPrivilegeDrift: probe, ...facade } = engine
  return Object.freeze({ ...facade, async probeCreatePrivilegeDrift(callback: Parameters<typeof probe>[0]) {
    const receipt = await probe(callback)
    return Object.freeze({ privilegeRestored: receipt.privilegeRestored, fixtureUnchanged: receipt.fixtureUnchanged, createAclSha256: receipt.snapshotAclSha256 })
  } })
}

function createNativeOwnerContracts<M extends NativeManifestShape, C, R>(input: NativeOwnerInput, profile: NativeOwnerProfile<M, C, R>) {
  input = Object.freeze({ ...input })
  profile = Object.freeze({ ...profile })
  const manifest = profile.manifest
  assert.equal(input.acceptedManifestSha256, testOwnerDigest(JSON.stringify(manifest)))
  assert.match(input.containerId, /^[a-f0-9]{64}$/)
  assert(isAbsolute(input.repository) && realpathSync(input.repository) === input.repository)
  const project = profile.project
  const closure = structuredClone(input.capturedResources)
  const start = Date.now(); let controls = 0; let actions = 0; let exchanged = 0; let failed = false; let setupDone = false; let ran = false; let probed = false
  const sessions = new Set<NativeSession>()
  let phase: Phase = 'idle'
  let firstFault: Readonly<{ phase: Phase; failure: Fault; role: Role; sqlstate: string; controls: number; actions: number; sessions: number }> | undefined
  function role(name: string): Role {
    if (name === `${project}_fixture`) return 'fixture'
    if (name === `${project}_draft_contracts`) return 'contracts'
    if (name === `${project}_draft_holder`) return 'holder'
    if (name === `${project}_draft_contender`) return 'contender'
    return 'none'
  }
  function record(kind: Fault, ownedRole: Role = 'none', sqlstate = 'unknown') {
    firstFault ??= Object.freeze({ phase, failure: kind, role: ownedRole, sqlstate: sqlstates.has(sqlstate) ? sqlstate : 'unknown',
      controls: Math.min(controls, CAPS.controlCalls + 1), actions: Math.min(actions, CAPS.actions + 1), sessions: Math.min(sessions.size, CAPS.sessions + 1) })
  }
  let endpoint: { host: string; identity: number[] } | undefined
  function check(observe = true) {
    if (observe && !failed && Date.now() - start >= CAPS.totalMs) record('timeout')
    if (observe && controls > CAPS.controlCalls - 32) record('budget')
    assert(!failed && Date.now() - start < CAPS.totalMs && controls <= CAPS.controlCalls - 32)
  }
  function dockerArgs(name: string, variables: string[] = []) {
    assert([`${project}_fixture`, `${project}_draft_contracts`, `${project}_draft_holder`, `${project}_draft_contender`].includes(name))
    assert(endpoint)
    return ['--host', endpoint.host, 'exec', '-i', '-e', `PGAPPNAME=${name}`, input.containerId, 'psql', '-U', 'postgres', '-d', 'postgres',
      '-XqAt', '-P', 'pager=off', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate', ...variables]
  }
  function command(file: 'git' | 'docker', args: string[], sql?: string, timeout = CAPS.controlMs, diagnosticRole?: Role): Promise<string> {
    assert(++controls <= CAPS.controlCalls)
    return new Promise((resolveResult, reject) => {
      let inputFailed = false
      const child = execFile(file, args, { cwd: input.repository, encoding: 'utf8', timeout, killSignal: 'SIGKILL', maxBuffer: CAPS.outputBytes }, (error, stdout, stderr) => {
        if (error || inputFailed || Buffer.byteLength(stdout) > CAPS.outputBytes) {
          if (diagnosticRole !== undefined) {
            const state = captureSqlstate()
            if (typeof stderr === 'string' && Buffer.byteLength(stderr) <= CAPS.stderrBytes) state.push(stderr)
            record('guard', diagnosticRole, state.code())
          }
          reject(failure())
        }
        else { exchanged += Buffer.byteLength(stdout); exchanged > CAPS.totalBytes ? reject(failure()) : resolveResult(stdout.trim()) }
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
  async function inventory(cleanup = false, observe = !cleanup) {
    if (!cleanup) check(observe)
    // These fresh read-only children are independent. Settle all of them even
    // on rejection before resource discovery, SQL, or session work can begin.
    const checks = await Promise.allSettled([
      (async () => { assert.equal(await command('git', ['rev-parse', 'HEAD']), input.reviewedHead) })(),
      (async () => { assert.equal(await command('git', ['rev-parse', '--show-toplevel']), input.repository) })(),
      (async () => { assert.equal(await command('git', ['status', '--porcelain']), '') })(),
      verifyEndpoint(),
    ])
    for (const result of checks) if (result.status === 'rejected') throw result.reason
    assert.equal(draftSaveMigrationManifestSha256(input.repository), manifest.migrationManifestSha256)
    assert.equal(testOwnerDigest(readFileSync(resolve(input.repository, 'supabase/migrations', profile.sourceFile), 'utf8')), manifest.sourceSha256)
    const all = await draftSaveProofDockerInventory()
    validateIntegratedGuardResources(all, project, input.containerId, closure as AssignmentListResource[])
    await verifyEndpoint()
    if (!cleanup) check(observe)
  }
  async function guard(cleanup = false, ownedRole: Role = 'none', observe = !cleanup) {
    try {
    await inventory(cleanup, observe)
    assert.equal(await command('docker', dockerArgs(`${project}_fixture`), manifest.guard, CAPS.controlMs, observe ? ownedRole : undefined), 'ok')
    if (!cleanup) check(observe)
    } catch (error) { if (observe) record('guard', ownedRole); throw error }
  }
  // On any failed dispatch, all exact owned backends are terminated and both
  // local docker children are reaped. A failed remote confirmation fails closed.
  async function terminate(owned: Backend) {
    await guard(true)
    const variables = ['-v', `owned_pid=${owned.pid}`, '-v', `owned_started=${owned.started}`, '-v', `owned_name=${owned.name}`]
    const text = await command('docker', dockerArgs(`${project}_fixture`, variables), manifest.termination, CAPS.closeMs)
    const value = JSON.parse(text) as { present?: unknown; terminated?: unknown }
    assert.deepEqual(Object.keys(value).sort(), ['present', 'terminated'])
    assert(value.present === false || value.terminated === true, 'Remote termination unconfirmed')
  }
  async function closeAll() {
    failed = true
    const results = await Promise.allSettled([...sessions].map(session => session.destroy()))
    if (results.some(result => result.status === 'rejected')) throw failure()
  }
  class NativeSession implements DraftSaveSession {
    readonly name: string
    private child: ChildProcessWithoutNullStreams
    private owned?: Backend
    private ended = false
    private closed: Promise<void>
    private active?: { reject: (error: Error) => void; finish: () => void; timer: ReturnType<typeof setTimeout>; end: string; lines: string[]; bytes: number }
    private partial = ''; private stderr = 0; private frame = 0; private closing?: Promise<void>
    private decoder = new StringDecoder('utf8')
    private sqlstate = captureSqlstate()
    private cleaning = false
    private fault(kind: Fault) { if (!this.cleaning) record(kind, role(this.name), this.sqlstate.code()) }
    constructor(name: string) {
      this.name = name
      this.child = spawn('docker', dockerArgs(name), { cwd: input.repository, stdio: ['pipe', 'pipe', 'pipe'] })
      this.closed = new Promise(resolveClose => this.child.once('close', () => {
        if (this.active) this.fault('child-exit')
        this.ended = true; this.reject(); resolveClose()
      }))
      this.child.on('error', () => { this.fault('child-exit'); this.reject(); void closeAll().catch(() => {}) })
      this.child.stdin.on('error', () => { this.fault('protocol'); this.reject(); void closeAll().catch(() => {}) })
      this.child.stdout.on('data', (chunk: Buffer) => {
        try {
          assert(Buffer.isBuffer(chunk)); assert(chunk.length <= CAPS.outputBytes - Buffer.byteLength(this.partial))
          this.partial += this.decoder.write(chunk)
          for (;;) {
            const newline = this.partial.indexOf('\n'); if (newline < 0) break
            const line = this.partial.slice(0, newline).replace(/\r$/, ''); this.partial = this.partial.slice(newline + 1)
            assert(this.active)
            if (line === this.active.end) { this.active.finish(); continue }
            this.active.bytes += Buffer.byteLength(line); exchanged += Buffer.byteLength(line)
            assert(this.active.bytes <= CAPS.outputBytes && exchanged <= CAPS.totalBytes)
            if (line) this.active.lines.push(line)
          }
        } catch { this.fault('protocol'); this.reject(); void closeAll().catch(() => {}) }
      })
      this.child.stderr.on('data', (chunk: Buffer) => {
        this.stderr += chunk.length
        if (this.stderr > CAPS.stderrBytes) { this.fault('protocol'); this.reject(); void closeAll().catch(() => {}) }
        else this.sqlstate.push(chunk)
      })
    }
    private reject() { if (this.active) { clearTimeout(this.active.timer); this.active.reject(failure()); this.active = undefined } }
    private raw(sql: string, timeoutMs: number): Promise<readonly { result?: unknown }[]> {
      assert(!this.ended && !this.active); assert(timeoutMs > 0 && timeoutMs <= CAPS.actionMs)
      const marker = `__draft_save_end_${++this.frame}__`
      return new Promise((resolveRows, reject) => {
        const timer = setTimeout(() => { this.fault('timeout'); this.reject(); void closeAll().catch(() => {}) }, timeoutMs)
        this.active = { timer, reject, end: marker, bytes: 0, lines: [], finish: () => {
          const active = this.active!; this.active = undefined; clearTimeout(timer)
          try { resolveRows(active.lines.map(line => {
            try { return { result: JSON.parse(line) as unknown } }
            catch { assert(/^[a-f0-9-]{36}$/.test(line) || /^-?[0-9]+$/.test(line) || line === 'ok'); return { result: line } }
          })) } catch { this.fault('protocol'); reject(failure()); void closeAll().catch(() => {}) }
        } }
        this.child.stdin.write(`${sql}\n\\echo ${marker}\n`)
      })
    }
    async initialize() {
      await guard(false, role(this.name))
      const rows = await this.raw(manifest.bootstrap, CAPS.closeMs)
      assert.equal(rows.length, 1); this.owned = backend(rows[0].result, this.name)
    }
    async execute(sql: string, timeoutMs: number) {
      try { check(!this.cleaning); assert(profile.validateSql(sql)); assert(++actions <= CAPS.actions); await guard(false, role(this.name), !this.cleaning); check(!this.cleaning); return await this.raw(sql, timeoutMs) }
      catch { this.fault('unknown'); await closeAll(); throw failure() }
    }
    async destroy() {
      if (this.closing) return this.closing
      this.cleaning = true
      this.closing = (async () => {
        this.reject()
        let remoteError: unknown
        try { if (this.owned) await terminate(this.owned); else if (!this.ended) remoteError = failure() }
        catch (error) { remoteError = error }
        this.child.stdin.destroy(); this.child.stdout.destroy(); this.child.stderr.destroy(); this.child.kill('SIGKILL')
        await new Promise<void>((resolveClose, rejectClose) => {
          const timer = setTimeout(() => rejectClose(failure()), CAPS.closeMs)
          this.closed.then(() => { clearTimeout(timer); resolveClose() }, rejectClose)
        })
        sessions.delete(this); this.partial = ''
        if (remoteError) throw failure()
      })()
      return this.closing
    }
    async rollbackAndClose(timeoutMs: number) {
      if (this.closing) return this.closing
      this.cleaning = true
      try { if (!failed && !this.ended && !this.active) await this.execute(manifest.close, timeoutMs) }
      finally { await this.destroy() }
    }
  }
  function target(acceptedManifestSha256: string): DraftSaveTarget {
    return Object.freeze({ projectId: project, apiUrl: 'http://127.0.0.1:54331', databaseHost: '127.0.0.1', databasePort: 54332,
      containerId: input.containerId, containerProjectLabel: project, disposable: true,
      reviewedHead: input.reviewedHead, migrationManifestSha256: manifest.migrationManifestSha256,
      reviewedSourceSha256: manifest.sourceSha256, acceptedManifestSha256 })
  }
  function driver(bound: DraftSaveTarget): DraftSaveDriver {
    return {
      async verifyTarget() { await guard(); return bound },
      async openSession(name) {
        check(); assert(sessions.size < CAPS.sessions && ![...sessions].some(s => s.name === name)); await guard(false, role(name)); check()
        const session = new NativeSession(name); sessions.add(session)
        try { await session.initialize(); return session } catch { record('unknown', role(name)); await closeAll(); throw failure() }
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
    return output ? [{ result: JSON.parse(output) as unknown }] : []
  }
  return Object.freeze({ manifest,
    async verifyTarget() {
      await guard()
      return target(input.acceptedManifestSha256)
    },
    diagnostic() {
      const d = firstFault ?? { phase, failure: 'none', role: 'none', sqlstate: 'unknown', controls: Math.min(controls, CAPS.controlCalls + 1),
        actions: Math.min(actions, CAPS.actions + 1), sessions: Math.min(sessions.size, CAPS.sessions + 1) }
      return `DIAG ${profile.label} native phase=${d.phase} failure=${d.failure} role=${d.role} sqlstate=${d.sqlstate} controls=${d.controls} actions=${d.actions} sessions=${d.sessions}.\n`
    },
    async setup() {
      phase = 'setup'
      try {
      assert(!setupDone && !ran); check()
      await single(manifest.setup, true); setupDone = true
      return Object.freeze({ fixtureSha256: testOwnerDigest(JSON.stringify(manifest.fixture)), setupSha256: testOwnerDigest(manifest.setup) })
      } catch (error) { record('unknown'); throw error }
    },
    async probeSnapshotPrivilegeDrift(probe: () => Promise<{ status: 503; rpcCalls: 1; rawCode: '42501' }>) {
      phase = 'privilege'
      try {
      assert(setupDone && !ran && !probed && sessions.size === 0); probed = true; check()
      const rowsBefore = await single(manifest.snapshot)
      const catalogBefore = decodeSnapshotCatalog(await single(manifest.privilege.catalog))
      assert.equal(catalogBefore.owner, manifest.privilege.expectedOwner)
      assert.equal(catalogBefore.acl.length, 2)
      assert.deepEqual(catalogBefore.acl.map(row => row.grantee).sort(), [...manifest.privilege.expectedRoles].sort())
      assert(catalogBefore.acl.every(row => row.grantor === catalogBefore.owner && row.privilege_type === 'EXECUTE' && !row.is_grantable))
      let restoreRequired = false
      try {
        // Set before dispatch so an ambiguous COMMIT response still restores.
        restoreRequired = true
        await single(manifest.privilege.revoke, true)
        await guard(); check()
        assert.deepEqual(await probe(), manifest.privilege.expectedEvidence)
        check()
      } catch { record('unknown'); failed = true; throw failure()
      } finally {
        if (restoreRequired) {
          try {
            await restorationControl(manifest.privilege.restore)
            assert.deepEqual(decodeSnapshotCatalog(await restorationControl(manifest.privilege.catalog)), catalogBefore)
            assert.deepEqual(await restorationControl(manifest.snapshot), rowsBefore)
          } catch { failed = true; throw failure() }
        }
      }
      return Object.freeze({ privilegeRestored: true, fixtureUnchanged: true,
        snapshotAclSha256: testOwnerDigest(JSON.stringify(catalogBefore)) })
      } catch (error) { record('unknown'); throw error }
    },
    async run() {
      phase = 'snapshot'
      try {
      assert(setupDone && !ran); ran = true; check()
      const before = await single(manifest.snapshot)
      phase = 'contracts'
      const contractTarget = target(profile.contractsSha256)
      const contracts = await profile.runContracts(contractTarget, driver(contractTarget))
      phase = 'contracts-verify'
      assert.deepEqual(await single(manifest.snapshot), before, 'Rollback contract whole-row equality differs')
      const raceTarget = target(profile.racesSha256)
      phase = 'races'
      const races = await profile.runRaces(raceTarget, driver(raceTarget))
      phase = 'races-verify'
      assert.deepEqual(await single(manifest.snapshot), before, 'Rollback schedule whole-row equality differs')
      assert.equal(sessions.size, 0)
      phase = 'complete'
      return Object.freeze({ contracts, races, fixtureUnchanged: true, manifestSha256: input.acceptedManifestSha256,
        controls,actions,exchangeBytes:exchanged,remainingSessions:sessions.size })
      } catch (error) { record('unknown'); throw error }
    },
  })
}
