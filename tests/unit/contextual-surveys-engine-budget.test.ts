/** Actual Survey engine + generator + bounded inventory, with only offline
 * fs/child/HTTP and phase-oracle seams. No native operation or artifact. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { createHash } from 'node:crypto'
const seam = vi.hoisted(() => ({ exec: vi.fn(), spawn: vi.fn(), collect: vi.fn(), http: vi.fn(),
  repository: '', workdir: '', config: '', head: 'a'.repeat(40), host: 'unix:///offline-engine.sock',
  held: false, component: false, brokenMetadata: false, holdReaders: false, holdMetadata: false, holdClose: false, poisonAfterBootstrap: false, cliReply: 'held', children: [] as string[], readers: [] as string[],
  spawnCalls: [] as string[], metadataReplies: [] as Array<() => void>,
  afterBootstrap: undefined as (()=>void)|undefined, terminations: 0, closedSessions: 0,
  replies: [] as Array<() => void>, manifest: {} as Record<string, unknown>, writes: new Map<string, string>() }))
vi.mock('node:child_process', () => ({ execFile: seam.exec, spawn: seam.spawn }))
vi.mock('node:http', async original => ({ ...await original<typeof import('node:http')>(), request: seam.http }))
vi.mock('node:fs', async original => {
  const fs = await original<typeof import('node:fs')>()
  return { ...fs,
    realpathSync: (path: string) => path === '/offline-engine.sock' || path === seam.workdir || (seam.component && path === '/Users/stew/.codex/worktrees/pika/contextual-surveys-current-main') ? path : fs.realpathSync(path),
    readdirSync: ((path, options) => {
      const mapped=seam.component && String(path).startsWith('/Users/stew/.codex/worktrees/pika/contextual-surveys-current-main/') ? String(path).replace('/Users/stew/.codex/worktrees/pika/contextual-surveys-current-main',seam.repository) : path
      return Reflect.apply(fs.readdirSync,fs,options===undefined ? [mapped] : [mapped,options])
    }) as typeof fs.readdirSync,
    statSync: (path: string) => path === '/offline-engine.sock' ? { dev: 1, ino: 2, mode: 3, rdev: 4, isSocket: () => true } : fs.statSync(path),
    readFileSync: ((path, encoding) => {
      if (typeof path === 'string' && path.startsWith(seam.workdir + '/supabase/migrations/'))
        return fs.readFileSync(seam.repository + '/supabase/migrations/' + path.split('/').at(-1), encoding)
      if (path === seam.workdir + '/supabase/config.toml') return seam.config
      if (typeof path === 'string' && seam.writes.has(path)) return seam.writes.get(path)
      if (seam.component && typeof path === 'string' && path.startsWith('/Users/stew/.codex/worktrees/pika/contextual-surveys-current-main/'))
        return fs.readFileSync(path.replace('/Users/stew/.codex/worktrees/pika/contextual-surveys-current-main', seam.repository).replace('269_contextual_surveys_workflow.sql','263_contextual_surveys_workflow.sql'), encoding)
      return fs.readFileSync(path, encoding)
    }) as typeof fs.readFileSync,
    writeFileSync: vi.fn((path: string, value: string) => { seam.writes.set(path, value) }),
  }
})
vi.mock('../../scripts/contextual-test-owner-list-proof-inventory', () => ({ testOwnerListDockerInventory: seam.collect }))
vi.mock('../../scripts/check-contextual-test-draft-save-db-contracts', async original=>{
  const actual=await original<typeof import('../../scripts/check-contextual-test-draft-save-db-contracts')>()
  return {...actual,draftSaveMigrationManifestSha256:(repository:string)=>seam.component && repository==='/Users/stew/.codex/worktrees/pika/contextual-surveys-current-main'
    ? '8f04596017722989202df72acd5cc38f9b705b09b941da4c32d3315070808baf' : actual.draftSaveMigrationManifestSha256(repository)}
})
vi.mock('../../scripts/contextual-surveys-native-contracts', async original => ({
  ...await original<typeof import('../../scripts/contextual-surveys-native-contracts')>(),
  runSurveyNativeRollbackContracts: vi.fn(async () => ({})), runSurveyNativeRollbackRaces: vi.fn(async () => ({})), runSurvey269ComponentRollback: vi.fn(async () => ({})),
}))
vi.mock('../../scripts/contextual-surveys-sdk-contracts', () => ({ runContextualSurveysSdkContracts: vi.fn(async () => {}) }))
vi.mock('../../scripts/contextual-surveys-sdk-proof', async original => ({
  ...await original<typeof import('../../scripts/contextual-surveys-sdk-proof')>(),
  createSurveySdkProofTransport: vi.fn(() => ({ client: {}, start: vi.fn(), complete: () => ({ calls: 14, nativeVerified: false }) })),
  verifySurveySdkTerminalEffects: vi.fn(() => ({ nativeVerified: false })),
}))
import { createContextualSurveysNativeContracts, buildSurveyNativeContractsManifest, buildSurvey269ComponentManifest, createSurvey269ComponentNativeContracts } from '../../scripts/contextual-test-draft-save-native-contracts'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { assignmentListExpectedResources, assignmentListEphemeralPlan, runAssignmentListEphemeralLifecycle,
  type AssignmentListLifecycleAdapters, type AssignmentListResource } from '../../scripts/contextual-assignment-list-proof-lifecycle'
import * as platform from '../../scripts/contextual-assignment-list-proof-platform'
import { surveyNativePlan, bindSurveyNativeLifecycleWorkload } from '../../scripts/contextual-surveys-native-contracts'
import * as surveyContracts from '../../scripts/contextual-surveys-native-contracts'
const offlineRaceOracle = vi.mocked(surveyContracts.runSurveyNativeRollbackRaces).getMockImplementation()!
const original = newAssignmentListProofFixture(), repository = process.cwd()
const manifest = buildSurveyNativeContractsManifest(original, seam.head, repository)
const projectId = manifest.projectId, workdir = `/private/tmp/pika-assignment-list-${projectId.slice(-12)}`
const template = '{"id":{{json .Id}},"name":{{json .Name}},"labels":{{json .Config.Labels}},"mounts":{{json .Mounts}},"networks":{{json .NetworkSettings.Networks}},"bindings":{{json .HostConfig.PortBindings}},"created":{{json .Created}}}'
const ids = ['1', '2', '3'].map(value => value.repeat(64))
const snapshot = [{ table: 'public.surveys', rows: [] }, { metadata: {} }, { cron: [] }].map(row => JSON.stringify(row)).join('\n')
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
let startedAt: number
const budget = () => ({ startedAt, workDeadline: startedAt + 720000, cleanupDeadline: startedAt + 900000 })
const binding = () => ({ kind: 'survey263' as const, host: seam.host, identity: [1, 2, 3, 4] as const,
  budget: budget(), nativeCli: platform.SURVEY263_NATIVE_CLI })
const resources: AssignmentListResource[] = assignmentListExpectedResources(projectId).map((row, n) => ({ ...row,
  id: sha(row), createdAt: 'offline', labels: { 'com.supabase.cli.project': projectId, 'com.docker.compose.project': projectId },
  attachedIds: [], ports: n === 0 ? [54332] : n === 4 ? [54331] : [] }))
const network = resources.find(row => row.kind === 'network')!
for (const container of resources.filter(row => row.kind === 'container')) {
  container.attachedIds = [network.id]
  const volume = resources.find(row => row.kind === 'volume' && row.name === container.name)
  if (volume) { container.attachedIds.push(volume.id); volume.attachedIds = [container.id] }
}
network.attachedIds = resources.filter(row => row.kind === 'container').map(row => row.id)
const status = { API_URL: 'http://127.0.0.1:54331', DB_URL: 'postgresql://postgres:offline@127.0.0.1:54332/postgres',
  SERVICE_ROLE_KEY: `header.${Buffer.from(JSON.stringify({ iss: 'supabase-demo', role: 'service_role' })).toString('base64url')}.signature` }
const engine = () => createContextualSurveysNativeContracts({ original, repository, reviewedHead: seam.head, containerId: resources[0].id,
  capturedResources: resources, acceptedManifestSha256: sha(manifest), absoluteDeadline: budget().workDeadline, survey263Endpoint: binding(), statusTarget: status })
async function flush() { for (let n = 0; n < 100; n++) await Promise.resolve() }
beforeEach(() => {
  vi.mocked(surveyContracts.runSurveyNativeRollbackRaces).mockImplementation(offlineRaceOracle)
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }); startedAt = Date.now()
  seam.repository = repository; seam.workdir = workdir; seam.config = assignmentListEphemeralPlan({ projectId, workdir }).config
  seam.manifest = manifest; seam.held = false; seam.component = false; seam.brokenMetadata = false; seam.holdReaders = false; seam.holdMetadata = false; seam.holdClose = false
  seam.cliReply = 'held'; seam.poisonAfterBootstrap = false
  seam.afterBootstrap=undefined;seam.terminations=0;seam.closedSessions=0
  seam.children.length = 0; seam.readers.length = 0; seam.replies.length = 0; seam.writes.clear()
  seam.spawnCalls.length = 0; seam.metadataReplies.length = 0
  for (const key of Object.keys(process.env)) if (/DOCKER_|PROXY|SUPABASE_CLI_BINARY_OVERRIDE/.test(key)) vi.stubEnv(key, undefined)
  seam.exec.mockImplementation((file: string, args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
    seam.children.push(file); let input = ''
    const child = Object.assign(new EventEmitter(), { stdin: { on: vi.fn(), end: (value?: string) => { input = value ?? '' } }, kill: vi.fn() })
    const reply = () => {
      if (file === platform.SURVEY263_NATIVE_CLI.path) {
        seam.held = true
        if (seam.cliReply !== 'held') vi.setSystemTime(budget().workDeadline + 1)
        callback(seam.cliReply === 'success' ? null : new Error('offline CLI failure'),
          'export type Database = {}; snapshot_test_draft_save_for_owner_v1: finish_test_draft_save_for_owner_v1:', '')
        if (seam.cliReply !== 'held') child.emit('close', 0, null)
        return
      }
      let value = ''
      if (file === 'git') value = args.includes('HEAD') || args.includes('HEAD^{tree}') ? seam.head : args.includes('--show-toplevel') ? seam.component ? '/Users/stew/.codex/worktrees/pika/contextual-surveys-current-main' : repository : ''
      else if (args[0] === 'context') value = JSON.stringify({ endpoints: { docker: { Host: seam.host } }, tlsMaterial: null })
      else {if(input===manifest.termination)seam.terminations++;value = input === manifest.termination ? JSON.stringify({ present: false, terminated: false }) : 'ok'}
      callback(seam.held && seam.brokenMetadata ? new Error('offline secondary metadata') : null, value, ''); child.emit('close', 0, null)
    }; if (seam.holdMetadata) seam.metadataReplies.push(reply); else queueMicrotask(reply)
    return child
  })
  seam.spawn.mockImplementation((_file: string, args: string[]) => {
    seam.spawnCalls.push(_file)
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: vi.fn() })
    if (args.includes('psql')) {
      const name = args.find(value => value.startsWith('PGAPPNAME='))!.slice(10)
      child.stdin = new Writable({ write(chunk, _encoding, done) {
        const text = chunk.toString(), marker = /\\echo (__draft_save_end_\d+__)/.exec(text)
        if (marker) {
          const sql = text.slice(0, marker.index).trim()
          const componentSnapshot = [{table:'public.classrooms',rows:[{},{}]}, {table:'public.surveys',rows:[{},{},{}]}, {table:'public.survey_questions',rows:[{},{}]}, {metadata:{}},{cron:[]}].map(row=>JSON.stringify(row)).join('\n')
          const rows = sql === manifest.bootstrap ? JSON.stringify({ pid: 123, started: '2026-10-12T00:00:00+00:00', name, database: 'postgres', user: 'postgres' }) : sql === manifest.snapshot ? seam.component ? componentSnapshot : snapshot : ''
          if (sql === manifest.bootstrap && seam.poisonAfterBootstrap) seam.holdMetadata = true
          queueMicrotask(() => {child.stdout.write(Buffer.from(`${rows}\n${marker[1]}\n`))
            if(sql===manifest.bootstrap && seam.afterBootstrap)queueMicrotask(()=>{const run=seam.afterBootstrap;seam.afterBootstrap=undefined;run?.()})})
        }; done()
      } }) as PassThrough
      child.kill.mockImplementation(() => { queueMicrotask(() => {seam.closedSessions++;child.emit('close', 0, null)}); return true })
    } else queueMicrotask(() => { child.stdout.end(args.includes('ps') ? ids.join('\n') : '{}'); child.emit('close', 0, null) })
    return child
  })
  seam.collect.mockImplementation(async (_run, options) => {
    await options.run('docker', ['context', 'inspect', '--format', manifest.contextTemplate])
    await options.run('docker', ['--host', seam.host, 'ps', '-aq', '--no-trunc'])
    await options.run('docker', ['--host', seam.host, 'inspect', '--format', template, ...ids])
    return resources
  })
  seam.http.mockImplementation((options, callback) => {
    const req = Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn() })
    const response = Object.assign(new EventEmitter(), { statusCode: 200, headers: { 'content-type': 'application/json' }, complete: true,
      destroy: () => queueMicrotask(() => response.emit('close')) })
    req.destroy.mockImplementation(() => { if (!seam.holdClose) queueMicrotask(() => req.emit('close')) })
    req.end.mockImplementation(() => { seam.readers.push(options.path)
      const reply = () => { callback(response); response.emit('data', Buffer.from(JSON.stringify({ Id: options.path.split('/')[3], Name: '/offline', Created: 'offline',
        Config: { Labels: {} }, Mounts: [], NetworkSettings: { Networks: {} }, HostConfig: { PortBindings: {} } }))); response.emit('end') }
      if (seam.holdReaders) seam.replies.push(reply); else queueMicrotask(reply)
    }); return req
  })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks() })
describe('actual Survey engine budget composition (offline)', () => {
  function componentEngine() {
    seam.component = true
    const sourceBinding = {product:{head:seam.head,tree:seam.head},carrier:{head:seam.head,tree:seam.head},sharedSources:Object.fromEntries(surveyContracts.SURVEY_269_SHARED_FILES.map(file=>[file,'a'.repeat(64)]))} as surveyContracts.Survey269ComponentBinding
    const legacy = surveyNativePlan(original,seam.head,repository)
    const plan = {...legacy,kind:'survey269-source-compatibility-and-genuine-types' as const,binding:sourceBinding,repository:surveyContracts.SURVEY_269_COMPONENT_ROOTS.product,
      migrationManifestSha256:surveyContracts.SURVEY_269_COMPONENT_SCHEMA.manifestSha256,sourceSha256:surveyContracts.SURVEY_269_COMPONENT_SCHEMA.sourceSha256,
      sources:{...legacy.sources,migration:{file:'supabase/migrations/269_contextual_surveys_workflow.sql',sha256:surveyContracts.SURVEY_269_COMPONENT_SCHEMA.sourceSha256}},
      migrations:[],concurrency:{...legacy.concurrency,schedules:[]},inventoryComplete:false as const}
    // Only source inventory/phase oracles are synthetic. The actual guarded
    // engine, native child join/framing, byte ledger and SDK admission run.
    vi.spyOn(surveyContracts,'survey269ComponentPlan').mockReturnValue(plan)
    vi.spyOn(surveyContracts,'validateSurvey269ComponentSql').mockImplementation((_plan,sql)=>[plan.setup,plan.snapshot,plan.contracts.sql,plan.concurrency.close].includes(sql))
    vi.spyOn(surveyContracts,'verifySurvey269ComponentSources').mockImplementation(()=>{})
    vi.spyOn(platform,'assignmentListDockerInventory').mockImplementation(async run=>{await run!('docker',['ps','-aq','--no-trunc']);return resources})
    const adapters = platform.createAssignmentListNativeAdapters(original,{survey263Endpoint:{kind:'survey263',host:seam.host,identity:[1,2,3,4]},survey263Budget:budget(),survey263NativeCli:platform.SURVEY263_NATIVE_CLI,survey269Component:true})
    const componentManifest=buildSurvey269ComponentManifest(original,sourceBinding)
    seam.manifest=componentManifest
    return {adapters,engine:createSurvey269ComponentNativeContracts({original,binding:sourceBinding,containerId:resources[0].id,capturedResources:resources,
      acceptedManifestSha256:sha(componentManifest),absoluteDeadline:budget().workDeadline,statusTarget:status,survey263Endpoint:platform.requireSurvey263AdapterEndpoint(adapters)})}
  }
  it('closed269 profile runs contracts once and never races/committed/cancellation, then gates genuine types behind SDK', async()=>{
    const {engine:component}=componentEngine()
    expect(Object.keys(component).sort()).toEqual(['diagnostic','generateTypes269','inventoryComplete','manifest','nativeVerified','runContractsOnly','runSdkCommitted','setup','verifyTarget'])
    await expect(component.runSdkCommitted()).rejects.toThrow()
    expect(seam.children).toHaveLength(0)
    await component.setup()
    const before=vi.mocked(surveyContracts.runSurvey269ComponentRollback).mock.calls.length
    const receipt=await component.runContractsOnly()
    expect(receipt).toMatchObject({racesRun:false,fixtureUnchanged:true,nativeVerified:false})
    expect(vi.mocked(surveyContracts.runSurvey269ComponentRollback).mock.calls.length).toBe(before+1)
    expect(surveyContracts.runSurveyNativeRollbackContracts).not.toHaveBeenCalled()
    expect(surveyContracts.runSurveyNativeRollbackRaces).not.toHaveBeenCalled()
    await expect(component.generateTypes269()).rejects.toThrow()
    await component.runSdkCommitted()
    await expect(component.runContractsOnly()).rejects.toThrow()
    expect(component.inventoryComplete).toBe(false)
  })
  it('closed269 engine rejects a shared cap exhausted by the outer platform before native dispatch',async()=>{
    const {engine:component,adapters}=componentEngine()
    const token=platform.requireSurvey263AdapterEndpoint(adapters).componentExchange!
    platform.chargeSurvey269ComponentExchange(token,67108864)
    await expect(component.setup()).rejects.toThrow()
    expect(seam.spawnCalls).toHaveLength(0)
  })
  it('overflow after owned bootstrap still terminates its exact backend and positively closes the child without acceptance',async()=>{
    const {engine:component,adapters}=componentEngine()
    const token=platform.requireSurvey263AdapterEndpoint(adapters).componentExchange!
    seam.afterBootstrap=()=>platform.chargeSurvey269ComponentExchange(token,67108864-platform.survey269ComponentExchangeReceipt(token).bytes)
    await expect(component.setup()).rejects.toThrow()
    expect(seam.terminations).toBe(1);expect(seam.closedSessions).toBe(1)
    expect(component.diagnostic()).toContain('remainingSessions=0')
    expect(platform.survey269ComponentExchangeReceipt(token).bytes).toBeGreaterThan(67108864)
    expect(()=>platform.checkSurvey263AdapterTotal(adapters)).toThrow('cumulative exchange limit')
    await expect(component.runContractsOnly()).rejects.toThrow()
    expect(component.nativeVerified).toBe(false)
  })
  it('preserves poison through the actual race wrapper cleanup assertion', async () => {
    const actual = await vi.importActual<typeof import('../../scripts/contextual-surveys-native-contracts')>('../../scripts/contextual-surveys-native-contracts')
    const value = engine(); await value.setup()
    vi.mocked(surveyContracts.runSurveyNativeRollbackRaces).mockImplementation(async (plan, target, driver) => {
      seam.poisonAfterBootstrap = true
      return actual.runSurveyNativeRollbackRaces(plan, target, driver)
    })
    const pending = value.run().catch(error => error)
    for (let attempt = 0; attempt < 10 && !seam.holdMetadata; attempt++) await flush()
    expect(seam.holdMetadata).toBe(true)
    const children = seam.children.length, spawned = seam.spawnCalls.length
    await vi.advanceTimersByTimeAsync(90000)
    expect(await pending).toBeInstanceOf(platform.Survey263UnjoinedChildError)
    expect(Date.now()).toBeLessThan(budget().cleanupDeadline)
    expect(seam.children).toHaveLength(children); expect(seam.spawnCalls).toHaveLength(spawned)
  })
  it.each(['setup', 'run', 'runSdkCommitted'] as const)('preserves active-session poison across cached rollback finally in %s', async phase => {
    const value = engine()
    if (phase !== 'setup') await value.setup()
    if (phase === 'runSdkCommitted') await value.run()
    seam.poisonAfterBootstrap = true
    const pending = value[phase]().catch(error => error); await flush()
    expect(seam.holdMetadata).toBe(true)
    const children = seam.children.length, spawned = seam.spawnCalls.length
    await vi.advanceTimersByTimeAsync(90000)
    const error = await pending
    expect(error).toBeInstanceOf(platform.Survey263UnjoinedChildError)
    expect(Date.now()).toBeLessThan(budget().cleanupDeadline)
    expect(seam.children).toHaveLength(children); expect(seam.spawnCalls).toHaveLength(spawned)
    await expect(value.verifyTarget()).rejects.toBeInstanceOf(platform.Survey263UnjoinedChildError)
    expect(seam.children).toHaveLength(children)
    // The actual phase failure must also poison the existing outer lifecycle.
    let started = false, prepared = false, poisoned = false
    const canonical = { rowDigests: 'offline', guard168Metadata: 'offline', settings: 'offline', cronJobs: 'offline', resources: 'offline' }
    const adapters: AssignmentListLifecycleAdapters = { checkWork: vi.fn(), canonicalSnapshot: vi.fn(async () => canonical),
      inventory: vi.fn(async () => { if (poisoned) throw new Error('offline poison'); return { resources: started ? resources : [], occupiedPorts: [], workdirExists: prepared } }),
      prepare: vi.fn(async plan => { prepared = true; return { workdir, realpath: workdir, created: true, configSha256: createHash('sha256').update(plan.config).digest('hex'),
        migrations: platform.loadAssignmentListReviewedMigrations(repository).map(({ name, sha256 }) => ({ name, sha256 })), envFiles: [], symlinks: [] } }),
      command: vi.fn(async request => { if (request.args[0] === 'start') started = true; return status }),
      verifyEphemeral: vi.fn(async () => ({ projectId, containerId: resources[0].id, dbPort: 54332 as const, applicationName: `${projectId}_fixture`, guard168Enabled: true, persistedGatesOff: true, activeNetworkCronAbsent: true })),
      executeSql: vi.fn(), runCase: vi.fn(), runRevocation: vi.fn(), verifyRestoration: vi.fn(), teardown: vi.fn(), removeWorkdir: vi.fn() }
    vi.spyOn(platform, 'requireSurvey263AdapterEndpoint').mockReturnValue(binding())
    vi.spyOn(platform, 'beginSurvey263AdapterCleanup').mockImplementation((_adapters, unjoined) => { poisoned = unjoined === true })
    vi.spyOn(platform, 'checkSurvey263AdapterTotal').mockImplementation(() => {})
    const native = await import('../../scripts/contextual-test-draft-save-native-contracts')
    vi.spyOn(native, 'createContextualSurveysNativeContracts').mockReturnValue({ ...value, setup: async () => { throw error } })
    const plan = surveyNativePlan(original, seam.head, repository)
    const workload = bindSurveyNativeLifecycleWorkload({ original, repository, reviewedHead: seam.head, reviewedManifestSha256: sha(plan),
      absoluteDeadline: budget().workDeadline, rootReviewed: true, oneAttemptAuthorized: true, freshCapacityChecked: true })
    await expect(runAssignmentListEphemeralLifecycle({ fixture: original, projectId, workdir,
      migrations: platform.loadAssignmentListReviewedMigrations(repository), reviewedManifestSha256: sha(original.manifest), mode: 'normal',
      expectedResources: assignmentListExpectedResources(projectId), restorationPolicies: [], surveyWorkload: workload }, adapters)).rejects.toMatchObject({ primary: { error } })
    expect(poisoned).toBe(true); expect(adapters.teardown).not.toHaveBeenCalled(); expect(adapters.removeWorkdir).not.toHaveBeenCalled()
    expect(vi.mocked(adapters.command).mock.calls.some(([request]) => request.args[0] === 'stop')).toBe(false)
    expect(adapters.executeSql).not.toHaveBeenCalled()
  })
  it('rechecks original work admission after awaited metadata before constructing inventory', async () => {
    vi.setSystemTime(budget().workDeadline - 10); seam.holdMetadata = true
    const pending = engine().verifyTarget().catch(error => error); await flush()
    expect(seam.metadataReplies).toHaveLength(4)
    vi.setSystemTime(budget().workDeadline + 1); seam.metadataReplies.splice(0).forEach(reply => reply())
    expect(await pending).toBeInstanceOf(Error)
    expect(seam.readers).toHaveLength(0); expect(seam.spawnCalls).toHaveLength(0)
  })
  it('admits no queued work readers after original work expiry and settles owned reads within total', async () => {
    vi.setSystemTime(budget().workDeadline - 10); seam.holdReaders = true
    const pending = engine().verifyTarget().catch(error => error); await flush()
    expect(seam.readers).toHaveLength(2)
    vi.setSystemTime(budget().workDeadline + 1); seam.replies.splice(0).forEach(reply => reply()); await flush()
    expect(seam.readers).toHaveLength(2)
    expect(await pending).toBeInstanceOf(Error)
  })
  it('makes unjoined inventory poison sticky and starts no secondary children', async () => {
    vi.setSystemTime(budget().workDeadline - 10); seam.holdReaders = true; seam.holdClose = true
    const value = engine(), pending = value.verifyTarget().catch(error => error); await flush()
    const children = seam.children.length, spawned = seam.spawnCalls.length
    await vi.advanceTimersByTimeAsync(180010)
    expect(await pending).toBeInstanceOf(platform.Survey263UnjoinedChildError)
    await expect(value.verifyTarget()).rejects.toBeInstanceOf(platform.Survey263UnjoinedChildError)
    expect(seam.children).toHaveLength(children); expect(seam.spawnCalls).toHaveLength(spawned)
    expect(seam.readers).toHaveLength(2)
  })
  it.each(['failure', 'success'])('settles positively joined generator %s in original reserve, but never writes expired work', async reply => {
    const value = engine(); await value.setup(); await value.run(); await value.runSdkCommitted()
    vi.setSystemTime(budget().workDeadline - 100); seam.cliReply = reply
    const children = seam.children.length
    await expect(value.generateTypes263()).rejects.not.toBeInstanceOf(platform.Survey263UnjoinedChildError)
    expect(seam.held).toBe(true); expect(seam.children.length).toBeGreaterThan(children + 1)
    expect(Date.now()).toBeLessThan(budget().cleanupDeadline); expect(seam.writes.size).toBe(0)
    await expect(value.verifyTarget()).rejects.not.toBeInstanceOf(platform.Survey263UnjoinedChildError)
  })
  it.each([false, true])('keeps generator poison authoritative through secondary metadata failure=%s and outer cleanup', async broken => {
    const value = engine(), setupReceipt = await value.setup(), rollbackReceipt = await value.run(), sdkReceipt = await value.runSdkCommitted()
    vi.setSystemTime(budget().workDeadline - 50000); seam.brokenMetadata = broken
    const pending = value.generateTypes263().catch(error => error); await flush()
    expect(seam.held).toBe(true)
    const before = seam.children.length, spawned = seam.spawnCalls.length
    await vi.advanceTimersByTimeAsync(62000)
    const error = await pending
    expect(error).toBeInstanceOf(platform.Survey263UnjoinedChildError)
    expect(seam.children).toHaveLength(before)
    expect(seam.spawnCalls).toHaveLength(spawned)
    await expect(value.verifyTarget()).rejects.toBeInstanceOf(platform.Survey263UnjoinedChildError)
    expect(seam.children).toHaveLength(before); expect(seam.writes.size).toBe(0)
    // Feed the actual typed engine failure through the actual outer lifecycle;
    // outer adapters are existing offline seams, not a runtime executor input.
    vi.setSystemTime(startedAt + 1); let started = false, prepared = false, poisoned = false
    const canonical = { rowDigests: 'offline', guard168Metadata: 'offline', settings: 'offline', cronJobs: 'offline', resources: 'offline' }
    const adapters: AssignmentListLifecycleAdapters = { checkWork: vi.fn(), canonicalSnapshot: vi.fn(async () => canonical),
      inventory: vi.fn(async () => { if (poisoned) throw new Error('offline poison'); return { resources: started ? resources : [], occupiedPorts: [], workdirExists: prepared } }),
      prepare: vi.fn(async plan => { prepared = true; return { workdir, realpath: workdir, created: true, configSha256: createHash('sha256').update(plan.config).digest('hex'),
        migrations: platform.loadAssignmentListReviewedMigrations(repository).map(({ name, sha256 }) => ({ name, sha256 })), envFiles: [], symlinks: [] } }),
      command: vi.fn(async request => { if (request.args[0] === 'start') started = true; return status }),
      verifyEphemeral: vi.fn(async () => ({ projectId, containerId: resources[0].id, dbPort: 54332 as const, applicationName: `${projectId}_fixture`, guard168Enabled: true, persistedGatesOff: true, activeNetworkCronAbsent: true })),
      executeSql: vi.fn(), runCase: vi.fn(), runRevocation: vi.fn(), verifyRestoration: vi.fn(), teardown: vi.fn(), removeWorkdir: vi.fn() }
    vi.spyOn(platform, 'requireSurvey263AdapterEndpoint').mockReturnValue(binding())
    vi.spyOn(platform, 'beginSurvey263AdapterCleanup').mockImplementation((_adapters, unjoined) => { poisoned = unjoined === true })
    vi.spyOn(platform, 'checkSurvey263AdapterTotal').mockImplementation(() => {})
    const native = await import('../../scripts/contextual-test-draft-save-native-contracts')
    vi.spyOn(native, 'createContextualSurveysNativeContracts').mockReturnValue({ ...value, setup: vi.fn(async () => setupReceipt),
      run: vi.fn(async () => rollbackReceipt), runSdkCommitted: vi.fn(async () => sdkReceipt), generateTypes263: async () => { throw error } })
    const plan = surveyNativePlan(original, seam.head, repository)
    const workload = bindSurveyNativeLifecycleWorkload({ original, repository, reviewedHead: seam.head, reviewedManifestSha256: sha(plan),
      absoluteDeadline: budget().workDeadline, rootReviewed: true, oneAttemptAuthorized: true, freshCapacityChecked: true })
    await expect(runAssignmentListEphemeralLifecycle({ fixture: original, projectId, workdir,
      migrations: platform.loadAssignmentListReviewedMigrations(repository), reviewedManifestSha256: sha(original.manifest), mode: 'normal',
      expectedResources: assignmentListExpectedResources(projectId), restorationPolicies: [], surveyWorkload: workload }, adapters)).rejects.toMatchObject({ primary: { error } })
    expect(poisoned).toBe(true); expect(adapters.teardown).not.toHaveBeenCalled(); expect(adapters.removeWorkdir).not.toHaveBeenCalled()
    expect(vi.mocked(adapters.command).mock.calls.some(([request]) => request.args[0] === 'stop')).toBe(false)
    expect(adapters.executeSql).not.toHaveBeenCalled()
  })
})
