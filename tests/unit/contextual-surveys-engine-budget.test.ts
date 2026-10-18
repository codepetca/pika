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
  sdkTransportReady:false,holdSdkGuard:0,sdkGuardCount:0,
  wrongSource:false,wrongGuard:false,failGuard:false,
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
vi.mock('../../scripts/contextual-surveys-sdk-contracts', async original => ({ ...await original<typeof import('../../scripts/contextual-surveys-sdk-contracts')>(),runContextualSurveysSdkContracts: vi.fn(async () => {}),runSurvey269ComponentSdkContracts:vi.fn(async()=>{}) }))
vi.mock('../../scripts/contextual-surveys-sdk-proof', async original => ({
  ...await original<typeof import('../../scripts/contextual-surveys-sdk-proof')>(),
  createSurveySdkProofTransport: vi.fn(() => ({ client: {}, start: vi.fn(), settle:async()=>{}, complete: () => ({ calls: 14, nativeVerified: false }) })),
  verifySurveySdkTerminalEffects: vi.fn(() => ({ nativeVerified: false })),
  verifySurvey269ComponentSdkTerminalEffects: vi.fn(() => ({ nativeVerified: false })),
}))
import { createContextualSurveysNativeContracts, buildSurveyNativeContractsManifest, buildSurvey269ComponentManifest, createSurvey269ComponentNativeContracts } from '../../scripts/contextual-test-draft-save-native-contracts'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { assignmentListExpectedResources, assignmentListEphemeralPlan, runAssignmentListEphemeralLifecycle,
  type AssignmentListLifecycleAdapters, type AssignmentListResource } from '../../scripts/contextual-assignment-list-proof-lifecycle'
