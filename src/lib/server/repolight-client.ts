import { createHash } from 'node:crypto'
import {
  analysisIdSchema, analysisStatusSchema, analysisResultSchema, clientBindingSchema,
  createAnalysisRequestSchema, connectionMetadataSchema, erasureRequestSchema, erasureReceiptSchema,
  type AnalysisStatus, type AnalysisResult, type ClientBinding, type CreateAnalysisRequest, type ErasureRequest,
} from '@/lib/contracts/repolight/service/contract'
import { makeRepositoryTarget, normalizeGitHubLogin } from '@/lib/contracts/repolight/engine/repo'
import type { PublicRepositoryRequest } from '@/lib/contracts/repolight/report/bundle-contract'
import { parseRepoLightConfig, type RepoLightConnection } from './repolight-config'

export class RepoLightClientError extends Error {
  constructor(readonly code: string, readonly retryable: boolean, readonly status?: number) {
    super('RepoLight is unavailable.'); this.name = 'RepoLightClientError'
  }
}
const failure = (code: string, retryable = false, status?: number) => new RepoLightClientError(code, retryable, status)

/** Same sorted-key/undefined omission/array-order rules as RepoLight service/http.ts. */
export function canonicalRepoLightJson(value: unknown): string {
  const normalize = (child: unknown): unknown => Array.isArray(child) ? child.map(normalize) : child !== null && typeof child === 'object'
    ? Object.fromEntries(Object.entries(child).filter(([, value]) => value !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => [key, normalize(value)])) : child
  return JSON.stringify(normalize(value))
}
export const digestRepoLightJson = (value: unknown): string => createHash('sha256').update(canonicalRepoLightJson(value)).digest('hex')
export type PreparedRepoLightCreate = { envelope: CreateAnalysisRequest & { clientBinding: ClientBinding }; encodedBody: string; requestFingerprint: string }
export function prepareRepoLightCreate(value: unknown): PreparedRepoLightCreate {
  try {
    const envelope = createAnalysisRequestSchema.parse(value)
    const binding = clientBindingSchema.parse(envelope.clientBinding)
    if (!/^[a-f0-9]{64}$/.test(binding.sourceRevisionRef)) throw new Error()
    const prepared = { ...envelope, clientBinding: binding }
    const encodedBody = canonicalRepoLightJson(prepared)
    if (Buffer.byteLength(encodedBody) > 65536) throw new Error()
    return { envelope: prepared, encodedBody, requestFingerprint: digestRepoLightJson(prepared) }
  } catch { throw failure('repolight_invalid_request') }
}
export type RepoLightExpectedRun = {
  analysisId: string; requestFingerprint: string; clientBinding: ClientBinding;
  request: PublicRepositoryRequest; snapshotSha?: string;
}
type Options = { apiOrigin: string; enabled?: boolean; fetchImpl?: typeof fetch; timeoutMs?: number }
const same = (a: unknown, b: unknown) => canonicalRepoLightJson(a) === canonicalRepoLightJson(b)

