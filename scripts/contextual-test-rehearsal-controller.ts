/** Import-safe orchestration over the existing disposable lifecycle.
 * No default native controls, CLI, auto-preparation, retry or authority fallback.
 * Callers must supply separately reviewed/currently admitted native controls.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { constants, closeSync, fsyncSync, fstatSync, lstatSync, openSync, readFileSync, readSync, realpathSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, normalize } from 'node:path'
import { isProxy } from 'node:util/types'
import { createContextualTestPlan } from '../e2e/helpers/contextual-test-rehearsal'
import { readFullStartupReport, validateFullStartupReport, type FullStartupReport } from '../e2e/helpers/contextual-test-startup'
import { hashPassword } from '../src/lib/crypto'
import { createAssignmentListNativeAdapters } from './contextual-assignment-list-proof-platform'
import type { AssignmentListProofFixture } from './contextual-assignment-list-proof-fixture'
import type { ContextualTestNativeDiagnostics } from './contextual-test-rehearsal-native'
import { runContextualTestDisposableLifecycle, contextualTestSetupDiagnostic, readContextualTestBinding, validateContextualTestRunBinding, executeContextualTestSql, assertContextualTestSqlSettled,
  type ContextualTestRunBinding, type ContextualTestDisposableInput, type ContextualTestSetupDiagnostic } from './contextual-test-rehearsal-platform'
import { assignmentListProofWorkdir } from './contextual-assignment-list-proof-path'
import { contextualTestAppEnvironment, contextualTestRunnerEnvironment, contextualTestLaunchCommands, validateContextualTestDemoStatus,
  contextualTestReadOnlyDependencyProfile, prepareContextualTestAppSnapshot,
  immutableContextualTestData,
  type captureContextualTestSource, type createContextualTestPinnedCommand, type ContextualTestTransportPins } from './contextual-test-rehearsal-launch'

type Source = Awaited<ReturnType<typeof captureContextualTestSource>>
type PinnedCommand = ReturnType<typeof createContextualTestPinnedCommand>
type DisposableAdapters = Parameters<typeof runContextualTestDisposableLifecycle>[2]
export type ContextualTestControllerAdmission = ContextualTestDisposableInput & Readonly<{
  version: 1; nonce: string; appDir: string; outputDir: string; password: string; sessionSecret: string
  frozen: Source; runner: Source
  review: Readonly<{ manifestSha256: string; runnerHead: string; runnerTree: string }>
  dependencies: Readonly<{ root: string; sha256: string; roots: readonly string[] }>
  transportPins: ContextualTestTransportPins
  /** Preallocated factory metadata only. Never seeded or used for case dispatch. */
  assignmentMetadata: AssignmentListProofFixture
  migrations: Parameters<typeof runContextualTestDisposableLifecycle>[1]
}>
export type ContextualTestControllerLaunch = Readonly<{ binding: ContextualTestRunBinding; args: readonly string[]; cwd: string;
  env: Readonly<Record<string, string>>; dependencySandboxProfile: string }>
export type ContextualTestControllerControls = Readonly<{
  now(): number
  /** MUST independently bind owner admission/review digest, frozen and runner
   * trees/closures,262 migrations, dependencies, current binaries/socket/images,
   * CLI versions, capacity, ports and actual sandbox denial. Not a boolean flag. */
  assertReady(admission: ContextualTestControllerAdmission): Promise<void>
  assertUnchanged(): Promise<void>
  command: Pick<PinnedCommand, 'run' | 'beginCleanup' | 'assertClosed' | 'state' | 'joinSettlements'>
  sqlControl?: ContextualTestRunBinding['sqlControl']
  launchApp(input: ContextualTestControllerLaunch): Promise<{ ready(): Promise<void> }>
  launchPlaywright(input: ContextualTestControllerLaunch): Promise<{ wait(): Promise<{ code: number | null; signal: string | null; closed: boolean }> }>
  settleAll(originalCleanupDeadline: number): Promise<void>
  /** Diagnostic snapshot only; never authority for settlement or success. */
  nativeDiagnostics?(): unknown
}>
type LedgerState = { version: 1; nonce: string; deadline: number; app: number; storage: number; api: number;
  flags: { denied: boolean; capExceeded: boolean; expired: boolean; uncertain: boolean } }
