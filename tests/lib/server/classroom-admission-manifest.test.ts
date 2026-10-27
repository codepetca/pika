import { describe, expect, it } from 'vitest'
import { prepareClassroomAdmissionManifest } from '@/lib/server/classroom-admission-manifest'

const operationId = '00000000-0000-4000-8000-000000000001'
const user = 'abcdef00-0000-4000-8000-000000000002'
const second = 'abcdef00-0000-4000-8000-000000000003'
const input = { operationId, expectedRevision: 2, kind: 'operator' as const,
  userIds: [user, second], excludedUserIds: [], approvalRef: 'review:synthetic' }

describe('offline exact admission manifest preparation', () => {
  it('canonicalizes a complete set without database or provider effects', () => {
    const a = prepareClassroomAdmissionManifest(input)
    const b = prepareClassroomAdmissionManifest({ ...input, userIds: [second.toUpperCase(), user] })
    expect(a).toEqual(b)
    expect(a.p_user_ids).toEqual([user, second])
    expect(a.p_manifest_sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(a.p_expected_revision).toBe(2)
    expect(a.p_approval_ref).toBe(input.approvalRef)
  })
  it('represents a growth stop with no grants or exclusions', () => {
    expect(prepareClassroomAdmissionManifest({ ...input, kind: 'growth_off', userIds: [] }))
      .toMatchObject({ p_kind: 'growth_off', p_user_ids: [], p_excluded_user_ids: [] })
  })
  it.each([
    { ...input, userIds: [user, user.toUpperCase()] },
    { ...input, userIds: [] }, { ...input, userIds: ['not-a-uuid'] },
    { ...input, excludedUserIds: [user] }, { ...input, expectedRevision: -1 },
    { ...input, approvalRef: 'someone@example.invalid' },
    { ...input, kind: 'bootstrap' }, { ...input, kind: 'growth_off' },
    { ...input, extra: true },
  ])('refuses unsafe, partial or ambiguous inputs', (value) => {
    expect(() => prepareClassroomAdmissionManifest(value as typeof input)).toThrow()
  })
})
