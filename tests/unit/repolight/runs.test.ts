import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => { throw new Error('No live database allowed') }) }))
import wire from './fixture.json'
import { sourceFixture } from './adapter-fixtures'
import { digestRepoLightJson, prepareRepoLightCreate, RepoLightClientError, type RepoLightClient } from '@/lib/server/repolight-client'
import { beginAssignmentRepoLightRun, advanceAssignmentRepoLightRun, getAssignmentRepoLightContext, getAssignmentRepoLightReport, getAssignmentRepoLightRun, readRepoLightRequestJson, parseRepoLightRun, type RepoLightDependencies } from '@/lib/server/assignment-repolight-runs'
import { importAssignmentRepoLightFeedback } from '@/lib/server/assignment-repolight-import'
import { ManagedRepoLightError } from '@/lib/server/repolight-managed'
const uuid = (n: number) => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`
function setup() {
  const source = sourceFixture(); source.artifacts[0].url = wire.envelope.request.repositoryUrl
  const actor = source.classroom.teacher_id, target = { assignmentId: source.assignment.id, studentId: source.enrollment.student_id }
  const prepared = prepareRepoLightCreate({ ...wire.envelope, clientBinding: { ...wire.envelope.clientBinding, sourceRevisionRef: digestRepoLightJson(source) } })
  let row = { id: uuid(20), subject_binding_id: uuid(21) as string | null, detached: false, classroom_id: source.assignment.classroom_id, assignment_id: target.assignmentId, student_id: target.studentId, actor_id: actor, source_json: source, source_fingerprint: digestRepoLightJson(source), connection_json: { connectionRef: 'connection-1', workspaceRef: 'customer_1', installationRef: 'pika-installation' }, request_json: prepared.envelope.request, create_envelope: prepared.envelope, request_fingerprint: prepared.requestFingerprint, idempotency_key: `pika-${uuid(20)}`, analysis_id: null as string | null, status: 'queued', attempt_count: 0, next_retry_at: null as string | null, lease_token: null as string | null, lease_generation: 0, lease_expires_at: null as string | null, error_code: null, created_at: '2026-10-24T12:00:00Z', completed_at: null, source_current: true, report: undefined as unknown }
  const response = () => Promise.resolve({ data: structuredClone(row), error: null })
  const database = { source: vi.fn(async () => ({ data: { source, source_fingerprint: digestRepoLightJson(source), latest_run: null }, error: null })), read: vi.fn(response), begin: vi.fn(response), advance: vi.fn(async (args: { p_action: string }) => {
    if (args.p_action === 'claim') row = { ...row, status: row.analysis_id ? 'running' : 'submitting', attempt_count: row.attempt_count + (row.analysis_id ? 0 : 1), lease_token: uuid(22), lease_generation: row.lease_generation + 1, lease_expires_at: '2026-10-24T12:01:30Z' }
    if (args.p_action === 'poll_pending') row = { ...row, status: 'running', lease_token: null, lease_expires_at: null, next_retry_at: '2026-10-24T12:00:05Z' }
    return response()
  }), importFeedback: vi.fn() }
  const connection = { ...row.connection_json, teacherId: actor, apiKey: `rl_v2_${uuid(23)}.${'x'.repeat(43)}`, active: true }
  const remote = { createAnalysis: vi.fn(async () => ({ analysisId: wire.bundle.bundleRef })), reconcileAnalysis: vi.fn(async () => ({ analysisId: wire.bundle.bundleRef })), getStatus: vi.fn(async () => ({ status: 'running' })), getResult: vi.fn(), eraseSubject: vi.fn(), verifyConnection: vi.fn() }
  const factory = vi.fn(() => remote as unknown as RepoLightClient)
  const deps: RepoLightDependencies = { database, config: () => ({ enabled: true, apiOrigin: 'https://reports.example.test', connections: [connection] }), clientFactory: factory, now: () => new Date('2026-10-24T12:00:00Z') }
  return { source, actor, target, row, database, factory, remote, deps, prepared, connection }
}
function managedSetup(allowed = true) {
  const f = setup()
  const access = { enforced: false, allowed, reason: allowed ? 'eligible' : 'expired', source: 'trial', access_ends_at: null, plan_revision: 2 }
  f.row.connection_json.connectionRef = `pika_managed_${uuid(40)}`
  const connection = { ...f.connection, connectionRef: f.row.connection_json.connectionRef }
  const registry = { ensure: vi.fn(async () => ({ connection, apiOrigin: 'https://reports.example.test' })), resolveSaved: vi.fn(async () => ({ connection, apiOrigin: 'https://reports.example.test' })) }
  f.deps.config = () => ({ enabled: true, managedEnabled: true, apiOrigin: 'https://reports.example.test', connections: [] })
  f.deps.managedRegistry = registry
  f.deps.managedConfig = () => ({ enabled: true, apiOrigin: 'https://reports.example.test', installationRef: connection.installationRef, controlSecret: 'x'.repeat(43), activeEncryptionKeyId: 'key-1', encryptionKeys: { 'key-1': 'y'.repeat(43) } })
  Object.assign(f.row, { analysis_access: access })
  f.database.source.mockImplementation(async () => ({ data: { source: f.source, source_fingerprint: digestRepoLightJson(f.source), latest_run: f.row, analysis_access: access }, error: null }) as never)
  return { ...f, access, registry, connection }
}
describe('managed report integration', () => {
  it('shows eligible unprovisioned owners ready on GET with no registry or provider call', async () => {
    const f = managedSetup()
    f.database.source.mockImplementation(async () => ({ data: { source: f.source, source_fingerprint: digestRepoLightJson(f.source), latest_run: null, analysis_access: f.access }, error: null }) as never)
    expect((await getAssignmentRepoLightContext(f.actor, f.target, f.deps)).state).toBe('ready')
    expect(f.registry.ensure).not.toHaveBeenCalled(); expect(f.registry.resolveSaved).not.toHaveBeenCalled(); expect(f.factory).not.toHaveBeenCalled()
  })
  it('automatically ensures only after actor/source validation, persisting opaque bindings', async () => {
    const f = managedSetup()
    f.database.begin.mockImplementation(async args => {
      const prepared = prepareRepoLightCreate({ schemaVersion: '1.0', request: args.p_request, clientBinding: f.row.create_envelope.clientBinding })
      return { data: { ...f.row, request_json: prepared.envelope.request, create_envelope: prepared.envelope, request_fingerprint: prepared.requestFingerprint }, error: null }
    })
    const view = await beginAssignmentRepoLightRun(f.actor, f.target, { requestId: f.row.id }, f.deps)
    expect(view.canAdvance).toBe(true)
    expect(f.registry.ensure).toHaveBeenCalledExactlyOnceWith(f.actor)
    expect(f.database.source.mock.invocationCallOrder[0]).toBeLessThan(f.registry.ensure.mock.invocationCallOrder[0])
    expect(f.registry.ensure.mock.invocationCallOrder[0]).toBeLessThan(f.database.begin.mock.invocationCallOrder[0])
    expect(f.database.begin.mock.calls[0][0].p_connection).toEqual(f.row.connection_json)
    expect(JSON.stringify(f.database.begin.mock.calls[0][0])).not.toContain(f.connection.apiKey)
  })
  it('requires allowed=true even with dormant enforcement and makes no provisioning call on denial', async () => {
    const f = managedSetup(false)
    expect((await getAssignmentRepoLightContext(f.actor, f.target, f.deps))).toMatchObject({ state: 'access_required', run: { canAdvance: false } })
    await expect(beginAssignmentRepoLightRun(f.actor, f.target, { requestId: f.row.id }, f.deps)).rejects.toMatchObject({ statusCode: 403 })
    expect(f.registry.ensure).not.toHaveBeenCalled(); expect(f.database.begin).not.toHaveBeenCalled()
  })
  it('fails closed on missing access metadata, bad managed configuration, or failed managed provisioning', async () => {
    const f = managedSetup()
    f.database.source.mockImplementation(async () => ({ data: { source: f.source, source_fingerprint: digestRepoLightJson(f.source), latest_run: null }, error: null }))
    await expect(beginAssignmentRepoLightRun(f.actor, f.target, { requestId: f.row.id }, f.deps)).rejects.toMatchObject({ statusCode: 403 })
    expect(f.registry.ensure).not.toHaveBeenCalled()
    const g = managedSetup()
    g.deps.config = () => ({ enabled: true, managedEnabled: true, apiOrigin: 'https://reports.example.test', connections: [g.connection] })
    g.registry.ensure.mockRejectedValue(new ManagedRepoLightError('repolight_managed_provision_failed', true))
    await expect(beginAssignmentRepoLightRun(g.actor, g.target, { requestId: g.row.id }, g.deps)).rejects.toMatchObject({ statusCode: 503 })
    expect(g.database.begin).not.toHaveBeenCalled()
    g.deps.managedConfig = () => { throw new Error('private control configuration') }
    expect((await getAssignmentRepoLightContext(g.actor, g.target, g.deps)).state).toBe('not_configured')
  })
  it('polls known jobs after expiry using saved resolution without provisioning configuration', async () => {
    const f = managedSetup(false); f.row.analysis_id = wire.bundle.bundleRef
    f.deps.config = () => { throw new Error('provisioning config removed') }
    await advanceAssignmentRepoLightRun(f.actor, f.target, f.row.id, f.deps)
    expect(f.registry.resolveSaved).toHaveBeenCalledExactlyOnceWith(f.actor, f.row.connection_json.connectionRef)
    expect(f.registry.ensure).not.toHaveBeenCalled(); expect(f.remote.getStatus).toHaveBeenCalledOnce()
  })
  it.each([0, 1])('denies an expired managed create/reconciliation with dormant enforcement (attempts %s)', async attempts => {
    const f = managedSetup(false); f.row.attempt_count = attempts
    await expect(advanceAssignmentRepoLightRun(f.actor, f.target, f.row.id, f.deps)).rejects.toMatchObject({ statusCode: 403 })
    expect(f.database.advance).not.toHaveBeenCalled(); expect(f.factory).not.toHaveBeenCalled()
  })
  it('creates with real SQL transition shape that omits projected analysis-access metadata', async () => {
    const f = managedSetup()
    f.database.advance.mockImplementation(async args => {
      const { analysis_access: ignored, ...row } = { ...f.row, analysis_access: f.access }
      void ignored
      return { data: { ...row, lease_token: args.p_action === 'claim' ? uuid(22) : null, lease_generation: 1 }, error: null }
    })
    const view = await advanceAssignmentRepoLightRun(f.actor, f.target, f.row.id, f.deps)
    expect(f.remote.createAnalysis).toHaveBeenCalledOnce()
    expect(f.database.read).toHaveBeenCalledTimes(2)
    expect(view.canAdvance).toBe(true)
  })
  it('rechecks managed access with a fresh owner-bound read immediately before egress', async () => {
    const f = managedSetup()
    f.database.read.mockResolvedValueOnce({ data: { ...f.row, analysis_access: f.access }, error: null })
      .mockResolvedValue({ data: { ...f.row, analysis_access: { ...f.access, allowed: false, reason: 'expired' } }, error: null } as never)
    await expect(advanceAssignmentRepoLightRun(f.actor, f.target, f.row.id, f.deps)).rejects.toMatchObject({ statusCode: 403 })
    expect(f.remote.createAnalysis).not.toHaveBeenCalled(); expect(f.remote.reconcileAnalysis).not.toHaveBeenCalled()
  })
  it('rejects a saved connection moved to another workspace before provider access', async () => {
    const f = managedSetup(); f.registry.resolveSaved.mockResolvedValue({ connection: { ...f.connection, workspaceRef: 'other' }, apiOrigin: 'https://reports.example.test' })
    await expect(advanceAssignmentRepoLightRun(f.actor, f.target, f.row.id, f.deps)).rejects.toMatchObject({ statusCode: 503 })
    expect(f.factory).not.toHaveBeenCalled(); expect(f.database.advance).not.toHaveBeenCalled()
  })
})
describe('report-only durable orchestration', () => {
  it('projects an enforced denial for new work while preserving continuation for known jobs', async () => {
    const f = setup()
    const denied = { enforced: true, allowed: false, reason: 'expired', source: 'trial', access_ends_at: '2026-10-24T12:00:00Z', plan_revision: 2 }
    Object.assign(f.row, { analysis_access: denied })
    f.database.source.mockImplementation(async () => ({ data: { source: f.source, source_fingerprint: digestRepoLightJson(f.source), latest_run: f.row, analysis_access: denied }, error: null }) as never)
    const context = await getAssignmentRepoLightContext(f.actor, f.target, f.deps)
    expect(context.state).toBe('access_required'); expect(context.run?.canAdvance).toBe(false)
    expect((await getAssignmentRepoLightRun(f.actor, f.target, f.row.id, f.deps)).canAdvance).toBe(false)
    f.row.analysis_id = wire.bundle.bundleRef; f.row.status = 'running'
    expect((await getAssignmentRepoLightContext(f.actor, f.target, f.deps)).run?.canAdvance).toBe(true)
    expect((await getAssignmentRepoLightRun(f.actor, f.target, f.row.id, f.deps)).canAdvance).toBe(true)
    expect(f.factory).not.toHaveBeenCalled()
  })
  it('preserves the dormant pilot projection even when no plan entitlement is available', async () => {
    const f = setup()
    const dormant = { enforced: false, allowed: false, reason: 'account_unavailable', source: null, access_ends_at: null, plan_revision: null }
    f.database.source.mockImplementation(async () => ({ data: { source: f.source, source_fingerprint: digestRepoLightJson(f.source), latest_run: f.row, analysis_access: dormant }, error: null }) as never)
    const context = await getAssignmentRepoLightContext(f.actor, f.target, f.deps)
    expect(context.state).toBe('ready'); expect(context.run?.canAdvance).toBe(true)
  })
  it('denies an expired new analysis at transaction admission without provider work', async () => {
    const f = setup()
    f.database.begin.mockResolvedValue({ data: null, error: { code: 'P2961', message: 'repolight_analysis_access_required' } } as never)
    await expect(beginAssignmentRepoLightRun(f.actor, f.target, { requestId: f.row.id }, f.deps))
      .rejects.toMatchObject({ statusCode: 403, message: 'repolight_analysis_access_required' })
    expect(f.factory).not.toHaveBeenCalled()
  })
  it.each([0, 1])('denies create or uncertain-create reconciliation before egress (prior attempts %s)', async attemptCount => {
    const f = setup(); f.row.attempt_count = attemptCount
    f.database.advance.mockImplementation(async args => args.p_action === 'authorize'
      ? { data: null, error: { code: 'P2961', message: 'repolight_analysis_access_required' } } as never
      : { data: { ...f.row, lease_token: uuid(22), lease_generation: 1 }, error: null })
    await expect(advanceAssignmentRepoLightRun(f.actor, f.target, f.row.id, f.deps))
      .rejects.toMatchObject({ statusCode: 403, message: 'repolight_analysis_access_required' })
    expect(f.remote.createAnalysis).not.toHaveBeenCalled()
    expect(f.remote.reconcileAnalysis).not.toHaveBeenCalled()
  })
  it('authorizes source and blocks a disabled begin without any external call or RPC mutation', async () => {
    const f = setup(); f.deps.config = () => ({ enabled: false, apiOrigin: null, connections: [] })
    await expect(beginAssignmentRepoLightRun(f.actor, f.target, { requestId: uuid(20) }, f.deps)).rejects.toMatchObject({ statusCode: 503 })
    expect(f.database.source).toHaveBeenCalledOnce(); expect(f.database.begin).not.toHaveBeenCalled(); expect(f.factory).not.toHaveBeenCalled()
  })
  it('passes only submitted report inputs and opaque connection metadata to begin', async () => {
    const f = setup()
    f.database.begin.mockImplementation(async args => {
      const prepared = prepareRepoLightCreate({ schemaVersion: '1.0', request: args.p_request, clientBinding: f.row.create_envelope.clientBinding })
      return { data: { ...f.row, request_json: prepared.envelope.request, create_envelope: prepared.envelope, request_fingerprint: prepared.requestFingerprint }, error: null }
    })
    const view = await beginAssignmentRepoLightRun(f.actor, f.target, { requestId: uuid(20) }, f.deps)
    expect(view.id).toBe(uuid(20)); expect(JSON.stringify(view)).not.toContain('lease')
    const args = f.database.begin.mock.calls[0][0]
    expect(JSON.stringify(args.p_connection)).not.toContain('apiKey')
    expect(args.p_request).not.toHaveProperty('studentId'); expect(args.p_request).not.toHaveProperty('githubUsername')
    expect(args.p_expected_source).toEqual(f.source)
  })
  it('claims and authorizes before submitting, and records the opaque remote ID', async () => {
    const f = setup()
    await advanceAssignmentRepoLightRun(f.actor, f.target, f.row.id, f.deps)
    expect(f.database.advance.mock.calls.map(call => call[0].p_action)).toEqual(['claim', 'authorize', 'record_remote', 'poll_pending'])
    expect(f.remote.createAnalysis).toHaveBeenCalledOnce()
    expect(f.remote.createAnalysis.mock.calls[0][0]).toMatchObject({ encodedBody: f.prepared.encodedBody, idempotencyKey: f.row.idempotency_key })
  })
  it('polls without charging remote-pending as a retry failure', async () => {
    const f = setup(); f.row.analysis_id = wire.bundle.bundleRef
    await advanceAssignmentRepoLightRun(f.actor, f.target, f.row.id, f.deps)
    expect(f.remote.getStatus).toHaveBeenCalledOnce()
    expect(f.database.advance.mock.calls.map(call => call[0].p_action)).toEqual(['claim', 'authorize', 'poll_pending'])
  })
  it('denies foreign owners and source changes before egress', async () => {
    const f = setup(); f.row.actor_id = uuid(24)
    await expect(advanceAssignmentRepoLightRun(f.actor, f.target, f.row.id, f.deps)).rejects.toMatchObject({ statusCode: 403 })
    expect(f.factory).not.toHaveBeenCalled()
    const g = setup(); g.database.advance.mockImplementation(async args => args.p_action === 'authorize' ? { data: null, error: { code: '40001', message: 'private source changed' } } : { data: { ...g.row, lease_token: uuid(22), lease_generation: 1 }, error: null })
    await expect(advanceAssignmentRepoLightRun(g.actor, g.target, g.row.id, g.deps)).rejects.toMatchObject({ statusCode: 409 })
    expect(g.remote.createAnalysis).not.toHaveBeenCalled()
  })
  it('reconciles uncertain saved submissions while disabled with the original bytes/key', async () => {
    const f = setup(); f.row.attempt_count = 1
    f.deps.config = () => ({ enabled: false, apiOrigin: 'https://reports.example.test', connections: [{ ...f.connection, active: false }] })
    await advanceAssignmentRepoLightRun(f.actor, f.target, f.row.id, f.deps)
    expect(f.remote.reconcileAnalysis).toHaveBeenCalledWith(expect.objectContaining({ encodedBody: f.prepared.encodedBody, idempotencyKey: f.row.idempotency_key }))
    expect(f.remote.createAnalysis).not.toHaveBeenCalled()
  })
  it('records only sanitized retry metadata for uncertain transport failures', async () => {
    const f = setup(); f.remote.createAnalysis.mockRejectedValue(new RepoLightClientError('repolight_timeout', true))
    await advanceAssignmentRepoLightRun(f.actor, f.target, f.row.id, f.deps)
    expect(f.database.advance.mock.calls.at(-1)?.[0]).toMatchObject({ p_action: 'retry', p_payload: { errorCode: 'repolight_timeout', retryable: true } })
  })
  it('loads cached stale reports without provider access and projects no internal source/lease/config', async () => {
    const f = setup(); f.row.analysis_id = wire.bundle.bundleRef; f.row.status = 'completed'; f.row.source_current = false
    f.row.report = { schemaVersion: '1.0', analysisId: wire.bundle.bundleRef, reportRef: wire.bundle.bundleRef, requestFingerprint: f.prepared.requestFingerprint, clientBinding: f.prepared.envelope.clientBinding, reportDigest: wire.reportDigest, bundle: wire.bundle }
    const output = await getAssignmentRepoLightReport(f.actor, f.target, f.row.id, f.deps)
    expect(output.run.status).toBe('stale'); expect(output.run.canImport).toBe(false)
    expect(output.report.bundle).toEqual(wire.bundle); expect(f.factory).not.toHaveBeenCalled()
    expect(output.report.assignmentSummary).toBeNull()
    expect(output).not.toHaveProperty('source_json'); expect(output.run).not.toHaveProperty('connection_json')
  })
  it('derives a matched assignment draft without modifying the saved report or its digest', async () => {
    const f = setup()
    f.source.assignment.released_at = wire.bundle.context.period.startAt
    f.source.assignment.due_at = wire.bundle.context.period.endAt
    const sourceDigest = digestRepoLightJson(f.source)
    const bundle = structuredClone(wire.bundle)
    bundle.selection = {status:'matched', requestedGithubLogin:'sample-student', contributorId:'github-sample-student', notice:null} as typeof bundle.selection
    const prepared = prepareRepoLightCreate({...wire.envelope, request:{...wire.envelope.request, githubUsername:'sample-student'}, clientBinding:{...wire.envelope.clientBinding, sourceRevisionRef:sourceDigest}})
    Object.assign(f.row,{source_json:f.source,source_fingerprint:sourceDigest,request_json:prepared.envelope.request,create_envelope:prepared.envelope,request_fingerprint:prepared.requestFingerprint,status:'completed',analysis_id:bundle.bundleRef,
      report:{schemaVersion:'1.0',analysisId:bundle.bundleRef,reportRef:bundle.bundleRef,requestFingerprint:prepared.requestFingerprint,clientBinding:prepared.envelope.clientBinding,reportDigest:digestRepoLightJson(bundle),bundle}})
    const output = await getAssignmentRepoLightReport(f.actor,f.target,f.row.id,f.deps)
    expect(output.report.assignmentSummary).toMatchObject({scopeKey:'contributor:github-sample-student',text:expect.stringContaining('12 included commits')})
    expect(output.report.bundle).toEqual(bundle)
    expect(output.report.reportDigest).toBe(digestRepoLightJson(bundle))
  })
  it('keeps an unavailable source safe in context and performs no external attestation', async () => {
    const f = setup(); f.source.artifacts = []
    const value = await getAssignmentRepoLightContext(f.actor, f.target, f.deps)
    expect(value.source.available).toBe(false); expect(value.state).toBe('ready'); expect(value.run).toBeNull(); expect(f.factory).not.toHaveBeenCalled()
  })
  it('bounds request bytes and rejects malformed JSON before projection', async () => {
    const request = (body: string) => new Request('https://pika.example.test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
    expect(await readRepoLightRequestJson(request('{"safe":true}'))).toEqual({ safe: true })
    await expect(readRepoLightRequestJson(request('{bad'))).rejects.toMatchObject({ statusCode: 400 })
    await expect(readRepoLightRequestJson(request('x'.repeat(65537)))).rejects.toMatchObject({ statusCode: 413 })
  })
  it('preserves authoritative import conflicts without alternate grade writes or egress', async () => {
    const f = setup(); f.database.importFeedback.mockResolvedValue({ data: null, error: { code: '55000', message: 'repolight_returned_work' } })
    await expect(importAssignmentRepoLightFeedback(f.actor, f.target, f.row.id, { requestId: uuid(25), scopeKey: 'repository', expectedDocUpdatedAt: '2026-10-24T12:00:00Z', expectedReportDigest: wire.reportDigest }, f.deps)).rejects.toMatchObject({ statusCode: 409, message: 'repolight_state_changed' })
    expect(f.factory).not.toHaveBeenCalled(); expect(f.database.advance).not.toHaveBeenCalled()
  })
  it('keeps validated repository choices in unavailable multiple-repository context without egress', async () => {
    const f = setup(); f.source.artifacts.push({ ...f.source.artifacts[0], id: uuid(26), requirement_id: uuid(27), url: 'https://github.com/second/project' })
    const value = await getAssignmentRepoLightContext(f.actor, f.target, f.deps)
    expect(value.source.available).toBe(false)
    expect(value.source.notice).toBe('repolight_requirement_required')
    expect(value.source.repositoryChoices.map(choice => choice.requirementId)).toEqual([f.source.artifacts[0].requirement_id, uuid(27)])
    expect(f.factory).not.toHaveBeenCalled()
  })
  it('keeps detached saved reports readable while denying advance and import before mutation/egress', async () => {
    const f = setup(); f.row.subject_binding_id = null; f.row.detached = true; f.row.status = 'completed'; f.row.analysis_id = wire.bundle.bundleRef
    f.row.report = { schemaVersion: '1.0', analysisId: wire.bundle.bundleRef, reportRef: wire.bundle.bundleRef, requestFingerprint: f.prepared.requestFingerprint, clientBinding: f.prepared.envelope.clientBinding, reportDigest: wire.reportDigest, bundle: wire.bundle }
    const view = await getAssignmentRepoLightReport(f.actor, f.target, f.row.id, f.deps)
    expect(view.run.reportAvailable).toBe(true); expect(view.run.canImport).toBe(false); expect(view.run.canAdvance).toBe(false)
    f.row.status = 'running'
    expect((await getAssignmentRepoLightRun(f.actor, f.target, f.row.id, f.deps)).canAdvance).toBe(false)
    await expect(advanceAssignmentRepoLightRun(f.actor, f.target, f.row.id, f.deps)).rejects.toMatchObject({ statusCode: 409, message: 'repolight_detached_read_only' })
    await expect(importAssignmentRepoLightFeedback(f.actor, f.target, f.row.id, { requestId: uuid(25), scopeKey: 'repository', expectedDocUpdatedAt: '2026-10-24T12:00:00Z', expectedReportDigest: wire.reportDigest }, f.deps)).rejects.toMatchObject({ statusCode: 409, message: 'repolight_detached_read_only' })
    expect(f.database.advance).not.toHaveBeenCalled(); expect(f.database.importFeedback).not.toHaveBeenCalled(); expect(f.factory).not.toHaveBeenCalled()
  })
  it('reads detached remapped rows without rewriting immutable historical fingerprints, and still rejects forged ownership/digests', async () => {
    const f = setup(); f.row.subject_binding_id = null; f.row.detached = true; f.row.status = 'completed'; f.row.analysis_id = wire.bundle.bundleRef
    const historicalKey = f.row.idempotency_key
    f.row.id = uuid(30); f.row.classroom_id = uuid(31); f.row.assignment_id = uuid(32); f.row.student_id = uuid(33)
    f.target.assignmentId = f.row.assignment_id; f.target.studentId = f.row.student_id
    f.row.report = { schemaVersion: '1.0', analysisId: wire.bundle.bundleRef, reportRef: wire.bundle.bundleRef, requestFingerprint: f.prepared.requestFingerprint, clientBinding: f.prepared.envelope.clientBinding, reportDigest: wire.reportDigest, bundle: wire.bundle }
    expect((await getAssignmentRepoLightReport(f.actor, f.target, f.row.id, f.deps)).report.bundle).toEqual(wire.bundle)
    expect(f.row.idempotency_key).toBe(historicalKey)
    f.row.actor_id = uuid(34)
    await expect(getAssignmentRepoLightReport(f.actor, f.target, f.row.id, f.deps)).rejects.toMatchObject({ statusCode: 403 })
    f.row.actor_id = f.actor; f.row.source_fingerprint = 'f'.repeat(64)
    await expect(getAssignmentRepoLightReport(f.actor, f.target, f.row.id, f.deps)).rejects.toMatchObject({ statusCode: 503 })
    expect(f.factory).not.toHaveBeenCalled()
  })
  it('accepts missing legacy poll history as zero and rejects out-of-budget internal counters without exposing them', async () => {
    const f = setup()
    expect(parseRepoLightRun(f.row, f.actor, f.target, f.row.id).poll_failure_count).toBe(0)
    for (const count of [-1, 4, 1.5, null]) {
      expect(() => parseRepoLightRun({ ...f.row, poll_failure_count: count }, f.actor, f.target, f.row.id))
        .toThrow('repolight_invalid_storage')
    }
    expect(await getAssignmentRepoLightRun(f.actor, f.target, f.row.id, f.deps)).not.toHaveProperty('poll_failure_count')
  })
  it('rejects a missing private binding on an ordinary live run', async () => {
    const f = setup(); f.row.subject_binding_id = null
    await expect(advanceAssignmentRepoLightRun(f.actor, f.target, f.row.id, f.deps)).rejects.toMatchObject({ statusCode: 503, message: 'repolight_invalid_storage' })
    expect(f.database.advance).not.toHaveBeenCalled(); expect(f.factory).not.toHaveBeenCalled()
  })
  it('imports through the report-only RPC with explicit revision/scope/digest and preserves its replay receipt', async () => {
    const f = setup()
    const receipt = { doc: { id: uuid(6), assignment_id: f.target.assignmentId, student_id: f.target.studentId, updated_at: '2026-10-24T12:00:01Z', teacher_feedback_draft: 'Existing draft\n\nExplicit feedback', teacher_feedback_draft_updated_at: '2026-10-24T12:00:01Z' }, imported: true, replayed: true }
    f.database.importFeedback.mockResolvedValue({ data: receipt, error: null })
    expect(await importAssignmentRepoLightFeedback(f.actor, f.target, f.row.id, { requestId: uuid(25), scopeKey: 'repository', expectedDocUpdatedAt: '2026-10-24T12:00:00Z', expectedReportDigest: wire.reportDigest, feedbackText: 'Explicit feedback' }, f.deps)).toEqual(receipt)
    expect(f.database.importFeedback.mock.calls[0][0]).toMatchObject({ p_scope_key: 'repository', p_expected_report_digest: wire.reportDigest, p_feedback_text: 'Explicit feedback' })
    expect(f.factory).not.toHaveBeenCalled(); expect(f.database.begin).not.toHaveBeenCalled()
  })
})