type Stage = 'preflight' | 'attempt' | 'lifecycle' | 'snapshot' | 'binding' | 'fixture' | 'ledger' | 'app-ready' | 'browser' | 'proof' | 'cleanup' | 'complete'
type CleanupState = 'not-run' | 'passed' | 'failed'
const executionCleanupStages = ['command-entry', 'owned-families', 'command-settlements', 'command-closure', 'native-closure'] as const
type ExecutionCleanupStage = typeof executionCleanupStages[number] | 'unknown'
type CleanupReceipt = Readonly<{ entry: CleanupState; executionSettlement: CleanupState; commandJoins: CleanupState;
  commandClosure: CleanupState; sqlClosure: CleanupState; unchanged: CleanupState; executionFailures: readonly ExecutionCleanupStage[] }>
type Receipt = Readonly<{ version: 1; projectId: string; sourceSha: string; sourceTree: string; runnerHead: string; runnerTree: string;
  reviewedManifestSha256: string; startedAt: number; deadline: number; cleanupDeadline: number; endedAt: number;
  cleanupStartedAt: number | null; cleanupEnd: number | null; cleanup: CleanupReceipt;
  outcome: 'passed' | 'failed'; firstFailureStage: Stage | null; lifecycleCompleted: boolean; ownedSettled: boolean;
  playwrightValidated: boolean; server: LedgerState | null; startup: FullStartupReport | null; nativeDiagnostics: ContextualTestNativeDiagnostics | null;
  setupDiagnostic: ContextualTestSetupDiagnostic | null }>
/** Test seams replace only I/O; no injected result is native acceptance proof. */
export type ContextualTestControllerEdges = {
  openEvidence(admission: ContextualTestControllerAdmission): void
  prepareApp: typeof prepareContextualTestAppSnapshot
  createAdapters: (metadata: AssignmentListProofFixture, options: { nativeCommand: PinnedCommand['run'] }) => DisposableAdapters
  lifecycle: typeof runContextualTestDisposableLifecycle
  bind(binding: ContextualTestRunBinding): { binding: ContextualTestRunBinding; file: string; sha256: string }
  passwordHash(password: string): Promise<string>
  sql: typeof executeContextualTestSql
  assertSqlSettled: typeof assertContextualTestSqlSettled
  createLedger(binding: ContextualTestRunBinding): { snapshot(): unknown; reserveAppReadiness(): void }
  readPlaywrightReceipt(binding: ContextualTestRunBinding): unknown
  readStartupReport?(binding: ContextualTestRunBinding): unknown
  verifyArtifacts(binding: ContextualTestRunBinding, rawReceipt: unknown): void
  writeReceipt(receipt: Receipt, admission: ContextualTestControllerAdmission): void
}
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
const hex = /^[a-f0-9]{64}$/
const fixedError = () => new Error('Private contextual Test controller failed; consult sanitized retained receipt')
/** Private fixed producer metadata may be retained even when closure fails.
 * Never inspect exception messages, accessors, proxies or inherited fields. */
