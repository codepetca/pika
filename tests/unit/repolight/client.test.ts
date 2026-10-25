import { describe, expect, it, vi } from 'vitest'
import fixture from './fixture.json'
import { createRepoLightClient, prepareRepoLightCreate, digestRepoLightJson } from '@/lib/server/repolight-client'
const connection = { connectionRef: 'connection-1', teacherId: '11111111-1111-4111-8111-111111111111', workspaceRef: 'customer_1', installationRef: 'pika-installation', apiKey: 'rl_v2_77777777-7777-4777-8777-777777777777.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', active: true }
const capabilities = { schemaVersion: '1.0', workspaceRef: 'customer_1', installationRef: 'pika-installation', scopes: ['analyses:create', 'analyses:read', 'analyses:erase'] }
const expected = { analysisId: fixture.bundle.bundleRef, requestFingerprint: fixture.requestFingerprint, clientBinding: fixture.envelope.clientBinding, request: fixture.envelope.request }
const status = { schemaVersion: '1.0', analysisId: expected.analysisId, requestFingerprint: expected.requestFingerprint, clientBinding: expected.clientBinding, status: 'queued', attemptCount: 0, nextAttemptAt: null, createdAt: '2026-10-24T12:00:00Z', completedAt: null, reportRef: null, error: null }
const result = { schemaVersion: '1.0', analysisId: expected.analysisId, requestFingerprint: expected.requestFingerprint, clientBinding: expected.clientBinding, reportRef: expected.analysisId, reportDigest: fixture.reportDigest, bundle: fixture.bundle }
const json = (value: unknown, status = 200) => Response.json(value, { status })
function client(responses: Response[], options = {}) {
  const fetchImpl = vi.fn().mockImplementation(async () => responses.shift()!)
  return { api: createRepoLightClient(connection, { apiOrigin: 'https://reports.example.test', enabled: true, fetchImpl, ...options }), fetchImpl }
}
describe('RepoLight strict client', () => {
  it('rejects missing configured origin before constructing a transport', () => {
    expect(() => createRepoLightClient(connection, { apiOrigin: '' })).toThrow('RepoLight is not configured.')
  })
  it('matches canonical service bytes/digests and preserves array order', () => {
    expect(prepareRepoLightCreate(fixture.envelope)).toMatchObject({ encodedBody: fixture.encodedBody, requestFingerprint: fixture.requestFingerprint })
    expect(digestRepoLightJson(fixture.bundle)).toBe(fixture.reportDigest)
    expect(digestRepoLightJson([1, 2])).not.toBe(digestRepoLightJson([2, 1]))
  })
  it('matches service API clone-URL normalization before request fingerprints and wire bytes', () => {
    const cloneEnvelope = { ...fixture.envelope, request: { ...fixture.envelope.request, repositoryUrl: fixture.envelope.request.repositoryUrl + '.git' } }
    expect(prepareRepoLightCreate(cloneEnvelope)).toMatchObject({ encodedBody: fixture.encodedBody, requestFingerprint: fixture.requestFingerprint, envelope: fixture.envelope })
    expect(() => prepareRepoLightCreate({ ...cloneEnvelope, request: { ...cloneEnvelope.request, repositoryUrl: cloneEnvelope.request.repositoryUrl + '?download=1' } })).toThrow()
    expect(() => prepareRepoLightCreate({ ...cloneEnvelope, request: { ...cloneEnvelope.request, repositoryUrl: 'https://github.com.attacker.test/owner/repo.git' } })).toThrow()
  })
  it.each(['.git.git', '.git.git.git', '.GIT.git'])('rejects ambiguous clone suffix %s before normalization or network access', async suffix => {
    const envelope = { ...fixture.envelope, request: { ...fixture.envelope.request, repositoryUrl: fixture.envelope.request.repositoryUrl + suffix } }
    expect(() => prepareRepoLightCreate(envelope)).toThrow()
    const { api, fetchImpl } = client([])
    await expect(api.createAnalysis({ ...prepareRepoLightCreate(fixture.envelope), envelope, idempotencyKey: 'pika-44444444-4444-4444-8444-444444444444' })).rejects.toMatchObject({ code: 'repolight_invalid_request' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('attests capabilities before create and preserves exact saved bytes and idempotency', async () => {
    const { api, fetchImpl } = client([json(capabilities), json(status, 202)])
    expect(await api.createAnalysis({ ...prepareRepoLightCreate(fixture.envelope), idempotencyKey: 'pika-44444444-4444-4444-8444-444444444444' })).toEqual(status)
    expect(fetchImpl.mock.calls[0][0]).toBe('https://reports.example.test/api/v2/connection')
    expect(fetchImpl.mock.calls[1][1]).toMatchObject({ method: 'POST', body: fixture.encodedBody, redirect: 'error', cache: 'no-store', headers: { Authorization: `Bearer ${connection.apiKey}`, 'Idempotency-Key': 'pika-44444444-4444-4444-8444-444444444444' } })
  })
  it.each(['workspace', 'installation', 'scope'])('blocks egress after mismatched %s attestation', async kind => {
    const value = structuredClone(capabilities)
    if (kind === 'workspace') value.workspaceRef = 'foreign'
    if (kind === 'installation') value.installationRef = 'foreign'
    if (kind === 'scope') value.scopes = ['analyses:read']
    const { api, fetchImpl } = client([json(value)])
    await expect(api.getStatus(expected)).rejects.toMatchObject({ code: 'repolight_connection_mismatch' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
  it.each(['analysisId', 'binding', 'fingerprint', 'digest', 'partition'])('rejects wrong result %s', async kind => {
    const value = structuredClone(result)
    if (kind === 'analysisId') value.analysisId = '55555555-5555-4555-8555-555555555555'
    if (kind === 'binding') value.clientBinding.subjectRef = 'foreign'
    if (kind === 'fingerprint') value.requestFingerprint = 'b'.repeat(64)
    if (kind === 'digest') value.reportDigest = 'b'.repeat(64)
    if (kind === 'partition') value.bundle.contributors[0].analysis.facts.commits.pop()
    const { api } = client([json(capabilities), json(value)])
    await expect(api.getResult(expected)).rejects.toMatchObject({ code: 'repolight_invalid_response' })
  })
  it('accepts a bound result and denies wrong pinned snapshot', async () => {
    expect(await client([json(capabilities), json(result)]).api.getResult(expected)).toEqual(result)
    await expect(client([json(capabilities), json(result)]).api.getResult({ ...expected, snapshotSha: 'b'.repeat(40) })).rejects.toMatchObject({ code: 'repolight_invalid_response' })
  })
  it('validates exact erasure receipts; 404 is not absence', async () => {
    const request = { schemaVersion: '1.0' as const, operationRef: '66666666-6666-4666-8666-666666666666', installationRef: connection.installationRef, subjectRef: 'opaque-subject' }
    const receipt = { ...request, status: 'erased', absenceVerified: true }
    expect(await client([json(capabilities), json(receipt)]).api.eraseSubject(request)).toEqual(receipt)
    await expect(client([json(capabilities), json({ ...receipt, subjectRef: 'foreign' })]).api.eraseSubject(request)).rejects.toMatchObject({ code: 'repolight_invalid_response' })
    await expect(client([json(capabilities), json({}, 404)]).api.eraseSubject(request)).rejects.toMatchObject({ retryable: false })
  })
  it('keeps cleanup available while analysis is disabled', async () => {
    const { api, fetchImpl } = client([], { enabled: false })
    await expect(api.createAnalysis({ ...prepareRepoLightCreate(fixture.envelope), idempotencyKey: 'pika-44444444-4444-4444-8444-444444444444' })).rejects.toMatchObject({ code: 'repolight_disabled' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
  it('reconciles a saved uncertain POST while disabled using identical bytes/key', async () => {
    const { api, fetchImpl } = client([json(capabilities), json(status)], { enabled: false })
    expect(await api.reconcileAnalysis({ ...prepareRepoLightCreate(fixture.envelope), idempotencyKey: 'pika-44444444-4444-4444-8444-444444444444' })).toEqual(status)
    expect(fetchImpl.mock.calls[1][1].body).toBe(fixture.encodedBody)
  })
  it('rejects modified saved bytes and wrong status IDs before acceptance', async () => {
    const prepared = prepareRepoLightCreate(fixture.envelope)
    const { api, fetchImpl } = client([])
    await expect(api.createAnalysis({ ...prepared, encodedBody: prepared.encodedBody + ' ', idempotencyKey: 'pika-44444444-4444-4444-8444-444444444444' })).rejects.toMatchObject({ code: 'repolight_invalid_request' })
    expect(fetchImpl).not.toHaveBeenCalled()
    await expect(client([json(capabilities), json({ ...status, analysisId: '55555555-5555-4555-8555-555555555555' })]).api.getStatus(expected)).rejects.toMatchObject({ code: 'repolight_invalid_response' })
  })
  it('bounds response bytes and sanitizes errors without reading upstream text', async () => {
    await expect(client([new Response('x'.repeat(9000), { headers: { 'Content-Type': 'application/json' } })]).api.verifyConnection()).rejects.toMatchObject({ code: 'repolight_response_too_large' })
    const secret = new Response('sensitive-provider-content', { status: 500 })
    await expect(client([secret]).api.verifyConnection()).rejects.toMatchObject({ message: 'RepoLight is unavailable.', retryable: true })
    await expect(client([new Response('', { status: 302 })]).api.verifyConnection()).rejects.toMatchObject({ code: 'repolight_invalid_response' })
  })
  it('times out stalled fetch and stalled streaming bodies', async () => {
    const stalled = vi.fn(() => new Promise<Response>(() => {}))
    const api = createRepoLightClient(connection, { apiOrigin: 'https://reports.example.test', enabled: true, fetchImpl: stalled, timeoutMs: 10 })
    await expect(api.verifyConnection()).rejects.toMatchObject({ code: 'repolight_timeout' })
    const stream = new ReadableStream({ start() {} })
    await expect(client([new Response(stream, { headers: { 'Content-Type': 'application/json' } })], { timeoutMs: 10 }).api.verifyConnection()).rejects.toMatchObject({ code: 'repolight_timeout' })
  })
})
