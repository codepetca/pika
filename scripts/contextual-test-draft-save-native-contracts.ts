/** Inert source preparation. Root reviews this complete finite manifest before
 * invocation inside the original disposable-project lifecycle. No CLI entrypoint. */
import assert from 'node:assert/strict'
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, normalize, resolve } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { isDeepStrictEqual } from 'node:util'
import type { AssignmentListProofFixture } from './contextual-assignment-list-proof-fixture'
import type { AssignmentListResource } from './contextual-assignment-list-proof-lifecycle'
import { draftSaveProofDockerInventory, SurveyInventoryUnjoinedChildError } from './contextual-test-draft-save-proof-inventory'
import { validateIntegratedGuardResources } from './check-contextual-assignment-learner-integrated-lifecycle'
import { testOwnerDigest, testOwnerGuardSql } from './contextual-test-owner-detail-proof-fixture'
import {
  DRAFT_SAVE_CAPS, newDraftSaveFixture, draftSaveFixtureStatements, draftSaveFixtureSnapshotSql,
  draftSaveContractsManifest, draftSaveMigrationManifestSha256, runDraftSaveContracts,
  type DraftSaveDriver, type DraftSaveSession, type DraftSaveTarget,
} from './check-contextual-test-draft-save-db-contracts'
import { draftSaveConcurrencyManifest, runDraftSaveConcurrency } from './check-contextual-test-draft-save-concurrency'
import { newTestOwnerCreateFixture, testOwnerCreateSnapshotSql, type TestOwnerCreateFixture } from './contextual-test-owner-create-proof-fixture'
import { testOwnerCreateContractsManifest, TEST_OWNER_CREATE_FAILURE_LABELS } from './contextual-test-owner-create-db-contracts'
import { testOwnerCreateConcurrencyManifest, validateTestOwnerCreateConcurrencySql, validateOwnerCreateTarget, runTestOwnerCreateConcurrency } from './check-contextual-test-create-concurrency'
import { contextualTestCreateTestSchema, contextualTestCreateDraftSchema } from '../src/lib/validations/contextual-test-create'
import { newTestOwnerPristineDiscardFixture, testOwnerPristineDiscardSnapshotSql, type TestOwnerPristineDiscardFixture } from './contextual-test-pristine-discard-proof-fixture'
import { testOwnerPristineDiscardDbContractsSql, testOwnerPristineDiscardDbPlanObjectIds,
  TEST_OWNER_PRISTINE_DISCARD_DB_CAPS, TEST_OWNER_PRISTINE_DISCARD_DB_CHECK_LABELS,
  TEST_OWNER_PRISTINE_DISCARD_DB_LIMITATIONS, TEST_OWNER_PRISTINE_DISCARD_FAILURE_LABELS } from './contextual-test-pristine-discard-db-contracts'
import { testOwnerPristineDiscardConcurrencyManifest, validateTestOwnerPristineDiscardConcurrencySql, runTestOwnerPristineDiscardConcurrency } from './check-contextual-test-discard-concurrency'
import { newTestOwnerPublicationFixture, testOwnerPublicationSnapshotSql, type TestOwnerPublicationFixture } from './contextual-test-publication-proof-fixture'
import { TEST_OWNER_PUBLICATION_DB_CHECK_LABELS, testOwnerPublicationDbContractsManifest, runTestOwnerPublicationDbContracts } from './contextual-test-publication-db-contracts'
import { testOwnerPublicationConcurrencyManifest, validateTestOwnerPublicationConcurrencySql, runTestOwnerPublicationConcurrency,
  testOwnerPublicationCommittedManifest, validateTestOwnerPublicationCommittedSql, runTestOwnerPublicationCommittedTransitions } from './check-contextual-test-publication-concurrency'
import { newTestOwnerReorderFixture, testOwnerReorderSnapshotSql, type TestOwnerReorderFixture } from './contextual-test-reorder-proof-fixture'
import { TEST_OWNER_REORDER_SOURCE_SHA256, TEST_OWNER_REORDER_BULK_FAILURE_CODES, TEST_OWNER_REORDER_DEADLINE_PHASE_CODES, testOwnerReorderDbContractsManifest, runTestOwnerReorderDbContracts } from './contextual-test-reorder-db-contracts'
import { testOwnerReorderConcurrencyManifest, validateTestOwnerReorderConcurrencySql, runTestOwnerReorderConcurrency } from './check-contextual-test-reorder-concurrency'
import { testOwnerReorderCommittedManifest, validateTestOwnerReorderCommittedSql, runTestOwnerReorderCommittedTransitions } from './check-contextual-test-reorder-committed'
import { captureTestOwnerReorderProgress, type TestOwnerReorderProgressCheckpoint, type TestOwnerReorderProgressScope } from './contextual-test-reorder-progress'
import { captureSurveyProgress, SURVEY_PROGRESS_EVENTS } from './contextual-surveys-progress'
import { assertTestOwnerReorderDiagnosticAvailable, buildTestOwnerReorderDiagnosticManifest, validateTestOwnerReorderDiagnosticSql,
  runTestOwnerReorderDiagnostic, captureTestOwnerReorderTimings, validateTestOwnerReorderDiagnosticReceipt, type TestOwnerReorderTimings } from './contextual-test-reorder-diagnostic'
import { testLearnerNativePlan, validateTestLearnerNativePlanSql, runTestLearnerNativeContracts, runTestLearnerNativeRaces,
  type TestLearnerNativePlan } from './contextual-test-learner-native-contracts'
import type { TestLearnerObservedAttempt } from './contextual-test-learner-proof-fixture'
import { testOwnerGradingNativePlan, validateTestOwnerGradingNativePlanSql, runTestOwnerGradingNativeContracts,
  runTestOwnerGradingNativeRaces } from './contextual-test-owner-grading-native-contracts'
import { testOwnerRecoveryNativePlan, validateTestOwnerRecoveryNativePlanSql, runTestOwnerRecoveryNativeContracts,
  runTestOwnerRecoveryNativeRaces } from './contextual-test-owner-recovery-native-contracts'
import { testOwnerUnpublicationNativePlan, validateTestOwnerUnpublicationNativePlanSql, runTestOwnerUnpublicationNativeContracts,
  runTestOwnerUnpublicationNativeRaces } from './contextual-test-owner-unpublication-native-contracts'
import { testOwnerDeletionNativePlan, validateTestOwnerDeletionNativePlanSql, runTestOwnerDeletionNativeContracts,
  runTestOwnerDeletionNativeRaces } from './contextual-test-owner-deletion-native-contracts'
import { surveyNativePlan, validateSurveyNativeSql, runSurveyNativeRollbackContracts,
  runSurveyNativeRollbackRaces, validateSurveyGeneratedTypes, type SurveyNativeFixture } from './contextual-surveys-native-contracts'
import { surveyRemainingNativePlan, verifySurveyRemainingSources } from './contextual-surveys-native-contracts'
import { survey269ComponentPlan, survey269RemainingPlan, validateSurvey269ComponentSql, runSurvey269ComponentRollback,
  validateSurvey269ComponentGeneratedTypes, verifySurvey269ComponentSources, SURVEY_269_COMPONENT_ROOTS,
  type Survey269ComponentBinding } from './contextual-surveys-native-contracts'
import { validateSurveyCommittedSql, surveyCommittedObservationSql, validateSurveyCommittedObservationSql,
  parseSurveyCommittedGraph, verifySurveyCommittedSeed, verifySurveyCommittedWitness, surveyCommittedWitnessFailure, verifySurveyCommittedEffects, verifySurveyCommittedEnvelopes,
  type SurveyCommittedProofManifest, type SurveyCommittedBootstrap, type SurveyCommittedTimes } from './contextual-surveys-committed-proof'
import { createSurveySdkProofTransport, verifySurveySdkTerminalEffects, verifySurvey269ComponentSdkTerminalEffects, SURVEY_269_COMPONENT_SDK_CAPS } from './contextual-surveys-sdk-proof'
import { runContextualSurveysSdkContracts, runSurvey269ComponentSdkContracts, Survey269ComponentSdkDeadlineError } from './contextual-surveys-sdk-contracts'
import { inspectSurveyCancellationPendingShape, validateSurveyCancellationSql } from './contextual-surveys-cancellation-proof'
import { validateSurveyWireSql, verifySurveyPrimaryMembership, inspectSurveyWireReceipt } from './contextual-surveys-wire-proof'
import { decodeAssignmentListSnapshot, validateSurvey263Budget, verifySurvey263NativeCli, Survey263UnjoinedChildError,
  chargeSurvey269ComponentExchange, chargeSurvey269ComponentControl, survey269ComponentExchangeReceipt, survey269ComponentDockerInventory,
  chargeSurvey269RemainingRequest, assertSurvey269RemainingExchange,
  survey269RemainingDockerInventory,SURVEY269_REMAINING_CLEANUP_CONTROLS,
  type Survey269ComponentExchange, type Survey263Budget, type Survey263NativeCli } from './contextual-assignment-list-proof-platform'
import { validateAssignmentListProofTarget } from './check-contextual-assignment-list-reads'
import { generateTestDraftSaveTypes, testDraftSaveTypeGenerationPlan } from './generate-contextual-test-draft-save-types'

const CAPS = Object.freeze({ controlCalls: 4000, actions: 200, sessions: 2, controlMs: 45000, closeMs: 12000,
  actionMs: 90000, totalMs: 900000, outputBytes: 8 * 1024 * 1024, stderrBytes: 65536, totalBytes: 64 * 1024 * 1024 })
const failure = () => new Error('Private native Test draft contracts failed; exact project disposal required')
const contextTemplate = '{"endpoints":{{json .Endpoints}},"tlsMaterial":{{json .TLSMaterial}}}'
const sqlstates = new Set(['PT400', 'PT403', 'PT404', 'PT409', 'PT499', 'PT503', '42501', '55P03', '40P01', '40001', '57014',
  'P0001', '23502', '23503', '23505', '23514', '22P02', '25P02', '57P01', '57P02', '57P03', ...Object.keys(TEST_OWNER_CREATE_FAILURE_LABELS), ...Object.keys(TEST_OWNER_PRISTINE_DISCARD_FAILURE_LABELS),
  // The six catalog checks share P2501; only the later probes emit P2507–48.
  'P2501', ...TEST_OWNER_PUBLICATION_DB_CHECK_LABELS.slice(6, -1).map((_, index) => `P25${String(index + 7).padStart(2, '0')}`),
  ...Object.keys(TEST_OWNER_REORDER_BULK_FAILURE_CODES), ...Object.keys(TEST_OWNER_REORDER_DEADLINE_PHASE_CODES)])
