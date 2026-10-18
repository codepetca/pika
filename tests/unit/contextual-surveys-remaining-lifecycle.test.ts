/** Offline coordination only: these doubles never establish native acceptance. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import * as plans from '../../scripts/contextual-surveys-native-contracts'
import * as engine from '../../scripts/contextual-test-draft-save-native-contracts'
import * as platform from '../../scripts/contextual-assignment-list-proof-platform'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { assignmentListProofWorkdir } from '../../scripts/contextual-assignment-list-proof-path'
import { assignmentListExpectedResources, runAssignmentListEphemeralLifecycle,
  type AssignmentListLifecycleAdapters, type AssignmentListLifecycleInput, type AssignmentListResource } from '../../scripts/contextual-assignment-list-proof-lifecycle'

const digest = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
afterEach(() => vi.restoreAllMocks())

function harness(failure?: 'committed' | 'sdk' | 'types' | 'unjoined' | 'preservation') {
  const fixture = newAssignmentListProofFixture(new Date('2026-10-12T12:00:00Z'))
  const projectId = `pika_assignment_list_${fixture.manifest.syntheticTag.slice(-12)}`
  const workdir = assignmentListProofWorkdir(projectId), now = Date.now()
  const migrations = Array.from({ length: 269 }, (_, index) => ({ name: `${String(index + 1).padStart(3, '0')}_offline.sql`, sql: 'select 1;', sha256: digest('select 1;') }))
  const workload = Object.freeze({ kind: 'survey269-remaining-only', projectId, absoluteDeadline: now + 720000, binding: {}, reviewedManifestSha256: 'a'.repeat(64), nativeVerified: false }) as plans.Survey269RemainingWorkload
  const plan = { migrationManifestSha256: digest(migrations.map(({ name, sha256 }) => ({ name, sha256 }))), inventoryComplete: true }
  const validate = vi.spyOn(plans, 'validateSurvey269RemainingWorkload').mockReturnValue(plan as never)
  const consume = vi.spyOn(plans, 'consumeSurvey269RemainingWorkload').mockImplementation(() => {})
  const expectedResources = assignmentListExpectedResources(projectId)
  const resources: AssignmentListResource[] = expectedResources.map((row, index) => ({ ...row, id: digest(row), createdAt: 'offline',
    labels: { 'com.supabase.cli.project': projectId, 'com.docker.compose.project': projectId }, attachedIds: [], ports: index === 0 ? [54332] : index === 4 ? [54331] : [] }))
  const target = { API_URL: 'http://127.0.0.1:54331', DB_URL: 'postgresql://postgres:offline@127.0.0.1:54332/postgres',
    SERVICE_ROLE_KEY: `header.${Buffer.from(JSON.stringify({ iss: 'supabase-demo', role: 'service_role' })).toString('base64url')}.signature` }
  const token = Object.freeze({ kind: 'survey269-component-exchange' as const })
  const endpoint = { kind: 'survey263' as const, host: 'unix:///offline.sock', identity: [1, 2, 3, 4] as const,
    budget: { startedAt: now, workDeadline: now + 720000, cleanupDeadline: now + 900000 }, nativeCli: platform.SURVEY263_NATIVE_CLI, componentExchange: token }
  vi.spyOn(platform, 'requireSurvey263AdapterEndpoint').mockReturnValue(endpoint)
  vi.spyOn(platform, 'assertSurvey269RemainingExchange').mockImplementation(() => {})
  let requests = 0, poisoned = false, started = false, prepared = false, snapshots = 0
  vi.spyOn(platform, 'survey269ComponentExchangeReceipt').mockImplementation(() => ({ bytes: 100, limit: 67108864, controls: 100, controlLimit: 6000, requests, requestLimit: 16, channels: [] }) as never)
  const cleanup = vi.spyOn(platform, 'beginSurvey263AdapterCleanup').mockImplementation((_adapters, unjoined) => { poisoned = Boolean(unjoined) })
  vi.spyOn(platform, 'checkSurvey263AdapterTotal').mockImplementation(() => { if (poisoned) throw new Error('Offline unjoined') })
  const check = () => { if (poisoned) throw new Error('Offline unjoined') }
  const stages: string[] = []
  const committed = Object.freeze({ kind: 'offline-remaining-receipt', nativeVerified: false })
  const sdk = Object.freeze({ kind: 'offline-sdk-receipt', nativeVerified: false })
  const generated = Object.freeze({ kind: 'genuine-survey269-types', path: 'offline-only.ts', bytes: 1 })
  const native = {
    setup: vi.fn(async () => { stages.push('setup') }), diagnostic: () => 'offline-fixed-label',
    runRemainingCommitted: vi.fn(async () => { stages.push('remaining'); requests = 2
      if (failure === 'unjoined') throw new platform.Survey263UnjoinedChildError()
      if (failure === 'committed') throw new Error('Offline committed failure')
      return committed }),
    runSdkCommitted: vi.fn(async () => { stages.push('sdk'); if (failure === 'sdk') throw new Error('Offline SDK failure'); requests = 16; return sdk }),
    generateTypes269: vi.fn(async () => { stages.push('types'); if (failure === 'types') throw new Error('Offline types failure'); return generated }),
  }
  // The facade is a closed source-owned factory in production; only this offline test substitutes it.
  vi.spyOn(engine, 'buildSurvey269RemainingManifest').mockReturnValue(plan as never)
  const factory = vi.spyOn(engine, 'createSurvey269RemainingNativeContracts').mockReturnValue(native as never)
  const canonical = { rowDigests: 'complete', guard168Metadata: 'complete', settings: 'complete', cronJobs: 'complete', resources: 'complete' }
  const adapters: AssignmentListLifecycleAdapters = {
    checkWork: vi.fn(check),
    canonicalSnapshot: vi.fn(async () => { check(); snapshots++; return failure === 'preservation' && snapshots === 2 ? { ...canonical, rowDigests: 'changed' } : canonical }),
    inventory: vi.fn(async () => { check(); return { resources: started ? resources : [], occupiedPorts: started ? [54331, 54332] : [], workdirExists: prepared } }),
    prepare: vi.fn(async p => { check(); prepared = true; return { workdir, realpath: workdir, created: true, configSha256: digest(p.config), migrations: migrations.map(({ name, sha256 }) => ({ name, sha256 })), envFiles: [], symlinks: [] } }),
    command: vi.fn(async request => { check(); if (request.args[0] === 'start') started = true; return request.args[0] === 'status' ? target : undefined }),
    verifyEphemeral: vi.fn(async () => { check(); return { projectId, containerId: resources[0].id, applicationName: `${projectId}_fixture`, dbPort: 54332 as const, guard168Enabled: true, persistedGatesOff: true, activeNetworkCronAbsent: true } }),
    executeSql: vi.fn(), runCase: vi.fn(), runRevocation: vi.fn(), verifyRestoration: vi.fn(),
    teardown: vi.fn(async () => { check(); started = false }), removeWorkdir: vi.fn(async () => { check(); prepared = false }),
  }
  const input: AssignmentListLifecycleInput = { fixture, projectId, workdir, migrations, reviewedManifestSha256: digest(fixture.manifest), mode: 'normal', expectedResources, restorationPolicies: [], survey269RemainingWorkload: workload }
  return { input, adapters, native, stages, committed, sdk, generated, validate, consume, cleanup, factory, endpoint }
}

describe('remaining Survey269 lifecycle coordination, offline only', () => {
  it('runs one closed remaining phase before SDK/types and retains real phase receipts without declaring acceptance', async () => {
    const h = harness()
    await expect(runAssignmentListEphemeralLifecycle(h.input, h.adapters)).resolves.toMatchObject({
      cases: 0, revocations: 0, surveyProofScope: 'remaining-survey-native-proof', nativeVerified: false, inventoryComplete: true,
      surveyRemaining: h.committed, surveySdk: h.sdk, surveyTypes: h.generated, exchange: { requests: 16, controlLimit: 6000 },
    })
    expect(h.stages).toEqual(['setup', 'remaining', 'sdk', 'types'])
    expect(h.consume).toHaveBeenCalledOnce(); expect(h.validate).toHaveBeenCalledTimes(3)
    expect(h.adapters.teardown).toHaveBeenCalledOnce(); expect(h.adapters.removeWorkdir).toHaveBeenCalledOnce()
    expect(h.adapters.runCase).not.toHaveBeenCalled(); expect(h.adapters.executeSql).not.toHaveBeenCalled()
    // Exact outer call schedule. Concrete adapter internals add four inventory
    // calls for canonical snapshots, three for verifyEphemeral and one teardown.
    expect(h.adapters.inventory).toHaveBeenCalledTimes(9)
    expect(h.adapters.canonicalSnapshot).toHaveBeenCalledTimes(2)
    expect(h.adapters.verifyEphemeral).toHaveBeenCalledOnce()
    expect(h.adapters.command).toHaveBeenCalledTimes(2)
    expect(h.adapters.prepare).toHaveBeenCalledOnce()
  })
  it.each(['committed', 'sdk', 'types', 'preservation'] as const)('rejects %s failure and still checks owned cleanup', async failure => {
    const h = harness(failure)
    await expect(runAssignmentListEphemeralLifecycle(h.input, h.adapters)).rejects.toThrow('isolated lifecycle failed')
    expect(h.adapters.teardown).toHaveBeenCalledOnce(); expect(h.adapters.removeWorkdir).toHaveBeenCalledOnce()
    expect(h.cleanup).toHaveBeenCalledWith(h.adapters, false)
    if (failure === 'committed') expect(h.native.runSdkCommitted).not.toHaveBeenCalled()
    if (failure === 'sdk') expect(h.native.generateTypes269).not.toHaveBeenCalled()
  })
  it('keeps the unjoined poison barrier ahead of destructive teardown and all later phases', async () => {
    const h = harness('unjoined')
    await expect(runAssignmentListEphemeralLifecycle(h.input, h.adapters)).rejects.toThrow('isolated lifecycle failed')
    expect(h.cleanup).toHaveBeenCalledWith(h.adapters, true)
    expect(h.adapters.teardown).not.toHaveBeenCalled(); expect(h.adapters.removeWorkdir).not.toHaveBeenCalled()
    expect(h.native.runSdkCommitted).not.toHaveBeenCalled(); expect(h.native.generateTypes269).not.toHaveBeenCalled()
  })
  it.each(['survey269ComponentWorkload', 'surveyWorkload', 'surveyRemainingOnly'] as const)('rejects a combined %s profile before any adapter operation', async key => {
    const h = harness(); Object.assign(h.input, { [key]: key === 'surveyRemainingOnly' ? true : h.input.survey269RemainingWorkload })
    await expect(runAssignmentListEphemeralLifecycle(h.input, h.adapters)).rejects.toThrow('profiles cannot be combined')
    expect(h.consume).not.toHaveBeenCalled(); expect(h.adapters.canonicalSnapshot).not.toHaveBeenCalled()
  })
  it('rejects a renewed deadline before workload consumption', async () => {
    const h = harness(); h.endpoint.budget.workDeadline++
    await expect(runAssignmentListEphemeralLifecycle(h.input, h.adapters)).rejects.toThrow('original work deadline differs')
    expect(h.consume).not.toHaveBeenCalled(); expect(h.adapters.canonicalSnapshot).not.toHaveBeenCalled()
  })
  it('refuses a missing actual request before type generation and still cleans up', async () => {
    const h = harness()
    h.native.runSdkCommitted.mockImplementation(async () => h.sdk)
    await expect(runAssignmentListEphemeralLifecycle(h.input, h.adapters)).rejects.toMatchObject({ primary: { stage: 'survey-sdk-terminal' } })
    expect(h.native.generateTypes269).not.toHaveBeenCalled(); expect(h.adapters.teardown).toHaveBeenCalledOnce()
  })
  it('retains the original remaining selector and workload across an async caller mutation', async () => {
    const h = harness()
    const canonical = h.adapters.canonicalSnapshot
    let release!: () => void
    vi.mocked(h.adapters.canonicalSnapshot).mockImplementationOnce(async request => {
      await new Promise<void>(resolve => { release = resolve })
      return canonical(request)
    })
    const operation = runAssignmentListEphemeralLifecycle(h.input, h.adapters)
    expect(release).toBeTypeOf('function')
    h.input.survey269RemainingWorkload = undefined; h.input.surveyRemainingOnly = true
    release()
    await expect(operation).resolves.toMatchObject({ surveyProofScope: 'remaining-survey-native-proof' })
    expect(h.factory).toHaveBeenCalledOnce(); expect(h.native.runRemainingCommitted).toHaveBeenCalledOnce()
  })
})
