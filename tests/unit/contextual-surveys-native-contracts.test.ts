import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
const fsFaults = vi.hoisted(() => ({ sdkProofDrift: false, componentRoots: false, sharedDrift: false }))
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  const roots=['/Users/stew/.codex/worktrees/pika/contextual-surveys-current-main','/Users/stew/.codex/worktrees/classroom-access-completion-plan/pika']
  return { ...actual, realpathSync: ((path)=>fsFaults.componentRoots && roots.includes(String(path)) ? String(path) : actual.realpathSync(path)) as typeof actual.realpathSync, readFileSync: ((path, options) => {
    const original=String(path), root=fsFaults.componentRoots ? roots.find(root=>original.startsWith(root+'/')) : undefined
    const value = actual.readFileSync(root ? original.replace(root,process.cwd()) : path, options)
    if(fsFaults.sharedDrift && original===roots[0]+'/src/lib/validations/contextual-surveys.ts') return Buffer.isBuffer(value) ? Buffer.concat([value,Buffer.from('\n// changed')]) : value+'\n// changed'
    if (fsFaults.sdkProofDrift && String(path).endsWith('/scripts/contextual-surveys-sdk-proof.ts'))
      return Buffer.isBuffer(value) ? Buffer.concat([value, Buffer.from('\n// changed SDK oracle source')]) : value + '\n// changed SDK oracle source'
    return value
  }) as typeof actual.readFileSync }
})
import * as platform from '../../scripts/contextual-assignment-list-proof-platform'
import { createOfflineTestLearnerRepository } from '../helpers/test-learner-native-repository'
import * as nativeEngine from '../../scripts/contextual-test-draft-save-native-contracts'
import { assignmentListExpectedResources, runAssignmentListEphemeralLifecycle,
  type AssignmentListLifecycleAdapters, type AssignmentListLifecycleInput, type AssignmentListResource } from '../../scripts/contextual-assignment-list-proof-lifecycle'
import { assignmentListProofWorkdir } from '../../scripts/contextual-assignment-list-proof-path'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { loadAssignmentListReviewedMigrations } from '../../scripts/contextual-assignment-list-proof-platform'
import { surveyNativePlan, validateSurveyNativeMigrationProfile, validateSurveyNativeSql,
  bindSurveyNativeLifecycleWorkload, validateSurveyNativeLifecycleWorkload, consumeSurveyNativeLifecycleWorkload,
  runSurveyNativeRollbackRaces, runSurveyNativeRollbackContracts, validateSurveyGeneratedTypes,
  validateSurvey269ComponentGeneratedTypes, validateSurvey269ComponentMigrations, validateSurvey269ComponentWorkload, verifySurvey269ComponentSources,
  SURVEY_269_SHARED_FILES, SURVEY_RPC_ARGUMENTS } from '../../scripts/contextual-surveys-native-contracts'
import { surveyRemainingNativePlan } from '../../scripts/contextual-surveys-native-contracts'
import { buildSurveyNativeContractsManifest, createContextualSurveysNativeContracts } from '../../scripts/contextual-test-draft-save-native-contracts'
const surveyEndpoint = { kind: 'survey263' as const, host: 'unix:///offline-survey.sock', identity: [1, 2, 3, 4] as const,
  budget: { startedAt: Date.now(), workDeadline: Date.now() + 720000, cleanupDeadline: Date.now() + 900000 }, nativeCli: platform.SURVEY263_NATIVE_CLI }
import type { DraftSaveDriver, DraftSaveTarget } from '../../scripts/check-contextual-test-draft-save-db-contracts'

