/** Import-safe coordinator source for the separately reviewed disposable Tests
 * rehearsal. No top-level CLI, environment read, preparation or native dispatch.
 * This is a new carrier, not a reconstruction or reuse of a spent private run.
 */
import assert from 'node:assert/strict'
import { dirname, isAbsolute, join, normalize } from 'node:path'
import { createHash } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, readlinkSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { createContextualTestPlan } from '../e2e/helpers/contextual-test-rehearsal'
import type { ContextualTestRunBinding } from './contextual-test-rehearsal-platform'
import { assignmentListProofWorkdir } from './contextual-assignment-list-proof-path'
import { createFamilyOperationGate, reconcileOwnedFamily, ownedFamilyAbsent, requireLiveKernelRoot, settleOwnedFamily, type Capture, type OwnedProcessRow } from './contextual-test-process-ownership'

const hex = /^[a-f0-9]{64}$/
/** Snapshot admitted JSON-shaped data, not the caller's mutable object graph. */
export function immutableContextualTestData<T>(value: T): T {
  const snapshot = structuredClone(value)
  const freeze = (node: unknown): void => {
    if (!node || typeof node !== 'object' || Object.isFrozen(node)) return
    for (const child of Object.values(node)) freeze(child)
    Object.freeze(node)
  }
  freeze(snapshot); return snapshot
}
function absolute(value: string) {
  assert(isAbsolute(value) && normalize(value) === value && !/[\x00-\x20\x7f]/.test(value), 'Private launch path rejected')
  return value
}
export type ContextualTestDemoStatus = Readonly<{ API_URL: string; ANON_KEY: string; SERVICE_ROLE_KEY: string; DB_URL: string }>
/** Only exact isolated demo status. No canonical environment or key derivation. */
export function validateContextualTestDemoStatus(value: unknown, projectId: string): ContextualTestDemoStatus {
  createContextualTestPlan(projectId)
  assert(value && typeof value === 'object' && !Array.isArray(value))
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const read = (key: string) => { const field = descriptors[key]; assert(field && 'value' in field && typeof field.value === 'string'); return field.value as string }
  const API_URL = read('API_URL'), ANON_KEY = read('ANON_KEY'), SERVICE_ROLE_KEY = read('SERVICE_ROLE_KEY'), DB_URL = read('DB_URL')
  assert.equal(API_URL, 'http://127.0.0.1:54331')
  const db = new URL(DB_URL)
  assert(['postgres:', 'postgresql:'].includes(db.protocol) && db.hostname === '127.0.0.1' && db.port === '54332' && db.pathname === '/postgres' && db.username === 'postgres' && !db.search && !db.hash)
  for (const [token, role] of [[ANON_KEY, 'anon'], [SERVICE_ROLE_KEY, 'service_role']]) {
    assert(token.length >= 20 && token.length <= 4096 && !/[\x00-\x20\x7f]/.test(token))
    const parts = token.split('.'); assert(parts.length === 3 && parts.every(Boolean))
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    assert.equal(claims.iss, 'supabase-demo'); assert.equal(claims.role, role)
  }
  return Object.freeze({ API_URL, ANON_KEY, SERVICE_ROLE_KEY, DB_URL })
}
function bindingFile(binding: ContextualTestRunBinding, file: string, sha256: string) {
  absolute(file); assert.equal(dirname(file), binding.outputDir); assert(hex.test(sha256))
  assert.equal(binding.workdir, assignmentListProofWorkdir(binding.projectId)); assert.equal(binding.appDir, join(binding.workdir, 'app'))
  assert(binding.outputDir !== binding.workdir && !binding.outputDir.startsWith(`${binding.workdir}/`))
}
const basicEnvironment = () => ({ PATH: '/usr/bin:/bin', TZ: 'America/Toronto', LANG: 'C', LC_ALL: 'C', NEXT_TELEMETRY_DISABLED: '1' })
export function contextualTestAppEnvironment(binding: ContextualTestRunBinding, rawStatus: unknown, sessionSecret: string,
  preloadPath: string, file: string, sha256: string): Readonly<Record<string, string>> {
  bindingFile(binding, file, sha256); absolute(preloadPath)
  assert(sessionSecret.length >= 48 && sessionSecret.length <= 128 && !/[\x00-\x20\x7f]/.test(sessionSecret))
  const status = validateContextualTestDemoStatus(rawStatus, binding.projectId), plan = createContextualTestPlan(binding.projectId)
  const env: Record<string, string> = { ...basicEnvironment(), NODE_ENV: 'development', NEXT_DISABLE_MEM_OVERRIDE: '1',
    VERCEL_GIT_COMMIT_SHA: binding.sourceSha,
    HOME: binding.outputDir, TMPDIR: join(binding.workdir, 'tmp'),
    NEXT_PUBLIC_SUPABASE_URL: status.API_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY,
    SUPABASE_SECRET_KEY: status.SERVICE_ROLE_KEY, SESSION_SECRET: sessionSecret,
    PIKA_CLASSROOM_EXPERIENCE_ADMISSION: JSON.stringify(plan.admission), PIKA_CLASSROOM_PAGE_ACCESS_ENABLED: 'true',
    PIKA_CLASSROOM_PAGE_ACCESS_PAIRS: JSON.stringify(plan.pageAccessPairs), ENABLE_MOCK_EMAIL: 'true',
    NODE_OPTIONS: `--require=${preloadPath}`, PIKA_CONTEXTUAL_TEST_BINDING_FILE: file, PIKA_CONTEXTUAL_TEST_BINDING_SHA256: sha256,
  }
  for (const gate of ['PIKA_CLASSROOM_HOME_ACCESS_ENABLED','PIKA_E2E_FIXTURES','WORKOS_MAGIC_AUTH_PILOT','PAL_ENABLED','PIKA_BARA_ATTENDANCE_ENABLED','STUDENT_PROVIDER_CLEANUP_ENABLED']) env[gate] = 'false'
  return Object.freeze(env)
}
export function contextualTestRunnerEnvironment(binding: ContextualTestRunBinding, file: string, sha256: string): Readonly<Record<string, string>> {
  bindingFile(binding, file, sha256)
  return Object.freeze({ ...basicEnvironment(), NODE_ENV: 'development', HOME: binding.outputDir, TMPDIR: join(binding.workdir, 'tmp'),
    PIKA_CONTEXTUAL_TEST_REHEARSAL: 'true', PIKA_CONTEXTUAL_TEST_BINDING_FILE: file, PIKA_CONTEXTUAL_TEST_BINDING_SHA256: sha256 })
}
export function contextualTestLaunchCommands(runnerRoot: string, dependencyRoot: string, binding: ContextualTestRunBinding) {
  absolute(runnerRoot); absolute(dependencyRoot)
  assert.equal(binding.appDir, join(assignmentListProofWorkdir(binding.projectId), 'app'))
  return Object.freeze({ app: Object.freeze([join(dependencyRoot, 'next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', '3117']),
    runner: Object.freeze([join(dependencyRoot, '@playwright/test/cli.js'), 'test', `--config=${join(runnerRoot, 'playwright.contextual-tests.config.ts')}`, 'contextual-test-lifecycle.spec.ts']) })
}

export type ContextualTestBinaryPin = Readonly<{ path: string; sha256: string }>
export type ContextualTestTransportPins = Readonly<{ git: ContextualTestBinaryPin; docker: ContextualTestBinaryPin; supabase: ContextualTestBinaryPin;
  dockerHost: string; socketIdentity: readonly [number, number, number, number]; outputDir: string }>
export type ContextualTestLaunchBudget = Readonly<{ startedAt: number; deadline: number; cleanupDeadline: number }>
const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex')
export function verifyContextualTestBinary(pin: ContextualTestBinaryPin): void {
  assert(hex.test(pin.sha256))
  // Installed Chrome's approved path contains spaces; executable arguments are
  // passed as an array, never through NODE_OPTIONS or a shell command string.
  assert(isAbsolute(pin.path) && normalize(pin.path) === pin.path && !/[\x00-\x1f\x7f]/.test(pin.path))
  assert.equal(realpathSync(pin.path), pin.path)
  const before = lstatSync(pin.path)
  assert(before.isFile() && !before.isSymbolicLink() && (before.mode & 0o022) === 0)
  const fd = openSync(pin.path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const actual = fstatSync(fd); assert.equal(actual.dev, before.dev); assert.equal(actual.ino, before.ino)
    assert(actual.isFile() && (actual.mode & 0o022) === 0 && actual.size > 0)
    assert.equal(sha(readFileSync(fd)), pin.sha256)
    const after = fstatSync(fd); assert.equal(after.size, actual.size); assert.equal(after.mtimeMs, actual.mtimeMs); assert.equal(after.ctimeMs, actual.ctimeMs)
  } finally { closeSync(fd) }
}
export function verifyContextualTestTransportPins(pins: ContextualTestTransportPins): void {
  for (const pin of [pins.git, pins.docker, pins.supabase]) verifyContextualTestBinary(pin)
  assert(pins.dockerHost.startsWith('unix:///') && !/[\x00-\x20\x7f%?#]/.test(pins.dockerHost))
  const path = pins.dockerHost.slice(7); absolute(path); assert.equal(realpathSync(path), path)
  const socket = statSync(path); assert(socket.isSocket())
  assert.deepEqual([socket.dev, socket.ino, socket.mode, socket.rdev], pins.socketIdentity)
  absolute(pins.outputDir)
}

type CommandOptions = { input?: string; timeout?: number; maxBytes?: number; startupProjectId?: string; env?: NodeJS.ProcessEnv; survey?: unknown }
type NativeCommandChild = ChildProcessWithoutNullStreams
export type ContextualTestCommandSeams = {
  /** Mandatory root-owned identity/family controller. This callback must never
   * signal an unverified PID; its return alone is not positive child close. */
  settle(child: NativeCommandChild, originalCloseDeadline: number): Promise<void>
  verify?: (pins: ContextualTestTransportPins) => void
  spawn?: (file: string, args: string[], options: Parameters<typeof spawn>[2]) => NativeCommandChild
  now?: () => number
}
/** Pinned transport for the existing disposable adapter. No PATH fallback,
 * inherited env, shell, hidden retry or timeout/error-as-closure credit.
 * Deliberately requires the owning process controller; there is no unsafe
 * default kill implementation and no executable launcher entrypoint below. */
export function createContextualTestPinnedCommand(pins: ContextualTestTransportPins, budget: ContextualTestLaunchBudget, seams: ContextualTestCommandSeams) {
  const now = seams.now ?? Date.now, verify = seams.verify ?? verifyContextualTestTransportPins
  assert(typeof seams.settle === 'function')
  assert(Number.isSafeInteger(budget.startedAt) && budget.startedAt <= now() && budget.deadline > now() && budget.deadline - budget.startedAt <= 2700000)
  assert(budget.cleanupDeadline > budget.deadline && budget.cleanupDeadline - budget.deadline <= 360000)
  let cleaning = false, poisoned = false, fault = false, cleanupEnd = budget.cleanupDeadline
  const pending = new Set<NativeCommandChild>()
  const settlements = new Set<Promise<void>>()
  const check = () => assert(!poisoned && (cleaning || !fault) && now() < (cleaning ? cleanupEnd : budget.deadline), 'Private pinned command admission closed')
  const run = async (file: string, args: string[], options: CommandOptions = {}): Promise<string> => {
    check(); assert(!options.env && !options.survey, 'Alternate command transport rejected')
    assert(file === 'git' || file === 'docker' || file === 'supabase'); assert(Array.isArray(args) && args.every(v => typeof v === 'string' && !v.includes('\0')))
    assert(!args.some(a => a === '--host' || a === '-H' || a.startsWith('--host=')), 'Caller Docker endpoint override rejected')
    if (options.startupProjectId) { assignmentListProofWorkdir(options.startupProjectId); assert(file === 'supabase' && args[0] === 'start' && !cleaning) }
    const requestedDuration = options.timeout ?? 30000
    assert(Number.isSafeInteger(requestedDuration) && requestedDuration > 0)
    const maxBytes = options.maxBytes ?? 64 * 1024 * 1024
    assert(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= 64 * 1024 * 1024)
    // The reused canonical SQL adapter requests60s. It receives no extra lease:
    // normal work is clamped to30s; only the exact infrastructure start gets180s.
    const duration = Math.min(requestedDuration, options.startupProjectId ? 180000 : 30000)
    const operationEnd = Math.min(cleaning ? cleanupEnd : budget.deadline, now() + duration)
    const closeEnd = Math.min(cleaning ? cleanupEnd : budget.cleanupDeadline, operationEnd + 12000)
    verify(pins); check()
    const executable = pins[file], argv = file === 'docker' ? ['--host', pins.dockerHost, ...args] : [...args]
    const env = { ...basicEnvironment(), NODE_ENV: 'development' as const, HOME: pins.outputDir, DOCKER_HOST: pins.dockerHost, DOCKER_CONFIG: join(pins.outputDir, 'docker-config') }
    return new Promise<string>((resolve, reject) => {
      let child: NativeCommandChild, closed = false, failed = false, settling = false, bytes = 0
      const chunks: Buffer[] = []
      const stop = () => {
        failed = true; fault = true
        if (closed || settling) return
        settling = true
        const task = Promise.resolve().then(() => seams.settle(child, closeEnd)).catch(() => { poisoned = true })
          .finally(() => settlements.delete(task))
        settlements.add(task)
      }
      try {
        const launch = seams.spawn ?? ((path, values, settings) => spawn(path, values, settings) as NativeCommandChild)
        child = launch(executable.path, argv, { shell: false, detached: true, env, cwd: pins.outputDir, stdio: ['pipe','pipe','pipe'] })
      } catch { reject(new Error('Private pinned command spawn rejected')); return }
      pending.add(child)
      const timeout = setTimeout(stop, Math.max(0, operationEnd - now()))
      const joinTimeout = setTimeout(() => {
        if (!closed) { poisoned = true; stop(); reject(new Error('Private pinned command child closure unconfirmed')) }
      }, Math.max(0, closeEnd - now()))
      child.once('error', stop)
      child.stdout.on('data', (data: Buffer) => { bytes += data.byteLength; if (bytes > maxBytes) stop(); else chunks.push(Buffer.from(data)) })
      child.stderr.on('data', (data: Buffer) => { bytes += data.byteLength; if (bytes > maxBytes) stop() })
      child.stdin.on('error', stop)
      child.once('close', (code, signal) => {
        closed = true; clearTimeout(timeout); clearTimeout(joinTimeout); pending.delete(child)
        if (code !== 0 || signal !== null || now() >= operationEnd) fault = true
        try { verify(pins); check(); assert(!failed && code === 0 && signal === null && now() < operationEnd); resolve(Buffer.concat(chunks).toString('utf8').trim()) }
        catch { reject(new Error('Private pinned command failed')) }
        finally { chunks.length = 0 }
      })
      child.stdin.end(options.input)
    })
  }
  return Object.freeze({ run, beginCleanup(end = Math.min(budget.cleanupDeadline, now() + 360000)) {
    assert(Number.isSafeInteger(end) && end <= budget.cleanupDeadline && end <= now() + 360000)
    cleanupEnd = Math.min(cleanupEnd, end); cleaning = true; check()
  },
    async joinSettlements() { await Promise.all([...settlements]); assert(!poisoned && pending.size === 0 && settlements.size === 0) },
    assertClosed() { assert(!poisoned && pending.size === 0 && settlements.size === 0) },
    state: () => Object.freeze({ poisoned, fault, pending: pending.size, cleaning }) })
}

export type ContextualTestSourceEntry = Readonly<{ path: string; mode: '100644' | '100755'; blob: string; sha256: string }>
export function contextualTestSnapshotPath(value: string): boolean {
  assert(value && !isAbsolute(value) && normalize(value) === value && !/[\x00-\x1f\x7f]/.test(value) && !value.split('/').includes('..'))
  return !value.split('/').some(p => p.startsWith('.env') || ['.git','.next','.auth','node_modules'].includes(p))
}
/** Source bytes are copied only from a clean pinned tree, never from a tar,
 * ignored worktree state, canonical env or an allegedly restored old carrier. */
export async function captureContextualTestSource(repository: string, expectedHead: string, expectedTree: string,
  command: (file: string, args: string[]) => Promise<string>, deadline: number) {
  absolute(repository); assert(/^[a-f0-9]{40}$/.test(expectedHead) && /^[a-f0-9]{40}$/.test(expectedTree))
  const check = () => assert(Date.now() < deadline)
  const verify = async () => {
    check(); assert.equal(await command('git', ['-C', repository, 'rev-parse', 'HEAD']), expectedHead)
    assert.equal(await command('git', ['-C', repository, 'rev-parse', 'HEAD^{tree}']), expectedTree)
    assert.equal(await command('git', ['-C', repository, 'status', '--porcelain', '--untracked-files=all']), '')
    check()
  }
  await verify()
  const listing = await command('git', ['-C', repository, 'ls-tree', '-r', '-z', expectedHead])
  const entries: ContextualTestSourceEntry[] = []; let bytes = 0
  for (const line of listing.split('\0').filter(Boolean)) {
    check(); const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(line); assert(match)
    const [, mode, blob, path] = match
    if (!contextualTestSnapshotPath(path)) continue
    const file = join(repository, path); assert.equal(realpathSync(dirname(file)), dirname(file))
    const before = lstatSync(file); assert(before.isFile() && !before.isSymbolicLink() && before.size <= 64 * 1024 * 1024)
    const content = readFileSync(file); bytes += content.byteLength; assert(bytes <= 512 * 1024 * 1024)
    assert.equal(createHash('sha1').update(`blob ${content.byteLength}\0`).update(content).digest('hex'), blob)
    const after = lstatSync(file); assert(before.dev === after.dev && before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs)
    entries.push(Object.freeze({ path, mode: mode as ContextualTestSourceEntry['mode'], blob, sha256: sha(content) }))
  }
  assert(entries.length > 0 && new Set(entries.map(e => e.path)).size === entries.length)
  await verify()
  return Object.freeze({ repository, head: expectedHead, tree: expectedTree, entries: Object.freeze(entries), sha256: sha(JSON.stringify(entries)), bytes })
}

/** The default filesystem edge is intentionally explicit-call only. It never
 * follows source links or copies dotenv/build/auth state into the app. */
export function prepareContextualTestAppSnapshot(source: Awaited<ReturnType<typeof captureContextualTestSource>>, binding: Pick<ContextualTestRunBinding, 'projectId' | 'workdir' | 'appDir'>,
  dependencyRoot: string, dependencyRoots: readonly string[], deadline: number) {
  const check = () => assert(Date.now() < deadline)
  check(); absolute(dependencyRoot); assert.equal(binding.workdir, assignmentListProofWorkdir(binding.projectId)); assert.equal(binding.appDir, join(binding.workdir, 'app'))
  assert.equal(realpathSync(binding.workdir), binding.workdir)
  assert(dependencyRoots.length > 0 && dependencyRoots.some(root => dependencyRoot === root || dependencyRoot.startsWith(`${root}/`)))
  mkdirSync(binding.appDir, { mode: 0o700 })
  for (const entry of source.entries) {
    check(); assert(contextualTestSnapshotPath(entry.path)); const input = join(source.repository, entry.path), output = join(binding.appDir, entry.path)
    const info = lstatSync(input); assert(info.isFile() && !info.isSymbolicLink() && info.size <= 64 * 1024 * 1024)
    const content = readFileSync(input); assert.equal(sha(content), entry.sha256)
    assert.equal(createHash('sha1').update(`blob ${content.byteLength}\0`).update(content).digest('hex'), entry.blob)
    const after = lstatSync(input); assert(info.dev === after.dev && info.ino === after.ino && info.size === after.size && info.mtimeMs === after.mtimeMs && info.ctimeMs === after.ctimeMs)
    mkdirSync(dirname(output), { recursive: true, mode: 0o700 }); assert.equal(realpathSync(dirname(output)), dirname(output))
    writeFileSync(output, content, { mode: entry.mode === '100755' ? 0o700 : 0o600, flag: 'wx' })
    assert.equal(sha(readFileSync(output)), entry.sha256)
  }
  check(); mkdirSync(join(binding.workdir, 'tmp'), { mode: 0o700 })
  symlinkSync(dependencyRoot, join(binding.appDir, 'node_modules'), 'dir')
  assert.equal(realpathSync(join(binding.appDir, 'node_modules')), realpathSync(dependencyRoot))
  return Object.freeze({ appDir: binding.appDir, sourceSha256: source.sha256, files: source.entries.length, dependencyRoot })
}

export function captureContextualTestDependencies(root: string, deadline: number) {
  absolute(root); const rows: Array<{ path: string; kind: string; sha256: string }> = [], visited = new Set<string>(), links = new Set<string>(), roots = new Set<string>([realpathSync(root)])
  let bytes = 0, count = 0
  const walk = (path: string, label: string, depth = 0): void => {
    assert(Date.now() < deadline && ++count <= 250000 && depth <= 128)
    const info = lstatSync(path)
    if (info.isSymbolicLink()) {
      const target = realpathSync(path), resolved = statSync(target)
      roots.add(resolved.isDirectory() ? target : dirname(target)); rows.push({ path: label, kind: 'link', sha256: sha(readlinkSync(path)) })
      const key = `${info.dev}:${info.ino}`; if (links.has(key)) return; links.add(key)
      walk(target, `${label}@target`, depth + 1); return
    }
    const key = `${info.dev}:${info.ino}`; if (visited.has(key)) return; visited.add(key)
    if (info.isDirectory()) { rows.push({ path: label, kind: 'directory', sha256: '' }); for (const name of readdirSync(path).sort()) walk(join(path, name), `${label}/${name}`, depth + 1) }
    else {
      assert(info.isFile() && info.size <= 128 * 1024 * 1024); const content = readFileSync(path); bytes += content.byteLength; assert(bytes <= 8 * 1024 ** 3)
      rows.push({ path: label, kind: 'file', sha256: sha(content) })
      const after = lstatSync(path); assert(info.dev === after.dev && info.ino === after.ino && info.size === after.size && info.mtimeMs === after.mtimeMs && info.ctimeMs === after.ctimeMs)
    }
  }
  walk(root, 'dependencies')
  const all = [...roots].sort((a, b) => a.length - b.length || a.localeCompare(b))
  const reduced = all.filter((value, index) => !all.slice(0, index).some(parent => value.startsWith(`${parent}/`)))
  return Object.freeze({ sha256: sha(JSON.stringify(rows.sort((a, b) => a.path.localeCompare(b.path)))), roots: Object.freeze(reduced), files: rows.length, bytes })
}
/** Exact inherited read-only-dependency profile, not a network isolation proof.
 * The app preload's separate bounded egress policy remains mandatory. */
export function contextualTestReadOnlyDependencyProfile(roots: readonly string[]): string {
  assert(roots.length > 0 && roots.length <= 4096 && new Set(roots).size === roots.length)
  roots.forEach(root => { absolute(root); assert(root !== '/' && root !== '/Users' && root !== '/private/tmp') })
  return `(version 1)\n(allow default)\n(deny file-write* ${roots.map(root => `(subpath ${JSON.stringify(root)})`).join(' ')})\n`
}

/** Small adapter around the unchanged reviewed ownership primitives. Native
 * row/argv/cwd acquisition and exact signal delivery are deliberately supplied
 * by the root controller; no orphan adoption or guessed negative PID signal. */
export function createContextualTestOwnedFamily(input: { pid: number; pgid: number; executable: string; cwd: string; argv: readonly string[]; role: 'app' | 'browser';
  expectedArgv: readonly string[]; expectedCwd: string; rows: readonly OwnedProcessRow[] }) {
  assert.deepEqual(input.argv, input.expectedArgv); assert.equal(input.cwd, input.expectedCwd)
  const row = input.rows.find(value => value.pid === input.pid); assert(row)
  requireLiveKernelRoot(row); assert.equal(row.executable, input.executable); assert.equal(row.pgid, input.pgid)
  let capture: Capture = { identity: { pid: row.pid, pgid: row.pgid, started: row.started, executable: row.executable, cwd: input.cwd, role: input.role }, descendants: [] }
  capture = reconcileOwnedFamily(capture, input.rows)
  const gate = createFamilyOperationGate()
  return Object.freeze({ snapshot: () => structuredClone(capture),
    refresh: (rows: readonly OwnedProcessRow[]) => { capture = reconcileOwnedFamily(capture, rows); return structuredClone(capture) },
    absent: (rows: readonly OwnedProcessRow[]) => ownedFamilyAbsent(capture, rows),
    settle: (mode: 'group' | 'pid', controls: Omit<Parameters<typeof settleOwnedFamily>[2], 'update'>) => gate.run(controls.admit,
      () => settleOwnedFamily(capture, mode, { ...controls, update: next => { capture = next } })) })
}
