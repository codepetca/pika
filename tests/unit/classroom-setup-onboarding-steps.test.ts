import { describe, expect, it } from 'vitest'
import { CLASSROOM_SETUP_STEPS, classroomSetupOnboardingKey } from '@/components/onboarding/classroom-setup-steps'
import { ONBOARDING_TARGET_IDS } from '@/components/onboarding/classroom-setup-onboarding-ids'
import type { TeacherAttendancePolicy } from '@/lib/teacher-attendance-policy'

function policy(overrides: Partial<TeacherAttendancePolicy> = {}): TeacherAttendancePolicy {
  return {
    classroomId: 'classroom-1',
    timezone: 'America/Toronto',
    sessionStartsLocal: '08:55',
    sessionEndsLocal: '09:10',
    sessionEndDayOffset: 0,
    entryOpensMinutesBefore: 10,
    presentGraceMinutes: 5,
    entryClosesMinutesBeforeEnd: 0,
    absentMinutesBeforeEnd: 0,
    enabled: true,
    revision: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function stepById(id: string) {
  const step = CLASSROOM_SETUP_STEPS.find((candidate) => candidate.id === id)
  if (!step) throw new Error(`Missing step ${id}`)
  return step
}

describe('CLASSROOM_SETUP_STEPS', () => {
  it('has exactly one derived step: attendance hours', () => {
    const derived = CLASSROOM_SETUP_STEPS.filter((step) => step.isDone)
    expect(derived.map((step) => step.id)).toEqual(['attendance-hours'])
  })

  it('marks attendance hours done only when the policy is enabled', () => {
    const step = stepById('attendance-hours')
    expect(step.isDone!({ attendancePolicy: null })).toBe(false)
    expect(step.isDone!({ attendancePolicy: policy({ enabled: false }) })).toBe(false)
    expect(step.isDone!({ attendancePolicy: policy({ enabled: true }) })).toBe(true)
  })

  it('leaves class-days and invite-students acknowledgment-only', () => {
    // These can't be derived from data: class days already have a default
    // calendar at creation, and "invited" has no reliable signal.
    expect(stepById('class-days').isDone).toBeUndefined()
    expect(stepById('invite-students').isDone).toBeUndefined()
  })

  it('targets the same DOM ids the settings/attendance UI actually renders', () => {
    expect(stepById('class-days').targetSelector).toBe(`#${ONBOARDING_TARGET_IDS.settingsClassDaysTab}`)
    expect(stepById('attendance-hours').targetSelector).toBe(`#${ONBOARDING_TARGET_IDS.attendanceWindow}`)
    expect(stepById('invite-students').targetSelector).toBe(`#${ONBOARDING_TARGET_IDS.joinCodeCard}`)
  })

  it('scopes the storage key per classroom', () => {
    expect(classroomSetupOnboardingKey('abc-123')).toBe('onboarding:classroom:abc-123')
  })
})
