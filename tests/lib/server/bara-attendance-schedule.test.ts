import { describe, expect, it } from 'vitest'
import {
  buildBaraScheduleSnapshot,
  materializeBaraAttendanceSchedule,
} from '@/lib/server/bara-attendance-schedule'

const base = {
  installationRef: 'pika_development',
  rosterRef: 'roster_period_one',
  revision: 4,
  idempotencyKey: 'schedule:roster_period_one:revision:4',
  correlationRef: 'schedule_roster_period_one_4',
  windowStart: '2026-03-01',
  windowEnd: '2026-03-31',
  attendanceTitle: 'Period 1 attendance',
  policy: {
    timezone: 'America/Toronto' as const,
    sessionStartsAtLocal: '09:00',
    sessionEndsAtLocal: '09:30',
    sessionEndDayOffset: 0 as const,
    entryOpensMinutesBefore: 10,
    presentGraceMinutes: 5,
    entryClosesMinutesBeforeEnd: 10,
    absentMinutesBeforeEnd: 0,
    policyRevision: 3,
  },
}

describe('Bara attendance schedule materialization', () => {
  it('turns Pika class days into deterministic UTC windows across DST', () => {
    const snapshot = buildBaraScheduleSnapshot({
      ...base,
      classDays: [
        {
          date: '2026-03-09',
          isClassDay: true,
          occurrenceRef: 'occurrence_march_nine',
        },
        {
          date: '2026-03-06',
          isClassDay: true,
          occurrenceRef: 'occurrence_march_six',
        },
      ],
    })

    expect(snapshot).toEqual({
      schema_version: 1,
      message_type: 'schedule.snapshot',
      idempotency_key: 'schedule:roster_period_one:revision:4',
      correlation_ref: 'schedule_roster_period_one_4',
      installation_ref: 'pika_development',
      roster_ref: 'roster_period_one',
      revision: 4,
      timezone: 'America/Toronto',
      window_start: '2026-03-01',
      window_end: '2026-03-31',
      occurrences: [
        {
          occurrence_ref: 'occurrence_march_six',
          date: '2026-03-06',
          title: 'Period 1 attendance',
          accepts_at: '2026-03-06T13:50:00.000Z',
          stops_accepting_at: '2026-03-06T14:20:00.000Z',
        },
        {
          occurrence_ref: 'occurrence_march_nine',
          date: '2026-03-09',
          title: 'Period 1 attendance',
          accepts_at: '2026-03-09T12:50:00.000Z',
          stops_accepting_at: '2026-03-09T13:20:00.000Z',
        },
      ],
    })
  })

  it('omits non-class days and dates outside the declared reconciliation window', () => {
    const snapshot = buildBaraScheduleSnapshot({
      ...base,
      classDays: [
        {
          date: '2026-03-05',
          isClassDay: false,
          occurrenceRef: 'occurrence_disabled_day',
        },
        {
          date: '2026-04-01',
          isClassDay: true,
          occurrenceRef: 'occurrence_outside_window',
        },
      ],
    })

    expect(snapshot.occurrences).toEqual([])
  })

  it('rejects unsafe policy windows and missing opaque occurrence mappings', () => {
    expect(() => buildBaraScheduleSnapshot({
      ...base,
      policy: { ...base.policy, sessionEndsAtLocal: '08:40' },
      classDays: [{
        date: '2026-03-06',
        isClassDay: true,
        occurrenceRef: 'occurrence_march_six',
      }],
    })).toThrow('Attendance timing windows are contradictory')

    expect(() => buildBaraScheduleSnapshot({
      ...base,
      classDays: [{
        date: '2026-03-06',
        isClassDay: true,
        occurrenceRef: '10000000-0000-4000-8000-000000000001',
      }],
    })).toThrow('opaque occurrence reference')
  })

  it('rejects nonexistent local times instead of silently shifting them', () => {
    expect(() => buildBaraScheduleSnapshot({
      ...base,
      windowStart: '2026-03-08',
      windowEnd: '2026-03-08',
      policy: {
        timezone: 'America/Toronto',
        ...base.policy,
        sessionStartsAtLocal: '02:15',
        sessionEndsAtLocal: '03:30',
      },
      classDays: [{
        date: '2026-03-08',
        isClassDay: true,
        occurrenceRef: 'occurrence_dst_gap',
      }],
    })).toThrow('does not exist in America/Toronto')
  })

  it('materializes an explicit next-day close for evening classes', () => {
    const snapshot = buildBaraScheduleSnapshot({
      ...base,
      windowStart: '2026-11-02',
      windowEnd: '2026-11-02',
      policy: {
        timezone: 'America/Toronto',
        ...base.policy,
        sessionStartsAtLocal: '23:40',
        sessionEndsAtLocal: '00:25',
        sessionEndDayOffset: 1,
      },
      classDays: [{
        date: '2026-11-02',
        isClassDay: true,
        occurrenceRef: 'occurrence_evening',
      }],
    })

    expect(snapshot.occurrences[0]).toMatchObject({
      accepts_at: '2026-11-03T04:30:00.000Z',
      stops_accepting_at: '2026-11-03T05:15:00.000Z',
    })
  })

  it('keeps Pika-only cutoffs out of the Bara payload and preserves inclusive boundaries', () => {
    const result = materializeBaraAttendanceSchedule({
      ...base,
      classDays: [{
        date: '2026-03-06', isClassDay: true, occurrenceRef: 'occurrence_boundary',
      }],
    })
    expect(result.cutoffs[0]).toMatchObject({
      session_starts_at: '2026-03-06T14:00:00.000Z',
      present_through_at: '2026-03-06T14:05:00.000Z',
      stops_accepting_at: '2026-03-06T14:20:00.000Z',
      absent_at: '2026-03-06T14:30:00.000Z',
      policy_revision: 3,
    })
    expect(result.schedule.occurrences[0]).not.toHaveProperty('present_through_at')
    expect(result.schedule.occurrences[0]).not.toHaveProperty('absent_at')
  })

  it('keeps a frozen occurrence when later policy settings change', () => {
    const frozen = {
      occurrence_ref: 'occurrence_frozen', date: '2026-03-06',
      accepts_at: '2026-03-06T13:45:00.000Z',
      session_starts_at: '2026-03-06T14:00:00.000Z',
      present_through_at: '2026-03-06T14:05:00.000Z',
      stops_accepting_at: '2026-03-06T14:20:00.000Z',
      absent_at: '2026-03-06T14:30:00.000Z',
      session_ends_at: '2026-03-06T14:30:00.000Z', policy_revision: 2,
    }
    const result = materializeBaraAttendanceSchedule({
      ...base,
      policy: { ...base.policy, entryOpensMinutesBefore: 5, policyRevision: 4 },
      classDays: [{
        date: '2026-03-06', isClassDay: true, occurrenceRef: 'occurrence_frozen',
        frozenCutoffs: frozen,
      }],
    })
    expect(result.cutoffs[0]).toEqual(frozen)
    expect(result.schedule.occurrences[0]).toMatchObject({
      accepts_at: frozen.accepts_at, stops_accepting_at: frozen.stops_accepting_at,
    })
  })
})