import * as platform from '../../scripts/contextual-assignment-list-proof-platform'
import { surveyNativePlan, bindSurveyNativeLifecycleWorkload } from '../../scripts/contextual-surveys-native-contracts'
import * as surveyContracts from '../../scripts/contextual-surveys-native-contracts'
import * as sdkProof from '../../scripts/contextual-surveys-sdk-proof'
import * as sdkContracts from '../../scripts/contextual-surveys-sdk-contracts'
const offlineRaceOracle = vi.mocked(surveyContracts.runSurveyNativeRollbackRaces).getMockImplementation()!
const offlineSdkOracle=vi.mocked(sdkContracts.runContextualSurveysSdkContracts).getMockImplementation()!
const offlineComponentSdkOracle=vi.mocked(sdkContracts.runSurvey269ComponentSdkContracts).getMockImplementation()!
const offlineTransportFactory=vi.mocked(sdkProof.createSurveySdkProofTransport).getMockImplementation()!
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
  vi.mocked(sdkContracts.runContextualSurveysSdkContracts).mockImplementation(offlineSdkOracle)
  vi.mocked(sdkContracts.runSurvey269ComponentSdkContracts).mockImplementation(offlineComponentSdkOracle)
  vi.mocked(sdkProof.createSurveySdkProofTransport).mockImplementation(offlineTransportFactory)
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] }); startedAt = Date.now()
  seam.repository = repository; seam.workdir = workdir; seam.config = assignmentListEphemeralPlan({ projectId, workdir }).config
  seam.manifest = manifest; seam.held = false; seam.component = false; seam.brokenMetadata = false; seam.holdReaders = false; seam.holdMetadata = false; seam.holdClose = false
  seam.cliReply = 'held'; seam.poisonAfterBootstrap = false
  seam.afterBootstrap=undefined;seam.terminations=0;seam.closedSessions=0
  seam.sdkTransportReady=false;seam.holdSdkGuard=0;seam.sdkGuardCount=0
  seam.wrongSource=false;seam.wrongGuard=false;seam.failGuard=false
  seam.children.length = 0; seam.readers.length = 0; seam.replies.length = 0; seam.writes.clear()
  seam.spawnCalls.length = 0; seam.metadataReplies.length = 0
  for (const key of Object.keys(process.env)) if (/DOCKER_|PROXY|SUPABASE_CLI_BINARY_OVERRIDE/.test(key)) vi.stubEnv(key, undefined)
  seam.exec.mockImplementation((file: string, args: string[], _options: unknown, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
    if(seam.sdkTransportReady && file==='git' && args.join(' ')==='rev-parse HEAD' && ++seam.sdkGuardCount===seam.holdSdkGuard)seam.holdMetadata=true
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
      if (file === 'git') value = args.includes('HEAD^{tree}') && seam.wrongSource ? 'b'.repeat(40) : args.includes('HEAD') || args.includes('HEAD^{tree}') ? seam.head : args.includes('--show-toplevel') ? seam.component ? '/Users/stew/.codex/worktrees/pika/contextual-surveys-current-main' : repository : ''
      else if (args[0] === 'context') value = JSON.stringify({ endpoints: { docker: { Host: seam.host } }, tlsMaterial: null })
      else {if(input===manifest.termination)seam.terminations++;value = input === manifest.termination ? JSON.stringify({ present: false, terminated: false }) : input===manifest.guard&&seam.wrongGuard?'wrong':'ok'}
      callback(input===manifest.guard&&seam.failGuard ? new Error('private SQL child detail') : seam.held && seam.brokenMetadata ? new Error('offline secondary metadata') : null, value, ''); child.emit('close', 0, null)
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
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs();vi.unstubAllGlobals(); vi.restoreAllMocks() })
describe('actual Survey engine budget composition (offline)', () => {
  function componentEngine() {
    seam.component = true
    const sourceBinding = {product:{head:seam.head,tree:seam.head},carrier:{head:seam.head,tree:seam.head},sharedSources:Object.fromEntries(surveyContracts.SURVEY_269_SHARED_FILES.map(file=>[file,'a'.repeat(64)]))} as surveyContracts.Survey269ComponentBinding
    const legacy = surveyNativePlan(original,seam.head,repository)
    const plan = {...legacy,kind:'survey269-source-compatibility-and-genuine-types' as const,binding:sourceBinding,repository:surveyContracts.SURVEY_269_COMPONENT_ROOTS.product,
      migrationManifestSha256:surveyContracts.SURVEY_269_COMPONENT_SCHEMA.manifestSha256,sourceSha256:surveyContracts.SURVEY_269_COMPONENT_SCHEMA.sourceSha256,
      sources:{...legacy.sources,migration:{file:'supabase/migrations/269_contextual_surveys_workflow.sql',sha256:surveyContracts.SURVEY_269_COMPONENT_SCHEMA.sourceSha256}},
      caps:{...legacy.caps,sdkMs:60000 as const},sdkProofPreparation:{...legacy.sdkProofPreparation,caps:{...legacy.sdkProofPreparation.caps,totalMs:60000 as const}},
      migrations:[],concurrency:{...legacy.concurrency,schedules:[]},inventoryComplete:false as const}
    // Only source inventory/phase oracles are synthetic. The actual guarded
    // engine, native child join/framing, byte ledger and SDK admission run.
    vi.spyOn(surveyContracts,'survey269ComponentPlan').mockReturnValue(plan)
    vi.spyOn(surveyContracts,'validateSurvey269ComponentSql').mockImplementation((_plan,sql)=>[plan.setup,plan.snapshot,plan.contracts.sql,plan.concurrency.close].includes(sql))
    vi.spyOn(surveyContracts,'verifySurvey269ComponentSources').mockImplementation(()=>{})
    vi.spyOn(platform,'survey269ComponentDockerInventory').mockImplementation(async run=>{await run!('docker',['ps','-aq','--no-trunc']);return resources})
    const adapters = platform.createAssignmentListNativeAdapters(original,{survey263Endpoint:{kind:'survey263',host:seam.host,identity:[1,2,3,4]},survey263Budget:budget(),survey263NativeCli:platform.SURVEY263_NATIVE_CLI,survey269Component:true})
    const componentManifest=buildSurvey269ComponentManifest(original,sourceBinding)
    seam.manifest=componentManifest
    return {adapters,fixture:plan.fixture,engine:createSurvey269ComponentNativeContracts({original,binding:sourceBinding,containerId:resources[0].id,capturedResources:resources,
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
  it('component guard schedules4/3/3 joined metadata waves and joins every mismatched wave before stopping later work',async()=>{
    const {engine:component}=componentEngine()
    seam.holdMetadata=true
    let finished=false
    const operation=component.setup().catch(error=>error).finally(()=>{finished=true})
    await flush();expect(seam.metadataReplies).toHaveLength(4);expect(seam.children).toHaveLength(4)
    seam.metadataReplies.splice(0).forEach(reply=>reply());await flush()
    expect(seam.metadataReplies).toHaveLength(3);expect(seam.children).toHaveLength(7)
    seam.metadataReplies.splice(0).forEach(reply=>reply());await flush()
    expect(seam.metadataReplies).toHaveLength(3);expect(seam.children).toHaveLength(10)
    seam.wrongSource=true
    const wave=seam.metadataReplies.splice(0);wave[1]();await flush()
    expect(finished).toBe(false);expect(seam.children).toHaveLength(10);expect(seam.spawnCalls).toHaveLength(0)
    wave[0]();wave[2]()
    expect(await operation).toBeInstanceOf(Error)
    expect(seam.children).toHaveLength(10);expect(seam.spawnCalls).toHaveLength(0)
    expect(component.diagnostic()).toContain('checkpoint=source-git')
    expect(component.diagnostic()).not.toContain('bbbbbbbb')
  })
  it.each(['resources','source-files','sql-ownership','sql-child'] as const)('retains a fixed non-deadline %s rejection without starting a session',async checkpoint=>{
    const {engine:component}=componentEngine()
    if(checkpoint==='resources')vi.mocked(platform.survey269ComponentDockerInventory).mockRejectedValueOnce(new Error('private resource detail'))
    if(checkpoint==='source-files')vi.mocked(surveyContracts.verifySurvey269ComponentSources).mockImplementationOnce(()=>{throw new Error('private source detail')})
    if(checkpoint==='sql-ownership')seam.wrongGuard=true
    if(checkpoint==='sql-child')seam.failGuard=true
    await expect(component.setup()).rejects.toThrow()
    expect(component.diagnostic()).toContain(`checkpoint=${checkpoint==='sql-child'?'sql-ownership':checkpoint}`)
    expect(component.diagnostic()).toContain('sdkElapsedMs=none sdkRemainingMs=none')
    expect(component.diagnostic()).not.toContain('private')
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
  it.each(['before-guard','post-guard','own-timer','terminal','unrelated-late','unjoined-late','malformed'] as const)('retains actual component controller causal provenance for %s',async boundary=>{
    const actual=await vi.importActual<typeof sdkContracts>('../../scripts/contextual-surveys-sdk-contracts')
    const {engine:component,fixture:f}=componentEngine()
    await component.setup();await component.runContractsOnly()
    let calls=0,guards=0
    let releaseSettlement:(()=>void)|undefined
    let releaseTimerGuard:(()=>void)|undefined,phaseDeadline=0
    vi.mocked(sdkProof.createSurveySdkProofTransport).mockImplementation((...args)=>({...offlineTransportFactory(...args),
      settle:()=>new Promise<void>(resolve=>{releaseSettlement=resolve})}))
    vi.mocked(sdkContracts.runSurvey269ComponentSdkContracts).mockImplementation(async(_client,fixture,_guard,deadline)=>{
      phaseDeadline=deadline
      const at=new Date().toISOString(),owner=f.actors[0].id,member=f.actors[1].id,cid=f.classes[0].id,sid=f.surveys[0].id
      const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
      const survey={id:sid,classroom_id:cid,title:f.tag,status:'active',show_results:true,dynamic_responses:false,opens_at:at,created_by:owner,
        created_at:at,updated_at:at,position:0,artifact_id:id(88),source_artifact_id:null,source_blueprint_version_id:null,blueprint_archived_at:null}
      const classroom={id:cid,teacher_id:owner,archived_at:null},question={...f.question,id:id(91),artifact_id:id(92),question_text:'Added?',position:1,created_at:at,updated_at:at}
      const response={response_id:id(93),response_text:'SDK response',submitted_at:at,updated_at:at}
      const result={question_id:f.question.id,question_type:'short_text',question_text:f.question.question_text,options:[],counts:[],total_responses:1,responses:[response]}
      const summary={id:sid,title:f.tag,status:'active',show_results:true,dynamic_responses:false}
      const replies=[{classroom,survey,questions:[f.question],responses:[]},{classroom,surveys:[survey]},null,null,
        {classroom,survey,questions:[f.question],responses:[]},{classroom,surveys:[survey]},{success:true,updated:false},
        {classroom,survey:summary,results:[result]},{classroom,survey:summary,questions:[{id:f.question.id,question_type:'short_text',question_text:f.question.question_text,options:[],response_max_chars:500,position:0}],results:[{...result,responses:[{...response,student_id:member,name:null,email:f.actors[1].email}]}],responders:[{student_id:member,name:null,email:f.actors[1].email}],stats:{total_students:2,responded:1}},
        {survey:{...survey,title:'SDK renamed'}},{question},{question:{...question,question_type:'link',question_text:'URL?',response_max_chars:2048}}, {success:true},{success:true}]
      const client={rpc:()=>({abortSignal:async()=>{
        const index=calls++
        if(boundary==='unrelated-late'){vi.setSystemTime(deadline+1);throw new Error('unrelated synthetic failure')}
        return {data:replies[index],get error(){if(index===13)vi.setSystemTime(deadline+1);return index===2||index===3?{code:'PT403'}:null}}
      }})} as unknown as Parameters<typeof actual.runSurvey269ComponentSdkContracts>[0]
      if(boundary==='before-guard'){
        const now=Date.now.bind(Date);let reads=0
        vi.spyOn(Date,'now').mockImplementation(()=>{if(++reads===3)vi.setSystemTime(deadline);return now()})
      }
      return actual.runSurvey269ComponentSdkContracts(client,fixture,async()=>{
        guards++
        if(boundary==='post-guard'||boundary==='unjoined-late')vi.setSystemTime(deadline)
        if(boundary==='unjoined-late')throw new platform.Survey263UnjoinedChildError()
        if(boundary==='own-timer')await new Promise<void>(resolve=>{releaseTimerGuard=resolve})
      },boundary==='malformed'?-1:deadline)
    })
    let finished=false
    const operation=component.runSdkCommitted().catch(error=>error).finally(()=>{finished=true})
    if(boundary==='own-timer'){
      for(let n=0;n<2000&&!releaseTimerGuard;n++)await Promise.resolve()
      expect(releaseTimerGuard).toBeTypeOf('function')
      await vi.advanceTimersByTimeAsync(60000);vi.setSystemTime(phaseDeadline-1);releaseTimerGuard!()
    }
    for(let n=0;n<2000&&!releaseSettlement;n++)await Promise.resolve()
    expect(releaseSettlement).toBeTypeOf('function');expect(finished).toBe(false)
    const pendingCommands=seam.children.length,pendingSessions=seam.spawnCalls.length
    await flush();expect(seam.children).toHaveLength(pendingCommands);expect(seam.spawnCalls).toHaveLength(pendingSessions)
    releaseSettlement!();const error=await operation
    expect(error).toBeInstanceOf(boundary==='unjoined-late'?platform.Survey263UnjoinedChildError:Error)
    if(boundary==='terminal'){expect(guards).toBe(14);expect(calls).toBe(14)}
    expect(component.diagnostic()).toContain(['unrelated-late','unjoined-late','malformed'].includes(boundary)?'checkpoint=sdk-runner':'checkpoint=sdk-deadline')
    expect(component.diagnostic()).not.toContain('unrelated synthetic failure')
    if(boundary==='own-timer')expect(component.diagnostic()).toContain('sdkRemainingMs=1')
    if(boundary==='before-guard'){expect(guards).toBe(0);expect(calls).toBe(0)}
    if(boundary==='terminal'){expect(guards).toBe(14);expect(calls).toBe(14)}
    if(boundary==='unrelated-late')expect(calls).toBe(1)
    if(boundary==='post-guard'||boundary==='own-timer'||boundary==='unjoined-late'){expect(guards).toBe(1);expect(calls).toBe(0)}
    if(boundary==='malformed'){expect(guards).toBe(0);expect(calls).toBe(0)}
    if(boundary==='unjoined-late')await expect(component.generateTypes269()).rejects.toBeInstanceOf(platform.Survey263UnjoinedChildError)
  })
  it.each([['pre',false],['post',false],['pre',true],['post',true],['before',true]] as const)('actual transport joins %s native guard at SDK timeout (never-close=%s) before any secondary phase',async(side,neverClose)=>{
    const actualTransport=await vi.importActual<typeof sdkProof>('../../scripts/contextual-surveys-sdk-proof')
    const actualSdk=await vi.importActual<typeof sdkContracts>('../../scripts/contextual-surveys-sdk-contracts')
    const {engine:component,fixture:f}=componentEngine()
    await component.setup();await component.runContractsOnly()
    let shifted=false
    let observedPhaseDeadline:number|undefined,transportPhaseDeadline:number|undefined
    vi.mocked(sdkContracts.runSurvey269ComponentSdkContracts).mockImplementation((client,fixture,guard,deadline)=>actualSdk.runSurvey269ComponentSdkContracts(client,fixture,async()=>{
      await guard();if(!shifted){shifted=true;vi.setSystemTime(Date.now()+30000)}
    },observedPhaseDeadline=deadline))
    vi.mocked(sdkProof.createSurveySdkProofTransport).mockImplementation((...args)=>{seam.sdkTransportReady=true;const transport=actualTransport.createSurveySdkProofTransport(...args)
      return {...transport,start:(deadline:number)=>{transportPhaseDeadline=deadline;transport.start(deadline)}}})
    seam.holdSdkGuard=side==='before'?1:side==='pre'?2:3
    const wire=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({classroom:{id:f.classes[0].id,teacher_id:f.actors[0].id,archived_at:null},
      survey:{id:f.surveys[0].id,classroom_id:f.classes[0].id,created_by:f.actors[0].id,title:f.tag,status:'active',show_results:true,dynamic_responses:false,
        opens_at:'2026-10-12T00:00:00+00:00',created_at:'2026-10-12T00:00:00Z',updated_at:'2026-10-12T00:00:00Z',position:0,
        artifact_id:'00000000-0000-4000-8000-000000000088',source_artifact_id:null,source_blueprint_version_id:null,blueprint_archived_at:null},questions:[f.question],responses:[]}),{headers:{'content-type':'application/json'}}))
    vi.stubGlobal('fetch',wire)
    let finished=false
    const operation=component.runSdkCommitted().catch(error=>error).finally(()=>{finished=true})
    for(let n=0;n<2000 && !seam.metadataReplies.length;n++)await Promise.resolve()
    expect(seam.metadataReplies.length).toBeGreaterThan(0)
    expect(observedPhaseDeadline).toBe(transportPhaseDeadline)
    expect(component.manifest.caps.sdkMs).toBe(60000)
    expect(component.manifest.sdkProofPreparation.caps.totalMs).toBe(60000)
    const dispatches=seam.children.length,spawns=seam.spawnCalls.length
    await vi.advanceTimersByTimeAsync(20001)
    expect(finished).toBe(false);expect(seam.children).toHaveLength(dispatches);expect(seam.spawnCalls).toHaveLength(spawns)
    expect(wire).toHaveBeenCalledTimes(side==='post'?1:0)
    if(side!=='before'){await vi.advanceTimersByTimeAsync(10000);expect(finished).toBe(false);expect(seam.children).toHaveLength(dispatches)}
    if(neverClose){
      await vi.advanceTimersByTimeAsync(side==='before'?37000:27000)
      expect(await operation).toBeInstanceOf(platform.Survey263UnjoinedChildError)
      expect(component.diagnostic()).toContain(side==='before'?'sdkPending=guard':'settlement=guard')
      expect(seam.children).toHaveLength(dispatches);expect(seam.spawnCalls).toHaveLength(spawns)
      await expect(component.generateTypes269()).rejects.toBeInstanceOf(platform.Survey263UnjoinedChildError)
      expect(seam.children).toHaveLength(dispatches)
    }else{
      seam.holdMetadata=false;seam.metadataReplies.splice(0).forEach(reply=>reply())
      expect(await operation).toBeInstanceOf(Error)
      expect(finished).toBe(true)
      expect(wire).toHaveBeenCalledTimes(side==='post'?1:0)
      expect(component.diagnostic()).toContain('checkpoint=sdk-runner')
      expect(component.diagnostic()).toContain('firstReason=sdk-deadline')
      expect(component.diagnostic()).toContain('sdkRemainingMs=0')
    }
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
