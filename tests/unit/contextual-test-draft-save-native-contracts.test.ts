import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { readdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PassThrough, Writable } from 'node:stream'
import { createOfflineTestLearnerRepository } from '../helpers/test-learner-native-repository'

const learnerOffline = createOfflineTestLearnerRepository(process.cwd())
afterAll(learnerOffline.dispose)
const mocks = vi.hoisted(() => ({ spawn: vi.fn(), execFile: vi.fn(), inventory: vi.fn(),
  generatedSource:'',syntheticArtifacts:new Map<string,string>(),config:'',remaining269:false,snapshotSqlReads: false, sourceDrift: false, driftMigration: '249_contextual_test_draft_owner_save.sql', socketInode: 2, sqlFileCache: new Map<string, string>() }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn, execFile: mocks.execFile, execFileSync: vi.fn() }))
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, realpathSync: (path: string) => path === '/private/tmp/pika-test-native-docker.sock'||mocks.remaining269&&(path==='/Users/stew/.codex/worktrees/pika/contextual-surveys-current-main'||/^\/private\/tmp\/pika-assignment-list-[a-f0-9]{12}$/.test(path)) ? path : actual.realpathSync(path),
    readFileSync: ((path, options) => {
      if(mocks.remaining269){
        if(mocks.syntheticArtifacts.has(String(path)))return mocks.syntheticArtifacts.get(String(path))
        if(/^\/private\/tmp\/pika-assignment-list-[a-f0-9]{12}\/supabase\/migrations\//.test(String(path)))path='/Users/stew/.codex/worktrees/pika/contextual-surveys-current-main/supabase/migrations/'+String(path).split('/').at(-1)
        if(/^\/private\/tmp\/pika-assignment-list-[a-f0-9]{12}\/supabase\/config.toml$/.test(String(path)))return mocks.config
      }
      // Offline transport tests use immutable fixture bytes, but still execute every source-hash guard.
      if (mocks.snapshotSqlReads && typeof path === 'string' && options === 'utf8'
        && /\/supabase\/migrations\/\d{3}_[a-z0-9_]+\.sql$/.test(path)) {
        let source = mocks.sqlFileCache.get(path)
        if (source === undefined) { source = actual.readFileSync(path, 'utf8'); mocks.sqlFileCache.set(path, source) }
        return mocks.sourceDrift && path.endsWith(`/${mocks.driftMigration}`)
          ? `${source}\n-- offline source drift` : source
      }
      return actual.readFileSync(path, options)
    }) as typeof actual.readFileSync,
    writeFileSync:((path,value,options)=>{if(mocks.remaining269&&String(path).startsWith('/private/tmp/pika-test-draft-save-generated-')){if(mocks.syntheticArtifacts.has(String(path)))throw Error('Synthetic artifact exists');mocks.syntheticArtifacts.set(String(path),String(value));return}return actual.writeFileSync(path,value,options)}) as typeof actual.writeFileSync,
    statSync: (path: string) => path === '/private/tmp/pika-test-native-docker.sock' ? { isSocket: () => true, dev: 1, ino: mocks.socketInode, mode: 3, rdev: 4 } : actual.statSync(path) }
})
vi.mock('../../scripts/contextual-test-draft-save-proof-inventory', () => ({ draftSaveProofDockerInventory: mocks.inventory }))
import { buildDraftSaveNativeContractsManifest, createDraftSaveNativeContracts, validateDraftSaveNativeSql, draftSaveNativeTerminationSql,
  buildTestOwnerCreateNativeContractsManifest, validateTestOwnerCreateNativeSql, createTestOwnerCreateNativeContracts,
  validateTestOwnerCreateAllocatorPlan, buildTestOwnerPristineDiscardNativeContractsManifest,
  createTestOwnerPristineDiscardNativeContracts, buildTestOwnerPublicationNativeContractsManifest,
  createTestOwnerPublicationNativeContracts, buildTestOwnerReorderNativeContractsManifest, createTestOwnerReorderNativeContracts,
  buildTestOwnerReorderDiagnosticNativeManifest, createTestOwnerReorderDiagnosticNativeContracts,
  buildTestLearnerNativeContractsManifest, createTestLearnerNativeContracts,
  buildSurveyNativeContractsManifest, createContextualSurveysNativeContracts } from '../../scripts/contextual-test-draft-save-native-contracts'
import {buildSurvey269RemainingManifest,createSurvey269RemainingNativeContracts} from '../../scripts/contextual-test-draft-save-native-contracts'
import * as surveyNative from '../../scripts/contextual-surveys-native-contracts'
import * as surveyPlatform from '../../scripts/contextual-assignment-list-proof-platform'
import * as draftGuards from '../../scripts/check-contextual-test-draft-save-db-contracts'
import {surveyCancellationProofDescriptor} from '../../scripts/contextual-surveys-cancellation-proof'
import {surveyWireProofDescriptor} from '../../scripts/contextual-surveys-wire-proof'
import { SURVEY263_NATIVE_CLI } from '../../scripts/contextual-assignment-list-proof-platform'
import * as surveyCommittedProof from '../../scripts/contextual-surveys-committed-proof'
import { surveyCommittedCpuFixtures, type SurveyCpuGraph } from '../helpers/survey-committed-cpu-fixtures'
import { newTestLearnerWorkflowFixture } from '../../scripts/contextual-test-learner-proof-fixture'
import { contextualTestCreateTestSchema, contextualTestCreateDraftSchema } from '../../src/lib/validations/contextual-test-create'
import { newTestOwnerCreateFixture } from '../../scripts/contextual-test-owner-create-proof-fixture'
import { newTestOwnerPristineDiscardFixture } from '../../scripts/contextual-test-pristine-discard-proof-fixture'
import { newTestOwnerPublicationFixture } from '../../scripts/contextual-test-publication-proof-fixture'
import { newTestOwnerReorderFixture } from '../../scripts/contextual-test-reorder-proof-fixture'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { DRAFT_SAVE_CAPS } from '../../scripts/check-contextual-test-draft-save-db-contracts'
import { assignmentListExpectedResources,assignmentListEphemeralPlan } from '../../scripts/contextual-assignment-list-proof-lifecycle'
import { testOwnerDigest } from '../../scripts/contextual-test-owner-detail-proof-fixture'
import * as publicationContracts from '../../scripts/contextual-test-publication-db-contracts'
import * as publicationRaces from '../../scripts/check-contextual-test-publication-concurrency'

describe('inert native Test draft save contracts', () => {
  const original = newAssignmentListProofFixture()
  const repository = process.cwd()
  const head = '7570a9d60591183f0699001f47a6528045a392ee'
  it('performs no native operation when imported or preparing its finite manifest', () => {
    const manifest = buildDraftSaveNativeContractsManifest(original, head, repository)
    expect(manifest.concurrency.schedules).toHaveLength(DRAFT_SAVE_CAPS.schedules)
    expect(manifest.fixture.allowedFixtureIds).toHaveLength(10017)
    expect(manifest.setup).toContain('commit;')
    expect(manifest.termination).toBe(draftSaveNativeTerminationSql())
    expect(Object.isFrozen(manifest.concurrency.schedules)).toBe(true)
    expect(Object.isFrozen(manifest.concurrency.schedules[0])).toBe(true)
    expect(() => { (manifest.concurrency.schedules[0] as { holderSql: string }).holderSql = 'delete from public.users;' }).toThrow()
    expect(mocks.spawn).not.toHaveBeenCalled(); expect(mocks.execFile).not.toHaveBeenCalled(); expect(mocks.inventory).not.toHaveBeenCalled()
  })
  it('accepts only exact manifest SQL and a lowercase opaque source SHA substitution', () => {
    const manifest = buildDraftSaveNativeContractsManifest(original, head, repository)
    const template = manifest.concurrency.schedules[0].finalTemplate
    expect(validateDraftSaveNativeSql(manifest, template.replace('0'.repeat(64), 'a'.repeat(64)))).toBe(true)
    expect(validateDraftSaveNativeSql(manifest, template.replace('0'.repeat(64), 'A'.repeat(64)))).toBe(false)
    expect(validateDraftSaveNativeSql(manifest, 'delete from public.users;')).toBe(false)
    expect(validateDraftSaveNativeSql(manifest, `${template} select 1;`)).toBe(false)
  })
  it('rejects arbitrary head identities before opening anything', () => {
    expect(() => buildDraftSaveNativeContractsManifest(original, 'main', repository)).toThrow()
    expect(mocks.spawn).not.toHaveBeenCalled()
  })
  it('binds remote termination to captured pid/start, reserved name, database and user', () => {
    const sql = draftSaveNativeTerminationSql()
    expect(sql).toContain("pid=:'owned_pid'::integer")
    expect(sql).toContain("backend_start=:'owned_started'::timestamptz")
    expect(sql).toContain("application_name=:'owned_name'")
    expect(sql).toContain("datname='postgres'"); expect(sql).toContain("usename='postgres'")
    expect(sql).toContain('pg_terminate_backend(pid,5000)')
  })
})

describe('closed migration250 native profile', () => {
  const original = newAssignmentListProofFixture()
  const f = newTestOwnerCreateFixture(original)
  const repository = process.cwd()
  const head = '7570a9d60591183f0699001f47a6528045a392ee'
  // Build each real immutable manifest once; test cases do not weaken SQL admission.
  const manifest = buildTestOwnerCreateNativeContractsManifest(original, f, head, repository)
  const legacyManifest = buildDraftSaveNativeContractsManifest(original, head, repository)
  it('prepares no second durable fixture and selects only the reviewed250 capability', () => {
    expect(manifest.fixture).toEqual(f)
    expect(manifest.setup).not.toMatch(/\b(?:insert|update|delete|commit)\b/i)
    expect(manifest.setup).toContain('Migration250 fixture presence differs')
    expect(manifest.privilege.revoke).toContain('create_test_for_owner_v1(uuid,uuid,text,timestamp with time zone)')
    expect(manifest.privilege.revoke).not.toContain('snapshot_test_draft_save_for_owner_v1')
    expect(manifest.capabilities).toEqual(legacyManifest.capabilities)
    expect(manifest.concurrency.schedules).toHaveLength(9)
    expect(Object.isFrozen(manifest.fixture)).toBe(true)
  })
  it.each([
    ['setup', manifest.setup],
    ['snapshot', manifest.snapshot],
    ['contracts', manifest.contracts.contracts],
    ['catalog and plan', manifest.contracts.catalogAndPlan],
  ])('accepts only literal fixed250 %s SQL', (_name, sql) => {
    expect(validateTestOwnerCreateNativeSql(manifest, sql)).toBe(true)
    expect(validateTestOwnerCreateNativeSql(manifest, `${sql} select 1;`)).toBe(false)
  })
  it.each(manifest.concurrency.schedules.map((schedule, index) => [index + 1, schedule] as const))(
    'accepts only literal fixed250 SQL for concurrency schedule %i', (_index, schedule) => {
      for (const sql of [schedule.holderSql, ...(schedule.holderWitnessSql ?? []), schedule.rejectSql, schedule.observeSql]) {
        expect(validateTestOwnerCreateNativeSql(manifest, sql)).toBe(true)
        expect(validateTestOwnerCreateNativeSql(manifest, `${sql} select 1;`)).toBe(false)
      }
    })
  it('rejects arbitrary SQL, opaque substitution and a caller-selected profile', () => {
    expect(validateTestOwnerCreateNativeSql(manifest, 'delete from public.users;')).toBe(false)
    expect(validateTestOwnerCreateNativeSql(manifest, manifest.privilege.restore)).toBe(false)
    expect(validateTestOwnerCreateNativeSql(manifest, legacyManifest.setup)).toBe(false)
    let rejectedFixture: unknown
    try { buildTestOwnerCreateNativeContractsManifest(original, { ...f, tests: [] }, head, repository) } catch (error) { rejectedFixture = error }
    // Large assertion object diffs are not part of this closed guard's contract.
    expect(rejectedFixture instanceof Error && rejectedFixture.message === 'Test owner-create fixture differs').toBe(true)
    expect(typeof createTestOwnerCreateNativeContracts).toBe('function')
  })
  it('rejects index DDL as a substitute for the actual bounded allocator plan', () => {
    const scan = { 'Node Type': 'Index Only Scan', 'Parent Relationship': 'Outer', 'Parallel Aware': false, 'Async Capable': false,
      'Scan Direction': 'Forward', 'Index Name': 'idx_tests_classroom_position_owner_create', 'Relation Name': 'tests', Alias: 'test',
      'Index Cond': `(classroom_id = '${f.classes[3].id}'::uuid)` }
    const catalog = { function: 'a'.repeat(32), index: 'CREATE INDEX idx_tests_classroom_position_owner_create ON public.tests USING btree (classroom_id, position DESC, id DESC)',
      test_columns: Object.keys(contextualTestCreateTestSchema.shape), draft_columns: Object.keys(contextualTestCreateDraftSchema.shape),
      plan: [{ Plan: { 'Node Type': 'Limit', 'Parallel Aware': false, 'Async Capable': false, Plans: [scan] } }] }
    expect(validateTestOwnerCreateAllocatorPlan(catalog, f)).toBe(true)
    expect(validateTestOwnerCreateAllocatorPlan({ ...catalog, plan: [{ Plan: { ...catalog.plan[0].Plan, Plans: [{ ...scan, 'Node Type': 'Index Scan' }] } }] }, f)).toBe(true)
    for (const bad of [null, { ...catalog, plan: [] }, { ...catalog, plan: [{ Plan: { 'Node Type': 'Seq Scan', 'Relation Name': 'tests' } }] },
      { ...catalog, plan: [{ Plan: { ...catalog.plan[0].Plan, Plans: [{ ...scan, 'Index Name': 'different_index' }] } }] },
      { ...catalog, plan: [{ Plan: { ...catalog.plan[0].Plan, Plans: [{ ...scan, 'Index Cond': `(classroom_id = '${f.classes[0].id}'::uuid)` }] } }] },
      { ...catalog, plan: [{ Plan: { ...catalog.plan[0].Plan, Plans: [{ ...scan, 'Scan Direction': 'Backward' }] } }] },
      { ...catalog, plan: [{ Plan: { ...catalog.plan[0].Plan, Plans: [scan, scan] } }] },
      { ...catalog, plan: [{ Plan: { ...catalog.plan[0].Plan, Plans: [{ ...scan, Filter: 'true' }] } }] },
      { ...catalog, test_columns: catalog.test_columns.slice(1) }, { ...catalog, unrelated: true }])
      expect(() => validateTestOwnerCreateAllocatorPlan(bad, f)).toThrow()
  })
})

