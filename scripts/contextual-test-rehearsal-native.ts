/** Explicit-call native edges for the existing disposable Playwright carrier.
 * Importing this module cannot inspect a process, launch a child or signal one.
 */
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { captureContextualTestDependencies, captureContextualTestSource, contextualTestReadOnlyDependencyProfile, createContextualTestOwnedFamily,
  createContextualTestPinnedCommand, verifyContextualTestTransportPins, verifyContextualTestBinary, type ContextualTestBinaryPin } from './contextual-test-rehearsal-launch'
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
  let poisoned = false, activeProbes = 0
  const children = new Set<ContextualTestOwnedChild>()
  const check = () => assert(!poisoned && Date.now() < cleanupDeadline, 'Private native controller closed')
  const probe = async (pin: ContextualTestBinaryPin, args: readonly string[], end: number, input?: string): Promise<string> => {
    check(); verifyContextualTestBinary(pin)
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
        try { check(); verifyContextualTestBinary(pin); assert(!failed && code === 0 && signal === null && Date.now() < end); resolve(output.trim()) }
        catch { reject(fixedError()) }
      })
      child.stdin.end(input)
    })
  }
  const rows = async (): Promise<OwnedProcessRow[]> => {
    check(); const end = Math.min(cleanupDeadline, Date.now() + 30000)
    verifyContextualTestBinary(pins.helper)
    assert.equal(pins.helper.sha256, '476c8c4696b8252debabb3ff7c5249deea10349cc91526ebc6eca924ef47f807')
    const text = await probe(pins.ps, ['-axo','pid=,ppid=,pgid='], end)
    const input = text.split('\n').map(line => {
      const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(line); assert(match)
      return match.slice(1).map(Number)
    }).filter(([pid]) => pid > 1)
    assert(input.length <= 20000)
    return parseKernelProcessRows(await probe(pins.python, ['-I','-B', pins.helper.path], end, JSON.stringify(input)))
  }
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
      cwd: input.cwd, env: { ...input.env }, detached: true, shell: false, stdio: ['ignore','pipe','pipe'],
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
      monitor = monitor.then(async () => { if (!stopping) family.refresh(await rows()) }).catch(() => { uncertain = true })
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
        assert(end <= cleanupDeadline && end > Date.now()); stopping = true; clearInterval(tick); await monitor
        await family.settle(input.role === 'app' ? 'group' : 'pid', {
          rows, now: Date.now, admit: () => assert(Date.now() < end && !poisoned),
          signal: (pid, signal) => { process.kill(pid, signal) }, closed: () => closed, end,
        })
        assert(closed && family.absent(await rows())); children.delete(result)
        assert(!uncertain, 'Private native ownership observation failed')
      },
      state: () => ({ closed, code, uncertain, family: family.snapshot() }),
    })
    children.add(result); return result
  }
  return Object.freeze({ probe, rows, spawnOwned,
    async settleAll(end: number) { for (const child of [...children].reverse()) await child.settle(end); assert(!poisoned && children.size === 0 && activeProbes === 0) },
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
  const native = createContextualTestNativeControls(pins, admission.cleanupDeadline)
  const command = createContextualTestPinnedCommand(admission.transportPins, admission, { settle: native.settleCommand })
  let admitted = false
  const unchanged = async () => {
    verifyContextualTestTransportPins(admission.transportPins)
    for (const pin of Object.values(pins).filter((value): value is ContextualTestBinaryPin => typeof value === 'object')) verifyContextualTestBinary(pin)
    for (const source of [admission.frozen, admission.runner]) {
      const actual = await captureContextualTestSource(source.repository, source.head, source.tree, command.run, admission.cleanupDeadline)
      assert.deepEqual(actual, source)
    }
    assert.equal(captureContextualTestDependencies(admission.dependencies.root, admission.cleanupDeadline).sha256, admission.dependencies.sha256)
  }
  return Object.freeze({ now: Date.now, command,
    async assertReady(value) {
      assert(!admitted && value === admission)
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
      const child = await native.spawnOwned({ args: input.args, cwd: input.cwd, env: input.env, role: 'browser', profile: input.dependencySandboxProfile, deadline: admission.deadline })
      return { async wait() { await child.wait(); const state = child.state(); return { closed: state.closed, code: state.code, signal: null } } }
    },
    async settleAll(end) { await native.settleAll(end); await command.joinSettlements(); command.assertClosed(); native.assertClosed() },
  })
}
