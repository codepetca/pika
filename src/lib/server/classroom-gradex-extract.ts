import { createHmac } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import { z } from 'zod'
import { redactDirectIdentifiers } from '@/lib/ai-sanitization'
import {
  GRADEX_DEIDENTIFICATION_CONTRACT,
  GRADEX_EXTRACT_FORMAT,
  GRADEX_EXTRACT_VERSION,
  getClassroomArchiveContract,
  gradexExtractManifestSchema,
  type GradexExtractManifest,
} from '@/lib/contracts/classroom-artifacts'
import { GRADEX_RESOURCE_TABLES } from '@/lib/contracts/classroom-data'
import {
  canonicalJsonStringify,
  contentChecksum,
  decodeClassroomArchiveData,
  encodeTar,
  parseAndValidateNdjson,
  parseTar,
  sha256Bytes,
  verifyClassroomArchiveBundle,
} from '@/lib/server/classroom-archive-format'

const MAX_UNCOMPRESSED_EXTRACT_BYTES = 512 * 1024 * 1024
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const uuidSchema = z.string().uuid()
const genericHandlePattern = /(?<![\p{L}\p{N}_])@[\p{L}\p{N}_][\p{L}\p{N}_.-]{1,63}(?![\p{L}\p{N}_])/gu
const defaultIgnorablePattern = /\p{Default_Ignorable_Code_Point}+/gu
const structuredTokenPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/
const structuredTokenSchema = z.string().regex(structuredTokenPattern)
const safeAnalyticTokens = new Set([
  'active', 'ai', 'cancelled', 'canceled', 'closed', 'comment', 'completed',
  'completed_with_errors', 'draft', 'empty_doc', 'failed', 'generated_reference',
  'grading_feedback', 'image', 'in_progress', 'link', 'missing', 'missing_doc',
  'multiple_choice', 'open', 'open_response', 'pending', 'processing', 'published',
  'queued', 'ready', 'redacted', 'repo_link', 'running', 'skipped',
  'student', 'system', 'teacher', 'teacher_feedback', 'teacher_key', 'test', 'v1',
])
const sanitizedTokenSchema = structuredTokenSchema.refine(
  (value) => safeAnalyticTokens.has(value) || sha256Schema.safeParse(value).success,
  'Gradex token must be an allowlisted analytic value or pseudonym',
)
const forbiddenKeys = new Set<string>([
  ...GRADEX_DEIDENTIFICATION_CONTRACT.forbidden_output_fields,
  'github_login',
  'github_username',
  'repo_name',
  'repo_owner',
  'repo_url',
  'selected_repo_url',
  'snapshot_path',
])

type JsonObject = Record<string, unknown>
type RefSpec = readonly [source: string, output: string, scope: string, required?: boolean]
type ProjectionSpec = {
  entity: string
  refs: readonly RefSpec[]
  copy: readonly string[]
  timestamps: readonly string[]
  actorArrays?: Readonly<Record<string, string>>
}

