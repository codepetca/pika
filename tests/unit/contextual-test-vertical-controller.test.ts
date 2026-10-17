import { describe, expect, it } from 'vitest'
import { createContextualTestPlan, type RehearsalWitness } from '../../e2e/helpers/contextual-test-rehearsal'
import { runContextualTestRehearsalController, validateContextualTestPlaywrightReceipt,
  type ContextualTestControllerLaunch } from '../../scripts/contextual-test-rehearsal-controller'
import type { ContextualTestRunBinding } from '../../scripts/contextual-test-rehearsal-binding'
import type { ContextualTestGatewayReceipt } from '../../scripts/contextual-test-rehearsal-gateway'

const projectId = 'pika_assignment_list_123456abcdef', plan = createContextualTestPlan(projectId)
const id = (n: number) => `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`
function fixture() {
  const events: string[] = [], receipts: Record<string, unknown>[] = [], launches: ContextualTestControllerLaunch[] = []
  const source = { repository: '/frozen', head: plan.sourceSha, tree: plan.sourceTree, sha256: 'a'.repeat(64), entries: [], bytes: 0 }
  const admission = { version: 1, proofScope: 'vertical-v1', projectId, nonce: '0'.repeat(20) + '123456abcdef',
    migrationChainSha256: plan.migrationChainSha256, startedAt: 1000, deadline: 2341000, cleanupDeadline: 2701000,
    workdir: '/private/tmp/pika-assignment-list-123456abcdef', appDir: '/private/tmp/pika-assignment-list-123456abcdef/app', outputDir: '/private/tmp/vertical-output',
    password: 'synthetic-private-password', sessionSecret: 's'.repeat(64), frozen: source,
    runner: { ...source, repository: '/runner', head: 'b'.repeat(40), tree: 'c'.repeat(40) },
    review: { manifestSha256: 'd'.repeat(64), runnerHead: 'b'.repeat(40), runnerTree: 'c'.repeat(40) },
    dependencies: { root: '/deps', sha256: 'e'.repeat(64), roots: ['/deps'] },
    transportPins: { docker: { path: '/pin/docker', sha256: 'b'.repeat(64) }, dockerHost: 'unix:///private/tmp/docker.sock', socketIdentity: [1,2,3,4], outputDir: '/private/tmp/vertical-output' },
    assignmentMetadata: { manifest: { syntheticTag: 'assignmentlist_123456abcdef' } }, migrations: [],
  }
  const token = (role: string) => `header.${Buffer.from(JSON.stringify({ iss: 'supabase-demo', role })).toString('base64url')}.signature`
  const status = { API_URL: plan.apiOrigin, DB_URL: 'postgresql://postgres:demo@127.0.0.1:54332/postgres', ANON_KEY: token('anon'), SERVICE_ROLE_KEY: token('service_role') }
  const result = { testId: id(1), questionIds: [id(2), id(3)], ownerId: plan.actors.ownerStudent.id,
    memberId: plan.actors.memberTeacher.id, classroomId: plan.classrooms.classB.id, submitted: true, ownerSawResponse: true,
    denials: { ownerLearner: 403, memberTeacher: 403, nonmemberRead: 403 } }
  const before: RehearsalWitness = { version: 1, work_graph_sha256: 'a'.repeat(64), tests: plan.retiredTestIds.map((testId, i) => ({ id: testId,
    classroom_id: i ? plan.classrooms.classB.id : plan.classrooms.classA.id, status: 'draft', position: 0, retired: true })),
    attempts: [], memberships: [], generations: [], question_counts: [],
    classes: [plan.classrooms.classA, plan.classrooms.classB].map(c => ({ id: c.id, archived_at: null, updated_at: new Date(1000).toISOString() })),
    response_count: 0, history_count: 0, objects: [] }
  const after: RehearsalWitness = { ...structuredClone(before), tests: [...structuredClone(before.tests),
    { id: result.testId, classroom_id: result.classroomId, status: 'closed', position: 1, retired: false }],
    attempts: [{ id: id(4), test_id: result.testId, student_id: result.memberId, draft_revision: 3, is_submitted: true, returned_at: null }],
    question_counts: [{ test_id: result.testId, count: 2 }], response_count: 2, history_count: 2 }
  after.classes[1].updated_at = new Date(1500).toISOString()
  const raw = { version: 1, proofScope: 'vertical-v1', projectId, nonce: admission.nonce,
    sourceSha: plan.sourceSha, sourceTree: plan.sourceTree, appOverlaySha256: plan.appOverlaySha256,
    deadline: admission.deadline, endedAt: 2000, outcome: 'passed', contextsClosed: true, pageErrors: 0,
    actors: ['ownerStudent','memberTeacher','nonmember','ownerStudent'], result, failureStage: null,
    artifacts: ['vertical-owner-author','vertical-member-submitted','vertical-owner-results'].map(label => ({ label, kind: 'png', bytes: 1, sha256: 'a'.repeat(64) })) }
  let bound: ContextualTestRunBinding | undefined, witnessReads = 0
  const gateway: ContextualTestGatewayReceipt = { version: 1, firstFailure: null, appRequests: 50, apiRequests: 100, creates: 1,
    rejectedHmr: 0, started: true, closing: true, closed: true, pending: 0, sockets: 0,
    jsonResponses: 50, responses: 50, requestBytes: 100, responseBytes: 100 }
  const gateways = { async start() { events.push('gateway-start') }, check() { events.push('gateway-check') },
    async close(end: number) { events.push('gateway-close'); expect(end).toBe(31001) }, receipt: () => gateway }
  const control = {
    now: () => 1001, async assertReady() {}, async assertUnchanged() { events.push('unchanged') },
    // A root SQL capability must never enter the narrow browser binding.
    sqlControl: { nativePins: {}, transportPins: {} } as never,
    command: { run: async () => '', beginCleanup() {}, async joinSettlements() {}, assertClosed() {},
      state: () => ({ poisoned: false, fault: false, pending: 0, cleaning: true }) },
    async launchApp(input: ContextualTestControllerLaunch) { launches.push(input); events.push('app'); return { async ready() { events.push('ready') } } },
    async launchPlaywright(input: ContextualTestControllerLaunch) { launches.push(input); events.push('browser'); return { async wait() { events.push('browser-closed'); return { code: 0, signal: null, closed: true } } } },
    async settleAll() { events.push('settle') },
  }
  const adapters = { async verifyEphemeral() { return { containerId: 'f'.repeat(64), guard168Enabled: true, persistedGatesOff: true, activeNetworkCronAbsent: true } } }
  const edges = {
    openEvidence() {}, prepareApp() {}, createAdapters: () => adapters,
    async lifecycle(_a: unknown, _m: unknown, _adapters: unknown, work: (...args: unknown[]) => Promise<void>, settle: () => Promise<void>) {
      try { await work(status, [{ kind: 'container', id: 'f'.repeat(64), name: `supabase_db_${projectId}`,
        labels: { 'com.supabase.cli.project': projectId, 'com.docker.compose.project': projectId }, ports: [54332] }], status) }
      finally { await settle(); events.push('disposal') }
    },
    bind(binding: ContextualTestRunBinding) { bound = binding; return { binding, file: `${admission.outputDir}/run-binding.json`, sha256: 'a'.repeat(64) } },
    async passwordHash() { return 'synthetic-bcrypt' },
    async sql(_binding: unknown, kind: string, _hash: unknown, transport: unknown) {
      expect(transport).toBe(control.command); events.push(`sql-${kind}`)
      return kind === 'witness' ? JSON.stringify(witnessReads++ === 0 ? before : after) : '{}'
    },
    assertSqlSettled() {}, createLedger() { throw Error('Old egress ledger must not run') },
    createGateways: () => gateways, readPlaywrightReceipt: () => raw,
    readStartupReport() { throw Error('Full startup evidence must not run') },
    verifyArtifacts() { events.push('artifacts') }, writeReceipt(receipt: Record<string, unknown>) { receipts.push(receipt) },
  }
  const run = () => runContextualTestRehearsalController(admission as never, control, edges as never)
  return { run, events, receipts, launches, gateways, gateway, before, after, raw, admission, control, edges, bound: () => bound! }
}

