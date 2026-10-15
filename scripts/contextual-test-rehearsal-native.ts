/** Explicit-call native edges for the existing disposable Playwright carrier.
 * Importing this module cannot inspect a process, launch a child or signal one.
 */
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { assertContextualTestUnusedRunnerOutput, captureContextualTestDependencies, captureContextualTestSource, contextualTestReadOnlyDependencyProfile, createContextualTestOwnedFamily,
  createContextualTestPinnedCommand, immutableContextualTestData, verifyContextualTestTransportPins, verifyContextualTestBinary, type ContextualTestBinaryPin } from './contextual-test-rehearsal-launch'
import { parseKernelProcessRows, type OwnedProcessRow } from './contextual-test-process-ownership'
import type { ContextualTestControllerAdmission, ContextualTestControllerControls } from './contextual-test-rehearsal-controller'

export type ContextualTestNativePins = Readonly<{
  node: ContextualTestBinaryPin; ps: ContextualTestBinaryPin; python: ContextualTestBinaryPin
  lsof: ContextualTestBinaryPin; sandbox: ContextualTestBinaryPin; codesign: ContextualTestBinaryPin
  chrome: ContextualTestBinaryPin; docker: ContextualTestBinaryPin
  helper: ContextualTestBinaryPin; dockerHost: string; outputDir: string
}>
type OwnedFamily = ReturnType<typeof createContextualTestOwnedFamily>
export type ContextualTestOwnedChild = Readonly<{
  child: ChildProcess
  ready(): Promise<void>
  wait(): Promise<void>
  settle(end: number): Promise<void>
  state(): { closed: boolean; code: number | null; uncertain: boolean; family: ReturnType<OwnedFamily['snapshot']> }
}>
export type ContextualTestOwnedLaunch = {
  args: readonly string[]; cwd: string; env: Readonly<Record<string, string>>
  role: 'app' | 'browser'; profile: string; deadline: number
}
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const fixedError = () => new Error('Private contextual Test native control failed')

/** Short fixed read-only probes. An unjoined helper poisons the controller; it
 * is never called closed or killed using a guessed PID. Long-lived owned app
 * and browser children use the separately verified family controller below. */
