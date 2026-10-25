import { z } from 'zod'
import { publicRepositoryRequestSchema, publicRepositoryBundleSchema } from '@/lib/contracts/repolight/report/bundle-contract'
import { createAnalysisRequestSchema, analysisResultSchema } from '@/lib/contracts/repolight/service/contract'

const uuid = z.uuid()
const instant = z.iso.datetime({ offset: true })
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const ref = z.string().min(1).max(128).regex(/^[A-Za-z0-9._~-]+$/)
const nullableText = z.string().nullable()
const json = z.json()
export const repoLightTargetSchema = z.object({ assignmentId: uuid, studentId: uuid }).strict()
export const repoLightRouteParamsSchema = z.object({ id: uuid, studentId: uuid, runId: uuid.optional() }).strict()
export const repoLightRunRouteParamsSchema = repoLightRouteParamsSchema.extend({ runId: uuid })
export const repoLightAnalysisOptionsSchema = z.object({
  githubUsername: z.string().max(200).nullable().optional(), branch: z.string().trim().min(1).max(200).optional(),
  period: z.object({ startAt: instant, endAt: instant, timezone: z.literal('America/Toronto') }).strict().optional(),
  scheduledProjectDates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(366).nullable().optional(),
  baselineReviewed: z.boolean().optional(), exclusions: z.object({ commitShas: z.array(z.string().regex(/^[a-f0-9]{40}$/)).max(250), pathPrefixes: z.array(z.string().max(500)).max(100), botLogins: z.array(z.string().max(100)).max(100) }).strict().optional(),
}).strict()
export const beginRepoLightRequestSchema = z.object({ requestId: uuid, requirementId: uuid.optional(), analysisOptions: repoLightAnalysisOptionsSchema.optional() }).strict()
export const advanceRepoLightRequestSchema = z.object({}).strict()
export const importRepoLightRequestSchema = z.object({ requestId: uuid, scopeKey: z.string().max(160).regex(/^(repository|contributor:[A-Za-z0-9._~-]+)$/), expectedDocUpdatedAt: instant, expectedReportDigest: digest, feedbackText: z.string().trim().min(1).max(20000).optional() }).strict()
export type BeginRepoLightRequest = z.infer<typeof beginRepoLightRequestSchema>
export type RepoLightTarget = z.infer<typeof repoLightTargetSchema>
export type ImportRepoLightRequest = z.infer<typeof importRepoLightRequestSchema>

export const repoLightSourceSchema = z.object({
  classroom: z.object({ teacher_id: uuid, archived_at: nullableText }).catchall(json),
  assignment: z.object({ id: uuid, classroom_id: uuid, due_at: nullableText, released_at: nullableText, is_draft: z.boolean(), blueprint_archived_at: nullableText }).catchall(json),
  enrollment: z.object({ id: uuid, classroom_id: uuid, student_id: uuid, created_at: z.string() }).catchall(json).nullable(),
  doc: z.object({ id: uuid, repo_url: nullableText, github_username: nullableText }).catchall(json).nullable(),
  artifacts: z.array(z.object({ id: uuid, assignment_doc_id: uuid, requirement_id: uuid, student_id: uuid, type: z.literal('repo_link'), url: nullableText, metadata_json: z.record(z.string(), json) }).catchall(json)).max(100),
  repo_target: z.object({ selected_repo_url: nullableText, selection_mode: z.string(), override_github_username: nullableText }).catchall(json).nullable(),
  class_days: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), is_class_day: z.boolean() }).catchall(json)).max(5000),
}).strict()
export type RepoLightSource = z.infer<typeof repoLightSourceSchema>
export const repoLightRunRowSchema = z.object({
  id: uuid, subject_binding_id: uuid.nullable(), detached: z.boolean().default(false), classroom_id: uuid, assignment_id: uuid, student_id: uuid, actor_id: uuid,
  source_json: repoLightSourceSchema, source_fingerprint: digest,
  connection_json: z.object({ connectionRef: ref, workspaceRef: ref, installationRef: ref }).strict(),
  request_json: publicRepositoryRequestSchema, create_envelope: createAnalysisRequestSchema,
  request_fingerprint: digest, idempotency_key: z.string().max(128), analysis_id: uuid.nullable(),
  status: z.enum(['queued', 'submitting', 'running', 'completed', 'failed', 'stale']), attempt_count: z.number().int().min(0).max(3),
  poll_failure_count: z.number().int().min(0).max(3).default(0), next_retry_at: nullableText,
  lease_token: uuid.nullable().optional(), lease_generation: z.number().int().nonnegative(), lease_expires_at: nullableText,
  error_code: z.string().regex(/^[a-z_]{1,64}$/).nullable(), created_at: z.string(), completed_at: nullableText,
  source_current: z.boolean().optional(), report: analysisResultSchema.nullable().optional(),
}).strict().refine(row => row.subject_binding_id !== null || row.detached, 'An active run requires its private subject binding.')
export type RepoLightRunRow = z.infer<typeof repoLightRunRowSchema>
export const repoLightSourceResponseSchema = z.object({ source: repoLightSourceSchema, source_fingerprint: digest, latest_run: repoLightRunRowSchema.nullable() }).strict()
export const repoLightImportResultSchema = z.object({ imported: z.literal(true), replayed: z.boolean(), doc: z.object({ id: uuid, assignment_id: uuid, student_id: uuid, updated_at: z.string(), teacher_feedback_draft: z.string(), teacher_feedback_draft_updated_at: z.string() }).strict() }).strict()

export const repoLightRunViewSchema = z.object({ id: uuid, status: z.enum(['queued', 'submitting', 'running', 'completed', 'failed', 'stale']), sourceCurrent: z.boolean(), canAdvance: z.boolean(), canImport: z.boolean(), reportAvailable: z.boolean(), errorCode: z.string().nullable(), nextRetryAt: nullableText }).strict()
export const repoLightRepositoryChoiceSchema = z.object({ requirementId: uuid, repositoryUrl: publicRepositoryRequestSchema.shape.repositoryUrl.max(2048), label: z.string().min(1).max(2048) }).strict()
export type RepoLightRepositoryChoice = z.infer<typeof repoLightRepositoryChoiceSchema>
export const repoLightSourceSummarySchema = z.object({ repositoryChoices: z.array(repoLightRepositoryChoiceSchema).max(100).default([]), available: z.boolean(), repositoryUrl: nullableText, githubUsername: nullableText, usernameProvenance: z.enum(['analysis_override', 'teacher_override', 'artifact', 'legacy', 'none']), requirementId: uuid.nullable(), period: z.object({ startAt: instant, endAt: instant, timezone: z.literal('America/Toronto') }).strict().nullable(), periodDefaulted: z.boolean(), notice: nullableText }).strict()
export const repoLightContextReplySchema = z.object({ state: z.enum(['disabled', 'not_configured', 'ready', 'unavailable']), source: repoLightSourceSummarySchema, run: repoLightRunViewSchema.nullable() }).strict()
export const repoLightRunReplySchema = z.object({ run: repoLightRunViewSchema }).strict()
export const repoLightReportReplySchema = z.object({ run: repoLightRunViewSchema, report: z.object({ reportDigest: digest, bundle: publicRepositoryBundleSchema }).strict() }).strict()
export type RepoLightRunView = z.infer<typeof repoLightRunViewSchema>
export type RepoLightContextReply = z.infer<typeof repoLightContextReplySchema>
export type RepoLightReportReply = z.infer<typeof repoLightReportReplySchema>
