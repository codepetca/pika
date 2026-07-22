import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import {
  testGradingProvenanceSchema,
  type TestGradingProvenance,
} from '@/lib/grading/contracts'
import type { TestQuestionGradingSnapshot } from '@/lib/test-grading-context'

const MANUAL_TEST_AI_PROVENANCE_TTL_MS = 24 * 60 * 60 * 1000

const manualTestAiProvenancePayloadV1Schema = z.object({
  version: z.literal(1),
  teacher_id: z.string().min(1),
  test_id: z.string().min(1),
  response_id: z.string().min(1),
  response_revision: z.number().int().positive(),
  grading_basis: z.enum(['teacher_key', 'generated_reference']),
  reference_answers_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  model: z.string().min(1),
  suggested_score: z.number().finite().nonnegative(),
  suggested_feedback_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  question_grading_snapshot_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  issued_at_ms: z.number().int().nonnegative(),
  expires_at_ms: z.number().int().positive(),
}).strict()

const manualTestAiProvenancePayloadV2Schema = manualTestAiProvenancePayloadV1Schema.extend({
  version: z.literal(2),
  grading_provenance_sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()

const manualTestAiProvenancePayloadSchema = z.discriminatedUnion('version', [
  manualTestAiProvenancePayloadV1Schema,
  manualTestAiProvenancePayloadV2Schema,
])

type ManualTestAiProvenancePayload = z.infer<typeof manualTestAiProvenancePayloadSchema>

export type ManualTestAiProvenanceIdentity = {
  teacherId: string
  testId: string
  responseId: string
  responseRevision: number
  gradingBasis: 'teacher_key' | 'generated_reference'
  referenceAnswers: string[] | null
  model: string
  suggestedScore: number
  suggestedFeedback: string
  questionGradingSnapshot: TestQuestionGradingSnapshot
  gradingProvenance: TestGradingProvenance | null
}

function getSigningSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters')
  }
  return secret
}

function sign(encodedPayload: string): Buffer {
  return createHmac('sha256', getSigningSecret()).update(encodedPayload).digest()
}

function hashCanonical(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function createManualTestAiProvenanceToken(
  input: ManualTestAiProvenanceIdentity,
  nowMs = Date.now(),
): string {
  const payload: ManualTestAiProvenancePayload = {
    version: 2,
    teacher_id: input.teacherId,
    test_id: input.testId,
    response_id: input.responseId,
    response_revision: input.responseRevision,
    grading_basis: input.gradingBasis,
    reference_answers_sha256: hashCanonical(input.referenceAnswers),
    model: input.model,
    suggested_score: input.suggestedScore,
    suggested_feedback_sha256: hashCanonical(input.suggestedFeedback),
    question_grading_snapshot_sha256: hashCanonical(input.questionGradingSnapshot),
    grading_provenance_sha256: hashCanonical(
      testGradingProvenanceSchema.parse(input.gradingProvenance),
    ),
    issued_at_ms: nowMs,
    expires_at_ms: nowMs + MANUAL_TEST_AI_PROVENANCE_TTL_MS,
  }
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${encodedPayload}.${sign(encodedPayload).toString('base64url')}`
}

export function verifyManualTestAiProvenanceToken(input: {
  token: string
  expected: ManualTestAiProvenanceIdentity
  nowMs?: number
}): boolean {
  if (!input.token || input.token.length > 16384) return false
  const [encodedPayload, encodedSignature, ...extra] = input.token.split('.')
  if (!encodedPayload || !encodedSignature || extra.length > 0) return false

  let suppliedSignature: Buffer
  let payload: ManualTestAiProvenancePayload
  try {
    suppliedSignature = Buffer.from(encodedSignature, 'base64url')
    const expectedSignature = sign(encodedPayload)
    if (
      suppliedSignature.length !== expectedSignature.length ||
      !timingSafeEqual(suppliedSignature, expectedSignature)
    ) return false

    const decoded = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))
    const parsed = manualTestAiProvenancePayloadSchema.safeParse(decoded)
    if (!parsed.success) return false
    payload = parsed.data
  } catch {
    return false
  }

  const nowMs = input.nowMs ?? Date.now()
  const expected = input.expected
  const expectedProvenance = payload.version === 2
    ? testGradingProvenanceSchema.safeParse(expected.gradingProvenance)
    : null
  return payload.issued_at_ms <= nowMs
    && payload.expires_at_ms >= nowMs
    && payload.teacher_id === expected.teacherId
    && payload.test_id === expected.testId
    && payload.response_id === expected.responseId
    && payload.response_revision === expected.responseRevision
    && payload.grading_basis === expected.gradingBasis
    && payload.model === expected.model
    && payload.suggested_score === expected.suggestedScore
    && payload.reference_answers_sha256 === hashCanonical(expected.referenceAnswers)
    && payload.suggested_feedback_sha256 === hashCanonical(expected.suggestedFeedback)
    && payload.question_grading_snapshot_sha256
      === hashCanonical(expected.questionGradingSnapshot)
    && (payload.version === 1
      ? expected.gradingProvenance === null
      : expectedProvenance?.success === true
        && payload.grading_provenance_sha256 === hashCanonical(expectedProvenance.data))
}
