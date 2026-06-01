import { createHmac } from 'node:crypto'
import { extractAssignmentArtifacts, type AssignmentArtifactType } from '@/lib/assignment-artifacts'
import { getAssignmentInstructionsMarkdown } from '@/lib/assignment-instructions'
import { submissionArtifactsToAssignmentArtifacts } from '@/lib/assignment-submission-requirements'
import { limitedMarkdownToPlainText } from '@/lib/limited-markdown'
import { extractPlainText, parseContentField } from '@/lib/tiptap-content'
import type {
  Assignment,
  AssignmentSubmissionArtifact,
  AuthenticityFlag,
  TiptapContent,
} from '@/types'

export const GRADEX_PIKA_ASSIGNMENT_PROFILE = 'pika-assignment-v1'
export const GRADEX_PIKA_ADAPTER_VERSION = 'pika-assignment-adapter-v1'
export const GRADEX_PIKA_PROMPT_VERSION = 'gradex-essay-rubric-v1'

type GradexCriterionKind = 'content' | 'thinking' | 'communication' | 'workflow'

export interface GradexRubricCriterion {
  id: string
  label: string
  description: string
  kind: GradexCriterionKind
  scale: {
    min: number
    max: number
  }
  weight: number
  feedback_required: boolean
}

export interface GradexRubric {
  version: string
  criteria: GradexRubricCriterion[]
}

export interface GradexWorkflowEvidence {
  authenticity_score?: number | null
  evidence_confidence: number
  active_session_count?: number
  active_day_count?: number
  total_word_delta?: number
  paste_event_count?: number
  high_wps_flag_count?: number
  summary?: string
}

export interface GradexGradingRunCreateRequest {
  assignment: {
    external_assignment_id: string
    title: string
    instructions: string
    type: 'essay'
    metadata: {
      adapter_version: typeof GRADEX_PIKA_ADAPTER_VERSION
      client: 'pika'
    }
  }
  rubric: GradexRubric
  settings: {
    grading_profile: typeof GRADEX_PIKA_ASSIGNMENT_PROFILE
    model_profile: 'calibration'
    provider: 'auto'
    tier: 'auto'
    prompt_version: typeof GRADEX_PIKA_PROMPT_VERSION
    feedback_style: 'balanced'
    confidence_threshold: number
    request_timeout_ms: number
  }
  submissions: GradexRunSubmission[]
  workflow_evidence_by_submission_id: Record<string, GradexWorkflowEvidence>
}

export interface GradexRunSubmission {
  external_submission_id: string
  external_student_id: string
  content_type: 'text'
  content: string
  submitted_at?: string
}

export interface PikaGradexAdapterRequest {
  adapter_version: typeof GRADEX_PIKA_ADAPTER_VERSION
  assignment: {
    pika_assignment_ref: string
    title: string
    instructions: string
  }
  submissions: Array<{
    pika_grade_record_ref: string
    pika_submission_ref: string
    pika_student_ref: string
    content: string
    submitted_at?: string
    workflow_summary: GradexWorkflowEvidence
  }>
}

export interface PikaGradexMapping {
  assignment_doc_id: string
  student_id: string
  pika_grade_record_ref: string
  pika_submission_ref: string
  pika_student_ref: string
  gradex_submission_id: string
  gradex_student_id: string
}

export interface PikaGradexAssignmentBuildResult {
  pikaAdapterRequest: PikaGradexAdapterRequest
  gradexRequest: GradexGradingRunCreateRequest
  mappings: PikaGradexMapping[]
}

export type GradexAssignmentDocInput = {
  id: string
  student_id: string
  content: unknown
  submitted_at?: string | null
  authenticity_score?: number | null
  authenticity_flags?: AuthenticityFlag[] | null
} & Record<string, unknown>

export interface BuildPikaAssignmentGradexRunPayloadOptions {
  assignment: Assignment
  assignmentDocs: GradexAssignmentDocInput[]
  submissionArtifacts?: AssignmentSubmissionArtifact[]
  pseudonymSalt?: string
  requestTimeoutMs?: number
}