const original = newAssignmentListProofFixture(new Date('2026-10-12T12:00:00Z'))
const head = '17b9e1bf6b3ea970b3ad2e91795642b8d3ade79b', repository = process.cwd()
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const plan = () => surveyNativePlan(original, head, repository)
const targetFor = (m: ReturnType<typeof plan>, phase: 'contracts' | 'concurrency'): DraftSaveTarget => Object.freeze({
  projectId: m.projectId, apiUrl: 'http://127.0.0.1:54331', databaseHost: '127.0.0.1', databasePort: 54332,
  containerId: 'a'.repeat(64), containerProjectLabel: m.projectId, disposable: true,
  reviewedHead: head, migrationManifestSha256: m.migrationManifestSha256, reviewedSourceSha256: m.sourceSha256,
  acceptedManifestSha256: digest(m[phase]),
})

describe('source-only sealed Survey263 native reuse', () => {
  it('component269 refuses historical263 migration inventory, unbound workloads and modified source bindings',()=>{
    expect(()=>validateSurvey269ComponentMigrations(loadAssignmentListReviewedMigrations(repository))).toThrow()
    expect(()=>validateSurvey269ComponentWorkload({} as never, original)).toThrow('not source-bound')
    const sources=Object.fromEntries(SURVEY_269_SHARED_FILES.map(file=>[file,createHash('sha256').update(readFileSync(`${repository}/${file}`)).digest('hex')]))
    const binding={product:{head,tree:head},carrier:{head,tree:head},sharedSources:sources} as Parameters<typeof verifySurvey269ComponentSources>[0]
    fsFaults.componentRoots=true
    try {
      expect(()=>verifySurvey269ComponentSources(binding)).not.toThrow()
      fsFaults.sharedDrift=true
      expect(()=>verifySurvey269ComponentSources(binding)).toThrow('shared runtime source differs')
    } finally {fsFaults.componentRoots=false;fsFaults.sharedDrift=false}
    expect(()=>verifySurvey269ComponentSources({...binding,sharedSources:{...sources,extra:'a'.repeat(64)}} as never)).toThrow()
    expect(()=>verifySurvey269ComponentSources({...binding,product:{head,tree:'changed'}})).toThrow()
    const getter=Object.defineProperty({...binding},'product',{get:()=>binding.product})
    expect(()=>verifySurvey269ComponentSources(getter)).toThrow()
  })
  it('keeps remaining-only private binding inert and refuses a workload before attempt consumption', async () => {
    const remaining = surveyRemainingNativePlan(original, head, repository)
    expect(remaining.executionEnabled).toBe(false); expect(remaining.nativeVerified).toBe(false)
    expect(remaining.inventory).toMatchObject({ committedActions: 185, knownNativeActions: 193, remainingNativeActions: 7,
      committedEngineCommandControls: 1148, completeControls: null, sdkRequests: 14,
      knownIdentityBootstrapDispatches: 6, knownSessionSpawns: 6, knownSessionCloses: 6,
      completeExchangeBytes: null, engineExchangeByteCap: 67108864 })
    expect(remaining.inventoryComplete).toBe(false)
    expect(() => bindSurveyNativeLifecycleWorkload({ original, repository, reviewedHead: head, reviewedManifestSha256: digest(remaining),
      absoluteDeadline: Date.now() + 60000, rootReviewed: true, oneAttemptAuthorized: true, freshCapacityChecked: true, remainingOnly: true }))
      .toThrow('complete native inventory is absent')
    const m = buildSurveyNativeContractsManifest(original, head, repository, true)
    const engine = createContextualSurveysNativeContracts({ original, repository, reviewedHead: head, remainingOnly: true,
      capturedResources: [], containerId: 'a'.repeat(64), acceptedManifestSha256: digest(m), absoluteDeadline: surveyEndpoint.budget.workDeadline,
      survey263Endpoint: surveyEndpoint })
    expect(engine.inventoryComplete).toBe(false)
    expect(engine.runRemainingCommitted).toBeTypeOf('function')
    await expect(engine.run()).rejects.toThrow('cannot replay rollback races')
  })
  it('pins actual SDK proof implementation bytes and rejects changed source before binding', () => {
    const m = plan(), source = m.sources.sdkProof
    expect(createHash('sha256').update(readFileSync(`${repository}/${source.file}`)).digest('hex')).toBe(source.sha256)
    fsFaults.sdkProofDrift = true
    try { expect(() => plan()).toThrow('Survey reviewed source differs') }
    finally { fsFaults.sdkProofDrift = false }
  })
  it('preserves exact requested historical learner prefixes despite reviewed263 source', () => {
    for (const count of [257, 258] as const) {
      const offline = createOfflineTestLearnerRepository(repository, count)
      try {
        const names = readdirSync(`${offline.repository}/supabase/migrations`).sort()
        expect(names).toHaveLength(count)
        expect(names.some(name => name.startsWith('263_'))).toBe(false)
        for (const name of [names[0], names.at(-1)!]) expect(readFileSync(`${offline.repository}/supabase/migrations/${name}`, 'utf8'))
          .toBe(readFileSync(`${repository}/supabase/migrations/${name}`, 'utf8'))
      } finally { offline.dispose() }
    }
  })
  it('offline helper rejects changed263 and unknown264 before allocating a fixture directory', () => {
    const real = platform.loadAssignmentListReviewedMigrations(repository)
    for (const defect of ['name', 'bytes', 'self-hashed', 'future264'] as const) {
      const inventory = real.map(row => ({ ...row }))
      if (defect === 'name') inventory[262].name = '263_unknown.sql'
      if (defect === 'bytes' || defect === 'self-hashed') inventory[262].sql += '\n'
      if (defect === 'self-hashed') inventory[262].sha256 = createHash('sha256').update(inventory[262].sql).digest('hex')
      if (defect === 'future264') inventory.push({ name: '264_unknown.sql', sql: 'select 1;', sha256: 'a'.repeat(64) })
      const mocked = vi.spyOn(platform, 'loadAssignmentListReviewedMigrations').mockReturnValue(inventory)
      try { expect(() => createOfflineTestLearnerRepository(repository)).toThrow() }
      finally { mocked.mockRestore() }
    }
  })
  it('pins the full baseline and refuses unknown, missing and self-hashed changed migrations', () => {
    const migrations = loadAssignmentListReviewedMigrations(repository)
    expect(() => validateSurveyNativeMigrationProfile(migrations)).not.toThrow()
    for (const bad of [migrations.slice(0, 262), [...migrations, { name: '264_unknown.sql', sql: 'select 1;', sha256: 'a'.repeat(64) }],
      migrations.map((row, index) => index === 262 ? { ...row, name: '263_unknown.sql' } : row),
      migrations.map((row, index) => index === 100 ? { ...row, sha256: 'a'.repeat(64) } : row)])
      expect(() => validateSurveyNativeMigrationProfile(bad)).toThrow()
    const changed = migrations.map(row => ({ ...row })); changed[262].sql += '\n'
    changed[262].sha256 = createHash('sha256').update(changed[262].sql).digest('hex')
    expect(() => validateSurveyNativeMigrationProfile(changed)).toThrow()
  })
  it('retains mixed roles, owner self-enrollment and ownA/joinB without predecessor fixture SQL', () => {
    const m = plan(), f = m.fixture
    expect(f.actors.map(row => row.role)).toEqual(['student', 'teacher', 'student', 'student'])
    expect(f.enrollments).toContainEqual(expect.objectContaining({ actorId: f.actors[0].id, classroomId: f.classes[1].id }))
    expect(f.enrollments).toContainEqual(expect.objectContaining({ actorId: f.actors[3].id, classroomId: f.classes[0].id }))
    expect(f.enrollments.some(row => row.actorId === f.actors[2].id)).toBe(false)
    expect(f.aggregateResponse.actorId).toBe(f.actors[1].id)
    expect(f.aggregateResponse.surveyId).toBe(f.surveys[2].id)
    expect(f.aggregateQuestion.survey_id).toBe(f.surveys[2].id)
    expect(m.setup).toContain(f.aggregateResponse.text)
    const aggregateRace = m.concurrency.schedules.find(row => row.label === 'subject_purge_before_other_member_results:forward')!
    expect(aggregateRace.contender).toContain(`get_survey_results_for_member_v1('${f.actors[3].id}','${f.surveys[2].id}')`)
    expect(f.classes[0].owner).toBe(f.actors[0].id)
    expect(m.setup).not.toMatch(/insert into public\.(?:assignments|tests|assessment_drafts)/)
    expect(m.executionEnabled).toBe(false); expect(m.nativeVerified).toBe(false)
    expect(m.requiredBeforeAcceptance).toContain('committed-two-direction-freshness-and-restoration')
  })
  it('seals exact complete frames and keeps all thirty rollback directions immutable', () => {
    const m = plan()
    expect(m.concurrency.schedules).toHaveLength(30)
    for (const sql of [m.setup, m.snapshot, m.contracts.sql, ...m.concurrency.schedules.flatMap(row => [row.holder, row.contender])]) {
      expect(validateSurveyNativeSql(m, sql)).toBe(true)
      expect(validateSurveyNativeSql(m, sql + ' select 1;')).toBe(false)
    }
    expect(validateSurveyNativeSql(m, 'commit;')).toBe(false)
    expect(validateSurveyNativeSql(Object.freeze({ ...m, setup: 'delete from public.users;' }), 'delete from public.users;')).toBe(false)
    expect(Object.isFrozen(m.concurrency.schedules[0])).toBe(true)
    expect(Object.isFrozen(m.sources.migration)).toBe(true)
    expect(m.fixture.question.artifact_id).toBeTruthy()
    expect(m.fixture.question.source_artifact_id).toBeNull()
    expect(m.concurrency.schedules[0].holder).toContain('pg_catalog.pg_locks')
    expect(m.concurrency.schedules[0].holder).not.toContain('pg_sleep')
    expect(m.snapshot).toContain('jsonb_agg(to_jsonb(r)')
    expect(m.snapshot).toContain("n.nspname in ('public','private','storage')")
    expect(m.snapshot).toContain("'metadata'")
    expect(m.snapshot).toContain("'cron'")
  })
  it('requires root binding and consumes the exact workload once', () => {
    const m = plan()
    const bound = bindSurveyNativeLifecycleWorkload({ original, repository, reviewedHead: head,
      reviewedManifestSha256: digest(m), absoluteDeadline: Date.now() + 60000, rootReviewed: true, oneAttemptAuthorized: true, freshCapacityChecked: true })
    expect(validateSurveyNativeLifecycleWorkload(bound, original).projectId).toBe(m.projectId)
    expect(() => validateSurveyNativeLifecycleWorkload({ ...bound }, original)).toThrow()
    consumeSurveyNativeLifecycleWorkload(bound)
    expect(() => consumeSurveyNativeLifecycleWorkload(bound)).toThrow()
  })
  it('creates only an inert concrete engine facade, retaining existing session/action limits', () => {
    const m = buildSurveyNativeContractsManifest(original, head, repository)
    const engine = createContextualSurveysNativeContracts({ original, repository, reviewedHead: head,
      capturedResources: [], containerId: 'a'.repeat(64), acceptedManifestSha256: digest(m), absoluteDeadline: surveyEndpoint.budget.workDeadline,
      survey263Endpoint: surveyEndpoint })
    expect(Object.keys(engine).sort()).toEqual(['diagnostic', 'generateTypes263', 'manifest', 'nativeVerified', 'run', 'runSdkCommitted', 'setup', 'verifyTarget'])
    expect(m.capabilities.sessions).toBe(2); expect(m.capabilities.actions).toBe(200)
    expect(m.capabilities.totalMs).toBe(900000)
    expect(engine.nativeVerified).toBe(false)
    return expect(engine.runSdkCommitted()).rejects.toThrow('Survey SDK private status binding is absent')
  })
  it('settles both race sessions on a malformed observation and rejects wrong target before opening', async () => {
    const m = plan(), target = targetFor(m, 'concurrency'), closed = vi.fn(async () => {})
    const driver: DraftSaveDriver = { verifyTarget: async () => target,
      openSession: vi.fn(async name => ({ name, execute: async () => [{ result: { held: false } }], rollbackAndClose: closed })) }
    await expect(runSurveyNativeRollbackRaces(m, target, driver)).rejects.toThrow()
    expect(closed).toHaveBeenCalledTimes(2)
    const wrong = { ...target, databasePort: 54322 }
    vi.mocked(driver.openSession).mockClear()
    await expect(runSurveyNativeRollbackRaces(m, wrong, driver)).rejects.toThrow()
    expect(driver.openSession).not.toHaveBeenCalled()
  })
  it('requires a complete rollback run before SDK dispatch and rejects a hosted status binding', async () => {
    const m = buildSurveyNativeContractsManifest(original, head, repository)
    const statusTarget = { API_URL: 'http://127.0.0.1:54331', DB_URL: 'postgresql://postgres:offline@127.0.0.1:54332/postgres',
      SERVICE_ROLE_KEY: `header.${Buffer.from(JSON.stringify({ iss: 'supabase-demo', role: 'service_role' })).toString('base64url')}.signature` }
    const input = { original, repository, reviewedHead: head, capturedResources: [], containerId: 'a'.repeat(64),
      acceptedManifestSha256: digest(m), absoluteDeadline: surveyEndpoint.budget.workDeadline, statusTarget, survey263Endpoint: surveyEndpoint }
    await expect(createContextualSurveysNativeContracts(input).runSdkCommitted()).rejects.toThrow()
    await expect(createContextualSurveysNativeContracts(input).generateTypes263()).rejects.toThrow()
    expect(() => createContextualSurveysNativeContracts({ ...input, statusTarget: { ...statusTarget, API_URL: 'https://example.invalid' } })).toThrow()
  })
  it('checks all12 generated RPC Args/Json contracts without accepting hash, optional or substituted type drift', () => {
    const jsonNames = new Set(['p_patch', 'p_question', 'p_expected_question', 'p_expected_questions', 'p_responses'])
    const source = `type Json = string | null; export type Database = { public: { Functions: {${
      Object.entries(SURVEY_RPC_ARGUMENTS).map(([name, args]) => `${name}: { Args: { ${args.map(arg =>
        `${arg}: ${jsonNames.has(arg) ? 'Json' : 'string'}`).join(';')} }; Returns: Json }`).join(';')
    }} } }`
    const sha = (value: string) => createHash('sha256').update(value).digest('hex')
    expect(validateSurveyGeneratedTypes(source, sha(source))).toBe(true)
    const hot='set_classroom_hot_archive_for_owner_v1: {Args: {p_actor_id: string; p_classroom_id: string; p_archived: boolean}; Returns: Json};'
    const withFoundation=source.replace('Functions: {',`Functions: {${hot}`)
    expect(validateSurvey269ComponentGeneratedTypes(withFoundation,sha(withFoundation))).toBe(true)
    expect(()=>validateSurvey269ComponentGeneratedTypes(source,sha(source))).toThrow()
    for (const changed of [withFoundation.replace('p_archived: boolean','p_archived: string'),withFoundation.replace('p_archived: boolean','p_archived?: boolean')])
      expect(()=>validateSurvey269ComponentGeneratedTypes(changed,sha(changed))).toThrow()
    expect(() => validateSurveyGeneratedTypes(source, 'a'.repeat(64))).toThrow()
    for (const changed of [source.replace('get_surveys_for_owner_v1', 'unknown_owner_rpc'),
      source.replace('p_actor_id: string', 'p_actor_id?: string'), source.replace('p_actor_id: string', 'p_actor_id: number'),
      source.replace('p_patch: Json', 'p_patch: string'), source.replace('Returns: Json', 'Returns: string')])
      expect(() => validateSurveyGeneratedTypes(changed, sha(changed))).toThrow()
  })
  it('does not claim closure success when either independent session close rejects', async () => {
    const m = plan(), target = targetFor(m, 'concurrency'), closed: string[] = []
    const driver: DraftSaveDriver = { verifyTarget: async () => target, openSession: async name => ({ name,
      execute: async () => [{ result: { held: true, transaction: true, pid: 42, name } }],
      rollbackAndClose: async () => { closed.push(name); if (name.endsWith('_draft_holder')) throw new Error('private detail') },
    }) }
    await expect(runSurveyNativeRollbackRaces(m, target, driver)).rejects.toThrow('Survey exact session cleanup unconfirmed')
    expect(closed).toHaveLength(2)
  })
  it('closes the rollback contract after a dispatch failure', async () => {
    const m = plan(), target = targetFor(m, 'contracts'), close = vi.fn(async () => {})
    const driver: DraftSaveDriver = { verifyTarget: async () => target, openSession: async name => ({ name,
      execute: async () => { throw new Error('private native failure') }, rollbackAndClose: close }) }
    await expect(runSurveyNativeRollbackContracts(m, target, driver)).rejects.toThrow()
    expect(close).toHaveBeenCalledOnce()
  })
  it.each(['normal', 'after-fixture', 'before-capture', 'run-failure', 'types-failure', 'cleanup-failure', 'unsealed', 'remaining-admission',
    'mutated-selector', 'mutated-workload', 'mutated-both'] as const)('keeps original outer cleanup while skipping every predecessor acceptance case: %s', async mode => {
    const m = plan(), projectId = m.projectId, workdir = assignmentListProofWorkdir(projectId)
    const migrations = loadAssignmentListReviewedMigrations(repository)
    const expected = assignmentListExpectedResources(projectId)
    const resources: AssignmentListResource[] = expected.map((row, index) => ({ ...row,
      id: createHash('sha256').update(row.name + row.kind).digest('hex'), createdAt: 'offline-new',
      labels: { 'com.supabase.cli.project': projectId, 'com.docker.compose.project': projectId }, attachedIds: [],
      ports: index === 0 ? [54332] : index === 4 ? [54331] : [],
    }))
    const network = resources.find(row => row.kind === 'network')!
    for (const container of resources.filter(row => row.kind === 'container')) {
      container.attachedIds = [network.id]
      const volume = resources.find(row => row.kind === 'volume' && row.name === container.name)
      if (volume) { container.attachedIds.push(volume.id); volume.attachedIds = [container.id] }
    }
    network.attachedIds = resources.filter(row => row.kind === 'container').map(row => row.id)
    const target = { API_URL: 'http://127.0.0.1:54331', DB_URL: 'postgresql://postgres:offline@127.0.0.1:54332/postgres',
      SERVICE_ROLE_KEY: `header.${Buffer.from(JSON.stringify({ iss: 'supabase-demo', role: 'service_role' })).toString('base64url')}.signature` }
    let started = false, prepared = false
    const canonical = { rowDigests: 'complete', guard168Metadata: 'complete', settings: 'complete', cronJobs: 'complete', resources: 'complete' }
    const setup = vi.fn(async () => ({ fixtureSha256: digest(m.fixture), setupSha256: digest(m.setup) }))
    const run = vi.fn(async () => {
      if (mode === 'run-failure') throw new Error('Offline Survey phase failure')
      return { contracts: { kind: 'survey-rollback-sql', nativeVerified: false, sourceSha256: m.sourceSha256 },
        races: { kind: 'survey-rollback-contention-only', schedules: [], nativeVerified: false,
          limitation: 'No committed freshness, exact waiter graph or SDK/cancellation/payload acceptance is claimed' },
        fixtureUnchanged: true, manifestSha256: '', controls: 0, actions: 0, exchangeBytes: 0, remainingSessions: 0 }
    })
    const runSdkCommitted = vi.fn(async () => ({ kind: 'survey-sdk-terminal-only' as const,
      sdk: { calls: 14, bytes: 0, receipts: [], nativeVerified: false as const },
      effects: { kind: 'sdk-terminal-effects', sourcePreserved: true, nativeVerified: false as const,
        archiveRevisionDelta: 11, blueprintRevisionDelta: 5 },
      metadataUnchanged: true, cronUnchanged: true, nativeVerified: false as const,
      manifestSha256: '', controls: 0, actions: 0, exchangeBytes: 0, remainingSessions: 0,
    }))
    const generatedReceipt = { path: 'offline-only.ts', sha256: 'a'.repeat(64), bytes: 0,
      reviewedHead: head, migrationManifestSha256: m.migrationManifestSha256, configSha256: 'a'.repeat(64),
      kind: 'genuine-survey263-types' as const, validatedRpcContracts: 12, nativeVerified: false as const,
    }
    const generateTypes263 = vi.fn(async () => {
      if (mode === 'types-failure') throw new Error('Offline type generation failure')
      return generatedReceipt
    })
    const factory = nativeEngine.createContextualSurveysNativeContracts
    const mock = vi.spyOn(nativeEngine, 'createContextualSurveysNativeContracts').mockImplementation(input => ({
      ...factory(input), setup, run, runSdkCommitted, generateTypes263,
    }))
    const now = Date.now(), boundEndpoint = { ...surveyEndpoint, budget: { startedAt: now - 660000, workDeadline: now + 60000, cleanupDeadline: now + 240000 } }
    const gate = mode === 'unsealed' ? undefined : vi.spyOn(platform, 'requireSurvey263AdapterEndpoint').mockReturnValue(boundEndpoint)
    const cleanupGate = mode === 'unsealed' ? undefined : vi.spyOn(platform, 'beginSurvey263AdapterCleanup').mockImplementation(() => {})
    const totalGate = mode === 'unsealed' ? undefined : vi.spyOn(platform, 'checkSurvey263AdapterTotal').mockImplementation(() => {})
    const mutatesInput = mode.startsWith('mutated-')
    let releaseFirstSnapshot: (() => void) | undefined
    const adapters: AssignmentListLifecycleAdapters = {
      checkWork: vi.fn(),
      canonicalSnapshot: vi.fn(async () => {
        if (mutatesInput && releaseFirstSnapshot === undefined)
          await new Promise<void>(resolve => { releaseFirstSnapshot = resolve })
        return mode === 'cleanup-failure' && started === false && prepared === false
          && setup.mock.calls.length > 0 ? { ...canonical, rowDigests: 'different' } : canonical
      }),
      inventory: vi.fn(async () => ({ resources: started ? resources : [], occupiedPorts: started ? [54331, 54332] : [], workdirExists: prepared })),
      prepare: vi.fn(async p => { prepared = true; return { workdir, realpath: workdir, created: true,
        configSha256: createHash('sha256').update(p.config).digest('hex'), migrations: migrations.map(({ name, sha256 }) => ({ name, sha256 })), envFiles: [], symlinks: [] } }),
      command: vi.fn(async request => { if (request.args[0] === 'start') started = true; return request.args[0] === 'status' ? target : undefined }),
      verifyEphemeral: vi.fn(async () => ({ projectId, containerId: resources[0].id, applicationName: `${projectId}_fixture`, dbPort: 54332 as const,
        guard168Enabled: true, persistedGatesOff: true, activeNetworkCronAbsent: true })),
      executeSql: vi.fn(), runCase: vi.fn(), runRevocation: vi.fn(), verifyRestoration: vi.fn(),
      teardown: vi.fn(async () => { started = false }), removeWorkdir: vi.fn(async () => { prepared = false }),
    }
    const workload = bindSurveyNativeLifecycleWorkload({ original, repository, reviewedHead: head, reviewedManifestSha256: digest(m),
      absoluteDeadline: boundEndpoint.budget.workDeadline, rootReviewed: true, oneAttemptAuthorized: true, freshCapacityChecked: true })
    try {
      const lifecycleInput: AssignmentListLifecycleInput = { fixture: original, projectId, workdir, migrations,
        reviewedManifestSha256: digest(original.manifest), mode: mode === 'run-failure' || mode === 'types-failure' || mode === 'cleanup-failure' || mode === 'unsealed' || mode === 'remaining-admission' || mutatesInput ? 'normal' : mode as 'normal' | 'after-fixture' | 'before-capture',
        expectedResources: expected, restorationPolicies: [], surveyWorkload: workload,
        ...(mode === 'remaining-admission' ? { surveyRemainingOnly: true as const } : {}) }
      const operation = runAssignmentListEphemeralLifecycle(lifecycleInput, adapters)
      if (mutatesInput) {
        expect(releaseFirstSnapshot).toBeTypeOf('function')
        if (mode !== 'mutated-workload') lifecycleInput.surveyRemainingOnly = true
        if (mode !== 'mutated-selector') lifecycleInput.surveyWorkload = undefined
        releaseFirstSnapshot!()
      }
      if (mode === 'remaining-admission') {
        await expect(operation).rejects.toThrow('complete native inventory is absent')
        expect(adapters.canonicalSnapshot).not.toHaveBeenCalled(); expect(adapters.inventory).not.toHaveBeenCalled()
        expect(adapters.command).not.toHaveBeenCalled(); expect(setup).not.toHaveBeenCalled()
        expect(() => consumeSurveyNativeLifecycleWorkload(workload)).not.toThrow()
        return
      }
      if (mode === 'unsealed') {
        await expect(operation).rejects.toThrow('Survey263 requires the sealed local platform transport')
        expect(adapters.canonicalSnapshot).not.toHaveBeenCalled(); expect(adapters.inventory).not.toHaveBeenCalled()
        expect(adapters.command).not.toHaveBeenCalled(); expect(setup).not.toHaveBeenCalled()
        expect(() => consumeSurveyNativeLifecycleWorkload(workload)).not.toThrow()
        return
      }
      if (mode === 'normal' || mutatesInput) await expect(operation).resolves.toMatchObject({ cases: 0, revocations: 0, nativeVerified: false,
        surveyProofScope: 'rollback-and-sdk-terminal', surveyTypes: generatedReceipt })
      else if (mode === 'cleanup-failure') await expect(operation).rejects.toMatchObject({ cleanupFailures: [{ stage: 'canonical-after' }] })
      else await expect(operation).rejects.toMatchObject({ cleanupFailures: [] })
      expect(setup).toHaveBeenCalledOnce()
      const reachesTypes = ['normal', 'types-failure', 'cleanup-failure'].includes(mode) || mutatesInput
      if (mutatesInput) {
        expect(mock).toHaveBeenCalledWith(expect.objectContaining({ remainingOnly: undefined }))
        expect(run).toHaveBeenCalledOnce()
      }
      expect(runSdkCommitted).toHaveBeenCalledTimes(reachesTypes ? 1 : 0)
      expect(generateTypes263).toHaveBeenCalledTimes(reachesTypes ? 1 : 0)
      expect(adapters.executeSql).not.toHaveBeenCalled(); expect(adapters.runCase).not.toHaveBeenCalled(); expect(adapters.runRevocation).not.toHaveBeenCalled()
      expect(adapters.teardown).toHaveBeenCalledWith(expect.objectContaining({ resources, projectId }))
      expect(adapters.removeWorkdir).toHaveBeenCalledOnce(); expect(adapters.canonicalSnapshot).toHaveBeenCalledTimes(2)
      expect(started).toBe(false); expect(prepared).toBe(false)
    } finally { mock.mockRestore(); gate?.mockRestore(); cleanupGate?.mockRestore(); totalGate?.mockRestore() }
  })
})
