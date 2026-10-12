import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
const fsFaults = vi.hoisted(() => ({ sdkProofDrift: false }))
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, readFileSync: ((path, options) => {
    const value = actual.readFileSync(path, options)
    if (fsFaults.sdkProofDrift && String(path).endsWith('/scripts/contextual-surveys-sdk-proof.ts'))
      return Buffer.isBuffer(value) ? Buffer.concat([value, Buffer.from('\n// changed SDK oracle source')]) : value + '\n// changed SDK oracle source'
    return value
  }) as typeof actual.readFileSync }
})
import * as platform from '../../scripts/contextual-assignment-list-proof-platform'
import { createOfflineTestLearnerRepository } from '../helpers/test-learner-native-repository'
import * as nativeEngine from '../../scripts/contextual-test-draft-save-native-contracts'
import { assignmentListExpectedResources, runAssignmentListEphemeralLifecycle,
  type AssignmentListLifecycleAdapters, type AssignmentListResource } from '../../scripts/contextual-assignment-list-proof-lifecycle'
import { assignmentListProofWorkdir } from '../../scripts/contextual-assignment-list-proof-path'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { loadAssignmentListReviewedMigrations } from '../../scripts/contextual-assignment-list-proof-platform'
import { surveyNativePlan, validateSurveyNativeMigrationProfile, validateSurveyNativeSql,
  bindSurveyNativeLifecycleWorkload, validateSurveyNativeLifecycleWorkload, consumeSurveyNativeLifecycleWorkload,
  runSurveyNativeRollbackRaces, runSurveyNativeRollbackContracts, validateSurveyGeneratedTypes,
  SURVEY_RPC_ARGUMENTS } from '../../scripts/contextual-surveys-native-contracts'
import { buildSurveyNativeContractsManifest, createContextualSurveysNativeContracts } from '../../scripts/contextual-test-draft-save-native-contracts'
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
    expect(f.actors.map(row => row.role)).toEqual(['student', 'teacher', 'student'])
    expect(f.enrollments).toContainEqual(expect.objectContaining({ actorId: f.actors[0].id, classroomId: f.classes[1].id }))
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
      capturedResources: [], containerId: 'a'.repeat(64), acceptedManifestSha256: digest(m), absoluteDeadline: Date.now() + 60000 })
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
      acceptedManifestSha256: digest(m), absoluteDeadline: Date.now() + 60000, statusTarget }
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
  it.each(['normal', 'after-fixture', 'before-capture', 'run-failure', 'types-failure', 'cleanup-failure'] as const)('keeps original outer cleanup while skipping every predecessor acceptance case: %s', async mode => {
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
    const adapters: AssignmentListLifecycleAdapters = {
      canonicalSnapshot: vi.fn(async () => mode === 'cleanup-failure' && started === false && prepared === false
        && setup.mock.calls.length > 0 ? { ...canonical, rowDigests: 'different' } : canonical),
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
      absoluteDeadline: Date.now() + 60000, rootReviewed: true, oneAttemptAuthorized: true, freshCapacityChecked: true })
    try {
      const operation = runAssignmentListEphemeralLifecycle({ fixture: original, projectId, workdir, migrations,
        reviewedManifestSha256: digest(original.manifest), mode: mode === 'run-failure' || mode === 'types-failure' || mode === 'cleanup-failure' ? 'normal' : mode,
        expectedResources: expected, restorationPolicies: [], surveyWorkload: workload }, adapters)
      if (mode === 'normal') await expect(operation).resolves.toMatchObject({ cases: 0, revocations: 0, nativeVerified: false,
        surveyProofScope: 'rollback-and-sdk-terminal', surveyTypes: generatedReceipt })
      else if (mode === 'cleanup-failure') await expect(operation).rejects.toMatchObject({ cleanupFailures: [{ stage: 'canonical-after' }] })
      else await expect(operation).rejects.toMatchObject({ cleanupFailures: [] })
      expect(setup).toHaveBeenCalledOnce()
      const reachesTypes = ['normal', 'types-failure', 'cleanup-failure'].includes(mode)
      expect(runSdkCommitted).toHaveBeenCalledTimes(reachesTypes ? 1 : 0)
      expect(generateTypes263).toHaveBeenCalledTimes(reachesTypes ? 1 : 0)
      expect(adapters.executeSql).not.toHaveBeenCalled(); expect(adapters.runCase).not.toHaveBeenCalled(); expect(adapters.runRevocation).not.toHaveBeenCalled()
      expect(adapters.teardown).toHaveBeenCalledWith(expect.objectContaining({ resources, projectId }))
      expect(adapters.removeWorkdir).toHaveBeenCalledOnce(); expect(adapters.canonicalSnapshot).toHaveBeenCalledTimes(2)
      expect(started).toBe(false); expect(prepared).toBe(false)
    } finally { mock.mockRestore() }
  })
})
