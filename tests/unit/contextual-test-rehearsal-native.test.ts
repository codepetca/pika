import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { join, resolve } from 'node:path'
import { realpathSync } from 'node:fs'
import { createHash } from 'node:crypto'
const native = vi.hoisted(() => ({ spawn: vi.fn(), verify: vi.fn(), listen: vi.fn() }))
const routeReadiness = vi.hoisted(() => ({ run: vi.fn(), settle: vi.fn(), assertClosed: vi.fn() }))
vi.mock('../../scripts/contextual-test-route-readiness', () => ({ createContextualTestRouteReadiness: () => routeReadiness }))
vi.mock('node:child_process', () => ({ spawn: native.spawn }))
vi.mock('node:net', () => ({ createServer: () => ({ once() {}, listen(options: unknown, ready: () => void) { native.listen(options); ready() }, close(done: () => void) { done() } }) }))
vi.mock('../../scripts/contextual-test-rehearsal-launch', async original => ({
  ...await original<typeof import('../../scripts/contextual-test-rehearsal-launch')>(), verifyContextualTestBinary: native.verify,
}))
import { CONTEXTUAL_TEST_REQUIRED_IMAGES, createContextualTestExecutionControls, createContextualTestNativeControls, contextualTestExecutionDigest, type ContextualTestNativePins } from '../../scripts/contextual-test-rehearsal-native'
import type { ContextualTestControllerAdmission } from '../../scripts/contextual-test-rehearsal-controller'
import { runContextualTestRehearsalController } from '../../scripts/contextual-test-rehearsal-controller'
import { createContextualTestPlan } from '../../e2e/helpers/contextual-test-rehearsal'
import { settleOwnedFamily, type Capture, type OwnedProcessRow } from '../../scripts/contextual-test-process-ownership'
import * as launchModule from '../../scripts/contextual-test-rehearsal-launch'
import { contextualTestVerticalCommands, contextualTestVerticalProfile, contextualTestVerticalNetworkProbe } from '../../scripts/contextual-test-vertical-environment'

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
type Row = { pid: number; ppid: number; pgid: number; started: string; executable: string; state: string;
  uniqueId?: string; parentUniqueId?: string; imageUuid?: string; pidVersion?: number | null }