const DEFAULT_REQUEST_TIMEOUT_MS = 25_000
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const PHONE_PATTERN = /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g
const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi
const IDENTITY_KEY_PATTERN = /(email|first_?name|last_?name|full_?name|display_?name|student_?name|teacher_?name|username|github_?username)/i
const RAW_ID_KEY_PATTERN = /(^id$|_id$|id$|roster|sis|school|database|assignment_doc|classroom|created_by)/i

export const PIKA_ASSIGNMENT_GRADEX_RUBRIC: GradexRubric = {
  version: 'pika-essay-ctw-v1',
  criteria: [
    {
      id: 'completion',
      label: 'Completion',
      description: 'Did the student complete all parts of the assignment?',
      kind: 'content',
      scale: { min: 0, max: 10 },
      weight: 1,
      feedback_required: true,
    },
    {
      id: 'thinking',
      label: 'Thinking',
      description: 'Does the work show depth of thought, analysis, or understanding?',
      kind: 'thinking',
      scale: { min: 0, max: 10 },
      weight: 1,
      feedback_required: true,
    },
    {
      id: 'workflow',
      label: 'Workflow',
      description: 'Is the work organized, clear, well-presented, and supported by process evidence?',
      kind: 'workflow',
      scale: { min: 0, max: 10 },
      weight: 1,
      feedback_required: true,
    },
  ],
}

function getRequiredPseudonymSalt(explicitSalt?: string): string {
  const salt = explicitSalt?.trim() || process.env.GRADEX_PIKA_PSEUDONYM_SALT?.trim()
  if (!salt) {
    throw new Error('GRADEX_PIKA_PSEUDONYM_SALT is not configured')
  }
  return salt
}

function pseudonymize(prefix: string, value: string, salt: string): string {
  const digest = createHmac('sha256', salt)
    .update(`${prefix}:${value}`)
    .digest('hex')
    .slice(0, 30)
  return `pika-${prefix}-${digest}a1`
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return value.slice(0, maxLength)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function collectSensitiveStringTokens(value: unknown, tokens: Set<string>): void {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.length >= 2) tokens.add(trimmed)
    return
  }

  if (!value || typeof value !== 'object') return

  if (Array.isArray(value)) {
    for (const item of value) collectSensitiveStringTokens(item, tokens)
    return
  }

  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (IDENTITY_KEY_PATTERN.test(key) || RAW_ID_KEY_PATTERN.test(key)) {
      collectSensitiveStringTokens(nested, tokens)
    }
  }
}

function collectSanitizationTokens(assignment: Assignment, assignmentDocs: GradexAssignmentDocInput[]): string[] {
  const tokens = new Set<string>()
  collectSensitiveStringTokens(
    {
      id: assignment.id,
      classroom_id: assignment.classroom_id,
      created_by: assignment.created_by,
    },
    tokens,
  )
  for (const assignmentDoc of assignmentDocs) {
    collectSensitiveStringTokens(assignmentDoc, tokens)
  }
  return Array.from(tokens).sort((a, b) => b.length - a.length)
}

function sanitizeText(value: string, sensitiveTokens: string[]): string {
  let sanitized = value
    .replace(EMAIL_PATTERN, '[email redacted]')
    .replace(PHONE_PATTERN, '[phone redacted]')
    .replace(URL_PATTERN, '[link redacted]')

  for (const token of sensitiveTokens) {
    if (token.length < 2) continue
    sanitized = sanitized.replace(new RegExp(escapeRegExp(token), 'gi'), '[identity redacted]')
  }

  return sanitized
}

function groupArtifactsByDocId(artifacts: AssignmentSubmissionArtifact[] = []) {
  const byDocId = new Map<string, AssignmentSubmissionArtifact[]>()
  for (const artifact of artifacts) {
    const existing = byDocId.get(artifact.assignment_doc_id) ?? []
    existing.push(artifact)
    byDocId.set(artifact.assignment_doc_id, existing)
  }
  return byDocId
}

