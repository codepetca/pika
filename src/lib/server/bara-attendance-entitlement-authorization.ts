import { createHash, timingSafeEqual } from 'node:crypto'

export interface AttendanceEntitlementAuthorizationInput {
  targetOrigin: string
  operationId: string
  teacherId: string
  status: 'active' | 'revoked'
  validFrom: string
  validUntil: string | null
  source: string
  actorRef: string
  reasonCode: string
  expectedRevision: number
}

export interface AttendanceOutboxRecoveryAuthorizationInput {
  targetOrigin: string
  operationId: string
  teacherId: string
  expectedEntitlementRevision: number
  outboxIds: string[]
  actorRef: string
  reasonCode: string
}

export function exactAttendanceEntitlementTarget(raw: string | undefined) {
  if (!raw) throw new Error('Attendance entitlement target is not configured')
  const url = new URL(raw)
  const localHttp = url.protocol === 'http:'
    && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
  if (
    (url.protocol !== 'https:' && !localHttp)
    || url.username
    || url.password
    || url.pathname !== '/'
    || url.search
    || url.hash
  ) throw new Error('Attendance entitlement target is invalid')
  return url.origin
}

export function attendanceEntitlementAuthorizationBinding(
  input: AttendanceEntitlementAuthorizationInput,
) {
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({
      target_origin: input.targetOrigin,
      operation_id: input.operationId,
      teacher_id: input.teacherId,
      status: input.status,
      valid_from: input.validFrom,
      valid_until: input.validUntil,
      source: input.source,
      actor_ref: input.actorRef,
      reason_code: input.reasonCode,
      expected_revision: input.expectedRevision,
    }))
    .digest('hex')
  return `${input.operationId}:${fingerprint}`
}

export function attendanceOutboxRecoveryAuthorizationBinding(
  input: AttendanceOutboxRecoveryAuthorizationInput,
) {
  const fingerprint = createHash('sha256')
    .update(JSON.stringify({
      target_origin: input.targetOrigin,
      operation_id: input.operationId,
      teacher_id: input.teacherId,
      expected_entitlement_revision: input.expectedEntitlementRevision,
      outbox_ids: [...input.outboxIds].sort(),
      actor_ref: input.actorRef,
      reason_code: input.reasonCode,
    }))
    .digest('hex')
  return `${input.operationId}:${fingerprint}`
}

export function attendanceEntitlementAuthorizationMatches(
  actual: string | undefined,
  expected: string,
) {
  if (!actual) return false
  const actualBytes = Buffer.from(actual)
  const expectedBytes = Buffer.from(expected)
  return actualBytes.length === expectedBytes.length
    && timingSafeEqual(actualBytes, expectedBytes)
}
