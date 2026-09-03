import { z } from 'zod'
import { canAccessClassroom } from '@/lib/access/classroom-policy'
import { evaluateFeatureEntitlement, getLegacyClassroomCreationEntitlement } from '@/lib/access/feature-entitlements'
import { classroomAccessRowSchema } from './classroom-access'

type Check = 'owner' | 'manage' | 'participate'
type Evidence = {
  classroom: unknown
  classroomError?: unknown
  enrollment?: { data: unknown; error: unknown }
}
type Observation = {
  check: Check
  userId: string
  classroomId: string
  legacyAllowed: boolean
  /** Reuses scoped legacy query results. Never query or mutate in this callback. */
  evidence: () => Evidence
}
type Candidate = {
  allowed: boolean | null
  reason: 'policy' | 'missing_classroom' | 'invalid_evidence' | 'classroom_read_failed'
    | 'enrollment_read_failed' | 'enrollment_not_observed' | 'legacy_creation'
}

const uuid = z.string().uuid()
const enrollmentIdSchema = z.object({ id: uuid })
let windowStartedAt = 0
let observationsInWindow = 0

/** No durable state, timers, extra queries, or identifiers in emitted events. */
function shouldObserve(identifier: string, cohort: string | undefined): boolean {
  if (process.env.PIKA_ACCESS_SHADOW_ENABLED !== 'true' || !uuid.safeParse(identifier).success) return false
  const ids = cohort?.split(',').map((id) => id.trim().toLowerCase()) ?? []
  if (!ids.length || ids.length > 100 || ids.some((id) => !uuid.safeParse(id).success) ||
      !ids.includes(identifier.toLowerCase())) return false
  const rawRate = process.env.PIKA_ACCESS_SHADOW_SAMPLE_RATE ?? '0.01'
  if (!/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(rawRate)) return false
  const rate = Number(rawRate)
  if (rate === 0 || Math.random() >= rate) return false
  const now = Date.now()
  if (!Number.isFinite(now)) return false
  if (now < windowStartedAt || now - windowStartedAt >= 60_000) {
    windowStartedAt = now
    observationsInWindow = 0
  }
  if (observationsInWindow >= 100) return false
  observationsInWindow++
  return true
}

function compare(input: Observation): Candidate {
  if (!uuid.safeParse(input.userId).success) return { allowed: null, reason: 'invalid_evidence' }
  const evidence = input.evidence()
  if (evidence.classroomError) return { allowed: null, reason: 'classroom_read_failed' }
  if (evidence.classroom === null) return { allowed: false, reason: 'missing_classroom' }
  const parsed = classroomAccessRowSchema.safeParse(evidence.classroom)
  if (!parsed.success || parsed.data.id !== input.classroomId) return { allowed: null, reason: 'invalid_evidence' }
  const context = {
    userId: input.userId, classroomId: input.classroomId, ownerId: parsed.data.teacher_id,
    archived: parsed.data.archived_at !== null,
    relationship: parsed.data.teacher_id === input.userId ? 'owner' as const : 'none' as const,
  }
  if (input.check === 'owner') {
    // The legacy helper means owner-only read, not all classroom readers.
    return { allowed: context.relationship === 'owner' && canAccessClassroom(context, 'read'), reason: 'policy' }
  }
  if (input.check === 'manage') return { allowed: canAccessClassroom(context, 'manage'), reason: 'policy' }
  if (context.archived) return { allowed: false, reason: 'policy' }
  if (!evidence.enrollment) return { allowed: null, reason: 'enrollment_not_observed' }
  // In particular, single() PGRST116 is NOT trusted evidence of absence.
  if (evidence.enrollment.error) return { allowed: null, reason: 'enrollment_read_failed' }
  const enrollment = evidence.enrollment.data
  if (enrollment !== null && !enrollmentIdSchema.safeParse(enrollment).success) {
    return { allowed: null, reason: 'invalid_evidence' }
  }
  // Supplied read failures remain unavailable even when ownership implies denial.
  if (context.relationship === 'owner') return { allowed: false, reason: 'policy' }
  return { allowed: canAccessClassroom({ ...context, relationship: enrollment === null ? 'none' : 'member' }, 'participate'),
    reason: 'policy' }
}

function report(check: Check | 'create', legacyAllowed: boolean, candidate: Candidate): void {
  // Only closed labels. Never spread input, row data, errors, or configuration here.
  console.info('PikaAccessShadow', {
    version: 1,
    check,
    legacy: legacyAllowed ? 'allow' : 'deny',
    candidate: candidate.allowed === null ? 'unavailable' : candidate.allowed ? 'allow' : 'deny',
    comparison: candidate.allowed === null ? 'unavailable' : candidate.allowed === legacyAllowed ? 'match'
      : candidate.allowed ? 'would_allow' : 'would_deny',
    reason: candidate.reason,
  })
}

/** Observational only. Legacy guards MUST remain authoritative, including on failures. */
export function observeClassroomAccessShadow(input: Observation): void {
  try {
    if (!shouldObserve(input.classroomId, process.env.PIKA_ACCESS_SHADOW_CLASSROOM_IDS)) return
    report(input.check, input.legacyAllowed, compare(input))
  } catch {
    // Telemetry failures must never interrupt a class or log raw exception data.
  }
}

/** Call ONLY after requireRole('teacher') has succeeded; its denials are not sampled. */
export function observeClassroomCreationShadow(user: unknown): void {
  try {
    const identity = z.object({ id: uuid }).safeParse(user)
    if (!identity.success || !shouldObserve(identity.data.id, process.env.PIKA_ACCESS_SHADOW_USER_IDS)) return
    const grant = getLegacyClassroomCreationEntitlement(user)
    const decision = grant && evaluateFeatureEntitlement(identity.data.id, 'classrooms.create', grant, Date.now())
    report('create', true, { allowed: decision?.allowed ?? null, reason: grant ? 'legacy_creation' : 'invalid_evidence' })
  } catch {
    // Same containment boundary as classroom observations.
  }
}
