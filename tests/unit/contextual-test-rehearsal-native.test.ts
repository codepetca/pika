import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { resolve } from 'node:path'
import { realpathSync } from 'node:fs'
const native = vi.hoisted(() => ({ spawn: vi.fn(), verify: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: native.spawn }))
vi.mock('node:net', () => ({ createServer: () => ({ once() {}, listen(_options: unknown, ready: () => void) { ready() }, close(done: () => void) { done() } }) }))
vi.mock('../../scripts/contextual-test-rehearsal-launch', async original => ({
  ...await original<typeof import('../../scripts/contextual-test-rehearsal-launch')>(), verifyContextualTestBinary: native.verify,
}))
import { CONTEXTUAL_TEST_REQUIRED_IMAGES, createContextualTestExecutionControls, createContextualTestNativeControls, contextualTestExecutionDigest, type ContextualTestNativePins } from '../../scripts/contextual-test-rehearsal-native'
import type { ContextualTestControllerAdmission } from '../../scripts/contextual-test-rehearsal-controller'
import { runContextualTestRehearsalController } from '../../scripts/contextual-test-rehearsal-controller'
import { createContextualTestPlan } from '../../e2e/helpers/contextual-test-rehearsal'
import { settleOwnedFamily, type Capture, type OwnedProcessRow } from '../../scripts/contextual-test-process-ownership'
import * as launchModule from '../../scripts/contextual-test-rehearsal-launch'