export function createContextualTestNativeControls(pins: ContextualTestNativePins, cleanupDeadline: number) {
  assert.equal(process.platform, 'darwin')
  const env: NodeJS.ProcessEnv = { PATH: '/usr/bin:/bin', HOME: pins.outputDir, LANG: 'C', LC_ALL: 'C', NODE_ENV: 'development' }
  let poisoned = false, cleaning = false, activeProbes = 0, controllerEnd = cleanupDeadline
  const children = new Set<ContextualTestOwnedChild>()
  const checkCleanup = () => assert(Date.now() < controllerEnd, 'Private native cleanup expired')
  const check = () => { assert(!poisoned && !cleaning, 'Private native controller closed'); checkCleanup() }
  // Failure permanently rejects new work. Only private observation for an
  // already captured family may continue, under the original shortened clock.
  const probeWithAdmission = async (admit: () => void, pin: ContextualTestBinaryPin, args: readonly string[], end: number, input?: string): Promise<string> => {
    admit(); verifyContextualTestBinary(pin)
    end = Math.min(end, controllerEnd)
    assert(end > Date.now() && end <= cleanupDeadline && args.every(v => !v.includes('\0')))
    return new Promise((resolve, reject) => {
      const child = spawn(pin.path, [...args], { shell: false, env, cwd: pins.outputDir, stdio: ['pipe','pipe','pipe'] })
      activeProbes++
      let count = 0, failed = false, output = ''
      const timer = setTimeout(() => { poisoned = true; reject(fixedError()) }, Math.min(30000, end - Date.now()))
      child.on('error', () => { failed = true })
      child.stdin.on('error', () => { failed = true })
      child.stdout.on('data', (bytes: Buffer) => { count += bytes.length; if (count > 16 * 1024 ** 2) { failed = true; poisoned = true } else output += bytes.toString('utf8') })
      child.stderr.on('data', (bytes: Buffer) => { count += bytes.length; if (count > 16 * 1024 ** 2) { failed = true; poisoned = true } })
      child.once('close', (code, signal) => {
        clearTimeout(timer); activeProbes--
        try { admit(); verifyContextualTestBinary(pin); assert(!failed && code === 0 && signal === null && Date.now() < end); resolve(output.trim()) }
        catch { reject(fixedError()) }
      })
      child.stdin.end(input)
    })
  }
  const probe = (pin: ContextualTestBinaryPin, args: readonly string[], end: number, input?: string) => probeWithAdmission(check, pin, args, end, input)
  const observeRows = async (admit: () => void, deadline = controllerEnd): Promise<OwnedProcessRow[]> => {
    admit(); const end = Math.min(deadline, controllerEnd, Date.now() + 30000)
    verifyContextualTestBinary(pins.helper)
    assert.equal(pins.helper.sha256, '476c8c4696b8252debabb3ff7c5249deea10349cc91526ebc6eca924ef47f807')
    const text = await probeWithAdmission(admit, pins.ps, ['-axo','pid=,ppid=,pgid='], end)
    const input = text.split('\n').map(line => {
      const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(line); assert(match)
      return match.slice(1).map(Number)
    }).filter(([pid]) => pid > 1)
    assert(input.length <= 20000)
    return parseKernelProcessRows(await probeWithAdmission(admit, pins.python, ['-I','-B', pins.helper.path], end, JSON.stringify(input)))
  }
  const rows = () => observeRows(check)
  const ownedRows = () => observeRows(checkCleanup)
  const birth = async (child: ChildProcess, role: 'app' | 'browser', executable: string, cwd: string, argv: readonly string[], end: number): Promise<OwnedFamily> => {
    assert(child.pid && child.pid > 1)
    while (Date.now() < end) {
      check(); const current = await rows(), root = current.find(row => row.pid === child.pid)
      if (!root) throw fixedError()
      assert(root.state !== 'unverified', 'Private owned process metadata unavailable')
      assert(root.executable === executable || root.executable === pins.sandbox.path, 'Private owned executable drift')
      // sandbox-exec replaces itself with the pinned Node; do not bind the
      // intermediate executable or treat an unverified observation as absence.
      if (root.state === 'alive' && root.executable === executable) {
        const actualArgv = await probe(pins.ps, ['-ww','-p',String(child.pid),'-o','command='], end)
        const actualCwd = await probe(pins.lsof, ['-a','-p',String(child.pid),'-d','cwd','-Fn'], end)
        assert.equal(actualArgv, [executable, ...argv].join(' '))
        assert.equal(actualCwd.split('\n').filter(line => line.startsWith('n')).join('\n'), `n${cwd}`)
        assert(child.exitCode === null && child.signalCode === null, 'Private child exited during birth capture')
        const latest = await rows()
        const fresh = latest.find(row => row.pid === child.pid)
        assert(fresh && fresh.started === root.started && fresh.executable === root.executable && fresh.pgid === root.pgid)
        return createContextualTestOwnedFamily({ pid: child.pid, pgid: child.pid, executable, cwd,
          argv: [executable, ...argv], expectedArgv: [executable, ...argv], expectedCwd: cwd, role, rows: latest })
      }
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    throw fixedError()
  }
  const spawnOwned = async (input: ContextualTestOwnedLaunch): Promise<ContextualTestOwnedChild> => {
    check(); verifyContextualTestBinary(pins.node); verifyContextualTestBinary(pins.sandbox)
    assert(input.deadline > Date.now() && input.deadline <= cleanupDeadline)
    assert(realpathSync(input.cwd) === input.cwd && input.profile.startsWith('(version 1)'))
    const child = spawn(pins.sandbox.path, ['-p', input.profile, pins.node.path, ...input.args], {
      cwd: input.cwd, env: { ...input.env, NODE_ENV: 'development' }, detached: true, shell: false, stdio: ['ignore','pipe','pipe'],
    })
    let closed = false, code: number | null = null, uncertain = false, count = 0, readyText = ''
    let announceReady!: () => void
    const readyPromise = new Promise<void>(resolve => { announceReady = resolve })
    // Never retain raw Next/Playwright output; fixed private receipts are used.
    child.stdout!.on('data', (bytes: Buffer) => {
      count += bytes.length; if (count > 64 * 1024 ** 2) uncertain = true
      if (input.role === 'app') {
        readyText = (readyText + bytes.toString('utf8').replace(/\x1b\[[0-9;]*m/g, '')).slice(-4096)
        if (/Ready in \d/.test(readyText)) { announceReady(); readyText = '' }
      }
    })
    child.stderr!.on('data', (bytes: Buffer) => { count += bytes.length; if (count > 64 * 1024 ** 2) uncertain = true })
    const closedPromise = new Promise<void>(resolve => { child.once('close', value => { closed = true; code = value; resolve() }) })
    child.once('error', () => { uncertain = true })
    let family: OwnedFamily
    try { family = await birth(child, input.role, pins.node.path, input.cwd, input.args, Math.min(input.deadline, Date.now() + 30000)) }
    catch { poisoned = true; throw fixedError() }
    let monitor: Promise<void> = Promise.resolve(), stopping = false
    const tick = setInterval(() => {
      monitor = monitor.then(async () => { if (!stopping) family.refresh(await ownedRows()) }).catch(() => { uncertain = true; poisoned = true })
    }, 250)
    tick.unref()
    const result: ContextualTestOwnedChild = Object.freeze({ child,
      async ready() {
        assert.equal(input.role, 'app')
        const end = Math.min(input.deadline, Date.now() + 180000)
        let timeout: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([readyPromise, closedPromise.then(() => { throw fixedError() }), new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(fixedError()), Math.max(0, end - Date.now()))
          })])
          assert(!closed && !uncertain)
          const listeners = await probe(pins.lsof, ['-nP','-iTCP:3117','-sTCP:LISTEN','-Fp'], end)
          const current = await rows(); const snapshot = family.refresh(current)
          const pids = listeners.split('\n').filter(line => /^p\d+$/.test(line)).map(line => Number(line.slice(1)))
          assert(pids.length > 0 && pids.every(pid => [snapshot.identity,...snapshot.descendants].some(owner => owner.pid === pid)
            && current.some(row => row.pid === pid && row.state === 'alive')))
        } finally { if (timeout) clearTimeout(timeout); readyText = '' }
      },
      async wait() {
        const timer = setTimeout(() => { uncertain = true }, Math.max(0, input.deadline - Date.now()))
        try {
          await Promise.race([closedPromise, new Promise<never>((_, reject) => {
            const handle = setTimeout(() => reject(fixedError()), Math.max(0, input.deadline - Date.now())); handle.unref()
            void closedPromise.then(() => clearTimeout(handle))
          })])
          await monitor; assert(closed && code === 0 && !uncertain && Date.now() < input.deadline)
        } finally { clearTimeout(timer) }
      },
      async settle(end) {
        stopping = true; clearInterval(tick)
        try {
          assert(end <= cleanupDeadline); end = Math.min(end, controllerEnd); assert(end > Date.now()); await monitor
          const admit = () => { checkCleanup(); assert(Date.now() < end) }
          const settlementRows = () => observeRows(admit, end)
          await family.settle(input.role === 'app' ? 'group' : 'pid', {
            rows: settlementRows, now: Date.now, admit,
            signal: (pid, signal) => { process.kill(pid, signal) }, closed: () => closed, end,
          })
          assert(closed && family.absent(await settlementRows())); admit(); children.delete(result)
          assert(!uncertain, 'Private native ownership observation failed')
        } catch { poisoned = true; throw fixedError() }
      },
      state: () => ({ closed, code, uncertain, family: family.snapshot() }),
    })
    children.add(result); return result
  }
  return Object.freeze({ probe, rows, spawnOwned,
    async settleAll(end: number) {
      assert(end <= cleanupDeadline && end <= Date.now() + 360000); controllerEnd = Math.min(controllerEnd, end); cleaning = true
      // Start every verified family before awaiting any failure or slow close.
      // Each retains its own fresh kernel/group checks and the same deadline.
      const results = await Promise.allSettled([...children].reverse().map(child => child.settle(controllerEnd)))
      const failures = results.filter(result => result.status === 'rejected').map(() => fixedError())
      if (poisoned || children.size !== 0 || activeProbes !== 0) failures.push(fixedError())
      if (failures.length) { poisoned = true; throw new AggregateError(failures, 'Private contextual Test native cleanup failed') }
    },
    async settleCommand(child: ChildProcess, end: number) {
      check(); assert(child.pid && child.spawnfile)
      let closed = false
      child.once('close', () => { closed = true })
      const current = await rows(), root = current.find(row => row.pid === child.pid)
      assert(root, 'Failed command ownership unconfirmed')
      assert.equal(root.executable, realpathSync(child.spawnfile))
      const actualArgv = await probe(pins.ps, ['-ww','-p',String(child.pid),'-o','command='], end)
      const actualCwd = await probe(pins.lsof, ['-a','-p',String(child.pid),'-d','cwd','-Fn'], end)
      assert.equal(actualArgv, child.spawnargs.join(' '))
      assert.equal(actualCwd.split('\n').filter(line => line.startsWith('n')).join('\n'), `n${pins.outputDir}`)
      const family = createContextualTestOwnedFamily({ pid: root.pid, pgid: root.pgid, executable: root.executable, cwd: pins.outputDir,
        argv: child.spawnargs, expectedArgv: child.spawnargs, expectedCwd: pins.outputDir, role: 'browser', rows: current })
      await family.settle('pid', { rows, now: Date.now, admit: () => assert(Date.now() < end && !poisoned), signal: (pid, signal) => { process.kill(pid, signal) }, closed: () => closed, end })
    },
    assertClosed() { assert(!poisoned && children.size === 0 && activeProbes === 0) },
  })
}