export function createRepoLightClient(rawConnection: RepoLightConnection, options: Options) {
  const config = parseRepoLightConfig({ NODE_ENV: process.env.NODE_ENV, PIKA_REPOLIGHT_ENABLED: 'true', REPOLIGHT_API_URL: options.apiOrigin,
    REPOLIGHT_TEACHER_CONNECTIONS_JSON: JSON.stringify([rawConnection]) })
  const connection = config.connections[0]
  const origin = config.apiOrigin!
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? 8000
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15000) throw failure('repolight_invalid_configuration')

  async function operation<T>(action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([action(controller.signal), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { reject(failure('repolight_timeout', true)); controller.abort() }, timeoutMs)
      })])
    } catch (error) {
      if (error instanceof RepoLightClientError) throw error
      throw failure('repolight_unavailable', true)
    } finally { controller.abort(); if (timer) clearTimeout(timer) }
  }
  async function request(path: string, signal: AbortSignal, body?: string, idempotencyKey?: string, maxBytes = 65536): Promise<unknown> {
    const response = await fetchImpl(origin + path, { method: body === undefined ? 'GET' : 'POST',
      redirect: 'error', cache: 'no-store', signal,
      headers: { Authorization: `Bearer ${connection.apiKey}`, Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
      ...(body === undefined ? {} : { body }),
    })
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      if (response.status >= 300 && response.status < 400) throw failure('repolight_invalid_response')
      const code = response.status === 401 || response.status === 403 ? 'repolight_unauthorized'
        : response.status === 410 ? 'repolight_subject_erased' : response.status === 409 ? 'repolight_conflict' : 'repolight_unavailable'
      throw failure(code, response.status === 429 || response.status >= 500, response.status)
    }
    if (response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') { await response.body?.cancel(); throw failure('repolight_invalid_response') }
    const length = response.headers.get('content-length')
    if (length && (!/^\d+$/.test(length) || Number(length) > maxBytes)) { await response.body?.cancel(); throw failure('repolight_response_too_large') }
    const reader = response.body?.getReader()
    if (!reader) throw failure('repolight_invalid_response')
    const chunks: Uint8Array[] = []; let bytes = 0
    const abort = () => { void reader.cancel().catch(() => {}) }
    signal.addEventListener('abort', abort, { once: true })
    try {
      while (true) {
        const next = await reader.read()
        if (next.done) break
        bytes += next.value.byteLength
        if (bytes > maxBytes) { await reader.cancel(); throw failure('repolight_response_too_large') }
        chunks.push(next.value)
      }
      try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) }
      catch { throw failure('repolight_invalid_response') }
    } finally { signal.removeEventListener('abort', abort); reader.releaseLock() }
  }
  async function attest(signal: AbortSignal) {
    const parsed = connectionMetadataSchema.safeParse(await request('/api/v2/connection', signal, undefined, undefined, 8192))
    if (!parsed.success || parsed.data.workspaceRef !== connection.workspaceRef || parsed.data.installationRef !== connection.installationRef
      || !['analyses:create', 'analyses:read', 'analyses:erase'].every(scope => parsed.data.scopes.includes(scope as typeof parsed.data.scopes[number]))) throw failure('repolight_connection_mismatch')
    return parsed.data
  }
  function validateExpected(expected: RepoLightExpectedRun) {
    const prepared = prepareRepoLightCreate({ schemaVersion: '1.0', request: expected.request, clientBinding: expected.clientBinding })
    if (prepared.requestFingerprint !== expected.requestFingerprint) throw failure('repolight_invalid_request')
    if (!analysisIdSchema.safeParse(expected.analysisId).success || !/^[a-f0-9]{64}$/.test(expected.requestFingerprint)
      || !clientBindingSchema.safeParse(expected.clientBinding).success || !/^[a-f0-9]{64}$/.test(expected.clientBinding.sourceRevisionRef) || expected.clientBinding.installationRef !== connection.installationRef
      || (expected.snapshotSha !== undefined && !/^[a-f0-9]{40}$/.test(expected.snapshotSha))) throw failure('repolight_invalid_request')
  }
  function matchesRun(value: AnalysisStatus | AnalysisResult, expected: Pick<RepoLightExpectedRun, 'analysisId' | 'requestFingerprint' | 'clientBinding'>) {
    if (value.analysisId !== expected.analysisId || value.requestFingerprint !== expected.requestFingerprint || !same(value.clientBinding, expected.clientBinding)) throw failure('repolight_invalid_response')
  }
  type SubmitInput = PreparedRepoLightCreate & { idempotencyKey: string }
  function submit(input: SubmitInput, reconciliation: boolean) {
    return operation(async signal => {
      if (!reconciliation && (options.enabled !== true || !connection.active)) throw failure('repolight_disabled')
      const prepared = prepareRepoLightCreate(input.envelope)
      if (prepared.encodedBody !== input.encodedBody || prepared.requestFingerprint !== input.requestFingerprint
        || input.envelope.clientBinding.installationRef !== connection.installationRef
        || !input.idempotencyKey.startsWith('pika-') || !analysisIdSchema.safeParse(input.idempotencyKey.slice(5)).success) throw failure('repolight_invalid_request')
      await attest(signal)
      const parsed = analysisStatusSchema.safeParse(await request('/api/v2/analyses', signal, input.encodedBody, input.idempotencyKey))
      if (!parsed.success || parsed.data.requestFingerprint !== input.requestFingerprint || !same(parsed.data.clientBinding, input.envelope.clientBinding)) throw failure('repolight_invalid_response')
      return parsed.data
    })
  }
  return {
    verifyConnection: () => operation(attest),
    createAnalysis: (input: SubmitInput) => submit(input, false),
    // Caller must load the already-admitted immutable envelope/key under its reconciliation lease.
    reconcileAnalysis: (input: SubmitInput) => submit(input, true),
    getStatus: (expected: RepoLightExpectedRun) => operation(async signal => {
      validateExpected(expected); await attest(signal)
      const parsed = analysisStatusSchema.safeParse(await request(`/api/v2/analyses/${expected.analysisId}`, signal))
      if (!parsed.success) throw failure('repolight_invalid_response')
      matchesRun(parsed.data, expected); return parsed.data
    }),
    getResult: (expected: RepoLightExpectedRun) => operation(async signal => {
      validateExpected(expected); await attest(signal)
      const parsed = analysisResultSchema.safeParse(await request(`/api/v2/analyses/${expected.analysisId}/result`, signal, undefined, undefined, 8_000_000))
      if (!parsed.success) throw failure('repolight_invalid_response')
      const value = parsed.data
      matchesRun(value, expected)
      if (digestRepoLightJson(value.bundle) !== value.reportDigest) throw failure('repolight_invalid_response')
      const target = makeRepositoryTarget(expected.request.repositoryUrl, expected.request.branch)
      const context = value.bundle.context
      const requested = expected.request.githubUsername?.trim() || null
      const selected = value.bundle.selection
      const expectedLogin = selected.status === 'invalid' ? requested : normalizeGitHubLogin(requested)
      if (!target || !same(context.repository, { url: target.repoUrl, branch: target.branch, visibility: 'public' })
        || selected.requestedGithubLogin !== expectedLogin
        || context.baseline.status !== (expected.request.baselineReviewed ? 'applied' : 'not_supplied')
        || !same(context.period, expected.request.period) || !same(context.exclusions, expected.request.exclusions)
        || !same(context.scheduledProjectDates, expected.request.scheduledProjectDates === null ? null : [...new Set(expected.request.scheduledProjectDates)].sort())
        || (expected.snapshotSha !== undefined && context.snapshot.sha !== expected.snapshotSha)) throw failure('repolight_invalid_response')
      return value
    }),
    eraseSubject: (input: ErasureRequest) => operation(async signal => {
      const parsed = erasureRequestSchema.safeParse(input)
      if (!parsed.success || parsed.data.installationRef !== connection.installationRef) throw failure('repolight_invalid_request')
      await attest(signal)
      const receipt = erasureReceiptSchema.safeParse(await request('/api/v2/erasures', signal, canonicalRepoLightJson(parsed.data)))
      if (!receipt.success || !same(receipt.data, { ...parsed.data, status: 'erased', absenceVerified: true })) throw failure('repolight_invalid_response')
      return receipt.data
    }),
  }
}
export type RepoLightClient = ReturnType<typeof createRepoLightClient>
