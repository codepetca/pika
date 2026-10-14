/** Import-safe source-only primitives. No entrypoint, admission, native probe or
 * process is run by importing this module. The coordinator owns native admission.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, normalize } from 'node:path'
import { createContextualTestPlan, bootstrapContextualTestFixtureSql, contextualTestWitnessSql } from '../e2e/helpers/contextual-test-rehearsal'
import { assignmentListEphemeralPlan, assignmentListExpectedResources, validateAssignmentListMigrationChain, type AssignmentListLifecycleAdapters, type AssignmentListResource } from './contextual-assignment-list-proof-lifecycle'
import { loadAssignmentListReviewedMigrations, prepareAssignmentListProjectFiles } from './contextual-assignment-list-proof-platform'
import { assignmentListProofWorkdir } from './contextual-assignment-list-proof-path'
import { validateAssignmentListProofTarget } from './check-contextual-assignment-list-reads'

const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const hex = (value: unknown, n: number) => typeof value === 'string' && new RegExp(`^[a-f0-9]{${n}}$`).test(value)
function exactData(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  assert(value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort())
  assert(Object.values(Object.getOwnPropertyDescriptors(value)).every(d => 'value' in d))
}
function absolute(value: unknown): asserts value is string {
  assert(typeof value === 'string' && isAbsolute(value) && normalize(value) === value && !/[\x00-\x1f\x7f]/.test(value))
}
export type ContextualTestRunBinding = Readonly<{
  version: 1; projectId: string; appOrigin: 'http://localhost:3117'; apiOrigin: 'http://127.0.0.1:54331'
  sourceSha: string; sourceTree: string; migrationChainSha256: string; planSha256: string
  nonce: string; startedAt: number; deadline: number; cleanupDeadline: number; password: string
  workdir: string; appDir: string; outputDir: string; dependencyManifestSha256: string
  docker: Readonly<{ path: string; sha256: string; host: string; socketIdentity: readonly [number, number, number, number]; containerId: string }>
}>

/** Data validation preserves the original clock; it never manufactures an attempt. */
export function validateContextualTestRunBinding(value: unknown, now = Date.now()): ContextualTestRunBinding {
  exactData(value, ['version','projectId','appOrigin','apiOrigin','sourceSha','sourceTree','migrationChainSha256','planSha256',
    'nonce','startedAt','deadline','cleanupDeadline','password','workdir','appDir','outputDir','dependencyManifestSha256','docker'])
  assert.equal(value.version, 1); assert(typeof value.projectId === 'string')
  const plan = createContextualTestPlan(value.projectId)
  for (const key of ['sourceSha','sourceTree','migrationChainSha256','appOrigin','apiOrigin'] as const) assert.equal(value[key], plan[key])
  assert.equal(value.planSha256, sha(JSON.stringify(plan)))
  assert(hex(value.nonce, 32) && (value.nonce as string).endsWith(value.projectId.slice(-12)))
  for (const key of ['startedAt','deadline','cleanupDeadline']) assert(Number.isSafeInteger(value[key]))
  const { startedAt, deadline, cleanupDeadline } = value as unknown as ContextualTestRunBinding
  assert(startedAt <= now && now < deadline && deadline > startedAt && deadline - startedAt <= 45 * 60_000)
  assert(cleanupDeadline > deadline && cleanupDeadline - deadline <= 6 * 60_000)
  assert(typeof value.password === 'string' && value.password.length >= 20 && value.password.length <= 128 && !/[\x00-\x1f\x7f]/.test(value.password))
  assert.equal(value.workdir, assignmentListProofWorkdir(value.projectId))
  assert.equal(value.appDir, join(value.workdir as string, 'app'))
  absolute(value.outputDir)
  assert(value.outputDir !== value.workdir && !value.outputDir.startsWith(`${value.workdir}/`))
  assert(hex(value.dependencyManifestSha256, 64))
  exactData(value.docker, ['path','sha256','host','socketIdentity','containerId'])
  absolute(value.docker.path); assert(hex(value.docker.sha256, 64) && hex(value.docker.containerId, 64))
  assert(typeof value.docker.host === 'string' && value.docker.host.startsWith('unix:///') && !/[\x00-\x20\x7f%?#]/.test(value.docker.host))
  absolute(value.docker.host.slice(7))
  assert(Array.isArray(value.docker.socketIdentity) && value.docker.socketIdentity.length === 4 && value.docker.socketIdentity.every(n => Number.isSafeInteger(n) && n >= 0))
  return Object.freeze({ ...value, docker: Object.freeze({ ...value.docker, socketIdentity: Object.freeze([...value.docker.socketIdentity]) }) }) as ContextualTestRunBinding
}

const files = new WeakMap<object, { path: string; sha256: string }>()
const poisoned = new WeakSet<object>()
/** Exact file read: O_NOFOLLOW plus fstat closes the symlink/stat race. */
export function readContextualTestBinding(path: string, sha256: string): ContextualTestRunBinding {
  absolute(path); assert(hex(sha256, 64)); assert.equal(realpathSync(dirname(path)), dirname(path))
  const before = lstatSync(path); assert(before.isFile() && !before.isSymbolicLink())
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const s = fstatSync(fd)
    assert(s.isFile() && s.uid === process.getuid?.() && (s.mode & 0o777) === 0o600 && s.nlink === 1 && s.size > 0 && s.size <= 65536)
    assert.equal(s.dev, before.dev); assert.equal(s.ino, before.ino)
    const text = readFileSync(fd); assert.equal(sha(text), sha256)
    const binding = validateContextualTestRunBinding(JSON.parse(text.toString('utf8')))
    assert.equal(dirname(path), binding.outputDir, 'Binding must be retained in its private durable output directory')
    const directory = lstatSync(binding.outputDir)
    assert(directory.isDirectory() && !directory.isSymbolicLink() && directory.uid === process.getuid?.() && (directory.mode & 0o777) === 0o700)
    const after = fstatSync(fd); assert.equal(after.size, s.size); assert.equal(after.mtimeMs, s.mtimeMs); assert.equal(after.ctimeMs, s.ctimeMs)
    files.set(binding, { path, sha256 }); return binding
  } finally { closeSync(fd) }
}

export type ContextualTestSqlKind = 'witness' | 'bootstrap' | 'revokeMemberTeacherA' | 'restoreMemberTeacherA' | 'archiveA' | 'restoreArchiveA'
export function contextualTestSql(binding: ContextualTestRunBinding, kind: ContextualTestSqlKind, passwordHash?: string) {
  const plan = createContextualTestPlan(binding.projectId)
  if (kind === 'witness') { assert.equal(passwordHash, undefined); return contextualTestWitnessSql(plan) }
  if (kind === 'bootstrap') { assert(typeof passwordHash === 'string'); return bootstrapContextualTestFixtureSql(plan, passwordHash) }
  assert.equal(passwordHash, undefined)
  assert(Object.hasOwn(plan.mutations, kind), 'Unknown fixed rehearsal SQL operation')
  return plan.mutations[kind as keyof typeof plan.mutations]
}

function verifyDocker(binding: ContextualTestRunBinding) {
  assert.equal(realpathSync(binding.docker.path), binding.docker.path)
  const binary = statSync(binding.docker.path); assert(binary.isFile() && (binary.mode & 0o022) === 0)
  assert.equal(sha(readFileSync(binding.docker.path)), binding.docker.sha256)
  const path = binding.docker.host.slice(7); assert.equal(realpathSync(path), path)
  const socket = statSync(path); assert(socket.isSocket())
  assert.deepEqual([socket.dev,socket.ino,socket.mode,socket.rdev], binding.docker.socketIdentity)
}

/** A timeout signal is not closure. Unjoined children poison this binding. */
async function dockerCommand(binding: ContextualTestRunBinding, args: string[], input: string | undefined, operationDeadline: number): Promise<string> {
  assert(!poisoned.has(binding)); verifyDocker(binding)
  const timeout = operationDeadline - Date.now(); assert(timeout > 0)
  return new Promise((resolve, reject) => {
    let bytes = 0, output = '', failed = false, closed = false
    const child = spawn(binding.docker.path, ['--host', binding.docker.host, ...args], { shell: false,
      env: { PATH: '/usr/bin:/bin', HOME: binding.outputDir, DOCKER_CONFIG: join(binding.outputDir, 'docker-config'), LANG: 'C', LC_ALL: 'C', NODE_ENV: 'development' },
      stdio: ['pipe','pipe','pipe'] })
    const kill = () => { failed = true; try { child.kill('SIGKILL') } catch { /* close still required */ } }
    const timer = setTimeout(kill, timeout)
    const joinTimer = setTimeout(() => {
      if (!closed) { poisoned.add(binding); kill(); reject(new Error('Rehearsal Docker child closure unconfirmed')) }
    }, Math.min(binding.cleanupDeadline, operationDeadline + 5000) - Date.now())
    child.on('error', () => { failed = true })
    child.stdout.on('data', data => { bytes += data.length; if (bytes > 1048576) kill(); else output += data.toString('utf8') })
    child.stderr.on('data', data => { bytes += data.length; if (bytes > 1048576) kill() })
    child.stdin.on('error', kill)
    child.once('close', (code, signal) => {
      closed = true; clearTimeout(timer); clearTimeout(joinTimer)
      try { verifyDocker(binding) } catch { failed = true }
      if (failed || code !== 0 || signal || Date.now() >= operationDeadline) reject(new Error('Private rehearsal SQL command failed'))
      else resolve(output.trim())
    })
    child.stdin.end(input)
  })
}

/** Only a read, pinned private binding can dispatch SQL. No arbitrary SQL edge. */
export async function executeContextualTestSql(binding: ContextualTestRunBinding, kind: ContextualTestSqlKind, passwordHash?: string): Promise<string> {
  const file = files.get(binding); assert(file && !poisoned.has(binding), 'Unbound or unsettled rehearsal target')
  const fresh = readContextualTestBinding(file.path, file.sha256); assert.deepEqual(fresh, binding)
  const text = contextualTestSql(binding, kind, passwordHash)
  const deadline = Math.min(binding.deadline, Date.now() + 30_000)
  const inspection = JSON.parse(await dockerCommand(binding, ['inspect', binding.docker.containerId, '--format',
    '{"id":{{json .Id}},"name":{{json .Name}},"labels":{{json .Config.Labels}},"running":{{json .State.Running}}}'], undefined, deadline))
  assert.equal(inspection.id, binding.docker.containerId); assert.equal(inspection.name, `/supabase_db_${binding.projectId}`)
  assert.equal(inspection.running, true)
  for (const label of ['com.supabase.cli.project','com.docker.compose.project']) assert.equal(inspection.labels?.[label], binding.projectId)
  return dockerCommand(binding, ['exec','-i','-e',`PGAPPNAME=${binding.projectId}_fixture`, binding.docker.containerId,
    'psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'], text, deadline)
}

/** Existing frozen migration loader and private project preparation; never263. */
export function contextualTestProjectPreparation(binding: ContextualTestRunBinding, frozenRepository: string) {
  const migrations = loadAssignmentListReviewedMigrations(frozenRepository)
  assert.equal(migrations.length, 262)
  validateAssignmentListMigrationChain(migrations)
  assert.equal(sha(JSON.stringify(migrations.map(({ name, sha256 }) => ({ name, sha256 })))), binding.migrationChainSha256)
  return { plan: assignmentListEphemeralPlan(binding), migrations,
    prepare: () => prepareAssignmentListProjectFiles(assignmentListEphemeralPlan(binding), migrations) }
}

const projectResource = (r: AssignmentListResource, projectId: string) => r.name.endsWith(`_${projectId}`) ||
  r.labels['com.supabase.cli.project'] === projectId || r.labels['com.docker.compose.project'] === projectId
export function validateContextualTestClosure(projectId: string, before: AssignmentListResource[], current: AssignmentListResource[], complete = true) {
  const expected = new Set(assignmentListExpectedResources(projectId).map(r => `${r.kind}:${r.name}`))
  assert.equal(new Set(current.map(r => `${r.kind}:${r.id}`)).size, current.length)
  const selected = current.filter(r => projectResource(r, projectId)); const ids = new Set(selected.map(r => r.id))
  assert.equal(new Set(selected.map(r => `${r.kind}:${r.name}`)).size, selected.length)
  if (complete) assert.equal(selected.length, expected.size)
  assert(!current.some(r => !ids.has(r.id) && r.attachedIds.some(id => ids.has(id))))
  for (const r of selected) {
    assert(expected.has(`${r.kind}:${r.name}`) && r.createdAt.length > 0)
    assert(!before.some(old => old.id === r.id || (old.kind === r.kind && old.name === r.name)))
    for (const label of ['com.supabase.cli.project','com.docker.compose.project']) assert.equal(r.labels[label], projectId)
    assert(r.attachedIds.every(id => ids.has(id))); assert(r.ports.every(p => [54331,54332,54340].includes(p)))
  }
  return selected
}

type DisposableAdapters = Pick<AssignmentListLifecycleAdapters, 'canonicalSnapshot' | 'inventory' | 'prepare' | 'command' | 'verifyEphemeral' | 'teardown' | 'removeWorkdir'>
export type ContextualTestDisposableInput = Pick<ContextualTestRunBinding, 'projectId' | 'workdir' | 'startedAt' | 'deadline' | 'cleanupDeadline' | 'migrationChainSha256'>
export type ContextualTestLocalStatus = Readonly<ReturnType<typeof validateAssignmentListProofTarget> & { ANON_KEY: string }>
function localStatus(value: unknown, projectId: string): ContextualTestLocalStatus {
  const target = validateAssignmentListProofTarget(value, projectId)
  assert(value && typeof value === 'object')
  const field = Object.getOwnPropertyDescriptor(value, 'ANON_KEY')
  assert(field && 'value' in field && typeof field.value === 'string')
  const token: string = field.value
  assert(token.length >= 20 && token.length <= 4096 && !/[\x00-\x20\x7f]/.test(token))
  const parts = token.split('.'); assert(parts.length === 3 && parts.every(Boolean))
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  assert.equal(claims.iss, 'supabase-demo'); assert.equal(claims.role, 'anon')
  return Object.freeze({ ...target, ANON_KEY: token })
}
/** Reuses the existing platform edges without Assignment or Survey scenarios.
 * Native caller must supply pinned transports and process settlement; this is
 * deliberately not a native launch entrypoint or an admission readiness claim.
 */
export async function runContextualTestDisposableLifecycle(binding: ContextualTestDisposableInput,
  migrations: ReturnType<typeof loadAssignmentListReviewedMigrations>, adapters: DisposableAdapters,
  work: (target: ReturnType<typeof validateAssignmentListProofTarget>, resources: readonly AssignmentListResource[], status: ContextualTestLocalStatus) => Promise<void>, settleOwnedProcesses: () => Promise<void>) {
  const plan = createContextualTestPlan(binding.projectId)
  const identity = assignmentListEphemeralPlan(binding)
  assert.equal(binding.workdir, assignmentListProofWorkdir(binding.projectId))
  assert.equal(binding.migrationChainSha256, plan.migrationChainSha256)
  assert(Number.isSafeInteger(binding.startedAt) && binding.startedAt <= Date.now())
  assert(Number.isSafeInteger(binding.deadline) && binding.deadline > binding.startedAt && binding.deadline - binding.startedAt <= 45 * 60_000)
  assert(Number.isSafeInteger(binding.cleanupDeadline) && binding.cleanupDeadline > binding.deadline && binding.cleanupDeadline - binding.deadline <= 6 * 60_000)
  assert.equal(migrations.length, 262)
  validateAssignmentListMigrationChain(migrations)
  assert.equal(sha(JSON.stringify(migrations.map(({ name, sha256 }) => ({ name, sha256 })))), binding.migrationChainSha256)
  const check = (cleanup = false) => assert(Date.now() < (cleanup ? binding.cleanupDeadline : binding.deadline))
  const canonicalRequest = { projectId: 'pika' as const, dbPort: 54322 as const, applicationName: `${binding.projectId}_canonical_readonly`, readOnly: true as const }
  let baseline: Awaited<ReturnType<DisposableAdapters['canonicalSnapshot']>> | undefined
  let before: Awaited<ReturnType<DisposableAdapters['inventory']>> | undefined
  let prepared: Awaited<ReturnType<DisposableAdapters['prepare']>> | undefined
  let attempted = false, primary: unknown, captured: AssignmentListResource[] | undefined
  const cleanupErrors: unknown[] = []
  const clean = async (fn: () => Promise<void>) => { try { check(true); await fn() } catch (error) { cleanupErrors.push(error) } }
  try {
    check(); baseline = structuredClone(await adapters.canonicalSnapshot(canonicalRequest))
    for (const key of ['rowDigests','guard168Metadata','settings','cronJobs','resources'] as const) assert(typeof baseline[key] === 'string' && baseline[key].length > 0)
    check(); before = structuredClone(await adapters.inventory(identity))
    assert(!before.workdirExists && !before.occupiedPorts.some(p => [54331,54332,54340,3117].includes(p)))
    assert(!before.resources.some(r => projectResource(r, binding.projectId)))
    check(); prepared = await adapters.prepare(assignmentListEphemeralPlan(binding), migrations)
    assert(prepared.created && prepared.realpath === binding.workdir && prepared.workdir === binding.workdir)
    assert.equal(prepared.configSha256, sha(assignmentListEphemeralPlan(binding).config))
    assert.deepEqual(prepared.migrations, migrations.map(({ name, sha256 }) => ({ name, sha256 })))
    assert.deepEqual(prepared.envFiles, []); assert.deepEqual(prepared.symlinks, [])
    check(); const fresh = await adapters.inventory(identity)
    assert(!fresh.occupiedPorts.some(p => [54331,54332,54340,3117].includes(p)))
    assert(!fresh.resources.some(r => projectResource(r, binding.projectId))); before.resources = structuredClone(fresh.resources)
    check(); attempted = true
    await adapters.command({ args: ['start','--workdir',binding.workdir,'-x','analytics,edge-runtime,functions,imgproxy,inbucket,meta,realtime,studio,vector'], workdir: binding.workdir, timeoutMs: Math.min(180_000,binding.deadline-Date.now()) })
    check(); const inventory = await adapters.inventory(identity)
    const selected = validateContextualTestClosure(binding.projectId, before.resources, inventory.resources)
    captured = structuredClone(selected)
    const db = selected.find(r => r.name === `supabase_db_${binding.projectId}`)!
    assert.deepEqual(db.ports, [54332])
    assert.deepEqual(selected.find(r => r.name === `supabase_kong_${binding.projectId}`)!.ports, [54331])
    check(); const status = localStatus(await adapters.command({ args: ['status','--workdir',binding.workdir,'-o','json'], workdir: binding.workdir, timeoutMs: 15000 }), binding.projectId)
    const target = validateAssignmentListProofTarget(status, binding.projectId)
    const session = await adapters.verifyEphemeral({ projectId: binding.projectId, dbPort: 54332, applicationName: `${binding.projectId}_fixture`, target })
    assert.equal(session.projectId, binding.projectId); assert.equal(session.dbPort, 54332); assert.equal(session.applicationName, `${binding.projectId}_fixture`)
    assert.equal(session.containerId, db.id); assert(session.guard168Enabled && session.persistedGatesOff && session.activeNetworkCronAbsent)
    check(); await work(target, Object.freeze(selected.map(r => Object.freeze(structuredClone(r)))), status); check()
  } catch (error) { primary = error }
  finally {
    let settled = false, absent = !attempted
    await clean(async () => { await settleOwnedProcesses(); settled = true })
    if (attempted && before && settled) await clean(async () => {
      const current = await adapters.inventory(identity)
      const resources = validateContextualTestClosure(binding.projectId, before!.resources, current.resources, false)
      if (captured) assert.deepEqual(resources, captured, 'Captured resource identity or closure drift')
      await adapters.teardown({ projectId: binding.projectId, workdir: binding.workdir, resources, stopArgs: null })
      const after = await adapters.inventory(identity)
      assert(!after.resources.some(r => projectResource(r, binding.projectId))); absent = true
    })
    if (prepared && absent && settled) await clean(() => adapters.removeWorkdir({ projectId: binding.projectId, workdir: binding.workdir, realpath: prepared!.realpath }))
    if (baseline) await clean(async () => assert.deepEqual(await adapters.canonicalSnapshot(canonicalRequest), baseline))
  }
  if (primary || cleanupErrors.length) throw new AggregateError([...(primary ? [primary] : []), ...cleanupErrors], 'Private Tests lifecycle failed; retain bounded private evidence')
}