type Phase = 'idle' | 'setup' | 'privilege' | 'snapshot' | 'contracts' | 'contracts-verify' | 'races' | 'races-verify' | 'transitions' | 'complete'
type Role = 'none' | 'fixture' | 'contracts' | 'holder' | 'contender'
type Fault = 'guard' | 'timeout' | 'child-exit' | 'protocol' | 'budget' | 'unknown'
type GuardCheckpoint = 'none' | 'sdk-deadline' | 'sdk-runner' | 'source-git' | 'source-files' | 'endpoint' | 'resources' | 'sql-ownership'|'probe-native-frame'|'probe-http'|'probe-restoration'
class SurveySdkDeadlineError extends Error { constructor() { super('Survey SDK ordinary dispatch expired') } }
// Retain only one allowlisted code. Untrusted stderr lines are bounded and
// discarded; neither their text nor an exception is part of the diagnostic.
function captureSqlstate(surveyObserver = false) {
  let line = ''; let discard = false; let observed: string | undefined
  function consume() {
    if (!discard && observed === undefined) {
      const match = line.match(/^(?:psql:<stdin>:[1-9]\d{0,6}: )?(?:ERROR|FATAL):[ \t]+([A-Z0-9]{5})[ \t\r]*$/)
      if (match) observed = sqlstates.has(match[1]) || surveyObserver && match[1] === 'P7501' ? match[1] : 'unknown'
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
type PublicationPrivilegeKind = 'snapshot247' | 'publication252' | 'legacy139' | 'activation134'
function snapshotPrivilegeSql(kind: 'snapshot' | 'create' | 'discard' | 'discard-inner' | 'reorder' | 'learner' | 'owner-grading' | 'owner-recovery' | 'owner-unpublication' | 'owner-deletion' | 'survey' | PublicationPrivilegeKind = 'snapshot') {
  const signature = kind === 'snapshot' ? 'public.snapshot_test_draft_save_for_owner_v1(uuid,uuid,timestamp with time zone)'
    : kind === 'create' ? 'public.create_test_for_owner_v1(uuid,uuid,text,timestamp with time zone)'
    : kind === 'discard' ? 'public.discard_pristine_test_draft_for_owner_v1(uuid,uuid,integer,timestamp with time zone,timestamp with time zone)'
    : kind === 'discard-inner' ? 'public.discard_pristine_test_draft_atomic(uuid,uuid,integer,timestamp with time zone)'
    : kind === 'reorder' ? 'public.reorder_tests_for_owner_v1(uuid,uuid,uuid[],timestamp with time zone)'
    : kind === 'learner' ? 'public.test_learner_workflow_v1(uuid,uuid,uuid,text,jsonb,timestamp with time zone)'
    : kind === 'owner-grading' || kind === 'owner-recovery' || kind === 'owner-unpublication' || kind === 'owner-deletion' ? 'public.test_owner_workflow_v1(uuid,uuid,uuid,text,jsonb,jsonb,timestamp with time zone)'
    : kind === 'survey' ? 'public.get_survey_for_owner_v1(uuid,uuid)'
    : kind === 'snapshot247' ? 'public.snapshot_test_draft_for_owner_v1(uuid,uuid,timestamp with time zone)'
    : kind === 'publication252' ? 'public.publish_test_from_draft_for_owner_v1(uuid,uuid,uuid,text,integer,jsonb,timestamp with time zone)'
    : kind === 'legacy139' ? 'public.publish_test_from_draft_atomic(uuid,uuid,integer)'
    : 'public.activate_test_from_draft_atomic(uuid,uuid,integer)'
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
    expectedEvidence: { status: 503, rpcCalls: (['publication252', 'legacy139', 'activation134'].includes(kind) ? 2 : 1) as 1 | 2, rawCode: '42501' }, probes: 1 })
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
  const originalIds = new Set<string>(original.allocatedIds)
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
  // Preserve complete strict equality without formatting an unbounded object
  // diff into the failure. Native diagnostics must not render fixture rows.
  assert(isDeepStrictEqual(fixture, newTestOwnerCreateFixture(original)), 'Test owner-create fixture differs')
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

/** The durable fixture is installed exactly once by the inherited512KiB hook.
 * Presence-only native setup retains the shared256KiB SQL admission limit. */
export function buildTestOwnerPristineDiscardNativeContractsManifest(original: AssignmentListProofFixture,
  fixture: TestOwnerPristineDiscardFixture, reviewedHead: string, repository: string) {
  assert.match(reviewedHead, /^[a-f0-9]{40}$/)
  assert(isDeepStrictEqual(fixture, newTestOwnerPristineDiscardFixture(original)), 'Test pristine-discard fixture differs')
  assert(Object.isFrozen(fixture))
  const projectId = `pika_assignment_list_${fixture.tag.slice(-12)}`
  const q = (s: string) => `'${s.replaceAll("'", "''")}'`
  const classes = fixture.classes.map(c => `${q(c.id)}::uuid`).join(',')
  const actors = fixture.actors.map(a => `${q(a.id)}::uuid`).join(',')
  const guard = testOwnerGuardSql(projectId)
  const setup = `${guard}\nbegin read only;set local lock_timeout='1s';set local statement_timeout='8s';
do $presence$ begin
 if current_database()<>'postgres' or current_user<>'postgres'
 or to_regprocedure('public.discard_pristine_test_draft_for_owner_v1(uuid,uuid,integer,timestamp with time zone,timestamp with time zone)') is null
 or to_regprocedure('public.discard_pristine_test_draft_atomic(uuid,uuid,integer,timestamp with time zone)') is null
 or (select count(*) from public.users where id=any(array[${actors}]) and email like ${q(fixture.tag + '%@example.invalid')})<>4
 or (select count(*) from public.classrooms where id=any(array[${classes}]))<>4
 or (select count(*) from public.tests where classroom_id=any(array[${classes}]))<>1001
 or (select count(*) from public.assessment_drafts where classroom_id=any(array[${classes}]))<>16
 or (select count(*) from public.classroom_enrollments where classroom_id=any(array[${classes}]))<>4
 or (select count(*) from public.gradebook_categories where classroom_id=any(array[${classes}]))<>12
 or (select count(*) from public.classroom_archive_revisions where classroom_id=any(array[${classes}]))<>4
 then raise exception 'Migration251 fixture presence differs';end if;
end;$presence$;rollback;`
  const contracts = freeze({ contracts: testOwnerPristineDiscardDbContractsSql(fixture, projectId),
    caps: TEST_OWNER_PRISTINE_DISCARD_DB_CAPS,
    expectedLabels: [...TEST_OWNER_PRISTINE_DISCARD_DB_CHECK_LABELS].sort(),
    limitations: TEST_OWNER_PRISTINE_DISCARD_DB_LIMITATIONS,
    planObjectIds: testOwnerPristineDiscardDbPlanObjectIds(fixture) })
  const allocated = new Set([...original.allocatedIds, ...fixture.allocatedIds])
  assert(contracts.planObjectIds.every(id => !allocated.has(id)))
  const concurrency = testOwnerPristineDiscardConcurrencyManifest(fixture)
  const snapshot = testOwnerPristineDiscardSnapshotSql(fixture)
  for (const sql of [setup, snapshot, contracts.contracts]) assert(Buffer.byteLength(sql) <= DRAFT_SAVE_CAPS.sqlBytes)
  return freeze({ version: 1, reviewedHead, migrationManifestSha256: draftSaveMigrationManifestSha256(repository),
    sourceSha256: testOwnerDigest(readFileSync(resolve(repository, 'supabase/migrations/251_contextual_test_pristine_owner_discard.sql'), 'utf8')),
    fixture, guard, setup, contracts, concurrency, snapshot, bootstrap: boot, termination: draftSaveNativeTerminationSql(),
    close: 'rollback;', capabilities: CAPS, framing: 'psql-echo-monotonic-v1', contextTemplate,
    privilege: snapshotPrivilegeSql('discard'), innerPrivilege: snapshotPrivilegeSql('discard-inner') })
}
type DiscardManifest = ReturnType<typeof buildTestOwnerPristineDiscardNativeContractsManifest>
export function validateTestOwnerPristineDiscardNativeSql(manifest: DiscardManifest, sql: string) {
  if (typeof sql !== 'string' || Buffer.byteLength(sql) > DRAFT_SAVE_CAPS.sqlBytes) return false
  return [manifest.setup, manifest.snapshot, manifest.bootstrap, manifest.close, manifest.contracts.contracts,
    manifest.privilege.catalog, manifest.privilege.revoke, manifest.innerPrivilege.catalog, manifest.innerPrivilege.revoke].includes(sql)
    || validateTestOwnerPristineDiscardConcurrencySql(manifest.concurrency, sql)
}
/** Accept actual populated selective lookup evidence, never index DDL alone.
 * The exact eligible tree and column closure are refined with the source-owned
 * rollback contract before native acceptance; all unknown nodes fail closed. */
export function validateTestOwnerPristineDiscardManagedPlan(value: unknown, fixture: TestOwnerPristineDiscardFixture) {
  const record = (v: unknown): Record<string, unknown> => {
    assert(v && typeof v === 'object' && !Array.isArray(v)); return v as Record<string, unknown>
  }
  assert(Array.isArray(value) && value.length === 1)
  const envelope = record(value[0]); assert.deepEqual(Object.keys(envelope), ['Plan'])
  const plan = record(envelope.Plan)
  const target = fixture.cases.find(c => c.label === 'restored-privilege-success')!
  const expectedCondition = `(resource_id = '${target.testId}'::uuid)`
  const common = ['Node Type', 'Parallel Aware', 'Async Capable']
  assert(plan['Parallel Aware'] === false && (plan['Async Capable'] === undefined || plan['Async Capable'] === false))
  if (plan['Node Type'] === 'Index Scan' || plan['Node Type'] === 'Index Only Scan') {
    assert(Object.keys(plan).every(k => [...common, 'Scan Direction', 'Index Name', 'Relation Name', 'Alias', 'Index Cond'].includes(k)))
    assert.equal(plan['Scan Direction'], 'Forward')
    assert.equal(plan['Index Name'], 'idx_managed_storage_test_resource_owner_discard')
    assert.equal(plan['Relation Name'], 'managed_storage_objects'); assert.equal(plan.Alias, 'managed_storage_objects')
    assert.equal(plan['Index Cond'], expectedCondition)
  } else {
    assert.equal(plan['Node Type'], 'Bitmap Heap Scan')
    assert(Object.keys(plan).every(k => [...common, 'Relation Name', 'Alias', 'Recheck Cond', 'Plans'].includes(k)))
    assert.equal(plan['Relation Name'], 'managed_storage_objects'); assert.equal(plan.Alias, 'managed_storage_objects')
    assert.equal(plan['Recheck Cond'], `(${expectedCondition} AND (resource_type = 'test'::text))`)
    assert(Array.isArray(plan.Plans) && plan.Plans.length === 1)
    const scan = record(plan.Plans[0])
    assert(Object.keys(scan).every(k => [...common, 'Parent Relationship', 'Index Name', 'Index Cond'].includes(k)))
    assert.equal(scan['Node Type'], 'Bitmap Index Scan'); assert.equal(scan['Parent Relationship'], 'Outer')
    assert.equal(scan['Parallel Aware'], false); assert(scan['Async Capable'] === undefined || scan['Async Capable'] === false)
    assert.equal(scan['Index Name'], 'idx_managed_storage_test_resource_owner_discard'); assert.equal(scan['Index Cond'], expectedCondition)
  }
  return true
}
async function runTestOwnerPristineDiscardContracts(manifest: DiscardManifest, bound: DraftSaveTarget, d: DraftSaveDriver) {
  assert.equal(bound.projectId, `pika_assignment_list_${manifest.fixture.tag.slice(-12)}`)
  assert.equal(bound.acceptedManifestSha256, testOwnerDigest(JSON.stringify(manifest.contracts)))
  assert.deepEqual(await d.verifyTarget(), bound)
  const session = await d.openSession(`${bound.projectId}_draft_contracts`)
  try {
    const rows = await session.execute(manifest.contracts.contracts, manifest.contracts.caps.actionMs)
    assert.equal(rows.length, 1); assert(Buffer.byteLength(JSON.stringify(rows)) <= 65536)
    const value = rows[0].result; assert(value && typeof value === 'object' && !Array.isArray(value))
    const row = value as Record<string, unknown>
    assert.deepEqual(Object.keys(row).sort(), ['check_count', 'checks', 'draft_columns', 'fixture_tag', 'limitations', 'managed_resource_plan',
      'managed_resource_plan_fixture_count', 'managed_resource_plan_ids_sha256', 'native_execution', 'rollback_only', 'test_columns', 'version'])
    assert.equal(row.version, 1); assert.equal(row.native_execution, true); assert.equal(row.rollback_only, true)
    assert.equal(row.fixture_tag, manifest.fixture.tag)
    assert(Array.isArray(row.checks) && row.checks.length === manifest.contracts.expectedLabels.length)
    assert.equal(row.check_count, row.checks.length)
    for (const check of row.checks) {
      assert(check && typeof check === 'object' && !Array.isArray(check)); assert.deepEqual(Object.keys(check).sort(), ['code', 'label', 'ok'])
      assert.equal(check.ok, true); assert.equal(check.code, '00000')
    }
    assert.deepEqual(row.checks.map(c => c.label).sort(), manifest.contracts.expectedLabels)
    assert.deepEqual(row.limitations, manifest.contracts.limitations)
    assert.equal(row.managed_resource_plan_fixture_count, manifest.contracts.planObjectIds.length)
    assert.equal(row.managed_resource_plan_ids_sha256, testOwnerDigest(manifest.contracts.planObjectIds.join('\n')))
    for (const [columns, expected] of [[row.test_columns, Object.keys(contextualTestCreateTestSchema.shape)],
      [row.draft_columns, Object.keys(contextualTestCreateDraftSchema.shape)]] as const) {
      assert(Array.isArray(columns) && columns.every(c => typeof c === 'string'))
      assert.deepEqual([...columns].sort(), [...expected].sort())
    }
    validateTestOwnerPristineDiscardManagedPlan(row.managed_resource_plan, manifest.fixture)
    return Object.freeze({ kind: 'rollback-contracts' as const, checkCount: row.check_count,
      evidenceSha256: testOwnerDigest(JSON.stringify(value)), sourceSha256: bound.reviewedSourceSha256 })
  } finally { await session.rollbackAndClose(CAPS.closeMs) }
}

/** The shared inherited512KiB setup hook installs this fixture once. This
 * additive profile only verifies presence; every admitted native SQL stays256KiB. */
export function buildTestOwnerPublicationNativeContractsManifest(original: AssignmentListProofFixture,
  fixture: TestOwnerPublicationFixture, reviewedHead: string, repository: string) {
  assert.match(reviewedHead, /^[a-f0-9]{40}$/)
  assert(isDeepStrictEqual(fixture, newTestOwnerPublicationFixture(original)), 'Test publication fixture differs')
  assert(Object.isFrozen(fixture))
  const projectId = `pika_assignment_list_${fixture.tag.slice(-12)}`
  const q = (s: string) => `'${s.replaceAll("'", "''")}'`
  const classes = fixture.classes.map(c => `${q(c.id)}::uuid`).join(',')
  const actors = fixture.actors.map(a => `${q(a.id)}::uuid`).join(',')
  const guard = testOwnerGuardSql(projectId)
  const setup = `${guard}\nbegin read only;set local lock_timeout='1s';set local statement_timeout='8s';
do $presence$ begin
 if current_database()<>'postgres' or current_user<>'postgres'
 or to_regprocedure('public.publish_test_from_draft_for_owner_v1(uuid,uuid,uuid,text,integer,jsonb,timestamp with time zone)') is null
 or to_regprocedure('public.snapshot_test_draft_for_owner_v1(uuid,uuid,timestamp with time zone)') is null
 or to_regprocedure('public.publish_test_from_draft_atomic(uuid,uuid,integer)') is null
 or to_regprocedure('public.activate_test_from_draft_atomic(uuid,uuid,integer)') is null
 or (select count(*) from public.users where id=any(array[${actors}]) and email like ${q(fixture.tag + '%@example.invalid')})<>4
 or (select count(*) from public.classrooms where id=any(array[${classes}]))<>6
 or (select count(*) from public.tests where classroom_id=any(array[${classes}]))<>16
 or (select count(*) from public.assessment_drafts where classroom_id=any(array[${classes}]))<>15
 or (select count(*) from public.test_questions where test_id in (select id from public.tests where classroom_id=any(array[${classes}])))<>${fixture.inventory.questions}
 or (select count(*) from public.classroom_enrollments where classroom_id=any(array[${classes}]))<>2
 or (select count(*) from public.gradebook_categories where classroom_id=any(array[${classes}]))<>18
 or (select count(*) from public.classroom_archive_revisions where classroom_id=any(array[${classes}]))<>6
 or (select count(*) from public.course_blueprints where id=${q(fixture.blueprint.id)}::uuid)<>1
 or (select count(*) from public.course_blueprint_versions where course_blueprint_id=${q(fixture.blueprint.id)}::uuid)<>1
 then raise exception 'Migration252 fixture presence differs';end if;
end;$presence$;rollback;`
  const contracts = testOwnerPublicationDbContractsManifest(fixture, projectId)
  const concurrency = testOwnerPublicationConcurrencyManifest(fixture)
  const committed = testOwnerPublicationCommittedManifest(fixture)
  const snapshot = testOwnerPublicationSnapshotSql(fixture)
  for (const sql of [setup, snapshot, contracts.contracts]) assert(Buffer.byteLength(sql) <= DRAFT_SAVE_CAPS.sqlBytes)
  const publicationPrivileges = freeze({ snapshot247: snapshotPrivilegeSql('snapshot247'), publication252: snapshotPrivilegeSql('publication252'),
    legacy139: snapshotPrivilegeSql('legacy139'), activation134: snapshotPrivilegeSql('activation134') })
  return freeze({ version: 1, reviewedHead, migrationManifestSha256: draftSaveMigrationManifestSha256(repository),
    sourceSha256: testOwnerDigest(readFileSync(resolve(repository, 'supabase/migrations/252_contextual_test_owner_publication.sql'), 'utf8')),
    fixture, guard, setup, contracts, concurrency, committed, snapshot, bootstrap: boot, termination: draftSaveNativeTerminationSql(),
    close: 'rollback;', capabilities: CAPS, framing: 'psql-echo-monotonic-v1', contextTemplate,
    privilege: publicationPrivileges.publication252, publicationPrivileges })
}
type PublicationManifest = ReturnType<typeof buildTestOwnerPublicationNativeContractsManifest>
export function validateTestOwnerPublicationNativeSql(manifest: PublicationManifest, sql: string) {
  if (typeof sql !== 'string' || Buffer.byteLength(sql) > DRAFT_SAVE_CAPS.sqlBytes) return false
  return [manifest.setup, manifest.snapshot, manifest.bootstrap, manifest.close, manifest.contracts.contracts,
    ...Object.values(manifest.publicationPrivileges).flatMap(p => [p.catalog, p.revoke])].includes(sql)
    || validateTestOwnerPublicationConcurrencySql(manifest.concurrency, sql)
    || validateTestOwnerPublicationCommittedSql(manifest.committed, sql)
}
/** Durable installation belongs to the original lifecycle fixture hook. This
 * closed254 profile only checks presence and admits finite source-owned SQL.
 * It neither raises inherited engine caps nor attests native execution. */
export function buildTestOwnerReorderNativeContractsManifest(original: AssignmentListProofFixture,
  fixture: TestOwnerReorderFixture, reviewedHead: string, repository: string) {
  assert.match(reviewedHead, /^[a-f0-9]{40}$/)
  assert(isDeepStrictEqual(fixture, newTestOwnerReorderFixture(original)), 'Test reorder fixture differs')
  assert(Object.isFrozen(fixture))
  const projectId = `pika_assignment_list_${fixture.tag.slice(-12)}`
  const q = (s: string) => `'${s.replaceAll("'", "''")}'`
  const classes = fixture.classes.map(c => `${q(c.id)}::uuid`).join(',')
  const actors = fixture.actors.map(a => `${q(a.id)}::uuid`).join(',')
  const testIds = `select id from public.tests where classroom_id=any(array[${classes}])`
  const guard = testOwnerGuardSql(projectId)
  const setup = `${guard}\nbegin read only;set local lock_timeout='1s';set local statement_timeout='8s';
do $presence$ begin
 if current_database()<>'postgres' or current_user<>'postgres'
 or to_regprocedure('public.reorder_tests_for_owner_v1(uuid,uuid,uuid[],timestamp with time zone)') is null
 or (select count(*) from private.classroom_test_quota_settings)<>1
 or not exists(select 1 from private.classroom_test_quota_settings where singleton and not enabled)
 or (select count(*) from public.users where id=any(array[${actors}]) and email like ${q(fixture.tag + '%@example.invalid')})<>5
 or (select count(*) from public.classrooms where id=any(array[${classes}]))<>7
 or (select count(*) from public.tests where classroom_id=any(array[${classes}]))<>3012
 or (select count(*) from public.assessment_drafts where classroom_id=any(array[${classes}]))<>12
 or (select count(*) from public.test_questions where test_id in (${testIds}))<>24
 or (select count(*) from public.classroom_enrollments where classroom_id=any(array[${classes}]))<>6
 or (select count(*) from public.gradebook_categories where classroom_id=any(array[${classes}]))<>21
 or (select count(*) from public.classroom_archive_revisions where classroom_id=any(array[${classes}]))<>7
 or (select count(*) from public.test_attempts where test_id in (${testIds}))<>3
 or (select count(*) from public.test_responses where test_id in (${testIds}))<>3
 or (select count(*) from public.test_student_availability where test_id in (${testIds}))<>3
 or (select count(*) from public.test_focus_events where test_id in (${testIds}))<>3
 or (select count(*) from public.test_attempt_history where test_attempt_id in (select id from public.test_attempts where test_id in (${testIds})))<>3
 or (select count(*) from public.classroom_guided_draft_provenance where classroom_id=any(array[${classes}]))<>3
 then raise exception 'Migration254 fixture presence differs';end if;
end;$presence$;rollback;`
  const contracts = testOwnerReorderDbContractsManifest(fixture, projectId, repository)
  const concurrency = testOwnerReorderConcurrencyManifest(fixture)
  const committed = testOwnerReorderCommittedManifest(fixture)
  const snapshot = testOwnerReorderSnapshotSql(fixture)
  for (const sql of [setup, snapshot, ...contracts.contracts.map(batch => batch.sql)]) assert(Buffer.byteLength(sql) <= DRAFT_SAVE_CAPS.sqlBytes)
  const sourceSha256 = testOwnerDigest(readFileSync(resolve(repository, 'supabase/migrations/254_contextual_test_owner_reorder.sql'), 'utf8'))
  assert.equal(sourceSha256, TEST_OWNER_REORDER_SOURCE_SHA256)
  return freeze({ version: 1, reviewedHead, migrationManifestSha256: draftSaveMigrationManifestSha256(repository), sourceSha256,
    fixture, guard, setup, contracts, concurrency, committed, snapshot, bootstrap: boot, termination: draftSaveNativeTerminationSql(),
    close: 'rollback;', capabilities: CAPS, framing: 'psql-echo-monotonic-v1', contextTemplate, privilege: snapshotPrivilegeSql('reorder') })
}
type ReorderManifest = ReturnType<typeof buildTestOwnerReorderNativeContractsManifest>
export function validateTestOwnerReorderNativeSql(manifest: ReorderManifest, sql: string) {
  if (typeof sql !== 'string' || Buffer.byteLength(sql) > DRAFT_SAVE_CAPS.sqlBytes) return false
  return [manifest.setup, manifest.snapshot, manifest.bootstrap, manifest.close, manifest.privilege.catalog, manifest.privilege.revoke,
    ...manifest.contracts.contracts.map(batch => batch.sql)].includes(sql)
    || validateTestOwnerReorderConcurrencySql(manifest.concurrency, sql)
    || validateTestOwnerReorderCommittedSql(manifest.committed, sql)
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
  /** Trusted caller denial/join gate only; never selects SQL or replaces guards. */
  restorationAdmission?: () => Promise<void>;
}
type NativeManifestShape = Omit<Manifest, 'fixture' | 'contracts' | 'concurrency'|'capabilities'> & { fixture: object;
  capabilities:Omit<typeof CAPS,'controlCalls'>&{controlCalls:4000|6000} }
type NativeOwnerProfile<M extends NativeManifestShape, C, R,
  T = Awaited<ReturnType<typeof runTestOwnerPublicationCommittedTransitions>>> = Readonly<{
  manifest: M;
  project: string;
  sourceFile: '249_contextual_test_draft_owner_save.sql' | '250_contextual_test_owner_create.sql' | '251_contextual_test_pristine_owner_discard.sql' | '252_contextual_test_owner_publication.sql' | '254_contextual_test_owner_reorder.sql' | '257_contextual_test_learner_workflow.sql' | '259_contextual_test_owner_grading.sql' | '260_contextual_test_owner_recovery.sql' | '261_contextual_test_owner_unpublish.sql' | '262_contextual_test_owner_delete.sql' | '263_contextual_surveys_workflow.sql' | '269_contextual_surveys_workflow.sql';
  label: 'test-owner-draft-save' | 'test-owner-create' | 'test-owner-pristine-discard' | 'test-owner-publication' | 'test-owner-reorder' | 'test-owner-reorder-diagnostic' | 'test-learner' | 'test-owner-grading' | 'test-owner-recovery' | 'test-owner-unpublication' | 'test-owner-deletion' | 'survey263' | 'survey269-component';
  learnerCancellation?: TestLearnerNativePlan['cancellation'];
  innerPrivilege?: ReturnType<typeof snapshotPrivilegeSql>;
  publicationPrivileges?: Readonly<Record<PublicationPrivilegeKind, ReturnType<typeof snapshotPrivilegeSql>>>;
  absoluteDeadline?: number;
  singleMs?: number;
  committedSha256?: string;
  committedOuterPrivilege?: true;
  reorderProgressSql?: Readonly<{ bulk: string; calibration: string }>;
  reorderDiagnosticSql?: string;
  surveyProgressSql?: string;
  /** Only the concrete Survey factory can bind these private status credentials. */
  surveySdk?: Readonly<{ fixture: SurveyNativeFixture; status: ReturnType<typeof validateAssignmentListProofTarget> }>;
  survey263Endpoint?: Readonly<{ host: string; identity: readonly [number, number, number, number] }>;
  survey263Budget?: Survey263Budget;
  survey263NativeCli?: Survey263NativeCli;
  surveyCommitted?: SurveyCommittedProofManifest;
  survey269Component?: Survey269ComponentBinding;
  survey269Exchange?: Survey269ComponentExchange;
  survey269Remaining?: Pick<ReturnType<typeof survey269RemainingPlan>,'cancellation'|'wire'>;
  runCommitted?(target: DraftSaveTarget, driver: DraftSaveDriver): Promise<T>;
  validateSql(sql: string): boolean;
  contractsSha256: string;
  racesSha256: string;
  runContracts(target: DraftSaveTarget, driver: DraftSaveDriver): Promise<C>;
  runRaces(target: DraftSaveTarget, driver: DraftSaveDriver): Promise<R>;
}>

/** Exact263 addition only. The executor remains private and predecessor profiles
 * retain their closed migration catalogs, SQL allowlists and capabilities. */
type SurveyEngineFields = { bootstrap: string; termination: string; close: string; capabilities: typeof CAPS;
  framing: string; contextTemplate: string; privilege: ReturnType<typeof snapshotPrivilegeSql> }
type SurveyManifest = ReturnType<typeof surveyNativePlan> & SurveyEngineFields
type SurveyRemainingManifest = ReturnType<typeof surveyRemainingNativePlan> & SurveyEngineFields
export function buildSurveyNativeContractsManifest(original: AssignmentListProofFixture, reviewedHead: string, repository: string, remainingOnly: true): SurveyRemainingManifest
export function buildSurveyNativeContractsManifest(original: AssignmentListProofFixture, reviewedHead: string, repository: string, remainingOnly?: undefined): SurveyManifest
export function buildSurveyNativeContractsManifest(original: AssignmentListProofFixture, reviewedHead: string, repository: string, remainingOnly: true | undefined): SurveyManifest | SurveyRemainingManifest
export function buildSurveyNativeContractsManifest(original: AssignmentListProofFixture, reviewedHead: string, repository: string, remainingOnly?: true) {
  assert(remainingOnly === undefined || remainingOnly === true)
  const plan = remainingOnly ? surveyRemainingNativePlan(original, reviewedHead, repository) : surveyNativePlan(original, reviewedHead, repository)
  return freeze({ ...plan, bootstrap: boot, termination: draftSaveNativeTerminationSql(), close: 'rollback;',
    capabilities: CAPS, framing: 'psql-echo-monotonic-v1', contextTemplate, privilege: snapshotPrivilegeSql('survey') })
}
export function createContextualSurveysNativeContracts(input: NativeOwnerInput & { absoluteDeadline: number; statusTarget?: unknown;
  remainingOnly?: true;
  survey263Endpoint: Readonly<{ host: string; identity: readonly [number, number, number, number]; budget: Survey263Budget; nativeCli: Survey263NativeCli }> }) {
  const now = Date.now()
  assert(Number.isSafeInteger(input.absoluteDeadline) && input.absoluteDeadline > now && input.absoluteDeadline <= now + CAPS.totalMs)
  assert(input.survey263Endpoint && Object.keys(input.survey263Endpoint).every(key => ['kind', 'host', 'identity', 'budget', 'nativeCli'].includes(key)))
  const survey263Budget = validateSurvey263Budget(input.survey263Endpoint.budget)
  assert.equal(input.absoluteDeadline, survey263Budget.workDeadline, 'Survey original work deadline differs')
  const survey263NativeCli = verifySurvey263NativeCli(input.survey263Endpoint.nativeCli)
  assert(input.survey263Endpoint.host.startsWith('unix:///') && !/[\x00-\x20\x7f%?#]/.test(input.survey263Endpoint.host))
  assert(input.survey263Endpoint.identity.length === 4 && input.survey263Endpoint.identity.every(n => Number.isSafeInteger(n) && n >= 0))
  const survey263Endpoint = Object.freeze({ host: input.survey263Endpoint.host,
    identity: Object.freeze([...input.survey263Endpoint.identity]) as readonly [number, number, number, number] })
  const manifest = buildSurveyNativeContractsManifest(input.original, input.reviewedHead, input.repository, input.remainingOnly)
  const remaining = 'committed' in manifest ? manifest : undefined
  const engine = createNativeOwnerContracts(input, { manifest, project: manifest.projectId,
    sourceFile: '263_contextual_surveys_workflow.sql', label: 'survey263', absoluteDeadline: input.absoluteDeadline, survey263Endpoint, survey263Budget, survey263NativeCli,
    singleMs: 35000,
    ...(remaining ? { surveyCommitted: remaining.committed } : {}),
    ...(input.statusTarget === undefined ? {} : { surveySdk: {
      fixture: manifest.fixture, status: validateAssignmentListProofTarget(input.statusTarget, manifest.projectId),
    } }),
    validateSql: sql => [manifest.bootstrap, manifest.close].includes(sql) || validateSurveyNativeSql(manifest, sql),
    contractsSha256: testOwnerDigest(JSON.stringify(manifest.contracts)), racesSha256: testOwnerDigest(JSON.stringify(manifest.concurrency)),
    runContracts: (target, driver) => runSurveyNativeRollbackContracts(manifest, target, driver),
    runRaces: (target, driver) => runSurveyNativeRollbackRaces(manifest, target, driver),
  })
  const { manifest: sealed, setup, verifyTarget, diagnostic, run } = engine
  // This first bounded profile never asserts full Survey acceptance or exposes
  // the inherited Test privilege/committed-transition programming surfaces.
  return Object.freeze({ manifest: sealed, setup, verifyTarget, diagnostic, run,
    ...(remaining ? { async runRemainingCommitted() {
      assert(engine.runSurveyRemainingCommitted)
      return engine.runSurveyRemainingCommitted()
    }, inventoryComplete: false as const } : {}),
    async runSdkCommitted() {
      assert(engine.runSurveySdkCommitted, 'Survey SDK private status binding is absent')
      return engine.runSurveySdkCommitted()
    }, async generateTypes263() {
      assert(engine.generateSurveyTypes, 'Survey types private status binding is absent')
      return engine.generateSurveyTypes()
    }, nativeVerified: false as const })
}

export function buildSurvey269ComponentManifest(original: AssignmentListProofFixture, binding: Survey269ComponentBinding) {
  const plan = survey269ComponentPlan(original, binding)
  return freeze({ ...plan, bootstrap: boot, termination: draftSaveNativeTerminationSql(), close: 'rollback;',
    capabilities: CAPS, framing: 'psql-echo-monotonic-v1', contextTemplate, privilege: snapshotPrivilegeSql('survey') })
}
export function buildSurvey269RemainingManifest(original:AssignmentListProofFixture,binding:Survey269ComponentBinding){
  const plan=survey269RemainingPlan(original,binding)
  return freeze({...plan,bootstrap:boot,termination:draftSaveNativeTerminationSql(),close:'rollback;',
    capabilities:{...CAPS,controlCalls:6000 as const},framing:'psql-echo-monotonic-v1',contextTemplate,privilege:snapshotPrivilegeSql('survey')})
}
/** No race/committed/cancellation or arbitrary skip capability is returned. */
export function createSurvey269ComponentNativeContracts(input: Omit<NativeOwnerInput, 'repository' | 'reviewedHead'> & {
  binding: Survey269ComponentBinding; absoluteDeadline: number; statusTarget: unknown;
  survey263Endpoint: Readonly<{ host: string; identity: readonly [number, number, number, number]; budget: Survey263Budget; nativeCli: Survey263NativeCli; componentExchange?: Survey269ComponentExchange }>;
}) {
  const result=createSurvey269Contracts(input,false);assert(result.runContractsOnly)
  return Object.freeze({...result,runContractsOnly:result.runContractsOnly})
}
export function createSurvey269RemainingNativeContracts(input:Parameters<typeof createSurvey269ComponentNativeContracts>[0]) {
  const result=createSurvey269Contracts(input,true);assert(result.runRemainingCommitted)
  return Object.freeze({...result,runRemainingCommitted:result.runRemainingCommitted})
}
function createSurvey269Contracts(input:Parameters<typeof createSurvey269ComponentNativeContracts>[0],remaining:boolean) {
  assert(Number.isSafeInteger(input.absoluteDeadline) && input.absoluteDeadline > Date.now() && input.absoluteDeadline <= Date.now() + CAPS.totalMs)
  assert.deepEqual(Object.keys(input).sort(), ['absoluteDeadline','acceptedManifestSha256','binding','capturedResources','containerId','original','statusTarget','survey263Endpoint'].sort())
  assert(input.survey263Endpoint && Object.keys(input.survey263Endpoint).every(key => ['kind','host','identity','budget','nativeCli','componentExchange'].includes(key)))
  assert(input.survey263Endpoint.componentExchange, 'Survey269 shared exchange ledger is absent')
  const exchangeReceipt=survey269ComponentExchangeReceipt(input.survey263Endpoint.componentExchange)
  assert.equal(exchangeReceipt.limit,(remaining?128:64)*1024*1024,'Survey269 ledger byte profile differs')
  if(!remaining)assert(exchangeReceipt.controlLimit===4000&&!('requests' in exchangeReceipt),'Survey269 component ledger profile differs')
  if(remaining) assertSurvey269RemainingExchange(input.survey263Endpoint.componentExchange)
  const budget = validateSurvey263Budget(input.survey263Endpoint.budget)
  assert.equal(input.absoluteDeadline, budget.workDeadline)
  const cli = verifySurvey263NativeCli(input.survey263Endpoint.nativeCli)
  assert(input.survey263Endpoint.host.startsWith('unix:///') && !/[\x00-\x20\x7f%?#]/.test(input.survey263Endpoint.host))
  assert(input.survey263Endpoint.identity.length === 4 && input.survey263Endpoint.identity.every(n => Number.isSafeInteger(n) && n >= 0))
  const manifest = remaining?buildSurvey269RemainingManifest(input.original,input.binding):buildSurvey269ComponentManifest(input.original, input.binding)
  const plan='committed' in manifest?manifest:undefined
  if(remaining)assert(plan?.inventoryComplete,'Survey269 remaining source inventory is incomplete')
  const nativeInput = { ...input, repository: SURVEY_269_COMPONENT_ROOTS.product, reviewedHead: manifest.reviewedHead }
  const engine = createNativeOwnerContracts(nativeInput, { manifest, project: manifest.projectId,
    sourceFile: '269_contextual_surveys_workflow.sql', label: 'survey269-component', absoluteDeadline: input.absoluteDeadline,
    surveyProgressSql: manifest.contracts.sql,
    survey269Component: manifest.binding, survey269Exchange: input.survey263Endpoint.componentExchange, survey263Budget: budget, survey263NativeCli: cli,
    ...(plan?{surveyCommitted:plan.committed,survey269Remaining:{cancellation:plan.cancellation,wire:plan.wire}}:{}),
    survey263Endpoint: freeze({ host: input.survey263Endpoint.host, identity: [...input.survey263Endpoint.identity] as [number,number,number,number] }),
    singleMs: 35000, surveySdk: { fixture: manifest.fixture, status: validateAssignmentListProofTarget(input.statusTarget, manifest.projectId) },
    validateSql: sql => [manifest.bootstrap, manifest.close].includes(sql) || validateSurvey269ComponentSql(manifest, sql),
    contractsSha256: testOwnerDigest(JSON.stringify(manifest.contracts)), racesSha256: testOwnerDigest(JSON.stringify(manifest.concurrency)),
    runContracts: (target, driver) => runSurvey269ComponentRollback(manifest, target, driver),
    runRaces: async () => {throw new Error('Survey269 component cannot run races')},
  })
  return Object.freeze({ manifest: engine.manifest, setup: engine.setup, verifyTarget: engine.verifyTarget, diagnostic: engine.diagnostic,
    ...(!remaining?{runContractsOnly:engine.runSurvey269ContractsOnly!}:{}),runSdkCommitted: engine.runSurveySdkCommitted!,
    ...(remaining?{runRemainingCommitted:engine.runSurveyRemainingCommitted!}:{}),
    generateTypes269: engine.generateSurveyTypes!, nativeVerified: false as const, inventoryComplete: remaining })
}

/** One fixed grading profile reuses the native engine; there is no public SQL,
 * resource selector, migration callback or programmable cleanup surface. */
export function buildTestOwnerGradingNativeContractsManifest(original: AssignmentListProofFixture,
  observed: readonly TestLearnerObservedAttempt[], reviewedHead: string, repository: string) {
  const plan = testOwnerGradingNativePlan(original, observed, reviewedHead, repository)
  return freeze({ ...plan, bootstrap: boot, termination: draftSaveNativeTerminationSql(), close: 'rollback;',
    capabilities: CAPS, framing: 'psql-echo-monotonic-v1', contextTemplate, privilege: snapshotPrivilegeSql('owner-grading') })
}
export function createTestOwnerGradingNativeContracts(input: NativeOwnerInput & {
  observedAttempts: readonly TestLearnerObservedAttempt[]; absoluteDeadline: number;
}) {
  assert(Number.isSafeInteger(input.absoluteDeadline) && input.absoluteDeadline > Date.now())
  const manifest = buildTestOwnerGradingNativeContractsManifest(input.original, input.observedAttempts,
    input.reviewedHead, input.repository)
  const engine = createNativeOwnerContracts(input, { manifest, project: manifest.projectId,
    sourceFile: '259_contextual_test_owner_grading.sql', label: 'test-owner-grading', absoluteDeadline: input.absoluteDeadline,
    singleMs: 12000, committedOuterPrivilege: true,
    validateSql: sql => [manifest.bootstrap, manifest.close, manifest.privilege.catalog, manifest.privilege.revoke].includes(sql)
      || validateTestOwnerGradingNativePlanSql(manifest, sql),
    contractsSha256: testOwnerDigest(JSON.stringify(manifest.contracts)), racesSha256: testOwnerDigest(JSON.stringify(manifest.concurrency)),
    runContracts: (bound, driver) => runTestOwnerGradingNativeContracts(manifest, bound, driver),
    runRaces: (bound, driver) => runTestOwnerGradingNativeRaces(manifest, bound, driver),
  })
  const { manifest: sealed, setup, verifyTarget, diagnostic, run, probeSnapshotPrivilegeDrift } = engine
  return Object.freeze({ manifest: sealed, setup, verifyTarget, diagnostic, run, probeOwnerGradingPrivilegeDrift: probeSnapshotPrivilegeDrift })
}

/** Fixed260 profile reuses all engine controls, settlement and ACL restoration. */
export function buildTestOwnerRecoveryNativeContractsManifest(original: AssignmentListProofFixture,
  observed: readonly TestLearnerObservedAttempt[], reviewedHead: string, repository: string) {
  const plan = testOwnerRecoveryNativePlan(original, observed, reviewedHead, repository)
  return freeze({ ...plan, bootstrap: boot, termination: draftSaveNativeTerminationSql(), close: 'rollback;',
    capabilities: CAPS, framing: 'psql-echo-monotonic-v1', contextTemplate, privilege: snapshotPrivilegeSql('owner-recovery') })
}
export function createTestOwnerRecoveryNativeContracts(input: NativeOwnerInput & {
  observedAttempts: readonly TestLearnerObservedAttempt[]; absoluteDeadline: number;
}) {
  assert(Number.isSafeInteger(input.absoluteDeadline) && input.absoluteDeadline > Date.now())
  const manifest = buildTestOwnerRecoveryNativeContractsManifest(input.original, input.observedAttempts, input.reviewedHead, input.repository)
  const engine = createNativeOwnerContracts(input, { manifest, project: manifest.projectId,
    sourceFile: '260_contextual_test_owner_recovery.sql', label: 'test-owner-recovery', absoluteDeadline: input.absoluteDeadline,
    singleMs: 12000, committedOuterPrivilege: true,
    validateSql: sql => [manifest.bootstrap, manifest.close, manifest.privilege.catalog, manifest.privilege.revoke].includes(sql)
      || validateTestOwnerRecoveryNativePlanSql(manifest, sql),
    contractsSha256: testOwnerDigest(JSON.stringify(manifest.contracts)), racesSha256: testOwnerDigest(JSON.stringify(manifest.concurrency)),
    runContracts: (bound, driver) => runTestOwnerRecoveryNativeContracts(manifest, bound, driver),
    runRaces: (bound, driver) => runTestOwnerRecoveryNativeRaces(manifest, bound, driver),
  })
  const { manifest: sealed, setup, verifyTarget, diagnostic, run, probeSnapshotPrivilegeDrift } = engine
  return Object.freeze({ manifest: sealed, setup, verifyTarget, diagnostic, run, probeOwnerRecoveryPrivilegeDrift: probeSnapshotPrivilegeDrift })
}

/** Fixed261 profile keeps the executor, cancellation and teardown controls private. */
export function buildTestOwnerUnpublicationNativeContractsManifest(original: AssignmentListProofFixture, reviewedHead: string, repository: string) {
  const plan = testOwnerUnpublicationNativePlan(original, reviewedHead, repository)
  return freeze({ ...plan, bootstrap: boot, termination: draftSaveNativeTerminationSql(), close: 'rollback;',
    capabilities: CAPS, framing: 'psql-echo-monotonic-v1', contextTemplate, privilege: snapshotPrivilegeSql('owner-unpublication') })
}
export function createTestOwnerUnpublicationNativeContracts(input: NativeOwnerInput & { absoluteDeadline: number }) {
  const now = Date.now();assert(Number.isSafeInteger(input.absoluteDeadline) && input.absoluteDeadline > now && input.absoluteDeadline <= now + CAPS.totalMs)
  const manifest = buildTestOwnerUnpublicationNativeContractsManifest(input.original, input.reviewedHead, input.repository)
  const engine = createNativeOwnerContracts(input, { manifest, project: manifest.projectId,
    sourceFile: '261_contextual_test_owner_unpublish.sql', label: 'test-owner-unpublication', absoluteDeadline: input.absoluteDeadline,
    singleMs: 12000, committedOuterPrivilege: true,
    validateSql: sql => [manifest.bootstrap, manifest.close, manifest.privilege.catalog, manifest.privilege.revoke].includes(sql)
      || validateTestOwnerUnpublicationNativePlanSql(manifest, sql),
    contractsSha256: testOwnerDigest(JSON.stringify(manifest.contracts)), racesSha256: testOwnerDigest(JSON.stringify(manifest.concurrency)),
    runContracts: (bound, driver) => runTestOwnerUnpublicationNativeContracts(manifest, bound, driver),
    runRaces: (bound, driver) => runTestOwnerUnpublicationNativeRaces(manifest, bound, driver),
  })
  const { manifest: sealed, setup, verifyTarget, diagnostic, run, probeSnapshotPrivilegeDrift } = engine
  return Object.freeze({ manifest: sealed, setup, verifyTarget, diagnostic, run, probeOwnerUnpublicationPrivilegeDrift: probeSnapshotPrivilegeDrift })
}

/** Fixed262 deletion profile preserves the same closed executor and controls. */
export function buildTestOwnerDeletionNativeContractsManifest(original: AssignmentListProofFixture, reviewedHead: string, repository: string) {
  const plan = testOwnerDeletionNativePlan(original, reviewedHead, repository)
  return freeze({ ...plan, bootstrap: boot, termination: draftSaveNativeTerminationSql(), close: 'rollback;',
    capabilities: CAPS, framing: 'psql-echo-monotonic-v1', contextTemplate, privilege: snapshotPrivilegeSql('owner-deletion') })
}
export function createTestOwnerDeletionNativeContracts(input: NativeOwnerInput & { absoluteDeadline: number }) {
  const now = Date.now(); assert(Number.isSafeInteger(input.absoluteDeadline) && input.absoluteDeadline > now && input.absoluteDeadline <= now + CAPS.totalMs)
  const manifest = buildTestOwnerDeletionNativeContractsManifest(input.original, input.reviewedHead, input.repository)
  const engine = createNativeOwnerContracts(input, { manifest, project: manifest.projectId,
    sourceFile: '262_contextual_test_owner_delete.sql', label: 'test-owner-deletion', absoluteDeadline: input.absoluteDeadline,
    singleMs: 12000, committedOuterPrivilege: true,
    validateSql: sql => [manifest.bootstrap, manifest.close, manifest.privilege.catalog, manifest.privilege.revoke].includes(sql)
      || validateTestOwnerDeletionNativePlanSql(manifest, sql),
    contractsSha256: testOwnerDigest(JSON.stringify(manifest.contracts)), racesSha256: testOwnerDigest(JSON.stringify(manifest.concurrency)),
    runContracts: (bound, driver) => runTestOwnerDeletionNativeContracts(manifest, bound, driver),
    runRaces: (bound, driver) => runTestOwnerDeletionNativeRaces(manifest, bound, driver),
  })
  const { manifest: sealed, setup, verifyTarget, diagnostic, run, probeSnapshotPrivilegeDrift } = engine
  return Object.freeze({ manifest: sealed, setup, verifyTarget, diagnostic, run, probeOwnerDeletionPrivilegeDrift: probeSnapshotPrivilegeDrift })
}

export function buildTestLearnerNativeContractsManifest(original: AssignmentListProofFixture,
  observedAttempts: readonly TestLearnerObservedAttempt[], reviewedHead: string, repository: string) {
  const plan = testLearnerNativePlan(original, observedAttempts, reviewedHead, repository)
  return freeze({ ...plan, bootstrap: boot, termination: draftSaveNativeTerminationSql(), close: 'rollback;',
    capabilities: CAPS, framing: 'psql-echo-monotonic-v1', contextTemplate, privilege: snapshotPrivilegeSql('learner') })
}
export type TestLearnerNativeCancellationRequest = Readonly<{ p_actor_id: string; p_test_id: string; p_classroom_id: string;
  p_operation: 'save'; p_payload: TestLearnerNativePlan['cancellation']['payload']; p_deadline: string }>
/** elapsedMs measures dispatch through complete response-body validation, excluding guards. */
export type TestLearnerNativeCancellationReceipt = Readonly<{ status: 500; rpcCalls: 1; rawCode: '57014'; elapsedMs: number }>

/** One fixed learner factory. The executor/profile selector stays private. */
export function createTestLearnerNativeContracts(input: NativeOwnerInput & {
  observedAttempts: readonly TestLearnerObservedAttempt[]; absoluteDeadline: number;
}) {
  const now = Date.now()
  assert(Number.isSafeInteger(input.absoluteDeadline) && input.absoluteDeadline > now && input.absoluteDeadline <= now + CAPS.totalMs)
  const manifest = buildTestLearnerNativeContractsManifest(input.original, input.observedAttempts, input.reviewedHead, input.repository)
  const engine = createNativeOwnerContracts(input, { manifest, project: manifest.projectId,
    sourceFile: '257_contextual_test_learner_workflow.sql', label: 'test-learner', absoluteDeadline: input.absoluteDeadline,
    singleMs: 12000, committedOuterPrivilege: true, learnerCancellation: manifest.cancellation,
    validateSql: sql => [manifest.bootstrap, manifest.close, manifest.privilege.catalog, manifest.privilege.revoke].includes(sql)
      || validateTestLearnerNativePlanSql(manifest, sql),
    contractsSha256: testOwnerDigest(JSON.stringify(manifest.contracts)), racesSha256: testOwnerDigest(JSON.stringify(manifest.concurrency)),
    runContracts: (bound, driver) => runTestLearnerNativeContracts(manifest, bound, driver),
    runRaces: (bound, driver) => runTestLearnerNativeRaces(manifest, bound, driver),
  })
  const { probeSnapshotPrivilegeDrift: probe, probeLearnerCancellation, manifest: sealed, setup, verifyTarget, diagnostic, run } = engine
  assert(probeLearnerCancellation)
  return Object.freeze({ manifest: sealed, setup, verifyTarget, diagnostic, run, probeLearnerPrivilegeDrift: probe,
    probeLearnerCancellation })
}

/** The only exported factories select source-owned closed profiles. Never accept
 * caller-supplied SQL callbacks, migration paths or resource protocols. The
 * default249 manifest, runner and privilege API retain their existing meaning. */
export function createDraftSaveNativeContracts(input: NativeOwnerInput) {
  const manifest = buildDraftSaveNativeContractsManifest(input.original, input.reviewedHead, input.repository)
  const engine = createNativeOwnerContracts(input, {
    manifest, project: manifest.fixture.projectId, sourceFile: '249_contextual_test_draft_owner_save.sql', label: 'test-owner-draft-save',
    validateSql: sql => validateDraftSaveNativeSql(manifest, sql),
    contractsSha256: testOwnerDigest(JSON.stringify(manifest.contracts)),
    racesSha256: testOwnerDigest(JSON.stringify(manifest.concurrency)),
    runContracts: (bound, d) => runDraftSaveContracts(manifest.fixture, bound, input.repository, d),
    runRaces: (bound, d) => runDraftSaveConcurrency(manifest.fixture, bound, input.repository, d),
  })
  const { probeInnerPrivilegeDrift: internalOnly, probeFixedPrivilegeDrift: publicationOnly, runCommittedTransitions: committedOnly, ...facade } = engine
  void internalOnly; void publicationOnly; void committedOnly
  return Object.freeze(facade)
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
  const { probeSnapshotPrivilegeDrift: probe, probeInnerPrivilegeDrift: internalOnly, probeFixedPrivilegeDrift: publicationOnly, runCommittedTransitions: committedOnly, ...facade } = engine
  void internalOnly; void publicationOnly; void committedOnly
  return Object.freeze({ ...facade, async probeCreatePrivilegeDrift(callback: Parameters<typeof probe>[0]) {
    const receipt = await probe(callback)
    return Object.freeze({ privilegeRestored: receipt.privilegeRestored, fixtureUnchanged: receipt.fixtureUnchanged, createAclSha256: receipt.snapshotAclSha256 })
  } })
}

export function createTestOwnerPristineDiscardNativeContracts(input: NativeOwnerInput & { fixture: TestOwnerPristineDiscardFixture }) {
  const manifest = buildTestOwnerPristineDiscardNativeContractsManifest(input.original, input.fixture, input.reviewedHead, input.repository)
  const engine = createNativeOwnerContracts(input, {
    manifest, project: `pika_assignment_list_${manifest.fixture.tag.slice(-12)}`,
    sourceFile: '251_contextual_test_pristine_owner_discard.sql', label: 'test-owner-pristine-discard', innerPrivilege: manifest.innerPrivilege,
    validateSql: sql => validateTestOwnerPristineDiscardNativeSql(manifest, sql),
    contractsSha256: testOwnerDigest(JSON.stringify(manifest.contracts)), racesSha256: testOwnerDigest(JSON.stringify(manifest.concurrency)),
    runContracts: (bound, d) => runTestOwnerPristineDiscardContracts(manifest, bound, d),
    runRaces: (bound, d) => runTestOwnerPristineDiscardConcurrency(manifest.fixture, bound, input.repository, d),
  })
  const { probeSnapshotPrivilegeDrift: outer, probeInnerPrivilegeDrift: inner, probeFixedPrivilegeDrift: publicationOnly, runCommittedTransitions: committedOnly, ...facade } = engine
  void publicationOnly; void committedOnly
  return Object.freeze({ ...facade,
    async probeDiscardPrivilegeDrift(callback: Parameters<typeof outer>[0]) {
      const r = await outer(callback)
      return Object.freeze({ privilegeRestored: r.privilegeRestored, fixtureUnchanged: r.fixtureUnchanged, discardAclSha256: r.snapshotAclSha256 })
    },
    async probeLegacyDiscardPrivilegeDrift(callback: Parameters<typeof inner>[0]) {
      const r = await inner(callback)
      return Object.freeze({ privilegeRestored: r.privilegeRestored, fixtureUnchanged: r.fixtureUnchanged, legacyDiscardAclSha256: r.snapshotAclSha256 })
    } })
}

/** Four explicit capabilities and one committed-transition operation. This
 * facade never exports a profile selector, SQL callback or expected-state setter. */
export function createTestOwnerPublicationNativeContracts(input: NativeOwnerInput & { fixture: TestOwnerPublicationFixture; absoluteDeadline: number }) {
  assert(Number.isFinite(input.absoluteDeadline) && input.absoluteDeadline > Date.now() && input.absoluteDeadline <= Date.now() + CAPS.totalMs)
  const manifest = buildTestOwnerPublicationNativeContractsManifest(input.original, input.fixture, input.reviewedHead, input.repository)
  const engine = createNativeOwnerContracts(input, {
    manifest, project: `pika_assignment_list_${manifest.fixture.tag.slice(-12)}`,
    sourceFile: '252_contextual_test_owner_publication.sql', label: 'test-owner-publication',
    publicationPrivileges: manifest.publicationPrivileges, absoluteDeadline: input.absoluteDeadline, singleMs: 12000,
    validateSql: sql => validateTestOwnerPublicationNativeSql(manifest, sql),
    contractsSha256: testOwnerDigest(JSON.stringify(manifest.contracts)), racesSha256: testOwnerDigest(JSON.stringify(manifest.concurrency)),
    committedSha256: testOwnerDigest(JSON.stringify(manifest.committed)),
    runContracts: (bound, d) => runTestOwnerPublicationDbContracts(manifest.contracts, bound, d),
    runRaces: (bound, d) => runTestOwnerPublicationConcurrency(manifest.fixture, bound, input.repository, d),
    runCommitted: (bound, d) => runTestOwnerPublicationCommittedTransitions(manifest.fixture, bound, input.repository, d),
  })
  const { probeSnapshotPrivilegeDrift: oldSnapshot, probeInnerPrivilegeDrift: oldInner, probeFixedPrivilegeDrift: probe, ...facade } = engine
  void oldSnapshot; void oldInner
  return Object.freeze({ ...facade,
    probePublicationSnapshotPrivilegeDrift: (callback: () => Promise<{ status: 503; rpcCalls: 1; rawCode: '42501' }>) => probe('snapshot247', callback),
    probePublicationPrivilegeDrift: (callback: () => Promise<{ status: 503; rpcCalls: 2; rawCode: '42501' }>) => probe('publication252', callback),
    probeLegacyPublicationPrivilegeDrift: (callback: () => Promise<{ status: 503; rpcCalls: 2; rawCode: '42501' }>) => probe('legacy139', callback),
    probeActivationPrivilegeDrift: (callback: () => Promise<{ status: 503; rpcCalls: 2; rawCode: '42501' }>) => probe('activation134', callback),
  })
}

/** One fixed service privilege and one source-sealed committed operation. */
export function createTestOwnerReorderNativeContracts(input: NativeOwnerInput & { fixture: TestOwnerReorderFixture; absoluteDeadline: number }) {
  const now = Date.now(); const absoluteDeadline = input.absoluteDeadline
  assert(Number.isSafeInteger(absoluteDeadline) && absoluteDeadline > now && absoluteDeadline <= now + CAPS.totalMs)
  const manifest = buildTestOwnerReorderNativeContractsManifest(input.original, input.fixture, input.reviewedHead, input.repository)
  const engine = createNativeOwnerContracts(input, {
    manifest, project: `pika_assignment_list_${manifest.fixture.tag.slice(-12)}`,
    sourceFile: '254_contextual_test_owner_reorder.sql', label: 'test-owner-reorder',
    absoluteDeadline, singleMs: 35000, committedOuterPrivilege: true,
    reorderProgressSql: Object.freeze({ bulk: manifest.contracts.contracts.find(batch => batch.name === 'bulk-1000')!.sql,
      calibration: manifest.contracts.contracts.find(batch => batch.expectedResult.checks.includes('deadline-reached'))!.sql }),
    validateSql: sql => validateTestOwnerReorderNativeSql(manifest, sql),
    contractsSha256: testOwnerDigest(JSON.stringify(manifest.contracts)), racesSha256: testOwnerDigest(JSON.stringify(manifest.concurrency)),
    committedSha256: testOwnerDigest(JSON.stringify(manifest.committed)),
    runContracts: (bound, d) => runTestOwnerReorderDbContracts(manifest.contracts, bound, d, absoluteDeadline),
    runRaces: (bound, d) => runTestOwnerReorderConcurrency(manifest.concurrency, bound, d),
    runCommitted: (bound, d) => runTestOwnerReorderCommittedTransitions(manifest.committed, bound, d, absoluteDeadline),
  })
  const { probeSnapshotPrivilegeDrift: probe, probeInnerPrivilegeDrift: innerOnly, probeFixedPrivilegeDrift: fixedOnly, ...facade } = engine
  void innerOnly; void fixedOnly
  return Object.freeze({ ...facade, probeReorderPrivilegeDrift: probe })
}

/** Separate finite diagnostics. No ordinary proof/race/privilege entrypoints. */
export function buildTestOwnerReorderDiagnosticNativeManifest(original: AssignmentListProofFixture,
  fixture: TestOwnerReorderFixture, reviewedHead: string, repository: string) {
  assertTestOwnerReorderDiagnosticAvailable()
  const normal = buildTestOwnerReorderNativeContractsManifest(original, fixture, reviewedHead, repository)
  const { contracts: ordinary, concurrency: unusedRaces, committed: unusedCommitted, ...binding } = normal
  void unusedRaces; void unusedCommitted
  return freeze({ ...binding, kind: 'test-owner-reorder-diagnostic-not-acceptance' as const, diagnosticOnly: true as const,
    contracts: buildTestOwnerReorderDiagnosticManifest(ordinary, repository), concurrency: { diagnosticOnly: true as const } })
}
export function createTestOwnerReorderDiagnosticNativeContracts(input: NativeOwnerInput & { fixture: TestOwnerReorderFixture; absoluteDeadline: number }) {
  assertTestOwnerReorderDiagnosticAvailable()
  const now = Date.now()
  assert(Number.isSafeInteger(input.absoluteDeadline) && input.absoluteDeadline > now && input.absoluteDeadline <= now + CAPS.totalMs)
  const manifest = buildTestOwnerReorderDiagnosticNativeManifest(input.original, input.fixture, input.reviewedHead, input.repository)
  const engine = createNativeOwnerContracts(input, { manifest, project: manifest.contracts.projectId,
    sourceFile: '254_contextual_test_owner_reorder.sql', label: 'test-owner-reorder-diagnostic', absoluteDeadline: input.absoluteDeadline, singleMs: 35000,
    reorderDiagnosticSql: manifest.contracts.frames[1].sql,
    validateSql: sql => [manifest.setup, manifest.snapshot, manifest.bootstrap, manifest.close].includes(sql)
      || validateTestOwnerReorderDiagnosticSql(manifest.contracts, sql),
    contractsSha256: manifest.contracts.manifestSha256, racesSha256: testOwnerDigest(JSON.stringify(manifest.concurrency)),
    runContracts: (bound, d) => runTestOwnerReorderDiagnostic(manifest.contracts, bound, d, input.absoluteDeadline),
    runRaces: async () => { throw failure() },
  })
  const { manifest: boundManifest, setup, verifyTarget, diagnostic, runDiagnostic } = engine
  assert(runDiagnostic)
  return Object.freeze({ manifest: boundManifest, setup, verifyTarget, diagnostic, runDiagnostic })
}

function createNativeOwnerContracts<M extends NativeManifestShape, C, R,
  T = Awaited<ReturnType<typeof runTestOwnerPublicationCommittedTransitions>>>(input: NativeOwnerInput, profile: NativeOwnerProfile<M, C, R, T>) {
  input = Object.freeze({ ...input })
  profile = Object.freeze({ ...profile })
  assert(input.restorationAdmission === undefined || typeof input.restorationAdmission === 'function')
  const restorationAdmission = input.restorationAdmission
  const manifest = profile.manifest
  assert.equal(input.acceptedManifestSha256, testOwnerDigest(JSON.stringify(manifest)))
  assert.match(input.containerId, /^[a-f0-9]{64}$/)
  assert(isAbsolute(input.repository) && realpathSync(input.repository) === input.repository)
  const project = profile.project
  const closure = structuredClone(input.capturedResources)
  const start = profile.survey263Budget?.startedAt ?? Date.now(); let controls = 0; let actions = 0; let exchanged = 0; let failed = false; let setupDone = false; let ran = false; let runDone = false; let probing = false; let committedRan = false
  const component = profile.survey269Component !== undefined
  const remaining=profile.survey269Remaining
  if (profile.surveyCommitted) assert.equal(profile.surveyCommitted.waitObservation, remaining ? 'database750-original8000' : undefined)
  const exchangeLimit=remaining?128*1024*1024:CAPS.totalBytes
  const controlLimit=remaining?6000:CAPS.controlCalls
  const cleanupControls=remaining?SURVEY269_REMAINING_CLEANUP_CONTROLS:32
  let surveySdkWorkDeadline: number | undefined
  let surveySdkWorkStartedAt: number | undefined
  let surveySdkDiagnostic: (() => string) | undefined
  let surveySdkGuardUnjoined = false
  function chargeComponent(bytes: number, cleanup = false) {
    try {exchanged = chargeSurvey269ComponentExchange(profile.survey269Exchange!, bytes, cleanup)}
    catch {record('budget');failed = true;throw failure()}
  }
  const probed = new Set<'outer' | 'inner' | PublicationPrivilegeKind>()
  const completedProbes = new Set<'outer' | 'inner' | PublicationPrivilegeKind>()
  // The rollback and committed publication schedules share one race clock.
  // Entering the second runner must not renew its 180-second phase budget.
  let publicationRaceDeadline: number | undefined
  const sessions = new Set<NativeSession>()
  let learnerCancellationDone = false
  let surveySdkRan = false, surveySdkDone = false, surveyTypesGenerated = false, surveyUnjoined = false
  let surveyCommittedStarted = false, surveyCommittedDone = false
  let remainingRollbackActive = false
  let remainingProbeOwned=false,remainingHttpPending=false,remainingProbeStage:'none'|'cancellation'|'wire'|'complete'='none'
  let remainingCancellationDone=false,remainingWireDone=false
  type SurveyGraph = ReturnType<typeof parseSurveyCommittedGraph>
  type SurveyFrame = 'seed' | 'bootstrap' | 'observer' | 'holder' | 'contender' | 'release' | 'settle' | 'retry' | 'terminal'|'cancel-prepare'|'cancel-observer'|'wire-prepare'
  // Neither these carriers nor the baseline marker escape this engine instance.
  type SurveyCarrier = { session: NativeSession; label: string; side: 'holder' | 'contender'; frame: SurveyFrame; sql: string;
    originalContender?: SurveyCarrier;
    operationSha256?: string; backend?: Readonly<Backend>; marker?: string; dispatchedAt?: number; completedAt?: number;
    rows?: readonly { result?: unknown }[]; dispatched: Promise<void>; didDispatch(): void; rejectDispatch(error: unknown): void;
    completion: Promise<readonly { result?: unknown }[]> }
  let surveyPair: SurveyCommittedBootstrap | undefined
  let surveyBaseline: { seed: SurveyCarrier; graph: SurveyGraph } | undefined
  let surveyCommittedFailure: Readonly<{ direction: number; frame: 'observer' | 'contender' | 'release';
    predicate: NonNullable<ReturnType<typeof surveyCommittedWitnessFailure>> | 'witness' | 'original-expiry'; observationMs: number | 'unknown' }> | undefined
  const surveyCarriers = new WeakSet<SurveyCarrier>()
  function validateSurveyCarrier(c: SurveyCarrier) {
    const m = profile.surveyCommitted
    assert(m && surveyCarriers.has(c) && sessions.has(c.session))
    assert(c.session.name === `${project}_draft_${c.side}`)
    if(c.frame==='cancel-prepare'||c.frame==='cancel-observer'||c.frame==='wire-prepare'){
      assert(remaining&&c.side==='holder'&&remainingProbeOwned)
      if(c.frame==='wire-prepare')assert(validateSurveyWireSql(remaining.wire,'prepare',c.sql))
      else assert(validateSurveyCancellationSql(remaining.cancellation,c.frame==='cancel-prepare'?'prepare':'observer',c.sql))
      if(c.frame==='cancel-observer')assert(remainingHttpPending,'Original cancellation HTTP is no longer pending')
    }
    else if (c.frame === 'seed') assert(c.side === 'holder' && c.sql === m.seed)
    else if (c.frame === 'bootstrap') assert(c.sql === m.bootstrap[c.side])
    else if (c.frame === 'observer') {
      assert(surveyPair && c.side === 'holder')
      assert(validateSurveyCommittedObservationSql(m, c.label, surveyPair, c.sql))
      assert(m.schedules.find(s => s.label === c.label)?.mode === 'wait')
    } else {
      assert(validateSurveyCommittedSql(m, c.label, c.side, c.frame, c.sql))
      const s = m.schedules.find(s => s.label === c.label)!
      if (c.frame === 'holder') assert.equal(c.operationSha256, s.firstOperationSha256)
      if (c.frame === 'contender' || c.frame === 'retry') assert.equal(c.operationSha256, s.secondOperationSha256)
    }
    assert(Buffer.byteLength(c.sql) <= m.caps.sqlBytes)
    if((c.frame==='release'||remaining&&c.frame==='observer')&&m.schedules.find(s=>s.label===c.label)?.mode==='wait'){
      const original=c.originalContender
      assert(original&&surveyCarriers.has(original)&&original.frame==='contender'&&original.side==='contender'&&original.label===c.label)
      assert(original.backend&&original.marker&&original.dispatchedAt!==undefined&&original.completedAt===undefined)
      assert(surveyPair&&original.session.surveyOwned().pid===surveyPair.contender.pid)
    }else assert(c.originalContender===undefined)
  }
  function surveyWaitDeadline(c?:SurveyCarrier, receipt = false){
    const original=c?.originalContender ?? (remaining&&c?.frame==='contender'&&profile.surveyCommitted!.schedules.find(s=>s.label===c.label)?.mode==='wait'?c:undefined)
    if(!c||original?.dispatchedAt===undefined)return undefined
    if(!receipt)validateSurveyCarrier(c)
    const deadline=Math.min(original.dispatchedAt+profile.surveyCommitted!.caps.waitContenderMs,profile.survey263Budget!.workDeadline)
    if(Date.now()>=deadline){
      if(remaining&&!firstFault&&!surveyCommittedFailure){
        const s=profile.surveyCommitted!.schedules.find(s=>s.label===c.label)!
        surveyCommittedFailure=Object.freeze({direction:s.index*2+(s.direction==='forward'?1:2),frame:c.frame==='observer'?'observer':c.frame==='release'?'release':'contender',predicate:'original-expiry',observationMs:'unknown'})
      }
      record('timeout',role(c.session.name));throw failure()
    }
    return deadline
  }
  function surveyResult(c: SurveyCarrier) {
    assert(surveyCarriers.has(c) && c.backend && c.marker && c.dispatchedAt !== undefined && c.completedAt !== undefined)
    assert(c.rows?.length === 1)
    const value = c.rows[0].result
    assert(value && typeof value === 'object' && !Array.isArray(value))
    return value as Record<string, unknown>
  }
  type CancellationStage = 'none' | 'snapshot' | 'catalog' | 'install' | 'installed' | 'guard' | 'probe' | 'receipt' | 'timing' | 'restore' | 'restored-catalog' | 'restored-fixture' | 'complete'
  let cancellationStage: CancellationStage = 'none'
  let cancellationFirstFailure: CancellationStage | undefined
  let cancellationRestoreFailure: CancellationStage | undefined
  let phase: Phase = 'idle'
  let bulkProgress: TestOwnerReorderProgressCheckpoint = 'none'; let progressCalibrated = false
  let diagnosticTimings: TestOwnerReorderTimings = captureTestOwnerReorderTimings(false).snapshot()
  let firstFault: Readonly<{ phase: Phase; failure: Fault; role: Role; sqlstate: string; controls: number; actions: number; sessions: number;
    progress: TestOwnerReorderProgressCheckpoint; calibration: 'verified' | 'unverified'; checkpoint: GuardCheckpoint; sdkElapsedMs: number | 'none'; sdkRemainingMs: number | 'none' }> | undefined
  let surveyProgress = captureSurveyProgress(false).snapshot()
  function role(name: string): Role {
    if (name === `${project}_fixture`) return 'fixture'
    if (name === `${project}_draft_contracts`) return 'contracts'
    if (name === `${project}_draft_holder`) return 'holder'
    if (name === `${project}_draft_contender`) return 'contender'
    return 'none'
  }
  function record(kind: Fault, ownedRole: Role = 'none', sqlstate = 'unknown', checkpoint: GuardCheckpoint = 'none') {
    if (firstFault) return
    for (const session of sessions) if (session.surveyProgressObservation().enabled) surveyProgress = session.freezeSurveyProgress()
    if (profile.reorderDiagnosticSql) diagnosticTimings = [...sessions].find(session => session.diagnosticObservation().enabled)?.diagnosticObservation().snapshot ?? diagnosticTimings
    const observations = [...sessions].map(session => session.progressObservation())
    const activeBulk = observations.find(value => value.scope === 'bulk')
    const activeCalibration = observations.find(value => value.scope === 'calibration')
    firstFault ??= Object.freeze({ phase, failure: kind, role: ownedRole, sqlstate: sqlstates.has(sqlstate) || remaining && surveyCommittedFailure?.predicate==='db-observation-window' && sqlstate==='P7501' ? sqlstate : 'unknown', checkpoint,
      sdkElapsedMs: surveySdkWorkStartedAt === undefined ? 'none' : Math.min(CAPS.totalMs, Math.max(0, Date.now() - surveySdkWorkStartedAt)),
      sdkRemainingMs: surveySdkWorkDeadline === undefined ? 'none' : Math.min(SURVEY_269_COMPONENT_SDK_CAPS.totalMs, Math.max(0, surveySdkWorkDeadline - Date.now())),
      progress: activeBulk?.snapshot.checkpoint ?? bulkProgress,
      calibration: progressCalibrated || activeCalibration?.snapshot.calibrated ? 'verified' : 'unverified',
      controls: Math.min(controls, controlLimit + 1), actions: Math.min(actions, CAPS.actions + 1), sessions: Math.min(sessions.size, CAPS.sessions + 1) })
  }
  function checkSurveySdkAdmission(cleanup = false) {
    if (component && !cleanup && surveySdkWorkDeadline !== undefined && Date.now() >= surveySdkWorkDeadline) {
      record('guard', 'none', 'unknown', 'sdk-deadline'); throw new SurveySdkDeadlineError()
    }
  }
  let endpoint: { host: string; identity: number[] } | undefined
  function checkJoined() { if (surveyUnjoined) throw new Survey263UnjoinedChildError() }
  function checkSettlement() {
    checkJoined()
    if (profile.survey263Budget) assert(Date.now() < profile.survey263Budget.cleanupDeadline)
  }
  function check(observe = true) {
    checkJoined()
    const raceExpired = publicationRaceDeadline !== undefined
      && ['races', 'races-verify', 'transitions'].includes(phase) && Date.now() >= publicationRaceDeadline
    if (observe && !failed && (Date.now() - start >= CAPS.totalMs
      || (profile.absoluteDeadline !== undefined && Date.now() >= profile.absoluteDeadline) || raceExpired)) record('timeout')
    if (observe && controls > controlLimit - cleanupControls) record('budget')
    assert(!failed && Date.now() - start < CAPS.totalMs && controls <= controlLimit - cleanupControls)
    if (profile.absoluteDeadline !== undefined) assert(Date.now() < profile.absoluteDeadline)
    assert(!raceExpired, 'Publication race deadline exhausted')
  }
  function dockerArgs(name: string, variables: string[] = []) {
    assert([`${project}_fixture`, `${project}_draft_contracts`, `${project}_draft_holder`, `${project}_draft_contender`].includes(name))
    assert(endpoint)
    return ['--host', endpoint.host, 'exec', '-i', '-e', `PGAPPNAME=${name}`, input.containerId, 'psql', '-U', 'postgres', '-d', 'postgres',
      '-XqAt', '-P', 'pager=off', '-v', 'ON_ERROR_STOP=1', '-v', profile.reorderDiagnosticSql && role(name) === 'contracts' ? 'VERBOSITY=terse' : 'VERBOSITY=sqlstate', ...variables]
  }
  function command(file: 'git' | 'docker' | 'supabase', args: string[], sql?: string, timeout: number = CAPS.controlMs, diagnosticRole?: Role, cleanup = false, gitFrame = false): Promise<string> {
    assert(!gitFrame || (component && file === 'git' && sql === undefined))
    checkJoined()
    checkSurveySdkAdmission(cleanup)
    assert(++controls <= controlLimit)
    if (file === 'supabase') assert((profile.label === 'survey263' || component) && endpoint)
    if (component && sql !== undefined) chargeComponent(Buffer.byteLength(sql), cleanup)
    if (profile.reorderDiagnosticSql && sql !== undefined) { exchanged += Buffer.byteLength(sql); assert(exchanged <= exchangeLimit) }
    const executable = file === 'supabase' ? verifySurvey263NativeCli(profile.survey263NativeCli!).path : file
    if (profile.survey263Budget) {
      timeout = Math.min(timeout, (cleanup ? profile.survey263Budget.cleanupDeadline : profile.survey263Budget.workDeadline) - Date.now())
      assert(timeout > 0)
    }
    if (component) chargeSurvey269ComponentControl(profile.survey269Exchange!, cleanup)
    return new Promise((resolveClosed, rejectClosed) => {
      let joined = !profile.survey263Budget, outcome: { value?: string; error?: unknown } | undefined
      const settle = () => { if (joined && outcome) { if ('error' in outcome) rejectClosed(outcome.error); else resolveClosed(outcome.value!) } }
      const resolveResult = (value: string) => { outcome = { value }; settle() }
      const reject = (error: unknown) => { outcome = { error }; settle() }
      let inputFailed = false
      const child = execFile(executable, args, { cwd: input.repository, encoding: 'utf8', timeout, killSignal: 'SIGKILL', maxBuffer: CAPS.outputBytes,
        ...(file === 'supabase' ? { env: { ...process.env, DOCKER_HOST: endpoint!.host } } : {}) }, (error, stdout, stderr) => {
        if (component) {
          try {assert(typeof stdout === 'string' && typeof stderr === 'string');chargeComponent(Buffer.byteLength(stdout) + Buffer.byteLength(stderr), cleanup);assert(Buffer.byteLength(stderr) <= CAPS.stderrBytes)}
          catch {reject(failure());return}
        }
        if (profile.reorderDiagnosticSql && typeof stderr === 'string') {
          exchanged += Buffer.byteLength(stderr)
          if (Buffer.byteLength(stderr) > CAPS.stderrBytes || exchanged > exchangeLimit) { reject(failure()); return }
        }
        if (error || inputFailed || Buffer.byteLength(stdout) > CAPS.outputBytes) {
          if (diagnosticRole !== undefined) {
            const state = captureSqlstate()
            if (typeof stderr === 'string' && Buffer.byteLength(stderr) <= CAPS.stderrBytes) state.push(stderr)
            record('guard', diagnosticRole, state.code(), component && sql === manifest.guard ? 'sql-ownership' : 'none')
          }
          reject(failure())
        }
        else { if (!component) exchanged += Buffer.byteLength(stdout); exchanged > exchangeLimit && !(component && cleanup) ? reject(failure()) : resolveResult(gitFrame ? stdout : stdout.trim()) }
      })
      if (profile.survey263Budget) {
        const closeDeadline = Math.min(profile.survey263Budget.cleanupDeadline, Date.now() + timeout + CAPS.closeMs)
        const timer = setTimeout(() => {
          failed = true; surveyUnjoined = true
          try { child.kill('SIGKILL') } catch { /* Signal delivery is not positive child closure. */ }
          rejectClosed(new Survey263UnjoinedChildError())
        }, closeDeadline - Date.now())
        child.once('close', () => { clearTimeout(timer); joined = true
          if (Date.now() >= closeDeadline || !outcome) { failed = true; surveyUnjoined = true; rejectClosed(new Survey263UnjoinedChildError()) }
          else settle()
        })
      }
      child.stdin?.on('error', () => { inputFailed = true; child.kill('SIGKILL') })
      child.stdin?.end(sql)
    })
  }
  async function verifyEndpoint(cleanup = false) {
    checkJoined()
    assert(!Object.keys(process.env).some(name => /^(?:DOCKER_(?:HOST|CONTEXT|CONFIG|API_VERSION|TLS.*|CERT_PATH|CUSTOM_HEADERS)|(?:.*_)?PROXY)$/i.test(name)))
    const raw = JSON.parse(await command('docker', ['context', 'inspect', '--format', manifest.contextTemplate], undefined, CAPS.controlMs, undefined, cleanup)) as {
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
    if (profile.survey263Endpoint) assert.deepEqual(observed, profile.survey263Endpoint)
    if (endpoint) assert.deepEqual(observed, endpoint); else endpoint = observed
  }
  async function inventory(cleanup = false, observe = !cleanup, ownedRole: Role = 'none') {
    if (!cleanup) check(observe); else checkSettlement()
    // These fresh read-only children are independent. Settle all of them even
    // on rejection before resource discovery, SQL, or session work can begin.
    const step = async <T>(checkpoint: GuardCheckpoint, run: () => Promise<T>) => { try { return await run() } catch (error) {
      if (component && observe) record('guard', ownedRole, 'unknown', error instanceof SurveySdkDeadlineError ? 'sdk-deadline' : checkpoint)
      throw error
    } }
    const checks = await Promise.allSettled([
      ...(component ? [step('source-git', async () => {
        assert.equal(await command('git', ['rev-parse', 'HEAD', '--show-toplevel'], undefined, CAPS.controlMs, undefined, cleanup, true), `${input.reviewedHead}\n${input.repository}\n`)
      })] : [
        step('source-git', async () => { assert.equal(await command('git', ['rev-parse', 'HEAD'], undefined, CAPS.controlMs, undefined, cleanup), input.reviewedHead) }),
        step('source-git', async () => { assert.equal(await command('git', ['rev-parse', '--show-toplevel'], undefined, CAPS.controlMs, undefined, cleanup), input.repository) }),
      ]),
      step('source-git', async () => { assert.equal(await command('git', ['status', '--porcelain'], undefined, CAPS.controlMs, undefined, cleanup), '') }),
      step('endpoint', () => verifyEndpoint(cleanup)),
    ])
    checkJoined()
    for (const result of checks) if (result.status === 'rejected') throw result.reason
    if (profile.survey269Component) {
      const binding = profile.survey269Component
      for (const [key, repository] of Object.entries(SURVEY_269_COMPONENT_ROOTS)) {
        const source = binding[key as 'product' | 'carrier']
        const wave = await Promise.allSettled([
          step('source-git', async () => {
            assert.equal(await command('git', ['-C', repository, 'rev-parse', 'HEAD', 'HEAD^{tree}'], undefined, CAPS.controlMs, undefined, cleanup, true), `${source.head}\n${source.tree}\n`)
          }),
          step('source-git', async () => { assert.equal(await command('git', ['-C', repository, 'status', '--porcelain', '--untracked-files=all'], undefined, CAPS.controlMs, undefined, cleanup), '') }),
        ])
        checkJoined(); for (const result of wave) if (result.status === 'rejected') throw result.reason
      }
    }
    await step('source-files', async () => {
      checkSurveySdkAdmission(cleanup)
      if (profile.survey269Component) verifySurvey269ComponentSources(profile.survey269Component)
      assert.equal(draftSaveMigrationManifestSha256(input.repository), manifest.migrationManifestSha256)
      assert.equal(testOwnerDigest(readFileSync(resolve(input.repository, 'supabase/migrations', profile.sourceFile), 'utf8')), manifest.sourceSha256)
      if (profile.surveyCommitted) verifySurveyRemainingSources(component?SURVEY_269_COMPONENT_ROOTS.carrier:input.repository)
      checkSurveySdkAdmission(cleanup)
    })
    await step('resources', async () => { const all = await dockerInventory(cleanup, observe); validateIntegratedGuardResources(all, project, input.containerId, closure as AssignmentListResource[]) })
    await step('endpoint', () => verifyEndpoint(cleanup))
    if (!cleanup) check(observe)
  }
  async function dockerInventory(cleanup = false, observe = !cleanup) {
    // Recheck after preceding async Git/context children, before constructing a
    // fresh inventory or queued reader. Only already-owned settlement borrows
    // the original reserve during work; cleanup discovery uses the total clock.
    if (profile.survey263Budget) { if (!cleanup) check(observe); else checkSettlement() }
    try {
      if (component) {
        assert(endpoint)
        return await (remaining?survey269RemainingDockerInventory:survey269ComponentDockerInventory)(async(file, args) => {
          assert.equal(file, 'docker')
          const output=await command('docker', ['--host', endpoint!.host, ...args], undefined, CAPS.controlMs, undefined, cleanup)
          return output
        })
      }
      return await draftSaveProofDockerInventory({}, profile.survey263Endpoint ? endpoint : undefined,
        profile.survey263Budget ? {
          dispatchDeadline: cleanup ? profile.survey263Budget.cleanupDeadline : profile.survey263Budget.workDeadline,
          settlementDeadline: profile.survey263Budget.cleanupDeadline,
        } : undefined)
    } catch (error) {
      if (error instanceof SurveyInventoryUnjoinedChildError) { failed = true; surveyUnjoined = true }
      checkJoined(); throw error
    }
  }
  async function guard(cleanup = false, ownedRole: Role = 'none', observe = !cleanup) {
    try {
    await inventory(cleanup, observe, ownedRole)
    assert.equal(await command('docker', dockerArgs(`${project}_fixture`), manifest.guard, CAPS.controlMs, observe ? ownedRole : undefined, cleanup), 'ok')
    if (!cleanup) check(observe)
    } catch (error) { if (observe) record('guard', ownedRole, 'unknown', error instanceof SurveySdkDeadlineError ? 'sdk-deadline' : 'sql-ownership'); throw error }
  }
  // On any failed dispatch, all exact owned backends are terminated and both
  // local docker children are reaped. A failed remote confirmation fails closed.
  async function terminate(owned: Backend) {
    await guard(true)
    const variables = ['-v', `owned_pid=${owned.pid}`, '-v', `owned_started=${owned.started}`, '-v', `owned_name=${owned.name}`]
    const text = await command('docker', dockerArgs(`${project}_fixture`, variables), manifest.termination, CAPS.closeMs, undefined, true)
    const value = JSON.parse(text) as { present?: unknown; terminated?: unknown }
    assert.deepEqual(Object.keys(value).sort(), ['present', 'terminated'])
    assert(value.present === false || value.terminated === true, 'Remote termination unconfirmed')
  }
  async function closeAll() {
    failed = true
    // A native fault cannot start secondary SQL/termination while an original
    // HTTP/body operation is still owned. The enclosing probe joins it first.
    if(remainingProbeOwned)return
    const results = await Promise.allSettled([...sessions].map(session => session.destroy()))
    if (surveyUnjoined) throw new Survey263UnjoinedChildError()
    if (results.some(result => result.status === 'rejected')) throw failure()
  }
  class NativeSession implements DraftSaveSession {
    readonly name: string
    private child: ChildProcessWithoutNullStreams
    private owned?: Backend
    private ended = false
    private closed: Promise<void>
    private active?: { reject: (error: Error) => void; finish: () => void; timer: ReturnType<typeof setTimeout>; end: string; lines: string[]; bytes: number; endSeen?: boolean }
    private partial = ''; private stderr = 0; private frame = 0; private closing?: Promise<void>
    private decoder = new StringDecoder('utf8')
    private sqlstate = captureSqlstate()
    private surveyObserver?: SurveyCarrier
    private progressScope: TestOwnerReorderProgressScope = 'none'
    private progress = captureTestOwnerReorderProgress('none')
    private surveyProgressCapture = captureSurveyProgress(false)
    surveyProgressObservation() { return this.surveyProgressCapture.snapshot() }
    freezeSurveyProgress() { return this.surveyProgressCapture.freeze() }
    private diagnosticEnabled = false
    private timing = captureTestOwnerReorderTimings(false)
    private cleaning = false
    progressObservation() { return { scope: this.progressScope, snapshot: this.progress.snapshot() } }
    diagnosticObservation() { return { enabled: this.diagnosticEnabled, snapshot: this.timing.snapshot() } }
    private fault(kind: Fault) { if (!this.cleaning) {
      const code=this.sqlstate.code(),observer=this.surveyObserver
      if(remaining&&this.active&&observer?.backend&&observer.marker&&code==='P7501'&&!firstFault&&!surveyCommittedFailure){
        const s=profile.surveyCommitted!.schedules.find(s=>s.label===observer.label)!
        surveyCommittedFailure=Object.freeze({direction:s.index*2+(s.direction==='forward'?1:2),frame:'observer',predicate:'db-observation-window',observationMs:'unknown'})
      }
      record(kind, role(this.name), code)
    } }
    constructor(name: string) {
      this.name = name
      checkSurveySdkAdmission()
      if (component) chargeSurvey269ComponentControl(profile.survey269Exchange!)
      this.child = spawn('docker', dockerArgs(name), { cwd: input.repository, stdio: ['pipe', 'pipe', 'pipe'] })
      this.closed = new Promise(resolveClose => this.child.once('close', () => {
        if (this.active) this.fault('child-exit')
        this.ended = true; this.reject(); resolveClose()
      }))
      this.child.on('error', () => { this.fault('child-exit'); this.reject(); void closeAll().catch(() => {}) })
      this.child.stdin.on('error', () => { this.fault('protocol'); this.reject(); void closeAll().catch(() => {}) })
      this.child.stdout.on('data', (chunk: Buffer) => {
        try {
          assert(Buffer.isBuffer(chunk));if (component) chargeComponent(chunk.length, this.cleaning)
          assert(chunk.length <= CAPS.outputBytes - Buffer.byteLength(this.partial))
          this.partial += this.decoder.write(chunk)
          for (;;) {
            const newline = this.partial.indexOf('\n'); if (newline < 0) break
            const line = this.partial.slice(0, newline).replace(/\r$/, ''); this.partial = this.partial.slice(newline + 1)
            assert(this.active)
            if (line === this.active.end) { this.active.endSeen = true; this.active.finish(); continue }
            this.active.bytes += Buffer.byteLength(line); if (!component) exchanged += Buffer.byteLength(line)
            assert(this.active.bytes <= CAPS.outputBytes && (exchanged <= exchangeLimit || (component && this.cleaning)))
            if (line) this.active.lines.push(line)
          }
        } catch { this.fault('protocol'); this.reject(); void closeAll().catch(() => {}) }
      })
      this.child.stderr.on('data', (chunk: Buffer) => {
        this.stderr += chunk.length
        if (component) {try {chargeComponent(chunk.length, this.cleaning)} catch {this.fault('budget');this.reject();void closeAll().catch(() => {});return}}
        if (profile.reorderDiagnosticSql) exchanged += chunk.length
        if (this.stderr > CAPS.stderrBytes || (profile.reorderDiagnosticSql && exchanged > exchangeLimit)) { this.fault('protocol'); this.reject(); void closeAll().catch(() => {}) }
        else {
          this.sqlstate.push(chunk)
          if (!this.cleaning && !firstFault && this.active && this.surveyProgressCapture.snapshot().enabled) {
            this.surveyProgressCapture.push(chunk)
            if (!this.surveyProgressCapture.snapshot().valid) { this.fault('protocol'); this.reject(); void closeAll().catch(() => {}); return }
            if (this.active?.endSeen) this.active.finish()
          }
          if (!this.cleaning && !firstFault && this.active) this.progress.push(chunk)
          if (!this.cleaning && !firstFault && this.active && this.diagnosticEnabled) this.timing.push(chunk)
        }
      })
    }
    private reject() { if (this.active) { clearTimeout(this.active.timer); this.active.reject(failure()); this.active = undefined } }
    private raw(sql: string, timeoutMs: number, carrier?: SurveyCarrier): Promise<readonly { result?: unknown }[]> {
      checkSurveySdkAdmission(this.cleaning)
      // Only the original sealed remaining49 suite may exceed generic90s.
      // Check the requested duration before clamping, so a short outer cutoff
      // cannot launder an oversized request for a different frame/session.
      const remainingSuite = remaining && component && remainingRollbackActive && phase === 'transitions'
        && this.name === `${project}_draft_contracts` && this.owned && !this.cleaning && !firstFault
        && carrier === undefined && sql === profile.surveyProgressSql
      const frameLimit = remainingSuite ? 120000 : CAPS.actionMs
      assert(timeoutMs > 0 && timeoutMs <= frameLimit)
      const releaseDeadline=surveyWaitDeadline(carrier)
      if(releaseDeadline!==undefined)timeoutMs=Math.min(timeoutMs,releaseDeadline-Date.now())
      if(remaining&&carrier?.frame==='contender'&&profile.surveyCommitted!.schedules.find(s=>s.label===carrier.label)?.mode==='wait')timeoutMs=Math.min(timeoutMs,profile.surveyCommitted!.caps.waitContenderMs)
      if (profile.survey263Budget) {
        timeoutMs = Math.min(timeoutMs, (this.cleaning ? profile.survey263Budget.cleanupDeadline : profile.survey263Budget.workDeadline) - Date.now())
        assert(timeoutMs > 0)
      }
      assert(!this.ended && !this.active); assert(timeoutMs > 0 && timeoutMs <= frameLimit)
      if (profile.reorderDiagnosticSql) { exchanged += Buffer.byteLength(sql); assert(exchanged <= exchangeLimit) }
      this.progressScope = !this.cleaning && !firstFault && profile.label === 'test-owner-reorder' && phase === 'contracts'
        && role(this.name) === 'contracts' && profile.reorderProgressSql
        ? sql === profile.reorderProgressSql.bulk ? 'bulk' : sql === profile.reorderProgressSql.calibration ? 'calibration' : 'none'
        : 'none'
      this.progress = captureTestOwnerReorderProgress(this.progressScope)
      this.diagnosticEnabled = !this.cleaning && !firstFault && phase === 'contracts' && role(this.name) === 'contracts'
        && profile.reorderDiagnosticSql === sql
      this.timing = captureTestOwnerReorderTimings(this.diagnosticEnabled)
      const marker = `__draft_save_end_${++this.frame}__`
      this.surveyObserver=remaining&&carrier?.frame==='observer'?carrier:undefined
      if(remaining)this.sqlstate=captureSqlstate(this.surveyObserver!==undefined)
      this.surveyProgressCapture = captureSurveyProgress(!this.cleaning && !firstFault && component
        && role(this.name) === 'contracts' && (phase === 'contracts' || phase === 'transitions') && sql === profile.surveyProgressSql)
      return new Promise((resolveRows, reject) => {
        const timer = setTimeout(() => { this.fault('timeout'); this.reject(); void closeAll().catch(() => {}) }, timeoutMs)
        this.active = { timer, reject, end: marker, bytes: 0, lines: [], finish: () => {
          // stdout/stderr are independent pipes. Join their terminal markers
          // under the original timer; never reject merely for delivery order.
          if (this.surveyProgressCapture.snapshot().enabled && this.surveyProgressCapture.snapshot().sequence < SURVEY_PROGRESS_EVENTS.length) return
          const active = this.active!; this.active = undefined; clearTimeout(timer)
          if (this.surveyProgressCapture.snapshot().enabled) {
            if (!this.surveyProgressCapture.finish().valid) { this.fault('protocol'); reject(failure()); void closeAll().catch(() => {}); return }
            surveyProgress = this.surveyProgressCapture.freeze()
          }
          if (!firstFault && !this.cleaning) {
            if (this.diagnosticEnabled) diagnosticTimings = this.timing.snapshot()
            if (this.progressScope === 'bulk') bulkProgress = this.progress.snapshot().checkpoint
            if (this.progressScope === 'calibration') progressCalibrated = this.progress.snapshot().calibrated
          }
          try { if(remaining&&carrier)surveyWaitDeadline(carrier,true)
            const rows = active.lines.map(line => {
            try { return { result: JSON.parse(line) as unknown } }
            catch { assert(/^[a-f0-9-]{36}$/.test(line) || /^-?[0-9]+$/.test(line) || line === 'ok'); return { result: line } }
          })
            if (carrier) { assert(carrier.marker === marker && carrier.dispatchedAt !== undefined)
              carrier.rows = freeze(structuredClone(rows)); carrier.completedAt = Date.now() }
            resolveRows(rows)
          } catch { this.fault('protocol'); reject(failure()); void closeAll().catch(() => {}) }
        } }
        if (carrier) {
          validateSurveyCarrier(carrier); check(); assert(this.owned && carrier.session === this)
          verifySurveyRemainingSources(component?SURVEY_269_COMPONENT_ROOTS.carrier:input.repository)
          assert(surveyPair); assert.deepEqual(this.owned, surveyPair[carrier.side])
          surveyWaitDeadline(carrier)
          // Issue only at the actual guarded write, not at execute invocation.
          carrier.backend = Object.freeze({ ...this.owned }); carrier.marker = marker; carrier.dispatchedAt = Date.now()
        }
        const wire = `${sql}\n\\echo ${marker}\n`
        if (component) chargeComponent(Buffer.byteLength(wire), this.cleaning)
        this.child.stdin.write(wire)
        carrier?.didDispatch()
      })
    }
    async initialize() {
      await guard(false, role(this.name))
      const rows = await this.raw(manifest.bootstrap, CAPS.closeMs)
      assert.equal(rows.length, 1); this.owned = backend(rows[0].result, this.name)
    }
    async execute(sql: string, timeoutMs: number) {
      return this.executeNative(sql, timeoutMs)
    }
    private async executeNative(sql: string, timeoutMs: number, carrier?: SurveyCarrier) {
      try { check(!this.cleaning); if (carrier) validateSurveyCarrier(carrier); else assert(profile.validateSql(sql))
        surveyWaitDeadline(carrier)
        assert(++actions <= CAPS.actions); await guard(false, role(this.name), !this.cleaning); check(!this.cleaning)
        surveyWaitDeadline(carrier)
        return await this.raw(sql, timeoutMs, carrier) }
      catch { this.fault('unknown'); if(!remainingProbeOwned)await closeAll(); throw failure() }
    }
    surveyOwned() { assert(profile.surveyCommitted && this.owned && sessions.has(this)); return Object.freeze({ ...this.owned }) }
    surveyExecute(side: 'holder' | 'contender', frame: SurveyFrame, sql: string, label = '', operationSha256?: string, originalContender?:SurveyCarrier): SurveyCarrier {
      assert(profile.surveyCommitted)
      let didDispatch!: () => void, rejectDispatch!: (error: unknown) => void
      const dispatched = new Promise<void>((resolveDispatch, reject) => { didDispatch = resolveDispatch; rejectDispatch = reject })
      // Install both rejection handlers before beginning asynchronous guards.
      void dispatched.catch(() => {})
      const carrier: SurveyCarrier = { session: this, side, frame, sql, label, operationSha256, originalContender, dispatched, didDispatch, rejectDispatch,
        completion: Promise.resolve([]) }
      surveyCarriers.add(carrier)
      carrier.completion = this.executeNative(sql, profile.singleMs ?? CAPS.actionMs, carrier).catch(error => { rejectDispatch(error); throw error })
      void carrier.completion.catch(() => {})
      return carrier
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
          const time = Math.min(CAPS.closeMs, profile.survey263Budget ? profile.survey263Budget.cleanupDeadline - Date.now() : Infinity)
          if (time <= 0) { surveyUnjoined = true; rejectClose(new Survey263UnjoinedChildError()); return }
          const timer = setTimeout(() => { if (profile.survey263Budget) surveyUnjoined = true
            rejectClose(profile.survey263Budget ? new Survey263UnjoinedChildError() : failure())
          }, time)
          this.closed.then(() => { clearTimeout(timer); resolveClose() }, rejectClose)
        })
        sessions.delete(this); this.partial = ''
        if (remoteError) throw failure()
      })().catch(error => { checkJoined(); throw error })
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
    try { return await session.execute(sql, profile.singleMs ?? CAPS.actionMs) } finally { await session.rollbackAndClose(CAPS.closeMs) }
  }
  async function restorationControl(sql: string) {
    assert([manifest.privilege.catalog, manifest.privilege.restore, manifest.snapshot,
      ...(profile.learnerCancellation ? [profile.learnerCancellation.catalog, profile.learnerCancellation.restore] : []),
      ...(remaining?[remaining.cancellation.frames.restoreBeforeDispatch,remaining.cancellation.frames.restoreAfterDispatch,remaining.wire.frames.restore]:[]),
      ...(profile.innerPrivilege ? [profile.innerPrivilege.catalog, profile.innerPrivilege.restore] : []),
      ...Object.values(profile.publicationPrivileges ?? {}).flatMap(p => [p.catalog, p.restore])].includes(sql))
    assert(++actions <= CAPS.actions)
    // Cleanup is allowed after a failed SDK/dispatch; all immutable bindings and
    // original safety guards still pass before the fixed restoration operation.
    if (restorationAdmission) assert.equal(await restorationAdmission(), undefined)
    await guard(true)
    // Guard awaits fresh discovery. Recheck caller lifetime/poison immediately
    // before the fixed restoration dispatch; this gate cannot authorize SQL.
    if (restorationAdmission) assert.equal(await restorationAdmission(), undefined)
    const name = `${project}_${sql === manifest.snapshot ? 'draft_contracts' : 'fixture'}`
    const output = await command('docker', dockerArgs(name), sql, CAPS.closeMs, undefined, true)
    if (profile.learnerCancellation && sql === profile.learnerCancellation.restore) {
      // This exact fixed SQL includes its full guard's plain-text receipt;
      // its quiet trigger/function DROP and COMMIT emit no JSON result row.
      assert.equal(output, 'ok')
      return []
    }
    return output ? [{ result: JSON.parse(output) as unknown }] : []
  }
  /** Two fixed original requests; all promises/body/cancel operations are owned
   * here until positive settlement. No DTO or callback grants provenance. */
  async function runSurveyRemainingProbes(holder:NativeSession){
    assert(remaining&&profile.surveySdk&&component&&!remainingProbeOwned&&surveyPair)
    assertSurvey269RemainingExchange(profile.survey269Exchange!)
    surveySdkWorkStartedAt=Date.now()
    surveySdkWorkDeadline=Math.min(surveySdkWorkStartedAt+60000,profile.survey263Budget!.workDeadline)
    remainingProbeOwned=true
    const frame=async(kind:SurveyFrame,sql:string)=>{
      const c=holder.surveyExecute('holder',kind,sql)
      try{await c.completion;return surveyResult(c)}catch(error){
        // A rejected client promise is not a positively completed SQL frame.
        // Only the actual carrier's nonce/end-marker path sets completedAt.
        if(c.dispatchedAt!==undefined&&c.completedAt===undefined){
          record('protocol','holder','unknown','probe-native-frame');surveyUnjoined=true;throw new Survey263UnjoinedChildError()
        }
        checkJoined();throw error
      }
    }
    const restored=(rows:Awaited<ReturnType<typeof restorationControl>>,stage:string,sha:string)=>{
      assert(rows.length===1);const r=rows[0].result as Record<string,unknown>
      assert(r&&r.stage===stage&&r.descriptorSha256===sha&&r.nativeVerified===false)
      assert(typeof r.stateSha256==='string'&&/^[a-f0-9]{64}$/.test(r.stateSha256));return r
    }
    let cancellationDispatched=false
    const originalRequest=async(kind:'cancellation'|'wire')=>{
      const descriptor=kind==='cancellation'?remaining.cancellation:remaining.wire
      const request=descriptor.request,body=JSON.stringify(request.body),controller=new AbortController()
      const pending=new Set<Promise<unknown>>();let response:Response|undefined,reader:ReadableStreamDefaultReader<Uint8Array>|undefined,done=false,observed=false,dispatched=false
      let timer:ReturnType<typeof setTimeout>|undefined
      const own=<T>(p:Promise<T>)=>{pending.add(p);void p.then(()=>pending.delete(p),()=>pending.delete(p));return p}
      const ownCancel=(p:Promise<void>)=>own(p.catch(()=>{surveyUnjoined=true;throw new Survey263UnjoinedChildError()}))
      const settle=async()=>{
        let closeTimer:ReturnType<typeof setTimeout>|undefined
        // Passive joining still owns already-dispatched HTTP/body operations
        // after a native-frame poison; it grants no further dispatch authority.
        try{assert(Date.now()<profile.survey263Budget!.cleanupDeadline);await Promise.race([(async()=>{while(pending.size)await Promise.allSettled([...pending])})(),new Promise<never>((_,reject)=>{closeTimer=setTimeout(()=>reject(new Survey263UnjoinedChildError()),Math.max(0,profile.survey263Budget!.cleanupDeadline-Date.now()))})]);checkJoined()}
        catch{surveyUnjoined=true;throw new Survey263UnjoinedChildError()}
        finally{if(closeTimer)clearTimeout(closeTimer)}
      }
      let aborted!:()=>void
      const abortSignal=new Promise<never>((_,reject)=>{aborted=()=>reject(new SurveySdkDeadlineError())})
      // The handler is attached before any operation can expire.
      void abortSignal.catch(()=>{})
      const bounded=async<T>(p:Promise<T>)=>{const value=await Promise.race([own(p),abortSignal]);checkSurveySdkAdmission();return value}
      let startedAt=0
      try{
        checkSurveySdkAdmission();await guard();checkSurveySdkAdmission();check()
        assert(Buffer.byteLength(body)<=4096)
        const headers={authorization:`Bearer ${profile.surveySdk!.status.SERVICE_ROLE_KEY}`,apikey:profile.surveySdk!.status.SERVICE_ROLE_KEY,'content-type':'application/json',accept:'application/json','accept-profile':'public','content-profile':'public'}
        chargeComponent(Buffer.byteLength(body));chargeSurvey269RemainingRequest(profile.survey269Exchange!)
        timer=setTimeout(()=>{controller.abort();aborted()},Math.max(0,surveySdkWorkDeadline!-Date.now()))
        startedAt=Date.now();remainingHttpPending=true;dispatched=true;if(kind==='cancellation')cancellationDispatched=true
        const original=own(fetch(request.origin+request.path,{method:'POST',headers,body,redirect:'error',signal:controller.signal}).then(async received=>{
          response=received // Own late headers/body before ANY deadline check.
          remainingHttpPending=false
          if(controller.signal.aborted){await ownCancel(received.body?.cancel()??Promise.resolve());return received}
          return received
        },error=>{remainingHttpPending=false;throw error}))
        if(kind==='cancellation'){
          assert(remainingHttpPending)
          const witness=await frame('cancel-observer',remaining.cancellation.frames.observer)
          assert(remainingHttpPending,'Original cancellation HTTP settled before observer completion')
          inspectSurveyCancellationPendingShape(remaining.cancellation,witness);observed=true
        }
        response=await bounded(original)
        assert(response instanceof Response&&!response.redirected&&!response.headers.has('location')&&response.body)
        assert(!response.url||response.url===request.origin+request.path)
        assert(response.headers.get('content-type')?.startsWith('application/json'))
        assert(response.status===(kind==='cancellation'?500:200))
        reader=response.body.getReader();const chunks:Uint8Array[]=[];let bytes=0,reads=0
        for(;;){assert(++reads<=8388609);const part=await bounded(reader.read().then(part=>{
          if(!part.done){bytes+=part.value.byteLength;chargeComponent(part.value.byteLength)}
          return part
        }));if(part.done){done=true;break}
          if(kind==='wire'){
            assert(bytes<=8388608+65536,'Wire crossing chunk exceeds fixed bound')
            if(bytes>8388608){await bounded(ownCancel(reader.cancel()));done=true;break}
          }else{assert(bytes<=65536);chunks.push(part.value)}
        }
        if(kind==='wire')assert(bytes>8388608,'Actual HTTP body did not cross wire ceiling')
        else{
          const value:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)))
          assert(value&&typeof value==='object'&&!Array.isArray(value));const r=value as Record<string,unknown>
          assert.deepEqual(Object.keys(r).sort(),['code','details','hint','message']);assert(r.code==='57014')
          assert(typeof r.message==='string'&&Buffer.byteLength(r.message)<=16384)
          assert((r.details===null||typeof r.details==='string'&&Buffer.byteLength(r.details)<=16384)&&(r.hint===null||typeof r.hint==='string'&&Buffer.byteLength(r.hint)<=16384))
          assert(Date.now()-startedAt>=7500&&Date.now()-startedAt<=12000)
        }
        await guard();checkSurveySdkAdmission();check()
        return {bytes,observed}
      }catch(error){
        record(error instanceof SurveySdkDeadlineError?'guard':'unknown','none','unknown',error instanceof SurveySdkDeadlineError?'sdk-deadline':'probe-http');throw error
      }finally{
        if(timer)clearTimeout(timer)
        controller.abort()
        if(!done){const cancel=reader?reader.cancel():response?.body?.cancel();if(cancel)ownCancel(cancel)}
        await settle()
        if(reader)reader.releaseLock()
        // Without the actual pending observer, a dispatched backend's exact
        // restoration ownership is unknown even if an HTTP promise settled.
        if(kind==='cancellation'&&dispatched&&!observed){surveyUnjoined=true;throw new Survey263UnjoinedChildError()}
      }
    }
    try{
      let cancelArmed=false
      remainingProbeStage='cancellation'
      try{
        cancelArmed=true
        const prepared=await frame('cancel-prepare',remaining.cancellation.frames.prepare)
        assert(prepared.stage==='prepared'&&prepared.descriptorSha256===remaining.cancellation.descriptorSha256&&prepared.nativeVerified===false)
        // The private dispatch flag is selected only after exact preparation;
        // the request helper itself proves whether original dispatch occurred.
        await originalRequest('cancellation');remainingCancellationDone=true
      }finally{
        if(cancelArmed){checkJoined();const sql=cancellationDispatched?remaining.cancellation.frames.restoreAfterDispatch:remaining.cancellation.frames.restoreBeforeDispatch
          try{restored(await restorationControl(sql),'restored',remaining.cancellation.descriptorSha256)}
          catch{record('unknown','none','unknown','probe-restoration');surveyUnjoined=true;throw new Survey263UnjoinedChildError()}}
      }
      let wireArmed=false
      remainingProbeStage='wire'
      try{
        wireArmed=true
        inspectSurveyWireReceipt(remaining.wire,'wire-prepared',await frame('wire-prepare',remaining.wire.frames.prepare))
        await originalRequest('wire');remainingWireDone=true
      }finally{if(wireArmed){checkJoined();
        try{const r=restored(await restorationControl(remaining.wire.frames.restore),'wire-restored',remaining.wire.descriptorSha256);inspectSurveyWireReceipt(remaining.wire,'wire-restored',r)}
        catch{record('unknown','none','unknown','probe-restoration');surveyUnjoined=true;throw new Survey263UnjoinedChildError()}}}
      remainingProbeStage='complete'
    }finally{remainingProbeOwned=false;checkJoined()}
  }
  // Both closed251 capabilities use this SAME engine, counters, deadline and
  // session ownership. A second engine would renew the native proof budgets.
  async function probePrivilege(kind: 'outer' | 'inner' | PublicationPrivilegeKind, probe: () => Promise<{ status: 503; rpcCalls: 1 | 2; rawCode: '42501' }>) {
    phase = 'privilege'
    const privilege = kind === 'outer' ? manifest.privilege : kind === 'inner' ? profile.innerPrivilege : profile.publicationPrivileges?.[kind]
    let ownsProbe = false
    try {
      assert(privilege && setupDone && !ran && !probing && !probed.has(kind) && sessions.size === 0)
      probing = true; ownsProbe = true; probed.add(kind); check()
      const rowsBefore = await single(manifest.snapshot)
      const catalogBefore = decodeSnapshotCatalog(await single(privilege.catalog))
      assert.equal(catalogBefore.owner, privilege.expectedOwner)
      assert.equal(catalogBefore.acl.length, 2)
      assert.deepEqual(catalogBefore.acl.map(row => row.grantee).sort(), [...privilege.expectedRoles].sort())
      assert(catalogBefore.acl.every(row => row.grantor === catalogBefore.owner && row.privilege_type === 'EXECUTE' && !row.is_grantable))
      let restoreRequired = false
      try {
        restoreRequired = true // Arm before dispatch, including ambiguous COMMIT.
        await single(privilege.revoke, true)
        await guard(); check()
        assert.deepEqual(await probe(), privilege.expectedEvidence); check()
      } catch { record('unknown'); failed = true; throw failure()
      } finally {
        if (restoreRequired) {
          try {
            await restorationControl(privilege.restore)
            assert.deepEqual(decodeSnapshotCatalog(await restorationControl(privilege.catalog)), catalogBefore)
            assert.deepEqual(await restorationControl(manifest.snapshot), rowsBefore)
          } catch { failed = true; throw failure() }
        }
      }
      completedProbes.add(kind)
      return Object.freeze({ privilegeRestored: true, fixtureUnchanged: true, snapshotAclSha256: testOwnerDigest(JSON.stringify(catalogBefore)) })
    } catch (error) { record('unknown'); checkJoined(); throw error }
    finally { if (ownsProbe) probing = false }
  }
  return Object.freeze({ manifest,
    ...(profile.surveyCommitted ? { async runSurveyRemainingCommitted() {
      phase = 'transitions'
      const m = profile.surveyCommitted!
      let holder: NativeSession | undefined, contender: NativeSession | undefined
      const completed: string[] = []
      try {
        assert((profile.label === 'survey263'||remaining) && setupDone && !ran && !surveyCommittedStarted && !probing && sessions.size === 0)
        surveyCommittedStarted = true; check()
        // Preserve the original rollback SQL contract without replaying its races.
        const contractTarget = target(profile.contractsSha256)
        remainingRollbackActive = !!remaining
        try { await profile.runContracts(contractTarget, driver(contractTarget)) }
        finally { remainingRollbackActive = false }
        const d = driver(target(input.acceptedManifestSha256))
        holder = await d.openSession(`${project}_draft_holder`) as NativeSession
        contender = await d.openSession(`${project}_draft_contender`) as NativeSession
        assert(holder instanceof NativeSession && contender instanceof NativeSession)
        surveyPair = Object.freeze({ holder: holder.surveyOwned(), contender: contender.surveyOwned() })
        const frame = async (session: NativeSession, side: 'holder' | 'contender', kind: SurveyFrame, sql: string, label = '', operationSha256?: string, originalContender?:SurveyCarrier) => {
          const c = session.surveyExecute(side, kind, sql, label, operationSha256, originalContender)
          await c.completion; return c
        }
        const seed = await frame(holder, 'holder', 'seed', m.seed)
        const captured = surveyResult(seed)
        const graph = (value: unknown): SurveyGraph => {
          assert(value && typeof value === 'object' && !Array.isArray(value))
          assert(Buffer.byteLength(JSON.stringify(value)) <= m.caps.responseBytes)
          return structuredClone(parseSurveyCommittedGraph(value))
        }
        const seedGraph = graph(captured.after)
        verifySurveyCommittedSeed(m, graph(captured.before), seedGraph, {
          startedAt: new Date(seed.dispatchedAt!).toISOString(), endedAt: new Date(seed.completedAt!).toISOString(), seedTimestamp: String(captured.seedTimestamp) })
        surveyBaseline = { seed, graph: seedGraph }
        await frame(holder, 'holder', 'bootstrap', m.bootstrap.holder)
        await frame(contender, 'contender', 'bootstrap', m.bootstrap.contender)
        for (const s of m.schedules) {
          check(); assert(surveyBaseline?.seed === seed && surveyCarriers.has(seed) && seed.backend && seed.marker)
          const before = structuredClone(surveyBaseline.graph), directionStarted = Date.now()
          const first = await frame(holder, 'holder', 'holder', s.frames.holder, s.label, s.firstOperationSha256)
          const held = surveyResult(first)
          const second = contender.surveyExecute('contender', 'contender', s.frames.contender, s.label, s.secondOperationSha256)
          await second.dispatched
          assert(second.backend && second.dispatchedAt !== undefined && second.marker)
          let observation: Record<string, unknown>, observedAt: number | undefined, observationCarrier = second
          let witnessPredicate: 'pending' | 'receipt' | 'nowait-result' | 'witness' = 'pending'
          try {
          if (s.mode === 'wait') {
            assert(second.completedAt === undefined)
            const observer = await frame(holder, 'holder', 'observer', surveyCommittedObservationSql(m, s.label, surveyPair), s.label, undefined, remaining?second:undefined)
            observationCarrier = observer
            witnessPredicate = 'receipt'
            observation = surveyResult(observer); observedAt = Date.parse(String(observation.observedAt))
            witnessPredicate = 'pending'
            assert(second.completedAt === undefined, 'Survey original contender settled before observation')
          } else {
            await second.completion
            witnessPredicate = 'receipt'
            const rejected = surveyResult(second)
            witnessPredicate = 'nowait-result'
            assert((rejected.operation as { code?: unknown })?.code === 'PT409')
            observedAt = second.completedAt!
            // NOWAIT evidence is the original completed response and local frame
            // clock; no extra database observer or inferred tuple claim.
            observation = { label: s.label, observedAt: new Date(observedAt).toISOString(), poll: 1,
              holder: surveyPair.holder, contender: surveyPair.contender, held: held.heldWitness,
              blockers: [], waiter: null, code: 'PT409', immediateMs: observedAt - second.dispatchedAt }
          }
          witnessPredicate = 'witness'
          verifySurveyCommittedWitness(m, s.label, surveyPair, { ...observation,
            contenderDispatch: { backend: second.backend, sqlSha256: testOwnerDigest(second.sql), operationSha256: second.operationSha256 } }, {
            startedAt: directionStarted, workDeadline: profile.survey263Budget!.workDeadline,
            dispatchedAt: second.dispatchedAt, observedAt, contenderPending: second.completedAt === undefined, poll: Number(observation.poll) })
          if(remaining&&s.mode==='wait')surveyWaitDeadline(observationCarrier,true)
          } catch (error) {
            // Supplemental diagnostics only for the remaining profile's host
            // witness failure. Earlier transport/guard faults retain priority.
            if (remaining && !firstFault && !surveyCommittedFailure) {
              const delta = observedAt === undefined ? NaN : observedAt - second.dispatchedAt
              surveyCommittedFailure = Object.freeze({ direction: s.index * 2 + (s.direction === 'forward' ? 1 : 2),
                frame: s.mode === 'wait' ? 'observer' : 'contender', predicate: surveyCommittedWitnessFailure(error) ?? witnessPredicate,
                observationMs: Number.isFinite(delta) ? Math.trunc(Math.max(-m.caps.workMs, Math.min(m.caps.workMs, delta))) : 'unknown' })
            }
            throw error
          }
          await frame(holder, 'holder', 'release', s.frames.release, s.label, undefined, s.mode==='wait'?second:undefined)
          await second.completion
          if(remaining&&s.mode==='wait')surveyWaitDeadline(second,true)
          const secondResult = surveyResult(second)
          await frame(contender, 'contender', 'settle', s.frames.settle, s.label)
          const retry = s.mode === 'nowait' ? await frame(contender, 'contender', 'retry', s.frames.retry, s.label, s.secondOperationSha256) : undefined
          const retryResult = retry ? surveyResult(retry) : undefined
          const terminal = await frame(holder, 'holder', 'terminal', s.frames.terminal, s.label)
          const terminalResult = surveyResult(terminal), after = graph(terminalResult.graph)
          const mutationFirst = s.index === 1 || s.index >= 8 && s.index <= 12
          const mutationHolder = mutationFirst ? s.direction === 'forward' : s.direction === 'reverse'
          const writer = s.index === 13 ? held : s.index === 14 ? retryResult ?? secondResult
            : [5, 6].includes(s.index) || mutationHolder ? held : retryResult ?? secondResult
          const response = after['public.survey_responses']?.find(r => r.survey_id === s.cohort.surveyId && r.student_id === m.actors[1].id)
          const firstResponse = (held.responses as Record<string, unknown>[] | undefined)?.[0]
          const times: SurveyCommittedTimes = { startedAt: new Date(directionStarted).toISOString(), endedAt: new Date(terminal.completedAt!).toISOString(),
            writerTimestamp: String(writer.writerTimestamp), responseId: response ? String(response.id) : undefined,
            responseSubmittedAt: response ? String(response.submitted_at) : undefined, responseTimestamp: response ? String(response.updated_at) : undefined,
            firstResponse, archiveReceipt: writer.archiveReceipt as SurveyCommittedTimes['archiveReceipt'] }
          verifySurveyCommittedEffects(m, s.label, before, after, times)
          type Operation = Parameters<typeof verifySurveyCommittedEnvelopes>[4]['holder']
          verifySurveyCommittedEnvelopes(m, s.label, before, after, { holder: held.operation as Operation, contender: secondResult.operation as Operation,
            retry: retryResult?.operation as Operation | undefined, cachedQuestions: terminalResult.cached_questions,
            freshRead: terminalResult.fresh_read as Operation, cachedResponseProbe: terminalResult.cached_response_probe as Operation | null })
          surveyBaseline.graph = after; completed.push(s.label)
        }
        if(remaining){
          verifySurveyPrimaryMembership(profile.surveySdk!.fixture,m,seedGraph,surveyBaseline.graph)
          await runSurveyRemainingProbes(holder)
        }
      } catch (error) { record('unknown'); failed = true; checkJoined(); throw error }
      finally {
        if(remaining)checkJoined()
        const closed = await Promise.allSettled([holder, contender].filter((s): s is NativeSession => Boolean(s)).map(s => s.rollbackAndClose(CAPS.closeMs)))
        checkJoined(); assert(closed.every(r => r.status === 'fulfilled'), 'Survey original persistent session closure unconfirmed')
      }
      check(); assert(completed.length === 30 && sessions.size === 0)
      surveyCommittedDone = true
      return freeze({ kind: remaining?'survey269-committed-cancellation-wire' as const:'survey-private-committed-binding-only' as const, directions: completed,
        inventoryComplete: Boolean(remaining), nativeVerified: false as const,
        ...(remaining?{cancellation:{genuine57014:remainingCancellationDone,originalHttpAndBodyJoined:true,backendObserved:true},
          wire:{actualOverflow:remainingWireDone,bodyCancellationJoined:true,originalValuesRestored:true},
          primaryMembershipUnchanged:true,removedCohorts:2,observerFrames:14,
          phaseDeadline:surveySdkWorkDeadline,requests:survey269ComponentExchangeReceipt(profile.survey269Exchange!).requests}:{}),
        missing: remaining?['ordinary14-sdk','genuine269-types','outer-final-preservation']:
          ['survey-eight-second-postgrest-cancellation', 'actual-survey-payload-ceilings', 'helper-and-outer-dispatch-accounting',
          'restoration-and-final-preservation-inventory', 'complete-input-output-and-helper-byte-accounting'],
        controls, actions, exchangeBytes: exchanged, remainingSessions: sessions.size })
    } } : {}),
    ...(profile.survey269Component ? { async runSurvey269ContractsOnly() {
      phase = 'contracts'
      try {
        assert(setupDone && !ran && !probing && sessions.size === 0);ran = true;check()
        const before = await single(manifest.snapshot)
        const decoded = decodeAssignmentListSnapshot(before.map(row => JSON.stringify(row.result)).join('\n'), 'rows')
        assert(Array.isArray(decoded.tables['public.classrooms']) && decoded.tables['public.classrooms'].length >= 2)
        assert(Array.isArray(decoded.tables['public.surveys']) && decoded.tables['public.surveys'].length >= 3)
        assert(Array.isArray(decoded.tables['public.survey_questions']) && decoded.tables['public.survey_questions'].length >= 2)
        const bound = target(profile.contractsSha256)
        const contracts = await profile.runContracts(bound, driver(bound))
        phase = 'contracts-verify'
        assert.deepEqual(await single(manifest.snapshot), before, 'Survey269 rollback whole-row equality differs')
        assert.equal(sessions.size, 0);check();runDone = true;phase = 'complete'
        return freeze({ scope: 'source-compatibility-and-genuine-types-prerequisite' as const, contracts,
          fixtureUnchanged: true as const, racesRun: false as const, nativeVerified: false as const,
          controls, actions, exchangeBytes: exchanged, countedChannels: survey269ComponentExchangeReceipt(profile.survey269Exchange!).channels, remainingSessions: sessions.size })
      } catch (error) {record('unknown');checkJoined();throw error}
    } } : {}),
    ...(profile.surveySdk ? { async runSurveySdkCommitted() {
      phase = 'transitions'
      try {
        assert(profile.label === 'survey263' || component)
        assert(setupDone && (profile.surveyCommitted ? surveyCommittedDone : ran && runDone) && !surveySdkRan && !probing && sessions.size === 0)
        surveySdkRan = true; check()
        const decode = (rows: Awaited<ReturnType<typeof single>>) => decodeAssignmentListSnapshot(
          rows.map(row => JSON.stringify(row.result)).join('\n'), 'rows')
        const before = decode(await single(manifest.snapshot))
        if(remaining)assert(remainingCancellationDone&&remainingWireDone&&surveySdkWorkDeadline!==undefined)
        const sdkStartedAt = remaining?surveySdkWorkStartedAt!:Date.now(), sdkDeadline = remaining?surveySdkWorkDeadline!:Math.min(sdkStartedAt + (component ? SURVEY_269_COMPONENT_SDK_CAPS.totalMs : 20000), start + CAPS.totalMs, profile.absoluteDeadline ?? start + CAPS.totalMs)
        if (component&&!remaining) { surveySdkWorkStartedAt = sdkStartedAt; surveySdkWorkDeadline = sdkDeadline }
        const sdkGuard = async () => {
          checkSurveySdkAdmission()
          try { await guard() } catch (error) { if (component && error instanceof Survey263UnjoinedChildError) surveySdkGuardUnjoined = true; throw error }
          checkSurveySdkAdmission()
        }
        const transport = createSurveySdkProofTransport(profile.surveySdk!.fixture, profile.surveySdk!.status, fetch, sdkGuard, component ? chargeComponent : undefined,
          component ? { cleanupDeadline: profile.survey263Budget!.cleanupDeadline } : undefined,
          remaining?()=>chargeSurvey269RemainingRequest(profile.survey269Exchange!):undefined)
        if (component) surveySdkDiagnostic = transport.diagnostic
        const startedAt = new Date().toISOString()
        transport.start(component ? sdkDeadline : Math.min(start + CAPS.totalMs, profile.absoluteDeadline ?? start + CAPS.totalMs))
        let sdkFailure: unknown, sdkComplete = false, endedAt: string | undefined
        let sdk: ReturnType<typeof transport.complete> | undefined
        let after: ReturnType<typeof decode> | undefined
        try {
          const fixture = profile.surveySdk!.fixture
          const sdkFixture = {
            ownerId: fixture.actors[0].id, memberId: fixture.actors[1].id, outsiderId: fixture.actors[2].id,
            classroomId: fixture.classes[0].id, surveyId: fixture.surveys[0].id,
          }
          if (component) await runSurvey269ComponentSdkContracts(transport.client, sdkFixture, sdkGuard, sdkDeadline)
          else await runContextualSurveysSdkContracts(transport.client, sdkFixture, sdkGuard)
          sdk = transport.complete(); endedAt = new Date().toISOString(); sdkComplete = true
        } catch (error) { sdkFailure = error; if (component) {
          if (error instanceof Survey269ComponentSdkDeadlineError) record('guard', 'none', 'unknown', 'sdk-deadline')
          else record('unknown', 'none', 'unknown', 'sdk-runner')
        } }
        finally {
          if (component) {
            try { await transport.settle() }
            catch (error) { if (error instanceof Survey263UnjoinedChildError) { failed = true; surveyUnjoined = true } throw error }
            if (sdkFailure instanceof Survey263UnjoinedChildError) { failed = true; surveyUnjoined = true; throw sdkFailure }
            checkJoined(); surveySdkWorkDeadline = undefined
          }
          // A failed/uncertain SDK still gets independent fixed state evidence;
          // it never becomes success merely because its terminal rows look right.
          after = decode(await single(manifest.snapshot))
        }
        if (!sdkComplete) throw sdkFailure ?? failure()
        assert(after && sdk && endedAt); check(); assert.equal(sessions.size, 0)
        assert.equal(after.metadata, before.metadata); assert.equal(after.cron, before.cron)
        const effects = (component ? verifySurvey269ComponentSdkTerminalEffects : verifySurveySdkTerminalEffects)(profile.surveySdk!.fixture, before.tables, after.tables,
          { startedAt, endedAt })
        if(remaining){
          assert(surveyBaseline);const seed=surveyResult(surveyBaseline.seed)
          verifySurveyPrimaryMembership(profile.surveySdk!.fixture,profile.surveyCommitted!,seed.after,after.tables)
          assert.equal(survey269ComponentExchangeReceipt(profile.survey269Exchange!).requests,16)
        }
        surveySdkDone = true
        phase = 'complete'
        return freeze({ kind: 'survey-sdk-terminal-only' as const, sdk, effects, metadataUnchanged: true,
          cronUnchanged: true, nativeVerified: false as const, manifestSha256: input.acceptedManifestSha256,
          controls, actions, exchangeBytes: exchanged, remainingSessions: sessions.size })
      } catch (error) { record('unknown'); checkJoined(); throw error }
    }, async generateSurveyTypes() {
      phase = 'transitions'
      try {
        assert(profile.label === 'survey263' || component)
        assert(surveySdkDone && !surveyTypesGenerated && !probing && sessions.size === 0)
        surveyTypesGenerated = true; check()
        const plan = testDraftSaveTypeGenerationPlan(input.repository, input.reviewedHead, project)
        let generationSettling = false, generationSucceeded = false
        const receipt = await generateTestDraftSaveTypes({ repository: input.repository, reviewedHead: input.reviewedHead,
          projectId: project, guard: async () => {
            if (generationSettling) { checkSettlement(); await guard(true); checkSettlement(); if (generationSucceeded) check() }
            else { check(); await guard(); check() }
          } }, async (file, args) => {
          if (generationSettling) checkSettlement(); else check()
          if (file === 'git') {
            assert(args[0] === '-C' && args[1] === input.repository)
            assert(['rev-parse HEAD', 'status --porcelain --untracked-files=all'].includes(args.slice(2).join(' ')))
            return command('git', [...args], undefined, CAPS.controlMs, undefined, generationSettling)
          }
          assert.equal(file, 'supabase'); assert.deepEqual(args, plan.args)
          await verifyEndpoint()
          try {
            const output = await command('supabase', [...args], undefined, Math.max(1, Math.min(60000,
              (profile.absoluteDeadline ?? start + CAPS.totalMs) - Date.now())))
            generationSucceeded = true; return output
          } finally {
            generationSettling = true
            // An unjoined child poisons even read-only secondary dispatch. Its
            // typed signal must reach the outer lifecycle, not be overwritten.
            checkJoined(); await verifyEndpoint(true); checkJoined()
          }
        }, async () => { assert(endpoint); return dockerInventory(generationSettling) })
        const source = readFileSync(receipt.path, 'utf8')
        assert.equal(Buffer.byteLength(source), receipt.bytes)
        if (component) validateSurvey269ComponentGeneratedTypes(source, receipt.sha256)
        else validateSurveyGeneratedTypes(source, receipt.sha256)
        check()
        phase = 'complete'
        return freeze({ ...receipt, kind: component ? 'genuine-survey269-component-types' as const : 'genuine-survey263-types' as const, validatedRpcContracts: 12,
          ...(component ? {validatedFoundationHotArchiveRpc: true as const} : {}),
          nativeVerified: false as const })
      } catch (error) { record('unknown'); checkJoined(); throw error }
    } } : {}),
    async verifyTarget() {
      await guard()
      return target(input.acceptedManifestSha256)
    },
    diagnostic() {
      const d = firstFault ?? { phase, failure: 'none', role: 'none', sqlstate: 'unknown', controls: Math.min(controls, controlLimit + 1),
        actions: Math.min(actions, CAPS.actions + 1), sessions: Math.min(sessions.size, CAPS.sessions + 1),
        progress: bulkProgress, calibration: progressCalibrated ? 'verified' : 'unverified', checkpoint: 'none', sdkElapsedMs: 'none', sdkRemainingMs: 'none' }
      return `DIAG ${profile.label} native phase=${d.phase} failure=${d.failure} role=${d.role} sqlstate=${d.sqlstate} controls=${d.controls} actions=${d.actions} sessions=${d.sessions}${profile.label === 'test-owner-reorder' ? ` progress=${d.progress} calibration=${d.calibration}` : ''}.\n`
        + (profile.reorderDiagnosticSql ? `DIAG reorder diagnostic-only timing beforeWorkUs=${diagnosticTimings.beforeWorkUs ?? 'unknown'} beforeUpdateUs=${diagnosticTimings.beforeUpdateUs ?? 'unknown'} afterUpdateUs=${diagnosticTimings.afterUpdateUs ?? 'unknown'} valid=${diagnosticTimings.valid}.\n` : '')
        + (component ? `DIAG survey269-component settlement remainingSessions=${sessions.size} exchangeBytes=${survey269ComponentExchangeReceipt(profile.survey269Exchange!).bytes} controlCalls=${survey269ComponentExchangeReceipt(profile.survey269Exchange!).controls}.\n` : '')
        + (component ? `DIAG survey269-component firstFailure checkpoint=${d.checkpoint} sdkElapsedMs=${d.sdkElapsedMs} sdkRemainingMs=${d.sdkRemainingMs}.\n` : '')
        + (remaining && surveyCommittedFailure ? `DIAG survey269-committed failure direction=${surveyCommittedFailure.direction} frame=${surveyCommittedFailure.frame} predicate=${surveyCommittedFailure.predicate} observationMs=${surveyCommittedFailure.observationMs}.\n` : '')
        + (component ? `DIAG survey269-contract progress=${surveyProgress.checkpoint} sequence=${surveyProgress.sequence} elapsedMs=${surveyProgress.elapsedMs ?? 'none'} valid=${surveyProgress.valid}.\n` : '')
        + (component && surveySdkDiagnostic ? `${surveySdkDiagnostic()}\n` : '')
        + (component && surveySdkGuardUnjoined ? 'DIAG survey269-component sdkPending=guard.\n' : '')
        + (remaining?`DIAG survey269-remaining probe=${remainingProbeStage} cancellation=${remainingCancellationDone} wire=${remainingWireDone} originalPending=${remainingHttpPending}.\n`:'')
        + (profile.learnerCancellation ? `DIAG learner cancellationStage=${cancellationFirstFailure ?? cancellationStage} cancellationRestore=${cancellationRestoreFailure ?? 'none'}.\n` : '')
    },
    async setup() {
      phase = 'setup'
      try {
      assert(!setupDone && !ran); check()
      await single(manifest.setup, true); setupDone = true
      return Object.freeze({ fixtureSha256: testOwnerDigest(JSON.stringify(manifest.fixture)), setupSha256: testOwnerDigest(manifest.setup) })
      } catch (error) { record('unknown'); checkJoined(); throw error }
    },
    probeSnapshotPrivilegeDrift: (probe: () => Promise<{ status: 503; rpcCalls: 1; rawCode: '42501' }>) => probePrivilege('outer', probe),
    probeInnerPrivilegeDrift: (probe: () => Promise<{ status: 503; rpcCalls: 1; rawCode: '42501' }>) => probePrivilege('inner', probe),
    probeFixedPrivilegeDrift: (kind: PublicationPrivilegeKind, probe: () => Promise<{ status: 503; rpcCalls: 1 | 2; rawCode: '42501' }>) => probePrivilege(kind, probe),
    ...(profile.learnerCancellation ? { async probeLearnerCancellation(probe: (request: TestLearnerNativeCancellationRequest) => Promise<TestLearnerNativeCancellationReceipt>) {
      phase = 'privilege'
      const fault = profile.learnerCancellation
      assert(fault && setupDone && completedProbes.has('outer') && !ran && !probing && !learnerCancellationDone && sessions.size === 0)
      probing = true
      let restoreRequired = false
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        cancellationStage = 'snapshot'; check(); const before = await single(manifest.snapshot)
        cancellationStage = 'catalog'
        const catalog = await single(fault.catalog)
        assert.deepEqual(catalog, [{ result: { function: null, triggers: [] } }])
        try {
          restoreRequired = true
          cancellationStage = 'install'
          await single(fault.install, true)
          cancellationStage = 'installed'
          assert.deepEqual(await single(fault.installed), [{ result: { installed: true } }])
          cancellationStage = 'guard'
          await guard(); check()
          const request = freeze({ p_actor_id: fault.actorId, p_test_id: fault.testId, p_classroom_id: fault.classroomId,
            p_operation: fault.operation, p_payload: fault.payload, p_deadline: new Date(Math.min(Date.now() + 30000, profile.absoluteDeadline!)).toISOString() })
          const started = Date.now()
          const deadline = Date.parse(request.p_deadline)
          cancellationStage = 'probe'
          const receipt = await Promise.race([probe(request), new Promise<never>((_, reject) => {
            // Full preservation guards share the original30s action. The
            // adapter separately enforces12s wire/body and reports only that.
            timer = setTimeout(() => reject(failure()), Math.max(0, deadline - Date.now()))
          })])
          const elapsed = Date.now() - started
          cancellationStage = 'receipt'
          assert.deepEqual(Object.keys(receipt).sort(), ['elapsedMs', 'rawCode', 'rpcCalls', 'status'])
          assert.equal(receipt.status, 500); assert.equal(receipt.rpcCalls, 1); assert.equal(receipt.rawCode, '57014')
          cancellationStage = 'timing'
          assert(Number.isFinite(receipt.elapsedMs) && receipt.elapsedMs >= 7500 && receipt.elapsedMs <= 12000)
          assert(elapsed >= receipt.elapsedMs && elapsed <= 30000 && Date.now() < deadline); check()
        } catch (error) {
          cancellationFirstFailure ??= cancellationStage
          throw error
        } finally {
          if (timer) clearTimeout(timer)
          if (restoreRequired) {
            try {
              cancellationStage = 'restore'; await restorationControl(fault.restore)
              cancellationStage = 'restored-catalog'; assert.deepEqual(await restorationControl(fault.catalog), catalog)
              cancellationStage = 'restored-fixture'; assert.deepEqual(await restorationControl(manifest.snapshot), before)
            } catch (error) {
              cancellationRestoreFailure ??= cancellationStage
              throw error
            }
          }
        }
        learnerCancellationDone = true
        cancellationStage = 'complete'
        return Object.freeze({ cancellationCode: '57014' as const, catalogRestored: true, fixtureUnchanged: true })
      } catch { cancellationFirstFailure ??= cancellationStage; record('unknown'); failed = true; throw failure() }
      finally { probing = false }
    } } : {}),
    async runCommittedTransitions() {
      phase = 'transitions'
      try {
        assert(profile.runCommitted && profile.committedSha256)
        assert(profile.publicationPrivileges || profile.committedOuterPrivilege)
        assert(setupDone && ran && runDone && !committedRan && !probing && sessions.size === 0)
        if (profile.publicationPrivileges) assert(Object.keys(profile.publicationPrivileges).every(k => probed.has(k as PublicationPrivilegeKind)))
        if (profile.committedOuterPrivilege) assert(completedProbes.has('outer'))
        committedRan = true; check()
        const bound = target(profile.committedSha256)
        const transitions = await profile.runCommitted(bound, driver(bound))
        check(); assert.equal(sessions.size, 0); phase = 'complete'
        return freeze({ transitions, manifestSha256: input.acceptedManifestSha256,
          controls, actions, exchangeBytes: exchanged, remainingSessions: sessions.size })
      } catch (error) { record('unknown'); checkJoined(); throw error }
    },
    async run() {
      phase = 'snapshot'
      try {
      assert(!component, 'Survey269 component exposes contracts-only, never races')
      assert(!profile.surveyCommitted, 'Survey remaining-only profile cannot replay rollback races')
      assert(!profile.reorderDiagnosticSql)
      assert(setupDone && !ran && !probing)
      if (profile.innerPrivilege) assert(probed.has('outer') && probed.has('inner'))
      if (profile.publicationPrivileges) assert(Object.keys(profile.publicationPrivileges).every(k => probed.has(k as PublicationPrivilegeKind)))
      if (profile.committedOuterPrivilege) assert(completedProbes.has('outer'))
      if (profile.learnerCancellation) assert(learnerCancellationDone)
      ran = true; check()
      const before = await single(manifest.snapshot)
      phase = 'contracts'
      const contractTarget = target(profile.contractsSha256)
      const contracts = await profile.runContracts(contractTarget, driver(contractTarget))
      phase = 'contracts-verify'
      assert.deepEqual(await single(manifest.snapshot), before, 'Rollback contract whole-row equality differs')
      const raceTarget = target(profile.racesSha256)
      phase = 'races'
      if (profile.publicationPrivileges) publicationRaceDeadline = Date.now() + 180000
      const races = await profile.runRaces(raceTarget, driver(raceTarget))
      phase = 'races-verify'
      assert.deepEqual(await single(manifest.snapshot), before, 'Rollback schedule whole-row equality differs')
      assert.equal(sessions.size, 0)
      runDone = true
      phase = 'complete'
      return Object.freeze({ contracts, races, fixtureUnchanged: true, manifestSha256: input.acceptedManifestSha256,
        controls,actions,exchangeBytes:exchanged,remainingSessions:sessions.size })
      } catch (error) { record('unknown'); checkJoined(); throw error }
    },
    ...(profile.reorderDiagnosticSql ? { async runDiagnostic() {
      phase = 'snapshot'
      try {
        assert(setupDone && !ran && !probing); ran = true; check()
        const before = await single(manifest.snapshot)
        phase = 'contracts'
        const bound = target(profile.contractsSha256)
        const measurement = await profile.runContracts(bound, driver(bound))
        phase = 'contracts-verify'
        assert.deepEqual(await single(manifest.snapshot), before, 'Diagnostic whole-row equality differs')
        assert.equal(sessions.size, 0); assert(diagnosticTimings.valid && diagnosticTimings.beforeWorkUs === 0)
        check(); phase = 'complete'
        const receipt = freeze({ kind: 'test-owner-reorder-diagnostic-not-acceptance' as const, diagnosticOnly: true as const,
          measurement: { ...measurement, timings: diagnosticTimings }, fixtureUnchanged: true as const,
          manifestSha256: input.acceptedManifestSha256, controls, actions, exchangeBytes: exchanged, remainingSessions: 0 as const })
        validateTestOwnerReorderDiagnosticReceipt(receipt, manifest)
        return receipt
      } catch (error) { record('unknown'); checkJoined(); throw error }
    } } : {}),
  })
}
