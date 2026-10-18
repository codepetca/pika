/** Native adapters for the separately reviewed disposable assignment-list proof.
 * Importing this module performs no commands. Credentials, SQL rows and command
 * stderr remain private. Never call this against an existing fixture project.
 */
import assert from 'node:assert/strict'
import { execFile, type ExecFileException } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, normalize } from 'node:path'
import { createServer } from 'node:net'
import { createClient } from '@supabase/supabase-js'
import { ApiError } from '../src/lib/api-error'
import { readContextualAssignmentList } from '../src/lib/server/contextual-assignment-list-read'
import { containedAssignmentListProofFetch } from './check-contextual-assignment-list-reads'
import { observeAssignmentListRevocation, assignmentListRevocationPlans } from './contextual-assignment-list-proof-revocations'
import { validateAssignmentListEphemeralIdentity, validateAssignmentListMigrationChain } from './contextual-assignment-list-proof-lifecycle'
import { assignmentListProofWorkdir } from './contextual-assignment-list-proof-path'
import type { AssignmentListLifecycleAdapters, AssignmentListResource } from './contextual-assignment-list-proof-lifecycle'
import type { AssignmentListProofFixture } from './contextual-assignment-list-proof-fixture'
import type { Database } from '../src/types/database'

const sha = (value: string) => createHash('sha256').update(value).digest('hex')
type Rows = Record<string, Array<Record<string, unknown>>>
type Cell = { schema: 'public' | 'private'; table: string; id: string; columns: string[] }
type Plan = ReturnType<typeof assignmentListRevocationPlans>[number]
const identity = (row: Record<string, unknown>, table: string) => String(row.id ?? row.generation_id ?? row.user_id ?? (table === 'public.classroom_archive_revisions' ? row.classroom_id : undefined) ?? JSON.stringify(row))
/** Callers must also prove cleanup gates OFF, no grading work and no Vault secrets.
 * The two installed SQL watchdogs then cannot issue network callbacks. */