const PROJECTION_SPECS: Record<string, ProjectionSpec> = {
  assignments: {
    entity: 'assignment',
    refs: [
      ['created_by', 'author_ref', 'actor', true],
    ],
    copy: [
      'position', 'is_draft', 'track_authenticity', 'points_possible',
      'include_in_final', 'gradebook_weight',
    ],
    timestamps: ['due_at', 'released_at', 'created_at', 'updated_at'],
  },
  assignment_ai_grading_runs: {
    entity: 'assignment_ai_grading_run',
    refs: [
      ['assignment_id', 'assignment_ref', 'assignment', true],
      ['triggered_by', 'actor_ref', 'actor', true],
    ],
    copy: [
      'status', 'model', 'gradex_status', 'requested_count', 'gradable_count',
      'processed_count', 'completed_count', 'skipped_missing_count',
      'skipped_empty_count', 'failed_count',
    ],
    timestamps: [
      'gradex_submitted_at', 'gradex_last_polled_at', 'started_at', 'completed_at',
      'created_at', 'updated_at',
    ],
    actorArrays: { requested_student_ids_json: 'requested_actor_refs' },
  },
  assignment_ai_grading_run_items: {
    entity: 'assignment_ai_grading_run_item',
    refs: [
      ['run_id', 'run_ref', 'assignment_ai_grading_run', true],
      ['assignment_id', 'assignment_ref', 'assignment', true],
      ['student_id', 'actor_ref', 'actor', true],
      ['assignment_doc_id', 'assignment_doc_ref', 'assignment_doc'],
    ],
    copy: [
      'queue_position', 'status', 'skip_reason', 'attempt_count', 'last_error_code',
    ],
    timestamps: ['next_retry_at', 'started_at', 'completed_at', 'created_at', 'updated_at'],
  },
  assignment_docs: {
    entity: 'assignment_doc',
    refs: [
      ['assignment_id', 'assignment_ref', 'assignment', true],
      ['student_id', 'actor_ref', 'actor', true],
      ['graded_by', 'grader_ref', 'actor'],
    ],
    copy: [
      'is_submitted', 'score_completion', 'score_thinking', 'score_workflow',
      'ai_feedback_model', 'authenticity_score',
    ],
    timestamps: [
      'submitted_at', 'viewed_at', 'teacher_feedback_draft_updated_at',
      'feedback_returned_at', 'ai_feedback_suggested_at', 'teacher_cleared_at', 'graded_at',
      'returned_at', 'created_at', 'updated_at',
    ],
  },
  assignment_feedback_entries: {
    entity: 'assignment_feedback_entry',
    refs: [
      ['assignment_id', 'assignment_ref', 'assignment', true],
      ['student_id', 'actor_ref', 'actor', true],
      ['created_by', 'author_ref', 'actor'],
    ],
    copy: ['entry_kind', 'author_type'],
    timestamps: ['returned_at', 'created_at'],
  },
  assignment_repo_review_runs: {
    entity: 'assignment_repo_review_run',
    refs: [
      ['assignment_id', 'assignment_ref', 'assignment', true],
      ['triggered_by', 'actor_ref', 'actor', true],
    ],
    copy: ['status', 'metrics_version', 'prompt_version', 'model'],
    timestamps: ['started_at', 'completed_at', 'created_at'],
  },
  assignment_repo_review_results: {
    entity: 'assignment_repo_review_result',
    refs: [
      ['run_id', 'run_ref', 'assignment_repo_review_run', true],
      ['assignment_id', 'assignment_ref', 'assignment', true],
      ['student_id', 'actor_ref', 'actor', true],
    ],
    copy: [
      'commit_count', 'active_days', 'session_count', 'burst_ratio',
      'weighted_contribution', 'relative_contribution_share', 'spread_score',
      'iteration_score', 'draft_score_completion', 'draft_score_thinking',
      'draft_score_workflow', 'confidence',
    ],
    timestamps: ['created_at'],
  },
  assignment_submission_requirements: {
    entity: 'assignment_submission_requirement',
    refs: [['assignment_id', 'assignment_ref', 'assignment', true]],
    copy: ['type', 'required', 'position'],
    timestamps: ['created_at', 'updated_at'],
  },
  tests: {
    entity: 'test',
    refs: [['created_by', 'author_ref', 'actor', true]],
    copy: [
      'assessment_type', 'status', 'show_results', 'position', 'points_possible',
      'include_in_final', 'gradebook_weight',
    ],
    timestamps: ['opens_at', 'created_at', 'updated_at'],
  },
  test_ai_grading_runs: {
    entity: 'test_ai_grading_run',
    refs: [
      ['test_id', 'test_ref', 'test', true],
      ['triggered_by', 'actor_ref', 'actor', true],
    ],
    copy: [
      'status', 'model', 'requested_count',
      'eligible_student_count', 'queued_response_count', 'processed_count',
      'completed_count', 'skipped_unanswered_count', 'skipped_already_graded_count',
      'failed_count',
    ],
    timestamps: ['started_at', 'completed_at', 'created_at', 'updated_at'],
    actorArrays: { requested_student_ids_json: 'requested_actor_refs' },
  },
  test_ai_grading_run_items: {
    entity: 'test_ai_grading_run_item',
    refs: [
      ['run_id', 'run_ref', 'test_ai_grading_run', true],
      ['test_id', 'test_ref', 'test', true],
      ['student_id', 'actor_ref', 'actor', true],
      ['question_id', 'question_ref', 'test_question', true],
      ['response_id', 'response_ref', 'test_response', true],
    ],
    copy: ['queue_position', 'status', 'attempt_count', 'last_error_code'],
    timestamps: ['next_retry_at', 'started_at', 'completed_at', 'created_at', 'updated_at'],
  },
  test_questions: {
    entity: 'test_question',
    refs: [['test_id', 'test_ref', 'test', true]],
    copy: [
      'question_type', 'points', 'response_max_chars', 'response_monospace', 'position',
    ],
    timestamps: ['created_at', 'updated_at'],
  },
  test_responses: {
    entity: 'test_response',
    refs: [
      ['test_id', 'test_ref', 'test', true],
      ['question_id', 'question_ref', 'test_question', true],
      ['student_id', 'actor_ref', 'actor', true],
      ['graded_by', 'grader_ref', 'actor'],
    ],
    copy: [
      'score', 'ai_grading_basis', 'ai_model',
    ],
    timestamps: ['graded_at', 'submitted_at', 'created_at', 'updated_at'],
  },
}

