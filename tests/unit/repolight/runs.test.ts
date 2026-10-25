import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => { throw new Error('No live database allowed') }) }))
import wire from './fixture.json'
import { sourceFixture } from './adapter-fixtures'
import { digestRepoLightJson, prepareRepoLightCreate, RepoLightClientError, type RepoLightClient } from '@/lib/server/repolight-client'
import { beginAssignmentRepoLightRun, advanceAssignmentRepoLightRun, getAssignmentRepoLightContext, getAssignmentRepoLightReport, getAssignmentRepoLightRun, readRepoLightRequestJson, type RepoLightDependencies } from '@/lib/server/assignment-repolight-runs'
import { importAssignmentRepoLightFeedback } from '@/lib/server/assignment-repolight-import'
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
describe('report-only durable orchestration', () => {
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
    expect(output).not.toHaveProperty('source_json'); expect(output.run).not.toHaveProperty('connection_json')
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