class Child extends EventEmitter {
  exitCode: number | null = null
  signalCode: string | null = null
  readonly stdout = new EventEmitter()
  readonly stderr = new EventEmitter()
  readonly stdin = Object.assign(new EventEmitter(), { end: vi.fn() })
  readonly spawnfile = '/cpu/node'
  readonly spawnargs = ['/cpu/node','/cpu/spec.js']
  constructor(readonly pid: number) { super() }
}
type Row = { pid: number; ppid: number; pgid: number; started: string; executable: string; state: string }
const pin = (path: string) => ({ path, sha256: 'a'.repeat(64) })
const pins: ContextualTestNativePins = {
  node: pin('/cpu/node'), ps: pin('/cpu/ps'), python: pin('/cpu/python'), lsof: pin('/cpu/lsof'), sandbox: pin('/cpu/sandbox'),
  codesign: pin('/cpu/codesign'), chrome: pin('/cpu/chrome'), docker: pin('/cpu/docker'),
  helper: { path: resolve('scripts/contextual-test-process-identity.py'), sha256: '476c8c4696b8252debabb3ff7c5249deea10349cc91526ebc6eca924ef47f807' },
  dockerHost: 'unix:///cpu/docker.sock', outputDir: '/private/tmp',
}
let rows: Row[], app: Child, owned: Child[], kill: ReturnType<typeof vi.spyOn>, nextPid: number, output: string
beforeEach(() => {
  native.spawn.mockReset(); native.verify.mockReset(); rows = []; owned = []; nextPid = 8000; output = ''
  kill = vi.spyOn(process, 'kill').mockImplementation(((pid: number) => {
    if (pid < 0) rows = rows.filter(row => row.pgid !== -pid)
    else rows = rows.filter(row => row.pid !== pid)
    for (const child of owned) if (!rows.some(row => row.pid === child.pid)) child.emit('close', 0)
    return true
  }) as typeof process.kill)
  native.spawn.mockImplementation((file: string, args: string[]) => {
    if (file === pins.sandbox.path) {
      const pid = (owned.length + 1) * 1000, child = new Child(pid)
      owned.push(child); app = owned[0]
      rows.push({ pid, ppid: 42, pgid: pid, started: `${pid}:1`, executable: pins.node.path, state: 'alive' },
        { pid: pid + 1, ppid: pid, pgid: pid, started: `${pid}:2`, executable: pins.node.path, state: 'alive' })
      return child
    }
    const child = new Child(nextPid++)
    child.stdin.end.mockImplementation(() => queueMicrotask(() => {
      let text = output
      const inventory = [...rows, { pid: 42, ppid: 1, pgid: 42, started: '1:1', executable: '/coordinator/node', state: 'alive' }]
      if (file === pins.ps.path) text = args[0] === '-axo' ? inventory.map(row => `${row.pid} ${row.ppid} ${row.pgid}`).join('\n') : '/cpu/node /cpu/spec.js'
      if (file === pins.python.path) text = JSON.stringify({ schema: 1, rows: inventory })
      if (file === pins.lsof.path) text = args.includes('-iTCP:3117') ? 'p1001' : `p1000\nfcwd\nn${process.cwd()}`
      child.stdout.emit('data', Buffer.from(text)); child.emit('close', 0, null)
    }))
    return child
  })
})
afterEach(() => { kill.mockRestore(); vi.useRealTimers() })
const launch = () => ({ args: ['/cpu/spec.js'], cwd: process.cwd(), env: {}, role: 'app' as const, profile: '(version 1)\n(allow default)', deadline: Date.now() + 10000 })
function commandFixture(control: ReturnType<typeof createContextualTestNativeControls>, budget = { startedAt: Date.now() - 1, deadline: Date.now() + 60000, cleanupDeadline: Date.now() + 120000 }) {
  const child = new Child(9000), executable = realpathSync(process.execPath), argv = [executable, '/cpu/spec.js']
  Object.defineProperties(child, { spawnfile: { value: executable }, spawnargs: { value: argv } })
  rows.push({ pid: child.pid, ppid: 42, pgid: child.pid, started: '9000:1', executable, state: 'alive' }); owned.push(child)
  const spawnDouble = native.spawn.getMockImplementation()!
  native.spawn.mockImplementation((file: string, args: string[]) => {
    const helper = spawnDouble(file, args) as Child
    if (args.includes(String(child.pid)) && (file === pins.ps.path || file === pins.lsof.path)) helper.stdin.end.mockImplementation(() => queueMicrotask(() => {
      helper.stdout.emit('data', Buffer.from(file === pins.ps.path ? argv.join(' ') : `p9000\nfcwd\nn${pins.outputDir}`)); helper.emit('close', 0, null)
    }))
    return helper
  })
  const real = launchModule.createContextualTestPinnedCommand({ git: pin(executable), docker: pin(executable), supabase: pin(executable),
    dockerHost: pins.dockerHost, outputDir: pins.outputDir, socketIdentity: [1, 2, 3, 4] }, budget,
  { verify() {}, spawn: () => child as never, settle: control.settleCommand })
  const command = { ...real, beginCleanup: vi.fn(real.beginCleanup), joinSettlements: vi.fn(real.joinSettlements), assertClosed: vi.fn(real.assertClosed) }
  return { child, command }
}

