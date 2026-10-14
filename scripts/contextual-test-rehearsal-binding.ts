/** Thin, inert binding and fixed SQL edge for the Playwright import graph.
 * Keep lifecycle/legacy CLI modules outside browser config/runtime loading.
 * Validation, SQL, markers and original settlement rules are unchanged.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { closeSync, constants, fsyncSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, normalize } from 'node:path'
import { createContextualTestPlan, bootstrapContextualTestFixtureSql, contextualTestWitnessSql } from '../e2e/helpers/contextual-test-rehearsal'
import { assignmentListProofWorkdir } from './contextual-assignment-list-proof-path'
import { createContextualTestPinnedCommand, type ContextualTestTransportPins } from './contextual-test-rehearsal-launch'
import { createContextualTestNativeControls, type ContextualTestNativePins } from './contextual-test-rehearsal-native'

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
  /** Required by the actual worker SQL edge; optional only for pure data/CPU callers. */
  sqlControl?: Readonly<{ nativePins: ContextualTestNativePins; transportPins: ContextualTestTransportPins }>
}>

/** Data validation preserves the original clock; it never manufactures an attempt. */
export function validateContextualTestRunBinding(value: unknown, now = Date.now()): ContextualTestRunBinding {
  const hasSqlControl = !!value && typeof value === 'object' && Object.hasOwn(value, 'sqlControl')
  exactData(value, ['version','projectId','appOrigin','apiOrigin','sourceSha','sourceTree','migrationChainSha256','planSha256',
    'nonce','startedAt','deadline','cleanupDeadline','password','workdir','appDir','outputDir','dependencyManifestSha256','docker', ...(hasSqlControl ? ['sqlControl'] : [])])
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
  let sqlControl: ContextualTestRunBinding['sqlControl']
  if (hasSqlControl) {
    exactData(value.sqlControl, ['nativePins','transportPins'])
    const { nativePins, transportPins } = value.sqlControl
    const nativeKeys = ['node','ps','python','lsof','sandbox','codesign','chrome','docker','helper'] as const
    const transportKeys = ['git','docker','supabase'] as const
    exactData(nativePins, [...nativeKeys, 'dockerHost','outputDir'])
    exactData(transportPins, [...transportKeys, 'dockerHost','socketIdentity','outputDir'])
    for (const [pins, keys] of [[nativePins, nativeKeys], [transportPins, transportKeys]] as const) {
      for (const key of keys) { exactData(pins[key], ['path','sha256']); absolute(pins[key].path); assert(hex(pins[key].sha256, 64)) }
      assert.equal(pins.outputDir, value.outputDir); assert.equal(pins.dockerHost, value.docker.host)
      assert.deepEqual(pins.docker, { path: value.docker.path, sha256: value.docker.sha256 })
    }
    assert.deepEqual(transportPins.socketIdentity, value.docker.socketIdentity)
    sqlControl = Object.freeze({
      nativePins: Object.freeze({ ...nativePins, ...Object.fromEntries(nativeKeys.map(key => [key, Object.freeze({ ...nativePins[key] as object })])) }),
      transportPins: Object.freeze({ ...transportPins, ...Object.fromEntries(transportKeys.map(key => [key, Object.freeze({ ...transportPins[key] as object })])), socketIdentity: Object.freeze([...value.docker.socketIdentity]) }),
    }) as ContextualTestRunBinding['sqlControl']
  }
  return Object.freeze({ ...value, ...(sqlControl ? { sqlControl } : {}), docker: Object.freeze({ ...value.docker, socketIdentity: Object.freeze([...value.docker.socketIdentity]) }) }) as ContextualTestRunBinding
}

const files = new WeakMap<object, { path: string; sha256: string }>()
const poisoned = new WeakSet<object>()
const sqlActive = new WeakSet<object>()
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

export type ContextualTestSqlTransport = Pick<ReturnType<typeof createContextualTestPinnedCommand>, 'run' | 'joinSettlements' | 'assertClosed' | 'state'>
const sqlMarker = (binding: ContextualTestRunBinding) => join(binding.outputDir, 'sql-uncertain.json')
function sqlDirectory(binding: ContextualTestRunBinding) {
  assert.equal(realpathSync(binding.outputDir), binding.outputDir)
  const stat = lstatSync(binding.outputDir)
  assert(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid?.() && (stat.mode & 0o777) === 0o700)
  return stat
}
/** Any outstanding marker means closure is unproved, including a worker that
 * died before it could report its failed SQL child. Never recover/adopt it. */
