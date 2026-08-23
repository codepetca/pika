import { describe, expect, it } from 'vitest'

import {
  attendanceEntitlementAuthorizationBinding,
  attendanceEntitlementAuthorizationMatches,
  exactAttendanceEntitlementTarget,
} from '@/lib/server/bara-attendance-entitlement-authorization'

const input = {
  targetOrigin: 'https://project.supabase.co',
  operationId: '10000000-0000-4000-8000-000000000001',
  teacherId: '20000000-0000-4000-8000-000000000002',
  status: 'active' as const,
  validFrom: '2026-08-23T12:00:00.000Z',
  validUntil: null,
  source: 'operator',
  actorRef: 'operator:stew',
  reasonCode: 'authorized_attendance',
  expectedRevision: 0,
}

describe('attendance entitlement operator authorization', () => {
  it('binds authorization to the exact target and complete mutation payload', () => {
    const binding = attendanceEntitlementAuthorizationBinding(input)
    expect(binding).toMatch(new RegExp(`^${input.operationId}:[a-f0-9]{64}$`))
    expect(attendanceEntitlementAuthorizationMatches(binding, binding)).toBe(true)
    expect(attendanceEntitlementAuthorizationBinding({
      ...input,
      targetOrigin: 'https://other.supabase.co',
    })).not.toBe(binding)
    expect(attendanceEntitlementAuthorizationBinding({
      ...input,
      status: 'revoked',
    })).not.toBe(binding)
    expect(attendanceEntitlementAuthorizationMatches(`${binding}x`, binding)).toBe(false)
  })

  it('accepts only exact HTTPS origins or loopback HTTP targets', () => {
    expect(exactAttendanceEntitlementTarget('https://project.supabase.co'))
      .toBe('https://project.supabase.co')
    expect(exactAttendanceEntitlementTarget('http://127.0.0.1:54321'))
      .toBe('http://127.0.0.1:54321')
    expect(() => exactAttendanceEntitlementTarget('https://project.supabase.co/path'))
      .toThrow('target is invalid')
    expect(() => exactAttendanceEntitlementTarget('http://project.supabase.co'))
      .toThrow('target is invalid')
  })
})