const integerSchema = z.number().int()
const numberSchema = z.number().finite()
const nullableIntegerSchema = integerSchema.nullable()
const nullableNumberSchema = numberSchema.nullable()
const nullableTokenSchema = sanitizedTokenSchema.nullable()

const COPY_FIELD_SCHEMAS: Record<string, Readonly<Record<string, z.ZodTypeAny>>> = {
  assignments: {
    position: integerSchema,
    is_draft: z.boolean(),
    track_authenticity: z.boolean(),
    points_possible: nullableNumberSchema,
    include_in_final: z.boolean(),
    gradebook_weight: numberSchema,
  },
  assignment_ai_grading_runs: {
    status: sanitizedTokenSchema,
    model: nullableTokenSchema,
    gradex_status: nullableTokenSchema,
    requested_count: integerSchema,
    gradable_count: integerSchema,
    processed_count: integerSchema,
    completed_count: integerSchema,
    skipped_missing_count: integerSchema,
    skipped_empty_count: integerSchema,
    failed_count: integerSchema,
  },
  assignment_ai_grading_run_items: {
    queue_position: integerSchema,
    status: sanitizedTokenSchema,
    skip_reason: nullableTokenSchema,
    attempt_count: integerSchema,
    last_error_code: nullableTokenSchema,
  },
  assignment_docs: {
    is_submitted: z.boolean(),
    score_completion: nullableNumberSchema,
    score_thinking: nullableNumberSchema,
    score_workflow: nullableNumberSchema,
    ai_feedback_model: nullableTokenSchema,
    authenticity_score: nullableNumberSchema,
  },
  assignment_feedback_entries: {
    entry_kind: sanitizedTokenSchema,
    author_type: sanitizedTokenSchema,
  },
  assignment_repo_review_runs: {
    status: sanitizedTokenSchema,
    metrics_version: sanitizedTokenSchema,
    prompt_version: sanitizedTokenSchema,
    model: nullableTokenSchema,
  },
  assignment_repo_review_results: {
    commit_count: integerSchema,
    active_days: integerSchema,
    session_count: integerSchema,
    burst_ratio: numberSchema,
    weighted_contribution: numberSchema,
    relative_contribution_share: numberSchema,
    spread_score: numberSchema,
    iteration_score: numberSchema,
    draft_score_completion: nullableNumberSchema,
    draft_score_thinking: nullableNumberSchema,
    draft_score_workflow: nullableNumberSchema,
    confidence: numberSchema,
  },
  assignment_submission_requirements: {
    type: sanitizedTokenSchema,
    required: z.boolean(),
    position: integerSchema,
  },
  tests: {
    assessment_type: sanitizedTokenSchema,
    status: sanitizedTokenSchema,
    show_results: z.boolean(),
    position: integerSchema,
    points_possible: nullableNumberSchema,
    include_in_final: z.boolean(),
    gradebook_weight: numberSchema,
  },
  test_ai_grading_runs: {
    status: sanitizedTokenSchema,
    model: nullableTokenSchema,
    requested_count: integerSchema,
    eligible_student_count: integerSchema,
    queued_response_count: integerSchema,
    processed_count: integerSchema,
    completed_count: integerSchema,
    skipped_unanswered_count: integerSchema,
    skipped_already_graded_count: integerSchema,
    failed_count: integerSchema,
  },
  test_ai_grading_run_items: {
    queue_position: integerSchema,
    status: sanitizedTokenSchema,
    attempt_count: integerSchema,
    last_error_code: nullableTokenSchema,
  },
  test_questions: {
    question_type: sanitizedTokenSchema,
    points: numberSchema,
    response_max_chars: nullableIntegerSchema,
    response_monospace: z.boolean(),
    position: integerSchema,
  },
  test_responses: {
    score: nullableNumberSchema,
    ai_grading_basis: nullableTokenSchema,
    ai_model: nullableTokenSchema,
  },
}