export function assertContextualTestSqlSettled(binding: ContextualTestRunBinding): void {
  assert(!poisoned.has(binding) && !sqlActive.has(binding), 'Private SQL child closure unconfirmed')
  sqlDirectory(binding)
  try { lstatSync(sqlMarker(binding)) } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
  throw new Error('Private SQL child closure unconfirmed')
}
function markSqlPending(binding: ContextualTestRunBinding) {
  const parent = sqlDirectory(binding), name = sqlMarker(binding)
  const fd = openSync(name, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  let identity: ReturnType<typeof fstatSync>
  try {
    identity = fstatSync(fd)
    assert(identity.isFile() && identity.nlink === 1 && identity.uid === parent.uid && (identity.mode & 0o777) === 0o600)
    writeFileSync(fd, JSON.stringify({ version: 1, projectId: binding.projectId, nonce: binding.nonce, deadline: binding.deadline, uncertain: true })); fsyncSync(fd)
    identity = fstatSync(fd)
  } finally { closeSync(fd) }
  return () => {
    const directory = sqlDirectory(binding), current = lstatSync(name)
    assert(directory.dev === parent.dev && directory.ino === parent.ino)
    assert(current.isFile() && !current.isSymbolicLink() && current.dev === identity.dev && current.ino === identity.ino
      && current.nlink === 1 && current.uid === parent.uid && (current.mode & 0o777) === 0o600
      && current.size === identity.size && current.mtimeMs === identity.mtimeMs && current.ctimeMs === identity.ctimeMs)
    unlinkSync(name)
  }
}

const workerSql = new WeakMap<object, { command: ContextualTestSqlTransport; assertClosed(): void }>()
function sqlTransport(binding: ContextualTestRunBinding, explicit?: ContextualTestSqlTransport) {
  if (explicit) return { command: explicit, assertClosed: () => explicit.assertClosed() }
  assert(binding.sqlControl, 'Private SQL native ownership binding required')
  let owned = workerSql.get(binding)
  if (!owned) {
    const native = createContextualTestNativeControls(binding.sqlControl.nativePins, binding.cleanupDeadline)
    const command = createContextualTestPinnedCommand(binding.sqlControl.transportPins, binding, { settle: native.settleCommand })
    owned = { command, assertClosed() { command.assertClosed(); native.assertClosed() } }
    workerSql.set(binding, owned)
  }
  return owned
}

/** Only a read, pinned private binding can dispatch SQL. No arbitrary SQL edge. */
export async function executeContextualTestSql(binding: ContextualTestRunBinding, kind: ContextualTestSqlKind, passwordHash?: string, explicitTransport?: ContextualTestSqlTransport): Promise<string> {
  const file = files.get(binding); assert(file && !poisoned.has(binding), 'Unbound or unsettled rehearsal target')
  const fresh = readContextualTestBinding(file.path, file.sha256); assert.deepEqual(fresh, binding)
  const text = contextualTestSql(binding, kind, passwordHash)
  assertContextualTestSqlSettled(binding)
  const transport = sqlTransport(binding, explicitTransport)
  transport.assertClosed()
  const clearPending = markSqlPending(binding); sqlActive.add(binding)
  const deadline = Math.min(binding.deadline, Date.now() + 30_000)
  const command = async (args: string[], input?: string) => {
    const timeout = deadline - Date.now(); assert(timeout > 0)
    const output = await transport.command.run('docker', args, { input, timeout, maxBytes: 1048576 })
    await transport.command.joinSettlements(); transport.assertClosed()
    assert(Date.now() < deadline && Buffer.byteLength(output) <= 1048576)
    return output
  }
  try {
    const inspection = JSON.parse(await command(['inspect', binding.docker.containerId, '--format',
      '{"id":{{json .Id}},"name":{{json .Name}},"labels":{{json .Config.Labels}},"running":{{json .State.Running}}}']))
    assert.equal(inspection.id, binding.docker.containerId); assert.equal(inspection.name, `/supabase_db_${binding.projectId}`)
    assert.equal(inspection.running, true)
    for (const label of ['com.supabase.cli.project','com.docker.compose.project']) assert.equal(inspection.labels?.[label], binding.projectId)
    return await command(['exec','-i','-e',`PGAPPNAME=${binding.projectId}_fixture`, binding.docker.containerId,
      'psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'], text)
  } catch { throw new Error('Private rehearsal SQL command failed') }
  finally {
    try { await transport.command.joinSettlements(); transport.assertClosed(); clearPending(); sqlActive.delete(binding) }
    catch { poisoned.add(binding); throw new Error('Private SQL child closure unconfirmed') }
    assert(Date.now() < deadline, 'Private rehearsal SQL command deadline')
  }
}
