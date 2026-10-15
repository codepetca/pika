import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createContextualTestPlan } from '../../e2e/helpers/contextual-test-rehearsal'
import { runContextualTestRehearsalController, verifyContextualTestArtifacts } from '../../scripts/contextual-test-rehearsal-controller'
import { runContextualTestDisposableLifecycle } from '../../scripts/contextual-test-rehearsal-platform'
import { loadAssignmentListReviewedMigrations } from '../../scripts/contextual-assignment-list-proof-platform'

const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
const projectId = 'pika_assignment_list_123456abcdef', plan = createContextualTestPlan(projectId)
function fixture() {
  const events: string[] = [], receipts: unknown[] = []
  const source = { repository: '/frozen', head: plan.sourceSha, tree: plan.sourceTree, entries: [{ path: 'src/app/page.tsx', mode: '100644', blob: 'a'.repeat(40), sha256: 'a'.repeat(64) }], sha256: 'a'.repeat(64), bytes: 1 }
  const admission = { version: 1, nonce: '0'.repeat(20) + '123456abcdef', projectId,
    migrationChainSha256: plan.migrationChainSha256,
    startedAt: 1000, deadline: 2341000, cleanupDeadline: 2701000,
    workdir: '/private/tmp/pika-assignment-list-123456abcdef', appDir: '/private/tmp/pika-assignment-list-123456abcdef/app', outputDir: '/private/tmp/durable-test-output',
    password: 'synthetic-private-password', sessionSecret: 's'.repeat(64), frozen: source,
    runner: { ...source, repository: '/runner', head: 'b'.repeat(40), tree: 'c'.repeat(40) },
    review: { manifestSha256: 'd'.repeat(64), runnerHead: 'b'.repeat(40), runnerTree: 'c'.repeat(40) },
    dependencies: { root: '/deps', sha256: 'e'.repeat(64), roots: ['/deps'] },
    transportPins: { git: { path: '/pin/git', sha256: 'a'.repeat(64) }, docker: { path: '/pin/docker', sha256: 'b'.repeat(64) }, supabase: { path: '/pin/supabase', sha256: 'c'.repeat(64) }, dockerHost: 'unix:///private/tmp/docker.sock', socketIdentity: [1,2,3,4], outputDir: '/private/tmp/durable-test-output' },
    assignmentMetadata: { manifest: { syntheticTag: 'assignmentlist_123456abcdef' } }, migrations: [],
  }
  const token = (role: string) => `header.${Buffer.from(JSON.stringify({ iss: 'supabase-demo', role })).toString('base64url')}.signature`
  const status = { API_URL: plan.apiOrigin, DB_URL: 'postgresql://postgres:demo@127.0.0.1:54332/postgres', ANON_KEY: token('anon'), SERVICE_ROLE_KEY: token('service_role') }
  let bound: Record<string, unknown> | undefined
  const control = {
    now: () => 1001,
    async assertReady() { events.push('ready') }, async assertUnchanged() { events.push('unchanged') },
    command: { run: async () => '', beginCleanup() { events.push('cleanup-mode') }, async joinSettlements() { events.push('join-settlements') }, assertClosed() { events.push('commands-closed') }, state: () => ({ poisoned: false, fault: false, pending: 0, cleaning: true }) },
    async launchApp(input: { env: Record<string, string> }) { events.push('app-spawn'); expect(input.env).not.toHaveProperty('OPENAI_API_KEY'); return { async ready() { events.push('app-ready') } } },
    async launchPlaywright() { events.push('pw-spawn'); return { async wait() { events.push('pw-close'); return { code: 0, signal: null, closed: true } } } },
    async settleAll(end: number) { events.push('settle'); expect(end).toBe(Math.min(admission.cleanupDeadline, 1001 + 360000)) },
  }
  const adapters = { async verifyEphemeral() { events.push('verify-ephemeral'); return { projectId, containerId: 'f'.repeat(64), dbPort: 54332, applicationName: `${projectId}_fixture`, guard168Enabled: true, persistedGatesOff: true, activeNetworkCronAbsent: true } } }
  const edges = {
    openEvidence() { events.push('attempt') },
    prepareApp() { events.push('snapshot') },
    createAdapters(metadata: typeof admission.assignmentMetadata, input: { nativeCommand: unknown }) { events.push('adapters'); expect(metadata).toEqual(admission.assignmentMetadata); expect(input.nativeCommand).toBe(control.command.run); return adapters },
    async lifecycle(_identity: unknown, _migrations: unknown, _adapters: unknown, work: (...args: unknown[]) => Promise<void>, settle: () => Promise<void>) {
      events.push('lifecycle-before'); try { await work(status, [{ kind: 'container', id: 'f'.repeat(64), name: `supabase_db_${projectId}`, labels: { 'com.supabase.cli.project': projectId, 'com.docker.compose.project': projectId }, ports: [54332], attachedIds: [], createdAt: 'synthetic' }], status) }
      finally { await settle(); events.push('exact-disposal'); events.push('canonical-after') }
    },
    bind(binding: Record<string, unknown>) { events.push('binding'); bound = binding; return { binding, file: `${admission.outputDir}/run-binding.json`, sha256: hash(binding) } },
    async passwordHash() { events.push('password-hash'); return 'synthetic-bcrypt' },
    async sql(_binding: unknown, kind: string) { events.push(`sql-${kind}`); return '{}' },
    assertSqlSettled() { events.push('sql-closed') },
    createLedger() { events.push('ledger-create'); return { reserveAppReadiness() { events.push('readiness-reserve') }, snapshot() { events.push('ledger-read'); return { version: 1, nonce: admission.nonce, deadline: admission.deadline, app: 1, storage: 2, api: 10, flags: { denied: false, capExceeded: false, expired: false, uncertain: false } } } } },
    readPlaywrightReceipt() { events.push('pw-receipt'); return { version: 1, projectId, sourceSha: plan.sourceSha, sourceTree: plan.sourceTree, outcome: 'passed', contextsClosed: true, counts: { appRequests: 30, storageRequests: 4, tests: 8, reservations: 2, uploads: 2 }, firstFailure: null, pending: 0, pageErrors: 0, consoleErrors: 0, artifacts: ['ownerTeacher','ownerStudent','memberTeacher','memberStudent'].flatMap(actor => ['desktop','mobile'].flatMap(view => ['light','dark'].map(theme => ({ label: `${actor}-${view}-${theme}`, kind: 'png', bytes: 1, sha256: 'a'.repeat(64) })))), witnesses: [], endedAt: 2000, deadline: admission.deadline } },
    verifyArtifacts() { events.push('verify-artifacts') },
    writeReceipt(receipt: unknown) { events.push('receipt'); receipts.push(receipt) },
  }
  return { admission, events, receipts, control, edges, bound: () => bound }
}

