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
  it('covers exactly attendance-hours and invite-students', () => {
    // Class-day review is deliberately not a step here: ClassroomPageClient
    // already shows its own persistent setup/review banner for that, driven
    // by a real classDaysNeedSetup signal. This chain only covers what that
    // banner doesn't.
    expect(CLASSROOM_SETUP_STEPS.map((step) => step.id)).toEqual(['attendance-hours', 'invite-students'])
  })

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

  it('leaves invite-students acknowledgment-only', () => {
    // No reliable signal that a join code was actually shared.
    expect(stepById('invite-students').isDone).toBeUndefined()
  })

  it('targets the same DOM ids the settings/attendance UI actually renders', () => {
    expect(stepById('attendance-hours').targetSelector).toBe(`#${ONBOARDING_TARGET_IDS.attendanceWindow}`)
    expect(stepById('invite-students').targetSelector).toBe(`#${ONBOARDING_TARGET_IDS.joinCodeCard}`)
  })

  it('also rings the left-rail entry point that leads to each step', () => {
    // invite-students lives under the Settings tab; attendance-hours lives
    // on the Daily/Attendance tab.
    expect(stepById('attendance-hours').pathTargetSelector).toBe('[data-nav-item="daily"]')
    expect(stepById('invite-students').pathTargetSelector).toBe('[data-nav-item="settings"]')
  })

  it('scopes the storage key per classroom', () => {
    expect(classroomSetupOnboardingKey('abc-123')).toBe('onboarding:classroom:abc-123')
  })
})
