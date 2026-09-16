import { hasQualifyingDailyLogContent } from '@/lib/attendance'
import { isPalEnabled, isClassroomPalRequested } from '@/lib/server/pal-config'
import { buildDailyLogCompletedEvent } from '@/lib/server/pal-events'
import { attemptImmediatePalEventDelivery, type PalImmediateDeliveryStatus } from '@/lib/server/pal-outbox'
import { logServerError } from '@/lib/server/diagnostics'
import type { v1 } from '@/vendor/pal-contract'

/** Optional Pal preparation must not prevent an authorized daily-log save. */
export function prepareDailyLogPal(input: {
  learnerId: string
  activityDay: string
  occurredAt: Date
  text: string
}): { enabled: boolean; event: v1.DailyLogCompletedEvent | null } {
  try {
    if (!isPalEnabled()) return { enabled: false, event: null }
    const event = !isClassroomPalRequested() && hasQualifyingDailyLogContent(input.text)
      ? buildDailyLogCompletedEvent(input)
      : null
    return { enabled: true, event }
  } catch (error) {
    logServerError('daily_log.pal_prepare', error)
    return { enabled: false, event: null }
  }
}

/** Only call after the atomic save succeeds; never retry the academic write. */
export async function deliverDailyLogPal(
  input: Parameters<typeof attemptImmediatePalEventDelivery>[0],
): Promise<PalImmediateDeliveryStatus> {
  try {
    return await attemptImmediatePalEventDelivery(input)
  } catch (error) {
    logServerError('daily_log.pal_delivery', error)
    return 'pending'
  }
}
