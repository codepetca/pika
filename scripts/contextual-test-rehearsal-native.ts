/** Explicit-call native edges for the existing disposable Playwright carrier.
 * Importing this module cannot inspect a process, launch a child or signal one.
 */
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { isProxy } from 'node:util/types'
import { assertContextualTestUnusedRunnerOutput, captureContextualTestDependencies, captureContextualTestSource, contextualTestReadOnlyDependencyProfile, createContextualTestOwnedFamily,
  createContextualTestPinnedCommand, immutableContextualTestData, verifyContextualTestTransportPins, verifyContextualTestBinary, type ContextualTestBinaryPin } from './contextual-test-rehearsal-launch'
import { contextualTestIdentityMismatch, parseKernelProcessRows, type ContextualTestIdentityMismatch, type OwnedProcessRow } from './contextual-test-process-ownership'
import { createContextualTestRouteReadiness } from './contextual-test-route-readiness'
import type { ContextualTestControllerAdmission, ContextualTestControllerControls } from './contextual-test-rehearsal-controller'
import { contextualTestFontOverlaySha256 } from '../e2e/helpers/contextual-test-font-overlay'

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
type NativeDiagnosticRole = 'app' | 'browser' | 'command' | 'probe' | 'unknown'
type NativeDiagnosticPhase = 'birth' | 'monitor' | 'ready' | 'wait' | 'settle' | 'aggregate' | 'probe'
type NativeDiagnosticCause = 'snapshot-schema' | 'kernel-unverified' | 'identity-mismatch' | 'unverified-group' | 'closure-deadline' |
  'probe-deadline' | 'probe-exit' | 'probe-overflow' | 'signal-error' | 'output-overflow' | 'child-error' |
  'prior-uncertainty' | 'active-probes' | 'children-remain' | 'route-readiness' | 'route-closure' | 'unknown'
type NativeDiagnosticRow = Readonly<{ role: NativeDiagnosticRole; phase: NativeDiagnosticPhase; cause: NativeDiagnosticCause; closed: boolean; uncertain: boolean; identityMismatch: ContextualTestIdentityMismatch | null }>
export type ContextualTestNativeDiagnostics = Readonly<{ firstFailure: NativeDiagnosticRow | null; failures: readonly NativeDiagnosticRow[];
  overflow: boolean; activeProbes: number; unsettledFamilies: number }>
/** No inherited properties, accessors, proxy traps or private exception text. */
function nativeProcessCause(error: unknown): NativeDiagnosticCause {
  try {
    if (!error || typeof error !== 'object' || isProxy(error)) return 'unknown'
    const descriptor = Object.getOwnPropertyDescriptor(error, 'processCause')
    const cause: unknown = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined
    return cause === 'snapshot-schema' || cause === 'kernel-unverified' || cause === 'identity-mismatch' ||
      cause === 'unverified-group' || cause === 'closure-deadline' ? cause : 'unknown'
  } catch { return 'unknown' }
}

/** Short fixed read-only probes. An unjoined helper poisons the controller; it
 * is never called closed or killed using a guessed PID. Long-lived owned app
 * and browser children use the separately verified family controller below. */