describe('real native controller with CPU process doubles only', () => {
  it('does not inspect or launch anything at controller construction', () => {
    const controls = createContextualTestNativeControls(pins, Date.now() + 20000)
    controls.assertClosed(); expect(native.spawn).not.toHaveBeenCalled(); expect(kill).not.toHaveBeenCalled()
  })
  it('requires positive close of a pinned probe and returns only original bounded output', async () => {
    const controls = createContextualTestNativeControls(pins, Date.now() + 20000); output = 'synthetic-result'
    await expect(controls.probe(pins.docker, ['version'], Date.now() + 10000)).resolves.toBe(output)
    expect(native.verify).toHaveBeenCalledTimes(2); expect(kill).not.toHaveBeenCalled()
    expect(native.spawn.mock.calls[0][2]).toMatchObject({ shell: false, env: { PATH: '/usr/bin:/bin', HOME: pins.outputDir } })
  })
  it('captures argv/cwd/kernel birth and proves close plus fresh family absence before disposal', async () => {
    const controls = createContextualTestNativeControls(pins, Date.now() + 20000), child = await controls.spawnOwned(launch())
    expect(child.state().family.descendants.map(row => row.pid)).toEqual([1001])
    await controls.settleAll(Date.now() + 5000)
    expect(kill).toHaveBeenCalledExactlyOnceWith(-1000, 'SIGTERM')
    expect(child.state().closed).toBe(true); controls.assertClosed()
  })
  it('rejects PID birth reuse without sending any signal to the replacement', async () => {
    const controls = createContextualTestNativeControls(pins, Date.now() + 20000), child = await controls.spawnOwned(launch())
    rows[0].started = '200:1'
    await expect(child.settle(Date.now() + 5000)).rejects.toThrow()
    expect(kill).not.toHaveBeenCalled(); expect(child.state().closed).toBe(false)
    expect(() => controls.assertClosed()).toThrow()
  })
  it('accepts app readiness only after the actual listener belongs to the verified live family', async () => {
    const controls = createContextualTestNativeControls(pins, Date.now() + 20000), child = await controls.spawnOwned(launch())
    app.stdout.emit('data', Buffer.from('✓ Ready in 100ms\n'))
    await child.ready()
    await controls.settleAll(Date.now() + 5000)
  })
  it('rejects a foreign process in the owned group without adopting or signalling it', async () => {
    const controls = createContextualTestNativeControls(pins, Date.now() + 20000), child = await controls.spawnOwned(launch())
    rows.push({ pid: 9999, ppid: 1, pgid: 1000, started: '300:1', executable: '/foreign', state: 'alive' })
    await expect(child.settle(Date.now() + 5000)).rejects.toThrow()
    expect(kill).not.toHaveBeenCalled()
  })
  it('still settles an older verified family when another child fails identity verification', async () => {
    const controls = createContextualTestNativeControls(pins, Date.now() + 20000)
    const older = await controls.spawnOwned(launch()), newer = await controls.spawnOwned({ ...launch(), role: 'browser' })
    rows.find(row => row.pid === newer.child.pid)!.started = '9999:1'
    try {
      await expect(controls.settleAll(Date.now() + 5000)).rejects.toThrow()
      expect(older.state().closed).toBe(true)
      expect(kill.mock.calls).toEqual([[-1000, 'SIGTERM']])
      expect(() => controls.assertClosed()).toThrow()
      rows.find(row => row.pid === newer.child.pid)!.started = '2000:1'
      await newer.settle(Date.now() + 5000)
      // Both verified families are now positively closed/absent. The prior
      // ownership rejection must still prevent acceptance and new work.
      expect(newer.state().closed).toBe(true)
      expect(() => controls.assertClosed()).toThrow()
      await expect(controls.spawnOwned(launch())).rejects.toThrow()
    } finally { if (!older.state().closed) await older.settle(Date.now() + 5000).catch(() => {}) }
  })
  it.each(['closed', 'unseen-orphan'])('a failed birth (%s) cannot strand an older verified family or clear the failure', async exit => {
    const controls = createContextualTestNativeControls(pins, Date.now() + 20000), older = await controls.spawnOwned(launch())
    const spawnDouble = native.spawn.getMockImplementation()!
    native.spawn.mockImplementation((file: string, args: string[]) => {
      const child = spawnDouble(file, args) as Child
      if (file === pins.sandbox.path) {
        rows = rows.filter(row => exit === 'closed' ? row.pgid !== child.pid : row.pid !== child.pid)
        if (exit === 'closed') queueMicrotask(() => child.emit('close', 1))
      }
      return child
    })
    await expect(controls.spawnOwned({ ...launch(), role: 'browser' })).rejects.toThrow()
    try {
      await expect(controls.settleAll(Date.now() + 5000)).rejects.toThrow()
      expect(older.state().closed).toBe(true)
      expect(kill.mock.calls).toEqual([[-1000, 'SIGTERM']])
      expect(() => controls.assertClosed()).toThrow()
      await expect(controls.spawnOwned(launch())).rejects.toThrow()
      await expect(controls.probe(pins.docker, ['version'], Date.now() + 1000)).rejects.toThrow()
      await expect(controls.rows()).rejects.toThrow()
      if (exit === 'unseen-orphan') expect(rows.some(row => row.pid === 2001)).toBe(true)
    } finally { if (!older.state().closed) await older.settle(Date.now() + 5000).catch(() => {}) }
  })
  it('an unjoined failed probe does not block captured-family cleanup or become positive closure', async () => {
    vi.useFakeTimers()
    const controls = createContextualTestNativeControls(pins, Date.now() + 20000), older = await controls.spawnOwned(launch())
    const spawnDouble = native.spawn.getMockImplementation()!
    native.spawn.mockImplementation((file: string, args: string[]) => file === pins.docker.path ? new Child(9000) : spawnDouble(file, args))
    const rejected = expect(controls.probe(pins.docker, ['version'], Date.now() + 1000)).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(1000); await rejected
    await expect(controls.settleAll(Date.now() + 5000)).rejects.toThrow()
    expect(older.state().closed).toBe(true)
    expect(kill.mock.calls).toEqual([[-1000, 'SIGTERM']])
    expect(() => controls.assertClosed()).toThrow()
  })
  it('starts other families before a missing close exhausts the shared deadline', async () => {
    const controls = createContextualTestNativeControls(pins, Date.now() + 20000)
    const older = await controls.spawnOwned(launch()), newer = await controls.spawnOwned({ ...launch(), role: 'browser' })
    let now = Date.now()
    const end = now + 5000, sentAt: number[] = []
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now += 10)
    kill.mockImplementation(((pid: number) => {
      sentAt.push(now)
      rows = rows.filter(row => pid < 0 ? row.pgid !== -pid : row.pid !== pid)
      if (pid === -1000) app.emit('close', 0)
      return true
    }) as typeof process.kill)
    try {
      await expect(controls.settleAll(end)).rejects.toThrow()
      expect(older.state().closed).toBe(true); expect(newer.state().closed).toBe(false)
      expect(kill.mock.calls.some(([pid]) => pid === -1000)).toBe(true)
      expect(sentAt.every(at => at < end)).toBe(true)
      expect(() => controls.assertClosed()).toThrow()
      await expect(controls.settleAll(end + 1000)).rejects.toThrow()
      expect(sentAt.every(at => at < end)).toBe(true)
    } finally { clock.mockRestore() }
  })
  it('settles an authorized failing cleanup command after successful owned-family cleanup', async () => {
    vi.useFakeTimers()
    const end = Date.now() + 20000, control = createContextualTestNativeControls(pins, end), appChild = await control.spawnOwned(launch())
    await control.settleAll(end)
    expect(appChild.state().closed).toBe(true)
    const { child, command } = commandFixture(control)
    command.beginCleanup(end)
    const rejected = expect(command.run('git', ['status'])).rejects.toThrow()
    child.emit('error'); await vi.advanceTimersByTimeAsync(0); await rejected
    await command.joinSettlements()
    expect(kill.mock.calls).toEqual([[-1000, 'SIGTERM'], [9000, 'SIGTERM']])
    expect(command.state()).toMatchObject({ fault: true, poisoned: false, pending: 0 })
    await expect(control.rows()).rejects.toThrow(); await expect(control.probe(pins.docker, [], end)).rejects.toThrow()
    await expect(control.spawnOwned(launch())).rejects.toThrow()
  })
  it.each(['stable', 'reused', 'expired'])('a captured command survives later cleanup/poison only with fresh identity and original deadline; %s', async state => {
    vi.useFakeTimers()
    const end = Date.now() + 20000, control = createContextualTestNativeControls(pins, end)
    const { child, command } = commandFixture(control, { startedAt: Date.now() - 1, deadline: Date.now() + 10000, cleanupDeadline: end })
    const create = launchModule.createContextualTestOwnedFamily
    let captured = false, resume: (() => void) | undefined
    const factory = vi.spyOn(launchModule, 'createContextualTestOwnedFamily').mockImplementation(input => { const family = create(input); if (input.pid === child.pid) captured = true; return family })
    const spawnDouble = native.spawn.getMockImplementation()!
    native.spawn.mockImplementation((file: string, args: string[]) => {
      const helper = spawnDouble(file, args) as Child
      if (captured && file === pins.ps.path && args[0] === '-axo' && !resume) {
        const send = helper.stdin.end.getMockImplementation()!
        helper.stdin.end.mockImplementation(() => { resume = () => send() })
      }
      return helper
    })
    try {
      const rejected = expect(command.run('git', ['status'])).rejects.toThrow()
      child.emit('error'); await vi.advanceTimersByTimeAsync(0)
      expect(captured).toBe(true); expect(resume).toBeTypeOf('function')
      await expect(control.settleAll(end)).rejects.toThrow() // active observation makes poison sticky
      if (state === 'reused') rows.find(row => row.pid === child.pid)!.started = '9999:1'
      if (state === 'expired') vi.setSystemTime(end)
      resume!(); await vi.advanceTimersByTimeAsync(0)
      if (state !== 'stable') { expect(kill).not.toHaveBeenCalled(); child.emit('close', 1, null) }
      await rejected
      if (state !== 'stable') await expect(command.joinSettlements()).rejects.toThrow()
      else { await command.joinSettlements(); expect(kill.mock.calls).toEqual([[9000, 'SIGTERM']]) }
      expect(() => control.assertClosed()).toThrow()
      const observations = native.spawn.mock.calls.length, signals = kill.mock.calls.length
      await expect(control.settleCommand(new Child(9990) as never, end)).rejects.toThrow()
      expect(native.spawn).toHaveBeenCalledTimes(observations); expect(kill).toHaveBeenCalledTimes(signals)
    } finally { factory.mockRestore() }
  })
})

