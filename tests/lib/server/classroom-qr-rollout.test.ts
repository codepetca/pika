import { describe, expect, it } from 'vitest'
import { isClassroomQrRolloutAllowed } from '@/lib/server/classroom-qr-rollout'

const scope = {
  teacherId: '22222222-2222-4222-8222-222222222222',
  classroomId: '11111111-1111-4111-8111-111111111111',
}
const canary = {
  PIKA_CLASSROOM_QR_MODE: 'canary',
  PIKA_CLASSROOM_QR_CANARY_TEACHER_ID: scope.teacherId,
  PIKA_CLASSROOM_QR_CANARY_CLASSROOM_ID: scope.classroomId,
}

describe('stable classroom QR rollout gate', () => {
  it.each([undefined, '', 'disabled', 'true', 'typo'])('fails closed for mode %s', (mode) => {
    expect(isClassroomQrRolloutAllowed(scope, { ...canary, PIKA_CLASSROOM_QR_MODE: mode })).toBe(false)
  })
  it('admits only the exact configured teacher and classroom pair', () => {
    expect(isClassroomQrRolloutAllowed(scope, canary)).toBe(true)
    expect(isClassroomQrRolloutAllowed({ ...scope, teacherId: scope.classroomId }, canary)).toBe(false)
    expect(isClassroomQrRolloutAllowed({ ...scope, classroomId: scope.teacherId }, canary)).toBe(false)
  })
  it.each(['PIKA_CLASSROOM_QR_CANARY_TEACHER_ID', 'PIKA_CLASSROOM_QR_CANARY_CLASSROOM_ID'])('rejects absent or malformed %s', (key) => {
    expect(isClassroomQrRolloutAllowed(scope, { ...canary, [key]: '' })).toBe(false)
    expect(isClassroomQrRolloutAllowed(scope, { ...canary, [key]: '*' })).toBe(false)
  })
  it('requires an explicit enabled mode for wider availability', () => {
    expect(isClassroomQrRolloutAllowed(scope, { PIKA_CLASSROOM_QR_MODE: 'enabled' })).toBe(true)
    expect(isClassroomQrRolloutAllowed(scope, { PIKA_BARA_ATTENDANCE_ENABLED: 'true' })).toBe(false)
  })
})
