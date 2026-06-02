import { buildAiSanitizationContext } from '@/lib/ai-sanitization'
import {
  buildPikaAssignmentGradexRunPayload,
  type GradexGradingRunCreateRequest,
  type PikaGradexMapping,
} from '@/lib/server/gradex-assignment-payload'
import type { Assignment, AssignmentSubmissionArtifact } from '@/types'

type GradexRunStatus = 'queued' | 'running' | 'completed' | 'completed_with_errors' | 'failed'
type GradexRunItemStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'skipped'
type GradexCriterionScore = {
  criterion_id: string
  score: number
}

export interface GradexSmokeRunResponse {
  id: string
  status: GradexRunStatus
  counts: {
    requested: number
    processed: number
    completed: number
    failed: number
    skipped: number
    pending: number
  }
  provider: string | null
  model: string | null
  tier: string | null
  policy_version: string | null
  prompt_version: string | null
  items?: GradexSmokeRunItemSummary[]
}

export interface GradexSmokeRunItemSummary {
  id: string
  status: GradexRunItemStatus
  external_submission_id: string | null
  external_student_id: string | null
  error: unknown | null
}

export interface GradexSmokeRunItemResponse extends GradexSmokeRunItemSummary {
  result: {
    provider: string
    model: string
    tier: string
    policy_version: string
    prompt_version: string
    audit_id: string
    token_usage: unknown | null
    criteria_results?: GradexCriterionScore[]
    feedback?: {
      student?: string
    }
    compatibility?: {
      pika_assignment_v1?: {
        score_completion: number
        score_thinking: number
        score_workflow: number
        feedback: string
      }
    }
  } | null
}

export interface PikaGradexSmokeGradeRecord {
  assignment_doc_id: string
  student_id: string
  pika_grade_record_ref: string
  pika_submission_ref: string
  gradex_submission_id: string
  gradex_item_id: string
  status: GradexRunItemStatus
  score_completion: number | null
  score_thinking: number | null
  score_workflow: number | null
  feedback: string | null
  provider: string | null
  model: string | null
  tier: string | null
  audit_id: string | null
}

export interface PikaGradexSmokeSample {
  gradexRequest: GradexGradingRunCreateRequest
  mappings: PikaGradexMapping[]
  sanitizedPreview: {
    assignmentTitle: string
    assignmentInstructions: string
    submissionContents: string[]
  }
}

export interface RunPikaGradexSmokeOptions {
  baseUrl: string
  apiKey: string
  internalToken?: string
  pollAttempts?: number
  pollIntervalMs?: number
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
}

export interface PikaGradexSmokeReport {
  sample: PikaGradexSmokeSample
  run: GradexSmokeRunResponse
  gradeRecords: PikaGradexSmokeGradeRecord[]
  pollAttempts: number
}

const TERMINAL_STATUSES = new Set<GradexRunStatus>(['completed', 'completed_with_errors', 'failed'])