describe('contextual Test controller CPU composition (no native proof)', () => {
  it('retains the actual sealed setup failure before binding, without trusting thrown error fields', async () => {
    const f = fixture(), clock = vi.spyOn(Date, 'now').mockReturnValue(1001)
    const secret = vi.fn(() => { throw Error('SECRET-password-private-url') })
    const hostile = new Proxy({}, { get: secret, ownKeys: secret, getPrototypeOf: secret })
    const edges = { ...f.edges, lifecycle: runContextualTestDisposableLifecycle,
      createAdapters: () => ({ async canonicalSnapshot() { throw hostile } }) }
    try {
      await expect(runContextualTestRehearsalController({ ...f.admission, migrations: loadAssignmentListReviewedMigrations(process.cwd()).slice(0, 262) } as never, f.control, edges as never)).rejects.toThrow()
      expect(f.receipts[0]).toMatchObject({ outcome: 'failed', firstFailureStage: 'lifecycle', ownedSettled: true,
        setupDiagnostic: { firstFailure: 'canonical-before', lastCompleted: null, cleanupFailures: [] } })
      expect(f.events).not.toContain('binding'); expect(f.events).not.toContain('app-spawn')
      expect(secret).not.toHaveBeenCalled(); expect(JSON.stringify(f.receipts)).not.toContain('SECRET')
    } finally { clock.mockRestore() }
  })
  it('does not retain fabricated setup labels or inspect hostile error properties', async () => {
    const f = fixture(), getter = vi.fn(() => { throw Error('SECRET') })
    const hostile = new Proxy({ setupDiagnostic: { firstFailure: 'start' } }, { get: getter, ownKeys: getter, getPrototypeOf: getter })
    const edges = { ...f.edges, async lifecycle() { throw hostile } }
    await expect(runContextualTestRehearsalController(f.admission as never, f.control, edges as never)).rejects.toThrow()
    expect(f.receipts[0]).toMatchObject({ outcome: 'failed', setupDiagnostic: null })
    expect(getter).not.toHaveBeenCalled(); expect(JSON.stringify(f.receipts)).not.toContain('SECRET')
  })
  it('reserves exactly one readiness request before app readiness and never launches PW before its completion', async () => {
    const f = fixture()
    let ready!: () => void
    const pending = new Promise<void>(resolve => { ready = resolve })
    f.control.launchApp = async () => ({ async ready() { f.events.push('route-ready-enter'); await pending; f.events.push('route-ready-complete') } })
    const run = runContextualTestRehearsalController(f.admission as never, f.control, f.edges as never)
    await vi.waitFor(() => expect(f.events).toContain('route-ready-enter'))
    expect(f.events.filter(event => event === 'readiness-reserve')).toHaveLength(1)
    expect(f.events.indexOf('readiness-reserve')).toBeLessThan(f.events.indexOf('route-ready-enter'))
    expect(f.events).not.toContain('pw-spawn')
    ready(); await run
    expect(f.events.indexOf('route-ready-complete')).toBeLessThan(f.events.indexOf('pw-spawn'))
  })
  it('does not dispatch readiness or browser work after a failed request reservation', async () => {
    const f = fixture(), base = f.edges.createLedger
    f.edges.createLedger = () => ({ ...base(), reserveAppReadiness() { f.events.push('reservation-failed'); throw Error('budget exhausted') } })
    await expect(runContextualTestRehearsalController(f.admission as never, f.control, f.edges as never)).rejects.toThrow()
    expect(f.events.filter(event => event === 'reservation-failed')).toHaveLength(1)
    expect(f.events).not.toContain('app-ready'); expect(f.events).not.toContain('pw-spawn')
    expect(f.receipts[0]).toMatchObject({ outcome: 'failed', firstFailureStage: 'app-ready', ownedSettled: true })
  })
  it('retains only fixed native diagnostics even when closure fails, without accepting the run', async () => {
    const f = fixture()
    const row = { role: 'browser', phase: 'monitor', cause: 'kernel-unverified', closed: false, uncertain: true }
    const diagnostics = { firstFailure: row, failures: [row], overflow: false, activeProbes: 0, unsettledFamilies: 1 }
    const control = { ...f.control, nativeDiagnostics: () => diagnostics, async settleAll() { throw Error('SECRET unproved closure') } }
    await expect(runContextualTestRehearsalController(f.admission as never, control, f.edges as never)).rejects.toThrow()
    expect(f.receipts[0]).toMatchObject({ outcome: 'failed', ownedSettled: false, nativeDiagnostics: diagnostics })
    row.cause = 'SECRET'
    expect((f.receipts[0] as { nativeDiagnostics: { firstFailure: { cause: string } } }).nativeDiagnostics.firstFailure.cause).toBe('kernel-unverified')
  })
  it('rejects unsafe native metadata without evaluating getters/proxies or retaining raw data', async () => {
    const getter = vi.fn(() => { throw Error('SECRET') })
    const row = { role: 'app', phase: 'settle', cause: 'unknown', closed: false, uncertain: true }
    const good = { firstFailure: row, failures: [row], overflow: false, activeProbes: 0, unsettledFamilies: 1 }
    for (const raw of [new Proxy({}, { get: getter, ownKeys: getter }), Object.defineProperty({}, 'firstFailure', { get: getter }),
      { ...good, token: 'SECRET' }, { ...good, failures: [Object.defineProperty({}, 'cause', { get: getter })] },
      { ...good, firstFailure: { ...row, cause: 'SECRET' } }, { ...good, failures: Array(17).fill(row) }]) {
      const f = fixture(), control = { ...f.control, nativeDiagnostics: () => raw }
      const result = await runContextualTestRehearsalController(f.admission as never, control, f.edges as never)
      expect(result).toMatchObject({ outcome: 'passed', nativeDiagnostics: null })
      expect(JSON.stringify(result)).not.toContain('SECRET')
    }
    expect(getter).not.toHaveBeenCalled()
  })
  it('runs the existing lifecycle with one attempt, exact captured binding, bootstrap, one app and one PW child', async () => {
    const f = fixture(); await runContextualTestRehearsalController(f.admission as never, f.control, f.edges as never)
    expect(f.events.indexOf('ready')).toBeLessThan(f.events.indexOf('attempt'))
    expect(f.events.indexOf('binding')).toBeLessThan(f.events.indexOf('sql-bootstrap'))
    expect(f.events.indexOf('sql-bootstrap')).toBeLessThan(f.events.indexOf('app-spawn'))
    expect(f.events.indexOf('app-ready')).toBeLessThan(f.events.indexOf('pw-spawn'))
    expect(f.events.indexOf('settle')).toBeLessThan(f.events.indexOf('exact-disposal'))
    expect(f.events.indexOf('canonical-after')).toBeLessThan(f.events.indexOf('receipt'))
    expect(f.events.indexOf('pw-receipt')).toBeLessThan(f.events.indexOf('verify-artifacts'))
    expect(f.events.filter(e => e === 'app-spawn')).toHaveLength(1); expect(f.events.filter(e => e === 'pw-spawn')).toHaveLength(1)
    expect(f.bound()?.docker).toMatchObject({ containerId: 'f'.repeat(64) })
    expect(f.receipts).toHaveLength(1); expect(f.receipts[0]).toMatchObject({ outcome: 'passed', ownedSettled: true, lifecycleCompleted: true })
    expect(JSON.stringify(f.receipts)).not.toContain(f.admission.password); expect(JSON.stringify(f.receipts)).not.toContain(f.admission.sessionSecret)
  })
  it('fails before all writes when native reviewed readiness is absent', async () => {
    const f = fixture(); f.control.assertReady = async () => { throw Error('private path/token') }
    await expect(runContextualTestRehearsalController(f.admission as never, f.control, f.edges as never)).rejects.toThrow('Private contextual Test controller failed')
    expect(f.events).not.toContain('attempt'); expect(f.events).not.toContain('app-spawn'); expect(f.receipts).toHaveLength(0)
  })
  it('settles before disposal and records failure when PW closes unsuccessfully', async () => {
    const f = fixture(); f.control.launchPlaywright = async () => ({ async wait() { return { code: 1, signal: null, closed: true } } })
    await expect(runContextualTestRehearsalController(f.admission as never, f.control, f.edges as never)).rejects.toThrow('Private contextual Test controller failed')
    expect(f.events.indexOf('settle')).toBeLessThan(f.events.indexOf('exact-disposal'))
    expect(f.receipts[0]).toMatchObject({ outcome: 'failed', firstFailureStage: 'browser', ownedSettled: true, lifecycleCompleted: false, server: { app: 1, storage: 2, api: 10 } })
    expect(f.events).not.toContain('pw-receipt')
  })
  it('retains bound fixed startup diagnostics only after settlement without promoting failed browser work', async () => {
    const f = fixture()
    const startup = { version: 1, projectId, nonce: f.admission.nonce, sourceSha: plan.sourceSha, deadline: f.admission.deadline,
      report: { version: 1, status: 'passed', discovered: 1, started: 1, ended: 1, passed: 1, errors: [], overflow: false },
      reached: ['collection','fixture'], failure: null }
    const edges = { ...f.edges, readStartupReport() { f.events.push('startup-read'); return startup } }
    f.control.launchPlaywright = async () => ({ async wait() { return { code: 1, signal: null, closed: true } } })
    await expect(runContextualTestRehearsalController(f.admission as never, f.control, edges as never)).rejects.toThrow()
    expect(f.events.indexOf('startup-read')).toBeGreaterThan(f.events.indexOf('settle'))
    expect(f.receipts[0]).toMatchObject({ outcome: 'failed', firstFailureStage: 'browser', ownedSettled: true, startup })
    startup.reached.push('workflow')
    expect((f.receipts[0] as { startup: { reached: string[] } }).startup.reached).toEqual(['collection','fixture'])
  })
  it('rejects unbound or unsafe startup diagnostics without retaining raw fields or changing existing success gates', async () => {
    for (const patch of [{ message: 'SECRET-password-https://private.invalid' }, { nonce: 'f'.repeat(32) }]) {
      const f = fixture()
      const raw = { version: 1, projectId, nonce: f.admission.nonce, sourceSha: plan.sourceSha, deadline: f.admission.deadline,
        report: { version: 1, status: 'passed', discovered: 1, started: 1, ended: 1, passed: 1, errors: [], overflow: false }, reached: [], failure: null, ...patch }
      const edges = { ...f.edges, readStartupReport: () => raw }
      const receipt = await runContextualTestRehearsalController(f.admission as never, f.control, edges as never)
      expect(receipt).toMatchObject({ outcome: 'passed', startup: null })
      expect(JSON.stringify(receipt)).not.toMatch(/SECRET|private\.invalid/)
    }
  })
  it('does not inspect diagnostic artifacts when owned closure is unproved', async () => {
    const f = fixture(); let reads = 0
    f.control.settleAll = async () => { throw Error('Unconfirmed ownership') }
    const edges = { ...f.edges, readStartupReport() { reads++; throw Error('SECRET') } }
    await expect(runContextualTestRehearsalController(f.admission as never, f.control, edges as never)).rejects.toThrow()
    expect(reads).toBe(0); expect(f.receipts[0]).toMatchObject({ outcome: 'failed', ownedSettled: false, startup: null })
  })
  it('missing diagnostic output never masks the original browser failure', async () => {
    const f = fixture()
    f.control.launchPlaywright = async () => ({ async wait() { return { code: 1, signal: null, closed: true } } })
    const edges = { ...f.edges, readStartupReport() { throw Error('SECRET unavailable') } }
    await expect(runContextualTestRehearsalController(f.admission as never, f.control, edges as never)).rejects.toThrow()
    expect(f.receipts[0]).toMatchObject({ outcome: 'failed', firstFailureStage: 'browser', startup: null })
    expect(JSON.stringify(f.receipts)).not.toContain('SECRET')
  })
  it('never disposes when actual process settlement cannot be proven', async () => {
    const f = fixture(); f.control.settleAll = async () => { f.events.push('settle-failed'); throw Error('unknown family') }
    await expect(runContextualTestRehearsalController(f.admission as never, f.control, f.edges as never)).rejects.toThrow()
    expect(f.events).not.toContain('exact-disposal'); expect(f.receipts[0]).toMatchObject({ outcome: 'failed', ownedSettled: false })
  })
  it.each(['execution', 'unchanged'])('distinguishes %s cleanup rejection without replacing the browser failure', async failure => {
    const f = fixture()
    f.control.launchPlaywright = async () => ({ async wait() { return { code: 1, signal: null, closed: true } } })
    if (failure === 'execution') f.control.settleAll = async () => {
      throw new AggregateError([Object.assign(Error('PRIVATE-SENTINEL'), { cleanupStage: 'owned-families', path: 'PRIVATE-SENTINEL' })], 'PRIVATE-SENTINEL')
    }
    else f.control.assertUnchanged = async () => { throw Error('PRIVATE-SENTINEL') }
    await expect(runContextualTestRehearsalController(f.admission as never, f.control, f.edges as never)).rejects.toThrow()
    expect(f.receipts[0]).toMatchObject({ outcome: 'failed', firstFailureStage: 'browser', ownedSettled: false,
      lifecycleCompleted: false, playwrightValidated: false, server: null, startup: null, cleanupEnd: 361001,
      cleanup: { entry: 'passed', executionSettlement: failure === 'execution' ? 'failed' : 'passed', commandJoins: 'passed',
        commandClosure: 'passed', sqlClosure: 'passed', unchanged: failure === 'execution' ? 'not-run' : 'failed',
        executionFailures: failure === 'execution' ? ['owned-families'] : [] } })
    expect(f.events).not.toContain('exact-disposal'); expect(f.events).not.toContain('canonical-after')
    expect(JSON.stringify(f.receipts)).not.toContain('PRIVATE-SENTINEL')
  })
  it('projects only bounded own data cleanup stages without reading private getters', async () => {
    let reads = 0
    const secret = () => { reads++; throw Error('PRIVATE-SENTINEL') }
    const getterStage = Object.defineProperty({}, 'cleanupStage', { get: secret })
    const getterEntry = [null]; Object.defineProperty(getterEntry, '0', { get: secret })
    const getterErrors = new AggregateError([]); Object.defineProperty(getterErrors, 'errors', { get: secret })
    const valid = Object.defineProperties({ cleanupStage: 'owned-families' }, {
      message: { get: secret }, stack: { get: secret }, path: { get: secret }, toJSON: { get: secret },
    })
    const inheritedProxy = new AggregateError([valid])
    Object.setPrototypeOf(inheritedProxy, new Proxy(AggregateError.prototype, { getPrototypeOf: secret }))
    const cases: Array<[unknown, string[]]> = [
      [new AggregateError([valid, valid, { cleanupStage: 'native-closure' }]), ['owned-families', 'native-closure']],
      [new AggregateError(['command-entry', 'owned-families', 'command-settlements', 'command-closure', 'native-closure']
        .map(cleanupStage => ({ cleanupStage }))), ['command-entry', 'owned-families', 'command-settlements', 'command-closure', 'native-closure']],
      [new AggregateError([getterStage]), ['unknown']], [getterErrors, ['unknown']],
      [new AggregateError([{ cleanupStage: 'PRIVATE-SENTINEL' }]), ['unknown']],
      [new AggregateError([Object.create({ cleanupStage: 'owned-families' })]), ['unknown']],
      [new AggregateError([]), ['unknown']], [Error('PRIVATE-SENTINEL'), ['unknown']],
      [Object.defineProperty(new AggregateError([]), 'errors', { value: getterEntry }), ['unknown']],
      [new AggregateError(Array.from({ length: 6 }, () => valid)), ['owned-families', 'unknown']],
      [new Proxy({}, { getOwnPropertyDescriptor: secret, getPrototypeOf: secret }), ['unknown']],
      [inheritedProxy, ['unknown']],
    ]
    for (const [error, executionFailures] of cases) {
      const f = fixture(); f.control.settleAll = async () => { throw error }
      await expect(runContextualTestRehearsalController(f.admission as never, f.control, f.edges as never)).rejects.toThrow()
      expect(f.receipts[0]).toMatchObject({ ownedSettled: false, cleanup: { executionSettlement: 'failed', unchanged: 'not-run', executionFailures } })
      expect(JSON.stringify(f.receipts)).not.toContain('PRIVATE-SENTINEL')
    }
    // Neither accessors nor Proxy traps may execute while projecting labels.
    expect(reads).toBe(0)
  })
  it('attempts captured families and command joins even when cleanup entry and closure reject', async () => {
    const f = fixture()
    f.control.command.beginCleanup = () => { f.events.push('entry-failed'); throw Error('private entry detail') }
    f.control.command.joinSettlements = async () => { f.events.push('join-failed'); throw Error('private join detail') }
    f.control.command.assertClosed = () => { f.events.push('closure-failed'); throw Error('private closure detail') }
    await expect(runContextualTestRehearsalController(f.admission as never, f.control, f.edges as never)).rejects.toThrow()
    expect(f.events).toContain('settle'); expect(f.events).toContain('join-failed'); expect(f.events).toContain('closure-failed')
    expect(f.events).not.toContain('exact-disposal')
    expect(f.receipts[0]).toMatchObject({ outcome: 'failed', ownedSettled: false, cleanupEnd: 361001 })
    expect(f.receipts[0]).toMatchObject({ cleanup: { entry: 'failed', executionSettlement: 'passed', commandJoins: 'failed',
      commandClosure: 'failed', sqlClosure: 'passed', unchanged: 'not-run', executionFailures: [] } })
    expect(JSON.stringify(f.receipts)).not.toContain('private')
  })
  it('does not start PW or retry when app ready fails', async () => {
    const f = fixture(); f.control.launchApp = async () => ({ async ready() { throw Error('not ready') } })
    await expect(runContextualTestRehearsalController(f.admission as never, f.control, f.edges as never)).rejects.toThrow()
    expect(f.events).not.toContain('pw-spawn'); expect(f.events.filter(e => e === 'attempt')).toHaveLength(1)
  })
  it.each([61000, 2340998])('captures one cleanup reserve at the early/late failure time %i', async cleanupStart => {
    const f = fixture(), ends: number[] = []
    f.control.launchApp = async () => ({ async ready() { f.control.now = () => cleanupStart; throw Error('case failed') } })
    f.control.settleAll = async end => { ends.push(end) }
    await expect(runContextualTestRehearsalController(f.admission as never, f.control, f.edges as never)).rejects.toThrow()
    const end = Math.min(f.admission.cleanupDeadline, cleanupStart + 360000)
    expect(ends).toEqual([end]); expect(f.receipts[0]).toMatchObject({ outcome: 'failed', cleanupStartedAt: cleanupStart, cleanupEnd: end })
    expect(end - cleanupStart).toBeLessThanOrEqual(360000)
  })
  it('blocks exact disposal when the owned SQL marker cannot be cleared', async () => {
    const f = fixture(); f.edges.assertSqlSettled = () => { throw Error('unjoined SQL') }
    await expect(runContextualTestRehearsalController(f.admission as never, f.control, f.edges as never)).rejects.toThrow()
    expect(f.events).not.toContain('exact-disposal')
    expect(f.receipts[0]).toMatchObject({ outcome: 'failed', ownedSettled: false })
    expect(f.receipts[0]).toMatchObject({ cleanup: { sqlClosure: 'failed', unchanged: 'not-run' } })
  })
  it('rejects wrong metadata target before any native readiness or evidence write', async () => {
    const f = fixture(); f.admission.assignmentMetadata.manifest.syntheticTag = 'assignmentlist_deadbeef0000'
    await expect(runContextualTestRehearsalController(f.admission as never, f.control, f.edges as never)).rejects.toThrow()
    expect(f.events).toEqual([])
  })
  it('joins native command settlements before accepting owned closure/disposal', async () => {
    const f = fixture(); await runContextualTestRehearsalController(f.admission as never, f.control, f.edges as never)
    expect(f.events.indexOf('settle')).toBeLessThan(f.events.indexOf('join-settlements'))
    expect(f.events.indexOf('join-settlements')).toBeLessThan(f.events.indexOf('commands-closed'))
    expect(f.events.indexOf('commands-closed')).toBeLessThan(f.events.indexOf('exact-disposal'))
  })
  it('a later clean lifecycle return cannot mask an earlier work failure', async () => {
    const f = fixture(); let verifies = 0
    f.edges.createAdapters = () => ({ async verifyEphemeral() { if (++verifies === 2) throw Error('private source drift'); return { projectId, containerId: 'f'.repeat(64), dbPort: 54332, applicationName: `${projectId}_fixture`, guard168Enabled: true, persistedGatesOff: true, activeNetworkCronAbsent: true } } })
    const original = f.edges.lifecycle
    f.edges.lifecycle = async (...args: Parameters<typeof original>) => { try { await original(...args) } catch { /* intentionally broken CPU seam */ } }
    await expect(runContextualTestRehearsalController(f.admission as never, f.control, f.edges as never)).rejects.toThrow()
    expect(f.receipts[0]).toMatchObject({ outcome: 'failed', firstFailureStage: 'proof', ownedSettled: true, playwrightValidated: true })
  })
  it('retains bounded failed ledger flags after proven settlement but never accepts them', async () => {
    const f = fixture(), base = f.edges.createLedger
    f.edges.createLedger = () => ({ ...base(), snapshot() { return { ...base().snapshot(), flags: { denied: true, capExceeded: false, expired: false, uncertain: false } } } })
    await expect(runContextualTestRehearsalController(f.admission as never, f.control, f.edges as never)).rejects.toThrow()
    expect(f.receipts[0]).toMatchObject({ outcome: 'failed', firstFailureStage: 'proof', ownedSettled: true, server: { flags: { denied: true } } })
  })
  it('rejects failed/partial browser receipts even with positive CLI exit0', async () => {
    const f = fixture(), base = f.edges.readPlaywrightReceipt
    f.edges.readPlaywrightReceipt = () => ({ ...base(), contextsClosed: false, pending: 1 })
    await expect(runContextualTestRehearsalController(f.admission as never, f.control, f.edges as never)).rejects.toThrow()
    expect(f.receipts[0]).toMatchObject({ outcome: 'failed', firstFailureStage: 'proof', playwrightValidated: false })
  })
  it('exclusive attempt failure dispatches no lifecycle or retry', async () => {
    const f = fixture(); let attempts = 0
    f.edges.openEvidence = () => { attempts++; throw Error('exists') }
    await expect(runContextualTestRehearsalController(f.admission as never, f.control, f.edges as never)).rejects.toThrow()
    expect(attempts).toBe(1); expect(f.events).not.toContain('lifecycle-before'); expect(f.receipts).toHaveLength(0)
  })
  it('retains the original admitted clock even if the caller changes its object during readiness', async () => {
    const f = fixture(), originalEnd = f.admission.cleanupDeadline
    const originalLedger = f.edges.createLedger().snapshot(), originalReceipt = f.edges.readPlaywrightReceipt()
    f.edges.createLedger = () => ({ reserveAppReadiness() {}, snapshot: () => originalLedger })
    f.edges.readPlaywrightReceipt = () => originalReceipt
    f.control.assertReady = async () => { f.admission.deadline += 1000; f.admission.cleanupDeadline += 1000 }
    f.control.settleAll = async end => { f.events.push('settle'); expect(end).toBe(Math.min(originalEnd, 1001 + 360000)) }
    await runContextualTestRehearsalController(f.admission as never, f.control, f.edges as never)
    expect(f.receipts[0]).toMatchObject({ deadline: 2341000, cleanupDeadline: 2701000 })
  })
  it('rejects an expired original work deadline before readiness or attempt allocation', async () => {
    const f = fixture(); f.control.now = () => f.admission.deadline
    await expect(runContextualTestRehearsalController(f.admission as never, f.control, f.edges as never)).rejects.toThrow()
    expect(f.events).toEqual([]); expect(f.receipts).toHaveLength(0)
  })
  it('returned terminal receipt and retained counter projection cannot mutate later', async () => {
    const f = fixture(), state = f.edges.createLedger().snapshot()
    f.edges.createLedger = () => ({ reserveAppReadiness() {}, snapshot: () => state })
    const receipt = await runContextualTestRehearsalController(f.admission as never, f.control, f.edges as never)
    state.flags.denied = true
    expect(receipt.server?.flags.denied).toBe(false)
    expect(Object.isFrozen(receipt)).toBe(true); expect(Object.isFrozen(receipt.server)).toBe(true); expect(Object.isFrozen(receipt.server?.flags)).toBe(true)
    expect(receipt).toMatchObject({ cleanup: { entry: 'passed', executionSettlement: 'passed', commandJoins: 'passed',
      commandClosure: 'passed', sqlClosure: 'passed', unchanged: 'passed', executionFailures: [] } })
    expect(Object.isFrozen(receipt.cleanup)).toBe(true); expect(Object.isFrozen(receipt.cleanup.executionFailures)).toBe(true)
  })
  it('a receipt write failure never returns a successful controller outcome', async () => {
    const f = fixture(); f.edges.writeReceipt = () => { throw Error('private filesystem failure') }
    await expect(runContextualTestRehearsalController(f.admission as never, f.control, f.edges as never)).rejects.toThrow('Private contextual Test controller failed')
  })
  it('verifies all 16 actual private PNG files and rejects missing, unsafe, altered or duplicate evidence', async () => {
    const f = fixture(), outputDir = mkdtempSync(join(realpathSync(tmpdir()), 'contextual-controller-cpu-'))
    chmodSync(outputDir, 0o700)
    try {
      await runContextualTestRehearsalController(f.admission as never, f.control, f.edges as never)
      const binding = { ...f.bound(), outputDir }, receipt = f.edges.readPlaywrightReceipt()
      const output = join(outputDir, 'playwright'); mkdirSync(output, { mode: 0o700 })
      const bytes = Buffer.from([137,80,78,71,13,10,26,10,0]), digest = createHash('sha256').update(bytes).digest('hex')
      receipt.artifacts.forEach(artifact => { artifact.bytes = bytes.length; artifact.sha256 = digest; writeFileSync(join(output, `${artifact.label}.png`), bytes, { mode: 0o600, flag: 'wx' }) })
      const verify = () => verifyContextualTestArtifacts(binding as never, receipt)
      expect(verify).not.toThrow()
      const file = join(output, `${receipt.artifacts[0].label}.png`)
      chmodSync(file, 0o644); expect(verify).toThrow(); chmodSync(file, 0o600)
      writeFileSync(file, Buffer.from([137,80,78,71,13,10,26,10,1])); expect(verify).toThrow()
      writeFileSync(file, bytes); receipt.artifacts[0].bytes++; expect(verify).toThrow(); receipt.artifacts[0].bytes--
      unlinkSync(file); expect(verify).toThrow()
      symlinkSync(join(output, `${receipt.artifacts[1].label}.png`), file); expect(verify).toThrow(); unlinkSync(file)
      writeFileSync(file, bytes, { mode: 0o600, flag: 'wx' })
      receipt.artifacts[0].label = receipt.artifacts[1].label; expect(verify).toThrow()
      receipt.artifacts[0].label = 'ownerTeacher-desktop-light'
      chmodSync(output, 0o755); expect(verify).toThrow(); chmodSync(output, 0o700)
      expect(verify).not.toThrow()
    } finally { rmSync(outputDir, { recursive: true, force: true }) }
  })
})
