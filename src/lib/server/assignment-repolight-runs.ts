import { ApiError } from '@/lib/api-error'
import { getServiceRoleClient } from '@/lib/supabase'
import { repoLightRunRowSchema, repoLightSourceResponseSchema, repoLightTargetSchema, type RepoLightRunRow, type RepoLightTarget, type BeginRepoLightRequest, type RepoLightRunView, type RepoLightContextReply } from '@/lib/validations/repolight'
import { resolveAssignmentRepoLightSource, assignmentRepoLightRepositoryChoices, type RepoLightSourceSummary } from './assignment-repolight-source'
import { parseRepoLightConfig, resolveRepoLightConnection, type RepoLightConfig } from './repolight-config'
import { createRepoLightClient, prepareRepoLightCreate, canonicalRepoLightJson, digestRepoLightJson, RepoLightClientError } from './repolight-client'
import type { RepoLightRpcSourceContract } from '@/types/database'
import type { Json } from '@/types/database.generated'

type Contract = RepoLightRpcSourceContract
type Reply = PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>
export type RepoLightDatabase = {
  source(args: Contract['get_assignment_repolight_source_v1']['Args']): Reply
  begin(args: Contract['begin_assignment_repolight_run_v1']['Args']): Reply
  read(args: Contract['read_assignment_repolight_run_v1']['Args']): Reply
  advance(args: Contract['advance_assignment_repolight_run_v1']['Args']): Reply
  importFeedback(args: Contract['import_assignment_repolight_feedback_v1']['Args']): Reply
}
export type RepoLightDependencies = { database?: RepoLightDatabase; config?: () => RepoLightConfig; clientFactory?: typeof createRepoLightClient; fetchImpl?: typeof fetch; now?: () => Date }
export function repoLightDatabase(deps: RepoLightDependencies): RepoLightDatabase {
  if (deps.database) return deps.database
  const db = getServiceRoleClient()
  return {
    source: args => db.rpc('get_assignment_repolight_source_v1', args),
    begin: args => db.rpc('begin_assignment_repolight_run_v1', args),
    read: args => db.rpc('read_assignment_repolight_run_v1', args),
    advance: args => db.rpc('advance_assignment_repolight_run_v1', args),
    importFeedback: args => db.rpc('import_assignment_repolight_feedback_v1', { ...args, p_feedback_text: args.p_feedback_text ?? undefined }),
  }
}
export function toRepoLightRpcJson(value: unknown): Json {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value)) return value.map(toRepoLightRpcJson)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined).map(([key, child]) => [key, toRepoLightRpcJson(child)]))
  throw new ApiError(503, 'repolight_invalid_storage')
}
export async function repoLightRpc(reply: Reply): Promise<unknown> {
  const { data, error } = await reply
  if (error) {
    const status = error.code === '42501' ? 403 : error.code === 'P0002' ? 404 : ['40001', '55000'].includes(error.code ?? '') ? 409 : error.code === '22023' ? 400 : 503
    throw new ApiError(status, status === 403 ? 'Forbidden' : status === 404 ? 'repolight_unavailable' : status === 409 ? 'repolight_state_changed' : 'repolight_unavailable')
  }
  return data
}
const same = (a: unknown, b: unknown) => canonicalRepoLightJson(a) === canonicalRepoLightJson(b)
export function parseRepoLightRun(value: unknown, actorId: string, target: RepoLightTarget, runId?: string): RepoLightRunRow {
  const parsed = repoLightRunRowSchema.safeParse(value)
  if (!parsed.success) throw new ApiError(503, 'repolight_invalid_storage')
  const row = parsed.data
  if (row.actor_id !== actorId || row.assignment_id !== target.assignmentId || row.student_id !== target.studentId || (runId && row.id !== runId)) throw new ApiError(403, 'Forbidden')
  // Portable snapshots retain historical source IDs and fingerprints. Only the
  // restored relational row is rebound to the currently authorized target.
  if (!row.detached && (row.source_json.classroom.teacher_id !== actorId || row.source_json.assignment.id !== target.assignmentId || row.source_json.assignment.classroom_id !== row.classroom_id
    || (row.source_json.enrollment && (row.source_json.enrollment.student_id !== target.studentId || row.source_json.enrollment.classroom_id !== row.classroom_id))
    || row.source_json.artifacts.some(artifact => artifact.student_id !== target.studentId || artifact.assignment_doc_id !== row.source_json.doc?.id))) throw new ApiError(403, 'Forbidden')
  if ((row.source_json.enrollment && row.source_json.enrollment.classroom_id !== row.source_json.assignment.classroom_id)
    || row.source_json.artifacts.some(artifact => artifact.assignment_doc_id !== row.source_json.doc?.id
      || (row.source_json.enrollment !== null && artifact.student_id !== row.source_json.enrollment.student_id))) throw new ApiError(503, 'repolight_invalid_storage')
  let prepared
  try { prepared = prepareRepoLightCreate(row.create_envelope) } catch { throw new ApiError(503, 'repolight_invalid_storage') }
  if (row.source_fingerprint !== digestRepoLightJson(row.source_json) || row.request_fingerprint !== prepared.requestFingerprint
    || !same(row.request_json, prepared.envelope.request) || prepared.envelope.clientBinding.sourceRevisionRef !== row.source_fingerprint
    || prepared.envelope.clientBinding.installationRef !== row.connection_json.installationRef || (!row.detached && row.idempotency_key !== `pika-${row.id}`)) throw new ApiError(503, 'repolight_invalid_storage')
  return row
}
function writesAllowed(source: RepoLightRunRow['source_json']) {
  return !!source.enrollment && !source.classroom.archived_at && !source.assignment.blueprint_archived_at && !source.assignment.is_draft
}
export function repoLightRunView(row: RepoLightRunRow, sourceCurrent: boolean, now = new Date()): RepoLightRunView {
  const active = ['queued', 'submitting', 'running'].includes(row.status)
  const ready = (!row.next_retry_at || Date.parse(row.next_retry_at) <= now.getTime()) && (!row.lease_expires_at || Date.parse(row.lease_expires_at) <= now.getTime())
  return { id: row.id, status: sourceCurrent ? row.status : 'stale' as const, sourceCurrent,
    canAdvance: !row.detached && sourceCurrent && writesAllowed(row.source_json) && active && ready,
    canImport: !row.detached && sourceCurrent && writesAllowed(row.source_json) && row.status === 'completed',
    reportAvailable: row.status === 'completed', errorCode: row.error_code, nextRetryAt: row.next_retry_at }
}
export type { RepoLightRunView } from '@/lib/validations/repolight'
export async function loadAssignmentRepoLightSource(actorId: string, target: RepoLightTarget, deps: RepoLightDependencies = {}) {
  repoLightTargetSchema.parse(target)
  const value = await repoLightRpc(repoLightDatabase(deps).source({ p_actor_id: actorId, p_assignment_id: target.assignmentId, p_student_id: target.studentId }))
  const parsed = repoLightSourceResponseSchema.safeParse(value)
  if (!parsed.success) throw new ApiError(503, 'repolight_invalid_storage')
  const source = parsed.data.source
  if (source.classroom.teacher_id !== actorId || source.assignment.id !== target.assignmentId
    || (source.enrollment && (source.enrollment.student_id !== target.studentId || source.enrollment.classroom_id !== source.assignment.classroom_id))
    || source.artifacts.some(artifact => artifact.student_id !== target.studentId || artifact.assignment_doc_id !== source.doc?.id)) throw new ApiError(403, 'Forbidden')
  if (parsed.data.source_fingerprint !== digestRepoLightJson(source)) throw new ApiError(503, 'repolight_invalid_storage')
  return parsed.data
}
export async function getAssignmentRepoLightContext(actorId: string, target: RepoLightTarget, deps: RepoLightDependencies = {}) {
  const loaded = await loadAssignmentRepoLightSource(actorId, target, deps)
  let state: 'disabled' | 'not_configured' | 'ready' | 'unavailable' = 'not_configured'
  try { const config = (deps.config ?? parseRepoLightConfig)(); state = !config.enabled ? 'disabled' : (resolveRepoLightConnection(config, actorId), 'ready') } catch { state = 'not_configured' }
  let source: RepoLightSourceSummary
  try { source = resolveAssignmentRepoLightSource(loaded.source, {}, deps.now?.()).summary }
  catch (error) { source = { repositoryChoices: assignmentRepoLightRepositoryChoices(loaded.source), available: false, repositoryUrl: null, githubUsername: null, usernameProvenance: 'none', requirementId: null, period: null, periodDefaulted: false, notice: error instanceof ApiError && error.statusCode === 400 ? error.message : 'repolight_source_unavailable' } }
  if (!writesAllowed(loaded.source)) source = { ...source, available: false, notice: 'repolight_source_read_only' }
  const latest = loaded.latest_run ? parseRepoLightRun(loaded.latest_run, actorId, target) : null
  return { state, source, run: latest ? repoLightRunView(latest, same(latest.source_json, loaded.source), deps.now?.()) : null } satisfies RepoLightContextReply
}
export async function beginAssignmentRepoLightRun(actorId: string, target: RepoLightTarget, input: BeginRepoLightRequest, deps: RepoLightDependencies = {}) {
  const loaded = await loadAssignmentRepoLightSource(actorId, target, deps)
  if (!writesAllowed(loaded.source)) throw new ApiError(409, 'repolight_source_read_only')
  let config, connection
  try { config = (deps.config ?? parseRepoLightConfig)(); if (!config.enabled) throw new Error(); connection = resolveRepoLightConnection(config, actorId) } catch { throw new ApiError(503, 'repolight_not_configured') }
  const selected = resolveAssignmentRepoLightSource(loaded.source, input, deps.now?.())
  const row = parseRepoLightRun(await repoLightRpc(repoLightDatabase(deps).begin({ p_actor_id: actorId, p_assignment_id: target.assignmentId, p_student_id: target.studentId, p_request_id: input.requestId,
    p_connection: { connectionRef: connection.connectionRef, workspaceRef: connection.workspaceRef, installationRef: connection.installationRef }, p_request: toRepoLightRpcJson(selected.request), p_expected_source: toRepoLightRpcJson(loaded.source) })), actorId, target, input.requestId)
  if (!same(row.request_json, selected.request) || !same(row.source_json, loaded.source) || !same(row.connection_json, { connectionRef: connection.connectionRef, workspaceRef: connection.workspaceRef, installationRef: connection.installationRef })) throw new ApiError(503, 'repolight_invalid_storage')
  return repoLightRunView(row, true, deps.now?.())
}
export async function readAssignmentRepoLightRun(actorId: string, target: RepoLightTarget, runId: string, includeReport: boolean, deps: RepoLightDependencies = {}) {
  const value = await repoLightRpc(repoLightDatabase(deps).read({ p_actor_id: actorId, p_assignment_id: target.assignmentId, p_student_id: target.studentId, p_run_id: runId, p_include_report: includeReport }))
  const row = parseRepoLightRun(value, actorId, target, runId)
  if (typeof row.source_current !== 'boolean') throw new ApiError(503, 'repolight_invalid_storage')
  return row
}
export async function getAssignmentRepoLightRun(actorId: string, target: RepoLightTarget, runId: string, deps: RepoLightDependencies = {}) {
  const row = await readAssignmentRepoLightRun(actorId, target, runId, false, deps)
  return repoLightRunView(row, row.source_current!, deps.now?.())
}
export async function getAssignmentRepoLightReport(actorId: string, target: RepoLightTarget, runId: string, deps: RepoLightDependencies = {}) {
  const row = await readAssignmentRepoLightRun(actorId, target, runId, true, deps)
  const result = row.report
  if (!result || !row.analysis_id) throw new ApiError(404, 'repolight_report_unavailable')
  if (result.analysisId !== row.analysis_id || result.requestFingerprint !== row.request_fingerprint || !same(result.clientBinding, row.create_envelope.clientBinding) || digestRepoLightJson(result.bundle) !== result.reportDigest) throw new ApiError(503, 'repolight_invalid_storage')
  return { run: repoLightRunView(row, row.source_current!, deps.now?.()), report: { reportDigest: result.reportDigest, bundle: result.bundle } }
}
export async function advanceAssignmentRepoLightRun(actorId: string, target: RepoLightTarget, runId: string, deps: RepoLightDependencies = {}) {
  const prior = await readAssignmentRepoLightRun(actorId, target, runId, false, deps)
  if (prior.detached) throw new ApiError(409, 'repolight_detached_read_only')
  let config, connection
  try { config = (deps.config ?? parseRepoLightConfig)(); connection = resolveRepoLightConnection(config, actorId, prior.connection_json.connectionRef) }
  catch { throw new ApiError(503, 'repolight_not_configured') }
  if (connection.workspaceRef !== prior.connection_json.workspaceRef || connection.installationRef !== prior.connection_json.installationRef) throw new ApiError(503, 'repolight_not_configured')
  if (!config.enabled && !prior.analysis_id && prior.attempt_count === 0) throw new ApiError(503, 'repolight_disabled')
  const db = repoLightDatabase(deps)
  const args = { p_actor_id: actorId, p_assignment_id: target.assignmentId, p_student_id: target.studentId, p_run_id: runId }
  let row = parseRepoLightRun(await repoLightRpc(db.advance({ ...args, p_action: 'claim', p_payload: {} })), actorId, target, runId)
  if (!row.lease_token || ['completed', 'failed', 'stale'].includes(row.status)) return repoLightRunView(row, prior.source_current!, deps.now?.())
  const lease = { leaseToken: row.lease_token, leaseGeneration: row.lease_generation }
  const transition = async (action: Contract['advance_assignment_repolight_run_v1']['Args']['p_action'], payload: Record<string, unknown> = {}) => {
    row = parseRepoLightRun(await repoLightRpc(db.advance({ ...args, p_action: action, p_payload: toRepoLightRpcJson({ ...lease, ...payload }) })), actorId, target, runId)
    return row
  }
  const authorize = () => transition('authorize')
  const transport = (deps.clientFactory ?? createRepoLightClient)(connection, { apiOrigin: config.apiOrigin!, enabled: config.enabled,
    fetchImpl: async (input, init) => { await authorize(); return (deps.fetchImpl ?? fetch)(input, init) } })
  try {
    await authorize()
    const prepared = prepareRepoLightCreate(row.create_envelope)
    if (!row.analysis_id) {
      const submit = { ...prepared, idempotencyKey: row.idempotency_key }
      const status = prior.attempt_count > 0 ? await transport.reconcileAnalysis(submit) : await transport.createAnalysis(submit)
      await transition('record_remote', { analysisId: status.analysisId })
      await transition('poll_pending')
    } else {
      const expected = { analysisId: row.analysis_id, requestFingerprint: row.request_fingerprint, clientBinding: prepared.envelope.clientBinding, request: row.request_json }
      const status = await transport.getStatus(expected)
      if (status.status === 'succeeded') { await authorize(); const result = await transport.getResult(expected); await transition('complete', { result }) }
      else if (status.status === 'failed') await transition('retry', { errorCode: status.error?.code ?? 'repolight_remote_failed', retryable: false })
      else await transition('poll_pending')
    }
  } catch (error) {
    if (!(error instanceof RepoLightClientError)) throw error
    await transition('retry', { errorCode: error.code, retryable: error.retryable })
  }
  return repoLightRunView(row, true, deps.now?.())
}

/** Bound untrusted teacher request bytes after authentication/ownership, before schema parsing. */
export async function readRepoLightRequestJson(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new ApiError(415, 'JSON required')
  const reader = request.body?.getReader()
  if (!reader) throw new ApiError(400, 'Invalid JSON')
  const chunks: Uint8Array[] = []; let bytes = 0
  try {
    while (true) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength; if (bytes > 65536) { await reader.cancel(); throw new ApiError(413, 'Request too large') }; chunks.push(next.value) }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) } catch { throw new ApiError(400, 'Invalid JSON') }
  } finally { reader.releaseLock() }
}