function projectNativeDiagnostics(raw: unknown): ContextualTestNativeDiagnostics | null {
  try {
    const data = (value: unknown, keys: readonly string[]): Record<string, unknown> => {
      assert(value && typeof value === 'object' && !isProxy(value) && Object.getPrototypeOf(value) === Object.prototype)
      assert.deepEqual(Reflect.ownKeys(value).sort(), [...keys].sort())
      const descriptors = Object.getOwnPropertyDescriptors(value)
      Object.setPrototypeOf(descriptors, null)
      const result: Record<string, unknown> = Object.create(null)
      for (const key of keys) {
        assert(Object.hasOwn(descriptors, key) && Object.hasOwn(descriptors[key], 'value'))
        result[key] = descriptors[key].value
      }
      return result
    }
    const roles = ['app','browser','command','probe','unknown'] as const
    const phases = ['birth','monitor','ready','wait','settle','aggregate','probe'] as const
    const causes = ['snapshot-schema','kernel-unverified','identity-mismatch','unverified-group','closure-deadline','unknown',
      'probe-deadline','probe-exit','probe-overflow','signal-error','output-overflow','child-error','prior-uncertainty','active-probes','children-remain','route-readiness','route-closure'] as const
    const row = (value: unknown) => {
      const v = data(value, ['role','phase','cause','closed','uncertain','identityMismatch'])
      assert(roles.includes(v.role as typeof roles[number]) && phases.includes(v.phase as typeof phases[number]) && causes.includes(v.cause as typeof causes[number]))
      assert(typeof v.closed === 'boolean' && typeof v.uncertain === 'boolean')
      let identityMismatch = null
      if (v.identityMismatch !== null) {
        assert(v.cause === 'identity-mismatch')
        const detail = data(v.identityMismatch, ['member','state','startTimeChanged','pgidChanged','executableChanged'])
        assert(detail.member === 'root' || detail.member === 'descendant')
        assert(detail.state === 'alive' || detail.state === 'zombie' || detail.state === 'exiting' || detail.state === 'unknown')
        assert(typeof detail.startTimeChanged === 'boolean' && typeof detail.pgidChanged === 'boolean' && typeof detail.executableChanged === 'boolean')
        assert(detail.startTimeChanged || detail.pgidChanged || detail.executableChanged)
        identityMismatch = Object.freeze({ member: detail.member, state: detail.state, startTimeChanged: detail.startTimeChanged,
          pgidChanged: detail.pgidChanged, executableChanged: detail.executableChanged })
      }
      return Object.freeze({ role: v.role as typeof roles[number], phase: v.phase as typeof phases[number], cause: v.cause as typeof causes[number], closed: v.closed, uncertain: v.uncertain, identityMismatch })
    }
    const snapshot = data(raw, ['firstFailure','failures','overflow','activeProbes','unsettledFamilies'])
    assert(typeof snapshot.overflow === 'boolean')
    for (const key of ['activeProbes','unsettledFamilies']) assert(Number.isSafeInteger(snapshot[key]) && Number(snapshot[key]) >= 0 && Number(snapshot[key]) <= 1000000)
    const entries = snapshot.failures
    assert(entries && typeof entries === 'object' && !isProxy(entries) && Array.isArray(entries) && Object.getPrototypeOf(entries) === Array.prototype)
    const descriptors = Object.getOwnPropertyDescriptors(entries) as unknown as Record<string, PropertyDescriptor>
    Object.setPrototypeOf(descriptors, null)
    assert(Object.hasOwn(descriptors.length, 'value'))
    const length = descriptors.length.value
    assert(Number.isSafeInteger(length) && length >= 0 && length <= 16)
    assert.deepEqual(Reflect.ownKeys(entries).sort(), [...Array.from({ length }, (_, i) => String(i)), 'length'].sort())
    const failures = Array.from({ length }, (_, i) => {
      assert(Object.hasOwn(descriptors[String(i)], 'value'))
      return row(descriptors[String(i)].value)
    })
    const firstFailure = snapshot.firstFailure === null ? null : row(snapshot.firstFailure)
    assert(firstFailure === null || firstFailure.phase !== 'aggregate')
    return Object.freeze({ firstFailure, failures: Object.freeze(failures), overflow: snapshot.overflow,
      activeProbes: Number(snapshot.activeProbes), unsettledFamilies: Number(snapshot.unsettledFamilies) })
  } catch { return null }
}
/** Project only the execution control's five existing stage labels. Never read
 * accessors, iterate supplied arrays or retain any supplied exception object. */
