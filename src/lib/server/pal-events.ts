import { createHmac } from 'node:crypto'

import { formatDateInToronto } from '@/lib/timezone'
import { requirePalPseudonymSecret } from '@/lib/server/pal-config'
import { v1 } from '@/vendor/pal-contract'

type PalTokenKind = 'learner' | 'classroom' | 'item' | 'session' | 'fact'

function requiredSecret(explicitSecret?: string): string {
  const secret = explicitSecret?.trim() || requirePalPseudonymSecret()
  if (!secret) {
    throw new Error('PAL_PSEUDONYM_SECRET is not configured')
  }
  return secret
}

export function pseudonymizePalRef(
  kind: PalTokenKind,
  rawValue: string,
  explicitSecret?: string,
): string {
  if (!rawValue) {
    throw new Error(`Cannot pseudonymize an empty Pal ${kind} reference`)
  }

  const digest = createHmac('sha256', requiredSecret(explicitSecret))
    .update(`pal-v1:${kind}:${rawValue}`)
    .digest('base64url')

  return `pika-${kind}-${digest}`
}

function mondayForCalendarDay(activityDay: string): string {
  const date = new Date(`${activityDay}T00:00:00Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== activityDay) {
    throw new Error('Pal activity day must be a real YYYY-MM-DD calendar date')
  }

  const daysSinceMonday = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - daysSinceMonday)
  return date.toISOString().slice(0, 10)
}

export function palPeriodKeyForActivityDay(activityDay: string): string {
  return `pika-week-${mondayForCalendarDay(activityDay)}`
}

export function palPeriodKeyForInstant(occurredAt: Date): string {
  return palPeriodKeyForActivityDay(formatDateInToronto(occurredAt))
}

function factIdempotencyKey(
  factIdentity: string,
  explicitSecret?: string,
): string {
  return `pika:v1:${pseudonymizePalRef('fact', factIdentity, explicitSecret)}`
}

function validateBuiltEvent<T extends v1.V1EventType>(
  event: v1.V1Envelope<T>,
): v1.V1Envelope<T> {
  const result = v1.validateV1Event(event)
  if (!result.ok) {
    throw new Error(`Pika built an invalid Pal event: ${result.error}: ${result.detail}`)
  }
  return event
}

type CommonEventInput = {
  learnerId: string
  occurredAt: Date
  pseudonymSecret?: string
}

export function buildSessionStartedEvent(
  input: CommonEventInput & { sessionId: string },
): v1.SessionStartedEvent {
  const secret = requiredSecret(input.pseudonymSecret)
  return validateBuiltEvent({
    schema_version: 1,
    idempotency_key: factIdempotencyKey(
      `platform.session.started:${input.learnerId}:${input.sessionId}`,
      secret,
    ),
    learner_id: pseudonymizePalRef('learner', input.learnerId, secret),
    event_type: 'platform.session.started',
    occurred_at: input.occurredAt.toISOString(),
    metadata: {},
  })
}

export function buildClassroomJoinedEvent(
  input: CommonEventInput & { classroomId: string },
): v1.ClassroomJoinedEvent {
  const secret = requiredSecret(input.pseudonymSecret)
  return validateBuiltEvent({
    schema_version: 1,
    idempotency_key: factIdempotencyKey(
      `classroom.joined:${input.learnerId}:${input.classroomId}`,
      secret,
    ),
    learner_id: pseudonymizePalRef('learner', input.learnerId, secret),
    event_type: 'classroom.joined',
    occurred_at: input.occurredAt.toISOString(),
    metadata: {
      classroom_token: pseudonymizePalRef('classroom', input.classroomId, secret),
    },
  })
}

export function buildDailyLogWeekConfiguredEvent(
  input: CommonEventInput & {
    periodKey: string
    configVersion: number
    periodStatus: 'open' | 'closed'
    eligibleDays: number
  },
): v1.DailyLogWeekConfiguredEvent {
  const secret = requiredSecret(input.pseudonymSecret)
  return validateBuiltEvent({
    schema_version: 1,
    idempotency_key: factIdempotencyKey(
      `daily_log_week.configured:${input.learnerId}:${input.periodKey}:${input.configVersion}`,
      secret,
    ),
    learner_id: pseudonymizePalRef('learner', input.learnerId, secret),
    event_type: 'daily_log_week.configured',
    occurred_at: input.occurredAt.toISOString(),
    metadata: {
      period_key: input.periodKey,
      config_version: input.configVersion,
      period_status: input.periodStatus,
      eligible_days: input.eligibleDays,
    },
  })
}

export function buildDailyLogCompletedEvent(
  input: CommonEventInput & { activityDay: string },
): v1.DailyLogCompletedEvent {
  const secret = requiredSecret(input.pseudonymSecret)
  return validateBuiltEvent({
    schema_version: 1,
    idempotency_key: factIdempotencyKey(
      `daily_log.completed:${input.learnerId}:${input.activityDay}`,
      secret,
    ),
    learner_id: pseudonymizePalRef('learner', input.learnerId, secret),
    event_type: 'daily_log.completed',
    occurred_at: input.occurredAt.toISOString(),
    metadata: {
      period_key: palPeriodKeyForActivityDay(input.activityDay),
      activity_day: input.activityDay,
    },
  })
}

export function buildLearningItemViewedEvent(
  input: CommonEventInput & {
    itemId: string
    releasedAt: string
  },
): v1.LearningItemViewedEvent {
  const secret = requiredSecret(input.pseudonymSecret)
  const releasedAt = new Date(input.releasedAt)
  if (Number.isNaN(releasedAt.getTime())) {
    throw new Error('Cannot classify a Pal item view without a valid release timestamp')
  }

  const timing = input.occurredAt.getTime() <= releasedAt.getTime() + 24 * 60 * 60 * 1000
    ? 'within_24h_of_release'
    : 'later'

  return validateBuiltEvent({
    schema_version: 1,
    idempotency_key: factIdempotencyKey(
      `learning_item.viewed:${input.learnerId}:${input.itemId}`,
      secret,
    ),
    learner_id: pseudonymizePalRef('learner', input.learnerId, secret),
    event_type: 'learning_item.viewed',
    occurred_at: input.occurredAt.toISOString(),
    metadata: {
      item_token: pseudonymizePalRef('item', input.itemId, secret),
      kind: 'assignment',
      period_key: palPeriodKeyForInstant(input.occurredAt),
      timing,
    },
  })
}

export function buildLearningItemCompletedEvent(
  input: CommonEventInput & {
    itemId: string
    dueAt: string | null
  },
): v1.LearningItemCompletedEvent {
  const secret = requiredSecret(input.pseudonymSecret)
  const dueAt = input.dueAt === null ? null : new Date(input.dueAt)
  if (dueAt && Number.isNaN(dueAt.getTime())) {
    throw new Error('Cannot classify a Pal item completion without a valid due timestamp')
  }

  return validateBuiltEvent({
    schema_version: 1,
    idempotency_key: factIdempotencyKey(
      `learning_item.completed:${input.learnerId}:${input.itemId}`,
      secret,
    ),
    learner_id: pseudonymizePalRef('learner', input.learnerId, secret),
    event_type: 'learning_item.completed',
    occurred_at: input.occurredAt.toISOString(),
    metadata: {
      item_token: pseudonymizePalRef('item', input.itemId, secret),
      kind: 'assignment',
      period_key: palPeriodKeyForInstant(input.occurredAt),
      // An assignment without a deadline cannot be late.
      timing: dueAt === null || input.occurredAt.getTime() <= dueAt.getTime()
        ? 'on_time'
        : 'late',
    },
  })
}
