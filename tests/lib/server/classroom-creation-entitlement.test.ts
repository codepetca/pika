import { describe, expect, it } from 'vitest'
import { mapClassroomCreationDatabaseError } from '@/lib/server/classroom-creation-entitlement'

describe('classroom creation entitlement database errors', () => {
  it.each([
    [
      '42501',
      'classroom_creation_entitlement_disabled',
      403,
      'Classroom creation requires Access.',
      false,
    ],
    [
      '42501',
      'classroom_creation_entitlement_not_started',
      403,
      'Your classroom creation access is not active yet.',
      false,
    ],
    [
      '42501',
      'classroom_creation_entitlement_expired',
      403,
      'Your classroom creation access has expired.',
      false,
    ],
    [
      '23514',
      'classroom_creation_active_limit_reached',
      409,
      'Archive an active classroom before creating another.',
      false,
    ],
    [
      '55000',
      'classroom_creation_entitlement_unavailable',
      503,
      'Classroom creation is temporarily unavailable. Please try again.',
      true,
    ],
  ])('maps %s %s to a safe API denial', (code, message, status, safeMessage, retryable) => {
    expect(mapClassroomCreationDatabaseError({ code, message })).toEqual({
      status,
      errorCode: message,
      message: safeMessage,
      retryable,
    })
  })

  it('does not reinterpret unrelated database failures', () => {
    expect(mapClassroomCreationDatabaseError({
      code: '23514',
      message: 'another_constraint_failed',
    })).toBeNull()
    expect(mapClassroomCreationDatabaseError({
      code: '42501',
      message: 'permission denied for table classrooms',
    })).toBeNull()
    expect(mapClassroomCreationDatabaseError({
      code: '55000',
      message: 'another_prerequisite_failed',
    })).toBeNull()
    expect(mapClassroomCreationDatabaseError(null)).toBeNull()
  })
})
