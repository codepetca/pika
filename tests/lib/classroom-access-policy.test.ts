import { describe, expect, it } from 'vitest'
import { canAccessClassroom, type ClassroomAccessContext } from '@/lib/access/classroom-policy'

const ownerId = '11111111-1111-4111-8111-111111111111'
const memberId = '22222222-2222-4222-8222-222222222222'
const classroomId = '33333333-3333-4333-8333-333333333333'

function context(relationship: ClassroomAccessContext['relationship'], archived = false) {
  return { userId: relationship === 'owner' ? ownerId : memberId, ownerId, classroomId, relationship, archived }
}

describe('dormant classroom relationship policy', () => {
  it.each([
    ['owner', false, true, true, false],
    ['owner', true, true, false, false],
    ['member', false, true, false, true],
    ['member', true, false, false, false],
    ['none', false, false, false, false],
    ['none', true, false, false, false],
  ] as const)('%s, archived=%s', (relationship, archived, read, manage, participate) => {
    const access = context(relationship, archived)
    expect(canAccessClassroom(access, 'read')).toBe(read)
    expect(canAccessClassroom(access, 'manage')).toBe(manage)
    expect(canAccessClassroom(access, 'participate')).toBe(participate)
  })

  it('allows the same account to own one class and participate in another', () => {
    expect(canAccessClassroom(context('owner'), 'manage')).toBe(true)
    expect(canAccessClassroom({
      ...context('member'), userId: ownerId, ownerId: memberId,
      classroomId: '44444444-4444-4444-8444-444444444444',
    }, 'participate')).toBe(true)
  })

  it.each([null, {}, { ...context('owner'), relationship: 'admin' },
    { ...context('owner'), userId: memberId }, { ...context('member'), userId: ownerId },
    { ...context('owner'), archived: undefined }, { ...context('owner'), classroomId: '' },
  ])('fails closed for invalid or inconsistent context %j', (access) => {
    expect(canAccessClassroom(access, 'read')).toBe(false)
    expect(canAccessClassroom(access, 'manage')).toBe(false)
  })

  it('rejects unknown actions', () => {
    expect(canAccessClassroom(context('owner'), 'delete_everything')).toBe(false)
  })
})