function projectExecutionCleanupStages(error: unknown): ExecutionCleanupStage[] {
  const stages = new Set<ExecutionCleanupStage>()
  const data = (value: unknown, key: string): unknown => {
    if (!value || typeof value !== 'object' || isProxy(value)) return undefined
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor && 'value' in descriptor ? descriptor.value : undefined
  }
  try {
    // The native producer constructs direct AggregateErrors. Do not traverse a
    // supplied prototype chain: even a non-Proxy may inherit a Proxy trap.
    if (!error || typeof error !== 'object' || isProxy(error) || Object.getPrototypeOf(error) !== AggregateError.prototype) return ['unknown']
    const errors = data(error, 'errors'), length = data(errors, 'length')
    if (!Array.isArray(errors) || typeof length !== 'number' || !Number.isSafeInteger(length) || length < 1) return ['unknown']
    for (let index = 0; index < Math.min(length, executionCleanupStages.length); index++) {
      const stage = data(data(errors, String(index)), 'cleanupStage')
      stages.add(executionCleanupStages.find(allowed => allowed === stage) ?? 'unknown')
    }
    if (length > executionCleanupStages.length) stages.add('unknown')
  } catch { stages.add('unknown') }
  return [...stages]
}
function path(value: string) { assert(isAbsolute(value) && normalize(value) === value && !/[\x00-\x1f\x7f]/.test(value)) }
function directory(value: string) {
  path(value); assert.equal(realpathSync(value), value)
  const stat = lstatSync(value); assert(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid?.() && (stat.mode & 0o777) === 0o700)
  return stat
}
function exclusiveJson(outputDir: string, name: 'attempt.json' | 'run-binding.json' | 'controller-receipt.json', value: unknown) {
  const parent = directory(outputDir), bytes = Buffer.from(JSON.stringify(value)); assert(bytes.byteLength <= 65536)
  const file = join(outputDir, name), fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  try { const stat = fstatSync(fd); assert(stat.isFile() && stat.nlink === 1 && stat.uid === parent.uid && (stat.mode & 0o777) === 0o600); writeFileSync(fd, bytes); fsyncSync(fd) }
  finally { closeSync(fd) }
  const after = directory(outputDir); assert(parent.dev === after.dev && parent.ino === after.ino)
  return { file, sha256: sha(bytes) }
}
function readReceipt(binding: ContextualTestRunBinding): unknown {
  const parent = directory(binding.outputDir), file = join(binding.outputDir, 'playwright-receipt.json')
  const before = lstatSync(file); assert(before.isFile() && !before.isSymbolicLink())
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const stat = fstatSync(fd); assert(stat.isFile() && stat.nlink === 1 && stat.uid === parent.uid && (stat.mode & 0o777) === 0o600 && stat.size <= 1048576)
    assert(stat.dev === before.dev && stat.ino === before.ino)
    const bytes = readFileSync(fd), after = fstatSync(fd); assert(stat.size === after.size && stat.mtimeMs === after.mtimeMs && stat.ctimeMs === after.ctimeMs)
    return JSON.parse(bytes.toString('utf8'))
  } finally { closeSync(fd) }
}
const defaults: ContextualTestControllerEdges = {
  openEvidence(admission) {
    exclusiveJson(admission.outputDir, 'attempt.json', { version: 1, projectId: admission.projectId, nonce: admission.nonce,
      reviewedManifestSha256: admission.review.manifestSha256, runnerHead: admission.runner.head, runnerTree: admission.runner.tree,
      startedAt: admission.startedAt, deadline: admission.deadline, cleanupDeadline: admission.cleanupDeadline })
  },
  prepareApp: prepareContextualTestAppSnapshot,
  createAdapters: (metadata, options) => createAssignmentListNativeAdapters(metadata, options),
  lifecycle: runContextualTestDisposableLifecycle,
  bind(binding) {
    const file = exclusiveJson(binding.outputDir, 'run-binding.json', binding)
    return { binding: readContextualTestBinding(file.file, file.sha256), ...file }
  },
  passwordHash: hashPassword,
  sql: executeContextualTestSql,
  assertSqlSettled: assertContextualTestSqlSettled,
  createLedger(binding) {
    // Requiring the CJS policy must not auto-install its app-only hooks into
    // this controller. Native caller env remains separately hermetic.
    assert(!process.env.PIKA_CONTEXTUAL_TEST_BINDING_FILE && !process.env.PIKA_CONTEXTUAL_TEST_BINDING_SHA256)
    const ledgerModule = createRequire(import.meta.url)('./contextual-test-rehearsal-egress.cjs') as { createContextualTestSharedLedger(input: ContextualTestRunBinding, options: { create: true }): { snapshot(): unknown; charge(bucket: 'app'): void } }
    const ledger = ledgerModule.createContextualTestSharedLedger(binding, { create: true })
    let reserved = false
    return { snapshot: () => ledger.snapshot(), reserveAppReadiness() {
      assert(!reserved); reserved = true
      // One cold-route GET consumes the existing server app allocation (50),
      // leaving browser 950 + server 50 = the original aggregate 1000 ceiling.
      ledger.charge('app')
    } }
  },
  readPlaywrightReceipt: readReceipt,
  readStartupReport: readFullStartupReport,
  verifyArtifacts: verifyContextualTestArtifacts,
  writeReceipt(receipt, admission) { exclusiveJson(admission.outputDir, 'controller-receipt.json', receipt) },
}

