import { describe, expect, it } from 'vitest'
import { createContextualTestPlan, type RehearsalWitness, type ContextualTestProofScope } from '../../e2e/helpers/contextual-test-rehearsal'
import { gradeReturnActors, gradeReturnLabels } from '../../e2e/helpers/contextual-test-grade-return-contract'
import type { GradeReturnWitness } from '../../scripts/contextual-test-grade-return-proof'
import { runContextualTestRehearsalController, validateContextualTestPlaywrightReceipt,
  type ContextualTestControllerLaunch } from '../../scripts/contextual-test-rehearsal-controller'
import type { ContextualTestRunBinding } from '../../scripts/contextual-test-rehearsal-binding'
import type { ContextualTestGatewayReceipt } from '../../scripts/contextual-test-rehearsal-gateway'
import { contextualTestLifecycleFixture } from '../helpers/contextual-test-lifecycle-fixture'

const projectId = 'pika_assignment_list_123456abcdef', plan = createContextualTestPlan(projectId)
const id = (n: number) => `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`
function fixture(proofScope: ContextualTestProofScope = 'vertical-v1') {
  const plan = createContextualTestPlan(projectId, proofScope), successor = proofScope === 'vertical-grade-return-v1'
  const events: string[] = [], receipts: Record<string, unknown>[] = [], launches: ContextualTestControllerLaunch[] = []
  const source = { repository: '/frozen', head: plan.sourceSha, tree: plan.sourceTree, sha256: 'a'.repeat(64), entries: [], bytes: 0 }
  const admission = { version: 1, proofScope, projectId, nonce: '0'.repeat(20) + '123456abcdef',
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
    denials: { ownerLearner: 403, memberTeacher: 403, nonmemberRead: 403 }, ...(successor ? { gradeReturn: {
      testId: id(1), questionIds: [id(2),id(3)], ownerId: plan.actors.ownerStudent.id, memberId: plan.actors.memberTeacher.id,
      mcResponseId: id(5), mcRevision: 1, responseId: id(6), initialRevision: 1, revision: 2, score: 4, feedback: 'Reviewed manually',
      returnedAt: new Date(1800).toISOString(), hiddenBeforeReturn: true, memberSawReturned: true } } : {}) }
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
  if (successor) {
    (before as GradeReturnWitness).grade_return = { protected_graph_sha256: 'a'.repeat(64), responses: [], attempt_actors: [], access: [] }
    after.attempts[0].returned_at = result.gradeReturn!.returnedAt
    ;(after as GradeReturnWitness).grade_return = { protected_graph_sha256: 'a'.repeat(64),
      responses: [0,1].map(i => ({ id: id(i ? 6 : 5), test_id: id(1), question_id: id(i ? 3 : 2), student_id: result.memberId,
        revision: i ? 2 : 1, score: i ? 4 : 5, feedback: i ? 'Reviewed manually' : null, selected_option: i ? null : 1,
        response_text: i ? 'Synthetic reasoning: Beta is the second option.' : null, graded_at: new Date(1600).toISOString(), graded_by: i ? result.ownerId : null })),
      attempt_actors: [{ id: id(4), returned_by: result.ownerId }], access: [{ test_id: id(1), student_id: result.memberId, state: 'closed' }] }
  }
  const raw = { version: 1, proofScope, projectId, nonce: admission.nonce,
    sourceSha: plan.sourceSha, sourceTree: plan.sourceTree, appOverlaySha256: plan.appOverlaySha256,
    deadline: admission.deadline, endedAt: 2000, outcome: 'passed', contextsClosed: true, pageErrors: 0,
    actors: successor ? [...gradeReturnActors] : ['ownerStudent','memberTeacher','nonmember','ownerStudent'], result, failureStage: null,
    artifacts: (successor ? [...gradeReturnLabels] : ['vertical-owner-author','vertical-member-submitted','vertical-owner-results']).map(label => ({ label, kind: 'png', bytes: 1, sha256: 'a'.repeat(64) })) }
  const lifecycle = proofScope === 'lifecycle-permissions-v1'
    ? contextualTestLifecycleFixture({ projectId, startedAt: admission.startedAt,
      deadline: admission.deadline, nonce: admission.nonce }) : undefined
  const acceptedBefore = lifecycle?.before ?? before, acceptedAfter = lifecycle?.after ?? after
  const acceptedReceipt = lifecycle?.receipt ?? raw
  let bound: ContextualTestRunBinding | undefined, witnessReads = 0
  const gateway: ContextualTestGatewayReceipt = { version: 1, firstFailure: null, appRequests: 50, apiRequests: 100, creates: lifecycle ? 2 : 1,
    rejectedHmr: 0, rejectedDiagnostics: 0, firstEndpointFailure: null, firstOwnerRpcRejection: null, started: true, closing: true, closed: true, pending: 0, sockets: 0,
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
      return kind === (lifecycle ? 'lifecycleWitness' : successor ? 'gradeReturnWitness' : 'witness')
        ? JSON.stringify(witnessReads++ === 0 ? acceptedBefore : acceptedAfter) : '{}'
    },
    assertSqlSettled() {}, createLedger() { throw Error('Old egress ledger must not run') },
    createGateways: () => gateways, readPlaywrightReceipt: () => acceptedReceipt,
    readStartupReport() { throw Error('Full startup evidence must not run') },
    verifyArtifacts() { events.push('artifacts') }, writeReceipt(receipt: Record<string, unknown>) { receipts.push(receipt) },
  }
  const run = () => runContextualTestRehearsalController(admission as never, control, edges as never)
  return { run, events, receipts, launches, gateways, gateway, before: acceptedBefore, after: acceptedAfter,
    raw: acceptedReceipt, admission, control, edges, bound: () => bound! }
}

