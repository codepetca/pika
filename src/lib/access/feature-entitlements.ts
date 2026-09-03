import { z } from 'zod'
import { canAccessClassroom, classroomAccessContextSchema } from './classroom-policy'

const featureSchema = z.enum(['classrooms.create', 'grading.ai'])
export type FeatureKey = z.infer<typeof featureSchema>
const nonnegativeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const timestamp = z.string().datetime({ offset: true })

/**
 * One effective, server-resolved entitlement, not a billing record or client claim.
 * Grant precedence, plan mapping, persistence and atomic quota consumption are deferred.
 * Explicit null means no expiry/quota; omitted values fail closed.
 */
export const featureEntitlementSchema = z.object({
  subjectUserId: z.string().uuid(),
  feature: featureSchema,
  source: z.enum(['legacy', 'plan', 'trial', 'manual', 'school']),
  enabled: z.boolean(),
  startsAt: timestamp,
  expiresAt: timestamp.nullable(),
  quota: z.object({ limit: nonnegativeInteger, used: nonnegativeInteger }).nullable(),
}).refine((grant) => grant.expiresAt === null || Date.parse(grant.startsAt) < Date.parse(grant.expiresAt))

export type FeatureEntitlement = z.infer<typeof featureEntitlementSchema>
export type FeatureDecision =
  | { allowed: true }
  | { allowed: false; reason:
      | 'invalid_context' | 'subject_mismatch' | 'feature_mismatch' | 'disabled'
      | 'not_started' | 'expired' | 'quota_exhausted' | 'classroom_forbidden'
      | 'legacy_role_required' }

/** Pure eligibility check at an explicit trusted server time, NOT a quota reservation. */
export function evaluateFeatureEntitlement(
  subjectUserId: unknown,
  feature: unknown,
  entitlement: unknown,
  at: number,
  units = 1,
): FeatureDecision {
  const parsed = featureEntitlementSchema.safeParse(entitlement)
  if (!parsed.success || !z.string().uuid().safeParse(subjectUserId).success ||
      !featureSchema.safeParse(feature).success || !Number.isFinite(at) ||
      !Number.isSafeInteger(units) || units < 1) {
    return { allowed: false, reason: 'invalid_context' }
  }
  const grant = parsed.data
  if (grant.subjectUserId !== subjectUserId) return { allowed: false, reason: 'subject_mismatch' }
  if (grant.feature !== feature) return { allowed: false, reason: 'feature_mismatch' }
  if (!grant.enabled) return { allowed: false, reason: 'disabled' }
  if (at < Date.parse(grant.startsAt)) return { allowed: false, reason: 'not_started' }
  if (grant.expiresAt !== null && at >= Date.parse(grant.expiresAt)) {
    return { allowed: false, reason: 'expired' }
  }
  if (grant.quota && units > grant.quota.limit - grant.quota.used) {
    return { allowed: false, reason: 'quota_exhausted' }
  }
  return { allowed: true }
}

/**
 * Explicit feature-to-permission binding: callers cannot downgrade a grading check
 * to read permission. Future classroom features must get their own reviewed binding.
 * The classroom owner sponsors this feature; a member's paid plan grants no authority.
 */
export function evaluateClassroomFeatureAccess(
  context: unknown,
  feature: unknown,
  entitlement: unknown,
  at: number,
  units = 1,
): FeatureDecision {
  const parsed = classroomAccessContextSchema.safeParse(context)
  if (feature !== 'grading.ai') return { allowed: false, reason: 'feature_mismatch' }
  if (!parsed.success || !canAccessClassroom(parsed.data, 'manage')) {
    return { allowed: false, reason: 'classroom_forbidden' }
  }
  return evaluateFeatureEntitlement(parsed.data.ownerId, feature, entitlement, at, units)
}

/**
 * Compatibility policy ONLY. Caller must supply the authenticated server user.
 * It preserves the current teacher-only create guard;
 * open creation, paid creation and production enforcement are separate releases.
 */
export function evaluateLegacyClassroomCreation(user: unknown): FeatureDecision {
  const grant = getLegacyClassroomCreationEntitlement(user)
  if (!grant) return { allowed: false, reason: 'invalid_context' }
  return grant.enabled ? { allowed: true } : { allowed: false, reason: 'legacy_role_required' }
}

/**
 * In-memory compatibility snapshot from a trusted server-authenticated user.
 * Not a persisted grant, billing resolver, or fallback for an unavailable paid plan.
 * No client-supplied role/plan may be passed here as authority.
 */
export function getLegacyClassroomCreationEntitlement(user: unknown): FeatureEntitlement | null {
  const parsed = z.object({ id: z.string().uuid(), role: z.enum(['teacher', 'student']) }).safeParse(user)
  if (!parsed.success) return null
  return {
    subjectUserId: parsed.data.id,
    feature: 'classrooms.create',
    source: 'legacy',
    enabled: parsed.data.role === 'teacher',
    startsAt: '1970-01-01T00:00:00Z',
    expiresAt: null,
    quota: null,
  }
}