export function assignmentListSafeCronJobs(jobs: Array<Record<string, unknown>>): boolean {
  const allowed = new Map([
    ['pika-removed-student-cleanup-watchdog', 'select private.run_removed_student_cleanup_watchdog()'],
    ['pika-test-ai-grading-watchdog', 'select private.watchdog_test_ai_grading_runs()'],
  ])
  return jobs.every(job => job.active === false || (job.active === true && typeof job.jobname === 'string' && typeof job.command === 'string' && allowed.get(job.jobname) === job.command.trim()))
}
export function assignmentListRowChanges(before: Rows, after: Rows): Cell[] {
  const changes: Cell[] = []
  for (const name of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    const [schema, table] = name.split('.'); assert(schema && table)
    const previous = new Map((before[name] ?? []).map(row => [identity(row, name), row]))
    const current = new Map((after[name] ?? []).map(row => [identity(row, name), row]))
    assert.equal(previous.size, (before[name] ?? []).length); assert.equal(current.size, (after[name] ?? []).length)
    for (const id of [...new Set([...previous.keys(), ...current.keys()])].sort()) {
      const a = previous.get(id); const b = current.get(id)
      const columns = !a || !b ? ['__row__'] : [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().filter(key => JSON.stringify(a[key]) !== JSON.stringify(b[key]))
      if (columns.length) { assert(schema === 'public' || schema === 'private'); changes.push({ schema, table, id, columns }) }
    }
  }
  return changes
}
export function assignmentListExpectedResources(projectId: string) {
  validateAssignmentListEphemeralIdentity({ projectId, workdir: assignmentListProofWorkdir(projectId) })
  return [
    ...['db', 'storage', 'rest', 'auth', 'kong'].map(service => ({ kind: 'container' as const, name: `supabase_${service}_${projectId}` })),
    ...['db', 'storage'].map(service => ({ kind: 'volume' as const, name: `supabase_${service}_${projectId}` })),
    { kind: 'network' as const, name: `supabase_network_${projectId}` },
  ]
}
export function assignmentListRestorationPolicy(fixture: AssignmentListProofFixture, plan: Plan) {
  const allowedCells: Cell[] = [
    { schema: 'public', table: 'classrooms', id: plan.classroomId, columns: ['blueprint_source_revision', 'updated_at'] },
    { schema: 'public', table: 'classroom_archive_revisions', id: plan.classroomId, columns: ['revision', 'updated_at'] },
  ]
  if (plan.transition === 'member-remove') {
    const removals = assignmentListRevocationPlans(fixture).filter(p => p.transition === 'member-remove')
    const n = removals.findIndex(p => p.boundary === plan.boundary)
    const old = n === 0 ? fixture.enrollments.find(e => e.classroom === plan.classroomId && e.student === plan.actorId)!.id : fixture.replacementEnrollments[n - 1].id
    const replacement = fixture.replacementEnrollments[n].id
    allowedCells.push({ schema: 'public', table: 'classroom_enrollments', id: old, columns: ['__row__'] },
      { schema: 'public', table: 'classroom_enrollments', id: replacement, columns: ['__row__'] },
      { schema: 'private', table: 'pal_membership_generations', id: old, columns: ['state'] },
      { schema: 'private', table: 'pal_membership_generations', id: replacement, columns: ['__row__'] })
  }
  if (plan.transition === 'grade-withdraw' || plan.transition === 'feedback-withdraw') allowedCells.push({ schema: 'public', table: 'assignment_docs', id: fixture.docs.find(d => d.returned)!.id, columns: ['updated_at'] })
  return { transition: plan.transition, boundary: plan.boundary, allowedCells }
}

type StartupEvidence = { code: unknown; killed: boolean; stdout: string; stderr: string }
const startupDiagnostics = new WeakMap<object, string>()
const startupCodes = new Set(['ENOENT', 'EACCES', 'EPERM', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'])
// Fixed observed literals, not exclusive causes. CLI v2.103.0 utils/docker.go,
// pkg/config/config.go, pkg/migration/file.go and internal/status/status.go;
// Docker client errors and OS error messages supply the other fixed markers.
const startupMarkers = [
  ['disk-full', ['no space left on device']],
  ['port-conflict', ['address already in use', 'failed: port is already allocated']],
  ['docker-unavailable', ['Cannot connect to the Docker daemon']],
  ['image-pull', ['failed to pull docker image:']],
  ['config-invalid', ['failed to parse config:', 'failed to merge file config:', 'Missing required field in config:']],
  ['migration-file', ['failed to open migration file:']],
  ['health-check', ['container is not ready:', 'container is not running:']],
] as const

function startupDiagnostic(evidence?: StartupEvidence) {
  const code = evidence?.code
  const exit = typeof code === 'number' && Number.isInteger(code) && code >= 0 && code <= 255 ? code : 'unknown'
  const command = typeof code === 'string' && startupCodes.has(code) ? code : exit !== 'unknown' ? 'exit' : 'unknown'
  const killed = evidence?.killed === true ? 'true' : evidence?.killed === false ? 'false' : 'unknown'
  const tails = [evidence?.stdout, evidence?.stderr].map(value => typeof value === 'string' ? boundedStartupTail(value) : '')
  const markers = startupMarkers.filter(([, literals]) => literals.some(literal => tails.some(tail => tail.includes(literal)))).map(([label]) => label)
  return `DIAG isolated assignment startup command=${command} exit=${exit} killed=${killed} observed-markers=${markers.join(',') || 'none'}.\n`
}
export class AssignmentListStartupError extends Error {
  constructor(public readonly diagnosticPath: string, evidence?: StartupEvidence) {
    super('Private isolated startup failure'); this.name = 'AssignmentListStartupError'
    // Retain only the closed line in memory; raw tails stay in the private receipt.
    startupDiagnostics.set(this, startupDiagnostic(evidence))
  }
}
/** Never read public error properties or serialize the private receipt/path. */
export function assignmentListStartupDiagnostic(error: unknown) {
  return error !== null && typeof error === 'object' ? startupDiagnostics.get(error) ?? startupDiagnostic() : startupDiagnostic()
}
function boundedStartupTail(value: string) {
  const bytes = Buffer.from(value, 'utf8')
  let start = Math.max(0, bytes.length - 16384)
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++
  return bytes.subarray(start).toString('utf8')
}
/** Startup-only output never includes canonical snapshot rows; do not print it. */
export function writeAssignmentListStartupDiagnostic(projectId: string, evidence: StartupEvidence, originalCloseDeadline?: number) {
  const path = `${assignmentListProofWorkdir(projectId)}-startup.json`
  assert.equal(realpathSync(dirname(path)), dirname(path))
  const receipt = { stage: 'start', code: typeof evidence.code === 'string' || typeof evidence.code === 'number' ? evidence.code : null,
    killed: evidence.killed, stdout: boundedStartupTail(evidence.stdout), stderr: boundedStartupTail(evidence.stderr) }
  if (originalCloseDeadline !== undefined) assert(Number.isSafeInteger(originalCloseDeadline) && Date.now() < originalCloseDeadline)
  writeFileSync(path, JSON.stringify(receipt), { mode: 0o600, flag: 'wx' })
  return path
}
async function command(file: string, args: string[], options: { input?: string; timeout?: number; startupProjectId?: string; env?: NodeJS.ProcessEnv;
  survey?: { nativeCli: Survey263NativeCli; dispatchDeadline: number; closeDeadline: number; componentExchange?: Survey269ComponentExchange; cleanup?: boolean } } = {}): Promise<string> {
  if (options.startupProjectId) {
    assert.equal(file, 'supabase'); assert.equal(args[0], 'start'); assignmentListProofWorkdir(options.startupProjectId)
  }
  if (options.survey) {
    const executable = file === 'supabase' ? verifySurvey263NativeCli(options.survey.nativeCli).path : file
    const timeout = Math.min(options.timeout ?? 20000, options.survey.dispatchDeadline - Date.now())
    assert(timeout > 0, 'Survey original dispatch deadline expired')
    const closeDeadline = options.survey.closeDeadline
    assert(Date.now() < closeDeadline)
    return new Promise((resolve, reject) => {
      let outcome: { error: ExecFileException | null; stdout: string; stderr: string } | undefined, inputFailed = false, unjoined = false, accountingFailed = false
      if (options.survey!.componentExchange) chargeSurvey269ComponentExchange(options.survey!.componentExchange, Buffer.byteLength(options.input ?? ''), options.survey!.cleanup)
      if (options.survey!.componentExchange) chargeSurvey269ComponentControl(options.survey!.componentExchange, options.survey!.cleanup)
      const child = execFile(executable, args, { timeout, killSignal: 'SIGKILL',
        maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', ...(options.env ? { env: options.env } : {}) },
      (error, stdout, stderr) => {
        outcome = { error, stdout, stderr }
        try { if (options.survey!.componentExchange) chargeSurvey269ComponentExchange(options.survey!.componentExchange, Buffer.byteLength(stdout) + Buffer.byteLength(stderr), options.survey!.cleanup) } catch { accountingFailed = true }
      })
      const timer = setTimeout(() => {
        unjoined = true
        try { child.kill('SIGKILL') } catch { /* Signal delivery is not positive closure. */ }
        reject(new Survey263UnjoinedChildError())
      }, closeDeadline - Date.now())
      child.once('close', () => {
        clearTimeout(timer)
        if (unjoined || Date.now() >= closeDeadline) { reject(new Survey263UnjoinedChildError()); return }
        if (!outcome) { reject(new Error('Private Survey platform child rejected')); return }
        if (accountingFailed) { reject(new Error('Survey269 cumulative exchange limit exceeded')); return }
        if (outcome.error || inputFailed) {
          try {
            if (options.startupProjectId) {
              // Callback facts remain private. Never persist before actual close,
              // after an unjoined timebox, or outside its original close reserve.
              const evidence = { code: outcome.error?.code, killed: outcome.error?.killed === true,
                stdout: outcome.stdout, stderr: outcome.stderr }
              reject(new AssignmentListStartupError(writeAssignmentListStartupDiagnostic(options.startupProjectId, evidence, closeDeadline), evidence)); return
            }
          } catch { reject(new Error('Private startup diagnostic failed')); return }
          reject(new Error('Private Survey platform child rejected')); return
        }
        resolve(outcome.stdout.trim())
      })
      child.stdin?.on('error', () => { inputFailed = true; child.kill('SIGKILL') })
      child.stdin?.end(options.input)
    })
  }
  return new Promise((resolve, reject) => {
    const child = execFile(file, args, { timeout: options.timeout ?? 20000, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8', ...(options.env ? { env: options.env } : {}) }, (error, stdout, stderr) => {
      if (error) {
        try {
          if (options.startupProjectId) {
            const evidence = { code: error.code, killed: error.killed === true, stdout, stderr }
            return reject(new AssignmentListStartupError(writeAssignmentListStartupDiagnostic(options.startupProjectId, evidence), evidence))
          }
        } catch { return reject(new Error('Private startup diagnostic failed')) }
        reject(new Error('Private platform command failed'))
      } else resolve(stdout.trim())
    })
    child.stdin?.on('error', () => reject(new Error('Private platform input failed')))
    child.stdin?.end(options.input)
  })
}

/** Survey263 only: root accepts this exact observed local endpoint before the
 * existing lifecycle. Data-only binding; no command/executor injection. Never
 * assign DOCKER_HOST to process.env (the existing native engine forbids it). */
type Survey263Endpoint = Readonly<{ kind: 'survey263'; host: string; identity: readonly [number, number, number, number] }>
export type Survey269ComponentExchange = Readonly<{ kind: 'survey269-component-exchange' }>
const componentExchanges = new WeakMap<Survey269ComponentExchange, {
  bytes: number; controls: number; profile: 'component' | 'remaining'; requests: number;
  workDeadline: number; cleaning: boolean;
}>()
function newComponentExchange(profile: 'component' | 'remaining', budget: Survey263Budget): Survey269ComponentExchange {
  const token = Object.freeze({ kind: 'survey269-component-exchange' as const })
  componentExchanges.set(token, { bytes: 0, controls: 0, profile, requests: 0, workDeadline: budget.workDeadline, cleaning: false })
  return token
}
// User-approved cumulative allowance for this closed remaining profile only.
const survey269ExchangeByteLimit = (profile: 'component' | 'remaining') => (profile === 'remaining' ? 128 : 64) * 1024 * 1024
export function survey269ComponentExchangeReceipt(token: Survey269ComponentExchange) {
  const ledger = componentExchanges.get(token); assert(ledger, 'Unbound Survey269 exchange ledger')
  return Object.freeze({ bytes: ledger.bytes, limit: survey269ExchangeByteLimit(ledger.profile), controls: ledger.controls, controlLimit: ledger.profile === 'remaining' ? 6000 : 4000,
    ...(ledger.profile === 'remaining' ? { requests: ledger.requests, requestLimit: 16 } : {}),
    channels: ['platform-command-stdin-stdout-stderr', 'engine-command-stdin-stdout-stderr', 'engine-session-stdin-stdout-stderr', 'sdk-request-response-bodies'] as const })
}
export function assertSurvey269RemainingExchange(token: Survey269ComponentExchange): void {
  assert.equal(componentExchanges.get(token)?.profile, 'remaining', 'Survey269 remaining requires its own exchange ledger')
}
/** Count at original HTTP dispatch, never at receipt decoding or a retry. */
export function chargeSurvey269RemainingRequest(token: Survey269ComponentExchange): number {
  assertSurvey269RemainingExchange(token)
  const ledger = componentExchanges.get(token)!
  assert(!ledger.cleaning && Date.now() < ledger.workDeadline, 'Survey269 remaining request deadline expired')
  assert(ledger.bytes <= survey269ExchangeByteLimit(ledger.profile), 'Survey269 cumulative exchange limit exceeded')
  ledger.requests++
  assert(ledger.requests <= 16, 'Survey269 remaining request limit exceeded')
  return ledger.requests
}
// 169 outer cleanup/preservation children + 48 owned-session/probe settlement
// children + the one counted refused work dispatch. No later refusal consumes
// this reserve; cleanup is still accounted and final overflow rejects success.
export const SURVEY269_REMAINING_CLEANUP_CONTROLS = 218
export function chargeSurvey269ComponentControl(token: Survey269ComponentExchange, cleanup = false) {
  const ledger = componentExchanges.get(token); assert(ledger, 'Unbound Survey269 exchange ledger')
  const workLimit = ledger.profile === 'remaining' ? 6000 - SURVEY269_REMAINING_CLEANUP_CONTROLS : 4000 - 32
  if (ledger.profile === 'remaining' && !cleanup) assert(ledger.controls <= workLimit, 'Survey269 control reserve exhausted')
  ledger.controls++
  assert(cleanup || ledger.controls <= workLimit, 'Survey269 control reserve exhausted')
  return ledger.controls
}
export function chargeSurvey269ComponentExchange(token: Survey269ComponentExchange, bytes: number, cleanup = false) {
  const ledger = componentExchanges.get(token); assert(ledger, 'Unbound Survey269 exchange ledger')
  assert(Number.isSafeInteger(bytes) && bytes >= 0 && Number.isSafeInteger(ledger.bytes + bytes))
  ledger.bytes += bytes
  // Cleanup remains authorized after overflow, but final acceptance never is.
  assert(cleanup || ledger.bytes <= survey269ExchangeByteLimit(ledger.profile), 'Survey269 cumulative exchange limit exceeded')
  return ledger.bytes
}
export type Survey263Budget = Readonly<{ startedAt: number; workDeadline: number; cleanupDeadline: number }>
export type Survey263NativeCli = Readonly<{ path: string; sha256: string }>
export const SURVEY263_NATIVE_CLI = Object.freeze({
  path: '/opt/homebrew/Cellar/supabase/2.109.1/libexec/lib/node_modules/supabase/node_modules/@supabase/cli-darwin-arm64/bin/supabase',
  sha256: 'b7be23f4e211b75c00a3df5fcd1f96f3905983c74ff3189bfc69ad5b0f7132c4',
})
export class Survey263UnjoinedChildError extends Error { constructor() { super('Private Survey child closure unconfirmed') } }
function surveyData(value: object, keys: string[]) {
  assert(value && Object.getPrototypeOf(value) === Object.prototype)
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort())
  assert(Object.values(Object.getOwnPropertyDescriptors(value)).every(descriptor => 'value' in descriptor))
}
export function verifySurvey263NativeCli(value: Survey263NativeCli) {
  assert(!Object.hasOwn(process.env, 'SUPABASE_CLI_BINARY_OVERRIDE'))
  surveyData(value, ['path', 'sha256'])
  assert.deepEqual(value, SURVEY263_NATIVE_CLI)
  assert.equal(realpathSync(value.path), value.path); assert(statSync(value.path).isFile())
  const bytes = readFileSync(value.path)
  assert(Buffer.isBuffer(bytes) && bytes.subarray(0, 4).equals(Buffer.from([0xcf, 0xfa, 0xed, 0xfe])))
  assert.equal(createHash('sha256').update(bytes).digest('hex'), value.sha256)
  return SURVEY263_NATIVE_CLI
}
export function validateSurvey263Budget(value: Survey263Budget) {
  surveyData(value, ['cleanupDeadline', 'startedAt', 'workDeadline'])
  assert(Object.values(value).every(Number.isSafeInteger))
  assert.equal(value.workDeadline, value.startedAt + 720000); assert.equal(value.cleanupDeadline, value.startedAt + 900000)
  assert(value.startedAt <= Date.now() && Date.now() < value.workDeadline)
  return Object.freeze({ ...value })
}
type Survey263Binding = Survey263Endpoint & Readonly<{ budget: Survey263Budget; nativeCli: Survey263NativeCli; componentExchange?: Survey269ComponentExchange }>
const survey263AdapterEndpoints = new WeakMap<AssignmentListLifecycleAdapters, {
  binding: Survey263Binding; cleanup(): void; poison(): void; checkTotal(): void;
}>()
/** Only an actual fixed-transport adapter admits the Survey lifecycle. A copied
 * object or an ordinary predecessor adapter cannot claim this binding. */
export function requireSurvey263AdapterEndpoint(adapters: AssignmentListLifecycleAdapters) {
  const entry = survey263AdapterEndpoints.get(adapters)
  assert(entry && Object.isFrozen(adapters), 'Survey263 requires the sealed local platform transport')
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(adapters)))
    assert('value' in descriptor && descriptor.writable === false && descriptor.configurable === false)
  return entry.binding
}
export function beginSurvey263AdapterCleanup(adapters: AssignmentListLifecycleAdapters, unjoined = false) {
  requireSurvey263AdapterEndpoint(adapters)
  const entry = survey263AdapterEndpoints.get(adapters)!
  if (unjoined) entry.poison()
  entry.cleanup()
}
export function checkSurvey263AdapterTotal(adapters: AssignmentListLifecycleAdapters) {
  const binding = requireSurvey263AdapterEndpoint(adapters); survey263AdapterEndpoints.get(adapters)!.checkTotal()
  if (binding.componentExchange) {
    const receipt = survey269ComponentExchangeReceipt(binding.componentExchange)
    assert(receipt.bytes <= receipt.limit, 'Survey269 cumulative exchange limit exceeded')
    assert(receipt.controls <= receipt.controlLimit, 'Survey269 control limit exceeded')
    if (receipt.requests !== undefined) assert(receipt.requests <= 16, 'Survey269 remaining request limit exceeded')
  }
}
function createSurvey263PlatformTransport(binding: Survey263Endpoint, originalBudget: Survey263Budget, nativeCli: Survey263NativeCli, profile?: 'component' | 'remaining') {
  surveyData(binding, ['host', 'identity', 'kind'])
  const budget = validateSurvey263Budget(originalBudget)
  nativeCli = verifySurvey263NativeCli(nativeCli)
  let cleaning = false, poisoned = false
  const componentExchange = profile ? newComponentExchange(profile, budget) : undefined
  const checkTotal = () => { assert(!poisoned, 'Survey child closure unconfirmed'); assert(Date.now() < budget.cleanupDeadline, 'Survey total deadline expired') }
  const checkWork = () => {
    checkTotal(); assert(!cleaning && Date.now() < budget.workDeadline, 'Survey work deadline expired')
    if (componentExchange) {
      chargeSurvey269ComponentExchange(componentExchange, 0)
      const receipt = survey269ComponentExchangeReceipt(componentExchange)
      if (receipt.requests !== undefined) assert(receipt.requests <= 16, 'Survey269 remaining request limit exceeded')
    }
  }
  const cutoff = (settling = false) => { checkTotal(); return cleaning || settling ? budget.cleanupDeadline : budget.workDeadline }
  const remaining = (settling = false) => { const time = cutoff(settling) - Date.now(); assert(time > 0, 'Survey original deadline expired'); return time }
  assert.deepEqual(Object.keys(binding).sort(), ['host', 'identity', 'kind'])
  assert.equal(binding.kind, 'survey263')
  const endpoint = Object.freeze({ host: binding.host, identity: Object.freeze([...binding.identity]) })
  assert(endpoint.host.startsWith('unix:///') && !/[\x00-\x20\x7f%?#]/.test(endpoint.host))
  const path = endpoint.host.slice('unix://'.length)
  assert(isAbsolute(path) && normalize(path) === path)
  assert(endpoint.identity.length === 4 && endpoint.identity.every(n => Number.isSafeInteger(n) && n >= 0))
  const verify = () => {
    assert(!Object.keys(process.env).some(name =>
      /^(?:SUPABASE_CLI_BINARY_OVERRIDE|DOCKER_(?:HOST|CONTEXT|CONFIG|API_VERSION|TLS.*|CERT_PATH|CUSTOM_HEADERS)|(?:.*_)?PROXY)$/i.test(name)))
    assert.equal(realpathSync(path), path)
    const socket = statSync(path); assert(socket.isSocket())
    assert.deepEqual([socket.dev, socket.ino, socket.mode, socket.rdev], endpoint.identity)
  }
  verify() // pin the accepted socket synchronously at adapter creation
  const observe = async (settling = false) => {
    verify()
    const raw = JSON.parse(await command('docker', ['context', 'inspect', '--format',
      '{"endpoints":{{json .Endpoints}},"tlsMaterial":{{json .TLSMaterial}}}'], {
      timeout: Math.min(20000, remaining(settling)), survey: { nativeCli, dispatchDeadline: cutoff(settling), closeDeadline: Math.min(budget.cleanupDeadline, Date.now() + remaining(settling) + 12000), componentExchange, cleanup: cleaning },
    }).catch(error => { if (error instanceof Survey263UnjoinedChildError) poisoned = true; throw error }))
    assert(raw && raw.endpoints && Object.keys(raw.endpoints).join(',') === 'docker')
    assert(raw.tlsMaterial === null || (typeof raw.tlsMaterial === 'object' && Object.keys(raw.tlsMaterial).length === 0))
    const docker = raw.endpoints.docker
    assert(docker && Object.keys(docker).every(key => key === 'Host' || key === 'SkipTLSVerify'))
    assert(docker.SkipTLSVerify === false || docker.SkipTLSVerify === undefined)
    assert(typeof docker.Host === 'string' && docker.Host.startsWith('unix:///') && !/[\x00-\x20\x7f%?#]/.test(docker.Host))
    assert.equal('unix://' + realpathSync(docker.Host.slice('unix://'.length)), endpoint.host)
    verify()
    assert(Date.now() < cutoff(settling))
  }
  const run: typeof command = async (file, args, options = {}) => {
    assert(file === 'docker' || file === 'supabase')
    assert(!options.env && !args.some(arg => arg === '--host' || arg === '-H' || arg.startsWith('--host=')))
    await observe()
    let dispatchFailure: unknown
    try {
      // Docker always gets the captured host explicitly. Supabase receives the
      // same host only in its private child environment, never via default context.
      const timeout = Math.min(options.timeout ?? 20000, remaining())
      const result = await command(file, file === 'docker' ? ['--host', endpoint.host, ...args] : args, {
        ...options, timeout, survey: { nativeCli, dispatchDeadline: cutoff(), closeDeadline: Math.min(budget.cleanupDeadline, Date.now() + timeout + 12000), componentExchange, cleanup: cleaning },
        ...(file === 'supabase' ? { env: { ...process.env, DOCKER_HOST: endpoint.host } } : {}),
      })
      if (profile === 'remaining' && file === 'docker' && (args[0] === 'ps' || ((args[0] === 'volume' || args[0] === 'network') && args[1] === 'ls')))
        assert(result.split(/\s+/).filter(Boolean).length <= 128, 'Survey269 remaining global inventory capacity exceeded')
      assert(Date.now() < cutoff()); return result
    } catch (error) { dispatchFailure = error; if (error instanceof Survey263UnjoinedChildError) poisoned = true; throw error }
    finally {
      // Poison is authoritative: no ordinary context child after uncertain join.
      if (poisoned && dispatchFailure instanceof Survey263UnjoinedChildError) throw dispatchFailure
      try { await observe(true) } catch (error) {
        if (error instanceof Survey263UnjoinedChildError) throw error
        if (dispatchFailure instanceof AssignmentListStartupError) throw dispatchFailure
        throw error
      }
    } // fixed original reserve, never a renewed clock
  }
  return Object.freeze({ run, observe, checkWork, checkTotal, cleanup: () => {
    cleaning = true
    if (componentExchange) componentExchanges.get(componentExchange)!.cleaning = true
  }, poison: () => { poisoned = true },
    endpoint: Object.freeze({ kind: 'survey263' as const, host: endpoint.host,
      identity: endpoint.identity as readonly [number, number, number, number], budget, nativeCli, ...(componentExchange ? { componentExchange } : {}) }) })
}

const containerTemplate = '{"id":{{json .Id}},"name":{{json .Name}},"labels":{{json .Config.Labels}},"mounts":{{json .Mounts}},"networks":{{json .NetworkSettings.Networks}},"bindings":{{json .HostConfig.PortBindings}},"created":{{json .Created}}}'
/** Fresh complete global discovery; batching reduces process overhead, not scope. */
export async function assignmentListDockerInventory(run: (file: string, args: string[]) => Promise<string> = command): Promise<AssignmentListResource[]> {
  return readAssignmentListDockerInventory(run, false)
}
/** Fixed component-only schedule. Same global parser and checks; three joined
 * list→inspect branches, never three inspections before their own lists. */
export async function survey269ComponentDockerInventory(run: (file: string, args: string[]) => Promise<string>): Promise<AssignmentListResource[]> {
  return readAssignmentListDockerInventory(run, true)
}
/** Read complete global lists and fail closed above the reviewed single-batch
 * capacity. Never truncate identities or omit foreign attachment users. */
export async function survey269RemainingDockerInventory(run: (file: string, args: string[]) => Promise<string>): Promise<AssignmentListResource[]> {
  return readAssignmentListDockerInventory(run, true, true)
}
async function readAssignmentListDockerInventory(run: (file: string, args: string[]) => Promise<string>, component: boolean, remaining = false): Promise<AssignmentListResource[]> {
  let stopped = false
  const dispatch = component ? async (file: string, args: string[]) => {
    assert(!stopped, 'Component inventory admission stopped')
    try { return await run(file, args) } catch (error) { stopped = true; throw error }
  } : run
  const ids = async (args: string[]) => {
    try {
      const values = (await dispatch('docker', args)).split(/\s+/).filter(Boolean)
      if (remaining) assert(values.length <= 128, 'Survey269 remaining global inventory capacity exceeded')
      assert.equal(new Set(values).size, values.length)
      assert(values.every(value => args[0] === 'volume' ? /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(value) : /^[a-f0-9]{64}$/.test(value)))
      return values
    } catch (error) { stopped = true; throw error }
  }
  async function inspect<T>(values: string[], args: string[], decode: (output: string) => T[], identify: (row: T) => string) {
    try {
      const rows: T[] = []
      for (let start = 0; start < values.length; start += 128) {
        const batch = values.slice(start, start + 128)
        const inspected = decode(await dispatch('docker', [...args, ...batch]))
        assert(Array.isArray(inspected)); assert.equal(inspected.length, batch.length)
        assert.deepEqual(inspected.map(identify).sort(), [...batch].sort())
        rows.push(...inspected)
      }
      return rows
    } catch (error) { stopped = true; throw error }
  }
  type Container = { id: string; name: string; labels: Record<string, string> | null; mounts: Array<{ Type: string; Name: string }>; networks: Record<string, { NetworkID: string }>; bindings: Record<string, Array<{ HostPort: string }> | null>; created: string }
  type Volume = { Name: string; CreatedAt: string; Labels: Record<string, string> | null }
  type Network = { Id: string; Name: string; Created: string; Labels: Record<string, string> | null; Containers: Record<string, unknown> }
  // Remaining-only representation change: full objects, no field projection.
  // The caller charges every raw byte before this decode; identity checks above
  // still require the complete fresh batch, including all foreign attachments.
  const fullJsonLines = <T>(output: string): T[] => output.split(/\r?\n/).filter(Boolean).map(line => {
    const row: unknown = JSON.parse(line)
    assert(row !== null && typeof row === 'object' && !Array.isArray(row))
    return row as T
  })
  const branch = async <T>(read: () => Promise<T>) => { try { return await read() } catch (error) { stopped = true; throw error } }
  const readContainers = () => branch(() => ids(['ps', '-aq', '--no-trunc']).then(values => inspect<Container>(values, ['inspect', '--format', containerTemplate], output => output.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)), row => row.id)))
  const readVolumes = () => branch(() => ids(['volume', 'ls', '-q']).then(values => inspect<Volume>(values, ['volume', 'inspect', ...(remaining ? ['--format', '{{json .}}'] : [])], output => remaining ? fullJsonLines<Volume>(output) : JSON.parse(output), row => row.Name)))
  const readNetworks = () => branch(() => ids(['network', 'ls', '-q', '--no-trunc']).then(values => inspect<Network>(values, ['network', 'inspect', ...(remaining ? ['--format', '{{json .}}'] : [])], output => remaining ? fullJsonLines<Network>(output) : JSON.parse(output), row => row.Id)))
  let containers: Container[], volumes: Volume[], networks: Network[]
  if (component) {
    const results = await Promise.allSettled([readContainers(), readVolumes(), readNetworks()] as const)
    for (const result of results) if (result.status === 'rejected') throw result.reason
    assert(results[0].status === 'fulfilled' && results[1].status === 'fulfilled' && results[2].status === 'fulfilled')
    containers = results[0].value; volumes = results[1].value; networks = results[2].value
  } else { containers = await readContainers(); volumes = await readVolumes(); networks = await readNetworks() }
  const volumeId = (name: string) => { const volume = volumes.find(v => v.Name === name); assert(volume); return `volume:${name}:${volume.CreatedAt}` }
  const result: AssignmentListResource[] = containers.map(c => ({ kind: 'container', id: c.id, createdAt: c.created, name: c.name.replace(/^\//, ''), labels: c.labels ?? {},
    attachedIds: [...c.mounts.filter((m: { Type: string }) => m.Type === 'volume').map((m: { Name: string }) => volumeId(m.Name)),
      ...Object.values(c.networks ?? {}).map(n => (n as { NetworkID: string }).NetworkID)],
    ports: [...new Set(Object.values(c.bindings ?? {}).flatMap(bindings => (bindings as Array<{ HostPort: string }> | null ?? []).map(binding => Number(binding.HostPort))))].sort((a, b) => a - b) }))
  for (const v of volumes) result.push({ kind: 'volume', id: volumeId(v.Name), createdAt: v.CreatedAt, name: v.Name, labels: v.Labels ?? {}, ports: [], attachedIds: containers.filter(c => c.mounts.some((m: { Type: string; Name: string }) => m.Type === 'volume' && m.Name === v.Name)).map(c => c.id) })
  for (const n of networks) result.push({ kind: 'network', id: n.Id, createdAt: n.Created, name: n.Name, labels: n.Labels ?? {}, ports: [], attachedIds: Object.keys(n.Containers ?? {}) })
  return result.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))
}
async function occupied(port: number): Promise<boolean> {
  return new Promise(resolve => { const server = createServer(); server.once('error', () => resolve(true)); server.listen(port, '127.0.0.1', () => server.close(() => resolve(false))) })
}
export type AssignmentListSnapshotScope = 'rows' | 'digests' | 'metadata'
/** Metadata scope retains the exact safety evidence while omitting unused row scans. */
export const assignmentListSnapshotSql = (scope: AssignmentListSnapshotScope) => {
  assert(['rows', 'digests', 'metadata'].includes(scope))
  return `begin isolation level repeatable read read only;
set local statement_timeout='20s';set local lock_timeout='3s';
${scope === 'metadata' ? '' : `select format('select jsonb_build_object(''table'',%L,''rows'',%s) from %I.%I r', n.nspname||'.'||c.relname,
 ${scope === 'rows' ? "'coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),''[]''::jsonb)'" : "'jsonb_build_object(''count'',count(*),''digest'',md5(coalesce(string_agg(md5(to_jsonb(r)::text),'''' order by md5(to_jsonb(r)::text)),'''')))'"},n.nspname,c.relname)
from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p') and n.nspname in ('public','private','storage') order by n.nspname,c.relname
\\gexec`}
select jsonb_build_object('metadata',jsonb_build_object(
 'functions',(select jsonb_agg(jsonb_build_array(n.nspname,p.proname,md5(pg_get_functiondef(p.oid)),p.proacl) order by p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='private' and p.proname in ('pal_membership_scope','guard_pal_membership_evidence','register_pal_membership','track_pal_membership_enrollment','track_pal_removed_roster')) or (n.nspname='public' and p.proname='resolve_pal_membership')),
 'triggers',(select jsonb_agg(jsonb_build_array(t.tgname,pg_get_triggerdef(t.oid),t.tgenabled) order by t.tgname) from pg_trigger t where t.tgrelid in ('private.pal_membership_generations'::regclass,'public.classroom_enrollments'::regclass,'public.classroom_roster'::regclass) and not t.tgisinternal),
 'rls_acl',(select jsonb_agg(jsonb_build_array(c.relname,c.relrowsecurity,c.relacl) order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname in ('pal_membership_generations','pal_membership_settings')),
 'singleton_index',pg_get_indexdef('public.classroom_roster_one_removed_membership_per_student'::regclass),
 'settings',(select md5(string_agg(name||'='||setting,chr(10) order by name)) from pg_settings)));
select 'select jsonb_build_object(''cron'',coalesce(jsonb_agg(to_jsonb(j) order by j.jobid),''[]''::jsonb)) from cron.job j' where to_regclass('cron.job') is not null
\\gexec
rollback;`
}
async function sql(projectId: string, input: string, applicationName: string, run: typeof command = command) {
  assert(projectId === 'pika' || /^pika_assignment_list_[a-f0-9]{12}$/.test(projectId))
  const resources = await assignmentListDockerInventory(run); const db = resources.find(r => r.kind === 'container' && r.name === `supabase_db_${projectId}`)
  assert(db && db.labels['com.supabase.cli.project'] === projectId && db.labels['com.docker.compose.project'] === projectId)
  assert(db.ports.length > 0 && db.ports.every(p => p === (projectId === 'pika' ? 54322 : 54332)))
  return run('docker', ['exec', '-i', '-e', `PGAPPNAME=${applicationName}`, db.id, 'psql', '-U', 'postgres', '-d', 'postgres', '-XqAt', '-v', 'ON_ERROR_STOP=1'], { input, timeout: 60000 })
}
export function decodeAssignmentListSnapshot(output: string, scope: AssignmentListSnapshotScope) {
  assert(['rows', 'digests', 'metadata'].includes(scope))
  const lines = output.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
  const tables = Object.fromEntries(lines.filter(row => row.table).map(row => [row.table, row.rows]))
  if (scope === 'metadata') assert.equal(Object.keys(tables).length, 0)
  else assert(Object.keys(tables).length > 0)
  const metadata = lines.find(row => row.metadata)?.metadata; assert(metadata)
  return { tables, metadata: JSON.stringify(metadata), cron: JSON.stringify(lines.find(row => row.cron)?.cron ?? []) }
}
async function databaseSnapshot(projectId: string, scope: AssignmentListSnapshotScope, run: typeof command = command) {
  return decodeAssignmentListSnapshot(await sql(projectId, assignmentListSnapshotSql(scope), `${projectId}_snapshot`, run), scope)
}
export function loadAssignmentListReviewedMigrations(repository: string) {
  // Entry points bind this inventory to an exact reviewed HEAD and clean root.
  // Select every SQL file; a malformed extra must fail, never disappear in a filter.
  const folder = join(repository, 'supabase/migrations'); const names = readdirSync(folder).filter(name => name.endsWith('.sql')).sort()
  const migrations = names.map(name => { const content = readFileSync(join(folder, name), 'utf8'); return { name, sql: content, sha256: sha(content) } })
  validateAssignmentListMigrationChain(migrations)
  return migrations
}

/** No database/resources exist yet. Partial writes remain exclusively ours. */
export function prepareAssignmentListProjectFiles(
  plan: Parameters<AssignmentListLifecycleAdapters['prepare']>[0],
  migrations: Parameters<AssignmentListLifecycleAdapters['prepare']>[1],
  checkpoint?: (stage: 'directory' | 'migration') => void,
) {
  validateAssignmentListEphemeralIdentity(plan)
  for (const migration of migrations) assert.match(migration.name, /^\d{3}_[a-z0-9_]+\.sql$/)
  const workdir = plan.workdir
  assert.equal(realpathSync(dirname(workdir)), dirname(workdir)); assert(!existsSync(workdir))
  mkdirSync(workdir, { mode: 0o700 })
  try {
    checkpoint?.('directory')
    mkdirSync(join(workdir, 'supabase/migrations'), { recursive: true, mode: 0o700 })
    writeFileSync(join(workdir, 'supabase/config.toml'), plan.config, { mode: 0o600, flag: 'wx' })
    for (const migration of migrations) {
      writeFileSync(join(workdir, 'supabase/migrations', migration.name), migration.sql, { mode: 0o600, flag: 'wx' })
      checkpoint?.('migration')
    }
    return { workdir, realpath: realpathSync(workdir), created: true, configSha256: sha(readFileSync(join(workdir, 'supabase/config.toml'), 'utf8')),
      migrations: migrations.map(m => ({ name: m.name, sha256: sha(readFileSync(join(workdir, 'supabase/migrations', m.name), 'utf8')) })), envFiles: [], symlinks: [] }
  } catch (error) {
    assert.equal(realpathSync(workdir), workdir)
    rmSync(workdir, { recursive: true })
    throw error
  }
}

export function createAssignmentListNativeAdapters(fixture: AssignmentListProofFixture, options: { ephemeralSnapshot?: 'digests' | 'metadata'; survey263Endpoint?: Survey263Endpoint;
  survey263Budget?: Survey263Budget; survey263NativeCli?: Survey263NativeCli; survey269Component?: true; survey269Remaining?: true; nativeCommand?: typeof command } = {}): AssignmentListLifecycleAdapters {
  const descriptor = Object.getOwnPropertyDescriptor(options, 'survey263Endpoint')
  if (!descriptor) assert(!('survey263Endpoint' in options), 'Survey options must be own data')
  if (descriptor) assert('value' in descriptor, 'Survey options must be data')
  if (descriptor?.value) assert(Object.values(Object.getOwnPropertyDescriptors(options)).every(field => 'value' in field), 'Survey options must be data')
  // Existing generic disposable operations may use an explicitly pinned native
  // transport. It cannot override a separately governed provider transport.
  const nativeCommand = Object.getOwnPropertyDescriptor(options, 'nativeCommand')
  if (!nativeCommand) assert(!('nativeCommand' in options))
  if (nativeCommand) assert('value' in nativeCommand && (nativeCommand.value === undefined || typeof nativeCommand.value === 'function'))
  assert(!(nativeCommand?.value && descriptor?.value), 'Separate native transport boundaries must not be combined')
  const ephemeralSnapshot = options.ephemeralSnapshot ?? 'digests'
  assert(ephemeralSnapshot === 'digests' || ephemeralSnapshot === 'metadata')
  const projectId = `pika_assignment_list_${fixture.manifest.syntheticTag.slice(-12)}`
  const workdir = assignmentListProofWorkdir(projectId)
  assert(Boolean(options.survey263Endpoint) === Boolean(options.survey263Budget) && Boolean(options.survey263Endpoint) === Boolean(options.survey263NativeCli))
  if (options.survey269Component !== undefined) assert(options.survey269Component === true && options.survey263Endpoint)
  if (options.survey269Remaining !== undefined) assert(options.survey269Remaining === true && options.survey263Endpoint)
  assert(!(options.survey269Component && options.survey269Remaining), 'Survey269 profiles cannot be combined')
  const profile = options.survey269Remaining ? 'remaining' : options.survey269Component ? 'component' : undefined
  const transport = options.survey263Endpoint ? createSurvey263PlatformTransport(options.survey263Endpoint, options.survey263Budget!, options.survey263NativeCli!, profile) : undefined
  const run: typeof command = transport?.run ?? nativeCommand?.value ?? command
  const inventory = () => assignmentListDockerInventory(run)
  const snapshot = (project: string, scope: AssignmentListSnapshotScope) => databaseSnapshot(project, scope, run)
  const fixedSql = (project: string, text: string, name: string) => sql(project, text, name, run)
  const createdDirectories = new Set<string>()
  let beforeTransition: Rows | undefined
  const adapters: AssignmentListLifecycleAdapters = {
    ...(transport ? { checkWork: transport.checkWork } : {}),
    async canonicalSnapshot() {
      const baseline = await snapshot('pika', 'digests')
      const resources = (await inventory()).filter(r => r.labels['com.supabase.cli.project'] === 'pika')
      assert(resources.length > 0)
      return { rowDigests: JSON.stringify(baseline.tables), guard168Metadata: baseline.metadata, settings: baseline.metadata, cronJobs: baseline.cron, resources: JSON.stringify(resources) }
    },
    async inventory() {
      const result = { resources: await inventory(), occupiedPorts: (await Promise.all([54340, 54331, 54332].map(async port => ({ port, busy: await occupied(port) })))).filter(r => r.busy).map(r => r.port), workdirExists: existsSync(workdir) }
      if (transport) transport.checkTotal()
      return result
    },
    async prepare(plan, migrations) {
      transport?.checkWork()
      assert.equal(plan.workdir, workdir)
      await transport?.observe()
      const prepared = prepareAssignmentListProjectFiles(plan, migrations, transport ? () => transport.checkWork() : undefined)
      createdDirectories.add(workdir)
      transport?.checkWork()
      return prepared
    },
    async command(request) {
      transport?.checkWork()
      assert.equal(request.workdir, workdir)
      const output = await run('supabase', [...request.args], { timeout: request.timeoutMs, ...(request.args[0] === 'start' ? { startupProjectId: projectId } : {}) })
      return request.args[0] === 'status' ? JSON.parse(output) : undefined
    },
    async verifyEphemeral(input) {
      transport?.checkWork()
      const resources = await inventory(); const db = resources.find(r => r.kind === 'container' && r.name === `supabase_db_${projectId}`); assert(db)
      const gates = await fixedSql(projectId, `select jsonb_build_object('guard',exists(select 1 from pg_trigger where tgrelid='private.pal_membership_generations'::regclass and tgname='guard_pal_membership_evidence' and tgenabled='O'),
        'off',not ((select enabled from private.pal_membership_settings where singleton) or (select enabled from private.pal_classroom_signal_settings where singleton) or (select enabled or live_enabled or automatic_enabled from private.student_provider_cleanup_settings where singleton) or (select enabled from private.removed_student_academic_settings where singleton) or (select strict_enforcement_enabled from private.classroom_creation_entitlement_settings where singleton)),
        'no_work',not exists(select 1 from public.test_ai_grading_runs) and not exists(select 1 from public.test_ai_grading_run_items),
        'no_secrets',not exists(select 1 from vault.secrets));`, input.applicationName)
      const result = JSON.parse(gates); const evidence = await snapshot(projectId, ephemeralSnapshot)
      const jobs = JSON.parse(evidence.cron) as Array<Record<string, unknown>>
      return { projectId, containerId: db.id, applicationName: input.applicationName, dbPort: 54332, guard168Enabled: result.guard === true, persistedGatesOff: result.off === true, activeNetworkCronAbsent: result.no_work === true && result.no_secrets === true && assignmentListSafeCronJobs(jobs) }
    },
    async executeSql(input) {
      transport?.checkWork()
      assert.equal(input.projectId, projectId); assert.equal(input.applicationName, `${projectId}_fixture`)
      const db = (await inventory()).find(r => r.kind === 'container' && r.name === `supabase_db_${projectId}`)
      assert.equal(db?.id, input.containerId)
      await fixedSql(projectId, input.sql, input.applicationName)
    },
    async runCase({ proofCase, target }) {
      transport?.checkWork()
      assert(proofCase.expectedStatus === '200' || proofCase.expectedStatus === '403')
      const urls: URL[] = []
      const safeFetch = containedAssignmentListProofFetch(fetch, projectId)
      const client = createClient<Database>(target.API_URL, target.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (request, init) => {
        const url = new URL(request instanceof Request ? request.url : String(request)); urls.push(url)
        assert.equal(url.pathname, '/rest/v1/classrooms'); assert.equal(url.searchParams.get('id'), `eq.${proofCase.classroomId}`); assert(!url.searchParams.get('select')?.includes('*'))
        if (urls.length > 1) { assert.equal(url.searchParams.get('teacher_id'), `${proofCase.permission === 'owner' ? 'eq' : 'neq'}.${proofCase.actorId}`)
          if (proofCase.permission === 'member') { assert.equal(url.searchParams.get('archived_at'), 'is.null'); assert.equal(url.searchParams.get('membership.student_id'), `eq.${proofCase.actorId}`) } }
        return safeFetch(request, init)
      } } })
      const read = () => readContextualAssignmentList({ supabase: client, actorId: proofCase.actorId, classroomId: proofCase.classroomId, permission: proofCase.permission, now: new Date(fixture.manifest.now) })
      if (proofCase.expectedStatus !== '200') await assert.rejects(read, error => error instanceof ApiError && error.statusCode === Number(proofCase.expectedStatus))
      else {
        const result = await read(); assert.deepEqual(result.assignments.map(row => row.id), proofCase.assignmentIds)
        for (const expected of proofCase.stats ?? []) { const row = result.assignments.find(a => a.id === expected.id)!; assert(row)
          assert.equal((row.stats as { total_students: number }).total_students, expected.totalStudents); assert.equal((row.stats as { submitted: number }).submitted, expected.submitted)
          assert.deepEqual((row.submission_requirements as Array<{ id: string }>).map(r => r.id), expected.requirementIds) }
        for (const row of result.assignments) if (proofCase.permission === 'member' && row.doc) {
          const doc = row.doc as Record<string, unknown>
          for (const key of ['authenticity_score', 'authenticity_flags', 'teacher_feedback_draft', 'ai_feedback_suggestion', 'ai_feedback_model']) assert.equal(doc[key], null)
          assert(!('ai_grading_provenance' in doc) && !('ai_grading_review' in doc))
          if (!doc.returned_at) for (const key of ['score_completion', 'score_thinking', 'score_workflow', 'graded_at', 'graded_by']) assert.equal(doc[key], null)
        }
        assert(!urls.at(-1)?.searchParams.get('select')?.includes('assignments:'))
      }
      return { actorId: proofCase.actorId, classroomId: proofCase.classroomId, status: proofCase.expectedStatus }
    },
    async runRevocation(input) {
      transport?.checkWork()
      beforeTransition = (await snapshot(projectId, 'rows')).tables as Rows
      return observeAssignmentListRevocation({ ...input, originalFetch: fetch, transition: input.executeSql })
    },
    async verifyRestoration({ plan }) {
      transport?.checkWork()
      assert(beforeTransition)
      const after = (await snapshot(projectId, 'rows')).tables as Rows
      const changes = assignmentListRowChanges(beforeTransition, after)
      const policy = assignmentListRestorationPolicy(fixture, plan)
      const permitted = (cell: Cell) => policy.allowedCells.some(allow => allow.schema === cell.schema && allow.table === cell.table && allow.id === cell.id && cell.columns.every(column => allow.columns.includes(column)))
      assert(changes.every(permitted), 'restoration-scope')
      const filter = (rows: Rows) => JSON.stringify(Object.fromEntries(Object.entries(rows).map(([name, values]) => [name, values.filter(row => !policy.allowedCells.some(c => `${c.schema}.${c.table}` === name && c.id === identity(row, name)))])))
      const nonTargetBefore = sha(filter(beforeTransition)); const nonTargetAfter = sha(filter(after)); assert.equal(nonTargetBefore, nonTargetAfter, 'restoration-nontarget')
      // All business fields compare equal; only enumerated trigger bookkeeping
      // and fresh enrollment/generation rows may differ after restoration.
      const classroom = after['public.classrooms'].find(row => row.id === plan.classroomId)!; assert.equal(classroom.teacher_id, fixture.classes[0].owner, 'restoration-owner'); assert.equal(classroom.archived_at, null, 'restoration-archive')
      assert((classroom.feature_visibility as Record<string, unknown>).classwork !== false, 'restoration-visibility')
      assert(after['public.classroom_enrollments'].some(row => row.classroom_id === plan.classroomId && row.student_id === fixture.manifest.actors[2].id), 'restoration-member')
      return { nonTargetBefore, nonTargetAfter, semanticRestored: true, changedCells: changes }
    },
    async teardown(input) {
      assert.equal(input.projectId, projectId)
      const current = await inventory()
      for (const captured of input.resources) { const resource = current.find(r => r.id === captured.id && r.kind === captured.kind); assert(resource && JSON.stringify(resource) === JSON.stringify(captured)) }
      if (input.stopArgs) await run('supabase', input.stopArgs, { timeout: 120000 })
      else {
        for (const kind of ['container', 'network', 'volume'] as const) for (const resource of input.resources.filter(r => r.kind === kind)) {
          if (kind === 'container') await run('docker', ['rm', '-f', resource.id])
          else if (kind === 'network') await run('docker', ['network', 'rm', resource.id])
          else await run('docker', ['volume', 'rm', resource.name])
        }
      }
    },
    async removeWorkdir(input) {
      assert(createdDirectories.has(input.workdir)); assert.equal(input.workdir, workdir); assert.equal(input.realpath, realpathSync(workdir)); assert.equal(input.realpath, workdir)
      await transport?.observe()
      rmSync(workdir, { recursive: true }); createdDirectories.delete(workdir)
      await transport?.observe()
    },
  }
  if (transport) {
    Object.freeze(adapters)
    survey263AdapterEndpoints.set(adapters, { binding: transport.endpoint, cleanup: transport.cleanup, poison: transport.poison, checkTotal: transport.checkTotal })
  }
  return adapters
}
