import { createHmac } from 'node:crypto'
import { gzipSync, gunzipSync } from 'node:zlib'
import { z } from 'zod'
import { redactDirectIdentifiers } from '@/lib/ai-sanitization'
import {
  GRADEX_DEIDENTIFICATION_CONTRACT,
  GRADEX_EXTRACT_FORMAT,
  GRADEX_EXTRACT_VERSION,
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
const genericHandlePattern = /(^|\s)@[A-Za-z0-9_]{2,39}\b/g
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
      ['created_by', 'author_ref', 'actor'],
    ],
    copy: [
      'title', 'description', 'instructions_markdown', 'rich_instructions', 'position',
      'is_draft', 'track_authenticity', 'points_possible', 'include_in_final',
      'gradebook_weight',
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
      'last_error_message',
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
      'content', 'is_submitted', 'score_completion', 'score_thinking', 'score_workflow',
      'feedback', 'teacher_feedback_draft', 'ai_feedback_suggestion', 'ai_feedback_model',
      'authenticity_score',
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
    copy: ['entry_kind', 'author_type', 'body'],
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
      'iteration_score', 'semantic_breakdown_json', 'draft_score_completion',
      'draft_score_thinking', 'draft_score_workflow', 'draft_feedback', 'confidence',
    ],
    timestamps: ['created_at'],
  },
  assignment_submission_requirements: {
    entity: 'assignment_submission_requirement',
    refs: [['assignment_id', 'assignment_ref', 'assignment', true]],
    copy: ['type', 'label', 'instructions', 'required', 'position', 'validation_policy_json'],
    timestamps: ['created_at', 'updated_at'],
  },
  tests: {
    entity: 'test',
    refs: [['created_by', 'author_ref', 'actor']],
    copy: [
      'title', 'assessment_type', 'status', 'show_results', 'documents', 'position',
      'points_possible', 'include_in_final', 'gradebook_weight',
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
      'status', 'model', 'prompt_guideline_override', 'requested_count',
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
    copy: ['queue_position', 'status', 'attempt_count', 'last_error_code', 'last_error_message'],
    timestamps: ['next_retry_at', 'started_at', 'completed_at', 'created_at', 'updated_at'],
  },
  test_questions: {
    entity: 'test_question',
    refs: [['test_id', 'test_ref', 'test', true]],
    copy: [
      'question_type', 'question_text', 'options', 'correct_option', 'answer_key',
      'sample_solution', 'points', 'response_max_chars', 'response_monospace', 'position',
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
      'selected_option', 'response_text', 'score', 'feedback', 'ai_grading_basis',
      'ai_reference_answers', 'ai_model',
    ],
    timestamps: ['graded_at', 'submitted_at', 'created_at', 'updated_at'],
  },
}

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

function identityTerms(actors: Array<{
  email: string
  profile: { student_number: string | null; first_name: string; last_name: string } | null
}>): string[] {
  const values = new Set<string>()
  for (const actor of actors) {
    values.add(actor.email.trim())
    if (!actor.profile) continue
    const fullName = `${actor.profile.first_name} ${actor.profile.last_name}`.trim()
    if (fullName.length >= 4) values.add(fullName)
    if (actor.profile.first_name.trim().length >= 2) values.add(actor.profile.first_name.trim())
    if (actor.profile.last_name.trim().length >= 2) values.add(actor.profile.last_name.trim())
    if (actor.profile.student_number?.trim()) values.add(actor.profile.student_number.trim())
  }
  return [...values].filter(Boolean).sort((left, right) => right.length - left.length)
}

function redactString(value: string, knownTerms: string[]): string {
  let output = redactDirectIdentifiers(value)
    .replace(genericHandlePattern, '$1[handle redacted]')
  for (const term of knownTerms) {
    output = output.replace(new RegExp(`\\b${escapeRegExp(term)}\\b`, 'gi'), '[redacted-identity]')
  }
  return output
}

