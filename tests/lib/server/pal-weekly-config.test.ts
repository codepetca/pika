import { describe, expect, it } from 'vitest'

import {
  planPalWeeklyConfigurationRevisions,
  type PalClassDay,
  type PalEnrollmentSchedule,
} from '@/lib/server/pal-weekly-config'

const periodStart = '2026-09-14'

function schedule(overrides: Partial<PalEnrollmentSchedule> = {}): PalEnrollmentSchedule {
  return {
    studentId: 'student-1',
    classroomId: 'classroom-1',
    enrolledAt: '2026-09-01T12:00:00.000Z',
    classroomStart: '2026-09-01',
    classroomEnd: '2026-12-18',
    archivedAt: null,
    ...overrides,
  }
}

function classDays(
  dates: string[],
  classroomId = 'classroom-1',
): PalClassDay[] {
  return dates.map((date) => ({ classroomId, date }))
}

describe('Pal Weekly Rhythm source configuration', () => {
  it('reports the actual short-week opportunity count instead of assuming five days', () => {
    const revisions = planPalWeeklyConfigurationRevisions({
      periodStart,
      periodStatus: 'open',
      createIfMissing: true,
      schedules: [schedule()],
      classDays: classDays(['2026-09-14', '2026-09-16', '2026-09-18']),
      existing: [],
      completions: [],
    })

    expect(revisions).toEqual([expect.objectContaining({
      periodKey: 'pika-week-2026-09-14',
      configVersion: 1,
      eligibleDays: 3,
      periodStatus: 'open',
    })])
  })

  it('unions opportunities across classrooms without counting a date twice', () => {
    const revisions = planPalWeeklyConfigurationRevisions({
      periodStart,
      periodStatus: 'open',
      createIfMissing: true,
      schedules: [
        schedule(),
        schedule({ classroomId: 'classroom-2' }),
      ],
      classDays: [
        ...classDays(['2026-09-14', '2026-09-16']),
        ...classDays(['2026-09-14', '2026-09-17'], 'classroom-2'),
      ],
      existing: [],
      completions: [],
    })

    expect(revisions[0].eligibleDays).toBe(3)
  })

  it('excludes days before enrolment and on or after classroom archive', () => {
    const revisions = planPalWeeklyConfigurationRevisions({
      periodStart,
      periodStatus: 'open',
      createIfMissing: true,
      schedules: [schedule({
        enrolledAt: '2026-09-16T13:00:00.000Z',
        archivedAt: '2026-09-18T13:00:00.000Z',
      })],
      classDays: classDays([
        '2026-09-14',
        '2026-09-15',
        '2026-09-16',
        '2026-09-17',
        '2026-09-18',
      ]),
      existing: [],
      completions: [],
    })

    expect(revisions[0].eligibleDays).toBe(2)
  })

  it('never revises eligible days below already-emitted completion dates', () => {
    const revisions = planPalWeeklyConfigurationRevisions({
      periodStart,
      periodStatus: 'open',
      createIfMissing: true,
      schedules: [],
      classDays: [],
      existing: [{
        studentId: 'student-1',
        periodKey: 'pika-week-2026-09-14',
        configVersion: 1,
        periodStatus: 'open',
        eligibleDays: 4,
      }],
      completions: [
        { studentId: 'student-1', activityDay: '2026-09-14' },
        { studentId: 'student-1', activityDay: '2026-09-16' },
      ],
    })

    expect(revisions).toEqual([expect.objectContaining({
      configVersion: 2,
      eligibleDays: 2,
    })])
  })

  it('emits only genuine revisions and closes each week once', () => {
    const existing = [{
      studentId: 'student-1',
      periodKey: 'pika-week-2026-09-14',
      configVersion: 2,
      periodStatus: 'open' as const,
      eligibleDays: 3,
    }]
    const inputs = {
      periodStart,
      createIfMissing: true,
      schedules: [schedule()],
      classDays: classDays(['2026-09-14', '2026-09-16', '2026-09-18']),
      existing,
      completions: [],
    }

    expect(planPalWeeklyConfigurationRevisions({
      ...inputs,
      periodStatus: 'open',
    })).toEqual([])
    expect(planPalWeeklyConfigurationRevisions({
      ...inputs,
      periodStatus: 'closed',
    })).toEqual([expect.objectContaining({
      configVersion: 3,
      periodStatus: 'closed',
    })])
  })
})