export function buildPikaGradexSmokeSample(): PikaGradexSmokeSample {
  const assignment: Assignment = {
    id: 'assignment-db-smoke-001',
    classroom_id: 'classroom-db-smoke-001',
    title: 'Portfolio Reflection for Jane Student',
    description: 'Sanitized Gradex smoke assignment',
    instructions_markdown:
      'Write a short reflection about your portfolio. Do not include your email or personal links.',
    rich_instructions: null,
    due_at: '2026-06-07T21:00:00.000Z',
    position: 1,
    is_draft: false,
    released_at: '2026-06-01T12:00:00.000Z',
    track_authenticity: true,
    points_possible: 30,
    include_in_final: true,
    gradebook_weight: 1,
    created_by: 'teacher-db-smoke-001',
    created_at: '2026-06-01T12:00:00.000Z',
    updated_at: '2026-06-01T12:00:00.000Z',
  }

  const assignmentDocs = [
    {
      id: 'assignment-doc-db-smoke-001',
      student_id: 'student-db-smoke-001',
      submitted_at: '2026-06-01T14:30:00.000Z',
      authenticity_score: 88,
      authenticity_flags: [
        {
          timestamp: '2026-06-01T14:10:00.000Z',
          wordDelta: 120,
          seconds: 20,
          wps: 6,
          reason: 'high_wps' as const,
        },
      ],
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text:
                  'Jane Student explains that the navigation was simplified, the homepage now introduces the project clearly, and the reflection connects design choices to audience needs. Contact jane.student@example.com or visit https://student.example.com/portfolio for the old draft.',
              },
            ],
          },
        ],
      },
    },
  ]

  const submissionArtifacts: AssignmentSubmissionArtifact[] = [
    {
      id: 'artifact-db-smoke-001',
      assignment_doc_id: 'assignment-doc-db-smoke-001',
      requirement_id: 'requirement-db-smoke-001',
      student_id: 'student-db-smoke-001',
      type: 'link',
      url: 'https://student.example.com/portfolio',
      storage_path: null,
      metadata_json: {},
      validation_status: 'valid',
      validation_message: null,
      validated_at: '2026-06-01T14:20:00.000Z',
      created_at: '2026-06-01T14:20:00.000Z',
      updated_at: '2026-06-01T14:20:00.000Z',
    },
  ]

  const built = buildPikaAssignmentGradexRunPayload({
    assignment,
    assignmentDocs,
    submissionArtifacts,
    pseudonymSalt: 'pika-gradex-smoke-only-salt',
    sanitizationContext: buildAiSanitizationContext([
      { firstName: 'Jane', lastName: 'Student' },
    ]),
  })

  return {
    gradexRequest: built.gradexRequest,
    mappings: built.mappings,
    sanitizedPreview: {
      assignmentTitle: built.gradexRequest.assignment.title,
      assignmentInstructions: built.gradexRequest.assignment.instructions,
      submissionContents: built.gradexRequest.submissions.map((submission) => String(submission.content)),
    },
  }
}

export async function runPikaGradexSmoke(opts: RunPikaGradexSmokeOptions): Promise<PikaGradexSmokeReport> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const sample = buildPikaGradexSmokeSample()
  const baseUrl = normalizeBaseUrl(opts.baseUrl)
  const pollAttempts = opts.pollAttempts ?? 20
  const pollIntervalMs = opts.pollIntervalMs ?? 1500

  let run = await requestJson<GradexSmokeRunResponse>(fetchImpl, {
    url: `${baseUrl}/api/v1/grading-runs`,
    method: 'POST',
    apiKey: opts.apiKey,
    body: sample.gradexRequest,
    expectedStatus: 202,
  })

  let attempts = 0
  for (; attempts < pollAttempts && !TERMINAL_STATUSES.has(run.status); attempts += 1) {
    if (opts.internalToken) {
      await requestJson(fetchImpl, {
        url: `${baseUrl}/api/internal/grading-runs/tick`,
        method: 'POST',
        apiKey: opts.internalToken,
        body: { runId: run.id, limit: sample.gradexRequest.submissions.length },
        expectedStatus: 200,
      })
    }

    await sleep(pollIntervalMs)
    run = await getRun(fetchImpl, baseUrl, opts.apiKey, run.id)
  }

  if (!TERMINAL_STATUSES.has(run.status)) {
    const tickHint = opts.internalToken
      ? ''
      : ' Configure GRADEX_INTERNAL_TOKEN for local tick processing or run a Gradex worker.'
    throw new Error(`Gradex run ${run.id} did not finish after ${pollAttempts} poll attempts.${tickHint}`)
  }

  const itemSummaries = run.items ?? []
  const items = await Promise.all(
    itemSummaries.map((item) => getRunItem(fetchImpl, baseUrl, opts.apiKey, run.id, item.id)),
  )

  return {
    sample,
    run,
    gradeRecords: mapGradexItemsToPikaGradeRecords(sample.mappings, items),
    pollAttempts: attempts,
  }
}

