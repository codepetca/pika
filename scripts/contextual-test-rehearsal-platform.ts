/** Import-safe source-only primitives. No entrypoint, admission, native probe or
 * process is run by importing this module. The coordinator owns native admission.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createContextualTestPlan } from '../e2e/helpers/contextual-test-rehearsal'
import { assignmentListEphemeralPlan, assignmentListExpectedResources, validateAssignmentListMigrationChain, type AssignmentListLifecycleAdapters, type AssignmentListResource } from './contextual-assignment-list-proof-lifecycle'
import { loadAssignmentListReviewedMigrations, prepareAssignmentListProjectFiles } from './contextual-assignment-list-proof-platform'
import { assignmentListProofWorkdir } from './contextual-assignment-list-proof-path'
import { validateAssignmentListProofTarget } from './check-contextual-assignment-list-reads'

import type { ContextualTestRunBinding } from './contextual-test-rehearsal-binding'
export { validateContextualTestRunBinding, readContextualTestBinding, contextualTestSql, assertContextualTestSqlSettled, executeContextualTestSql } from './contextual-test-rehearsal-binding'
export type { ContextualTestRunBinding, ContextualTestSqlKind, ContextualTestSqlTransport } from './contextual-test-rehearsal-binding'

const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')

/** Exact scope binding selects only its frozen source chain, never runner SQL. */
export function contextualTestProjectPreparation(binding: ContextualTestRunBinding, frozenRepository: string) {
  const migrations = loadAssignmentListReviewedMigrations(frozenRepository)
  assert.equal(migrations.length, binding.proofScope === 'vertical-grade-return-v1' ? 267 : 262)
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
export type ContextualTestDisposableInput = Pick<ContextualTestRunBinding, 'projectId' | 'workdir' | 'startedAt' | 'deadline' | 'cleanupDeadline' | 'migrationChainSha256' | 'proofScope'>
export type ContextualTestLocalStatus = Readonly<ReturnType<typeof validateAssignmentListProofTarget> & { ANON_KEY: string }>
type SetupStep = 'canonical-before' | 'inventory' | 'prepare' | 'pre-start' | 'start' | 'capture' | 'status' | 'verify-ephemeral' | 'work'
type CleanupStep = 'cleanup-clock' | 'owned-processes' | 'cleanup-inventory' | 'cleanup-closure' | 'resource-teardown' | 'resource-absence' | 'workdir-remove' | 'canonical-after'
export type ContextualTestSetupDiagnostic = Readonly<{ firstFailure: SetupStep | null; lastCompleted: SetupStep | null; cleanupFailures: readonly CleanupStep[] }>
// Only this producer can associate fixed labels with the actual thrown error.
// Weak keys retain neither raw exception properties nor unrelated failures.
const setupDiagnostics = new WeakMap<object, ContextualTestSetupDiagnostic>()
export function contextualTestSetupDiagnostic(error: unknown): ContextualTestSetupDiagnostic | null {
  return error !== null && typeof error === 'object' ? setupDiagnostics.get(error) ?? null : null
}
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
  work: (target: ReturnType<typeof validateAssignmentListProofTarget>, resources: readonly AssignmentListResource[], status: ContextualTestLocalStatus) => Promise<void>, settleOwnedProcesses: () => Promise<void>, cleanupClock?: () => number) {
  const plan = createContextualTestPlan(binding.projectId, binding.proofScope)
  const identity = assignmentListEphemeralPlan(binding)
  assert.equal(binding.workdir, assignmentListProofWorkdir(binding.projectId))
  assert.equal(binding.migrationChainSha256, plan.migrationChainSha256)
  assert(Number.isSafeInteger(binding.startedAt) && binding.startedAt <= Date.now())
  assert(Number.isSafeInteger(binding.deadline) && binding.deadline > binding.startedAt && binding.deadline - binding.startedAt <= 45 * 60_000)
  assert(Number.isSafeInteger(binding.cleanupDeadline) && binding.cleanupDeadline > binding.deadline && binding.cleanupDeadline - binding.deadline <= 6 * 60_000)
  assert.equal(migrations.length, binding.proofScope === 'vertical-grade-return-v1' ? 267 : 262)
  validateAssignmentListMigrationChain(migrations)
  assert.equal(sha(JSON.stringify(migrations.map(({ name, sha256 }) => ({ name, sha256 })))), binding.migrationChainSha256)
  let cleanupEnd: number | undefined
  const check = (cleanup = false) => assert(Date.now() < (cleanup ? cleanupEnd ?? 0 : binding.deadline))
  const canonicalRequest = { projectId: 'pika' as const, dbPort: 54322 as const, applicationName: `${binding.projectId}_canonical_readonly`, readOnly: true as const }
  let baseline: Awaited<ReturnType<DisposableAdapters['canonicalSnapshot']>> | undefined
  let before: Awaited<ReturnType<DisposableAdapters['inventory']>> | undefined
  let prepared: Awaited<ReturnType<DisposableAdapters['prepare']>> | undefined
  let attempted = false, primary: unknown, captured: AssignmentListResource[] | undefined
  let step: SetupStep = 'canonical-before', lastCompleted: SetupStep | null = null, firstFailure: SetupStep | null = null
  const next = (value: SetupStep) => { lastCompleted = step; step = value }
  let cleanupStep: CleanupStep = 'cleanup-clock'
  const cleanupFailures: CleanupStep[] = []
  const cleanupErrors: unknown[] = []
  const clean = async (at: CleanupStep, fn: () => Promise<void>) => {
    cleanupStep = at
    try { check(true); await fn(); check(true) } catch (error) { cleanupErrors.push(error); cleanupFailures.push(cleanupStep) }
  }
  try {
    check(); baseline = structuredClone(await adapters.canonicalSnapshot(canonicalRequest))
    for (const key of ['rowDigests','guard168Metadata','settings','cronJobs','resources'] as const) assert(typeof baseline[key] === 'string' && baseline[key].length > 0)
    next('inventory')
    check(); before = structuredClone(await adapters.inventory(identity))
    assert(!before.workdirExists && !before.occupiedPorts.some(p => [54331,54332,54340,3117].includes(p)))
    assert(!before.resources.some(r => projectResource(r, binding.projectId)))
    next('prepare')
    check(); prepared = await adapters.prepare(assignmentListEphemeralPlan(binding), migrations)
    assert(prepared.created && prepared.realpath === binding.workdir && prepared.workdir === binding.workdir)
    assert.equal(prepared.configSha256, sha(assignmentListEphemeralPlan(binding).config))
    assert.deepEqual(prepared.migrations, migrations.map(({ name, sha256 }) => ({ name, sha256 })))
    assert.deepEqual(prepared.envFiles, []); assert.deepEqual(prepared.symlinks, [])
    next('pre-start')
    check(); const fresh = await adapters.inventory(identity)
    assert(!fresh.occupiedPorts.some(p => [54331,54332,54340,3117].includes(p)))
    assert(!fresh.resources.some(r => projectResource(r, binding.projectId))); before.resources = structuredClone(fresh.resources)
    next('start')
    check(); attempted = true
    await adapters.command({ args: ['start','--workdir',binding.workdir,'-x','analytics,edge-runtime,functions,imgproxy,inbucket,meta,realtime,studio,vector'], workdir: binding.workdir, timeoutMs: Math.min(180_000,binding.deadline-Date.now()) })
    next('capture')
    check(); const inventory = await adapters.inventory(identity)
    const selected = validateContextualTestClosure(binding.projectId, before.resources, inventory.resources)
    captured = structuredClone(selected)
    const db = selected.find(r => r.name === `supabase_db_${binding.projectId}`)!
    assert.deepEqual(db.ports, [54332])
    assert.deepEqual(selected.find(r => r.name === `supabase_kong_${binding.projectId}`)!.ports, [54331])
    next('status')
    check(); const status = localStatus(await adapters.command({ args: ['status','--workdir',binding.workdir,'-o','json'], workdir: binding.workdir, timeoutMs: 15000 }), binding.projectId)
    const target = validateAssignmentListProofTarget(status, binding.projectId)
    next('verify-ephemeral')
    const session = await adapters.verifyEphemeral({ projectId: binding.projectId, dbPort: 54332, applicationName: `${binding.projectId}_fixture`, target })
    assert.equal(session.projectId, binding.projectId); assert.equal(session.dbPort, 54332); assert.equal(session.applicationName, `${binding.projectId}_fixture`)
    assert.equal(session.containerId, db.id); assert(session.guard168Enabled && session.persistedGatesOff && session.activeNetworkCronAbsent)
    next('work')
    check(); await work(target, Object.freeze(selected.map(r => Object.freeze(structuredClone(r)))), status); check()
    lastCompleted = step
  } catch (error) { primary = error; firstFailure = step }
  finally {
    try {
      const now = Date.now(), candidate = cleanupClock?.() ?? Math.min(binding.cleanupDeadline, now + 360000)
      assert(Number.isSafeInteger(candidate) && candidate > now && candidate <= binding.cleanupDeadline && candidate <= now + 360000)
      cleanupEnd = candidate
    } catch (error) { cleanupErrors.push(error); cleanupFailures.push('cleanup-clock') }
    let settled = false, absent = !attempted
    await clean('owned-processes', async () => { await settleOwnedProcesses(); settled = true })
    if (attempted && before && settled) await clean('cleanup-inventory', async () => {
      const current = await adapters.inventory(identity)
      cleanupStep = 'cleanup-closure'
      const resources = validateContextualTestClosure(binding.projectId, before!.resources, current.resources, false)
      if (captured) assert.deepEqual(resources, captured, 'Captured resource identity or closure drift')
      cleanupStep = 'resource-teardown'
      await adapters.teardown({ projectId: binding.projectId, workdir: binding.workdir, resources, stopArgs: null })
      cleanupStep = 'resource-absence'
      const after = await adapters.inventory(identity)
      assert(!after.resources.some(r => projectResource(r, binding.projectId))); absent = true
    })
    if (prepared && absent && settled) await clean('workdir-remove', () => adapters.removeWorkdir({ projectId: binding.projectId, workdir: binding.workdir, realpath: prepared!.realpath }))
    if (baseline) await clean('canonical-after', async () => assert.deepEqual(await adapters.canonicalSnapshot(canonicalRequest), baseline))
  }
  if (primary || cleanupErrors.length) {
    const error = new AggregateError([...(primary ? [primary] : []), ...cleanupErrors], 'Private Tests lifecycle failed; retain bounded private evidence')
    setupDiagnostics.set(error, Object.freeze({ firstFailure, lastCompleted, cleanupFailures: Object.freeze([...cleanupFailures]) }))
    throw error
  }
}