function buildArtifactSummary(content: TiptapContent, submissionArtifacts: AssignmentSubmissionArtifact[]): string {
  const artifactsBySource = new Map(
    [
      ...extractAssignmentArtifacts(content),
      ...submissionArtifactsToAssignmentArtifacts(submissionArtifacts),
    ].map((artifact) => [`${artifact.type}:${artifact.url}`, artifact]),
  )
  const artifacts = Array.from(artifactsBySource.values())
  if (artifacts.length === 0) return ''

  const counts = new Map<AssignmentArtifactType, number>()
  for (const artifact of artifacts) {
    counts.set(artifact.type, (counts.get(artifact.type) ?? 0) + 1)
  }

  const labelByType: Record<AssignmentArtifactType, string> = {
    image: 'Image',
    link: 'Link',
    repo: 'Repository',
  }

  const lines: string[] = []
  for (const type of ['repo', 'image', 'link'] as AssignmentArtifactType[]) {
    const count = counts.get(type) ?? 0
    if (count === 0) continue
    const label = labelByType[type]
    lines.push(
      count === 1
        ? `- ${label} artifact submitted`
        : `- ${count} ${label.toLowerCase()} artifacts submitted`,
    )
  }

  return lines.length > 0 ? `Attached Artifacts:\n${lines.join('\n')}` : ''
}

function normalizeSubmissionContent(
  assignmentDoc: GradexAssignmentDocInput,
  submissionArtifacts: AssignmentSubmissionArtifact[],
  sensitiveTokens: string[],
): string {
  const parsedContent = parseContentField(assignmentDoc.content)
  const text = sanitizeText(extractPlainText(parsedContent).trim(), sensitiveTokens)
  const artifactSummary = buildArtifactSummary(parsedContent, submissionArtifacts)
  const sections = [text, artifactSummary].filter((section) => section.trim().length > 0)
  const normalized = sections.join('\n\n').trim()

  return truncateText(normalized || 'Submission artifact provided.', 120_000)
}

function normalizeIsoDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return undefined
  return date.toISOString()
}

function countAuthenticityFlags(flags: AuthenticityFlag[] | null | undefined) {
  let pasteEventCount = 0
  let highWpsFlagCount = 0

  for (const flag of flags ?? []) {
    if (flag.reason === 'paste') pasteEventCount += 1
    if (flag.reason === 'high_wps') highWpsFlagCount += 1
  }

  return { pasteEventCount, highWpsFlagCount }
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return count === 1 ? `${count} ${singular}` : `${count} ${plural}`
}

function buildWorkflowEvidence(assignmentDoc: GradexAssignmentDocInput): GradexWorkflowEvidence {
  const authenticityScore =
    typeof assignmentDoc.authenticity_score === 'number' &&
    Number.isInteger(assignmentDoc.authenticity_score) &&
    assignmentDoc.authenticity_score >= 0 &&
    assignmentDoc.authenticity_score <= 100
      ? assignmentDoc.authenticity_score
      : null
  const { pasteEventCount, highWpsFlagCount } = countAuthenticityFlags(assignmentDoc.authenticity_flags)
  const hasWorkflowEvidence =
    authenticityScore != null || pasteEventCount > 0 || highWpsFlagCount > 0

  if (!hasWorkflowEvidence) {
    return {
      authenticity_score: null,
      evidence_confidence: 0,
      summary: 'No sanitized workflow evidence was available.',
    }
  }

  const flagSummaries: string[] = []

  if (pasteEventCount > 0) {
    flagSummaries.push(pluralize(pasteEventCount, 'paste event'))
  }

  if (highWpsFlagCount > 0) {
    flagSummaries.push(pluralize(highWpsFlagCount, 'high writing-speed flag'))
  }

  const summaryParts = [
    authenticityScore == null
      ? 'Pika authenticity score was unavailable.'
      : `Pika authenticity score: ${authenticityScore}/100.`,
    flagSummaries.length > 0
      ? `Sanitized workflow flags: ${flagSummaries.join(', ')}.`
      : 'No sanitized workflow flags were detected.',
  ]

  return {
    authenticity_score: authenticityScore,
    evidence_confidence: 0.75,
    paste_event_count: pasteEventCount,
    high_wps_flag_count: highWpsFlagCount,
    summary: truncateText(summaryParts.join(' '), 2000),
  }
}