function validateAdmission(a: ContextualTestControllerAdmission, now: number) {
  assert(a.version === 1 && /^[a-f0-9]{32}$/.test(a.nonce) && a.nonce.endsWith(a.projectId.slice(-12)))
  const plan = createContextualTestPlan(a.projectId)
  assert.equal(a.workdir, assignmentListProofWorkdir(a.projectId)); assert.equal(a.appDir, join(a.workdir, 'app'))
  path(a.outputDir); assert(a.outputDir !== a.workdir && !a.outputDir.startsWith(`${a.workdir}/`))
  assert.equal(a.assignmentMetadata.manifest.syntheticTag, `assignmentlist_${a.projectId.slice(-12)}`)
  assert.equal(a.frozen.head, plan.sourceSha); assert.equal(a.frozen.tree, plan.sourceTree)
  assert(hex.test(a.frozen.sha256) && hex.test(a.runner.sha256) && hex.test(a.review.manifestSha256))
  assert.equal(a.runner.head, a.review.runnerHead); assert.equal(a.runner.tree, a.review.runnerTree)
  assert(/^[a-f0-9]{40}$/.test(a.runner.head) && /^[a-f0-9]{40}$/.test(a.runner.tree))
  path(a.frozen.repository); path(a.runner.repository); path(a.dependencies.root)
  assert(hex.test(a.dependencies.sha256) && a.dependencies.roots.length > 0)
  assert.equal(a.transportPins.outputDir, a.outputDir)
  assert(Number.isSafeInteger(a.startedAt) && a.startedAt <= now && now < a.deadline && a.deadline - a.startedAt <= 2700000)
  assert(Number.isSafeInteger(a.cleanupDeadline) && a.cleanupDeadline > a.deadline && a.cleanupDeadline - a.deadline <= 360000)
  assert.equal(a.migrationChainSha256, plan.migrationChainSha256)
  assert(a.password.length >= 20 && a.password.length <= 128 && a.sessionSecret.length >= 48 && a.sessionSecret.length <= 128)
  return plan
}
function projectLedger(raw: unknown, binding: ContextualTestRunBinding): LedgerState {
  assert(raw && typeof raw === 'object'); const row = raw as LedgerState
  assert.deepEqual(Object.keys(row).sort(), ['api','app','deadline','flags','nonce','storage','version'])
  assert(row.version === 1 && row.nonce === binding.nonce && row.deadline === binding.deadline)
  for (const key of ['app','storage','api'] as const) assert(Number.isSafeInteger(row[key]) && row[key] >= 0)
  assert(row.app <= 50 && row.storage <= 20)
  assert.deepEqual(Object.keys(row.flags).sort(), ['capExceeded','denied','expired','uncertain'])
  assert(Object.values(row.flags).every(value => typeof value === 'boolean'))
  return Object.freeze({ ...row, flags: Object.freeze({ ...row.flags }) })
}
export function validateContextualTestPlaywrightReceipt(raw: unknown, binding: ContextualTestRunBinding): void {
  assert(raw && typeof raw === 'object'); const row = raw as Record<string, unknown>
  assert(row.version === 1 && row.projectId === binding.projectId && row.sourceSha === binding.sourceSha && row.sourceTree === binding.sourceTree)
  assert(row.outcome === 'passed' && row.contextsClosed === true && row.firstFailure === null && row.pending === 0 && row.pageErrors === 0)
  assert(row.deadline === binding.deadline && Number.isSafeInteger(row.endedAt) && Number(row.endedAt) >= binding.startedAt && Number(row.endedAt) < binding.deadline)
  const counts = row.counts as Record<string, number>
  assert(counts && counts.tests === 8 && counts.reservations === 2 && counts.uploads === 2)
  assert(Number.isSafeInteger(counts.appRequests) && counts.appRequests >= 0 && counts.appRequests <= 950 && Number.isSafeInteger(counts.storageRequests) && counts.storageRequests >= 0 && counts.storageRequests <= 20)
  const labels = new Set(['ownerTeacher','ownerStudent','memberTeacher','memberStudent'].flatMap(actor => ['desktop','mobile'].flatMap(view => ['light','dark'].map(theme => `${actor}-${view}-${theme}`))))
  assert(Array.isArray(row.artifacts) && row.artifacts.length === 16)
  for (const artifact of row.artifacts as Array<Record<string, unknown>>) {
    assert(typeof artifact.label === 'string' && labels.delete(artifact.label) && artifact.kind === 'png')
    assert(Number.isSafeInteger(artifact.bytes) && Number(artifact.bytes) > 0 && Number(artifact.bytes) <= 4194304 && typeof artifact.sha256 === 'string' && hex.test(artifact.sha256))
  }
  assert(labels.size === 0)
}

