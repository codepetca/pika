import { describe, expect, it } from 'vitest'

import {
  buildClassroomJoinedEvent,
  buildDailyLogCompletedEvent,
  buildDailyLogWeekConfiguredEvent,
  buildLearningItemCompletedEvent,
  buildLearningItemViewedEvent,
  buildSessionStartedEvent,
  palPeriodKeyForActivityDay,
  pseudonymizePalRef,
} from '@/lib/server/pal-events'
import { v1 } from '@/vendor/pal-contract'

const secret = 'pal-pilot-test-secret'

describe('Pika Pal v1 event builder', () => {
  it('makes stable, opaque, URL-safe tokens with domain separation', () => {
    const learner = pseudonymizePalRef('learner', 'raw-uuid', secret)

    expect(learner).toBe(pseudonymizePalRef('learner', 'raw-uuid', secret))
    expect(learner).not.toContain('raw-uuid')
    expect(learner).toMatch(/^[A-Za-z0-9._~-]+$/)
    expect(learner).not.toBe(pseudonymizePalRef('item', 'raw-uuid', secret))
  })

  it('uses the Toronto calendar week anchored to Monday', () => {
    expect(palPeriodKeyForActivityDay('2026-09-14')).toBe('pika-week-2026-09-14')
    expect(palPeriodKeyForActivityDay('2026-09-20')).toBe('pika-week-2026-09-14')
    expect(palPeriodKeyForActivityDay('2026-09-21')).toBe('pika-week-2026-09-21')
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

    expect(early.metadata.timing).toBe('within_24h_of_release')
    expect(later.metadata.timing).toBe('later')
    expect(onTime.metadata.timing).toBe('on_time')
    expect(late.metadata.timing).toBe('late')
    expect(JSON.stringify([early, later, onTime, late])).not.toMatch(/released_at|due_at/)
  })
})
