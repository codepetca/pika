import { describe, expect, it } from 'vitest'

import {
  buildClassroomJoinedEvent,
  buildDailyLogCompletedEvent,
  buildDailyLogWeekConfiguredEvent,
  buildLearningItemCompletedEvent,
  buildLearningItemViewedEvent,
  buildSessionStartedEvent,
  palPeriodKeyForActivityDay,
  palPeriodKeyForInstant,
  pseudonymizePalRef,
} from '@/lib/server/pal-events'
import { v1 } from '@/vendor/pal-contract'

const secret = 'pal-pilot-test-secret-32-characters-long'

describe('Pika Pal v1 event builder', () => {
  it('makes stable, opaque, URL-safe tokens with domain separation', () => {
    const learner = pseudonymizePalRef('learner', 'raw-uuid', secret)

    expect(learner).toBe(pseudonymizePalRef('learner', 'raw-uuid', secret))
    expect(learner).not.toContain('raw-uuid')
    expect(learner).toMatch(/^[A-Za-z0-9._~-]+$/)
    expect(learner).not.toBe(pseudonymizePalRef('item', 'raw-uuid', secret))
  })

  it('rejects a weak explicit pseudonym secret', () => {
    expect(() => pseudonymizePalRef('learner', 'raw-uuid', 'too-short'))
      .toThrow('at least 32 characters')
  })

  it('uses the Toronto calendar week anchored to Monday', () => {
    expect(palPeriodKeyForActivityDay('2026-09-14')).toBe('pika-week-2026-09-14')
    expect(palPeriodKeyForActivityDay('2026-09-20')).toBe('pika-week-2026-09-14')
    expect(palPeriodKeyForActivityDay('2026-09-21')).toBe('pika-week-2026-09-21')
  })

  it('keeps Toronto week classification stable across the spring DST jump', () => {
    expect(palPeriodKeyForInstant(new Date('2027-03-14T06:59:59.000Z')))
      .toBe('pika-week-2027-03-08')
    expect(palPeriodKeyForInstant(new Date('2027-03-14T07:00:00.000Z')))
      .toBe('pika-week-2027-03-08')
  })

  it('builds all six canonical facts accepted by Pal', () => {
    const occurredAt = new Date('2026-09-16T18:20:00.000Z')
    const common = { learnerId: 'learner-uuid', occurredAt, pseudonymSecret: secret }
    const events = [
      buildSessionStartedEvent({ ...common, sessionId: 'session-uuid' }),
      buildClassroomJoinedEvent({ ...common, classroomId: 'classroom-uuid' }),
      buildDailyLogWeekConfiguredEvent({
        ...common,
        periodKey: 'pika-week-2026-09-14',
        configVersion: 1,
        periodStatus: 'open',
        eligibleDays: 3,
        termCalendar: {
          termIdentity: 'pika-term:2026-08-31:2027-01-31:America/Toronto',
          termStartDay: '2026-08-31',
          termEndDay: '2027-01-31',
          termTimezone: 'America/Toronto',
          termWeekCount: 22,
          weekStartDay: '2026-09-14',
          weekIndex: 3,
        },
      }),
      buildDailyLogCompletedEvent({ ...common, activityDay: '2026-09-16' }),
      buildLearningItemViewedEvent({
        ...common,
        itemId: 'assignment-uuid',
        releasedAt: '2026-09-16T12:00:00.000Z',
      }),
      buildLearningItemCompletedEvent({
        ...common,
        itemId: 'assignment-uuid',
        dueAt: '2026-09-17T03:59:00.000Z',
      }),
    ]

    expect(events.map((event) => event.event_type)).toEqual(v1.V1_EVENT_TYPES)
    for (const event of events) {
      expect(v1.validateV1Event(event)).toMatchObject({ ok: true })
      expect(JSON.stringify(event)).not.toContain('learner-uuid')
      expect(JSON.stringify(event)).not.toContain('assignment-uuid')
      expect(JSON.stringify(event)).not.toContain('classroom-uuid')
    }
  })

  it('sends the complete adaptive calendar with an opaque term token', () => {
    const event = buildDailyLogWeekConfiguredEvent({
      learnerId: 'learner-uuid',
      occurredAt: new Date('2026-09-14T11:00:00.000Z'),
      pseudonymSecret: secret,
      periodKey: 'pika-week-2026-09-14',
      configVersion: 1,
      periodStatus: 'open',
      eligibleDays: 3,
      termCalendar: {
        termIdentity: 'pika-term:2026-08-31:2027-01-31:America/Toronto',
        termStartDay: '2026-08-31',
        termEndDay: '2027-01-31',
        termTimezone: 'America/Toronto',
        termWeekCount: 22,
        weekStartDay: '2026-09-14',
        weekIndex: 3,
      },
    })

    expect(event.metadata).toEqual(expect.objectContaining({
      term_token: expect.stringMatching(/^pika-term-/),
      term_start_day: '2026-08-31',
      term_end_day: '2027-01-31',
      term_timezone: 'America/Toronto',
      term_week_count: 22,
      week_start_day: '2026-09-14',
      week_index: 3,
    }))
    expect(JSON.stringify(event)).not.toContain('pika-term:2026-08-31')
    expect(v1.validateV1Event(event)).toMatchObject({ ok: true })
  })

  it('deduplicates daily logs across classrooms at learner and activity-day scope', () => {
    const common = {
      learnerId: 'learner-uuid',
      occurredAt: new Date('2026-09-16T18:20:00.000Z'),
      activityDay: '2026-09-16',
      pseudonymSecret: secret,
    }

    expect(buildDailyLogCompletedEvent(common).idempotency_key).toBe(
      buildDailyLogCompletedEvent(common).idempotency_key,
    )
  })

  it('classifies item timing in Pika without sending release or due timestamps', () => {
    const common = {
      learnerId: 'learner-uuid',
      itemId: 'assignment-uuid',
      pseudonymSecret: secret,
    }
    const early = buildLearningItemViewedEvent({
      ...common,
      occurredAt: new Date('2026-09-16T12:30:00.000Z'),
      releasedAt: '2026-09-16T12:00:00.000Z',
    })
    const later = buildLearningItemViewedEvent({
      ...common,
      occurredAt: new Date('2026-09-18T12:30:00.000Z'),
      releasedAt: '2026-09-16T12:00:00.000Z',
    })
    const onTime = buildLearningItemCompletedEvent({
      ...common,
      occurredAt: new Date('2026-09-17T03:59:00.000Z'),
      dueAt: '2026-09-17T03:59:00.000Z',
    })
    const late = buildLearningItemCompletedEvent({
      ...common,
      occurredAt: new Date('2026-09-17T04:00:00.000Z'),
      dueAt: '2026-09-17T03:59:00.000Z',
    })
    const noDeadline = buildLearningItemCompletedEvent({
      ...common,
      occurredAt: new Date('2026-09-17T04:00:00.000Z'),
      dueAt: null,
    })

    expect(early.metadata.timing).toBe('within_24h_of_release')
    expect(later.metadata.timing).toBe('later')
    expect(onTime.metadata.timing).toBe('on_time')
    expect(late.metadata.timing).toBe('late')
    expect(noDeadline.metadata.timing).toBe('on_time')
    expect(JSON.stringify([early, later, onTime, late, noDeadline])).not.toMatch(
      /released_at|due_at/,
    )
  })
})