export function buildPikaAssignmentGradexRunPayload(
  opts: BuildPikaAssignmentGradexRunPayloadOptions,
): PikaGradexAssignmentBuildResult {
  if (opts.assignmentDocs.length === 0) {
    throw new Error('At least one assignment doc is required to build a Gradex run payload')
  }

  const salt = getRequiredPseudonymSalt(opts.pseudonymSalt)
  const sensitiveTokens = collectSanitizationTokens(opts.assignment, opts.assignmentDocs)
  const instructions = limitedMarkdownToPlainText(
    getAssignmentInstructionsMarkdown(opts.assignment).markdown,
  )
  const artifactsByDocId = groupArtifactsByDocId(opts.submissionArtifacts)
  const assignmentRef = pseudonymize('assignment', opts.assignment.id, salt)

  const assignmentPayload = {
    pika_assignment_ref: assignmentRef,
    title: truncateText(sanitizeText(opts.assignment.title, sensitiveTokens).trim() || 'Untitled assignment', 240),
    instructions: truncateText(
      sanitizeText(instructions, sensitiveTokens).trim() || 'No assignment instructions provided.',
      20_000,
    ),
  }

  const submissions = opts.assignmentDocs.map((assignmentDoc) => {
    const submissionRef = pseudonymize('submission', assignmentDoc.id, salt)
    const studentRef = pseudonymize('student', assignmentDoc.student_id, salt)
    const gradeRef = pseudonymize('grade', assignmentDoc.id, salt)
    const submittedAt = normalizeIsoDate(assignmentDoc.submitted_at)

    return {
      pika_grade_record_ref: gradeRef,
      pika_submission_ref: submissionRef,
      pika_student_ref: studentRef,
      content: normalizeSubmissionContent(
        assignmentDoc,
        artifactsByDocId.get(assignmentDoc.id) ?? [],
        sensitiveTokens,
      ),
      ...(submittedAt ? { submitted_at: submittedAt } : {}),
      workflow_summary: buildWorkflowEvidence(assignmentDoc),
    }
  })

  const pikaAdapterRequest: PikaGradexAdapterRequest = {
    adapter_version: GRADEX_PIKA_ADAPTER_VERSION,
    assignment: assignmentPayload,
    submissions,
  }

  const gradexRequest: GradexGradingRunCreateRequest = {
    assignment: {
      external_assignment_id: assignmentPayload.pika_assignment_ref,
      title: assignmentPayload.title,
      instructions: assignmentPayload.instructions,
      type: 'essay',
      metadata: {
        adapter_version: GRADEX_PIKA_ADAPTER_VERSION,
        client: 'pika',
      },
    },
    rubric: PIKA_ASSIGNMENT_GRADEX_RUBRIC,
    settings: {
      grading_profile: GRADEX_PIKA_ASSIGNMENT_PROFILE,
      model_profile: 'calibration',
      provider: 'auto',
      tier: 'auto',
      prompt_version: GRADEX_PIKA_PROMPT_VERSION,
      feedback_style: 'balanced',
      confidence_threshold: 0.65,
      request_timeout_ms: opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    },
    submissions: submissions.map((submission) => ({
      external_submission_id: submission.pika_submission_ref,
      external_student_id: submission.pika_student_ref,
      content_type: 'text',
      content: submission.content,
      ...(submission.submitted_at ? { submitted_at: submission.submitted_at } : {}),
    })),
    workflow_evidence_by_submission_id: Object.fromEntries(
      submissions.map((submission) => [
        submission.pika_submission_ref,
        submission.workflow_summary,
      ]),
    ),
  }

  return {
    pikaAdapterRequest,
    gradexRequest,
    mappings: opts.assignmentDocs.map((assignmentDoc, index) => ({
      assignment_doc_id: assignmentDoc.id,
      student_id: assignmentDoc.student_id,
      pika_grade_record_ref: submissions[index].pika_grade_record_ref,
      pika_submission_ref: submissions[index].pika_submission_ref,
      pika_student_ref: submissions[index].pika_student_ref,
      gradex_submission_id: submissions[index].pika_submission_ref,
      gradex_student_id: submissions[index].pika_student_ref,
    })),
  }
}
