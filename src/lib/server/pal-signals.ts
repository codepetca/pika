import { buildSessionStartedEvent } from '@/lib/server/pal-events'
import { isPalEnabled } from '@/lib/server/pal-config'
import {
  attemptImmediatePalEventDelivery,
  enqueueStandalonePalEvent,
} from '@/lib/server/pal-outbox'

export async function recordPalAuthenticatedSession(input: {
  studentId: string
  sessionId: string
  occurredAt?: Date
}): Promise<void> {
  try {
    if (!isPalEnabled()) return
    const event = buildSessionStartedEvent({
      learnerId: input.studentId,
      sessionId: input.sessionId,
      occurredAt: input.occurredAt ?? new Date(),
    })
    await enqueueStandalonePalEvent({
      studentId: input.studentId,
      sourceKind: 'authenticated_session',
      sourceId: input.sessionId,
      event,
    })
    await attemptImmediatePalEventDelivery({ event })
  } catch (error) {
    // A Pal adapter problem must never invalidate a genuine Pika login.
    console.error('Failed to record Pal authenticated session:', error)
  }
}
