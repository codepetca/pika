/** Actual factory/child-dispatch seams, entirely offline. No socket or command. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
const seam = vi.hoisted(() => ({ host: 'unix:///offline-survey.sock', ino: 2, context: 'unix:///offline-survey.sock',
  fail: false, replaceAfter: false, retargetAfter: false, now: 0, startedAt: 0, advanceAfter: 0, holdNativeClose: false,
  stdout: '{"offline":true}', stderr: '', writeFailure: false,
  writes: [] as Array<{ path: string; text: string; options: { mode: number; flag: string } }>,
  nativeChildren: [] as EventEmitter[],
  calls: [] as Array<{ file: string; args: string[]; options: Record<string, unknown> }> }))
vi.mock('node:fs', async original => {
  const actual = await original<typeof import('node:fs')>()
  return { ...actual, realpathSync: ((path: string) => path === '/offline-survey.sock' ? path : actual.realpathSync(path)) as typeof actual.realpathSync,
    statSync: ((path: string) => path === '/offline-survey.sock'
      ? { dev: 1, ino: seam.ino, mode: 3, rdev: 4, isSocket: () => true } : actual.statSync(path)) as typeof actual.statSync,
    writeFileSync: vi.fn((path: string, text: string, options: { mode: number; flag: string }) => {
      if (!path.endsWith('-startup.json') || seam.writeFailure) throw new Error('Offline write rejected')
      seam.writes.push({ path, text, options })
    }),
  }
})
vi.mock('node:child_process', async original => {
  const actual = await original<typeof import('node:child_process')>()
  return { ...actual, execFile: vi.fn((file: string, args: string[], options: Record<string, unknown>, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
    const child = Object.assign(new EventEmitter(), { stdin: { on: vi.fn(), end: vi.fn() }, kill: vi.fn() })
    if (file.endsWith('supabase')) seam.nativeChildren.push(child)
    seam.calls.push({ file, args: [...args], options })
    queueMicrotask(() => {
      if (file === 'docker' && args[0] === 'context') {
        callback(null, JSON.stringify({ endpoints: { docker: { Host: seam.context } }, tlsMaterial: null }), '')
        child.emit('close', 0, null)
        return
      }
      if (seam.replaceAfter) seam.ino = 99
      if (seam.retargetAfter) seam.context = 'unix:///different.sock'
      seam.now += seam.advanceAfter
      callback(seam.fail ? Object.assign(new Error('Offline command failure'), { code: 1, killed: false }) : null,
        file.endsWith('supabase') ? seam.stdout : '', file.endsWith('supabase') ? seam.stderr : '')
      if (!seam.holdNativeClose || file === 'docker') child.emit('close', 0, null)
    })
    return child
  }) }
})
vi.mock('node:net', async original => {
  const actual = await original<typeof import('node:net')>()
  return { ...actual, createServer: vi.fn(() => {
    const server = { once: vi.fn(() => server), listen: vi.fn((_port: number, _host: string, callback: () => void) => {
      queueMicrotask(callback); return server
    }), close: vi.fn((callback: () => void) => { queueMicrotask(callback); return server }) }
    return server
  }) }
})
import { createAssignmentListNativeAdapters, requireSurvey263AdapterEndpoint, beginSurvey263AdapterCleanup,
  SURVEY263_NATIVE_CLI, verifySurvey263NativeCli, chargeSurvey269ComponentExchange, survey269ComponentExchangeReceipt,
  checkSurvey263AdapterTotal, chargeSurvey269ComponentControl } from '../../scripts/contextual-assignment-list-proof-platform'
import { AssignmentListStartupError, assignmentListStartupDiagnostic, Survey263UnjoinedChildError,
  writeAssignmentListStartupDiagnostic } from '../../scripts/contextual-assignment-list-proof-platform'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { assignmentListProofWorkdir } from '../../scripts/contextual-assignment-list-proof-path'
import { assignmentListExpectedResources, runAssignmentListEphemeralLifecycle } from '../../scripts/contextual-assignment-list-proof-lifecycle'
import { loadAssignmentListReviewedMigrations } from '../../scripts/contextual-assignment-list-proof-platform'
import { surveyNativePlan, bindSurveyNativeLifecycleWorkload, consumeSurveyNativeLifecycleWorkload } from '../../scripts/contextual-surveys-native-contracts'
const fixture = newAssignmentListProofFixture(new Date('2026-10-12T12:00:00Z'))
const project = `pika_assignment_list_${fixture.manifest.syntheticTag.slice(-12)}`
const workdir = assignmentListProofWorkdir(project)
const endpoint = () => ({ kind: 'survey263' as const, host: seam.host, identity: [1, 2, 3, 4] as const })
const budget = () => ({ startedAt: seam.startedAt, workDeadline: seam.startedAt + 720000, cleanupDeadline: seam.startedAt + 900000 })
const make = () => createAssignmentListNativeAdapters(fixture, { survey263Endpoint: endpoint(), survey263Budget: budget(), survey263NativeCli: SURVEY263_NATIVE_CLI, ephemeralSnapshot: 'metadata' })
beforeEach(() => {
  seam.context = seam.host; seam.ino = 2; seam.fail = false; seam.replaceAfter = false; seam.retargetAfter = false; seam.calls.length = 0
  seam.now = seam.startedAt = Date.now(); seam.advanceAfter = 0; seam.holdNativeClose = false
  seam.stdout = '{"offline":true}'; seam.stderr = ''; seam.writeFailure = false; seam.writes.length = 0; seam.nativeChildren.length = 0
  vi.spyOn(Date, 'now').mockImplementation(() => seam.now)
  for (const name of Object.keys(process.env)) if (/^(?:DOCKER_(?:HOST|CONTEXT|CONFIG|API_VERSION|TLS.*|CERT_PATH|CUSTOM_HEADERS)|(?:.*_)?PROXY)$/i.test(name)) vi.stubEnv(name, undefined)
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('sealed Survey platform factory (offline actual seams)', () => {
  it('joins component command input, untrimmed stdout/stderr and external bytes without renewing the ledger', async () => {
    const adapters = createAssignmentListNativeAdapters(fixture, { survey263Endpoint: endpoint(), survey263Budget: budget(), survey263NativeCli: SURVEY263_NATIVE_CLI, survey269Component: true })
    const token = requireSurvey263AdapterEndpoint(adapters).componentExchange!
    expect(() => survey269ComponentExchangeReceipt({ ...token })).toThrow()
    chargeSurvey269ComponentExchange(token, 17)
    seam.stdout = '  {"text":"漢"}\n'; seam.stderr = 'warning\n'
    await adapters.command({ args: ['status', '--workdir', workdir, '-o', 'json'], workdir, timeoutMs: 1000 })
    const contextBytes = Buffer.byteLength(JSON.stringify({ endpoints: { docker: { Host: seam.context } }, tlsMaterial: null }))
    expect(survey269ComponentExchangeReceipt(token).bytes).toBe(17 + 2 * contextBytes + Buffer.byteLength(seam.stdout) + Buffer.byteLength(seam.stderr))
    chargeSurvey269ComponentExchange(token, 67108864 - survey269ComponentExchangeReceipt(token).bytes)
    expect(() => chargeSurvey269ComponentExchange(token, 1)).toThrow('cumulative exchange limit')
    expect(() => adapters.checkWork!()).toThrow()
    beginSurvey263AdapterCleanup(adapters)
    await adapters.inventory({projectId:project,workdir,apiUrl:'http://127.0.0.1:54331',dbPort:54332})
    expect(() => checkSurvey263AdapterTotal(adapters)).toThrow('cumulative exchange limit')
    expect(survey269ComponentExchangeReceipt(token).bytes).toBeGreaterThan(67108864)
  })
  it('reserves the original32 controls and counts cleanup after exhaustion without admitting success',()=>{
    const adapters=createAssignmentListNativeAdapters(fixture,{survey263Endpoint:endpoint(),survey263Budget:budget(),survey263NativeCli:SURVEY263_NATIVE_CLI,survey269Component:true})
    const token=requireSurvey263AdapterEndpoint(adapters).componentExchange!
    for(let n=0;n<3968;n++)chargeSurvey269ComponentControl(token)
    expect(()=>chargeSurvey269ComponentControl(token)).toThrow('control reserve')
    beginSurvey263AdapterCleanup(adapters)
    for(let n=0;n<32;n++)chargeSurvey269ComponentControl(token,true)
    expect(survey269ComponentExchangeReceipt(token).controls).toBe(4001)
    expect(()=>checkSurvey263AdapterTotal(adapters)).toThrow('control limit')
  })
  it('counts failed-child component stdout/stderr before rejecting and leaves legacy263 unjoined', async () => {
    const adapters = createAssignmentListNativeAdapters(fixture, { survey263Endpoint: endpoint(), survey263Budget: budget(), survey263NativeCli: SURVEY263_NATIVE_CLI, survey269Component: true })
    seam.fail = true; seam.stdout = 'synthetic'; seam.stderr = 'failure'
    await expect(adapters.command({ args: ['status'], workdir, timeoutMs: 1000 })).rejects.toThrow()
    expect(survey269ComponentExchangeReceipt(requireSurvey263AdapterEndpoint(adapters).componentExchange!).bytes).toBeGreaterThan(16)
    expect(requireSurvey263AdapterEndpoint(make()).componentExchange).toBeUndefined()
  })
  it('retains bounded private failed-start callback facts only after actual positive close', async () => {
    const adapters = make(); seam.fail = true; seam.holdNativeClose = true
    seam.stdout = '漢'.repeat(6000) + 'synthetic tail'; seam.stderr = 'x'.repeat(20000) + 'failed to pull docker image: synthetic private tail'
    const pending = adapters.command({ args: ['start', '--workdir', workdir], workdir, timeoutMs: 1000 }).catch(error => error)
    for (let n = 0; n < 100; n++) await Promise.resolve()
    expect(seam.nativeChildren).toHaveLength(1); expect(seam.writes).toHaveLength(0)
    seam.nativeChildren[0].emit('close', 1, null)
    const error = await pending
    expect(error).toBeInstanceOf(AssignmentListStartupError); expect(seam.writes).toHaveLength(1)
    const write = seam.writes[0], receipt = JSON.parse(write.text)
    expect(write.path).toBe(`${workdir}-startup.json`); expect(write.options).toEqual({ mode: 0o600, flag: 'wx' })
    expect(receipt).toMatchObject({ stage: 'start', code: 1, killed: false })
    expect(Buffer.byteLength(receipt.stdout)).toBeLessThanOrEqual(16384); expect(Buffer.byteLength(receipt.stderr)).toBeLessThanOrEqual(16384)
    expect(receipt.stdout).toContain('synthetic tail'); expect(receipt.stderr).toContain('synthetic private tail')
    expect(assignmentListStartupDiagnostic(error)).toBe('DIAG isolated assignment startup command=exit exit=1 killed=false observed-markers=image-pull.\n')
    expect(String(error)).not.toContain('synthetic private tail')
  })
  it('keeps the branded failed-start cause if secondary closed context observation differs', async () => {
    const adapters = make(); seam.fail = true; seam.retargetAfter = true; seam.stderr = 'failed to parse config: synthetic private tail'
    const error = await adapters.command({ args: ['start', '--workdir', workdir], workdir, timeoutMs: 1000 }).catch(error => error)
    expect(error).toBeInstanceOf(AssignmentListStartupError)
    expect(assignmentListStartupDiagnostic(error)).toContain('observed-markers=config-invalid.')
    expect(seam.writes).toHaveLength(1)
  })
  it('uncertain failed startup is typed poison with no diagnostic or later ordinary dispatch, even on late close', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const adapters = make(); seam.fail = true; seam.holdNativeClose = true
    const pending = adapters.command({ args: ['start', '--workdir', workdir], workdir, timeoutMs: 10 }).catch(error => error)
    for (let n = 0; n < 100; n++) await Promise.resolve()
    seam.now += 12010; await vi.advanceTimersByTimeAsync(12010)
    expect(await pending).toBeInstanceOf(Survey263UnjoinedChildError); expect(seam.writes).toHaveLength(0)
    const calls = seam.calls.length
    seam.nativeChildren[0].emit('close', 1, null); await Promise.resolve(); expect(seam.writes).toHaveLength(0)
    await expect(adapters.command({ args: ['status', '--workdir', workdir, '-o', 'json'], workdir, timeoutMs: 1000 })).rejects.toThrow()
    expect(seam.calls).toHaveLength(calls)
  })
  it('failed diagnostic exclusive write fails closed without exposing tails or success', async () => {
    const adapters = make(); seam.fail = true; seam.writeFailure = true; seam.stderr = 'synthetic private tail'
    const error = await adapters.command({ args: ['start', '--workdir', workdir], workdir, timeoutMs: 1000 }).catch(error => error)
    expect(error).not.toBeInstanceOf(AssignmentListStartupError); expect(String(error)).toContain('Private startup diagnostic failed')
    expect(String(error)).not.toContain('synthetic private tail'); expect(seam.writes).toHaveLength(0)
  })
  it('positive child close at original timebox cannot write startup evidence or admit later dispatch', async () => {
    const adapters = make(); seam.fail = true; seam.advanceAfter = 12010
    const error = await adapters.command({ args: ['start', '--workdir', workdir], workdir, timeoutMs: 10 }).catch(error => error)
    expect(error).toBeInstanceOf(Survey263UnjoinedChildError); expect(seam.writes).toHaveLength(0)
    expect(seam.calls).toHaveLength(2)
  })
  it('existing private diagnostic helper refuses writing beyond the original close deadline', () => {
    expect(() => writeAssignmentListStartupDiagnostic(project, { code: 1, killed: false, stdout: 'synthetic', stderr: 'synthetic' }, seam.now)).toThrow()
    expect(seam.writes).toHaveLength(0)
  })
  it('successful Survey start writes no diagnostic and preserves direct-native command bounds', async () => {
    await make().command({ args: ['start', '--workdir', workdir], workdir, timeoutMs: 1000 })
    expect(seam.writes).toHaveLength(0)
    const child = seam.calls.find(call => call.file === SURVEY263_NATIVE_CLI.path)!
    expect(child.options).toMatchObject({ timeout: 1000, maxBuffer: 64 * 1024 * 1024, killSignal: 'SIGKILL' })
  })
  it('legacy failed-start callback still uses the original bounded diagnostic without Survey binding', async () => {
    seam.fail = true; seam.stderr = 'address already in use synthetic private tail'
    const error = await createAssignmentListNativeAdapters(fixture).command({ args: ['start'], workdir, timeoutMs: 180000 }).catch(error => error)
    expect(error).toBeInstanceOf(AssignmentListStartupError); expect(assignmentListStartupDiagnostic(error)).toContain('observed-markers=port-conflict.')
    expect(seam.writes).toHaveLength(1); expect(seam.calls).toHaveLength(1); expect(seam.calls[0].file).toBe('supabase')
    expect(seam.calls[0].options.timeout).toBe(180000)
  })
  it('brands only the actual socket-bound factory result, not a legacy or copied adapter', () => {
    const adapters = make()
    expect(requireSurvey263AdapterEndpoint(adapters)).toEqual({ ...endpoint(), budget: budget(), nativeCli: SURVEY263_NATIVE_CLI })
    expect(() => requireSurvey263AdapterEndpoint({ ...adapters })).toThrow()
    expect(() => requireSurvey263AdapterEndpoint(createAssignmentListNativeAdapters(fixture))).toThrow()
    expect(seam.calls).toHaveLength(0)
  })
  it.each(['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CUSTOM_HEADERS', 'HTTPS_PROXY'])('rejects caller override %s before child dispatch', name => {
    vi.stubEnv(name, 'offline-override')
    expect(() => make()).toThrow(); expect(seam.calls).toHaveLength(0)
  })
  it('rejects remote or extra executable bindings and changed socket epochs before dispatch', () => {
    expect(() => createAssignmentListNativeAdapters(fixture, { survey263Endpoint: { ...endpoint(), host: 'tcp://remote:2375' } })).toThrow()
    expect(() => createAssignmentListNativeAdapters(fixture, { survey263Endpoint: { ...endpoint(), run: () => {} } as never })).toThrow()
    seam.ino = 99; expect(() => make()).toThrow(); expect(seam.calls).toHaveLength(0)
  })
  it('pins Supabase start/status/stop children without changing the parent environment', async () => {
    const adapters = make()
    for (const args of [['start', '--workdir', workdir], ['status', '--workdir', workdir, '-o', 'json'], ['stop', '--project-id', project, '--no-backup']]) {
      await adapters.command({ args, workdir, timeoutMs: 1000 })
    }
    const children = seam.calls.filter(call => call.file === SURVEY263_NATIVE_CLI.path)
    expect(children).toHaveLength(3)
    for (const child of children) expect(child.options.env).toMatchObject({ DOCKER_HOST: seam.host })
    expect(process.env.DOCKER_HOST).toBeUndefined()
    expect(seam.calls.filter(call => call.args[0] === 'context')).toHaveLength(6)
  })
  it('pins every global Docker discovery child to the accepted host', async () => {
    await make().inventory({ projectId: project, workdir, apiUrl: 'http://127.0.0.1:54331', dbPort: 54332 })
    const dispatched = seam.calls.filter(call => call.file === 'docker' && call.args[0] !== 'context')
    expect(dispatched.length).toBeGreaterThan(0)
    for (const child of dispatched) expect(child.args.slice(0, 2)).toEqual(['--host', seam.host])
  })
  it('rejects a changed default context before a Supabase operation', async () => {
    const adapters = make(); seam.context = 'unix:///different.sock'
    await expect(adapters.command({ args: ['status', '--workdir', workdir, '-o', 'json'], workdir, timeoutMs: 1000 })).rejects.toThrow()
    expect(seam.calls.some(call => call.file === SURVEY263_NATIVE_CLI.path)).toBe(false)
  })
  it.each(['failure', 'socket', 'context'])('never accepts a %s after dispatch and still checks settlement', async fault => {
    const adapters = make(); seam.fail = fault === 'failure'; seam.replaceAfter = fault === 'socket'; seam.retargetAfter = fault === 'context'
    await expect(adapters.command({ args: ['status', '--workdir', workdir, '-o', 'json'], workdir, timeoutMs: 1000 })).rejects.toThrow()
    expect(seam.calls.filter(call => call.file === SURVEY263_NATIVE_CLI.path)).toHaveLength(1)
    expect((seam.calls.find(call => call.file === SURVEY263_NATIVE_CLI.path)!.options.env as NodeJS.ProcessEnv).DOCKER_HOST).toBe(seam.host)
  })
  it('freezes every actual Survey hook before branding, including after awaits', async () => {
    const adapters = make(), substitute = vi.fn()
    expect(Object.isFrozen(adapters)).toBe(true)
    for (const name of ['command', 'inventory', 'canonicalSnapshot', 'teardown', 'checkWork'] as const) {
      expect(() => Object.assign(adapters, { [name]: substitute })).toThrow()
      expect(() => Object.defineProperty(adapters, name, { get: substitute })).toThrow()
      expect(Reflect.deleteProperty(adapters, name)).toBe(false)
    }
    await adapters.command({ args: ['status', '--workdir', workdir, '-o', 'json'], workdir, timeoutMs: 1000 })
    expect(() => Object.assign(adapters, { command: substitute })).toThrow()
    expect(substitute).not.toHaveBeenCalled()
    expect(Object.isFrozen(createAssignmentListNativeAdapters(fixture))).toBe(false)
  })
  it('captures original deadlines and forbids new start/status/SQL after work expiry', async () => {
    const adapters = make(); seam.now = budget().workDeadline
    expect(() => adapters.checkWork!()).toThrow()
    for (const args of [['start', '--workdir', workdir], ['status', '--workdir', workdir, '-o', 'json']])
      await expect(adapters.command({ args, workdir, timeoutMs: 180000 })).rejects.toThrow()
    await expect(adapters.executeSql({ projectId: project, containerId: 'a'.repeat(64), dbPort: 54332,
      applicationName: `${project}_fixture`, sql: 'select 1;' })).rejects.toThrow()
    expect(seam.calls).toHaveLength(0)
    expect(requireSurvey263AdapterEndpoint(adapters).budget).toEqual(budget())
  })
  it('deadline mismatch rejects before first actual adapter operation or workload consumption', async () => {
    const adapters = make(), repository = process.cwd(), reviewedHead = 'a'.repeat(40)
    const m = surveyNativePlan(fixture, reviewedHead, repository)
    const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
    const workload = bindSurveyNativeLifecycleWorkload({ original: fixture, repository, reviewedHead,
      reviewedManifestSha256: digest(m), absoluteDeadline: budget().workDeadline - 1,
      rootReviewed: true, oneAttemptAuthorized: true, freshCapacityChecked: true })
    await expect(runAssignmentListEphemeralLifecycle({ fixture, projectId: project, workdir,
      migrations: loadAssignmentListReviewedMigrations(repository), reviewedManifestSha256: digest(fixture.manifest),
      mode: 'normal', expectedResources: assignmentListExpectedResources(project), restorationPolicies: [], surveyWorkload: workload }, adapters)).rejects.toThrow('original work deadline differs')
    expect(seam.calls).toHaveLength(0)
    expect(() => consumeSurveyNativeLifecycleWorkload(workload)).not.toThrow()
  })
  it('expired preflight inventory cannot permit any subsequent work child', async () => {
    const adapters = make(); seam.now = budget().workDeadline - 1; seam.advanceAfter = 2
    await expect(adapters.inventory({ projectId: project, workdir, apiUrl: 'http://127.0.0.1:54331', dbPort: 54332 })).rejects.toThrow()
    const before = seam.calls.length
    await expect(adapters.command({ args: ['start', '--workdir', workdir], workdir, timeoutMs: 180000 })).rejects.toThrow()
    expect(seam.calls).toHaveLength(before)
  })
  it('clips context/native child timeouts and permits only original cleanup reserve', async () => {
    const adapters = make(); seam.now = budget().workDeadline - 5
    await adapters.command({ args: ['status', '--workdir', workdir, '-o', 'json'], workdir, timeoutMs: 15000 })
    expect(seam.calls[0].options.timeout).toBe(5)
    expect(seam.calls.find(call => call.file === SURVEY263_NATIVE_CLI.path)!.options.timeout).toBe(5)
    seam.now = budget().cleanupDeadline - 7; beginSurvey263AdapterCleanup(adapters); seam.calls.length = 0
    await adapters.teardown({ projectId: project, workdir, resources: [], stopArgs: ['stop', '--project-id', project, '--no-backup'] })
    expect(seam.calls.every(call => Number(call.options.timeout) <= 7)).toBe(true)
    expect(() => adapters.checkWork!()).toThrow()
    seam.now = budget().cleanupDeadline
    await expect(adapters.inventory({ projectId: project, workdir, apiUrl: 'http://127.0.0.1:54331', dbPort: 54332 })).rejects.toThrow()
  })
  it('does not accept native CLI callback as closure and retains uncertainty at the original total', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const adapters = make(); beginSurvey263AdapterCleanup(adapters)
    seam.now = budget().cleanupDeadline - 20; seam.holdNativeClose = true
    let done = false
    const pending = adapters.teardown({ projectId: project, workdir, resources: [], stopArgs: ['stop', '--project-id', project, '--no-backup'] }).catch(error => { done = true; return error })
    for (let count = 0; count < 100; count++) await Promise.resolve()
    expect(seam.calls.filter(call => call.file === SURVEY263_NATIVE_CLI.path)).toHaveLength(1)
    expect(done).toBe(false)
    seam.now = budget().cleanupDeadline; await vi.advanceTimersByTimeAsync(20)
    expect(await pending).toBeInstanceOf(Error); expect(done).toBe(true)
    const calls = seam.calls.length
    await expect(adapters.inventory({ projectId: project, workdir, apiUrl: 'http://127.0.0.1:54331', dbPort: 54332 })).rejects.toThrow()
    expect(seam.calls).toHaveLength(calls)
  })
  it('a command crossing work expiry cannot produce success or renew either deadline', async () => {
    const adapters = make(); seam.now = budget().workDeadline - 1; seam.advanceAfter = 2
    await expect(adapters.command({ args: ['status', '--workdir', workdir, '-o', 'json'], workdir, timeoutMs: 15000 })).rejects.toThrow()
    expect(requireSurvey263AdapterEndpoint(adapters).budget).toEqual(budget())
  })
  it('rejects wrapper/arbitrary binary/parent override instead of inferring native closure', () => {
    expect(() => verifySurvey263NativeCli({ ...SURVEY263_NATIVE_CLI, path: '/opt/homebrew/bin/supabase' })).toThrow()
    expect(() => verifySurvey263NativeCli({ ...SURVEY263_NATIVE_CLI, sha256: 'a'.repeat(64) })).toThrow()
    vi.stubEnv('SUPABASE_CLI_BINARY_OVERRIDE', 'offline'); expect(() => make()).toThrow()
  })
  it('captures immutable original budget and rejects deadline renewal or executable getters', () => {
    const input = budget(), adapters = createAssignmentListNativeAdapters(fixture, { survey263Endpoint: endpoint(), survey263Budget: input, survey263NativeCli: SURVEY263_NATIVE_CLI })
    input.workDeadline += 1
    expect(requireSurvey263AdapterEndpoint(adapters).budget).toEqual(budget())
    expect(() => Object.assign(requireSurvey263AdapterEndpoint(adapters).budget, { workDeadline: input.workDeadline })).toThrow()
    expect(() => createAssignmentListNativeAdapters(fixture, { survey263Endpoint: endpoint(), survey263Budget: input, survey263NativeCli: SURVEY263_NATIVE_CLI })).toThrow()
    const getter = vi.fn(() => endpoint())
    expect(() => createAssignmentListNativeAdapters(fixture, Object.defineProperty({}, 'survey263Endpoint', { get: getter }))).toThrow()
    expect(getter).not.toHaveBeenCalled()
  })
})