describe('vertical controller integration (CPU seams only, no native proof)', () => {
  it('uses the distinct lifecycle receipt and host-only witness with unchanged cleanup and sandbox controls', async () => {
    const f = fixture('lifecycle-permissions-v1'), receipt = await f.run()
    expect(receipt).toMatchObject({ outcome: 'passed', proofScope: 'lifecycle-permissions-v1',
      databaseValidated: true, playwrightValidated: true, ownedSettled: true, server: null })
    expect(f.bound()).toMatchObject({ proofScope: 'lifecycle-permissions-v1',
      sourceSha: '4e9c809d1c905a0482fb67880e056e5b8bc5f786',
      sourceTree: '4d225a92b8d9dcfb8cc7118e989c63a46a3c5fbb',
      migrationChainSha256: '16dfffc916b245a55e7f6750ff26ae274b5f76b696404c6c9995401b38a1c2e0' })
    expect(f.bound()).not.toHaveProperty('sqlControl')
    expect(f.events.filter(e => e === 'sql-lifecycleWitness')).toHaveLength(2)
    expect(f.events).not.toContain('sql-gradeReturnWitness')
    expect(f.events).not.toContain('sql-witness')
    expect(f.events.indexOf('gateway-close')).toBeLessThan(f.events.lastIndexOf('sql-lifecycleWitness'))
    expect(f.events.indexOf('settle')).toBeLessThan(f.events.indexOf('disposal'))
    expect(f.launches[0].dependencySandboxProfile).toContain('(deny network*)')
    expect(f.launches[1].dependencySandboxProfile).toContain('(remote tcp4 "localhost:3117")')
    expect(f.launches[1].dependencySandboxProfile).not.toContain('54340')
  })
  it('rejects lifecycle browser success when the retained committed graph does not match', async () => {
    const f = fixture('lifecycle-permissions-v1'); f.after.response_count = 0
    await expect(f.run()).rejects.toThrow()
    expect(f.receipts[0]).toMatchObject({ outcome: 'failed', proofScope: 'lifecycle-permissions-v1',
      databaseValidated: false, ownedSettled: true })
    expect(f.events).toContain('disposal')
  })
  it('rejects lifecycle claims without both gateway-observed Test creates', async () => {
    const f = fixture('lifecycle-permissions-v1'); f.gateways.receipt = () => ({ ...f.gateway, creates: 1 })
    await expect(f.run()).rejects.toThrow()
    expect(f.receipts[0]).toMatchObject({ outcome: 'failed', databaseValidated: false, ownedSettled: true })
  })
  it('uses successor source, root-only extended witnesses and the same sealed network/process cleanup path', async () => {
    const f = fixture('vertical-grade-return-v1'), receipt = await f.run()
    expect(receipt).toMatchObject({ outcome: 'passed', proofScope: 'vertical-grade-return-v1', databaseValidated: true,
      sourceSha: 'eb4fa32b237d45f500ea4a67ade9a9e5290ea1c0', server: null })
    expect(f.bound()).toMatchObject({ proofScope: 'vertical-grade-return-v1', migrationChainSha256: '9f08b2db28b413c6f00b3021597d5cd0271600b0d8039abf46f84b50c318b4bd' })
    expect(f.bound()).not.toHaveProperty('sqlControl')
    expect(f.events.filter(e => e === 'sql-gradeReturnWitness')).toHaveLength(2)
    expect(f.events).not.toContain('sql-witness')
    expect(f.events.indexOf('gateway-close')).toBeLessThan(f.events.lastIndexOf('sql-gradeReturnWitness'))
    expect(f.launches[0].listenerPort).toBe(3118)
    expect(f.launches[0].env.VERCEL_GIT_COMMIT_SHA).toBe(f.bound().sourceSha)
    expect(f.launches[0].dependencySandboxProfile).toContain('(deny network*)')
    expect(f.launches[1].dependencySandboxProfile).toContain('(remote tcp4 "localhost:3117")')
  })
  it('cannot accept successor browser success with an unreturned database attempt', async () => {
    const f = fixture('vertical-grade-return-v1'); f.after.attempts[0].returned_at = null
    await expect(f.run()).rejects.toThrow()
    expect(f.receipts[0]).toMatchObject({ outcome: 'failed', databaseValidated: false, proofScope: 'vertical-grade-return-v1', ownedSettled: true })
  })
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
    expect(browser.env.MAC_CHROMIUM_TMPDIR).toBe(browser.env.TMPDIR)
    expect(browser.env.MAC_CHROMIUM_TMPDIR).toBe(`${f.bound().workdir}/tmp`)
    expect(app.env).not.toHaveProperty('MAC_CHROMIUM_TMPDIR')
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