export function mapGradexItemsToPikaGradeRecords(
  mappings: PikaGradexMapping[],
  items: GradexSmokeRunItemResponse[],
): PikaGradexSmokeGradeRecord[] {
  const mappingBySubmissionId = new Map(
    mappings.map((mapping) => [mapping.gradex_submission_id, mapping]),
  )

  return items.map((item) => {
    const mapping = item.external_submission_id ? mappingBySubmissionId.get(item.external_submission_id) : undefined
    if (!mapping) {
      throw new Error(`Missing Pika mapping for Gradex submission ${item.external_submission_id ?? item.id}`)
    }

    const pika = item.result?.compatibility?.pika_assignment_v1
    const criterionScores = getCriterionScores(item.result?.criteria_results)

    return {
      assignment_doc_id: mapping.assignment_doc_id,
      student_id: mapping.student_id,
      pika_grade_record_ref: mapping.pika_grade_record_ref,
      pika_submission_ref: mapping.pika_submission_ref,
      gradex_submission_id: mapping.gradex_submission_id,
      gradex_item_id: item.id,
      status: item.status,
      score_completion: pika?.score_completion ?? criterionScores.completion ?? null,
      score_thinking: pika?.score_thinking ?? criterionScores.thinking ?? null,
      score_workflow: pika?.score_workflow ?? criterionScores.workflow ?? null,
      feedback: pika?.feedback ?? item.result?.feedback?.student ?? null,
      provider: item.result?.provider ?? null,
      model: item.result?.model ?? null,
      tier: item.result?.tier ?? null,
      audit_id: item.result?.audit_id ?? null,
    }
  })
}

function getCriterionScores(criteriaResults: GradexCriterionScore[] | undefined) {
  const scores: Partial<Record<'completion' | 'thinking' | 'workflow', number>> = {}
  if (!Array.isArray(criteriaResults)) return scores

  for (const criterion of criteriaResults) {
    if (
      criterion &&
      typeof criterion === 'object' &&
      'criterion_id' in criterion &&
      'score' in criterion &&
      (criterion.criterion_id === 'completion' ||
        criterion.criterion_id === 'thinking' ||
        criterion.criterion_id === 'workflow') &&
      typeof criterion.score === 'number'
    ) {
      scores[criterion.criterion_id] = criterion.score
    }
  }

  return scores
}

async function getRun(
  fetchImpl: typeof fetch,
  baseUrl: string,
  apiKey: string,
  runId: string,
) {
  return requestJson<GradexSmokeRunResponse>(fetchImpl, {
    url: `${baseUrl}/api/v1/grading-runs/${encodeURIComponent(runId)}`,
    method: 'GET',
    apiKey,
    expectedStatus: 200,
  })
}

async function getRunItem(
  fetchImpl: typeof fetch,
  baseUrl: string,
  apiKey: string,
  runId: string,
  itemId: string,
) {
  return requestJson<GradexSmokeRunItemResponse>(fetchImpl, {
    url: `${baseUrl}/api/v1/grading-runs/${encodeURIComponent(runId)}/items/${encodeURIComponent(itemId)}`,
    method: 'GET',
    apiKey,
    expectedStatus: 200,
  })
}

async function requestJson<T>(
  fetchImpl: typeof fetch,
  opts: {
    url: string
    method: 'GET' | 'POST'
    apiKey: string
    body?: unknown
    expectedStatus: number
  },
): Promise<T> {
  const response = await fetchImpl(opts.url, {
    method: opts.method,
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok || response.status !== opts.expectedStatus) {
    throw new Error(gradexErrorMessage(body, response.status))
  }
  return body as T
}

function gradexErrorMessage(body: unknown, status: number): string {
  if (body && typeof body === 'object') {
    const error = (body as { error?: { message?: unknown } }).error
    const details = (body as { error?: { details?: unknown } }).error?.details
    if (typeof error?.message === 'string') {
      return details === undefined
        ? error.message
        : `${error.message}: ${JSON.stringify(details)}`
    }
  }
  return `Gradex request failed with status ${status}`
}

function normalizeBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  if (!normalized) throw new Error('GRADEX_API_URL is required')
  return normalized
}
