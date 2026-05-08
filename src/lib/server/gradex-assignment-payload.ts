import { createHmac } from 'node:crypto'
import { extractAssignmentArtifacts, type AssignmentArtifactType } from '@/lib/assignment-artifacts'
import { getAssignmentInstructionsMarkdown } from '@/lib/assignment-instructions'
import { limitedMarkdownToPlainText } from '@/lib/limited-markdown'
import { extractPlainText, parseContentField } from '@/lib/tiptap-content'
import type { Assignment, AuthenticityFlag } from '@/types'

export const GRADEX_PIKA_ASSIGNMENT_PROFILE = 'pika-assignment-v1'

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
  flags?: Array<{
    reason: 'paste' | 'high_wps' | 'other'
    count?: number
    summary: string
  }>
}

export interface GradexGradeSyncRequest {
  assignment: {
    external_assignment_id: string
    title: string
    instructions: string
    type: 'essay'
  }
  rubric: GradexRubric
  settings: {
    grading_profile: typeof GRADEX_PIKA_ASSIGNMENT_PROFILE
    model_profile: 'default'
    feedback_style: 'balanced'
    confidence_threshold: number
    request_timeout_ms: number
  }
  submission: {
    external_submission_id: string
    external_student_id: string
    content_type: 'text'
    content: string
    submitted_at?: string
  }
  workflow_evidence: GradexWorkflowEvidence
}

type GradexAssignmentDocInput = {
  id: string
  student_id: string
  content: unknown
  submitted_at?: string | null
  authenticity_score?: number | null
  authenticity_flags?: AuthenticityFlag[] | null
} & Record<string, unknown>

export interface BuildPikaAssignmentGradexPayloadOptions {
  assignment: Assignment
  assignmentDoc: GradexAssignmentDocInput
  pseudonymSalt?: string
  requestTimeoutMs?: number
}

const DEFAULT_REQUEST_TIMEOUT_MS = 25_000
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
const PHONE_PATTERN = /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g
const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi
const IDENTITY_KEY_PATTERN = /(email|first_?name|last_?name|full_?name|display_?name|student_?name|teacher_?name)/i

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
    .slice(0, 32)
  return `pika-${prefix}-${digest}`
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return value.slice(0, maxLength)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function collectIdentityTokens(record: Record<string, unknown>): string[] {
  const tokens = new Set<string>()
  for (const [key, value] of Object.entries(record)) {
    if (!IDENTITY_KEY_PATTERN.test(key)) continue
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed.length < 2) continue
    tokens.add(trimmed)
  }
  return Array.from(tokens)
}

function sanitizeText(value: string, identityTokens: string[]): string {
  let sanitized = value
    .replace(EMAIL_PATTERN, '[email redacted]')
    .replace(PHONE_PATTERN, '[phone redacted]')
    .replace(URL_PATTERN, '[link redacted]')

  for (const token of identityTokens) {
    sanitized = sanitized.replace(new RegExp(escapeRegExp(token), 'gi'), '[identity redacted]')
  }

  return sanitized
}

function buildArtifactSummary(content: unknown): string {
  const artifacts = extractAssignmentArtifacts(content)
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
  identityTokens: string[],
): string {
  const parsedContent = parseContentField(assignmentDoc.content)
  const text = sanitizeText(extractPlainText(parsedContent).trim(), identityTokens)
  const artifactSummary = buildArtifactSummary(parsedContent)
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
  const flags: GradexWorkflowEvidence['flags'] = []

  if (pasteEventCount > 0) {
    const countLabel = pluralize(pasteEventCount, 'paste event')
    flagSummaries.push(countLabel)
    flags.push({
      reason: 'paste',
      count: pasteEventCount,
      summary: `${countLabel} detected in sanitized workflow evidence.`,
    })
  }

  if (highWpsFlagCount > 0) {
    const countLabel = pluralize(highWpsFlagCount, 'high writing-speed flag')
    flagSummaries.push(countLabel)
    flags.push({
      reason: 'high_wps',
      count: highWpsFlagCount,
      summary: `${countLabel} detected in sanitized workflow evidence.`,
    })
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
    ...(flags.length > 0 ? { flags } : {}),
  }
}

export function buildPikaAssignmentGradexPayload(
  opts: BuildPikaAssignmentGradexPayloadOptions,
): GradexGradeSyncRequest {
  const salt = getRequiredPseudonymSalt(opts.pseudonymSalt)
  const identityTokens = collectIdentityTokens(opts.assignmentDoc)
  const instructions = limitedMarkdownToPlainText(
    getAssignmentInstructionsMarkdown(opts.assignment).markdown,
  )
  const submittedAt = normalizeIsoDate(opts.assignmentDoc.submitted_at)

  return {
    assignment: {
      external_assignment_id: pseudonymize('assignment', opts.assignment.id, salt),
      title: truncateText(sanitizeText(opts.assignment.title, identityTokens).trim() || 'Untitled assignment', 240),
      instructions: truncateText(
        sanitizeText(instructions, identityTokens).trim() || 'No assignment instructions provided.',
        20_000,
      ),
      type: 'essay',
    },
    rubric: PIKA_ASSIGNMENT_GRADEX_RUBRIC,
    settings: {
      grading_profile: GRADEX_PIKA_ASSIGNMENT_PROFILE,
      model_profile: 'default',
      feedback_style: 'balanced',
      confidence_threshold: 0.65,
      request_timeout_ms: opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    },
    submission: {
      external_submission_id: pseudonymize('submission', opts.assignmentDoc.id, salt),
      external_student_id: pseudonymize('student', opts.assignmentDoc.student_id, salt),
      content_type: 'text',
      content: normalizeSubmissionContent(opts.assignmentDoc, identityTokens),
      ...(submittedAt ? { submitted_at: submittedAt } : {}),
    },
    workflow_evidence: buildWorkflowEvidence(opts.assignmentDoc),
  }
}
