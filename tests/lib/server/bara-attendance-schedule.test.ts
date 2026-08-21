import { describe, expect, it } from 'vitest'
import { buildBaraScheduleSnapshot } from '@/lib/server/bara-attendance-schedule'

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
    opensAtLocal: '08:50',
    closesAtLocal: '09:20',
    closeDayOffset: 0 as const,
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
          opens_at: '2026-03-06T13:50:00.000Z',
          closes_at: '2026-03-06T14:20:00.000Z',
        },
        {
          occurrence_ref: 'occurrence_march_nine',
          date: '2026-03-09',
          title: 'Period 1 attendance',
          opens_at: '2026-03-09T12:50:00.000Z',
          closes_at: '2026-03-09T13:20:00.000Z',
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
      policy: { ...base.policy, closesAtLocal: '08:40' },
      classDays: [{
        date: '2026-03-06',
        isClassDay: true,
        occurrenceRef: 'occurrence_march_six',
      }],
    })).toThrow('Attendance close time must be after open time')

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
        opensAtLocal: '02:15',
        closesAtLocal: '03:30',
        closeDayOffset: 0,
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
        opensAtLocal: '23:30',
        closesAtLocal: '00:15',
        closeDayOffset: 1,
      },
      classDays: [{
        date: '2026-11-02',
        isClassDay: true,
        occurrenceRef: 'occurrence_evening',
      }],
    })

    expect(snapshot.occurrences[0]).toMatchObject({
      opens_at: '2026-11-03T04:30:00.000Z',
      closes_at: '2026-11-03T05:15:00.000Z',
    })
  })
})