function sanitizeValue(value: unknown, knownTerms: string[]): unknown {
  if (typeof value === 'string') return redactString(value, knownTerms)
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, knownTerms))
  if (!isJsonObject(value)) return value

  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    if (key === 'id' || key.endsWith('_id') || forbiddenKeys.has(key)) return []
    return [[key, sanitizeValue(item, knownTerms)]]
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
    .update(`pika-gradex-v1\0${uuidSchema.parse(extractId)}`)
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
    if (args.row[field] !== undefined) {
      output[field] = sanitizeValue(args.row[field], args.knownTerms)
    }
  }
  for (const field of spec.timestamps) {
    if (args.row[field] !== undefined) {
      output[offsetFieldName(field)] = timestampOffsetMs(
        args.row[field],
        args.originMs,
        `${args.table}.${field}`,
      )
    }
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
    return leftRef.localeCompare(rightRef)
  })
  const refs = ordered.map((row) => sha256Schema.parse(row.row_ref))
  if (new Set(refs).size !== refs.length) {
    throw new Error(`Gradex resource has duplicate row references: ${table}`)
  }
  if (ordered.length === 0) return Buffer.alloc(0)
  return Buffer.from(`${ordered.map(canonicalJsonStringify).join('\n')}\n`, 'utf8')
}

function directIdentifierFindings(value: unknown, path = '$'): string[] {
  if (typeof value === 'string') {
    const findings: string[] = []
    if (redactDirectIdentifiers(value) !== value) findings.push(`${path}:direct-identifier`)
    if (genericHandlePattern.test(value)) findings.push(`${path}:handle`)
    genericHandlePattern.lastIndex = 0
    return findings
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => directIdentifierFindings(item, `${path}[${index}]`))
  }
  if (!isJsonObject(value)) return []
  return Object.entries(value).flatMap(([key, item]) => {
    const keyFindings = key === 'id' || key.endsWith('_id') || key.endsWith('_at') || forbiddenKeys.has(key)
      ? [`${path}.${key}:forbidden-key`]
      : []
    return [...keyFindings, ...directIdentifierFindings(item, `${path}.${key}`)]
  })
}

function validatePseudonymFields(row: JsonObject, table: string) {
  for (const [key, value] of Object.entries(row)) {
    if (key.endsWith('_ref') && value !== null) {
      sha256Schema.parse(value)
    }
    if (key.endsWith('_refs')) {
      z.array(sha256Schema).parse(value)
    }
  }
  try {
    sha256Schema.parse(row.row_ref)
  } catch {
    throw new Error(`Invalid Gradex row reference for ${table}`)
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
  const expectedTables = new Set(GRADEX_RESOURCE_TABLES)
  const configuredTables = Object.keys(PROJECTION_SPECS)
  if (
    configuredTables.length !== expectedTables.size ||
    configuredTables.some((table) => !expectedTables.has(table))
  ) {
    throw new Error('Gradex projection inventory does not match the resource contract')
  }
  const verifiedArchive = verifyClassroomArchiveBundle(input.archive)
  if (!verifiedArchive.ok) throw new Error(`Gradex source archive is invalid: ${verifiedArchive.error}`)
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
    const rows = (decoded.resources[table] || []).map((row) => projectRow({
      table,
      row,
      originMs,
      knownTerms,
      pseudonymize,
    }))
    const findings = directIdentifierFindings(rows)
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
    privacy_policy_version: 1,
    direct_identifiers_removed: true,
    direct_identifier_findings: 0,
    privacy_scanner_version: 1,
    storage_objects_included: false,
    delete_after: deleteAfter,
    resources,
  })
  const manifestBytes = Buffer.from(`${canonicalJsonStringify(manifest)}\n`, 'utf8')
  const tar = encodeTar([
    { path: 'manifest.json', bytes: manifestBytes },
    ...entries.sort((left, right) => left.path.localeCompare(right.path)),
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
        validatePseudonymFields(row, descriptor.table)
        return row
      })
      if (rows.length !== descriptor.row_count) {
        return { ok: false, error: `Gradex resource row count mismatch: ${descriptor.table}` }
      }
      const refs = rows.map((row) => row.row_ref as string)
      if (
        new Set(refs).size !== refs.length ||
        refs.some((ref, index) => index > 0 && refs[index - 1].localeCompare(ref) >= 0)
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