export function createContextualTestNativeControls(pins: ContextualTestNativePins, cleanupDeadline: number) {
  assert.equal(process.platform, 'darwin')
  const env: NodeJS.ProcessEnv = { PATH: '/usr/bin:/bin', HOME: pins.outputDir, LANG: 'C', LC_ALL: 'C', NODE_ENV: 'development' }
  let poisoned = false, cleaning = false, activeProbes = 0, controllerEnd = cleanupDeadline
  const children = new Set<ContextualTestOwnedChild>()
  const routeReadiness = createContextualTestRouteReadiness()
  const failures: NativeDiagnosticRow[] = []
  let firstFailure: NativeDiagnosticRow | null = null, overflow = false
  const record = (role: NativeDiagnosticRole, phase: NativeDiagnosticPhase, cause: NativeDiagnosticCause, closed = false, uncertain = false, error?: unknown) => {
    // Diagnostics never participate in admission, poison or closure decisions.
    try {
      const row = Object.freeze({ role: role === 'app' || role === 'browser' || role === 'command' || role === 'probe' ? role : 'unknown',
        phase, cause, closed, uncertain, identityMismatch: cause === 'identity-mismatch' ? contextualTestIdentityMismatch(error) : null })
      if (phase !== 'aggregate') firstFailure ??= row
      if (failures.length < 16) failures.push(row); else overflow = true
    } catch { /* Reporting must not interrupt cleanup. */ }
  }
  const diagnostics = (): ContextualTestNativeDiagnostics => Object.freeze({ firstFailure: firstFailure && Object.freeze({ ...firstFailure }),
    failures: Object.freeze(failures.map(row => Object.freeze({ ...row }))), overflow, activeProbes, unsettledFamilies: children.size })
  const checkCleanup = () => assert(Date.now() < controllerEnd, 'Private native cleanup expired')
  const check = () => { assert(!poisoned && !cleaning, 'Private native controller closed'); checkCleanup() }
  // Failure permanently rejects new work. Only private observation for an
  // already captured family may continue, under the original shortened clock.
  const probeWithAdmission = async (admit: () => void, pin: ContextualTestBinaryPin, args: readonly string[], end: number, input?: string): Promise<string> => {
    try {
      admit(); verifyContextualTestBinary(pin)
      end = Math.min(end, controllerEnd)
      assert(end > Date.now() && end <= cleanupDeadline && args.every(v => !v.includes('\0')))
    } catch (error) { record('probe', 'probe', nativeProcessCause(error)); throw error }
    return new Promise((resolve, reject) => {
      let child: ChildProcess
      try { child = spawn(pin.path, [...args], { shell: false, env, cwd: pins.outputDir, stdio: ['pipe','pipe','pipe'] }) }
      catch (error) { record('probe', 'probe', nativeProcessCause(error)); throw error }
      activeProbes++
      let count = 0, failed = false, output = ''
      const timer = setTimeout(() => { poisoned = true; record('probe', 'probe', 'probe-deadline'); reject(fixedError()) }, Math.min(30000, end - Date.now()))
      child.on('error', () => { failed = true; record('probe', 'probe', 'child-error') })
      child.stdin!.on('error', () => { failed = true; record('probe', 'probe', 'child-error') })
      child.stdout!.on('data', (bytes: Buffer) => { count += bytes.length; if (count > 16 * 1024 ** 2) { failed = true; poisoned = true; record('probe', 'probe', 'probe-overflow') } else output += bytes.toString('utf8') })
      child.stderr!.on('data', (bytes: Buffer) => { count += bytes.length; if (count > 16 * 1024 ** 2) { failed = true; poisoned = true; record('probe', 'probe', 'probe-overflow') } })
      child.once('close', (code, signal) => {
        clearTimeout(timer); activeProbes--
        try { admit(); verifyContextualTestBinary(pin); assert(!failed && code === 0 && signal === null && Date.now() < end); resolve(output.trim()) }
        catch (error) { record('probe', 'probe', code !== 0 || signal !== null ? 'probe-exit' : Date.now() >= end ? 'probe-deadline' : nativeProcessCause(error), true); reject(fixedError()) }
      })
      child.stdin!.end(input)
    })
  }
  const probe = (pin: ContextualTestBinaryPin, args: readonly string[], end: number, input?: string) => probeWithAdmission(check, pin, args, end, input)
  const observeRows = async (admit: () => void, deadline = controllerEnd): Promise<OwnedProcessRow[]> => {
    admit(); const end = Math.min(deadline, controllerEnd, Date.now() + 30000)
    verifyContextualTestBinary(pins.helper)
    assert.equal(pins.helper.sha256, '4b5d355992525ce7eeca1d03e7a1170a63bf71a3c6be82f3d8d43c79c5a3c53b')
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
      assert(root.state === 'starting' || root.executable === executable || root.executable === pins.sandbox.path, 'Private owned executable drift')
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
        assert(fresh && fresh.started === root.started && fresh.executable === root.executable && fresh.pgid === root.pgid
          && fresh.uniqueId === root.uniqueId && fresh.imageUuid === root.imageUuid && fresh.pidVersion === root.pidVersion)
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
    let child: ChildProcess
    try {
      child = spawn(pins.sandbox.path, ['-p', input.profile, pins.node.path, ...input.args], {
        cwd: input.cwd, env: { ...input.env, NODE_ENV: 'development' }, detached: true, shell: false, stdio: ['ignore','pipe','pipe'],
      })
    } catch (error) { record(input.role, 'birth', nativeProcessCause(error)); throw error }
    let closed = false, code: number | null = null, uncertain = false, count = 0, readyText = '', born = false
    let announceReady!: () => void
    const readyPromise = new Promise<void>(resolve => { announceReady = resolve })
    // Never retain raw Next/Playwright output; fixed private receipts are used.
    child.stdout!.on('data', (bytes: Buffer) => {
      count += bytes.length; if (count > 64 * 1024 ** 2) { uncertain = true; record(input.role, 'monitor', 'output-overflow', closed, uncertain) }
      if (input.role === 'app') {
        readyText = (readyText + bytes.toString('utf8').replace(/\x1b\[[0-9;]*m/g, '')).slice(-4096)
        if (/Ready in \d/.test(readyText)) { announceReady(); readyText = '' }
      }
    })
    child.stderr!.on('data', (bytes: Buffer) => { count += bytes.length; if (count > 64 * 1024 ** 2) { uncertain = true; record(input.role, 'monitor', 'output-overflow', closed, uncertain) } })
    const closedPromise = new Promise<void>(resolve => { child.once('close', value => { closed = true; code = value; resolve() }) })
    child.once('error', () => { uncertain = true; record(input.role, born ? 'monitor' : 'birth', 'child-error', closed, uncertain) })
    let family: OwnedFamily
    try { family = await birth(child, input.role, pins.node.path, input.cwd, input.args, Math.min(input.deadline, Date.now() + 30000)) }
    catch (error) { record(input.role, 'birth', nativeProcessCause(error), closed, uncertain, error); poisoned = true; throw fixedError() }
    born = true
    let monitor: Promise<void> = Promise.resolve(), stopping = false
    const tick = setInterval(() => {
      monitor = monitor.then(async () => { if (!stopping) await family.observe(checkCleanup, ownedRows) }).catch(error => {
        uncertain = true; poisoned = true; record(input.role, 'monitor', nativeProcessCause(error), closed, uncertain, error)
      })
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
          const ownedListener = async () => {
            const admitReady = () => { check(); assert(!closed && !uncertain && Date.now() < end) }
            admitReady()
            const listeners = await probe(pins.lsof, ['-nP','-iTCP:3117','-sTCP:LISTEN','-Fp'], end)
            let observed = await family.observe(admitReady, () => observeRows(admitReady, end))
            while (observed.snapshot.pending?.length) {
              // No reset or extra lease: pending work shares the original ready end.
              admitReady(); await new Promise(resolve => setTimeout(resolve, Math.min(25, end - Date.now())))
              observed = await family.observe(admitReady, () => observeRows(admitReady, end))
            }
            const { rows: current, snapshot } = observed
            const pids = listeners.split('\n').filter(line => /^p\d+$/.test(line)).map(line => Number(line.slice(1)))
            assert(pids.length > 0 && pids.every(pid => [snapshot.identity,...snapshot.descendants].some(owner => owner.pid === pid)
              && current.some(row => row.pid === pid && row.state === 'alive')))
            admitReady()
          }
          await ownedListener()
          // Listening is not readiness for a cold demand-compiled route. The
          // controller reserves this one GET in the existing app budget first.
          try { await routeReadiness.run(end) }
          catch (error) { record('app', 'ready', 'route-readiness', closed, uncertain); throw error }
          assert(!closed && !uncertain && Date.now() < end)
          await ownedListener()
        } catch (error) { record(input.role, 'ready', nativeProcessCause(error), closed, uncertain, error); throw error }
        finally { if (timeout) clearTimeout(timeout); readyText = '' }
      },
      async wait() {
        const timer = setTimeout(() => { uncertain = true; record(input.role, 'wait', 'closure-deadline', closed, uncertain) }, Math.max(0, input.deadline - Date.now()))
        try {
          await Promise.race([closedPromise, new Promise<never>((_, reject) => {
            const handle = setTimeout(() => reject(fixedError()), Math.max(0, input.deadline - Date.now())); handle.unref()
            void closedPromise.then(() => clearTimeout(handle))
          })])
          await monitor
          assert(closed && code === 0 && !uncertain && Date.now() < input.deadline)
          const admitWait = () => { check(); assert(!uncertain && Date.now() < input.deadline) }
          try {
            const current = await family.observe(admitWait, () => observeRows(admitWait, input.deadline))
            assert(!current.snapshot.pending?.length && Date.now() < input.deadline)
          } catch (error) { uncertain = true; poisoned = true; throw error }
        } catch (error) { record(input.role, 'wait', uncertain ? 'prior-uncertainty' : nativeProcessCause(error), closed, uncertain, error); throw error }
        finally { clearTimeout(timer) }
      },
      async settle(end) {
        stopping = true; clearInterval(tick)
        try {
          assert(end <= cleanupDeadline); end = Math.min(end, controllerEnd); assert(end > Date.now()); await monitor
          const admit = () => { checkCleanup(); assert(Date.now() < end) }
          const settlementRows = () => observeRows(admit, end)
          await family.settle(input.role === 'app' ? 'group' : 'pid', {
            rows: settlementRows, now: Date.now, admit,
            signal: (pid, signal) => { try { process.kill(pid, signal) } catch (error) { record(input.role, 'settle', 'signal-error', closed, uncertain); throw error } }, closed: () => closed, end,
          })
          const final = await family.observe(admit, settlementRows)
          assert(closed && !final.snapshot.pending?.length && family.absent(final.rows)); admit(); children.delete(result)
          assert(!uncertain, 'Private native ownership observation failed')
        } catch (error) { const cause = nativeProcessCause(error); record(input.role, 'settle', cause !== 'unknown' ? cause : uncertain ? 'prior-uncertainty' : 'unknown', closed, uncertain, error); poisoned = true; throw fixedError() }
      },
      state: () => ({ closed, code, uncertain, family: family.snapshot() }),
    })
    children.add(result); return result
  }
  return Object.freeze({ probe, rows, spawnOwned, diagnostics,
    async settleAll(end: number) {
      assert(end <= cleanupDeadline && end <= Date.now() + 360000); controllerEnd = Math.min(controllerEnd, end); cleaning = true
      // Start every verified family before awaiting any failure or slow close.
      // Each retains its own fresh kernel/group checks and the same deadline.
      const results = await Promise.allSettled([
        ...[...children].reverse().map(child => child.settle(controllerEnd)),
        routeReadiness.settle(controllerEnd).catch(error => { record('app', 'settle', 'route-closure'); throw error }),
      ])
      const failures = results.filter(result => result.status === 'rejected').map(() => fixedError())
      if (activeProbes !== 0) record('unknown', 'aggregate', 'active-probes')
      if (children.size !== 0) record('unknown', 'aggregate', 'children-remain')
      if (poisoned) record('unknown', 'aggregate', 'prior-uncertainty', false, true)
      if (poisoned || children.size !== 0 || activeProbes !== 0) failures.push(fixedError())
      if (failures.length) { poisoned = true; throw new AggregateError(failures, 'Private contextual Test native cleanup failed') }
    },
    async settleCommand(child: ChildProcess, end: number) {
      let closed = false
      try {
        assert(end <= cleanupDeadline); end = Math.min(end, controllerEnd)
        const admit = () => { checkCleanup(); assert(Date.now() < end) }
        // Authorized transport children may need ownership capture during
        // cleanup, but native poison never grants a new capture.
        const captureAdmission = () => { admit(); assert(!poisoned) }
        captureAdmission(); assert(child.pid && child.spawnfile)
        child.once('close', () => { closed = true })
        const current = await observeRows(captureAdmission, end), root = current.find(row => row.pid === child.pid)
        assert(root, 'Failed command ownership unconfirmed')
        assert.equal(root.executable, realpathSync(child.spawnfile))
        const actualArgv = await probeWithAdmission(captureAdmission, pins.ps, ['-ww','-p',String(child.pid),'-o','command='], end)
        const actualCwd = await probeWithAdmission(captureAdmission, pins.lsof, ['-a','-p',String(child.pid),'-d','cwd','-Fn'], end)
        assert.equal(actualArgv, child.spawnargs.join(' '))
        assert.equal(actualCwd.split('\n').filter(line => line.startsWith('n')).join('\n'), `n${pins.outputDir}`)
        captureAdmission()
        const family = createContextualTestOwnedFamily({ pid: root.pid, pgid: root.pgid, executable: root.executable, cwd: pins.outputDir,
          argv: child.spawnargs, expectedArgv: child.spawnargs, expectedCwd: pins.outputDir, role: 'browser', rows: current })
        // Only this captured family survives later poison/cleanup admission.
        await family.settle('pid', { rows: () => observeRows(admit, end), now: Date.now, admit,
          signal: (pid, signal) => { try { process.kill(pid, signal) } catch (error) { record('command', 'settle', 'signal-error', closed); throw error } }, closed: () => closed, end })
        admit(); assert(closed)
      } catch (error) { record('command', 'settle', nativeProcessCause(error), closed, false, error); poisoned = true; throw fixedError() }
    },
    assertClosed() {
      try { routeReadiness.assertClosed() }
      catch (error) { record('app', 'settle', 'route-closure'); throw error }
      assert(!poisoned && children.size === 0 && activeProbes === 0)
    },
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
  assert.equal(pins.chrome.sha256, '63ee57066ef61169445ded279701d974ad23c805a60b8f77a4b8776183ac58fb')
  assert.equal(sha(readFileSync(pins.helper.path)), '4b5d355992525ce7eeca1d03e7a1170a63bf71a3c6be82f3d8d43c79c5a3c53b')
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
    migrationChainSha256: admission.migrationChainSha256, appOverlaySha256: contextualTestFontOverlaySha256,
    requiredImages: seal.requiredImages, versions: seal.versions, capacity: seal.capacity })))
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
  return Object.freeze({ now: Date.now, command, nativeDiagnostics: native.diagnostics, sqlControl: Object.freeze({ nativePins: pins, transportPins: admission.transportPins }),
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
      executionEnd = Math.min(executionEnd, end)
      const failures: Error[] = []
      const failed = (stage: 'command-entry' | 'owned-families' | 'command-settlements' | 'command-closure' | 'native-closure') =>
        failures.push(Object.assign(fixedError(), { cleanupStage: stage }))
      try { command.beginCleanup(executionEnd) } catch { failed('command-entry') }
      const results = await Promise.allSettled([Promise.resolve().then(() => native.settleAll(executionEnd)), Promise.resolve().then(() => command.joinSettlements())])
      if (results[0].status === 'rejected') failed('owned-families')
      if (results[1].status === 'rejected') failed('command-settlements')
      try { command.assertClosed() } catch { failed('command-closure') }
      try { native.assertClosed() } catch { failed('native-closure') }
      if (failures.length) throw new AggregateError(failures, 'Private contextual Test execution cleanup failed')
    },
  })
}