describe('vertical controller integration (CPU seams only, no native proof)', () => {
  it('binds one narrow proof, root-only witnesses, isolated launches and gateway-first cleanup', async () => {
    const f = fixture(), receipt = await f.run()
    expect(receipt).toMatchObject({ outcome: 'passed', proofScope: 'vertical-v1', databaseValidated: true, playwrightValidated: true,
      ownedSettled: true, gateway: { closed: true, pending: 0, sockets: 0 }, server: null, startup: null })
    expect(f.bound()).toMatchObject({ proofScope: 'vertical-v1' }); expect(f.bound()).not.toHaveProperty('sqlControl')
    expect(f.events.filter(e => e === 'sql-witness')).toHaveLength(2)
    expect(f.events.indexOf('sql-witness')).toBeLessThan(f.events.indexOf('gateway-start'))
    expect(f.events.indexOf('gateway-start')).toBeLessThan(f.events.indexOf('app'))
    expect(f.events.lastIndexOf('sql-witness')).toBeGreaterThan(f.events.indexOf('browser-closed'))
    expect(f.events.indexOf('gateway-close')).toBeLessThan(f.events.lastIndexOf('sql-witness'))
    expect(f.events.indexOf('gateway-close')).toBeLessThan(f.events.indexOf('settle'))
    expect(f.events.indexOf('settle')).toBeLessThan(f.events.indexOf('disposal'))
    const [app, browser] = f.launches
    expect(app.listenerPort).toBe(3118)
    expect(app.env).toMatchObject({ NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54340', ENABLE_UI_GALLERY: 'false' })
    for (const key of ['NODE_OPTIONS','PIKA_CONTEXTUAL_TEST_BINDING_FILE','PIKA_CONTEXTUAL_TEST_BINDING_SHA256']) expect(app.env).not.toHaveProperty(key)
    expect(browser.env.PIKA_CONTEXTUAL_TEST_VERTICAL).toBe('true')
    expect(browser.args.join(' ')).not.toContain('preload')
    expect(app.dependencySandboxProfile).toContain('(remote tcp4 "localhost:54340")')
    expect(browser.dependencySandboxProfile).toContain('(remote tcp4 "localhost:3117")')
    expect(browser.dependencySandboxProfile).not.toContain('54340')
    expect(() => validateContextualTestPlaywrightReceipt(f.raw, f.bound())).toThrow()
  })
  it('cannot promote browser success without the actual expected database state', async () => {
    const f = fixture(); f.after.response_count = 0
    await expect(f.run()).rejects.toThrow()
    expect(f.receipts[0]).toMatchObject({ outcome: 'failed', proofScope: 'vertical-v1', databaseValidated: false, ownedSettled: true })
    expect(f.events).toContain('gateway-close'); expect(f.events).toContain('disposal')
  })
  it('settles owned processes even when gateway closure fails, without certifying disposal', async () => {
    const f = fixture(); f.gateways.close = async () => { f.events.push('gateway-close'); throw Error('closure failed') }
    await expect(f.run()).rejects.toThrow()
    expect(f.events.indexOf('gateway-close')).toBeLessThan(f.events.indexOf('settle'))
    expect(f.events).not.toContain('disposal')
    expect(f.receipts[0]).toMatchObject({ outcome: 'failed', ownedSettled: false, cleanup: { executionSettlement: 'passed' } })
  })
  it('closes partially started gateways and settles native ownership after startup failure', async () => {
    const f = fixture(); f.gateways.start = async () => { throw Error('startup failed') }
    await expect(f.run()).rejects.toThrow()
    expect(f.events).not.toContain('app'); expect(f.events).toContain('gateway-close'); expect(f.events).toContain('settle')
    expect(f.receipts[0]).toMatchObject({ outcome: 'failed', databaseValidated: false })
  })
  it('retains a policy failure after proved closure without withholding safe disposal', async () => {
    const f = fixture(); f.gateways.receipt = () => ({ ...f.gateway, firstFailure: 'endpoint' })
    await expect(f.run()).rejects.toThrow()
    expect(f.events).toContain('disposal')
    expect(f.events.filter(e => e === 'sql-witness')).toHaveLength(1)
    expect(f.receipts[0]).toMatchObject({ outcome: 'failed', ownedSettled: true, gateway: { closed: true, firstFailure: 'endpoint' } })
  })
})