describe('native persistent-session transport with offline child mocks', () => {
  const original = newAssignmentListProofFixture()
  const head = '7570a9d60591183f0699001f47a6528045a392ee'
  const repository = process.cwd()
  const manifest = buildDraftSaveNativeContractsManifest(original, head, repository)
  const project = manifest.fixture.projectId
  const resources = assignmentListExpectedResources(project).map((r, index) => ({ ...r, id: (index + 1).toString(16).padStart(64, '0'), createdAt: '2026-10-05T00:00:00Z',
    labels: { 'com.supabase.cli.project': project, 'com.docker.compose.project': project }, attachedIds: [], ports: r.name.startsWith('supabase_db_') && r.kind === 'container' ? [54332] : [] }))
  const children: Array<EventEmitter & { stdin: Writable; stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> }> = []
  const terminations: string[][] = []
  const sqlControls: Array<{ args: string[]; sql: string }> = []
  let hangingSetup = false; let failContender = false; let terminationConfirmed = true
  let setupExit = false; let malformedSetup = false; let stderrChunks: string[] = []
  let createManifest: ReturnType<typeof buildTestOwnerCreateNativeContractsManifest> | undefined
  let discardManifest: ReturnType<typeof buildTestOwnerPristineDiscardNativeContractsManifest> | undefined
  let publicationManifest: ReturnType<typeof buildTestOwnerPublicationNativeContractsManifest> | undefined
  let reorderManifest: ReturnType<typeof buildTestOwnerReorderNativeContractsManifest> | undefined
  let learnerManifest: ReturnType<typeof buildTestLearnerNativeContractsManifest> | undefined
  let surveyManifest: ReturnType<typeof buildSurveyNativeContractsManifest> | undefined
  let surveySeedFault: 'malformed-graph' | 'missing-marker' | 'foreign-backend' = 'malformed-graph'
  const surveyWrites: Array<{ name: string; sql: string; marker: string }> = []
  let surveyPositive: 'normal' | 'early-contender' | 'foreign-marker' | undefined
  let surveyGraph: SurveyCpuGraph | undefined, surveySeedStamp = ''
  const surveyEvents: string[] = []
  const surveyBackends = new Map<string, { pid: number; started: string; name: string; database: 'postgres'; user: 'postgres' }>()
  type SurveySchedule = ReturnType<typeof surveyCommittedProof.surveyCommittedProofManifest>['schedules'][number]
  let surveyDirection: { schedule: SurveySchedule; before: SurveyCpuGraph; holderAt: string; contenderAt?: string; retryAt?: string;
    archiveAt?: string; archiveEndedAt?: string;
    held?: Record<string, unknown> } | undefined
  let pendingSurveyContender: (() => void) | undefined
  let surveyLateFrame: 'observer' | 'terminal' | undefined, surveyWorkDeadline = 0
  let surveyUnjoinedHolder = false
  let surveyOriginalBase:SurveyCpuGraph|undefined,surveySnapshot:(()=>SurveyCpuGraph)|undefined
  let remainingManifest:ReturnType<typeof buildSurvey269RemainingManifest>|undefined
  let remainingProbeFrameFault:'prepare-close'|'observer-close'|'observer-timeout'|'contract-timeout'|'contract-cutoff'|undefined
  let waitTiming:'wait-release'|'wait-observer-late'|'wait-pre-expired'|'wait-post-expired'|'wait-outer-cutoff'|'wait-statement-timeout'|undefined
  let waitStarted=0,waitGuardDelayed=false,waitReleased=false,waitTimer:ReturnType<typeof setTimeout>|undefined
  const scenario24Modes=['scenario24-750','scenario24-751','scenario24-receipt','scenario24-settled','scenario24-backend','scenario24-blocker','scenario24-waiter','scenario24-operation','scenario24-source','scenario24-timestamps','scenario24-invalid-clock','scenario24-overflow-clock'] as const
  let scenario24:typeof scenario24Modes[number]|undefined,scenario24Dispatched=0,scenario24GuardDelayed=false
  function surveyAfter() {
    const state = surveyDirection!, s = state.schedule
    // Select the actual closed legacy-writer frame, independently of the
    // production runner's index-based writer selection.
    const legacy = (sql: string) => sql.includes('update public.') || sql.includes('delete from public.classroom_enrollments')
    const writerAt = legacy(s.frames.holder) ? state.holderAt : legacy(s.frames.contender) ? state.retryAt ?? state.contenderAt ?? state.holderAt
      : s.index === 14 ? state.retryAt ?? state.contenderAt ?? state.holderAt : state.holderAt
    const stamp = Date.parse(writerAt)
    const helpers = surveyCommittedCpuFixtures(surveyManifest!.fixture, { seedStamp: surveySeedStamp,
      writeStamp: state.holderAt, changeStamp: writerAt, archiveStamp: state.archiveAt ?? new Date(stamp + 1).toISOString(),
      archiveOperationEnd: state.archiveEndedAt ?? new Date(stamp + 2).toISOString(), endStamp: new Date(Date.now()).toISOString() })
    const changed = helpers.changedCase(s, state.before)
    return { ...changed, receipts: helpers.envelopes(s, state.before, changed.after) }
  }
  let cancellationInstalled = false
  let cancellationRestoreOutput = 'ok'
  let cancellationCatalogChanged = false
  let bulkChunks: string[] = []; let bulkHang = false; let bulkExit = false; let emitCalibration = true
  let bulkDispatched: (() => void) | undefined
  let contaminateOtherFrames = false; let duplicateCalibration = false
  let diagnosticManifest: ReturnType<typeof buildTestOwnerReorderDiagnosticNativeManifest> | undefined
  let diagnosticChunks: string[] = []; let diagnosticNoise = ''; let diagnosticHang = false; let diagnosticExit = false
  let diagnosticMarkerFirst = false; let diagnosticContamination = false; let diagnosticDispatched: (() => void) | undefined
  const publicationSql = (sql: string, key: 'catalog' | 'revoke' | 'restore') => publicationManifest
    && Object.values(publicationManifest.publicationPrivileges).some(capability => sql === capability[key])
  let serviceExecute = true; let fixtureChanged = false; let catalogChanged = false; let restorationFails = false; let publicGrant = false
  const catalog = () => ({ owner: 'postgres', definition: catalogChanged ? 'changed function' : 'reviewed function',
    acl: [{ grantor: 'postgres', grantee: 'postgres', privilege_type: 'EXECUTE', is_grantable: false },
      ...(serviceExecute ? [{ grantor: 'postgres', grantee: 'service_role', privilege_type: 'EXECUTE', is_grantable: false }] : []),
      ...(publicGrant ? [{ grantor: 'postgres', grantee: 'PUBLIC', privilege_type: 'EXECUTE', is_grantable: false }] : [])] })
  const factory = (restorationAdmission?: () => Promise<void>) => createDraftSaveNativeContracts({ repository, reviewedHead: head, original, capturedResources: resources, restorationAdmission,
    containerId: resources.find(r => r.name === `supabase_db_${project}`)!.id, acceptedManifestSha256: testOwnerDigest(JSON.stringify(manifest)) })
  const createFactory = () => {
    createManifest = buildTestOwnerCreateNativeContractsManifest(original, newTestOwnerCreateFixture(original), head, repository)
    return createTestOwnerCreateNativeContracts({ repository, reviewedHead: head, original, fixture: createManifest.fixture,
      capturedResources: resources, containerId: resources.find(r => r.name === `supabase_db_${project}`)!.id,
      acceptedManifestSha256: testOwnerDigest(JSON.stringify(createManifest)) })
  }
  const discardFactory = () => {
    discardManifest = buildTestOwnerPristineDiscardNativeContractsManifest(original, newTestOwnerPristineDiscardFixture(original), head, repository)
    return createTestOwnerPristineDiscardNativeContracts({ repository, reviewedHead: head, original, fixture: discardManifest.fixture,
      capturedResources: resources, containerId: resources.find(r => r.name === `supabase_db_${project}`)!.id,
      acceptedManifestSha256: testOwnerDigest(JSON.stringify(discardManifest)) })
  }
  const publicationFactory = (absoluteDeadline = Date.now() + 900000) => {
    publicationManifest = buildTestOwnerPublicationNativeContractsManifest(original, newTestOwnerPublicationFixture(original), head, repository)
    return createTestOwnerPublicationNativeContracts({ repository, reviewedHead: head, original, fixture: publicationManifest.fixture,
      capturedResources: resources, containerId: resources.find(r => r.name === `supabase_db_${project}`)!.id,
      acceptedManifestSha256: testOwnerDigest(JSON.stringify(publicationManifest)), absoluteDeadline })
  }
  const reorderFactory = () => {
    reorderManifest = buildTestOwnerReorderNativeContractsManifest(original, newTestOwnerReorderFixture(original), head, repository)
    return createTestOwnerReorderNativeContracts({ repository, reviewedHead: head, original, fixture: reorderManifest.fixture,
      capturedResources: resources, containerId: resources.find(r => r.name === `supabase_db_${project}`)!.id,
      acceptedManifestSha256: testOwnerDigest(JSON.stringify(reorderManifest)), absoluteDeadline: Date.now() + 900000 })
  }
  const learnerFactory = () => {
    const fixture = newTestLearnerWorkflowFixture(original)
    const observed = Object.freeze([1,2].map(index => Object.freeze({ actorId: fixture.actors[index].id, attemptId: randomUUID(), revision: 2 })))
    learnerManifest = buildTestLearnerNativeContractsManifest(original, observed, head, learnerOffline.repository)
    return createTestLearnerNativeContracts({ repository: learnerOffline.repository, reviewedHead: head, original, observedAttempts: observed,
      capturedResources: resources, containerId: resources.find(r => r.name === `supabase_db_${project}`)!.id,
      acceptedManifestSha256: testOwnerDigest(JSON.stringify(learnerManifest)), absoluteDeadline: Date.now() + 900000 })
  }
  const diagnosticFactory = () => {
    // Presence/bootstrap/snapshot SQL is shared with the ordinary reorder
    // profile, while only the two diagnostic frame replies are new here.
    reorderManifest = buildTestOwnerReorderNativeContractsManifest(original, newTestOwnerReorderFixture(original), head, repository)
    diagnosticManifest = buildTestOwnerReorderDiagnosticNativeManifest(original, reorderManifest.fixture, head, repository)
    return createTestOwnerReorderDiagnosticNativeContracts({ repository, reviewedHead: head, original, fixture: reorderManifest.fixture,
      capturedResources: resources, containerId: resources.find(r => r.name === `supabase_db_${project}`)!.id,
      acceptedManifestSha256: testOwnerDigest(JSON.stringify(diagnosticManifest)), absoluteDeadline: Date.now() + 900000 })
  }
  beforeEach(() => {
    mocks.snapshotSqlReads = true; mocks.sourceDrift = false; mocks.sqlFileCache.clear();mocks.remaining269=false;mocks.syntheticArtifacts.clear();mocks.generatedSource='';mocks.config=''
    vi.clearAllMocks(); children.length = 0; terminations.length = 0; sqlControls.length = 0; hangingSetup = false; failContender = false; terminationConfirmed = true
    serviceExecute = true; fixtureChanged = false; catalogChanged = false; restorationFails = false; publicGrant = false
    setupExit = false; malformedSetup = false; stderrChunks = []; createManifest = undefined; discardManifest = undefined; publicationManifest = undefined
    reorderManifest = undefined; bulkChunks = []; bulkHang = false; bulkExit = false; emitCalibration = true
    learnerManifest = undefined; cancellationInstalled = false
    surveyManifest = undefined; surveyWrites.length = 0; surveySeedFault = 'malformed-graph'
    surveyPositive = undefined; surveyGraph = undefined; surveySeedStamp = ''; surveyEvents.length = 0
    surveyBackends.clear(); surveyDirection = undefined; pendingSurveyContender = undefined
    surveyLateFrame = undefined; surveyWorkDeadline = 0; surveyUnjoinedHolder = false
    surveyOriginalBase=undefined;surveySnapshot=undefined;remainingManifest=undefined;remainingProbeFrameFault=undefined
    waitTiming=undefined;waitStarted=0;waitGuardDelayed=false;waitReleased=false;waitTimer=undefined
    scenario24=undefined;scenario24Dispatched=0;scenario24GuardDelayed=false
    cancellationRestoreOutput = 'ok'
    cancellationCatalogChanged = false
    bulkDispatched = undefined
    contaminateOtherFrames = false; duplicateCalibration = false
    diagnosticManifest = undefined; diagnosticChunks = []; diagnosticNoise = ''; diagnosticHang = false; diagnosticExit = false
    diagnosticMarkerFirst = false; diagnosticContamination = false; diagnosticDispatched = undefined
    mocks.inventory.mockResolvedValue(resources)
    mocks.execFile.mockImplementation((file: string, args: string[], _options: unknown, rawCallback: (error: unknown, stdout: string,stderr?:string) => void) => {
      const callback=(error:unknown,stdout:string)=>rawCallback(error,stdout,'')
      const child = new EventEmitter() as EventEmitter & { stdin: Writable; kill: ReturnType<typeof vi.fn> }
      let input = ''
      child.kill = vi.fn(() => true)
      child.stdin = new Writable({ write(chunk, _encoding, done) { input += String(chunk); done() }, final(done) {
        sqlControls.push({ args: [...args], sql: input })
        const deliver=() => {
          if(remainingManifest&&[remainingManifest.cancellation.frames.restoreBeforeDispatch,remainingManifest.cancellation.frames.restoreAfterDispatch,remainingManifest.wire.frames.restore].includes(input)){
            const expected=[...input.matchAll(/current_setting\('application_name'\)<>'([^']+)'/g)]
            const actual=args.find(a=>a.startsWith('PGAPPNAME='))?.slice(10)
            expect(expected).toHaveLength(1);expect(expected[0][1]).toBe(actual)
          }
          if(mocks.remaining269&&file===SURVEY263_NATIVE_CLI.path)callback(null,mocks.generatedSource)
          else if (file === 'git') callback(null,mocks.remaining269&&args.includes('HEAD')?(args.includes('--show-toplevel')?`${head}\n${surveyNative.SURVEY_269_COMPONENT_ROOTS.product}\n`:args.includes('HEAD^{tree}')?`${head}\n${head}\n`:head):args[1] === '--show-toplevel' ? (_options as { cwd: string }).cwd : args[0] === 'rev-parse' ? head : '')
          else if (args[0] === 'context') callback(null, JSON.stringify({ endpoints: { docker: { Host: 'unix:///private/tmp/pika-test-native-docker.sock', SkipTLSVerify: false } }, tlsMaterial: null }))
          else if (input === manifest.termination) { terminations.push(args); callback(null, JSON.stringify({ present: true, terminated: terminationConfirmed })) }
          else if(remainingManifest&&input===remainingManifest.cancellation.frames.restoreAfterDispatch)callback(null,JSON.stringify({stage:'restored',descriptorSha256:remainingManifest.cancellation.descriptorSha256,stateSha256:'a'.repeat(64),catalogSha256:'b'.repeat(64),backendObserved:true,nativeVerified:false}))
          else if(remainingManifest&&input===remainingManifest.wire.frames.restore){
            const cid=remainingManifest.fixture.classes[1].id
            const cl=surveyGraph!['public.classrooms'].find(r=>r.id===cid)!,ar=surveyGraph!['public.classroom_archive_revisions'].find(r=>r.classroom_id===cid)!
            cl.blueprint_source_revision=Number(cl.blueprint_source_revision)+2;ar.revision=Number(ar.revision)+4;cl.updated_at=ar.updated_at=new Date().toISOString()
            callback(null,JSON.stringify({stage:'wire-restored',descriptorSha256:remainingManifest.wire.descriptorSha256,stateSha256:'a'.repeat(64),archiveRevisionDelta:4,blueprintRevisionDelta:2,nativeVerified:false}))
          }
          else if (input === learnerManifest?.cancellation.restore) {
            if (restorationFails) callback(Error('private cancellation restore failure'), '')
            // The actual fixed restoration SQL includes its full guard, which
            // emits one plain-text acknowledgement before the quiet COMMIT.
            else { cancellationInstalled = false; callback(null, cancellationRestoreOutput) }
          }
          else if (input === learnerManifest?.cancellation.catalog) callback(null, JSON.stringify({ function: cancellationInstalled || cancellationCatalogChanged ? 'unexpected' : null, triggers: [] }))
          else if (input === manifest.privilege.restore || input === createManifest?.privilege.restore
            || input === discardManifest?.privilege.restore || input === discardManifest?.innerPrivilege.restore || input === reorderManifest?.privilege.restore || input === learnerManifest?.privilege.restore || publicationSql(input, 'restore')) {
            if (restorationFails) callback(Error('private grant restore failure'), '')
            else { serviceExecute = true; callback(null, '') }
          }
          else if (input === manifest.privilege.catalog || input === createManifest?.privilege.catalog
            || input === discardManifest?.privilege.catalog || input === discardManifest?.innerPrivilege.catalog || input === reorderManifest?.privilege.catalog || input === learnerManifest?.privilege.catalog || publicationSql(input, 'catalog')) callback(null, JSON.stringify(catalog()))
          else if (input === manifest.snapshot || input === createManifest?.snapshot || input === discardManifest?.snapshot || input === publicationManifest?.snapshot || input === reorderManifest?.snapshot || input === learnerManifest?.snapshot) callback(null, JSON.stringify({ wholeRows: fixtureChanged ? 'changed' : 'unchanged' }))
          else callback(null, 'ok')
          if (surveyManifest) child.emit('close', 0)
        }
        if(waitTiming&&waitTiming!=='wait-pre-expired'&&waitTiming!=='wait-observer-late'&&waitStarted&&surveyEvents.includes('observer:owner_replacement_after_snapshot:forward')&&!waitGuardDelayed&&input===surveyManifest?.guard){
          waitGuardDelayed=true;surveyEvents.push('wait-release-guard')
          setTimeout(deliver,waitTiming==='wait-post-expired'?7301:waitTiming==='wait-statement-timeout'?7400:400)
        }else if(scenario24&&scenario24Dispatched&&!scenario24GuardDelayed&&input===surveyManifest?.guard){
          // Delay the actual mandatory observer ownership child, not the SQL
          // witness clock: dispatch→observation must include this guard time.
          scenario24GuardDelayed=true;surveyEvents.push('scenario24-observer-guard')
          const elapsed=scenario24==='scenario24-751'?751:scenario24==='scenario24-750'?750:500
          setTimeout(deliver,elapsed-(Date.now()-scenario24Dispatched))
        }else queueMicrotask(deliver)
        done()
      } })
      return child
    })
    mocks.spawn.mockImplementation((_file: string, args: string[]) => {
      const child = new EventEmitter() as typeof children[number]
      const name = args.find(arg => arg.startsWith('PGAPPNAME='))!.slice('PGAPPNAME='.length)
      const pid = children.length + 1000
      child.stdout = new PassThrough(); child.stderr = new PassThrough()
      child.kill = vi.fn(() => {
        if (!(surveyUnjoinedHolder && name === `${project}_draft_holder`)) queueMicrotask(() => child.emit('close', 0))
        return true
      })
      child.stdin = new Writable({ write(chunk, _encoding, done) {
        const text = String(chunk); const end = text.match(/\\echo (__draft_save_end_[0-9]+__)/)![1]
        const sql = text.slice(0, text.indexOf('\n\\echo'))
        if (surveyManifest) surveyWrites.push({ name, sql, marker: end })
        if(remainingManifest&&[remainingManifest.cancellation.frames.prepare,remainingManifest.cancellation.frames.observer,remainingManifest.wire.frames.prepare].includes(sql)){
          const expected=[...sql.matchAll(/current_setting\('application_name'\)<>'([^']+)'/g)]
          if(expected.length!==1||expected[0][1]!==name){queueMicrotask(()=>child.emit('close',1));done();return}
          if(sql===remainingManifest.cancellation.frames.prepare&&remainingProbeFrameFault==='prepare-close'||sql===remainingManifest.cancellation.frames.observer&&(remainingProbeFrameFault==='observer-close'||remainingProbeFrameFault==='observer-timeout')){
            surveyEvents.push(sql===remainingManifest.cancellation.frames.prepare?'cancel-prepare':'cancel-observer')
            if(remainingProbeFrameFault!=='observer-timeout')queueMicrotask(()=>child.emit('close',1))
            done();return
          }
        }
        let response = ''
        if (diagnosticManifest && diagnosticContamination && sql !== diagnosticManifest.contracts.frames[1].sql)
          child.stderr.write('INFO: PDT01 1\nINFO: PDT02 2\nINFO: PDT03 3 private contamination\n')
        if (sql === manifest.bootstrap) {
          if (contaminateOtherFrames) child.stderr.write('INFO: PRG00\nINFO: PRG01\nINFO: PRG02\n')
          const owned = { pid, started: '2026-10-05T00:00:00+00:00',
            name: surveyManifest && surveySeedFault === 'foreign-backend' && name.endsWith('_draft_holder') ? 'foreign-backend' : name,
            database: 'postgres' as const, user: 'postgres' as const }
          surveyBackends.set(name, owned); response = JSON.stringify(owned)
        }
        else if(surveyManifest&&sql===surveyManifest.snapshot&&surveySnapshot){
          const rows=[...Object.entries(surveySnapshot()).map(([table,rows])=>JSON.stringify({table,rows})),JSON.stringify({metadata:{}}),JSON.stringify({cron:[]})]
          queueMicrotask(()=>child.stdout.write(rows.join('\n')+'\n'+end+'\n'));done();return
        }
        else if (remainingManifest && sql.trim() === remainingManifest.contracts.sql.trim()) {
          if(remainingProbeFrameFault==='contract-timeout'||remainingProbeFrameFault==='contract-cutoff'){
            queueMicrotask(()=>{for(let n=1;n<=171;n++)child.stderr.write(`INFO:  PS${String(n).padStart(3,'0')}\n`);surveyEvents.push('contract-hanging')})
            done();return
          }
          queueMicrotask(() => {
            for(let n=1;n<=211;n++) child.stderr.write(`INFO:  PS${String(n).padStart(3,'0')}\n`)
            child.stdout.write(end+'\n')
          }); done(); return
        }
        else if (surveyManifest && 'committed' in surveyManifest && surveyPositive) {
          const m = surveyManifest.committed, now = new Date().toISOString()
          const emit = (value: unknown, marker = end) => queueMicrotask(() => child.stdout.write(`${value === undefined ? '' : JSON.stringify(value) + '\n'}${marker}\n`))
          if (sql === m.seed) {
            surveySeedStamp = now
            const helpers = surveyCommittedCpuFixtures(surveyManifest.fixture, { seedStamp: now })
            surveyGraph = helpers.capturedSeed(m)
            const before=helpers.seedBefore(surveyGraph)
            if(surveyOriginalBase)for(const [key,rows]of Object.entries(surveyOriginalBase)){surveyGraph[key]??=[];before[key]??=[];surveyGraph[key].push(...structuredClone(rows));before[key].push(...structuredClone(rows))}
            emit({ before, after: surveyGraph, seedTimestamp: now }); done(); return
          }
          if(remainingManifest&&sql===remainingManifest.cancellation.frames.prepare){surveyEvents.push('cancel-prepare');emit({stage:'prepared',descriptorSha256:remainingManifest.cancellation.descriptorSha256,nativeVerified:false});done();return}
          if(remainingManifest&&sql===remainingManifest.cancellation.frames.observer){surveyEvents.push('cancel-observer');emit({stage:'pending',descriptorSha256:remainingManifest.cancellation.descriptorSha256,nativeVerified:false,
            backend:{pid:9999,started:new Date(Date.now()-1).toISOString(),database:'postgres',sessionUser:'authenticator',name:remainingManifest.cancellation.binding.marker,state:'active',waitType:'Timeout',waitEvent:'PgSleep',transactionStartedAt:now,queryStartedAt:now,observedAt:now,poll:1}});done();return}
          if(remainingManifest&&sql===remainingManifest.wire.frames.prepare){surveyEvents.push('wire-prepare');emit({stage:'wire-prepared',descriptorSha256:remainingManifest.wire.descriptorSha256,innerBytes:8388608,minimumWireBytes:8388609,sqlWireBytes:8388700,nativeVerified:false});done();return}
          const current = surveyDirection?.schedule
          const s = current && (sql === current.frames.release || sql === current.frames.settle) ? current
            : m.schedules.find(s => sql === s.frames.holder || sql === s.frames.contender || sql === s.frames.retry || sql === s.frames.terminal)
          if (s && sql === s.frames.holder) {
            surveyDirection = { schedule: s, before: structuredClone(surveyGraph!), holderAt: now }
            const first = surveyAfter(), bootstrap = surveyBackends.get(name)!, started = Date.now()
            const heldWitness = { criterion: 'original-operation-and-owned-backend', backend: bootstrap,
              transactionStartedAt: now, sourceSha256: s.firstOperationSha256,
              operationStartedAt: new Date(started + 1).toISOString(), operationFinishedAt: new Date(started + 2).toISOString(), operation: first.receipts.holder }
            const responseRow = first.after['public.survey_responses'].filter(r => r.survey_id === s.cohort.surveyId && r.student_id === m.actors[1].id)
            const value = { label: s.label, writerTimestamp: now, heldWitness, operation: first.receipts.holder,
              responses: responseRow, ...(s.index === 3 && sql.includes('archived_at=clock_timestamp()') ? { archiveReceipt: first.times.archiveReceipt } : {}) }
            surveyDirection.held = value
            surveyEvents.push(`holder:${s.label}`); vi.setSystemTime(started + 3); emit(value); done(); return
          }
          if (s && sql === s.frames.contender) {
            if(waitTiming&&s.index===2&&s.direction==='forward')waitStarted=Date.now()
            if(scenario24&&s.index===11&&s.direction==='reverse')scenario24Dispatched=Date.now()
            surveyDirection!.contenderAt = now
            const result = surveyAfter()
            const value = { label: s.label, operation: result.receipts.contender, writerTimestamp: now,
              ...(s.index === 3 && sql.includes('archived_at=clock_timestamp()') ? { archiveReceipt: result.times.archiveReceipt } : {}) }
            surveyEvents.push(`contender:${s.label}`); vi.setSystemTime(Date.now() + 3)
            if(waitTiming&&s.index===2&&s.direction==='forward'){
              const lock=Number(sql.match(/set local lock_timeout='(\d+)s'/)![1])*1000
              const delayed=waitTiming==='wait-pre-expired'||waitTiming==='wait-post-expired'
              waitTimer=setTimeout(()=>{if(waitReleased)return;surveyEvents.push('wait-backend-timeout');if(!child.stderr.destroyed)child.stderr.write(`ERROR:  ${lock<8000?'55P03':'57014'}\n`);child.emit('close',1)},(delayed?9000:Math.min(lock,8000))-(Date.now()-waitStarted))
            }
            const finish = () => {
              // A blocked archive's wall-clock write occurs after release;
              // transaction_timestamp still belongs to its original dispatch.
              if (s.index === 3 && sql.includes('archived_at=clock_timestamp()')) {
                surveyDirection!.archiveAt = new Date(Date.now() + 1).toISOString()
                surveyDirection!.archiveEndedAt = new Date(Date.now() + 2).toISOString()
                vi.setSystemTime(Date.now() + 3)
              }
              surveyEvents.push(`contender-settled:${s.label}`)
              emit(s.index === 3 && sql.includes('archived_at=clock_timestamp()')
                ? { ...value, archiveReceipt: surveyAfter().times.archiveReceipt } : value)
            }
            if (s.mode === 'wait' && surveyPositive !== 'early-contender') pendingSurveyContender = finish
            else finish()
            done(); return
          }
          if (s && sql === s.frames.release) {
            if(waitTiming&&s.index===2&&s.direction==='forward'){waitReleased=true;clearTimeout(waitTimer);surveyEvents.push('wait-release-written')}
            surveyEvents.push(`release:${s.label}`); emit(undefined)
            pendingSurveyContender?.(); pendingSurveyContender = undefined; done(); return
          }
          if (s && sql === s.frames.settle) { surveyEvents.push(`settle:${s.label}`); emit(undefined); done(); return }
          if (s && sql === s.frames.retry) {
            surveyDirection!.retryAt = now
            const result = surveyAfter()
            surveyEvents.push(`retry:${s.label}`); vi.setSystemTime(Date.now() + 3)
            emit({ label: s.label, operation: result.receipts.retry, writerTimestamp: now,
              ...(s.index === 3 && sql.includes('archived_at=clock_timestamp()') ? { archiveReceipt: result.times.archiveReceipt } : {}) })
            done(); return
          }
          if (s && sql === s.frames.terminal) {
            if (surveyLateFrame === 'terminal') vi.setSystemTime(surveyWorkDeadline)
            const result = surveyAfter(); surveyGraph = result.after
            surveyEvents.push(`terminal:${s.label}`)
            vi.setSystemTime(Date.now() + 3)
            emit({ label: s.label, graph: result.after, cached_questions: result.receipts.cachedQuestions,
              fresh_read: result.receipts.freshRead, cached_response_probe: result.receipts.cachedResponseProbe }); done(); return
          }
          if (surveyDirection && pendingSurveyContender) {
            const pair = { holder: surveyBackends.get(`${project}_draft_holder`)!, contender: surveyBackends.get(`${project}_draft_contender`)! }
            const direction = surveyDirection.schedule
            if (sql === surveyCommittedProof.surveyCommittedObservationSql(m, direction.label, pair)) {
              if(scenario24&&direction.index===11&&direction.direction==='reverse'){
                surveyEvents.push(`observer:${direction.label}`)
                const held=structuredClone(surveyDirection.held!.heldWitness) as Record<string,unknown>
                const observation:Record<string,unknown>={label:direction.label,observedAt:now,poll:1,holder:pair.holder,contender:pair.contender,held,blockers:[pair.holder.pid],waiter:{wait_event_type:'Lock',wait_event:'transactionid',state:'active'}}
                if(scenario24==='scenario24-settled'){pendingSurveyContender!();pendingSurveyContender=undefined}
                if(scenario24==='scenario24-backend')observation.holder={...pair.holder,name:'private-payload-must-not-escape'}
                if(scenario24==='scenario24-blocker')observation.blockers=[9999]
                if(scenario24==='scenario24-waiter')observation.waiter={wait_event_type:'Lock',wait_event:'advisory',state:'active'}
                if(scenario24==='scenario24-operation')held.operation={code:null,result:{private:'private-payload-must-not-escape'}}
                if(scenario24==='scenario24-source')held.sourceSha256='private-payload-must-not-escape'
                if(scenario24==='scenario24-timestamps')held.operationFinishedAt=new Date(Date.now()+1).toISOString()
                if(scenario24==='scenario24-invalid-clock')observation.observedAt='private-payload-must-not-escape'
                if(scenario24==='scenario24-overflow-clock')observation.observedAt=new Date(Date.now()+900000).toISOString()
                emit(scenario24==='scenario24-receipt'?['private-payload-must-not-escape']:observation);done();return
              }
              if(waitTiming&&direction.index===2&&direction.direction==='forward'){
                const delay=waitTiming==='wait-observer-late'?751:700
                setTimeout(()=>{
                  surveyEvents.push(`observer:${direction.label}`)
                  const observation={label:direction.label,observedAt:new Date().toISOString(),poll:1,holder:pair.holder,contender:pair.contender,held:surveyDirection!.held!.heldWitness,blockers:[pair.holder.pid],waiter:{wait_event_type:'Lock',wait_event:'transactionid',state:'active'}}
                  if(waitTiming==='wait-pre-expired')setTimeout(()=>emit(observation),7300)
                  else emit(observation)
                },delay-(Date.now()-waitStarted));done();return
              }
              surveyEvents.push(`observer:${direction.label}`)
              if (surveyLateFrame === 'observer') vi.setSystemTime(surveyWorkDeadline)
              emit({ label: direction.label, observedAt: surveyLateFrame === 'observer' ? new Date().toISOString() : now, poll: 1, holder: pair.holder, contender: pair.contender,
                held: surveyDirection.held!.heldWitness, blockers: [pair.holder.pid],
                waiter: { wait_event_type: 'Lock', wait_event: direction.lock.kind === 'advisory' ? 'advisory' : 'transactionid', state: 'active' } },
              surveyPositive === 'foreign-marker' ? `__draft_save_end_foreign__\n${end}` : end)
              done(); return
            }
          }
          // Source-fixed bootstrap/rollback/setup/contract frames have no JSON.
          emit(undefined); done(); return
        }
        else if (surveyManifest && 'committed' in surveyManifest && sql === surveyManifest.committed.seed) {
          response = JSON.stringify({ before: {}, after: {}, seedTimestamp: new Date().toISOString() })
          if (surveySeedFault === 'missing-marker') {
            queueMicrotask(() => { child.stdout.write(`${response}\n`); child.emit('close', 1) }); done(); return
          }
        }
        else if (sql === manifest.setup && hangingSetup) { done(); return }
        else if ((sql === manifest.setup || sql === createManifest?.setup || sql === discardManifest?.setup || sql === publicationManifest?.setup || sql === reorderManifest?.setup) && setupExit) {
          for (const chunk of stderrChunks) child.stderr.write(chunk)
          queueMicrotask(() => child.emit('close', 1)); done(); return
        }
        else if (sql === manifest.setup && malformedSetup) response = 'PRIVATE malformed row'
        else if (sql === manifest.concurrency.observe) response = JSON.stringify({ held:true,transaction:true })
        else if (sql === manifest.snapshot || sql === createManifest?.snapshot || sql === discardManifest?.snapshot || sql === publicationManifest?.snapshot || sql === reorderManifest?.snapshot || sql === learnerManifest?.snapshot) response = JSON.stringify({ wholeRows: fixtureChanged ? 'changed' : 'unchanged' })
        else if (sql === learnerManifest?.cancellation.catalog) response = JSON.stringify({ function: null, triggers: [] })
        else if (sql === learnerManifest?.cancellation.install) cancellationInstalled = true
        else if (sql === learnerManifest?.cancellation.installed) response = JSON.stringify({ installed: true })
        else if (sql === diagnosticManifest?.contracts.frames[0].sql) response = JSON.stringify({ kind: diagnosticManifest.kind,
          plan: [{ Plan: { 'Node Type': 'ModifyTable', 'Relation Name': 'PRIVATE synthetic relation', Plans: [{ 'Node Type': 'Function Scan' }] } }] })
        else if (sql === diagnosticManifest?.contracts.frames[1].sql) {
          response = JSON.stringify({ kind: diagnosticManifest.kind, outcome: 'returned', sqlstate: 'none', rolledBack: true,
            checks: ['bulk-1000', 'final-fixture-equality'] })
          if (diagnosticMarkerFirst) {
            queueMicrotask(() => {
              child.stdout.write(`${response}\n${end}\n`)
              for (const chunk of diagnosticChunks) child.stderr.write(chunk)
            }); done(); return
          }
          for (const chunk of diagnosticChunks) child.stderr.write(chunk)
          if (diagnosticNoise) child.stderr.write(diagnosticNoise)
          diagnosticDispatched?.()
          if (diagnosticHang || diagnosticExit) { if (diagnosticExit) queueMicrotask(() => child.emit('close', 1)); done(); return }
        }
        else if (reorderManifest?.contracts.contracts.some(batch => batch.sql === sql)) {
          const batch = reorderManifest.contracts.contracts.find(batch => batch.sql === sql)!
          if (batch.expectedResult.checks.includes('deadline-reached') && emitCalibration) {
            child.stderr.write('psql:<stdin>:123: INFO:  PRG00\n')
            if (duplicateCalibration) child.stderr.write('INFO: PRG00\n')
          }
          else if (contaminateOtherFrames && batch.name !== 'bulk-1000') child.stderr.write('INFO: PRG00\nINFO: PRG01\nINFO: PRG02\n')
          if (batch.name === 'bulk-1000') {
            for (const chunk of bulkChunks) child.stderr.write(chunk)
            bulkDispatched?.()
            if (bulkHang || bulkExit) { if (bulkExit) queueMicrotask(() => child.emit('close', 1)); done(); return }
          }
          response = JSON.stringify(batch.expectedResult)
        }
        else if (sql === manifest.privilege.catalog || sql === createManifest?.privilege.catalog
          || sql === discardManifest?.privilege.catalog || sql === discardManifest?.innerPrivilege.catalog || sql === reorderManifest?.privilege.catalog || sql === learnerManifest?.privilege.catalog || publicationSql(sql, 'catalog')) response = JSON.stringify(catalog())
        else if (sql === manifest.privilege.revoke || sql === createManifest?.privilege.revoke
          || sql === discardManifest?.privilege.revoke || sql === discardManifest?.innerPrivilege.revoke || sql === reorderManifest?.privilege.revoke || sql === learnerManifest?.privilege.revoke || publicationSql(sql, 'revoke')) serviceExecute = false
        else if (sql.includes('select public.snapshot_test_draft_save_for_owner_v1')) {
          const testId = sql.match(/_v1\('[a-f0-9-]+','([a-f0-9-]+)'/)![1]
          response = JSON.stringify({ version: 1, actor_id: manifest.fixture.owner, classroom: { id: manifest.fixture.classroom, teacher_id: manifest.fixture.owner },
            test: { id: testId, classroom_id: manifest.fixture.classroom }, source_sha256: 'a'.repeat(64) })
        } else if (sql.startsWith('select public.finish_test_draft_save_for_owner_v1')) {
          const row = manifest.concurrency.schedules.find(s => sql.includes(s.testId) && sql.includes(`'${s.operation}'`))!
          response = JSON.stringify({ operation: row.operation, test_id: row.testId })
        } else if (sql.startsWith('do $race$') && failContender) {
          queueMicrotask(() => child.emit('close', 1)); done(); return
        }
        queueMicrotask(() => child.stdout.write(`${response ? `${response}\n` : ''}${end}\n`)); done()
      } })
      children.push(child); return child
    })
  })
  afterEach(() => { vi.useRealTimers(); mocks.snapshotSqlReads = false; mocks.sourceDrift = false;
    mocks.remaining269=false;mocks.driftMigration = '249_contextual_test_draft_owner_save.sql'; mocks.socketInode = 2; mocks.sqlFileCache.clear() })
  function holdInitialGuard() {
    const implementation = mocks.execFile.getMockImplementation()!
    let holding = true
    const jobs: { args: string[]; settle: (error?: Error, output?: string) => void }[] = []
    mocks.execFile.mockImplementation((file: string, args: string[], options: unknown, callback: (error: unknown, stdout: string) => void) =>
      implementation(file, args, options, (error: unknown, stdout: string) => {
        if (holding && (file === 'git' || args[0] === 'context')) {
          let settled = false
          jobs.push({ args, settle: (replacementError, output) => {
            if (!settled) { settled = true; callback(replacementError ?? error, output ?? stdout) }
          } })
        }
        else callback(error, stdout)
      }))
    return { jobs, release() { holding = false; for (const job of jobs) job.settle() } }
  }
  async function flushGuardReads() { for (let i = 0; i < 12; i++) await Promise.resolve() }
  function surveyResourceFailureAdapter() {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-13T04:00:00Z'))
    surveyPositive = 'normal'
    surveyManifest = buildSurveyNativeContractsManifest(original, head, repository, true)
    if (!('committed' in surveyManifest)) throw new Error('Expected remaining-only source profile')
    const now = Date.now(); surveyWorkDeadline = now + 720000
    const adapter = createContextualSurveysNativeContracts({ original, repository, reviewedHead: head, remainingOnly: true,
      capturedResources: resources, containerId: resources.find(r => r.name === `supabase_db_${project}`)!.id,
      acceptedManifestSha256: testOwnerDigest(JSON.stringify(surveyManifest)), absoluteDeadline: surveyWorkDeadline,
      survey263Endpoint: { host: 'unix:///private/tmp/pika-test-native-docker.sock', identity: [1, 2, 3, 4],
        budget: { startedAt: now, workDeadline: surveyWorkDeadline, cleanupDeadline: now + 900000 }, nativeCli: SURVEY263_NATIVE_CLI } })
    return { adapter, committed: surveyManifest.committed }
  }
  it.each(['observer', 'terminal'] as const)('offline Survey resource failure rejects a late completed %s at the original work cutoff', async frame => {
    const { adapter, committed } = surveyResourceFailureAdapter()
    surveyLateFrame = frame
    const witness = vi.spyOn(surveyCommittedProof, 'verifySurveyCommittedWitness')
    const effects = vi.spyOn(surveyCommittedProof, 'verifySurveyCommittedEffects')
    try {
      await adapter.setup()
      await expect(adapter.runRemainingCommitted!()).rejects.toThrow()
      expect(witness).toHaveBeenCalledOnce()
      expect(witness.mock.calls[0][4].workDeadline).toBe(surveyWorkDeadline)
      expect(effects).toHaveBeenCalledTimes(frame === 'terminal' ? 1 : 0)
      expect(surveyEvents.filter(e => e.startsWith('holder:'))).toEqual([`holder:${committed.schedules[0].label}`])
      expect(surveyEvents.some(e => e.startsWith('release:'))).toBe(frame === 'terminal')
      expect(Date.now()).toBeGreaterThanOrEqual(surveyWorkDeadline)
      expect(Date.now()).toBeLessThan(surveyWorkDeadline + 180000)
      expect(children.every(child => child.kill.mock.calls.length > 0)).toBe(true)
      const dispatched = mocks.execFile.mock.calls.length, writes = surveyWrites.length
      await expect(adapter.verifyTarget()).rejects.toThrow()
      await expect(adapter.runRemainingCommitted!()).rejects.toThrow()
      expect(mocks.execFile).toHaveBeenCalledTimes(dispatched); expect(surveyWrites).toHaveLength(writes)
      expect(adapter.nativeVerified).toBe(false); expect(adapter.inventoryComplete).toBe(false)
    } finally { witness.mockRestore(); effects.mockRestore() }
  })
  it('offline Survey resource failure poisons progression when the owned child close is unconfirmed', async () => {
    const { adapter, committed } = surveyResourceFailureAdapter()
    surveyPositive = 'foreign-marker'; surveyUnjoinedHolder = true
    const seed = vi.spyOn(surveyCommittedProof, 'verifySurveyCommittedSeed')
    const witness = vi.spyOn(surveyCommittedProof, 'verifySurveyCommittedWitness')
    try {
      await adapter.setup()
      const pending = adapter.runRemainingCommitted!()
      const rejected = expect(pending).rejects.toThrow('Private Survey child closure unconfirmed')
      await vi.advanceTimersByTimeAsync(12001)
      await rejected
      expect(seed).toHaveBeenCalledOnce(); expect(witness).not.toHaveBeenCalled()
      expect(surveyEvents.filter(e => e.startsWith('holder:'))).toEqual([`holder:${committed.schedules[0].label}`])
      expect(surveyEvents.some(e => e.startsWith('release:'))).toBe(false)
      expect(terminations.filter(args => args.includes(`owned_name=${project}_draft_holder`))).toHaveLength(1)
      expect(children.every(child => child.kill.mock.calls.length > 0)).toBe(true)
      const dispatched = mocks.execFile.mock.calls.length, writes = surveyWrites.length
      await expect(adapter.verifyTarget()).rejects.toThrow('Private Survey child closure unconfirmed')
      await expect(adapter.runRemainingCommitted!()).rejects.toThrow('Private Survey child closure unconfirmed')
      expect(mocks.execFile).toHaveBeenCalledTimes(dispatched); expect(surveyWrites).toHaveLength(writes)
      expect(adapter.nativeVerified).toBe(false); expect(adapter.inventoryComplete).toBe(false)
    } finally { seed.mockRestore(); witness.mockRestore() }
  })
  it.each(['normal', 'early-contender', 'foreign-marker'] as const)('offline source-driven Survey private positive seed and original pending/frame progression: %s', async mode => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-13T04:00:00Z'))
    surveyPositive = mode
    surveyManifest = buildSurveyNativeContractsManifest(original, head, repository, true)
    if (!('committed' in surveyManifest)) throw new Error('Expected remaining-only source profile')
    const committed = surveyManifest.committed, now = Date.now()
    const adapter = createContextualSurveysNativeContracts({ original, repository, reviewedHead: head, remainingOnly: true,
      capturedResources: resources, containerId: resources.find(r => r.name === `supabase_db_${project}`)!.id,
      acceptedManifestSha256: testOwnerDigest(JSON.stringify(surveyManifest)), absoluteDeadline: now + 720000,
      survey263Endpoint: { host: 'unix:///private/tmp/pika-test-native-docker.sock', identity: [1, 2, 3, 4],
        budget: { startedAt: now, workDeadline: now + 720000, cleanupDeadline: now + 900000 }, nativeCli: SURVEY263_NATIVE_CLI } })
    // Call-through spies only: every production semantic validator runs unchanged.
    const seed = vi.spyOn(surveyCommittedProof, 'verifySurveyCommittedSeed'), witness = vi.spyOn(surveyCommittedProof, 'verifySurveyCommittedWitness')
    const effects = vi.spyOn(surveyCommittedProof, 'verifySurveyCommittedEffects'), envelopes = vi.spyOn(surveyCommittedProof, 'verifySurveyCommittedEnvelopes')
    try {
      await adapter.setup()
      if (mode !== 'normal') {
        await expect(adapter.runRemainingCommitted!()).rejects.toThrow()
        expect(seed).toHaveBeenCalledOnce(); expect(witness).not.toHaveBeenCalled(); expect(effects).not.toHaveBeenCalled()
        expect(surveyEvents.some(e => e.startsWith('release:'))).toBe(false)
        expect(children.every(child => child.kill.mock.calls.length > 0)).toBe(true)
        return
      }
      const receipt = await adapter.runRemainingCommitted!()
      expect(receipt).toMatchObject({ directions: committed.schedules.map(s => s.label), actions: 189, controls: 1216,
        remainingSessions: 0, nativeVerified: false, inventoryComplete: false })
      expect(seed).toHaveBeenCalledOnce(); expect(witness).toHaveBeenCalledTimes(30)
      expect(effects).toHaveBeenCalledTimes(30); expect(envelopes).toHaveBeenCalledTimes(30)
      expect(surveyEvents.filter(e => e.startsWith('observer:'))).toHaveLength(13)
      for (const s of committed.schedules) {
        const stages = (s.mode === 'wait' ? ['holder', 'contender', 'observer', 'release', 'contender-settled', 'settle', 'terminal']
          : ['holder', 'contender', 'contender-settled', 'release', 'settle', 'retry', 'terminal']).map(stage => surveyEvents.indexOf(`${stage}:${s.label}`))
        expect(stages.every((position, index) => position >= 0 && (!index || position > stages[index - 1]))).toBe(true)
      }
      expect(children).toHaveLength(4); expect(children.every(child => child.kill.mock.calls.length > 0)).toBe(true)
      expect(adapter.nativeVerified).toBe(false); expect(adapter.inventoryComplete).toBe(false)
      expect(surveyWrites.filter(w => w.sql === committed.seed)).toHaveLength(1)
      expect(surveyWrites.some(w => committed.schedules.some(s => w.sql === s.frames.cache))).toBe(false)
      // CPU JSON/children remain synthetic; this is production-flow coverage,
      // not evidence of real PID, SQL, authentication or native acceptance.
    } finally { seed.mockRestore(); witness.mockRestore(); effects.mockRestore(); envelopes.mockRestore() }
  })
  it.each(['malformed-graph', 'missing-marker', 'foreign-backend'] as const)('offline Survey private seed requires actual owned bootstrap/write/frame marker: %s', async fault => {
    surveySeedFault = fault
    surveyManifest = buildSurveyNativeContractsManifest(original, head, repository, true)
    if (!('committed' in surveyManifest)) throw new Error('Expected remaining-only source profile')
    const committed = surveyManifest.committed
    const now = Date.now()
    const adapter = createContextualSurveysNativeContracts({ original, repository, reviewedHead: head, remainingOnly: true,
      capturedResources: resources, containerId: resources.find(r => r.name === `supabase_db_${project}`)!.id,
      acceptedManifestSha256: testOwnerDigest(JSON.stringify(surveyManifest)), absoluteDeadline: now + 720000,
      survey263Endpoint: { host: 'unix:///private/tmp/pika-test-native-docker.sock', identity: [1, 2, 3, 4],
        budget: { startedAt: now, workDeadline: now + 720000, cleanupDeadline: now + 900000 }, nativeCli: SURVEY263_NATIVE_CLI } })
    const seedCheck = vi.spyOn(surveyCommittedProof, 'verifySurveyCommittedSeed')
    try {
      await adapter.setup()
      await expect(adapter.runRemainingCommitted!()).rejects.toThrow()
      expect(adapter.nativeVerified).toBe(false); expect(adapter.inventoryComplete).toBe(false)
      const seeds = surveyWrites.filter(w => w.sql === committed.seed)
      expect(seeds).toHaveLength(fault === 'foreign-backend' ? 0 : 1)
      if (fault === 'malformed-graph') {
        // The wire decoder rejects an incomplete table inventory before the
        // seed/effects validator can authenticate it as a baseline.
        expect(seedCheck).not.toHaveBeenCalled()
        expect(seeds[0]).toMatchObject({ name: `${project}_draft_holder`, marker: '__draft_save_end_2__' })
      } else expect(seedCheck).not.toHaveBeenCalled()
      expect(surveyWrites.some(w => committed.schedules.some(s => w.sql === s.frames.holder || w.sql === s.frames.contender))).toBe(false)
      expect(children.every(child => child.kill.mock.calls.length > 0)).toBe(true)
      // These synthetic transports exercise private production control flow.
      // They prove no real PID, SQL execution, target/auth or native acceptance.
    } finally { seedCheck.mockRestore() }
  })
  it.each(['normal','normal-over64','over128','prepare-close','observer-close','observer-timeout','contract-timeout','contract-cutoff','contract-wrong-sql','contract-wrong-sql-clamped','contract-wrong-session','contract-over120','wait-release','wait-observer-late','wait-pre-expired','wait-post-expired','wait-outer-cutoff','wait-statement-timeout',...scenario24Modes] as const)('runs actual remaining269 child engine/probe ownership on one198-action/16-request ledger (offline %s)',async mode=>{
    vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-18T04:00:00Z'));mocks.remaining269=true;surveyPositive='normal'
    scenario24=scenario24Modes.find(value=>value===mode)
    if(mode==='wait-release'||mode==='wait-observer-late'||mode==='wait-pre-expired'||mode==='wait-post-expired'||mode==='wait-outer-cutoff'||mode==='wait-statement-timeout')waitTiming=mode
    else remainingProbeFrameFault=mode==='prepare-close'||mode==='observer-close'||mode==='observer-timeout'||mode==='contract-timeout'||mode==='contract-cutoff'?mode:undefined
    const deniedContract=['contract-wrong-sql','contract-wrong-sql-clamped','contract-wrong-session','contract-over120'].includes(mode)
    let timeoutDenied=false
    const started=Date.now(),legacy=surveyNative.surveyRemainingNativePlan(original,head,repository),f=legacy.fixture
    const binding={product:{head,tree:head},carrier:{head,tree:head},sharedSources:Object.fromEntries(surveyNative.SURVEY_269_SHARED_FILES.map(file=>[file,'a'.repeat(64)]))} as surveyNative.Survey269ComponentBinding
    const plan={...legacy,kind:'survey269-remaining-only' as const,binding,repository:surveyNative.SURVEY_269_COMPONENT_ROOTS.product,migrations:[],
      contracts:{...legacy.contracts,sql:legacy.contracts.sql.replace("set local statement_timeout = '35s';","set local statement_timeout = '120s';")},
      migrationManifestSha256:surveyNative.SURVEY_269_COMPONENT_SCHEMA.manifestSha256,sourceSha256:surveyNative.SURVEY_269_COMPONENT_SCHEMA.sourceSha256,
      sources:{...legacy.sources,migration:{file:'supabase/migrations/269_contextual_surveys_workflow.sql',sha256:surveyNative.SURVEY_269_COMPONENT_SCHEMA.sourceSha256}},
      concurrency:{...legacy.concurrency,schedules:[]},caps:{...legacy.caps,controls:6000,sdkMs:60000},
      cancellation:surveyCancellationProofDescriptor(f),wire:surveyWireProofDescriptor(f),remainingCaps:{},inventory:{nativeActions:198},inventoryComplete:true,requiredBeforeAcceptance:[]}
    const originalMigrationDigest=draftGuards.draftSaveMigrationManifestSha256
    const spies=[vi.spyOn(surveyNative,'survey269RemainingPlan').mockReturnValue(plan as unknown as ReturnType<typeof surveyNative.survey269RemainingPlan>),
      vi.spyOn(surveyNative,'verifySurvey269ComponentSources').mockImplementation(()=>{}),
      vi.spyOn(draftGuards,'draftSaveMigrationManifestSha256').mockImplementation(repo=>repo===surveyNative.SURVEY_269_COMPONENT_ROOTS.product?plan.migrationManifestSha256:originalMigrationDigest(repo)),
      vi.spyOn(surveyNative,'validateSurvey269ComponentSql').mockImplementation((_plan,sql)=>[plan.setup,plan.snapshot,plan.contracts.sql,plan.concurrency.close].includes(sql)),
      // The actual private driver/SQL/frame/close mechanism runs; only the
      // source-seal phase oracle is synthetic, not dispatch or settlement.
      vi.spyOn(surveyNative,'runSurvey269ComponentRollback').mockImplementation(async(p,t,d)=>{
        expect(await d.verifyTarget()).toEqual(t);const session=await d.openSession(`${p.projectId}_${mode==='contract-wrong-session'?'fixture':'draft_contracts'}`)
        try{
          if(deniedContract){
            await expect(session.execute(mode==='contract-wrong-sql'||mode==='contract-wrong-sql-clamped'?'rollback;':p.contracts.sql,mode==='contract-over120'?120001:120000)).rejects.toThrow()
            timeoutDenied=true;throw new Error('Expected oversized frame refusal')
          }
          await session.execute(p.contracts.sql,p.kind==='survey269-remaining-only'?120000:35000)
        }finally{await session.rollbackAndClose(12000)}
        return{kind:'survey269-rollback-component-only',nativeVerified:false}
      }),
      vi.spyOn(surveyPlatform,'survey269RemainingDockerInventory').mockImplementation(async run=>{
        await Promise.all([['ps','-aq','--no-trunc'],['volume','ls','-q'],['network','ls','-q','--no-trunc']].map(a=>run('docker',a)))
        await Promise.all([['inspect'],['volume','inspect'],['network','inspect']].map(a=>run('docker',a)));return resources
      })]
    const stamp='2026-10-12T00:00:00+00:00',id=(n:number)=>`aabbccdd-0000-4000-8000-${String(n).padStart(12,'0')}`
    const primarySurveys=f.surveys.map((s,n)=>({...s,classroom_id:s.classroomId,created_by:s.owner,title:f.tag,status:'active',show_results:true,dynamic_responses:false,opens_at:stamp,created_at:stamp,updated_at:stamp,position:n===2?1:0,artifact_id:id(n+1),source_artifact_id:null,source_blueprint_version_id:null,blueprint_archived_at:null})).map(({classroomId:_c,owner:_o,...s})=>s)
    surveyOriginalBase={'public.surveys':primarySurveys,'public.survey_questions':[f.question,f.aggregateQuestion],
      'public.survey_responses':[{id:f.aggregateResponse.id,survey_id:f.aggregateResponse.surveyId,question_id:f.aggregateResponse.questionId,student_id:f.aggregateResponse.actorId,response_text:f.aggregateResponse.text,selected_option:null,submitted_at:stamp,updated_at:stamp}],
      'public.classrooms':f.classes.map(c=>({id:c.id,teacher_id:c.owner,archived_at:null,title:f.tag,blueprint_source_revision:4,updated_at:stamp})),
      'public.classroom_archive_revisions':f.classes.map(c=>({classroom_id:c.id,revision:10,updated_at:stamp})),
      'public.classroom_enrollments':f.enrollments.map(e=>({id:e.id,classroom_id:e.classroomId,student_id:e.actorId,created_at:stamp,manual_attendance_marks:{}})),
      'private.pal_membership_generations':f.enrollments.map((e,n)=>({generation_id:e.id,scope_digest:testOwnerDigest(`pika-membership-scope-v1:${e.classroomId}:${e.actorId}`),state:'active',pal_reference:'pika-membership-v1-'+String(n).padStart(32,'0')}))}
    let snapshotCount=0
    surveySnapshot=()=>{
      if(snapshotCount++===1){
        surveyGraph!['public.surveys']=surveyGraph!['public.surveys'].filter(s=>s.id!==f.surveys[0].id)
        surveyGraph!['public.survey_questions']=surveyGraph!['public.survey_questions'].filter(s=>s.survey_id!==f.surveys[0].id)
        surveyGraph!['public.survey_responses']=surveyGraph!['public.survey_responses'].filter(s=>s.survey_id!==f.surveys[0].id)
        const cl=surveyGraph!['public.classrooms'].find(r=>r.id===f.classes[0].id)!,ar=surveyGraph!['public.classroom_archive_revisions'].find(r=>r.classroom_id===f.classes[0].id)!
        cl.blueprint_source_revision=Number(cl.blueprint_source_revision)+5;ar.revision=Number(ar.revision)+11;cl.updated_at=ar.updated_at=new Date().toISOString()
      }return structuredClone(surveyGraph!)
    }
    let ordinaryCalls=0,resolveCancel:((response:Response)=>void)|undefined,actualFetches=0
    const reply=(v:unknown,status=200)=>new Response(JSON.stringify(v),{status,headers:{'content-type':'application/json'}})
    const wire=vi.fn<typeof fetch>(async(resource,init)=>{
      actualFetches++;expect(init?.redirect).toBe('error');expect(init?.signal).toBeInstanceOf(AbortSignal)
      const url=String(resource)
      if(actualFetches===1){expect(url).toBe(plan.cancellation.request.origin+plan.cancellation.request.path);return new Promise<Response>(resolve=>{resolveCancel=resolve})}
      if(actualFetches===2){expect(url).toBe(plan.wire.request.origin+plan.wire.request.path);let chunks=0;return new Response(new ReadableStream<Uint8Array>({pull(c){c.enqueue(new Uint8Array(chunks++<128?65536:1))},cancel(){return Promise.resolve()}}),{headers:{'content-type':'application/json'}})}
      const i=ordinaryCalls++,owner=f.actors[0].id,member=f.actors[1].id,cid=f.classes[0].id,sid=f.surveys[0].id,now=new Date().toISOString(),classroom={id:cid,teacher_id:owner,archived_at:null}
      const created={...f.question,id:id(91),artifact_id:id(92),question_text:'Added?',position:1,created_at:now,updated_at:now}
      const response={response_id:id(93),response_text:'SDK response',submitted_at:now,updated_at:now},result={question_id:f.question.id,question_type:'short_text',question_text:f.question.question_text,options:[],counts:[],total_responses:1,responses:[response]}
      const summary={id:sid,title:f.tag,status:'active',show_results:true,dynamic_responses:false}
      if(i===0||i===4)return reply({classroom,survey:primarySurveys[0],questions:[f.question],responses:[]})
      if(i===1||i===5)return reply({classroom,surveys:[primarySurveys[0],primarySurveys[2]]})
      if(i===2||i===3)return reply({code:'PT403',message:'Synthetic denial',details:null,hint:null},403)
      if(i===6)return reply({success:true,updated:false})
      if(i===7)return reply({classroom,survey:summary,results:[result]})
      if(i===8)return reply({classroom,survey:summary,questions:[{id:f.question.id,question_type:'short_text',question_text:f.question.question_text,options:[],response_max_chars:500,position:0}],results:[{...result,responses:[{...response,student_id:member,name:null,email:f.actors[1].email}]}],responders:[{student_id:member,name:null,email:f.actors[1].email}],stats:{total_students:2,responded:1}})
      if(i===9)return reply({survey:{...primarySurveys[0],title:'SDK renamed',updated_at:now}})
      if(i===10)return reply({question:created})
      if(i===11)return reply({question:{...created,question_type:'link',question_text:'URL?',response_max_chars:2048}})
      return reply({success:true})
    })
    vi.stubGlobal('fetch',wire)
    try{
      const adapters=surveyPlatform.createAssignmentListNativeAdapters(original,{survey263Endpoint:{kind:'survey263',host:'unix:///private/tmp/pika-test-native-docker.sock',identity:[1,2,3,4]},survey263Budget:{startedAt:started,workDeadline:started+720000,cleanupDeadline:started+900000},survey263NativeCli:SURVEY263_NATIVE_CLI,survey269Remaining:true})
      remainingManifest=buildSurvey269RemainingManifest(original,binding);surveyManifest=remainingManifest as unknown as typeof surveyManifest
      const adapter=createSurvey269RemainingNativeContracts({original,binding,capturedResources:resources,containerId:resources.find(r=>r.name===`supabase_db_${project}`)!.id,acceptedManifestSha256:testOwnerDigest(JSON.stringify(remainingManifest)),absoluteDeadline:started+720000,
        statusTarget:{API_URL:'http://127.0.0.1:54331',DB_URL:'postgresql://postgres:offline@127.0.0.1:54332/postgres',SERVICE_ROLE_KEY:`header.${Buffer.from(JSON.stringify({iss:'supabase-demo',role:'service_role'})).toString('base64url')}.signature`},survey263Endpoint:surveyPlatform.requireSurvey263AdapterEndpoint(adapters)})
      if(mode==='normal-over64')surveyPlatform.chargeSurvey269ComponentExchange(surveyPlatform.requireSurvey263AdapterEndpoint(adapters).componentExchange!,67108864)
      if(mode==='over128'){
        surveyPlatform.chargeSurvey269ComponentExchange(surveyPlatform.requireSurvey263AdapterEndpoint(adapters).componentExchange!,134217728)
        await expect(adapter.setup()).rejects.toThrow()
        expect(children).toHaveLength(0);expect(actualFetches).toBe(0)
        expect(adapter.diagnostic()).toContain('failure=budget')
        return
      }
      await adapter.setup()
      if(mode==='contract-cutoff'||mode==='contract-wrong-sql-clamped')vi.setSystemTime(started+680000)
      if(mode==='wait-outer-cutoff')vi.setSystemTime(started+719100)
      const run=adapter.runRemainingCommitted();void run.catch(()=>{})
      if(scenario24){
        const result=run.catch(error=>error)
        for(let n=0;n<30000&&!scenario24GuardDelayed;n++)await Promise.resolve()
        expect(scenario24GuardDelayed).toBe(true)
        expect(surveyEvents).toContain('contender:response_after_text_limit_change:reverse')
        expect(surveyEvents).not.toContain('observer:response_after_text_limit_change:reverse')
        await vi.advanceTimersByTimeAsync(751)
        if(scenario24!=='scenario24-750'){
          expect(await result).toBeInstanceOf(Error)
          const diagnostic=adapter.diagnostic()
          // This is the historical generic signature, reproduced offline;
          // labels below must distinguish causes without claiming v7's cause.
          expect(diagnostic).toContain('failure=unknown role=none sqlstate=unknown controls=2387 actions=148 sessions=2')
          const predicate={
            'scenario24-751':'observation-window','scenario24-receipt':'receipt','scenario24-settled':'pending',
            'scenario24-backend':'backend','scenario24-blocker':'blocker','scenario24-waiter':'waiter','scenario24-operation':'holder-operation',
            'scenario24-source':'holder-source','scenario24-timestamps':'holder-window',
            'scenario24-invalid-clock':'clock-finite','scenario24-overflow-clock':'clock-order',
          }[scenario24]
          const delta=scenario24==='scenario24-receipt'||scenario24==='scenario24-invalid-clock'?'unknown':scenario24==='scenario24-751'?751:scenario24==='scenario24-overflow-clock'?720000:500
          const label=`DIAG survey269-committed failure direction=24 frame=observer predicate=${predicate} observationMs=${delta}.`
          expect(diagnostic).toContain(label);expect(diagnostic.split(label)).toHaveLength(2);expect(Buffer.byteLength(label+'\n')).toBeLessThanOrEqual(160)
          expect(diagnostic).not.toMatch(/private-payload|response_after_text_limit_change|SELECT|UPDATE|2026-|aabbccdd/i)
          expect(surveyEvents).not.toContain('release:response_after_text_limit_change:reverse')
          expect(surveyEvents).not.toContain('holder:response_after_close:forward')
          expect(surveyEvents).not.toContain('cancel-prepare');expect(actualFetches).toBe(0)
          expect(diagnostic).toContain('remainingSessions=0')
          const writes=surveyWrites.length,controls=mocks.execFile.mock.calls.length
          await vi.advanceTimersByTimeAsync(10000)
          expect(adapter.diagnostic()).toBe(diagnostic);expect(surveyWrites).toHaveLength(writes);expect(mocks.execFile).toHaveBeenCalledTimes(controls)
          await expect(adapter.runSdkCommitted()).rejects.toThrow();expect(actualFetches).toBe(0)
          expect(adapter.diagnostic()).toBe(diagnostic)
          return
        }
        expect(surveyEvents).toContain('release:response_after_text_limit_change:reverse')
        expect(adapter.diagnostic()).not.toContain('DIAG survey269-committed failure')
      }
      if(deniedContract){
        await expect(run).rejects.toThrow();expect(timeoutDenied).toBe(true)
        expect(surveyWrites.some(w=>w.sql===plan.contracts.sql)).toBe(false)
        expect(surveyEvents).not.toContain('cancel-prepare');expect(actualFetches).toBe(0)
        expect(adapter.diagnostic()).toContain('remainingSessions=0');return
      }
      if(waitTiming){
        const result=run.catch(e=>e)
        for(let n=0;n<30000&&!waitStarted;n++)await Promise.resolve()
        expect(waitStarted).toBeGreaterThan(0)
        await vi.advanceTimersByTimeAsync(waitTiming==='wait-pre-expired'||waitTiming==='wait-post-expired'||waitTiming==='wait-statement-timeout'?8100:1100)
        if(waitTiming!=='wait-release'){
          expect(await result).toBeInstanceOf(Error)
          expect(surveyEvents).not.toContain('wait-release-written')
          expect(surveyEvents).not.toContain('holder:owner_replacement_after_snapshot:reverse')
          expect(surveyEvents).not.toContain('cancel-prepare');expect(actualFetches).toBe(0)
          expect(adapter.diagnostic()).toContain('remainingSessions=0')
          if(waitTiming==='wait-pre-expired'||waitTiming==='wait-post-expired')expect(adapter.diagnostic()).toContain('failure=timeout role=holder')
          if(waitTiming==='wait-pre-expired')expect(adapter.diagnostic()).toContain('actions=34')
          if(waitTiming==='wait-post-expired')expect(adapter.diagnostic()).toContain('actions=35')
          if(waitTiming==='wait-statement-timeout')expect(adapter.diagnostic()).toContain('role=contender sqlstate=57014')
          if(waitTiming==='wait-statement-timeout'||waitTiming==='wait-post-expired')expect(adapter.diagnostic()).not.toContain('DIAG survey269-committed failure')
          const frozen=adapter.diagnostic(),writes=surveyWrites.length,controls=mocks.execFile.mock.calls.length
          await vi.advanceTimersByTimeAsync(10000)
          expect(adapter.diagnostic()).toBe(frozen);expect(surveyWrites).toHaveLength(writes);expect(mocks.execFile).toHaveBeenCalledTimes(controls)
          await expect(adapter.runSdkCommitted()).rejects.toThrow();expect(actualFetches).toBe(0)
          return
        }
        expect(surveyEvents).toContain('wait-release-guard')
        expect(surveyEvents).toContain('wait-release-written')
        expect(surveyEvents).not.toContain('wait-backend-timeout')
      }
      if(mode==='contract-timeout'||mode==='contract-cutoff'){
        let settled=false;const result=run.catch(e=>e).finally(()=>{settled=true})
        for(let n=0;n<30000&&!surveyEvents.includes('contract-hanging');n++)await Promise.resolve()
        expect(surveyEvents).toContain('contract-hanging')
        const spawned=children.length
        await vi.advanceTimersByTimeAsync(35000);expect(settled).toBe(false);expect(children).toHaveLength(spawned)
        await vi.advanceTimersByTimeAsync(mode==='contract-timeout'?84999:4999);expect(settled).toBe(false)
        await vi.advanceTimersByTimeAsync(1);expect(await result).toBeInstanceOf(Error)
        expect(adapter.diagnostic()).toContain('failure=timeout role=contracts')
        expect(adapter.diagnostic()).toContain('sequence=171')
        expect(adapter.diagnostic()).toContain('remainingSessions=0')
        expect(surveyEvents).not.toContain('cancel-prepare');expect(actualFetches).toBe(0)
        expect(children).toHaveLength(spawned)
        return
      }
      if(mode!=='normal'&&mode!=='normal-over64'&&mode!=='wait-release'&&mode!=='scenario24-750'){
        let settled=false;const failure=run.catch(e=>e).finally(()=>{settled=true})
        for(let n=0;n<30000&&!surveyEvents.includes(mode==='prepare-close'?'cancel-prepare':'cancel-observer');n++)await Promise.resolve()
        for(let n=0;n<100;n++)await Promise.resolve()
        if(mode==='observer-timeout')await vi.advanceTimersByTimeAsync(35000)
        if(mode!=='prepare-close'){
          expect(settled).toBe(false)
          resolveCancel!(reply({code:'57014',message:'cancelled',details:null,hint:null},500))
        }
        expect(await failure).toBeInstanceOf(surveyPlatform.Survey263UnjoinedChildError)
        expect(adapter.diagnostic()).toContain(`failure=${mode==='observer-timeout'?'timeout':'child-exit'} role=holder`)
        const restorations=[remainingManifest.cancellation.frames.restoreBeforeDispatch,remainingManifest.cancellation.frames.restoreAfterDispatch,remainingManifest.wire.frames.restore]
        expect(sqlControls.filter(c=>restorations.includes(c.sql))).toHaveLength(0)
        expect(surveyEvents).not.toContain('wire-prepare');expect(ordinaryCalls).toBe(0)
        const dispatched=mocks.execFile.mock.calls.length,writes=surveyWrites.length
        await expect(adapter.runSdkCommitted()).rejects.toBeInstanceOf(surveyPlatform.Survey263UnjoinedChildError)
        await expect(adapter.generateTypes269()).rejects.toBeInstanceOf(surveyPlatform.Survey263UnjoinedChildError)
        expect(mocks.execFile).toHaveBeenCalledTimes(dispatched);expect(surveyWrites).toHaveLength(writes)
        return
      }
      for(let n=0;n<30000&&!surveyEvents.includes('cancel-observer');n++)await Promise.resolve()
      expect(surveyEvents).toContain('cancel-observer');for(let n=0;n<100;n++)await Promise.resolve()
      vi.setSystemTime(Date.now()+8000);resolveCancel!(reply({code:'57014',message:'cancelled',details:null,hint:null},500))
      const committed=await run;expect(committed).toMatchObject({kind:'survey269-committed-cancellation-wire',actions:194,remainingSessions:0,requests:2,observerFrames:14,primaryMembershipUnchanged:true})
      const cutoff=committed.phaseDeadline;expect(cutoff).toBeTypeOf('number')
      const terminal=await adapter.runSdkCommitted();expect(terminal).toMatchObject({actions:198,controls:3953,remainingSessions:0,sdk:{calls:14,absoluteDeadline:cutoff}})
      expect(actualFetches).toBe(16);expect(ordinaryCalls).toBe(14);expect(children).toHaveLength(6)
      expect(surveyEvents.filter(e=>e.startsWith('holder:'))).toHaveLength(30)
      const token=surveyPlatform.requireSurvey263AdapterEndpoint(adapters).componentExchange!,ledger=surveyPlatform.survey269ComponentExchangeReceipt(token)
      expect(ledger.requests).toBe(16);expect(ledger.controls).toBe(3959);expect(ledger.bytes).toBeLessThan(134217728)
      const workdir='/private/tmp/pika-assignment-list-'+project.slice(-12)
      mocks.config=assignmentListEphemeralPlan({projectId:project,workdir}).config
      const jsonNames=new Set(['p_patch','p_question','p_expected_question','p_expected_questions','p_responses'])
      mocks.generatedSource=`type Json=string|null;export type Database = {public:{Functions:{snapshot_test_draft_save_for_owner_v1:{Args:{};Returns:Json};finish_test_draft_save_for_owner_v1:{Args:{};Returns:Json};set_classroom_hot_archive_for_owner_v1:{Args:{p_actor_id:string;p_classroom_id:string;p_archived:boolean};Returns:Json};${Object.entries(surveyNative.SURVEY_RPC_ARGUMENTS).map(([name,args])=>`${name}:{Args:{${args.map(a=>`${a}:${jsonNames.has(a)?'Json':'string'}`).join(';')}};Returns:Json}`).join(';')}}}}`
      const types=await adapter.generateTypes269();expect(types).toMatchObject({validatedRpcContracts:12,validatedFoundationHotArchiveRpc:true,migrationManifestSha256:plan.migrationManifestSha256,nativeVerified:false})
      expect(mocks.syntheticArtifacts.size).toBe(1)
      const finalLedger=surveyPlatform.survey269ComponentExchangeReceipt(token)
      expect(finalLedger.controls).toBe(4008);expect(finalLedger.requests).toBe(16);expect(finalLedger.bytes).toBeLessThan(134217728)
      expect(finalLedger.limit).toBe(134217728)
      if(mode==='normal-over64')expect(finalLedger.bytes).toBeGreaterThan(67108864)
      process.stdout.write(`DIAG offline remaining trace actions=198 controls=${finalLedger.controls} requests=${finalLedger.requests} bytes=${finalLedger.bytes} nativeVerified=false.\n`)
      expect(adapter.inventoryComplete).toBe(true);expect(adapter.nativeVerified).toBe(false)
    }finally{spies.forEach(s=>s.mockRestore());vi.unstubAllGlobals()}
  })
  it('measures8s wire separately from14s guarded cancellation action', async () => {
    const adapter = learnerFactory(); await adapter.setup()
    await adapter.probeLearnerPrivilegeDrift(async () => ({ status: 503, rpcCalls: 1, rawCode: '42501' }))
    vi.useFakeTimers()
    const proof = adapter.probeLearnerCancellation(async () => {
      await new Promise(resolve => setTimeout(resolve, 14000))
      return { status: 500, rpcCalls: 1, rawCode: '57014', elapsedMs: 8000 }
    })
    const accepted = proof.then(value => ({ value }), () => ({ failed: true }))
    await vi.advanceTimersByTimeAsync(14001)
    expect(await accepted).toEqual({ value: { cancellationCode: '57014', catalogRestored: true, fixtureUnchanged: true } })
    expect(cancellationInstalled).toBe(false)
    expect(adapter.diagnostic()).not.toContain('failure=unknown')
  })
  it('rejects early wire despite guard padding and restores exact fixture', async () => {
    const adapter = learnerFactory(); await adapter.setup()
    await adapter.probeLearnerPrivilegeDrift(async () => ({ status: 503, rpcCalls: 1, rawCode: '42501' }))
    vi.useFakeTimers()
    const refused = expect(adapter.probeLearnerCancellation(async () => {
      await new Promise(resolve => setTimeout(resolve, 9000))
      return { status: 500, rpcCalls: 1, rawCode: '57014', elapsedMs: 1000 }
    })).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(9001); await refused
    expect(cancellationInstalled).toBe(false)
    expect(adapter.diagnostic()).toContain('cancellationStage=timing')
  })
  it.each(['', '{"ok":true}', 'ok\nok', 'ok\n{"extra":true}', 'ok trailing'])('refuses unexpected cancellation restoration output %j', async output => {
    const adapter = learnerFactory(); await adapter.setup()
    await adapter.probeLearnerPrivilegeDrift(async () => ({ status: 503, rpcCalls: 1, rawCode: '42501' }))
    expect(learnerManifest!.cancellation.restore.startsWith(learnerManifest!.guard + '\n')).toBe(true)
    expect(learnerManifest!.guard.endsWith("end;$guard$;select 'ok';rollback;")).toBe(true)
    cancellationRestoreOutput = output
    vi.useFakeTimers()
    const settled = adapter.probeLearnerCancellation(async () => {
      await new Promise(resolve => setTimeout(resolve, 8000))
      return { status: 500, rpcCalls: 1, rawCode: '57014', elapsedMs: 8000 }
    }).then(() => ({ accepted: true }), () => ({ rejected: true }))
    await vi.advanceTimersByTimeAsync(8001)
    expect(await settled).toEqual({ rejected: true })
    expect(cancellationInstalled).toBe(false)
    expect(adapter.diagnostic()).toContain('cancellationStage=restore')
    expect(adapter.diagnostic()).toContain('cancellationRestore=restore')
  })
  it.each(['catalog', 'fixture'] as const)('still refuses changed cancellation %s after the exact acknowledgement', async changed => {
    const adapter = learnerFactory(); await adapter.setup()
    await adapter.probeLearnerPrivilegeDrift(async () => ({ status: 503, rpcCalls: 1, rawCode: '42501' }))
    vi.useFakeTimers()
    const settled = adapter.probeLearnerCancellation(async () => {
      await new Promise(resolve => setTimeout(resolve, 8000))
      if (changed === 'catalog') cancellationCatalogChanged = true
      else fixtureChanged = true
      return { status: 500, rpcCalls: 1, rawCode: '57014', elapsedMs: 8000 }
    }).then(() => ({ accepted: true }), () => ({ rejected: true }))
    await vi.advanceTimersByTimeAsync(8001)
    expect(await settled).toEqual({ rejected: true })
    expect(cancellationInstalled).toBe(false)
    expect(adapter.diagnostic()).toContain(`cancellationRestore=restored-${changed}`)
  })
  it('expires the guarded cancellation action at30s without renewing its deadline', async () => {
    const adapter = learnerFactory(); await adapter.setup()
    await adapter.probeLearnerPrivilegeDrift(async () => ({ status: 503, rpcCalls: 1, rawCode: '42501' }))
    vi.useFakeTimers()
    const refused = expect(adapter.probeLearnerCancellation(async () => new Promise(() => {}))).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(30001); await refused
    expect(cancellationInstalled).toBe(false)
    expect(adapter.diagnostic()).toContain('cancellationStage=probe')
  })
  it('retains first probe failure separately from a later restore failure', async () => {
    const adapter = learnerFactory(); await adapter.setup()
    await adapter.probeLearnerPrivilegeDrift(async () => ({ status: 503, rpcCalls: 1, rawCode: '42501' }))
    await expect(adapter.probeLearnerCancellation(async () => {
      restorationFails = true; throw Error('PRIVATE synthetic SDK secret')
    })).rejects.toThrow()
    expect(adapter.diagnostic()).toContain('cancellationStage=probe')
    expect(adapter.diagnostic()).toContain('cancellationRestore=restore')
    expect(adapter.diagnostic()).not.toContain('synthetic SDK secret')
  })
  it.each(['ordinary', 'timeout', 'child-exit', 'late-stderr'])('retires historical 10k diagnostic before fake-child dispatch in %s scenario', scenario => {
    diagnosticHang = scenario === 'timeout'; diagnosticExit = scenario === 'child-exit'
    diagnosticMarkerFirst = scenario === 'late-stderr'
    diagnosticChunks = ['INFO: PDT01 1000000\\nINFO: PDT02 1000100\\nINFO: PDT03 1000300\\n']
    expect(() => diagnosticFactory()).toThrow('10000-Test reorder diagnostic retired')
    expect(mocks.execFile).not.toHaveBeenCalled()
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(mocks.inventory).not.toHaveBeenCalled()
    expect(children).toHaveLength(0)
    expect(sqlControls).toHaveLength(0)
  })
  it.each([0, 1, 2, 3, 4])('freezes observed bulk progress at35s timeout after checkpoint %i', async count => {
    const adapter = reorderFactory(); await adapter.setup()
    await adapter.probeReorderPrivilegeDrift(async () => ({ status: 503, rpcCalls: 1, rawCode: '42501' }))
    vi.useFakeTimers()
    bulkHang = true; bulkChunks = Array.from({ length: count }, (_, i) => `INFO: PRG0${i+1}\n`)
    const dispatched = new Promise<void>(resolve => { bulkDispatched = resolve })
    const rejected = expect(adapter.run()).rejects.toThrow()
    await dispatched
    await vi.advanceTimersByTimeAsync(35001); await rejected
    const diagnostic = adapter.diagnostic()
    expect(diagnostic).toContain(`phase=contracts failure=timeout role=contracts sqlstate=unknown`)
    expect(diagnostic).toContain(`progress=${count ? `PRG0${count}` : 'none'} calibration=verified`)
    for (const child of children) child.stderr.emit('data', Buffer.from('INFO: PRG04\nINFO: PRG00\nERROR: PRD14\nPRIVATE secret\n'))
    await expect(adapter.run()).rejects.toThrow()
    expect(adapter.diagnostic()).toBe(diagnostic)
  })
  it.each([['PRD14', 'PRD14'], ['57014', '57014'], ['ZZ999', 'unknown']])('retains separate bulk progress and failure SQLSTATE %s', async (code, expected) => {
    contaminateOtherFrames = true
    const adapter = reorderFactory(); await adapter.setup()
    await adapter.probeReorderPrivilegeDrift(async () => ({ status: 503, rpcCalls: 1, rawCode: '42501' }))
    bulkExit = true; bulkChunks = ['INFO: PR', `G01\r\nINFO: PRG02\nERROR: ${code}\n`]
    await expect(adapter.run()).rejects.toThrow()
    expect(adapter.diagnostic()).toContain(`sqlstate=${expected} `)
    expect(adapter.diagnostic()).toContain('progress=PRG02 calibration=verified')
    expect(adapter.diagnostic()).not.toMatch(/PRIVATE|secret/)
  })
  it.each(['INFO: PRG01\nINFO: PRG01\n', 'INFO: PRG02\n', 'INFO: PRG01 private data\n', `${'x'.repeat(129)}INFO: PRG01\n`])(
    'invalidates malformed bulk observation through the actual native adapter', async chunks => {
      const adapter = reorderFactory(); await adapter.setup()
      await adapter.probeReorderPrivilegeDrift(async () => ({ status: 503, rpcCalls: 1, rawCode: '42501' }))
      bulkExit = true; bulkChunks = [chunks, 'INFO: PRG01\nERROR: PRD14\n']
      await expect(adapter.run()).rejects.toThrow()
      expect(adapter.diagnostic()).toContain('progress=invalid calibration=verified')
      expect(adapter.diagnostic()).toContain('sqlstate=PRD14')
      expect(adapter.diagnostic()).not.toContain('private')
    })
  it('leaves duplicate calibration unverified in the actual native adapter', async () => {
    const adapter = reorderFactory(); await adapter.setup()
    await adapter.probeReorderPrivilegeDrift(async () => ({ status: 503, rpcCalls: 1, rawCode: '42501' }))
    duplicateCalibration = true; bulkExit = true; bulkChunks = ['INFO: PRG01\nERROR: PRD14\n']
    await expect(adapter.run()).rejects.toThrow()
    expect(adapter.diagnostic()).toContain('progress=PRG01 calibration=unverified')
  })
  it('does not verify missing calibration or accept markers from fixture setup', async () => {
    const setup = reorderFactory(); setupExit = true; stderrChunks = ['INFO: PRG00\nINFO: PRG01\nERROR: PRG02\n']
    await expect(setup.setup()).rejects.toThrow()
    expect(setup.diagnostic()).toContain('progress=none calibration=unverified')
    expect(setup.diagnostic()).toContain('sqlstate=unknown')
    setupExit = false
    const adapter = reorderFactory(); await adapter.setup()
    await adapter.probeReorderPrivilegeDrift(async () => ({ status: 503, rpcCalls: 1, rawCode: '42501' }))
    emitCalibration = false; bulkExit = true; bulkChunks = ['INFO: PRG01\nERROR: PRD14\n']
    await expect(adapter.run()).rejects.toThrow()
    expect(adapter.diagnostic()).toContain('progress=PRG01 calibration=unverified')
  })
  it('exposes only a read-only target verifier without opening a persistent SQL session', async () => {
    const adapter = factory()
    const target = await adapter.verifyTarget()
    expect(target.reviewedHead).toBe(head)
    expect(target.reviewedSourceSha256).toBe(manifest.sourceSha256)
    expect(target.acceptedManifestSha256).toBe(testOwnerDigest(JSON.stringify(manifest)))
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(sqlControls.some(control => control.sql === manifest.setup)).toBe(false)
    expect(Object.keys(adapter)).not.toContain('execute')
  })
  it('restores the actual250 CREATE grant and full catalog even if its SDK probe rejects', async () => {
    const adapter = createFactory(); await adapter.setup()
    expect(Object.keys(adapter)).not.toContain('probeSnapshotPrivilegeDrift')
    await expect(adapter.probeCreatePrivilegeDrift(async () => { throw new Error('PRIVATE SDK rejection') })).rejects.toThrow()
    expect(serviceExecute).toBe(true)
    const restores = sqlControls.filter(c => c.sql === createManifest!.privilege.restore)
    expect(restores).toHaveLength(1)
    expect(restores[0].sql).toContain('create_test_for_owner_v1(uuid,uuid,text,timestamp with time zone)')
    expect(adapter.diagnostic()).toContain('DIAG test-owner-create native phase=privilege')
    expect(adapter.diagnostic()).not.toContain('PRIVATE')
  })
  it('reports a CREATE ACL receipt with no snapshot capability naming', async () => {
    const adapter = createFactory(); await adapter.setup()
    const receipt = await adapter.probeCreatePrivilegeDrift(async () => ({ status: 503, rpcCalls: 1, rawCode: '42501' }))
    expect(receipt).toEqual({ privilegeRestored: true, fixtureUnchanged: true, createAclSha256: expect.stringMatching(/^[a-f0-9]{64}$/) })
    expect(serviceExecute).toBe(true)
  })
  it('keeps default249 and250 facade APIs unchanged and exposes two fixed251 probes only', () => {
    for (const adapter of [factory(), createFactory()]) {
      expect(adapter).not.toHaveProperty('probeInnerPrivilegeDrift')
      expect(adapter).not.toHaveProperty('probeLegacyDiscardPrivilegeDrift')
    }
    const adapter = discardFactory()
    expect(adapter).not.toHaveProperty('probeSnapshotPrivilegeDrift')
    expect(adapter).not.toHaveProperty('probeInnerPrivilegeDrift')
    expect(adapter).not.toHaveProperty('selectProfile')
    expect(adapter).toHaveProperty('probeDiscardPrivilegeDrift')
    expect(adapter).toHaveProperty('probeLegacyDiscardPrivilegeDrift')
  })
  it('withdraws and restores two different251 capabilities with one shared engine', async () => {
    const adapter = discardFactory(); await adapter.setup()
    const callback = async () => { expect(serviceExecute).toBe(false); return {status:503 as const,rpcCalls:1 as const,rawCode:'42501' as const} }
    expect(await adapter.probeDiscardPrivilegeDrift(callback)).toHaveProperty('discardAclSha256')
    expect(serviceExecute).toBe(true)
    expect(await adapter.probeLegacyDiscardPrivilegeDrift(callback)).toHaveProperty('legacyDiscardAclSha256')
    expect(serviceExecute).toBe(true)
    expect(sqlControls.filter(c => c.sql === discardManifest!.privilege.restore)).toHaveLength(1)
    expect(sqlControls.filter(c => c.sql === discardManifest!.innerPrivilege.restore)).toHaveLength(1)
    await expect(adapter.probeLegacyDiscardPrivilegeDrift(callback)).rejects.toThrow()
  })
  it('restores the inner156 capability and whole catalog even after callback failure', async () => {
    const adapter = discardFactory(); await adapter.setup()
    await expect(adapter.probeLegacyDiscardPrivilegeDrift(async () => { throw Error('PRIVATE callback failure') })).rejects.toThrow()
    expect(serviceExecute).toBe(true)
    expect(sqlControls.filter(c => c.sql === discardManifest!.innerPrivilege.restore)).toHaveLength(1)
    expect(sqlControls.some(c => c.sql === discardManifest!.privilege.restore)).toBe(false)
    expect(adapter.diagnostic()).not.toContain('PRIVATE')
  })
  it('does not renew251 native total budget between the two probes', async () => {
    vi.useFakeTimers()
    const adapter = discardFactory(); await adapter.setup()
    await adapter.probeDiscardPrivilegeDrift(async () => ({status:503,rpcCalls:1,rawCode:'42501'}))
    const before = children.length
    await vi.advanceTimersByTimeAsync(900000)
    await expect(adapter.probeLegacyDiscardPrivilegeDrift(async () => ({status:503,rpcCalls:1,rawCode:'42501'}))).rejects.toThrow()
    expect(children).toHaveLength(before)
    expect(adapter.diagnostic()).toContain('failure=timeout')
  })
  it('requires both distinct251 probes before its rollback evidence can start', async () => {
    const adapter = discardFactory(); await adapter.setup()
    const before = children.length
    await expect(adapter.run()).rejects.toThrow()
    expect(children).toHaveLength(before)
  })
  it('withdraws/restores all four fixed252 capabilities with one unchanged ledger', async () => {
    const adapter = publicationFactory(); await adapter.setup()
    const one = async () => { expect(serviceExecute).toBe(false); return { status: 503 as const, rpcCalls: 1 as const, rawCode: '42501' as const } }
    const two = async () => { expect(serviceExecute).toBe(false); return { status: 503 as const, rpcCalls: 2 as const, rawCode: '42501' as const } }
    for (const operation of [() => adapter.probePublicationSnapshotPrivilegeDrift(one), () => adapter.probePublicationPrivilegeDrift(two),
      () => adapter.probeLegacyPublicationPrivilegeDrift(two), () => adapter.probeActivationPrivilegeDrift(two)]) {
      expect(await operation()).toMatchObject({ privilegeRestored: true, fixtureUnchanged: true, snapshotAclSha256: expect.stringMatching(/^[a-f0-9]{64}$/) })
      expect(serviceExecute).toBe(true)
    }
    for (const capability of Object.values(publicationManifest!.publicationPrivileges)) {
      expect(sqlControls.filter(c => c.sql === capability.restore)).toHaveLength(1)
    }
    await expect(adapter.probePublicationPrivilegeDrift(two)).rejects.toThrow()
    expect(adapter).not.toHaveProperty('probeFixedPrivilegeDrift')
  })
  it.each(['snapshot247', 'publication252', 'legacy139', 'activation134'] as const)('restores fixed252 %s even after ambiguous SDK failure', async kind => {
    const adapter = publicationFactory(); await adapter.setup()
    const callback = async () => { throw Error('PRIVATE acknowledgement') }
    const operations = { snapshot247: () => adapter.probePublicationSnapshotPrivilegeDrift(callback), publication252: () => adapter.probePublicationPrivilegeDrift(callback),
      legacy139: () => adapter.probeLegacyPublicationPrivilegeDrift(callback), activation134: () => adapter.probeActivationPrivilegeDrift(callback) }
    await expect(operations[kind]()).rejects.toThrow()
    expect(serviceExecute).toBe(true)
    expect(sqlControls.filter(c => c.sql === publicationManifest!.publicationPrivileges[kind].restore)).toHaveLength(1)
    expect(adapter.diagnostic()).not.toContain('PRIVATE')
  })
  it('requires all252 capabilities before rollback and keeps committed work separate', async () => {
    const adapter = publicationFactory(); await adapter.setup()
    await adapter.probePublicationSnapshotPrivilegeDrift(async () => ({ status: 503, rpcCalls: 1, rawCode: '42501' }))
    const before = children.length
    await expect(adapter.run()).rejects.toThrow()
    await expect(adapter.runCommittedTransitions()).rejects.toThrow()
    expect(children).toHaveLength(before)
  })
  it('expires at the original adopter deadline without opening a new252 phase', async () => {
    vi.useFakeTimers()
    const adapter = publicationFactory(Date.now() + 1000); await adapter.setup()
    await adapter.probePublicationSnapshotPrivilegeDrift(async () => ({ status: 503, rpcCalls: 1, rawCode: '42501' }))
    const before = children.length
    await vi.advanceTimersByTimeAsync(1000)
    await expect(adapter.probePublicationPrivilegeDrift(async () => ({ status: 503, rpcCalls: 2, rawCode: '42501' }))).rejects.toThrow()
    expect(children).toHaveLength(before)
    expect(adapter.diagnostic()).toContain('failure=timeout')
  })
  it('does not renew the252 race clock between rollback and committed runners', async () => {
    vi.useFakeTimers()
    const adapter = publicationFactory(); await adapter.setup()
    await adapter.probePublicationSnapshotPrivilegeDrift(async () => ({ status: 503, rpcCalls: 1, rawCode: '42501' }))
    for (const probe of [adapter.probePublicationPrivilegeDrift, adapter.probeLegacyPublicationPrivilegeDrift, adapter.probeActivationPrivilegeDrift]) {
      await probe(async () => ({ status: 503, rpcCalls: 2, rawCode: '42501' }))
    }
    // Offline driver doubles isolate the private clock. They do not claim SQL
    // or race acceptance, which requires the actual disposable lifecycle.
    const contracts = vi.spyOn(publicationContracts, 'runTestOwnerPublicationDbContracts').mockResolvedValue(Object.freeze({
      kind: 'rollback-test-owner-publication-contracts', sourceSha256: publicationContracts.TEST_OWNER_PUBLICATION_SOURCE_SHA256,
      manifestSha256: testOwnerDigest(JSON.stringify(publicationManifest!.contracts)), checks: publicationManifest!.contracts.expectedResult.checks,
    }))
    const races = vi.spyOn(publicationRaces, 'runTestOwnerPublicationConcurrency').mockResolvedValue(Object.freeze({
      kind: 'rollback-publication-contention', sourceSha256: publicationManifest!.sourceSha256,
      manifestSha256: testOwnerDigest(JSON.stringify(publicationManifest!.concurrency)),
      schedules: publicationManifest!.concurrency.schedules.map(s => s.label), dispatches: 24, elapsedMs: 0,
    }))
    try {
      await adapter.run()
      const before = children.length
      vi.setSystemTime(Date.now() + 180000)
      await expect(adapter.runCommittedTransitions()).rejects.toThrow('Publication race deadline exhausted')
      expect(children).toHaveLength(before)
      expect(adapter.diagnostic()).toContain('phase=transitions failure=timeout')
    } finally { contracts.mockRestore(); races.mockRestore() }
  })
  it.each([['PCD01', 'PCD01'], ['PCD99', 'unknown']])('keeps finite251 diagnostics without rendering source rows %s', async (code, expected) => {
    const adapter = discardFactory(); setupExit = true; stderrChunks = [`PRIVATE row\nERROR: ${code}\n`]
    await expect(adapter.setup()).rejects.toThrow()
    expect(adapter.diagnostic()).toContain(`sqlstate=${expected} `)
    expect(adapter.diagnostic()).not.toContain('PRIVATE')
  })
  it.each(Array.from({ length: 49 }, (_, index) => {
    const number = index + 1, code = `P25${String(number).padStart(2, '0')}`
    return [code, number === 1 || (number >= 7 && number <= 48) ? code : 'unknown']
  }))('keeps only emitted252 contract diagnostics without rendering source rows %s', async (code, expected) => {
    const adapter = publicationFactory(); setupExit = true; stderrChunks = [`PRIVATE secret row\nERROR: ${code}\n`]
    await expect(adapter.setup()).rejects.toThrow()
    expect(adapter.diagnostic()).toContain(`sqlstate=${expected} `)
    expect(adapter.diagnostic()).not.toMatch(/PRIVATE|secret|row/)
  })
  it.each(Array.from({ length: 18 }, (_, index) => {
    const number = index + 1, code = `PRD${String(number).padStart(2, '0')}`
    return [code, number <= 7 || (number >= 11 && number <= 16) ? code : 'unknown']
  }))('keeps only emitted253 bulk failure codes without rendering source rows %s', async (code, expected) => {
    const adapter = publicationFactory(); setupExit = true; stderrChunks = [`PRIVATE secret row\nERROR: ${code}\n`]
    await expect(adapter.setup()).rejects.toThrow()
    expect(adapter.diagnostic()).toContain(`sqlstate=${expected} `)
    expect(adapter.diagnostic()).not.toMatch(/PRIVATE|secret|row/)
  })
  it('rejects changed250 bytes before SDK guard or native work dispatch', async () => {
    const adapter = createFactory(); await adapter.setup()
    const childrenBefore = children.length, sqlBefore = sqlControls.length
    mocks.driftMigration = '250_contextual_test_owner_create.sql'; mocks.sourceDrift = true
    await expect(adapter.verifyTarget()).rejects.toThrow()
    expect(children).toHaveLength(childrenBefore)
    expect(sqlControls.slice(sqlBefore).every(c => !c.args.includes('exec'))).toBe(true)
  })
  it('reports a closed guard failure and preserves it across subsequent work', async () => {
    const adapter = factory()
    mocks.inventory.mockRejectedValueOnce(Error('PRIVATE inventory failure'))
    await expect(adapter.setup()).rejects.toThrow()
    const diagnostic = adapter.diagnostic()
    expect(diagnostic).toMatch(/^DIAG test-owner-draft-save native phase=setup failure=guard role=fixture sqlstate=unknown controls=\d{1,4} actions=\d{1,3} sessions=\d\.\n$/)
    await expect(adapter.run()).rejects.toThrow()
    expect(adapter.diagnostic()).toBe(diagnostic)
    expect(diagnostic).not.toContain('PRIVATE')
  })
  it('captures only the closed SQLSTATE of a failed private SQL guard', async () => {
    const adapter = factory()
    const implementation = mocks.execFile.getMockImplementation()!
    mocks.execFile.mockImplementation((file: string, args: string[], options: unknown, callback: (error: unknown, stdout: string, stderr?: string) => void) =>
      implementation(file, args, options, (error: unknown, stdout: string) => {
        if (args.includes('exec')) callback(Error('PRIVATE guard message'), '', 'PRIVATE secret\nERROR:  42501\n')
        else callback(error, stdout)
      }))
    await expect(adapter.setup()).rejects.toThrow()
    expect(adapter.diagnostic()).toContain('phase=setup failure=guard role=fixture sqlstate=42501')
    expect(adapter.diagnostic()).not.toContain('PRIVATE')
    expect(mocks.spawn).not.toHaveBeenCalled()
  })
  it.each([
    [['PRIVATE secret\nERR', 'OR:  57', '014\n'], '57014'],
    [['FAT', 'AL: PT409\nPRIVATE secret\n'], 'PT409'],
    [['ERROR: ZZ999\nPRIVATE secret\n'], 'unknown'],
    [['PRIVATE row\nERR', 'OR: PR', 'D14\nPRIVATE context\n'], 'PRD14'],
    [['PRIVATE token ERROR: 42501 extra secret\n'], 'unknown'],
  ] as const)('reports only allowlisted SQLSTATE after split stderr and child exit %s', async (chunks, code) => {
    const adapter = factory(); setupExit = true; stderrChunks = [...chunks]
    await expect(adapter.setup()).rejects.toThrow('exact project disposal required')
    const diagnostic = adapter.diagnostic()
    expect(diagnostic).toContain('phase=setup failure=child-exit role=fixture')
    expect(diagnostic).toContain(`sqlstate=${code} `)
    expect(diagnostic).not.toContain('PRIVATE'); expect(diagnostic).not.toContain('secret')
    expect(children[0].kill).toHaveBeenCalledWith('SIGKILL')
    expect(terminations).toHaveLength(1)
  })
  it.each([['PC001', 'PC001'], ['PC999', 'unknown']])('reports only a finite CREATE proof failure code %s', async (code, expected) => {
    const adapter = createFactory(); setupExit = true; stderrChunks = [`PRIVATE secret\nERROR: ${code}\nPRIVATE row\n`]
    await expect(adapter.setup()).rejects.toThrow('exact project disposal required')
    expect(adapter.diagnostic()).toContain(`sqlstate=${expected} `)
    expect(adapter.diagnostic()).not.toMatch(/PRIVATE|secret|row/)
    expect(children[0].kill).toHaveBeenCalledWith('SIGKILL')
    expect(terminations).toHaveLength(1)
  })
  it('reports protocol failure without the malformed private row or cleanup overwriting it', async () => {
    const adapter = factory(); malformedSetup = true; terminationConfirmed = false
    await expect(adapter.setup()).rejects.toThrow()
    expect(adapter.diagnostic()).toContain('phase=setup failure=protocol role=fixture sqlstate=unknown')
    expect(adapter.diagnostic()).not.toContain('PRIVATE')
    expect(children[0].kill).toHaveBeenCalledWith('SIGKILL')
  })
  it('retains the existing stderr cap and emits no raw stderr during rejection', async () => {
    const adapter = factory(); setupExit = true; stderrChunks = ['PRIVATE'.repeat(10000)]
    const write = vi.spyOn(process.stderr, 'write')
    try {
      await expect(adapter.setup()).rejects.toThrow()
      expect(adapter.diagnostic()).toContain('phase=setup failure=protocol role=fixture sqlstate=unknown')
      expect(write).not.toHaveBeenCalled()
      expect(children[0].kill).toHaveBeenCalledWith('SIGKILL')
    } finally { write.mockRestore() }
  })
  it('retains the native total cap and records only bounded budget counters', async () => {
    vi.useFakeTimers()
    const adapter = factory(); await adapter.setup()
    await vi.advanceTimersByTimeAsync(900000)
    await expect(adapter.run()).rejects.toThrow()
    expect(adapter.diagnostic()).toMatch(/phase=snapshot failure=timeout role=none sqlstate=unknown controls=\d{1,4} actions=\d{1,3} sessions=0\.\n$/)
    expect(children).toHaveLength(1)
  })
  it('overlaps the four fresh read checks and waits for all before inventory, SQL or sessions', async () => {
    const held = holdInitialGuard()
    const pending = factory().setup()
    const outcome = pending.catch(error => error)
    try {
      await flushGuardReads()
      expect(held.jobs.map(job => job.args.slice(0, 2))).toEqual([
        ['rev-parse', 'HEAD'], ['rev-parse', '--show-toplevel'], ['status', '--porcelain'], ['context', 'inspect'],
      ])
      held.jobs[0].settle(); held.jobs[1].settle(); held.jobs[2].settle()
      await flushGuardReads()
      expect(mocks.inventory).not.toHaveBeenCalled()
      expect(sqlControls.every(control => !control.args.includes('exec'))).toBe(true)
      expect(mocks.spawn).not.toHaveBeenCalled()
    } finally { held.release(); await outcome }
    await expect(pending).resolves.toHaveProperty('setupSha256')
  })
  it.each([
    ['failed HEAD child', 0, Error('offline read failed'), undefined],
    ['changed HEAD', 0, undefined, 'f'.repeat(40)],
    ['changed root', 1, undefined, '/private/tmp/other-repository'],
    ['dirty source', 2, undefined, ' M scripts/contextual-test-draft-save-native-contracts.ts'],
    ['remote endpoint', 3, undefined, JSON.stringify({ endpoints: { docker: { Host: 'tcp://127.0.0.1:2375' } }, tlsMaterial: null })],
  ] as const)('settles every independent read after %s before rejecting without dispatch', async (_label, index, error, output) => {
    const held = holdInitialGuard()
    let finished = false
    const adapter = factory(); const pending = adapter.setup()
    const outcome = pending.then(() => { finished = true }, () => { finished = true })
    try {
      await flushGuardReads()
      expect(held.jobs).toHaveLength(4)
      held.jobs[index].settle(error, output)
      await flushGuardReads()
      expect(finished).toBe(false)
      expect(mocks.inventory).not.toHaveBeenCalled()
      expect(mocks.spawn).not.toHaveBeenCalled()
      expect(sqlControls.every(control => !control.args.includes('exec'))).toBe(true)
    } finally { held.release(); await outcome }
    await expect(pending).rejects.toThrow()
    expect(adapter.diagnostic()).toContain('phase=setup failure=guard role=fixture sqlstate=unknown')
    expect(mocks.inventory).not.toHaveBeenCalled()
    expect(mocks.spawn).not.toHaveBeenCalled()
  })
  it('waits for complete inventory and rejects socket replacement before SQL or session dispatch', async () => {
    let releaseInventory!: (value: typeof resources) => void
    mocks.inventory.mockImplementationOnce(() => new Promise(resolve => { releaseInventory = resolve }))
    const pending = factory().setup()
    const outcome = pending.catch(error => error)
    await flushGuardReads()
    expect(mocks.inventory).toHaveBeenCalledTimes(1)
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(sqlControls.every(control => !control.args.includes('exec'))).toBe(true)
    mocks.socketInode = 99
    releaseInventory(resources)
    await outcome
    await expect(pending).rejects.toThrow()
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(sqlControls.every(control => !control.args.includes('exec'))).toBe(true)
  })
  it('waits for the post-inventory endpoint read before SQL or session dispatch', async () => {
    const implementation = mocks.execFile.getMockImplementation()!
    let releaseEndpoint: (() => void) | undefined
    let held = false
    mocks.execFile.mockImplementation((file: string, args: string[], options: unknown, callback: (error: unknown, stdout: string) => void) =>
      implementation(file, args, options, (error: unknown, stdout: string) => {
        if (!held && args[0] === 'context' && mocks.inventory.mock.calls.length) {
          held = true; releaseEndpoint = () => callback(error, stdout)
        } else callback(error, stdout)
      }))
    const pending = factory().setup()
    const outcome = pending.catch(error => error)
    try {
      await flushGuardReads()
      expect(releaseEndpoint).toBeTypeOf('function')
      expect(mocks.inventory).toHaveBeenCalledTimes(1)
      expect(mocks.spawn).not.toHaveBeenCalled()
      expect(sqlControls.every(control => !control.args.includes('exec'))).toBe(true)
    } finally { releaseEndpoint?.(); await outcome }
    await expect(pending).resolves.toHaveProperty('setupSha256')
  })
  it.each(['249_contextual_test_draft_owner_save.sql', '001_create_users.sql'])('snapshots the complete offline SQL fixture and rejects changed %s before work', async migration => {
    const adapter = factory(); await adapter.setup()
    expect(mocks.sqlFileCache.size).toBe(readdirSync('supabase/migrations').filter(name => name.endsWith('.sql')).length)
    const dispatchedSql = sqlControls.length
    const spawnedChildren = children.length
    const inventories = mocks.inventory.mock.calls.length
    mocks.driftMigration = migration; mocks.sourceDrift = true
    await expect(adapter.run()).rejects.toThrow('Expected values to be strictly equal')
    expect(sqlControls.slice(dispatchedSql).every(control => ['rev-parse', 'status', 'context'].includes(control.args[0]))).toBe(true)
    expect(mocks.inventory).toHaveBeenCalledTimes(inventories)
    expect(children).toHaveLength(spawnedChildren)
    expect(children.every(child => child.kill.mock.calls.some(([signal]) => signal === 'SIGKILL'))).toBe(true)
  })
  it('runs the finite protocol through persistent sessions and binds every exact child command', async () => {
    const adapter = factory(); await adapter.setup(); const result = await adapter.run()
    expect(result.races.schedules).toHaveLength(DRAFT_SAVE_CAPS.schedules)
    expect(result.fixtureUnchanged).toBe(true)
    expect(children.every(c => c.kill.mock.calls.some(([signal]) => signal === 'SIGKILL'))).toBe(true)
    expect(terminations).toHaveLength(children.length)
    expect(mocks.inventory.mock.calls.length).toBeGreaterThan(children.length)
    for (const args of mocks.spawn.mock.calls.map(call => call[1] as string[])) {
      expect(args).toContain(resources[0].id); expect(args).toContain('-XqAt'); expect(args).not.toContain('-h')
    }
  },15000)
  it('terminates the exact remote backend and reaps the child after a timed-out action', async () => {
    vi.useFakeTimers(); hangingSetup = true
    const adapter = factory(); const pending = adapter.setup(); const assertion = expect(pending).rejects.toThrow('exact project disposal required')
    await vi.advanceTimersByTimeAsync(90000); await assertion
    expect(adapter.diagnostic()).toContain('phase=setup failure=timeout role=fixture sqlstate=unknown')
    expect(terminations).toHaveLength(1)
    expect(terminations[0]).toContain('owned_pid=1000'); expect(terminations[0]).toContain('owned_started=2026-10-05T00:00:00+00:00')
    expect(children[0].kill).toHaveBeenCalledWith('SIGKILL')
  })
  it('closes both exact sessions when a contender exits unexpectedly', async () => {
    const adapter = factory(); await adapter.setup(); failContender = true
    await expect(adapter.run()).rejects.toThrow()
    expect(children.slice(-2).every(child => child.kill.mock.calls.some(([signal]) => signal === 'SIGKILL'))).toBe(true)
    expect(terminations.length).toBe(children.length)
    expect(adapter.diagnostic()).toContain('phase=races failure=child-exit role=contender sqlstate=unknown')
  })
  it('fails cleanup when remote termination cannot be confirmed, even after local children close', async () => {
    terminationConfirmed = false
    await expect(factory().setup()).rejects.toThrow('exact project disposal required')
    expect(children[0].kill).toHaveBeenCalledWith('SIGKILL')
  })
  it('rejects a replaced captured container before opening any session', async () => {
    mocks.inventory.mockResolvedValue(resources.map(r => r.kind === 'container' && r.name === `supabase_db_${project}` ? { ...r, id: 'f'.repeat(64) } : r))
    await expect(factory().setup()).rejects.toThrow()
    expect(mocks.spawn).not.toHaveBeenCalled()
  })
  it('uses only the captured local Unix Docker endpoint for SQL and session commands', async () => {
    await factory().setup()
    for (const call of mocks.spawn.mock.calls) expect(call[1].slice(0, 2)).toEqual(['--host', 'unix:///private/tmp/pika-test-native-docker.sock'])
    for (const call of mocks.execFile.mock.calls.filter(call => call[0] === 'docker' && call[1].includes('exec')))
      expect(call[1].slice(0, 2)).toEqual(['--host', 'unix:///private/tmp/pika-test-native-docker.sock'])
  })
  it('rejects unaccepted native manifest bytes before native operations', () => {
    expect(() => createDraftSaveNativeContracts({ repository, reviewedHead: head, original, capturedResources: resources,
      containerId: resources[0].id, acceptedManifestSha256: '0'.repeat(64) })).toThrow()
    expect(mocks.spawn).not.toHaveBeenCalled(); expect(mocks.execFile).not.toHaveBeenCalled()
  })
  it('revokes only the exact snapshot grant for one probe and restores the full catalog and fixture', async () => {
    const adapter = factory(); await adapter.setup()
    const callback = vi.fn(async () => { expect(serviceExecute).toBe(false); return { status: 503 as const, rpcCalls: 1 as const, rawCode: '42501' as const } })
    expect(await adapter.probeSnapshotPrivilegeDrift(callback)).toMatchObject({ privilegeRestored: true, fixtureUnchanged: true })
    expect(callback).toHaveBeenCalledTimes(1); expect(serviceExecute).toBe(true)
    await expect(adapter.probeSnapshotPrivilegeDrift(callback)).rejects.toThrow()
    expect(callback).toHaveBeenCalledTimes(1)
  })
  it('rejects a nonfunction restoration admission before any native operation', () => {
    for (const invalid of [null, false, 1, {}]) expect(() => factory(invalid as never)).toThrow()
    expect(mocks.spawn).not.toHaveBeenCalled(); expect(mocks.execFile).not.toHaveBeenCalled()
  })
  it('awaits caller closure before any restoration guard or SQL, without clearing a failed probe', async () => {
    let release!: () => void
    const closed = new Promise<void>(resolve => { release = resolve })
    const admission = vi.fn(() => closed)
    const adapter = factory(admission); await adapter.setup()
    let controlsAtFailure = 0; let inventoriesAtFailure = 0
    const result = adapter.probeSnapshotPrivilegeDrift(async () => {
      controlsAtFailure = sqlControls.length; inventoriesAtFailure = mocks.inventory.mock.calls.length
      throw Error('synthetic callback failure')
    })
    const rejected = expect(result).rejects.toThrow('exact project disposal required')
    await vi.waitFor(() => expect(admission).toHaveBeenCalledTimes(1))
    expect(sqlControls).toHaveLength(controlsAtFailure)
    expect(mocks.inventory).toHaveBeenCalledTimes(inventoriesAtFailure)
    expect(serviceExecute).toBe(false)
    release(); await rejected
    expect(admission).toHaveBeenCalledTimes(6); expect(serviceExecute).toBe(true)
    await expect(adapter.run()).rejects.toThrow()
  })
  it('retains the revoked fixture when restoration admission rejects, without guard or SQL dispatch', async () => {
    const admission = vi.fn(async () => { throw Error('synthetic unsettled owner') })
    const adapter = factory(admission); await adapter.setup()
    let controlsAtFailure = 0; let inventoriesAtFailure = 0
    await expect(adapter.probeSnapshotPrivilegeDrift(async () => {
      controlsAtFailure = sqlControls.length; inventoriesAtFailure = mocks.inventory.mock.calls.length
      throw Error('synthetic callback failure')
    })).rejects.toThrow('exact project disposal required')
    expect(admission).toHaveBeenCalledTimes(1); expect(serviceExecute).toBe(false)
    expect(sqlControls).toHaveLength(controlsAtFailure)
    expect(mocks.inventory).toHaveBeenCalledTimes(inventoriesAtFailure)
    await expect(adapter.run()).rejects.toThrow()
  })
  it('rechecks admission after the asynchronous guard and denies the fixed restoration SQL', async () => {
    const admission = vi.fn(async () => { if (admission.mock.calls.length === 2) throw Error('synthetic guard-time poison') })
    const adapter = factory(admission); await adapter.setup()
    let controlsAtFailure = 0; let inventoriesAtFailure = 0
    await expect(adapter.probeSnapshotPrivilegeDrift(async () => {
      controlsAtFailure = sqlControls.length; inventoriesAtFailure = mocks.inventory.mock.calls.length
      throw Error('synthetic callback failure')
    })).rejects.toThrow('exact project disposal required')
    expect(admission).toHaveBeenCalledTimes(2); expect(serviceExecute).toBe(false)
    expect(mocks.inventory.mock.calls.length).toBeGreaterThan(inventoriesAtFailure)
    expect(sqlControls.slice(controlsAtFailure).some(control => control.sql === manifest.privilege.restore)).toBe(false)
  })
  it('preserves normal privilege restoration with a trusted void-returning admission', async () => {
    const admission = vi.fn(async () => undefined)
    const adapter = factory(admission); await adapter.setup()
    expect(await adapter.probeSnapshotPrivilegeDrift(async () => ({ status: 503, rpcCalls: 1, rawCode: '42501' })))
      .toMatchObject({ privilegeRestored: true, fixtureUnchanged: true })
    expect(admission).toHaveBeenCalledTimes(6); expect(serviceExecute).toBe(true)
  })
  it('uses the approved contract-session name for the restoration whole-row snapshot without weakening its guard', async () => {
    const adapter = factory(); await adapter.setup()
    await adapter.probeSnapshotPrivilegeDrift(async () => ({ status: 503, rpcCalls: 1, rawCode: '42501' }))
    const snapshots = sqlControls.filter(command => command.sql === manifest.snapshot)
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].args).toContain(`PGAPPNAME=${project}_draft_contracts`)
    expect(manifest.snapshot).toContain(`'${project}_draft_contracts'`)
    expect(manifest.snapshot).not.toContain(`'${project}_fixture'`)
  })
  it('restores grants and proves fixture/catalog equality even when the SDK callback throws', async () => {
    const adapter = factory(); await adapter.setup()
    await expect(adapter.probeSnapshotPrivilegeDrift(async () => { throw Error('private SDK failure') })).rejects.toThrow('exact project disposal required')
    expect(serviceExecute).toBe(true)
    expect(mocks.execFile.mock.calls.some(call => call[0] === 'docker' && call[1].includes('exec'))).toBe(true)
    await expect(adapter.run()).rejects.toThrow()
  })
  it('rejects fixture mutation during the probe after restoring the exact grant', async () => {
    const adapter = factory(); await adapter.setup()
    await expect(adapter.probeSnapshotPrivilegeDrift(async () => { fixtureChanged = true; return { status: 503, rpcCalls: 1, rawCode: '42501' } })).rejects.toThrow()
    expect(serviceExecute).toBe(true)
  })
  it('rejects a changed function definition during restoration', async () => {
    const adapter = factory(); await adapter.setup()
    await expect(adapter.probeSnapshotPrivilegeDrift(async () => { catalogChanged = true; return { status: 503, rpcCalls: 1, rawCode: '42501' } })).rejects.toThrow()
    expect(serviceExecute).toBe(true)
  })
  it('rejects an unexpected original ACL without revoking or running the SDK callback', async () => {
    const adapter = factory(); await adapter.setup(); serviceExecute = false
    const callback = vi.fn(async () => ({ status: 503 as const, rpcCalls: 1 as const, rawCode: '42501' as const }))
    await expect(adapter.probeSnapshotPrivilegeDrift(callback)).rejects.toThrow()
    expect(callback).not.toHaveBeenCalled(); expect(serviceExecute).toBe(false)
  })
  it('rejects nonmatching SDK evidence and still restores the grant', async () => {
    const adapter = factory(); await adapter.setup()
    await expect(adapter.probeSnapshotPrivilegeDrift(async () => ({ status: 403, rpcCalls: 1, rawCode: '42501' }) as never)).rejects.toThrow()
    expect(serviceExecute).toBe(true)
  })
  it('fails closed when grant restoration fails and forbids subsequent normal work', async () => {
    const adapter = factory(); await adapter.setup(); restorationFails = true
    await expect(adapter.probeSnapshotPrivilegeDrift(async () => ({ status: 503, rpcCalls: 1, rawCode: '42501' }))).rejects.toThrow('exact project disposal required')
    expect(serviceExecute).toBe(false)
    await expect(adapter.run()).rejects.toThrow()
  })
  it('rejects a PUBLIC ACL before revoking the expected service grant', async () => {
    const adapter = factory(); await adapter.setup(); publicGrant = true
    const callback = vi.fn(async () => ({ status: 503 as const, rpcCalls: 1 as const, rawCode: '42501' as const }))
    await expect(adapter.probeSnapshotPrivilegeDrift(callback)).rejects.toThrow()
    expect(callback).not.toHaveBeenCalled(); expect(serviceExecute).toBe(true)
  })
  it('forbids a probe before exact fixture setup', async () => {
    const callback = vi.fn(async () => ({ status: 503 as const, rpcCalls: 1 as const, rawCode: '42501' as const }))
    await expect(factory().probeSnapshotPrivilegeDrift(callback)).rejects.toThrow()
    expect(callback).not.toHaveBeenCalled(); expect(mocks.spawn).not.toHaveBeenCalled()
  })
})