/** Bind each fixed receipt label to the actual exclusive private PNG bytes. */
export function verifyContextualTestArtifacts(binding: ContextualTestRunBinding, raw: unknown): void {
  validateContextualTestPlaywrightReceipt(raw, binding)
  const root = directory(binding.outputDir), output = join(binding.outputDir, 'playwright'), parent = directory(output)
  const artifacts = (raw as { artifacts: Array<{ label: string; bytes: number; sha256: string }> }).artifacts
  for (const artifact of artifacts) {
    const file = join(output, `${artifact.label}.png`), before = lstatSync(file)
    assert(before.isFile() && !before.isSymbolicLink())
    const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = fstatSync(fd)
      assert(stat.isFile() && stat.nlink === 1 && stat.uid === parent.uid && (stat.mode & 0o777) === 0o600)
      assert(stat.dev === before.dev && stat.ino === before.ino && stat.size === artifact.bytes && stat.size >= 8 && stat.size <= 4194304)
      // Read only the bounded expected length plus one; a concurrent growth
      // cannot cause an unbounded read even when the earlier stat was small.
      const bytes = Buffer.alloc(stat.size + 1)
      let length = 0
      while (length < bytes.length) {
        const count = readSync(fd, bytes, length, bytes.length - length, null)
        if (count === 0) break
        length += count
      }
      const after = fstatSync(fd), named = lstatSync(file)
      assert(length === stat.size && stat.size === after.size && stat.mtimeMs === after.mtimeMs && stat.ctimeMs === after.ctimeMs)
      assert(named.dev === stat.dev && named.ino === stat.ino && !named.isSymbolicLink())
      const data = bytes.subarray(0, length)
      assert(data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && sha(data) === artifact.sha256)
    } finally { closeSync(fd) }
  }
  const after = directory(output), rootAfter = directory(binding.outputDir)
  assert(parent.dev === after.dev && parent.ino === after.ino && root.dev === rootAfter.dev && root.ino === rootAfter.ino)
}

/** The only top-level composition. It launches nothing unless explicitly called
 * with real reviewed native controls. CPU seams cannot establish native success. */