function kernelRow(row: Row) {
  if (row.state === 'unverified') return { ...row, started: 'unverified', executable: '', uniqueId: '',
    parentUniqueId: '', imageUuid: '', pidVersion: null }
  return { ...row, uniqueId: row.uniqueId ?? String(row.pid * 10), parentUniqueId: row.parentUniqueId ?? String(row.ppid * 10),
    imageUuid: row.state === 'starting' ? '' : row.imageUuid ?? 'a'.repeat(32),
    pidVersion: row.state === 'starting' ? null : row.pidVersion ?? 1 }
}
const pin = (path: string) => ({ path, sha256: 'a'.repeat(64) })
const pins: ContextualTestNativePins = {
  node: pin('/cpu/node'), ps: pin('/cpu/ps'), python: pin('/cpu/python'), lsof: pin('/cpu/lsof'), sandbox: pin('/cpu/sandbox'),
  codesign: pin('/cpu/codesign'), chrome: pin('/cpu/chrome'), docker: pin('/cpu/docker'),
  helper: { path: resolve('scripts/contextual-test-process-identity.py'), sha256: '4b5d355992525ce7eeca1d03e7a1170a63bf71a3c6be82f3d8d43c79c5a3c53b' },
  dockerHost: 'unix:///cpu/docker.sock', outputDir: '/private/tmp',
}
let rows: Row[], app: Child, owned: Child[], kill: ReturnType<typeof vi.spyOn>, nextPid: number, output: string
beforeEach(() => {
  routeReadiness.run.mockReset().mockResolvedValue(undefined); routeReadiness.settle.mockReset().mockResolvedValue(undefined); routeReadiness.assertClosed.mockReset()
  native.spawn.mockReset(); native.verify.mockReset(); native.listen.mockReset(); rows = []; owned = []; nextPid = 8000; output = ''
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
      if (file === pins.python.path) text = JSON.stringify({ schema: 3, rows: inventory.map(kernelRow) })
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
  it('defers first exec, accepts pathname publication, then poisons on an image-generation change', async () => {
    vi.useFakeTimers()
    const controls = createContextualTestNativeControls(pins, Date.now() + 20000), child = await controls.spawnOwned({ ...launch(), role: 'browser' })
    const starting: Row = { pid: 1002, ppid: 1000, pgid: 1000, started: '1002:1', executable: '', state: 'starting' }
    rows.push(starting)
    await vi.advanceTimersByTimeAsync(250)
    expect(child.state().family.pending).toHaveLength(1)
    expect(child.state().uncertain).toBe(false)
    expect(kill).not.toHaveBeenCalled()
    starting.state = 'alive'; starting.executable = '/cpu/helper'
    await vi.advanceTimersByTimeAsync(250)
    expect(child.state().family.pending).toEqual([])
    expect(child.state().family.descendants.some(p => p.pid === starting.pid && p.executable === '/cpu/helper')).toBe(true)
    starting.executable = '/cpu/published-helper'
    await vi.advanceTimersByTimeAsync(250)
    expect(child.state().uncertain).toBe(false)
    expect(kill).not.toHaveBeenCalled()
    starting.executable = '/cpu/other'; starting.pidVersion = 2
    await vi.advanceTimersByTimeAsync(250)
    expect(child.state().uncertain).toBe(true)
    await expect(controls.spawnOwned(launch())).rejects.toThrow()
    rows = []; owned[0].emit('close', 1)
    await expect(controls.settleAll(Date.now() + 5000)).rejects.toThrow()
    expect(kill).not.toHaveBeenCalled()
  })
  it('holds readiness until pending children complete exec under the original deadline', async () => {
    vi.useFakeTimers()
    const controls = createContextualTestNativeControls(pins, Date.now() + 20000), child = await controls.spawnOwned(launch())
    const starting = { pid: 1002, ppid: 1000, pgid: 1000, started: '1002:1', executable: '', state: 'starting' }
    rows.push(starting); app.stdout.emit('data', Buffer.from('Ready in 1ms'))
    let ready = false
    const work = child.ready().then(() => { ready = true })
    await vi.advanceTimersByTimeAsync(25)
    expect(ready).toBe(false); expect(routeReadiness.run).not.toHaveBeenCalled()
    starting.state = 'alive'; starting.executable = '/cpu/helper'
    await vi.advanceTimersByTimeAsync(25)
    await work
    expect(ready).toBe(true)
    await controls.settleAll(Date.now() + 5000)
    controls.assertClosed()
  })
  it('refuses positive runner wait while a child is still pending and retains poison after closure', async () => {
    vi.useFakeTimers()
    const controls = createContextualTestNativeControls(pins, Date.now() + 20000), child = await controls.spawnOwned({ ...launch(), role: 'browser' })
    rows.push({ pid: 1002, ppid: 1000, pgid: 1000, started: '1002:1', executable: '', state: 'starting' })
    await vi.advanceTimersByTimeAsync(250)
    const work = child.wait()
    owned[0].emit('close', 0)
    await expect(work).rejects.toThrow()
    expect(child.state().uncertain).toBe(true)
    rows = []
    await expect(controls.settleAll(Date.now() + 5000)).rejects.toThrow()
    expect(kill).not.toHaveBeenCalled(); expect(() => controls.assertClosed()).toThrow()
  })
  it('never extends readiness for a child that remains before first exec', async () => {
    vi.useFakeTimers()
    const start = Date.now(), controls = createContextualTestNativeControls(pins, start + 20000)
    const child = await controls.spawnOwned({ ...launch(), deadline: start + 100 })
    rows.push({ pid: 1002, ppid: 1000, pgid: 1000, started: '1002:1', executable: '', state: 'starting' })
    app.stdout.emit('data', Buffer.from('Ready in 1ms'))
    const work = expect(child.ready()).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(100); await work
    expect(Date.now()).toBe(start + 100)
    expect(routeReadiness.run).not.toHaveBeenCalled(); expect(kill).not.toHaveBeenCalled()
    rows = []; owned[0].emit('close', 1)
    await expect(controls.settleAll(start + 1000)).rejects.toThrow()
    expect(() => controls.assertClosed()).toThrow()
  })
  it.each(['started', 'pgid', 'executable', 'all'] as const)('retains the first private %s mismatch detail through positive closure without changing uncertainty', async field => {
    vi.useFakeTimers()
    const control = createContextualTestNativeControls(pins, Date.now() + 20000), child = await control.spawnOwned(launch())
    if (field === 'started' || field === 'all') rows[0].started = '987654321:123456'
    if (field === 'pgid' || field === 'all') rows[0].pgid = 7654321
    if (field === 'executable' || field === 'all') rows[0].executable = '/PRIVATE-SENTINEL'
    await vi.advanceTimersByTimeAsync(250)
    const detail = { member: 'root', state: 'alive', startTimeChanged: field === 'started' || field === 'all',
      pgidChanged: field === 'pgid' || field === 'all', executableChanged: field === 'executable' || field === 'all' }
    expect(control.diagnostics().firstFailure).toMatchObject({ cause: 'identity-mismatch', identityMismatch: detail })
    rows = []; owned[0].emit('close', 1)
    await expect(control.settleAll(Date.now() + 5000)).rejects.toThrow()
    expect(control.diagnostics().firstFailure).toMatchObject({ identityMismatch: detail, closed: false, uncertain: true })
    expect(child.state()).toMatchObject({ closed: true, uncertain: true })
    expect(() => control.assertClosed()).toThrow(); expect(kill).not.toHaveBeenCalled()
    expect(JSON.stringify(control.diagnostics())).not.toMatch(/987654321|123456|7654321|PRIVATE-SENTINEL|\/cpu/)
  })
  it('keeps route readiness inside the original ready end and blocks success until the route completes', async () => {
    const started = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(started)
    let finish!: () => void
    const pending = new Promise<void>(resolve => { finish = resolve })
    routeReadiness.run.mockImplementationOnce(async end => { expect(end).toBe(started + 180000); await pending })
    try {
      const controls = createContextualTestNativeControls(pins, started + 300000), child = await controls.spawnOwned({ ...launch(), deadline: started + 240000 })
      let ready = false
      const run = child.ready().then(() => { ready = true })
      clock.mockReturnValue(started + 170000)
      app.stdout.emit('data', Buffer.from('Ready in 1ms'))
      await vi.waitFor(() => expect(routeReadiness.run).toHaveBeenCalledOnce())
      expect(ready).toBe(false)
      finish(); await run
      await controls.settleAll(started + 175000)
      expect(routeReadiness.settle).toHaveBeenCalledWith(started + 175000)
      controls.assertClosed()
    } finally { finish?.(); clock.mockRestore() }
  })
  it('rejects route readiness failure and still settles verified processes without granting readiness', async () => {
    routeReadiness.run.mockRejectedValueOnce(Error('DO-NOT-RECORD route'))
    const controls = createContextualTestNativeControls(pins, Date.now() + 20000), child = await controls.spawnOwned(launch())
    app.stdout.emit('data', Buffer.from('Ready in 1ms'))
    await expect(child.ready()).rejects.toThrow()
    await controls.settleAll(Date.now() + 5000)
    expect(routeReadiness.settle).toHaveBeenCalledOnce(); expect(child.state().closed).toBe(true)
    expect(controls.diagnostics().firstFailure).toMatchObject({ role: 'app', phase: 'ready', cause: 'route-readiness' })
    expect(JSON.stringify(controls.diagnostics())).not.toContain('DO-NOT-RECORD')
  })
  it.each(['listener', 'processes', 'identity'])('rejects a final %s observation beyond the original ready end and still cleans up', async phase => {
    vi.useFakeTimers()
    const started = Date.now()
    let afterRoute = false, crossed = false
    routeReadiness.run.mockImplementationOnce(async end => {
      expect(end).toBe(started + 180000)
      vi.setSystemTime(end - 2); afterRoute = true
    })
    const spawnDouble = native.spawn.getMockImplementation()!
    native.spawn.mockImplementation((file: string, args: string[]) => {
      const helper = spawnDouble(file, args) as Child
      const matches = phase === 'listener' ? file === pins.lsof.path && args.includes('-iTCP:3117') :
        phase === 'processes' ? file === pins.ps.path && args[0] === '-axo' : file === pins.python.path
      if (afterRoute && !crossed && matches) {
        const end = helper.stdin.end.getMockImplementation()!
        helper.stdin.end.mockImplementation(() => {
          crossed = true; vi.setSystemTime(started + 180001); return end()
        })
      }
      return helper
    })
    const controls = createContextualTestNativeControls(pins, started + 300000)
    const child = await controls.spawnOwned({ ...launch(), deadline: started + 240000 })
    app.stdout.emit('data', Buffer.from('Ready in 1ms'))
    await expect(child.ready()).rejects.toThrow()
    expect(crossed).toBe(true)
    await controls.settleAll(started + 290000)
    expect(child.state().closed).toBe(true); controls.assertClosed()
  })
  it('retains route closure failure while still attempting every verified-family cleanup', async () => {
    routeReadiness.settle.mockRejectedValueOnce(Error('DO-NOT-RECORD route close'))
    const controls = createContextualTestNativeControls(pins, Date.now() + 20000), child = await controls.spawnOwned(launch())
    await expect(controls.settleAll(Date.now() + 5000)).rejects.toThrow()
    expect(child.state().closed).toBe(true)
    expect(controls.diagnostics().firstFailure).toMatchObject({ role: 'app', phase: 'settle', cause: 'route-closure' })
    expect(() => controls.assertClosed()).toThrow()
  })
  it('retains the first monitor cause after positive close and absence, isolated from the other role', async () => {
    vi.useFakeTimers()
    const control = createContextualTestNativeControls(pins, Date.now() + 20000)
    const appChild = await control.spawnOwned(launch())
    const browserChild = await control.spawnOwned({ ...launch(), role: 'browser' })
    rows[0].state = 'unverified'
    await vi.advanceTimersByTimeAsync(250)
    expect(appChild.state().uncertain).toBe(true)
    expect(browserChild.state().uncertain).toBe(false)
    rows = []; for (const child of owned) child.emit('close', 1)
    await expect(control.settleAll(Date.now() + 5000)).rejects.toThrow()
    expect(control.diagnostics()).toMatchObject({
      firstFailure: { role: 'app', phase: 'monitor', cause: 'kernel-unverified', closed: false, uncertain: true },
      activeProbes: 0, unsettledFamilies: 0,
    })
    expect(control.diagnostics().failures.some(row => row.role === 'browser')).toBe(false)
    expect(() => control.assertClosed()).toThrow()
    expect(kill).not.toHaveBeenCalled()
  })
  it('reports active probe aggregate counts without granting closure', async () => {
    vi.useFakeTimers()
    const control = createContextualTestNativeControls(pins, Date.now() + 20000), probe = new Child(9000)
    native.spawn.mockReturnValueOnce(probe)
    const rejected = expect(control.probe(pins.docker, [], Date.now() + 1000)).rejects.toThrow()
    await expect(control.settleAll(Date.now() + 5000)).rejects.toThrow()
    expect(control.diagnostics()).toMatchObject({ activeProbes: 1, unsettledFamilies: 0, firstFailure: null })
    expect(control.diagnostics().failures).toContainEqual({ role: 'unknown', phase: 'aggregate', cause: 'active-probes', closed: false, uncertain: false, identityMismatch: null })
    probe.emit('close', 0, null); await rejected
    expect(control.diagnostics().activeProbes).toBe(0)
    expect(() => control.assertClosed()).toThrow()
  })
  it.each(['output', 'child'])('retains the fixed %s failure without clearing uncertainty on close', async source => {
    const control = createContextualTestNativeControls(pins, Date.now() + 20000), child = await control.spawnOwned(launch())
    if (source === 'output') owned[0].stderr.emit('data', { length: 64 * 1024 ** 2 + 1 })
    else owned[0].emit('error', Error('PRIVATE-SENTINEL'))
    rows = []; owned[0].emit('close', 1)
    await expect(control.settleAll(Date.now() + 5000)).rejects.toThrow()
    expect(control.diagnostics().firstFailure).toEqual({ role: 'app', phase: 'monitor',
      cause: source === 'output' ? 'output-overflow' : 'child-error', closed: false, uncertain: true, identityMismatch: null })
    expect(child.state().closed).toBe(true); expect(() => control.assertClosed()).toThrow()
    expect(JSON.stringify(control.diagnostics())).not.toContain('PRIVATE-SENTINEL')
  })
  it('retains signal-error without reading the private thrown error or accepting closure', async () => {
    const control = createContextualTestNativeControls(pins, Date.now() + 20000)
    await control.spawnOwned(launch())
    kill.mockImplementation(() => { throw Error('PRIVATE-SENTINEL') })
    await expect(control.settleAll(Date.now() + 5000)).rejects.toThrow()
    expect(control.diagnostics()).toMatchObject({ firstFailure: { role: 'app', phase: 'settle', cause: 'signal-error' }, unsettledFamilies: 1 })
    expect(JSON.stringify(control.diagnostics())).not.toContain('PRIVATE-SENTINEL')
    expect(() => control.assertClosed()).toThrow()
  })
  it.each(['own', 'getter', 'proxy', 'inherited', 'descriptor', 'private'])('projects only safe own fixed process causes: %s', async shape => {
    vi.useFakeTimers()
    const secret = vi.fn(() => { throw Error('PRIVATE-SENTINEL') })
    const error = shape === 'own' ? { processCause: 'identity-mismatch', message: 'PRIVATE-SENTINEL', identityMismatch: { member: 'root', state: 'alive', startTimeChanged: true, pgidChanged: false, executableChanged: false } }
      : shape === 'getter' ? Object.defineProperty({}, 'processCause', { get: secret })
      : shape === 'proxy' ? new Proxy({}, { get: secret, getOwnPropertyDescriptor: secret, getPrototypeOf: secret })
      : shape === 'inherited' ? Object.create({ processCause: 'identity-mismatch' })
      : { processCause: 'PRIVATE-SENTINEL' }
    const create = launchModule.createContextualTestOwnedFamily
    const factory = vi.spyOn(launchModule, 'createContextualTestOwnedFamily').mockImplementation(input => {
      const family = create(input)
      return { ...family, async observe() { throw error } }
    })
    const getDescriptor = Object.getOwnPropertyDescriptor
    const descriptorSpy = shape === 'descriptor' ? vi.spyOn(Object, 'getOwnPropertyDescriptor').mockImplementation((target, key) =>
      target === error && key === 'processCause' ? Object.create({ get value() { return secret() } }) : getDescriptor(target, key)) : undefined
    try {
      const control = createContextualTestNativeControls(pins, Date.now() + 20000), child = await control.spawnOwned(launch())
      await vi.advanceTimersByTimeAsync(250)
      rows = []; owned[0].emit('close', 1)
      await expect(control.settleAll(Date.now() + 5000)).rejects.toThrow()
      expect(control.diagnostics().firstFailure?.cause).toBe(shape === 'own' ? 'identity-mismatch' : 'unknown')
      expect(control.diagnostics().firstFailure?.identityMismatch).toBeNull()
      expect(JSON.stringify(control.diagnostics())).not.toContain('PRIVATE-SENTINEL')
      expect(secret).not.toHaveBeenCalled(); expect(child.state().uncertain).toBe(true)
    } finally { descriptorSpy?.mockRestore(); factory.mockRestore() }
  })
  it('bounds copied diagnostic snapshots and preserves the first failure across overflow', async () => {
    const control = createContextualTestNativeControls(pins, Date.now() + 20000)
    const empty = control.diagnostics()
    for (let i = 0; i < 20; i++) await expect(control.settleCommand(new Child(9990) as never, Date.now() + 5000)).rejects.toThrow()
    const snapshot = control.diagnostics(), again = control.diagnostics()
    expect(empty).toEqual({ firstFailure: null, failures: [], overflow: false, activeProbes: 0, unsettledFamilies: 0 })
    expect(snapshot.failures).toHaveLength(16); expect(snapshot.overflow).toBe(true)
    expect(snapshot.firstFailure).toEqual(snapshot.failures[0])
    expect(snapshot).not.toBe(again); expect(snapshot.failures).not.toBe(again.failures)
    expect(snapshot.firstFailure).not.toBe(again.firstFailure)
    for (const row of snapshot.failures) expect(Object.keys(row).sort()).toEqual(['cause','closed','identityMismatch','phase','role','uncertain'])
    expect(native.spawn.mock.calls.length).toBe(2); expect(kill).not.toHaveBeenCalled()
  })
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
  it('checks the private app listener for the gateway-backed narrow lane', async () => {
    const controls = createContextualTestNativeControls(pins, Date.now() + 20000)
    const child = await controls.spawnOwned({ ...launch(), listenerPort: 3118 })
    app.stdout.emit('data', Buffer.from('✓ Ready in 100ms\n'))
    try {
      await child.ready()
      expect(native.spawn.mock.calls.some(([, args]) => args.includes('-iTCP:3118'))).toBe(true)
    } finally { await controls.settleAll(Date.now() + 5000) }
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
    const capture: Capture = { identity: { pid: 1000, pgid: 1000, started: '100:1', executable: '/cpu/node', cwd: '/cpu', role: 'app',
      uniqueId: '10000', imageUuid: 'a'.repeat(32), pidVersion: 1 }, descendants: [] }
    let time = 1000, alive = true, closed = false
    const signals: Array<{ signal: string; at: number }> = []
    const end = time + 360000
    const result = await settleOwnedFamily(capture, 'group', {
      rows: async () => { time += 1000; return alive ? [{ ...capture.identity, ppid: 42, parentUniqueId: '420', state: 'alive' }] as OwnedProcessRow[] : [] },
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
    const projection = { version: 1, projectId: admission.projectId, nonce: admission.nonce,
      startedAt: admission.startedAt, deadline: admission.deadline, cleanupDeadline: admission.cleanupDeadline,
      frozen: admission.frozen, runner: admission.runner, dependencies: admission.dependencies, transportPins: admission.transportPins, nativePins: pins,
      migrationChainSha256: admission.migrationChainSha256, appOverlaySha256: createContextualTestPlan(admission.projectId).appOverlaySha256,
      requiredImages: seal.requiredImages, versions: seal.versions, capacity: seal.capacity }
    expect(first).toBe(createHash('sha256').update(JSON.stringify(projection)).digest('hex'))
    expect(first).not.toBe(createHash('sha256').update(JSON.stringify({ ...projection, appOverlaySha256: undefined })).digest('hex'))
    expect(contextualTestExecutionDigest(admission, pins, seal)).toBe(first)
    expect(contextualTestExecutionDigest({ ...admission, proofScope: 'vertical-v1' }, pins, seal)).not.toBe(first)
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
    const actualPins = { ...pins, node: pin(node), chrome: { path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', sha256: '63ee57066ef61169445ded279701d974ad23c805a60b8f77a4b8776183ac58fb' } }
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
  it.each(['stable', 'source', 'dependencies', 'vertical-v1', 'vertical-grade-return-v1', 'lifecycle-permissions-v1', 'survey-workflow-v1'] as const)('checks actual native admission, launch controls and unchanged state; %s', async change => {
    vi.useFakeTimers()
    const { admission, seal } = sealFixture(), node = realpathSync(process.execPath), imageId = 'sha256:' + 'a'.repeat(64)
    const actualPins = { ...pins, node: pin(node), chrome: { path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', sha256: '63ee57066ef61169445ded279701d974ad23c805a60b8f77a4b8776183ac58fb' } }
    const proofScope = change === 'stable' || change === 'source' || change === 'dependencies' ? undefined : change
    const base = { ...admission, ...(proofScope ? { proofScope } : {}), outputDir: '/private/cpu-output', appDir: process.cwd(), runner: { ...admission.runner, repository: process.cwd() },
      dependencies: { ...admission.dependencies, root: resolve('node_modules') } }
    actualPins.outputDir = base.outputDir
    base.transportPins = { ...base.transportPins, outputDir: base.outputDir }
    const reviewed = { ...seal, requiredImages: CONTEXTUAL_TEST_REQUIRED_IMAGES.map(ref => ({ ref, id: imageId })) }
    const accepted = contextualTestExecutionDigest(base, actualPins, reviewed), input = { ...base, review: { ...base.review, manifestSha256: accepted } }
    const transport = launchModule.createContextualTestPinnedCommand, spawnDouble = native.spawn.getMockImplementation()!
    let command!: ReturnType<typeof transport>, afterSettlement = false
    const sourceChecks: Array<{ cleaning: boolean; deadline: number }> = []
    const spies = [
      vi.spyOn(launchModule, 'verifyContextualTestTransportPins').mockImplementation(() => {}),
      vi.spyOn(launchModule, 'assertContextualTestUnusedRunnerOutput').mockImplementation(() => {}),
      vi.spyOn(launchModule, 'captureContextualTestSource').mockImplementation(async (repository, _head, _tree, run, deadline) => {
        sourceChecks.push({ cleaning: command.state().cleaning, deadline })
        // Exercise the actual pinned transport supplied by execution controls,
        // including its admission and positive command-close predicate.
        await expect(run('git', ['-C', repository, 'status', '--porcelain'])).resolves.toBe('')
        const source = repository === input.frozen.repository ? input.frozen : input.runner
        return afterSettlement && change === 'source' ? { ...source, sha256: '0'.repeat(64) } : source
      }),
      vi.spyOn(launchModule, 'captureContextualTestDependencies').mockImplementation(() => ({ ...input.dependencies, files: 1, bytes: 1,
        sha256: afterSettlement && change === 'dependencies' ? '0'.repeat(64) : input.dependencies.sha256 })),
      vi.spyOn(launchModule, 'createContextualTestPinnedCommand').mockImplementation((transportPins, budget, seams) => {
        command = transport(transportPins, budget, { ...seams, verify() {}, spawn(_file, args) {
          const child = new Child(nextPid++)
          child.stdin.end.mockImplementation(() => queueMicrotask(() => {
            child.stdout.emit('data', Buffer.from(args[0] === '--version' ? seal.versions.supabase : ''))
            child.emit('close', 0, null)
          }))
          return child as never
        } })
        return command
      }),
    ]
    native.spawn.mockImplementation((file: string, args: string[]) => {
      if (file === pins.sandbox.path && args.includes('-e')) {
        const probe = new Child(nextPid++)
        probe.stdin.end.mockImplementation(() => queueMicrotask(() => {
          if (args.some(arg => arg.includes('vertical-network-denied-v1'))) probe.stdout.emit('data', Buffer.from('vertical-network-denied-v1'))
          probe.emit('close', 0, null)
        }))
        return probe
      }
      const helper = spawnDouble(file, args) as Child
      if (file === pins.sandbox.path) rows.forEach(row => { if (row.pgid === helper.pid) row.executable = node })
      const text = file === node ? seal.versions.node : file === pins.docker.path ? imageId : file === pins.ps.path && args.includes('-ww') ? `${node} /cpu/spec.js` : undefined
      if (text !== undefined) helper.stdin.end.mockImplementation(() => queueMicrotask(() => { helper.stdout.emit('data', Buffer.from(text)); helper.emit('close', 0, null) }))
      return helper
    })
    try {
      const controls = createContextualTestExecutionControls(input, actualPins, { ...reviewed, manifestSha256: accepted })
      await controls.assertReady(input)
      if (proofScope) {
        expect(native.listen.mock.calls.map(([options]) => options.port)).toEqual([3117, 3118, 54331, 54332, 54340])
        const commands = contextualTestVerticalCommands(input.runner.repository, input.dependencies.root)
        for (const role of ['app', 'browser'] as const) {
          const profile = contextualTestVerticalProfile(role, input.dependencies.roots, input.workdir, input.outputDir)
          expect(native.spawn.mock.calls.some(([file, args]) => file === pins.sandbox.path && JSON.stringify(args) === JSON.stringify([
            '-p', profile, node, '-e', contextualTestVerticalNetworkProbe(role, '/cpu/docker.sock'),
          ]))).toBe(true)
          const valid = { binding: { projectId: input.projectId, outputDir: input.outputDir, proofScope }, cwd: process.cwd(),
            listenerPort: 3118, args: role === 'app' ? commands.app : commands.runner, dependencySandboxProfile: profile,
            env: { TMPDIR: join(input.workdir, 'tmp'), MAC_CHROMIUM_TMPDIR: join(input.workdir, 'tmp') } }
          const execute = role === 'app' ? controls.launchApp : controls.launchPlaywright
          const invalid = [ { ...valid, dependencySandboxProfile: '(allow default)' }, { ...valid, args: ['/cpu/spec.js'] },
            { ...valid, env: { ...valid.env, NODE_OPTIONS: '--require=/foreign.js' } },
            ...[undefined, 'unknown', proofScope === 'vertical-v1' ? 'survey-workflow-v1' : 'vertical-v1'].map(scope => ({ ...valid, binding: { ...valid.binding, proofScope: scope } })),
            ...(role === 'app' ? [{ ...valid, listenerPort: 3117 }] : [
              { ...valid, binding: { ...valid.binding, sqlControl: {} } },
              { ...valid, env: { ...valid.env, TMPDIR: '/foreign' } },
              { ...valid, env: { ...valid.env, MAC_CHROMIUM_TMPDIR: '/foreign' } },
            ]),
          ]
          for (const poisoned of invalid) {
            const before = native.spawn.mock.calls.length
            await expect(execute(poisoned as never)).rejects.toThrow()
            expect(native.spawn).toHaveBeenCalledTimes(before)
          }
          // The valid launch traverses the real assertions to the existing
          // subprocess seam. The seam deliberately refuses birth: no process.
          native.spawn.mockImplementationOnce(() => { throw Error('CPU valid launch edge') })
          await expect(execute(valid as never)).rejects.toThrow()
          expect(native.spawn.mock.lastCall?.[1]).toEqual(['-p', profile, node, ...valid.args])
        }
        await controls.settleAll(Date.now() + 5000)
        return
      }
      expect(native.listen.mock.calls.map(([options]) => options.port)).toEqual([3117, 54331, 54332, 54340])
      const launchInput = { binding: { projectId: input.projectId, outputDir: input.outputDir }, cwd: process.cwd(), env: {},
        args: ['/cpu/spec.js'], dependencySandboxProfile: '(version 1)' } as never
      await controls.launchApp(launchInput)
      const browser = await controls.launchPlaywright(launchInput)
      rows = rows.filter(row => row.pgid !== owned[1].pid); owned[1].emit('close', 1, null)
      await expect(browser.wait()).rejects.toThrow()
      const end = Date.now() + 5000
      await controls.settleAll(end); afterSettlement = true
      expect(owned[0].listenerCount('close')).toBe(0); expect(rows).toEqual([])
      expect(kill.mock.calls).toEqual([[-1000, 'SIGTERM']])
      if (change === 'stable') await expect(controls.assertUnchanged()).resolves.toBeUndefined()
      else await expect(controls.assertUnchanged()).rejects.toThrow()
      expect(sourceChecks.slice(0, 2)).toEqual([{ cleaning: false, deadline: input.cleanupDeadline }, { cleaning: false, deadline: input.cleanupDeadline }])
      expect(sourceChecks.slice(2)).toEqual(Array.from({ length: change === 'source' ? 1 : 2 }, () => ({ cleaning: true, deadline: end })))
      expect(command.state()).toEqual({ poisoned: false, fault: false, pending: 0, cleaning: true })
      // No admitted source/dependency recheck renews the cleanup lease.
      vi.setSystemTime(end)
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