export async function contextualTestPortsAvailable(ports = [3117, 54331, 54332, 54340]) {
  assert.deepEqual(ports, [3117,54331,54332,54340])
  for (const port of ports) await new Promise<void>((resolve, reject) => {
    const server = createServer(); server.once('error', () => reject(fixedError()))
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => server.close(error => error ? reject(fixedError()) : resolve()))
  })
}

export const CONTEXTUAL_TEST_REQUIRED_IMAGES = Object.freeze(['public.ecr.aws/supabase/postgres:17.6.1.143',
  'public.ecr.aws/supabase/gotrue:v2.192.0','public.ecr.aws/supabase/postgrest:v14.14',
  'public.ecr.aws/supabase/storage-api:v1.62.5','public.ecr.aws/supabase/kong:2.8.1'])
export async function verifyContextualTestNativeReadiness(pins: ContextualTestNativePins, input: {
  deadline: number; dependencyProbeFile: string; profile: string; requiredImages: readonly { ref: string; id: string }[]
}, control: ReturnType<typeof createContextualTestNativeControls>) {
  assert.equal(process.platform, 'darwin')
  for (const key of ['node','ps','python','lsof','sandbox','codesign','chrome','docker'] as const) verifyContextualTestBinary(pins[key])
  assert.equal(pins.chrome.path, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
  assert.equal(pins.chrome.sha256, 'fbeec33e75ea8da7bdb6e48f987ed32f5089c49d86013046e87319f5df11c13f')
  assert.equal(sha(readFileSync(pins.helper.path)), '476c8c4696b8252debabb3ff7c5249deea10349cc91526ebc6eca924ef47f807')
  await control.probe(pins.codesign, ['--verify','--deep','--strict',dirname(dirname(dirname(pins.chrome.path)))], input.deadline)
  assert.deepEqual(input.requiredImages.map(image => image.ref).sort(), [...CONTEXTUAL_TEST_REQUIRED_IMAGES].sort())
  for (const image of input.requiredImages) {
    assert(/^sha256:[a-f0-9]{64}$/.test(image.id))
    assert.equal(await control.probe(pins.docker, ['--host',pins.dockerHost,'image','inspect',image.ref,'--format','{{.Id}}'], input.deadline), image.id)
  }
  const script = "const f=require('node:fs');try{const d=f.openSync(process.argv[1],f.constants.O_WRONLY);f.closeSync(d);process.exit(7)}catch(e){process.exit(e.code==='EPERM'||e.code==='EACCES'?0:8)}"
  await control.probe(pins.sandbox, ['-p',input.profile,pins.node.path,'-e',script,input.dependencyProbeFile], input.deadline)
  await contextualTestPortsAvailable()
}

export type ContextualTestExecutionSeal = Readonly<{
  manifestSha256: string
  requiredImages: readonly { ref: string; id: string }[]
  versions: Readonly<{ node: string; supabase: string; playwright: '1.58.0' }>
  capacity: Readonly<{ checkedAt: number; availableBytes: number; status: 'healthy'; pressure: 'healthy' }>
}>
/** Digest for a separately reviewed fresh admission, never a claimed signature
 * or permission grant. The coordinator must verify the actual review receipts
 * before accepting this digest; source checks alone cannot grant admission. */
export function contextualTestExecutionDigest(admission: ContextualTestControllerAdmission, pins: ContextualTestNativePins,
  seal: Omit<ContextualTestExecutionSeal, 'manifestSha256'>) {
  return sha(Buffer.from(JSON.stringify({ version: 1, projectId: admission.projectId, nonce: admission.nonce,
    startedAt: admission.startedAt, deadline: admission.deadline, cleanupDeadline: admission.cleanupDeadline,
    frozen: admission.frozen, runner: admission.runner, dependencies: admission.dependencies,
    transportPins: admission.transportPins, nativePins: pins,
    migrationChainSha256: admission.migrationChainSha256, requiredImages: seal.requiredImages, versions: seal.versions, capacity: seal.capacity })))
}

/** Thin native implementation of the controller's explicit interfaces. No
 * module entrypoint, allocation, auto-admission or retry. Construct only after
 * independent source review; call the controller once with a fresh sealed plan. */
export function createContextualTestExecutionControls(admission: ContextualTestControllerAdmission,
  pins: ContextualTestNativePins, seal: ContextualTestExecutionSeal): ContextualTestControllerControls {
  admission = immutableContextualTestData(admission); pins = immutableContextualTestData(pins); seal = immutableContextualTestData(seal)
  const native = createContextualTestNativeControls(pins, admission.cleanupDeadline)
  const command = createContextualTestPinnedCommand(admission.transportPins, admission, { settle: native.settleCommand })
  let admitted = false, executionEnd = admission.cleanupDeadline
  const unchanged = async () => {
    verifyContextualTestTransportPins(admission.transportPins)
    for (const pin of Object.values(pins).filter((value): value is ContextualTestBinaryPin => typeof value === 'object')) verifyContextualTestBinary(pin)
    for (const source of [admission.frozen, admission.runner]) {
      const actual = await captureContextualTestSource(source.repository, source.head, source.tree, command.run, executionEnd)
      assert.deepEqual(actual, source)
    }
    assert.equal(captureContextualTestDependencies(admission.dependencies.root, executionEnd).sha256, admission.dependencies.sha256)
  }
  return Object.freeze({ now: Date.now, command, sqlControl: Object.freeze({ nativePins: pins, transportPins: admission.transportPins }),
    async assertReady(value) {
      assert(!admitted); assert.deepEqual(value, admission)
      assert.equal(contextualTestExecutionDigest(admission, pins, seal), seal.manifestSha256)
      assert.equal(admission.review.manifestSha256, seal.manifestSha256)
      assert.deepEqual(pins.docker, admission.transportPins.docker); assert.equal(pins.dockerHost, admission.transportPins.dockerHost)
      assert.equal(pins.outputDir, admission.outputDir); assert.equal(realpathSync(process.execPath), pins.node.path)
      assert(seal.capacity.status === 'healthy' && seal.capacity.pressure === 'healthy' && seal.capacity.availableBytes >= 10_000_000_000
        && seal.capacity.checkedAt <= Date.now() && Date.now() - seal.capacity.checkedAt <= 1800000)
      assert.equal(await native.probe(pins.node, ['--version'], admission.deadline), seal.versions.node)
      assert.equal(await command.run('supabase', ['--version']), seal.versions.supabase)
      assert.equal(JSON.parse(readFileSync(join(admission.dependencies.root, '@playwright/test/package.json'), 'utf8')).version, seal.versions.playwright)
      const profile = contextualTestReadOnlyDependencyProfile(admission.dependencies.roots)
      await unchanged()
      await verifyContextualTestNativeReadiness(pins, { deadline: admission.deadline, profile, requiredImages: seal.requiredImages,
        dependencyProbeFile: realpathSync(join(admission.dependencies.root, 'next/package.json')) }, native)
      command.assertClosed(); native.assertClosed(); admitted = true
    },
    async assertUnchanged() { assert(admitted); await unchanged(); command.assertClosed(); native.assertClosed() },
    async launchApp(input) {
      assert(admitted && input.binding.projectId === admission.projectId && input.cwd === admission.appDir)
      return native.spawnOwned({ args: input.args, cwd: input.cwd, env: input.env, role: 'app', profile: input.dependencySandboxProfile, deadline: admission.deadline })
    },
    async launchPlaywright(input) {
      assert(admitted && input.binding.projectId === admission.projectId && input.cwd === admission.runner.repository)
      assert.equal(input.binding.outputDir, admission.outputDir)
      assertContextualTestUnusedRunnerOutput(admission.outputDir)
      const child = await native.spawnOwned({ args: input.args, cwd: input.cwd, env: input.env, role: 'browser', profile: input.dependencySandboxProfile, deadline: admission.deadline })
      return { async wait() { await child.wait(); const state = child.state(); return { closed: state.closed, code: state.code, signal: null } } }
    },
    async settleAll(end) {
      executionEnd = Math.min(executionEnd, end); command.beginCleanup(executionEnd)
      const results = await Promise.allSettled([native.settleAll(executionEnd), command.joinSettlements()])
      const failures: Error[] = []
      const failed = (stage: 'owned-families' | 'command-settlements' | 'command-closure' | 'native-closure') =>
        failures.push(Object.assign(fixedError(), { cleanupStage: stage }))
      if (results[0].status === 'rejected') failed('owned-families')
      if (results[1].status === 'rejected') failed('command-settlements')
      try { command.assertClosed() } catch { failed('command-closure') }
      try { native.assertClosed() } catch { failed('native-closure') }
      if (failures.length) throw new AggregateError(failures, 'Private contextual Test execution cleanup failed')
    },
  })
}