export async function runContextualTestRehearsalController(admission: ContextualTestControllerAdmission, controls: ContextualTestControllerControls,
  edges: ContextualTestControllerEdges = defaults): Promise<Receipt> {
  // Keep the admitted target and original clocks stable across async callbacks.
  // Nested source/fixture inventories retain their existing reviewed identities.
  admission = immutableContextualTestData(admission)
  let stage: Stage = 'preflight', firstFailureStage: Stage | null = null, attempted = false, lifecycleStarted = false
  let ownedSettled = false, lifecycleCompleted = false, playwrightValidated = false, failure = false
  let binding: ContextualTestRunBinding | undefined, ledger: { snapshot(): unknown; reserveAppReadiness(): void } | undefined, server: LedgerState | null = null
  let startup: FullStartupReport | null = null
  let setupDiagnostic: ContextualTestSetupDiagnostic | null = null
  let cleanupEnd: number | undefined, cleanupStartedAt: number | null = null
  const cleanup: { -readonly [K in keyof CleanupReceipt]: CleanupReceipt[K] } = {
    entry: 'not-run', executionSettlement: 'not-run', commandJoins: 'not-run', commandClosure: 'not-run',
    sqlClosure: 'not-run', unchanged: 'not-run', executionFailures: [],
  }
  const cleanupClock = () => {
    if (cleanupEnd === undefined) { cleanupStartedAt = controls.now(); cleanupEnd = Math.min(admission.cleanupDeadline, cleanupStartedAt + 360000) }
    return cleanupEnd
  }
  const failed = () => { failure = true; firstFailureStage ??= stage }
  const workCheck = () => assert(controls.now() < admission.deadline)
  const settle = async () => {
    const previous = stage; stage = 'cleanup'
    try {
      const end = cleanupClock(), failures: Error[] = []
      try { controls.command.beginCleanup(end); cleanup.entry = 'passed' } catch { cleanup.entry = 'failed'; failures.push(fixedError()) }
      const results = await Promise.allSettled([Promise.resolve().then(() => controls.settleAll(end)), Promise.resolve().then(() => controls.command.joinSettlements?.())])
      cleanup.executionSettlement = results[0].status === 'fulfilled' ? 'passed' : 'failed'
      if (results[0].status === 'rejected') cleanup.executionFailures = projectExecutionCleanupStages(results[0].reason)
      cleanup.commandJoins = results[1].status === 'fulfilled' ? 'passed' : 'failed'
      for (const result of results) if (result.status === 'rejected') failures.push(fixedError())
      try { controls.command.assertClosed(); cleanup.commandClosure = 'passed' } catch { cleanup.commandClosure = 'failed'; failures.push(fixedError()) }
      if (binding) try { edges.assertSqlSettled(binding); cleanup.sqlClosure = 'passed' } catch { cleanup.sqlClosure = 'failed'; failures.push(fixedError()) }
      if (failures.length) throw new AggregateError(failures, 'Private contextual Test cleanup failed')
      try { await controls.assertUnchanged(); cleanup.unchanged = 'passed' } catch { cleanup.unchanged = 'failed'; throw fixedError() }
      ownedSettled = true
    } catch { failed(); throw fixedError() }
    finally { stage = previous }
  }
  try {
    const plan = validateAdmission(admission, controls.now())
    await controls.assertReady(admission); workCheck()
    stage = 'attempt'; edges.openEvidence(admission); attempted = true
    const adapters = edges.createAdapters(admission.assignmentMetadata, { nativeCommand: controls.command.run })
    stage = 'lifecycle'; lifecycleStarted = true
    await edges.lifecycle(admission, admission.migrations, adapters, async (target, resources, rawStatus) => {
      try {
      workCheck(); const status = validateContextualTestDemoStatus(rawStatus, admission.projectId)
      assert.equal(status.API_URL, target.API_URL); assert.equal(status.SERVICE_ROLE_KEY, target.SERVICE_ROLE_KEY); assert.equal(status.DB_URL, target.DB_URL)
      const db = resources.find(resource => resource.kind === 'container' && resource.name === `supabase_db_${admission.projectId}`); assert(db)
      assert.deepEqual(db.ports, [54332]); for (const label of ['com.supabase.cli.project','com.docker.compose.project']) assert.equal(db.labels[label], admission.projectId)
      stage = 'snapshot'; edges.prepareApp(admission.frozen, admission, admission.dependencies.root, admission.dependencies.roots, Math.min(admission.deadline, controls.now() + 30000))
      stage = 'binding'
      const candidate = validateContextualTestRunBinding({ version: 1, projectId: plan.projectId, appOrigin: plan.appOrigin, apiOrigin: plan.apiOrigin,
        sourceSha: plan.sourceSha, sourceTree: plan.sourceTree, migrationChainSha256: plan.migrationChainSha256, planSha256: sha(JSON.stringify(plan)),
        nonce: admission.nonce, startedAt: admission.startedAt, deadline: admission.deadline, cleanupDeadline: admission.cleanupDeadline, password: admission.password,
        workdir: admission.workdir, appDir: admission.appDir, outputDir: admission.outputDir, dependencyManifestSha256: admission.dependencies.sha256,
        ...(controls.sqlControl ? { sqlControl: controls.sqlControl } : {}),
        docker: { path: admission.transportPins.docker.path, sha256: admission.transportPins.docker.sha256, host: admission.transportPins.dockerHost,
          socketIdentity: admission.transportPins.socketIdentity, containerId: db.id } }, controls.now())
      const file = edges.bind(candidate); binding = file.binding; assert.deepEqual(binding, candidate)
      stage = 'fixture'; const passwordHash = await edges.passwordHash(admission.password); workCheck()
      await edges.sql(binding, 'bootstrap', passwordHash, controls.command)
      const verify = async () => {
        const checked = await adapters.verifyEphemeral({ projectId: plan.projectId, dbPort: 54332, applicationName: `${plan.projectId}_fixture`, target })
        assert(checked.containerId === db.id && checked.guard168Enabled && checked.persistedGatesOff && checked.activeNetworkCronAbsent); workCheck()
      }
      await verify()
      stage = 'ledger'; ledger = edges.createLedger(binding)
      const commands = contextualTestLaunchCommands(admission.runner.repository, admission.dependencies.root, binding)
      const profile = contextualTestReadOnlyDependencyProfile(admission.dependencies.roots)
      stage = 'app-ready'
      const app = await controls.launchApp({ binding, args: commands.app, cwd: binding.appDir,
        env: contextualTestAppEnvironment(binding, status, admission.sessionSecret, join(admission.runner.repository, 'scripts/contextual-test-rehearsal-egress.cjs'), file.file, file.sha256), dependencySandboxProfile: profile })
      ledger.reserveAppReadiness()
      await app.ready(); workCheck()
      stage = 'browser'
      const browser = await controls.launchPlaywright({ binding, args: commands.runner, cwd: admission.runner.repository,
        env: contextualTestRunnerEnvironment(binding, file.file, file.sha256), dependencySandboxProfile: profile })
      const outcome = await browser.wait(); assert(outcome.closed && outcome.code === 0 && outcome.signal === null); workCheck()
      stage = 'proof'; const receipt = edges.readPlaywrightReceipt(binding)
      validateContextualTestPlaywrightReceipt(receipt, binding); edges.verifyArtifacts(binding, receipt); playwrightValidated = true
      await verify()
      } catch { failed(); throw fixedError() }
    }, settle, cleanupClock)
    lifecycleCompleted = true; await controls.command.joinSettlements?.(); controls.command.assertClosed()
    assert(ownedSettled && binding && ledger && playwrightValidated)
    stage = 'complete'
  } catch (error) {
    failed()
    // Only the actual lifecycle's private producer can supply these fixed
    // labels. No exception property is evaluated or copied into the receipt.
    setupDiagnostic = contextualTestSetupDiagnostic(error)
  }
  finally {
    if (attempted && !lifecycleStarted) { try { await settle() } catch { failed() } }
    if (attempted) {
      if (ownedSettled && binding && edges.readStartupReport) {
        // Diagnostic only: preserve original work/cleanup failure and acceptance
        // gates. Never read artifacts before proven settlement, retain raw
        // exceptions, or promote a failed run from a reporter's success status.
        try { startup = immutableContextualTestData(validateFullStartupReport(edges.readStartupReport(binding), binding)) }
        catch { startup = null }
      }
      if (ownedSettled && binding && ledger) {
        // Record the bounded fixed-schema terminal counters even for failed
        // cases. Observations never promote failure to pass or justify closure.
        try {
          server = projectLedger(ledger.snapshot(), binding)
          if (Object.values(server.flags).some(Boolean)) { if (!failure) stage = 'proof'; failed() }
        } catch { if (!failure) stage = 'proof'; failed() }
      }
      const plan = createContextualTestPlan(admission.projectId)
      let nativeDiagnostics: ContextualTestNativeDiagnostics | null = null
      try { if (controls.nativeDiagnostics) nativeDiagnostics = projectNativeDiagnostics(controls.nativeDiagnostics()) } catch { /* Never retain raw reporting failures. */ }
      const receipt: Receipt = Object.freeze({ version: 1, projectId: plan.projectId, sourceSha: plan.sourceSha, sourceTree: plan.sourceTree,
        runnerHead: admission.runner.head, runnerTree: admission.runner.tree, reviewedManifestSha256: admission.review.manifestSha256,
        startedAt: admission.startedAt, deadline: admission.deadline, cleanupDeadline: admission.cleanupDeadline, endedAt: controls.now(),
        cleanupStartedAt, cleanupEnd: cleanupEnd ?? null,
        cleanup: Object.freeze({ ...cleanup, executionFailures: Object.freeze([...cleanup.executionFailures]) }),
        outcome: !failure && ownedSettled && lifecycleCompleted && playwrightValidated && server !== null ? 'passed' : 'failed', firstFailureStage,
        lifecycleCompleted, ownedSettled, playwrightValidated, server, startup, nativeDiagnostics, setupDiagnostic })
      try { edges.writeReceipt(receipt, admission) } catch { failure = true }
      if (!failure && receipt.outcome === 'passed') return receipt
    }
  }
  throw fixedError()
}
