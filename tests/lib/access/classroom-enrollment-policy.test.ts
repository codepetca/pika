import { describe, expect, it } from 'vitest'
import { decideClassroomJoin } from '@/lib/access/classroom-enrollment-policy'

const ownerId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'
const classroomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const base = {
  context: { userId, classroomId, ownerId, relationship: 'none' as const, archived: false },
  invitation: 'code' as const,
  enrollmentOpen: true,
  joinPolicy: 'roster' as const,
  rosterMatch: true,
  profileComplete: false,
}

describe('classroom enrollment policy', () => {
  it('admits a roster-matched nonmember with a verified class code', () => {
    expect(decideClassroomJoin(base)).toEqual({ allowed: true, action: 'join' })
  })

  it('treats an existing active membership as idempotent without requiring another invitation', () => {
    expect(decideClassroomJoin({
      ...base,
      context: { ...base.context, relationship: 'member' },
      invitation: 'classroom_id',
      enrollmentOpen: false,
      rosterMatch: false,
    })).toEqual({ allowed: true, action: 'already_enrolled' })
  })

  it.each([
    [{ ...base, context: { ...base.context, archived: true } }, 'archived'],
    [{ ...base, context: { ...base.context, userId: ownerId, relationship: 'owner' as const } }, 'own_classroom'],
    [{ ...base, invitation: 'classroom_id' as const }, 'code_required'],
    [{ ...base, enrollmentOpen: false }, 'enrollment_closed'],
    [{ ...base, rosterMatch: false }, 'not_on_roster'],
  ])('denies %s with the precise reason', (input, reason) => {
    expect(decideClassroomJoin(input)).toEqual({ allowed: false, reason })
  })

  it('requires a complete profile only for unmatched open-join admission', () => {
    const open = { ...base, joinPolicy: 'open_join' as const, rosterMatch: false }
    expect(decideClassroomJoin(open)).toEqual({ allowed: false, reason: 'profile_required' })
    expect(decideClassroomJoin({ ...open, profileComplete: true })).toEqual({ allowed: true, action: 'join' })
    expect(decideClassroomJoin({ ...open, rosterMatch: true })).toEqual({ allowed: true, action: 'join' })
  })

  it.each([
    null,
    {},
    { ...base, extra: true },
    { ...base, context: { ...base.context, classroomId: 'invalid' } },
    { ...base, context: { ...base.context, relationship: 'owner' } },
    { ...base, joinPolicy: 'unknown' },
  ])('fails closed for malformed or inconsistent evidence', (input) => {
    expect(decideClassroomJoin(input)).toEqual({ allowed: false, reason: 'invalid_evidence' })
  })
})