describe('fresh execution seal (CPU only, no admission)', () => {
  it('escalates a SIGTERM-resistant owned family inside the shared six-minute reserve', async () => {
    const capture: Capture = { identity: { pid: 1000, pgid: 1000, started: '100:1', executable: '/cpu/node', cwd: '/cpu', role: 'app' }, descendants: [] }
    let time = 1000, alive = true, closed = false
    const signals: Array<{ signal: string; at: number }> = []
    const end = time + 360000
    const result = await settleOwnedFamily(capture, 'group', {
      rows: async () => { time += 1000; return alive ? [{ ...capture.identity, ppid: 42, state: 'alive' }] as OwnedProcessRow[] : [] },
      now: () => time, admit: () => expect(time).toBeLessThan(end), end, closed: () => closed, update() {},
      signal: (pid, signal) => { expect(pid).toBe(-1000); signals.push({ signal, at: time }); if (signal === 'SIGKILL') { alive = false; closed = true } },
    })
    expect(result).toEqual({ closed: true, absent: true }); expect(signals.map(value => value.signal)).toEqual(['SIGTERM','SIGKILL'])
    expect(signals[1].at).toBeGreaterThanOrEqual(end - 4000); expect(time).toBeLessThan(end)
  })
  function sealFixture() {
    const plan = createContextualTestPlan('pika_assignment_list_123456abcdef')
    const now = Date.now(), source = { repository: '/cpu/source', head: plan.sourceSha, tree: plan.sourceTree, entries: [], bytes: 0, sha256: 'c'.repeat(64) }
    const admission = { version: 1, projectId: 'pika_assignment_list_123456abcdef', nonce: '0'.repeat(20) + '123456abcdef',
      workdir: '/private/tmp/pika-assignment-list-123456abcdef', appDir: '/private/tmp/pika-assignment-list-123456abcdef/app', outputDir: pins.outputDir,
      password: 'private-synthetic-fixture-password', sessionSecret: 's'.repeat(64), assignmentMetadata: { manifest: { syntheticTag: 'assignmentlist_123456abcdef' } }, migrations: [],
      startedAt: now - 1, deadline: now + 60000, cleanupDeadline: now + 120000, frozen: source, runner: source,
      dependencies: { root: '/cpu/deps', roots: ['/cpu/deps'], sha256: 'd'.repeat(64) }, migrationChainSha256: plan.migrationChainSha256,
      review: { manifestSha256: 'f'.repeat(64), runnerHead: source.head, runnerTree: source.tree }, transportPins: { git: pin('/cpu/git'), docker: pins.docker, supabase: pin('/cpu/supabase'),
        dockerHost: pins.dockerHost, socketIdentity: [1,2,3,4], outputDir: pins.outputDir } } as unknown as ContextualTestControllerAdmission
    const seal = { manifestSha256: 'f'.repeat(64), requiredImages: [{ ref: 'synthetic', id: 'sha256:' + 'a'.repeat(64) }],
      versions: { node: 'v24.12.0', supabase: 'synthetic', playwright: '1.58.0' as const },
      capacity: { checkedAt: now, availableBytes: 100000000000, status: 'healthy' as const, pressure: 'healthy' as const } }
    return { admission, seal }
  }
  it('binds source closures, clocks, dependencies, transport, image pins and version/capacity receipts', () => {
    const { admission, seal } = sealFixture(), first = contextualTestExecutionDigest(admission, pins, seal)
    expect(contextualTestExecutionDigest(admission, pins, seal)).toBe(first)
    for (const changed of [{ ...admission, deadline: admission.deadline + 1 }, { ...admission, runner: { ...admission.runner, sha256: '1'.repeat(64) } },
      { ...admission, dependencies: { ...admission.dependencies, sha256: '2'.repeat(64) } }]) expect(contextualTestExecutionDigest(changed, pins, seal)).not.toBe(first)
    expect(contextualTestExecutionDigest(admission, { ...pins, dockerHost: 'unix:///cpu/other.sock' }, seal)).not.toBe(first)
    expect(contextualTestExecutionDigest(admission, pins, { ...seal, requiredImages: [] })).not.toBe(first)
  })
  it('rejects an unaccepted seal before any filesystem/native probe or target launch', async () => {
    const { admission, seal } = sealFixture(), controls = createContextualTestExecutionControls(admission, pins, seal)
    await expect(controls.assertReady(admission)).rejects.toThrow()
    expect(native.spawn).not.toHaveBeenCalled(); expect(native.verify).not.toHaveBeenCalled(); expect(kill).not.toHaveBeenCalled()
  })
  it('joins command settlements after native failure and retains only fixed cleanup failure stages', async () => {
    vi.useFakeTimers()
    const { admission, seal } = sealFixture(), actualPins = { ...pins, node: pin(realpathSync(process.execPath)) }
    const accepted = contextualTestExecutionDigest(admission, actualPins, seal)
    const input = { ...admission, review: { ...admission.review, manifestSha256: accepted } }
    const command = { beginCleanup: vi.fn(), joinSettlements: vi.fn(async () => { throw Error('raw synthetic private command detail') }),
      assertClosed: vi.fn(() => { throw Error('raw synthetic private closure detail') }) }
    const factory = vi.spyOn(launchModule, 'createContextualTestPinnedCommand').mockReturnValue(command as unknown as ReturnType<typeof launchModule.createContextualTestPinnedCommand>)
    try {
      const controls = createContextualTestExecutionControls(input, actualPins, { ...seal, manifestSha256: accepted })
      native.spawn.mockImplementationOnce(() => new Child(9000))
      const rejected = expect(controls.assertReady(input)).rejects.toThrow()
      await vi.advanceTimersByTimeAsync(30000); await rejected
      const end = Date.now() + 5000
      const failure = await controls.settleAll(end).catch(error => error) as AggregateError
      expect(command.beginCleanup).toHaveBeenCalledExactlyOnceWith(end)
      expect(command.joinSettlements).toHaveBeenCalledTimes(1); expect(command.assertClosed).toHaveBeenCalledTimes(1)
      expect(failure).toBeInstanceOf(AggregateError)
      expect(failure.errors.map(error => error.cleanupStage)).toEqual(['owned-families', 'command-settlements', 'command-closure', 'native-closure'])
      expect(failure.errors.every(error => error.message === 'Private contextual Test native control failed')).toBe(true)
      expect(JSON.stringify(failure)).not.toContain('raw synthetic private')
      expect(kill).not.toHaveBeenCalled()
    } finally { factory.mockRestore() }
  })
  it.each(['controller', 'execution'])('real poisoned transport cannot skip a captured app through the actual %s cleanup caller', async caller => {
    vi.useFakeTimers()
    const { admission, seal } = sealFixture(), node = realpathSync(process.execPath), imageId = 'sha256:' + 'a'.repeat(64)
    const actualPins = { ...pins, node: pin(node), chrome: { path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', sha256: 'fbeec33e75ea8da7bdb6e48f987ed32f5089c49d86013046e87319f5df11c13f' } }
    const base = { ...admission, appDir: process.cwd(), dependencies: { ...admission.dependencies, root: resolve('node_modules') } }
    const reviewed = { ...seal, requiredImages: CONTEXTUAL_TEST_REQUIRED_IMAGES.map(ref => ({ ref, id: imageId })) }
    const accepted = contextualTestExecutionDigest(base, actualPins, reviewed), input = { ...base, review: { ...base.review, manifestSha256: accepted } }
    const transport = launchModule.createContextualTestPinnedCommand, spawnDouble = native.spawn.getMockImplementation()!
    const child = new Child(9000)
    Object.defineProperties(child, { spawnfile: { value: node }, spawnargs: { value: [node, '/cpu/spec.js'] } })
    const spies = [
      vi.spyOn(launchModule, 'verifyContextualTestTransportPins').mockImplementation(() => {}),
      vi.spyOn(launchModule, 'captureContextualTestSource').mockImplementation(async repository => repository === input.frozen.repository ? input.frozen : input.runner),
      vi.spyOn(launchModule, 'captureContextualTestDependencies').mockReturnValue({ ...input.dependencies, files: 1, bytes: 1 }),
    ]
    let command!: ReturnType<typeof commandFixture>['command']
    spies.push(vi.spyOn(launchModule, 'createContextualTestPinnedCommand').mockImplementation((transportPins, budget, seams) => {
      const real = transport(transportPins, budget, { ...seams, verify() {}, spawn(_file, args) {
        if (args[0] === '--version') {
          const version = new Child(9001)
          version.stdin.end.mockImplementation(() => queueMicrotask(() => { version.stdout.emit('data', Buffer.from(seal.versions.supabase)); version.emit('close', 0, null) }))
          return version as never
        }
        rows.push({ pid: 9000, ppid: 42, pgid: 9000, started: '9000:1', executable: '/foreign', state: 'alive' })
        return child as never
      } })
      command = { ...real, beginCleanup: vi.fn(real.beginCleanup), joinSettlements: vi.fn(real.joinSettlements), assertClosed: vi.fn(real.assertClosed) }
      return command
    }))
    native.spawn.mockImplementation((file: string, args: string[]) => {
      if (file === pins.sandbox.path && args.includes('-e')) {
        const probe = new Child(nextPid++)
        probe.stdin.end.mockImplementation(() => queueMicrotask(() => probe.emit('close', 0, null)))
        return probe
      }
      const helper = spawnDouble(file, args) as Child
      if (file === pins.sandbox.path) rows.forEach(row => { if (row.pgid === helper.pid) row.executable = node })
      const text = file === node ? seal.versions.node : file === pins.docker.path ? imageId : file === pins.ps.path && args.includes('-ww') ? `${node} /cpu/spec.js` : undefined
      if (text !== undefined) helper.stdin.end.mockImplementation(() => queueMicrotask(() => { helper.stdout.emit('data', Buffer.from(text)); helper.emit('close', 0, null) }))
      return helper
    })
    const receipts: unknown[] = []
    try {
      const controls = createContextualTestExecutionControls(input, actualPins, { ...reviewed, manifestSha256: accepted })
      await controls.assertReady(input)
      const appOwned = await controls.launchApp({ binding: { projectId: input.projectId }, cwd: input.appDir, env: {}, args: ['/cpu/spec.js'], dependencySandboxProfile: '(version 1)' } as never) as Awaited<ReturnType<ReturnType<typeof createContextualTestNativeControls>['spawnOwned']>>
      const rejected = expect(command.run('git', ['status'])).rejects.toThrow()
      child.emit('error'); await vi.advanceTimersByTimeAsync(0)
      expect(command.state().poisoned).toBe(true); expect(kill).not.toHaveBeenCalled()
      child.emit('close', 1, null); await rejected
      const expectedEnd = caller === 'execution' ? Date.now() + 5000 : Math.min(admission.cleanupDeadline, Date.now() + 360000)
      if (caller === 'execution') {
        const failure = await controls.settleAll(expectedEnd).catch(error => error) as AggregateError
        expect(failure.errors.map(error => error.cleanupStage)).toContain('command-entry')
      } else {
        // Controller admission is independently validated against the ordinary
        // fixture; native controls already hold the exact captured app above.
        await expect(runContextualTestRehearsalController(admission, { ...controls, assertReady: async () => {} }, {
          openEvidence() {}, createAdapters() { return {} },
          async lifecycle(_identity: unknown, _migrations: unknown, _adapters: unknown, _work: unknown, settle: () => Promise<void>) { await settle() },
          writeReceipt(receipt: unknown) { receipts.push(receipt) },
        } as never)).rejects.toThrow()
        expect(receipts[0]).toMatchObject({ outcome: 'failed', ownedSettled: false })
      }
      expect(kill.mock.calls).toEqual([[-1000, 'SIGTERM']])
      expect(appOwned.state().closed).toBe(true)
      expect(command.joinSettlements).toHaveBeenCalled(); expect(command.assertClosed).toHaveBeenCalled()
      expect(command.beginCleanup.mock.calls.every(([end]) => end === expectedEnd)).toBe(true)
      expect(command.state()).toMatchObject({ poisoned: true, cleaning: true, pending: 0 })
      expect(rows.some(row => row.pgid === 1000)).toBe(false)
      await expect(command.run('git', ['status'])).rejects.toThrow()
    } finally { for (const spy of spies.reverse()) spy.mockRestore() }
  })
  it.each([false, true])('composes the actual controller and real native admission predicate; changed=%s', async changed => {
    const { admission, seal } = sealFixture(), actualPins = { ...pins, node: pin(realpathSync(process.execPath)) }
    const accepted = contextualTestExecutionDigest(admission, actualPins, seal)
    const input = { ...admission, review: { ...admission.review, manifestSha256: accepted } }
    const controls = createContextualTestExecutionControls(input, actualPins, { ...seal, manifestSha256: accepted })
    if (changed) input.deadline++
    native.spawn.mockImplementationOnce(() => { throw Error('CPU first native edge forbidden') })
    await expect(runContextualTestRehearsalController(input, controls)).rejects.toThrow('Private contextual Test controller failed')
    // The valid copied snapshot crosses the exact binding predicate and reaches
    // the forbidden CPU I/O double; drift fails before any such edge or write.
    expect(native.spawn).toHaveBeenCalledTimes(changed ? 0 : 1)
    expect(kill).not.toHaveBeenCalled()
  })
})