function projectedRowSchema(table: string): z.ZodType<JsonObject> {
  const spec = PROJECTION_SPECS[table]
  const copySchemas = COPY_FIELD_SCHEMAS[table]
  if (!spec || !copySchemas) throw new Error(`No Gradex row schema exists for ${table}`)
  if (
    Object.keys(copySchemas).length !== spec.copy.length ||
    spec.copy.some((field) => !Object.hasOwn(copySchemas, field))
  ) {
    throw new Error(`Gradex row schema does not match the projection for ${table}`)
  }

  const shape: Record<string, z.ZodTypeAny> = { row_ref: sha256Schema }
  for (const [, target, , required] of spec.refs) {
    shape[target] = required ? sha256Schema : sha256Schema.nullable()
  }
  for (const field of spec.copy) shape[field] = copySchemas[field]
  for (const field of spec.timestamps) {
    shape[`${field.endsWith('_at') ? field.slice(0, -3) : field}_offset_ms`] = nullableNumberSchema
  }
  for (const target of Object.values(spec.actorArrays || {})) {
    shape[target] = z.array(sha256Schema)
  }
  return z.object(shape).strict()
}

const PROJECTED_ROW_SCHEMAS = Object.fromEntries(
  Object.keys(PROJECTION_SPECS).map((table) => [table, projectedRowSchema(table)]),
) as Record<string, z.ZodType<JsonObject>>

const RELATION_TARGETS: Record<string, Readonly<Record<string, string>>> = {
  assignment_ai_grading_runs: { assignment_ref: 'assignments' },
  assignment_ai_grading_run_items: {
    run_ref: 'assignment_ai_grading_runs',
    assignment_ref: 'assignments',
    assignment_doc_ref: 'assignment_docs',
  },
  assignment_docs: { assignment_ref: 'assignments' },
  assignment_feedback_entries: { assignment_ref: 'assignments' },
  assignment_repo_review_runs: { assignment_ref: 'assignments' },
  assignment_repo_review_results: {
    run_ref: 'assignment_repo_review_runs',
    assignment_ref: 'assignments',
  },
  assignment_submission_requirements: { assignment_ref: 'assignments' },
  test_ai_grading_runs: { test_ref: 'tests' },
  test_ai_grading_run_items: {
    run_ref: 'test_ai_grading_runs',
    test_ref: 'tests',
    question_ref: 'test_questions',
    response_ref: 'test_responses',
  },
  test_questions: { test_ref: 'tests' },
  test_responses: { test_ref: 'tests', question_ref: 'test_questions' },
}

