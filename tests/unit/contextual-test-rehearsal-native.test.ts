import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { resolve } from 'node:path'
const native = vi.hoisted(() => ({ spawn: vi.fn(), verify: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: native.spawn }))
vi.mock('../../scripts/contextual-test-rehearsal-launch', async original => ({
  ...await original<typeof import('../../scripts/contextual-test-rehearsal-launch')>(), verifyContextualTestBinary: native.verify,
}))
import { createContextualTestExecutionControls, createContextualTestNativeControls, contextualTestExecutionDigest, type ContextualTestNativePins } from '../../scripts/contextual-test-rehearsal-native'
import type { ContextualTestControllerAdmission } from '../../scripts/contextual-test-rehearsal-controller'

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
let rows: Row[], app: Child, kill: ReturnType<typeof vi.spyOn>, nextPid: number, output: string
beforeEach(() => {
  native.spawn.mockReset(); native.verify.mockReset(); rows = []; nextPid = 8000; output = ''
  kill = vi.spyOn(process, 'kill').mockImplementation(((pid: number) => {
    if (pid < 0) rows = rows.filter(row => row.pgid !== -pid)
    else rows = rows.filter(row => row.pid !== pid)
    if (!rows.some(row => row.pid === 1000)) app.emit('close', 0)
    return true
  }) as typeof process.kill)
  native.spawn.mockImplementation((file: string, args: string[]) => {
    if (file === pins.sandbox.path) {
      app = new Child(1000)
      rows = [{ pid: 1000, ppid: 42, pgid: 1000, started: '100:1', executable: pins.node.path, state: 'alive' },
        { pid: 1001, ppid: 1000, pgid: 1000, started: '100:2', executable: pins.node.path, state: 'alive' }]
      return app
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
afterEach(() => { kill.mockRestore() })
const launch = () => ({ args: ['/cpu/spec.js'], cwd: process.cwd(), env: {}, role: 'app' as const, profile: '(version 1)\n(allow default)', deadline: Date.now() + 10000 })

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
})

describe('fresh execution seal (CPU only, no admission)', () => {
  function sealFixture() {
    const now = Date.now(), source = { repository: '/cpu/source', head: 'a'.repeat(40), tree: 'b'.repeat(40), entries: [], bytes: 0, sha256: 'c'.repeat(64) }
    const admission = { version: 1, projectId: 'pika_assignment_list_123456abcdef', nonce: '0'.repeat(20) + '123456abcdef',
      startedAt: now - 1, deadline: now + 60000, cleanupDeadline: now + 120000, frozen: source, runner: source,
      dependencies: { root: '/cpu/deps', roots: ['/cpu/deps'], sha256: 'd'.repeat(64) }, migrationChainSha256: 'e'.repeat(64),
      review: { manifestSha256: 'f'.repeat(64) }, transportPins: { git: pin('/cpu/git'), docker: pins.docker, supabase: pin('/cpu/supabase'),
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
})
