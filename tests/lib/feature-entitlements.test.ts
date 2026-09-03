import { describe, expect, it } from 'vitest'
import { canAccessClassroom } from '@/lib/access/classroom-policy'
import {
  evaluateFeatureEntitlement,
  evaluateClassroomFeatureAccess,
  evaluateLegacyClassroomCreation,
} from '@/lib/access/feature-entitlements'

const ownerId = '11111111-1111-4111-8111-111111111111'
const memberId = '22222222-2222-4222-8222-222222222222'
const at = Date.parse('2026-09-02T12:00:00Z')
const entitlement = {
  subjectUserId: ownerId, feature: 'grading.ai', source: 'plan', enabled: true,
  startsAt: '2026-09-01T00:00:00Z', expiresAt: '2026-10-01T00:00:00Z',
  quota: { limit: 10, used: 2 },
}
const context = {
  userId: ownerId, ownerId, classroomId: '33333333-3333-4333-8333-333333333333',
  relationship: 'owner', archived: false,
}
const evaluate = (snapshot: unknown = entitlement, time = at, units = 1) =>
  evaluateFeatureEntitlement(ownerId, 'grading.ai', snapshot, time, units)

describe('effective feature entitlement decisions (not billing or quota reservation)', () => {
  it('accepts an enabled matching entitlement during its validity interval', () => {
    expect(evaluate()).toEqual({ allowed: true })
    expect(evaluate(entitlement, Date.parse(entitlement.startsAt))).toEqual({ allowed: true })
    expect(evaluate({ ...entitlement, expiresAt: null, quota: null })).toEqual({ allowed: true })
  })

  it.each(['legacy', 'plan', 'trial', 'manual', 'school'])('uses the same rules for %s provenance', (source) => {
    expect(evaluate({ ...entitlement, source })).toEqual({ allowed: true })
  })

  it.each([
    [{ ...entitlement, enabled: false }, 'disabled'],
    [{ ...entitlement, startsAt: '2026-09-03T00:00:00Z' }, 'not_started'],
    [{ ...entitlement, expiresAt: '2026-09-02T12:00:00Z' }, 'expired'],
    [{ ...entitlement, quota: { limit: 2, used: 2 } }, 'quota_exhausted'],
    [{ ...entitlement, quota: { limit: 0, used: 0 } }, 'quota_exhausted'],
    [{ ...entitlement, subjectUserId: memberId }, 'subject_mismatch'],
    [{ ...entitlement, feature: 'classrooms.create' }, 'feature_mismatch'],
  ])('denies unusable snapshots', (snapshot, reason) => {
    expect(evaluate(snapshot)).toEqual({ allowed: false, reason })
  })

  it('checks the whole requested quantity without consuming anything', () => {
    const before = structuredClone(entitlement)
    expect(evaluate(entitlement, at, 8)).toEqual({ allowed: true })
    expect(evaluate(entitlement, at, 9)).toEqual({ allowed: false, reason: 'quota_exhausted' })
    expect(entitlement).toEqual(before)
  })

  it.each([null, {}, { ...entitlement, source: 'client_claim' },
    { ...entitlement, enabled: 'true' }, { ...entitlement, feature: '*' },
    { ...entitlement, startsAt: 'invalid' }, { ...entitlement, expiresAt: 'invalid' },
    { ...entitlement, expiresAt: entitlement.startsAt },
    { ...entitlement, quota: undefined }, { ...entitlement, expiresAt: undefined },
    { ...entitlement, quota: { limit: -1, used: 0 } },
    { ...entitlement, quota: { limit: 2, used: -1 } },
    { ...entitlement, quota: { limit: 2.5, used: 0 } },
    { ...entitlement, quota: { limit: Infinity, used: 0 } },
    { ...entitlement, quota: { limit: Number.MAX_SAFE_INTEGER + 1, used: 0 } },
  ])('fails closed on absent or malformed snapshots %j', (snapshot) => {
    expect(evaluate(snapshot)).toEqual({ allowed: false, reason: 'invalid_context' })
  })

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid requested units %s', (units) => {
    expect(evaluate(entitlement, at, units)).toEqual({ allowed: false, reason: 'invalid_context' })
  })

  it('rejects invalid time, subjects, and unknown features', () => {
    expect(evaluate(entitlement, NaN)).toEqual({ allowed: false, reason: 'invalid_context' })
    expect(evaluate(entitlement, Infinity)).toEqual({ allowed: false, reason: 'invalid_context' })
    expect(evaluateFeatureEntitlement('', 'grading.ai', entitlement, at).allowed).toBe(false)
    expect(evaluateFeatureEntitlement(ownerId, '*', entitlement, at).allowed).toBe(false)
  })
})

describe('relationship AND owner-sponsored feature access', () => {
  it('permits an active owner with an effective entitlement', () => {
    expect(evaluateClassroomFeatureAccess(context, 'grading.ai', entitlement, at)).toEqual({ allowed: true })
  })

  it.each([
    { ...context, relationship: 'member', userId: memberId },
    { ...context, relationship: 'none', userId: memberId },
    { ...context, archived: true },
    null,
  ])('a paid plan cannot override classroom permission %j', (access) => {
    expect(evaluateClassroomFeatureAccess(access, 'grading.ai', entitlement, at))
      .toEqual({ allowed: false, reason: 'classroom_forbidden' })
  })

  it('does not use a different user’s entitlement', () => {
    expect(evaluateClassroomFeatureAccess(context, 'grading.ai', { ...entitlement, subjectUserId: memberId }, at))
      .toEqual({ allowed: false, reason: 'subject_mismatch' })
  })

  it('expiry removes the feature, not ownership or access to existing work', () => {
    expect(evaluateClassroomFeatureAccess(context, 'grading.ai', entitlement, Date.parse(entitlement.expiresAt)))
      .toEqual({ allowed: false, reason: 'expired' })
    expect(canAccessClassroom(context, 'read')).toBe(true)
    expect(canAccessClassroom(context, 'manage')).toBe(true)
  })

  it('only accepts explicitly mapped classroom features', () => {
    expect(evaluateClassroomFeatureAccess(context, 'classrooms.create', entitlement, at).allowed).toBe(false)
    expect(evaluateClassroomFeatureAccess(context, '*', entitlement, at).allowed).toBe(false)
  })
})

describe('legacy creation compatibility policy', () => {
  it('preserves teacher-only creation without applying hypothetical plan limits', () => {
    expect(evaluateLegacyClassroomCreation({ id: ownerId, role: 'teacher' })).toEqual({ allowed: true })
    expect(evaluateLegacyClassroomCreation({ id: memberId, role: 'student' }).allowed).toBe(false)
  })

  it.each([null, {}, { id: ownerId, role: 'pro' }, { id: '', role: 'teacher' }])('rejects unknown identity %j', (user) => {
    expect(evaluateLegacyClassroomCreation(user).allowed).toBe(false)
  })
})