export type BuiltGradexExtractBundle = {
  extract: Uint8Array
  artifactSha256: string
  uncompressedByteSize: number
  manifest: GradexExtractManifest
}

export type VerifiedGradexExtractBundle =
  | {
      ok: true
      manifest: GradexExtractManifest
      resources: Record<string, JsonObject[]>
      files: Map<string, Buffer>
    }
  | { ok: false; error: string }

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizePrivacyText(value: string): string {
  return value.normalize('NFKC').replace(defaultIgnorablePattern, '')
}

function knownIdentityPattern(value: string): RegExp {
  return new RegExp(
    `(?<![\\p{L}\\p{N}_])${escapeRegExp(value)}(?![\\p{L}\\p{N}_])`,
    'giu',
  )
}

function identityTerms(actors: Array<{
  email: string
  profile: { student_number: string | null; first_name: string; last_name: string } | null
}>): string[] {
  const values = new Set<string>()
  for (const actor of actors) {
    values.add(normalizePrivacyText(actor.email.trim()))
    if (!actor.profile) continue
    const firstName = normalizePrivacyText(actor.profile.first_name.trim())
    const lastName = normalizePrivacyText(actor.profile.last_name.trim())
    const fullName = `${firstName} ${lastName}`.trim()
    if (fullName.length >= 4) values.add(fullName)
    if (firstName.length >= 2) values.add(firstName)
    if (lastName.length >= 2) values.add(lastName)
    if (actor.profile.student_number?.trim()) {
      values.add(normalizePrivacyText(actor.profile.student_number.trim()))
    }
  }
  return [...values].filter(Boolean).sort((left, right) => right.length - left.length)
}

function redactString(value: string, knownTerms: string[]): string {
  let output = redactDirectIdentifiers(normalizePrivacyText(value))
    .replace(genericHandlePattern, '[handle redacted]')
  for (const term of knownTerms) {
    output = output.replace(knownIdentityPattern(term), '[redacted-identity]')
  }
  return output
}

function sanitizeValue(
  value: unknown,
  knownTerms: string[],
  pseudonymize: (scope: string, value: string) => string,
  scope: string,
): unknown {
  if (typeof value === 'string') {
    const normalized = normalizePrivacyText(value)
    const redacted = redactString(normalized, knownTerms)
    if (redacted !== normalized || !structuredTokenPattern.test(redacted)) return 'redacted'
    return safeAnalyticTokens.has(redacted)
      ? redacted
      : pseudonymize(`token:${scope}`, redacted)
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => sanitizeValue(
      item,
      knownTerms,
      pseudonymize,
      `${scope}[${index}]`,
    ))
  }
  if (!isJsonObject(value)) return value

  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    if (key === 'id' || key.endsWith('_id') || forbiddenKeys.has(key)) return []
    return [[key, sanitizeValue(item, knownTerms, pseudonymize, `${scope}.${key}`)]]
  }))
}

function timestampOffsetMs(value: unknown, originMs: number, field: string): number | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new Error(`Gradex timestamp ${field} must be a string`)
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new Error(`Gradex timestamp ${field} is invalid`)
  return parsed - originMs
}

function offsetFieldName(field: string): string {
  return `${field.endsWith('_at') ? field.slice(0, -3) : field}_offset_ms`
}

function readReference(value: unknown, field: string, required = false): string | null {
  if (value === null || value === undefined) {
    if (required) throw new Error(`Gradex source row is missing ${field}`)
    return null
  }
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Gradex source reference ${field} is invalid`)
  }
  return value
}

function createPseudonymizer(secret: string, extractId: string) {
  if (Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('Gradex extract HMAC secret must contain at least 32 bytes')
  }
  const key = createHmac('sha256', secret)
    .update(`pika-gradex-v2\0${uuidSchema.parse(extractId)}`)
    .digest()
  return (scope: string, value: string) => createHmac('sha256', key)
    .update(`${scope}\0${value}`)
    .digest('hex')
}

function projectRow(args: {
  table: string
  row: JsonObject
  originMs: number
  knownTerms: string[]
  pseudonymize: (scope: string, value: string) => string
}): JsonObject {
  const spec = PROJECTION_SPECS[args.table]
  if (!spec) throw new Error(`No Gradex projection exists for ${args.table}`)
  const sourceId = readReference(args.row.id, `${args.table}.id`, true) as string
  const output: JsonObject = {
    row_ref: args.pseudonymize(spec.entity, sourceId),
  }

  for (const [source, target, scope, required] of spec.refs) {
    const value = readReference(args.row[source], `${args.table}.${source}`, required)
    output[target] = value ? args.pseudonymize(scope, value) : null
  }
  for (const field of spec.copy) {
    if (args.row[field] === undefined) {
      throw new Error(`Gradex source field ${args.table}.${field} is missing`)
    }
    output[field] = sanitizeValue(
      args.row[field],
      args.knownTerms,
      args.pseudonymize,
      `${args.table}.${field}`,
    )
  }
  for (const field of spec.timestamps) {
    if (args.row[field] === undefined) {
      throw new Error(`Gradex source timestamp ${args.table}.${field} is missing`)
    }
    output[offsetFieldName(field)] = timestampOffsetMs(
      args.row[field],
      args.originMs,
      `${args.table}.${field}`,
    )
  }
  for (const [source, target] of Object.entries(spec.actorArrays || {})) {
    const value = args.row[source]
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
      throw new Error(`Gradex actor list ${args.table}.${source} is invalid`)
    }
    output[target] = value.map((item) => args.pseudonymize('actor', item as string))
  }
  return output
}

function encodeRows(rows: JsonObject[], table: string): Buffer {
  const ordered = [...rows].sort((left, right) => {
    const leftRef = sha256Schema.parse(left.row_ref)
    const rightRef = sha256Schema.parse(right.row_ref)
    return Buffer.compare(Buffer.from(leftRef, 'utf8'), Buffer.from(rightRef, 'utf8'))
  })
  const refs = ordered.map((row) => sha256Schema.parse(row.row_ref))
  if (new Set(refs).size !== refs.length) {
    throw new Error(`Gradex resource has duplicate row references: ${table}`)
  }
  if (ordered.length === 0) return Buffer.alloc(0)
  return Buffer.from(`${ordered.map(canonicalJsonStringify).join('\n')}\n`, 'utf8')
}

function directIdentifierFindings(
  value: unknown,
  path = '$',
  knownTerms: string[] = [],
): string[] {
  if (typeof value === 'string') {
    const normalized = normalizePrivacyText(value)
    const findings: string[] = []
    if (redactDirectIdentifiers(normalized) !== normalized) findings.push(`${path}:direct-identifier`)
    if (genericHandlePattern.test(normalized)) findings.push(`${path}:handle`)
    genericHandlePattern.lastIndex = 0
    if (knownTerms.some((term) => knownIdentityPattern(term).test(normalized))) {
      findings.push(`${path}:known-identity`)
    }
    return findings
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => (
      directIdentifierFindings(item, `${path}[${index}]`, knownTerms)
    ))
  }
  if (!isJsonObject(value)) return []
  return Object.entries(value).flatMap(([key, item]) => {
    const keyFindings = key === 'id' || key.endsWith('_id') || key.endsWith('_at') || forbiddenKeys.has(key)
      ? [`${path}.${key}:forbidden-key`]
      : []
    return [...keyFindings, ...directIdentifierFindings(item, `${path}.${key}`, knownTerms)]
  })
}

function validateProjectedRow(row: JsonObject, table: string): JsonObject {
  try {
    return PROJECTED_ROW_SCHEMAS[table].parse(row)
  } catch {
    throw new Error(`Invalid Gradex projected row for ${table}`)
  }
}

function validateProjectedRelationships(resources: Record<string, JsonObject[]>) {
  const refsByTable = new Map(
    Object.entries(resources).map(([table, rows]) => [
      table,
      new Set(rows.map((row) => sha256Schema.parse(row.row_ref))),
    ]),
  )
  for (const [table, relationships] of Object.entries(RELATION_TARGETS)) {
    for (const row of resources[table] || []) {
      for (const [field, targetTable] of Object.entries(relationships)) {
        const value = row[field]
        if (value === null || value === undefined) continue
        if (!refsByTable.get(targetTable)?.has(sha256Schema.parse(value))) {
          throw new Error(`Gradex relationship is unresolved: ${table}.${field}`)
        }
      }
    }
  }
}

export function buildGradexExtractFromClassroomArchive(input: {
  archive: Uint8Array
  extractId: string
  generatedAt: string
  deleteAfter: string
  hmacSecret: string
}): BuiltGradexExtractBundle {
  const expectedTables = new Set<string>(GRADEX_RESOURCE_TABLES)
  const configuredTables = Object.keys(PROJECTION_SPECS)
  if (
    configuredTables.length !== expectedTables.size ||
    configuredTables.some((table) => !expectedTables.has(table))
  ) {
    throw new Error('Gradex projection inventory does not match the resource contract')
  }
  const verifiedArchive = verifyClassroomArchiveBundle(input.archive)
  if (!verifiedArchive.ok) throw new Error(`Gradex source archive is invalid: ${verifiedArchive.error}`)
  if (!getClassroomArchiveContract(verifiedArchive.manifest.version).gradexEnabled) {
    throw new Error(
      `Classroom archive version ${verifiedArchive.manifest.version} is not enabled for Gradex`,
    )
  }
  const generatedAt = z.string().datetime({ offset: true }).parse(input.generatedAt)
  const deleteAfter = z.string().datetime({ offset: true }).parse(input.deleteAfter)
  if (Date.parse(deleteAfter) <= Date.parse(generatedAt)) {
    throw new Error('Gradex extract deletion must be after generation')
  }
  const decoded = decodeClassroomArchiveData(verifiedArchive)
  const knownTerms = identityTerms(decoded.actors)
  const pseudonymize = createPseudonymizer(input.hmacSecret, input.extractId)
  const originMs = Date.parse(verifiedArchive.manifest.created_at)
  if (Date.parse(generatedAt) < originMs) {
    throw new Error('Gradex extract cannot predate its source archive')
  }
  const entries: Array<{ path: string; bytes: Uint8Array }> = []
  const projectedResources: Record<string, JsonObject[]> = {}

  for (const table of GRADEX_RESOURCE_TABLES) {
    const rows = (decoded.resources[table] || []).map((row) => validateProjectedRow(projectRow({
      table,
      row,
      originMs,
      knownTerms,
      pseudonymize,
    }), table))
    const findings = directIdentifierFindings(rows, '$', knownTerms)
    if (findings.length > 0) {
      throw new Error(`Gradex privacy scan failed for ${table}: ${findings[0]}`)
    }
    projectedResources[table] = rows
    const path = `data/${table}.ndjson`
    const bytes = encodeRows(rows, table)
    entries.push({ path, bytes })
  }

  const resources = entries.map((entry) => ({
    table: entry.path.slice('data/'.length, -'.ndjson'.length),
    path: entry.path,
    row_count: projectedResources[entry.path.slice('data/'.length, -'.ndjson'.length)].length,
    byte_size: entry.bytes.byteLength,
    sha256: sha256Bytes(entry.bytes),
  }))
  const manifest = gradexExtractManifestSchema.parse({
    format: GRADEX_EXTRACT_FORMAT,
    version: GRADEX_EXTRACT_VERSION,
    extract_id: uuidSchema.parse(input.extractId),
    source_archive_ref: sha256Bytes(input.archive),
    classroom_ref: pseudonymize('classroom', verifiedArchive.manifest.classroom_id),
    generated_at: generatedAt,
    compression: 'tar+gzip',
    content_sha256: contentChecksum(resources),
    pseudonymization: 'hmac-sha256-per-extract',
    timestamp_offsets_from: 'source-archive-created-at',
    privacy_policy_version: 2,
    direct_identifiers_removed: true,
    direct_identifier_findings: 0,
    privacy_scanner_version: 2,
    free_text_included: false,
    storage_objects_included: false,
    delete_after: deleteAfter,
    resources,
  })
  const manifestBytes = Buffer.from(`${canonicalJsonStringify(manifest)}\n`, 'utf8')
  const tar = encodeTar([
    { path: 'manifest.json', bytes: manifestBytes },
    ...entries.sort((left, right) => (
      Buffer.compare(Buffer.from(left.path, 'utf8'), Buffer.from(right.path, 'utf8'))
    )),
  ])
  const extract = gzipSync(tar, { level: 9 })
  return {
    extract,
    artifactSha256: sha256Bytes(extract),
    uncompressedByteSize: tar.byteLength,
    manifest,
  }
}

export function verifyGradexExtractBundle(input: Uint8Array): VerifiedGradexExtractBundle {
  try {
    const tar = gunzipSync(input, { maxOutputLength: MAX_UNCOMPRESSED_EXTRACT_BYTES })
    const files = parseTar(tar)
    const manifestBytes = files.get('manifest.json')
    if (!manifestBytes) return { ok: false, error: 'Gradex manifest is missing' }
    const manifest = gradexExtractManifestSchema.parse(JSON.parse(manifestBytes.toString('utf8')))
    if (manifestBytes.toString('utf8') !== `${canonicalJsonStringify(manifest)}\n`) {
      return { ok: false, error: 'Gradex manifest is not canonically serialized' }
    }
    const expectedPaths = new Set(['manifest.json', ...manifest.resources.map((item) => item.path)])
    if (files.size !== expectedPaths.size || [...files.keys()].some((path) => !expectedPaths.has(path))) {
      return { ok: false, error: 'Gradex extract contains unexpected or duplicate files' }
    }

    const resources: Record<string, JsonObject[]> = {}
    for (const descriptor of manifest.resources) {
      const bytes = files.get(descriptor.path)
      if (!bytes) return { ok: false, error: `Gradex resource is missing: ${descriptor.table}` }
      if (bytes.byteLength !== descriptor.byte_size || sha256Bytes(bytes) !== descriptor.sha256) {
        return { ok: false, error: `Gradex resource integrity mismatch: ${descriptor.table}` }
      }
      const rows = parseAndValidateNdjson(bytes).map((row) => {
        if (!isJsonObject(row)) throw new Error(`Gradex row must be an object: ${descriptor.table}`)
        return validateProjectedRow(row, descriptor.table)
      })
      if (rows.length !== descriptor.row_count) {
        return { ok: false, error: `Gradex resource row count mismatch: ${descriptor.table}` }
      }
      const refs = rows.map((row) => row.row_ref as string)
      if (
        new Set(refs).size !== refs.length ||
        refs.some((ref, index) => index > 0 && (
          Buffer.compare(Buffer.from(refs[index - 1], 'utf8'), Buffer.from(ref, 'utf8')) >= 0
        ))
      ) {
        return { ok: false, error: `Gradex resource ordering mismatch: ${descriptor.table}` }
      }
      if (directIdentifierFindings(rows).length > 0) {
        return { ok: false, error: `Gradex privacy scan failed: ${descriptor.table}` }
      }
      resources[descriptor.table] = rows
    }
    validateProjectedRelationships(resources)
    if (contentChecksum(manifest.resources) !== manifest.content_sha256) {
      return { ok: false, error: 'Gradex content checksum mismatch' }
    }
    return { ok: true, manifest, resources, files }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Invalid Gradex extract',
    }
  }
}
