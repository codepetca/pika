import { DurableObject } from 'cloudflare:workers'
import { sendBrevoEmail } from '../../src/lib/brevo.ts'
import {
  alertConditions, cadence, checkRecoveryAlerts, lanes, missedRecoveryWindow, nextAlertState,
  recordAlertDelivery, recoveryAlertWindow, recoveryErrorStart, recoveryWorker,
} from './checks.mjs'

const expectedHeartbeat = {
  paid: 'BILLING_ALERT_EXPECT_PAID_HEARTBEAT',
  trial: 'BILLING_ALERT_EXPECT_TRIAL_HEARTBEAT',
}

function emailText({ result, window, conditions }) {
  const lines = [`Production Pika billing recovery through ${new Date(window.end).toISOString()}.`]
  if (conditions.includes('delivery_unconfirmed')) {
    lines.push('Delivery of at least one earlier recovery alert could not be confirmed. Review the recovery Worker and alert Worker logs for the affected window.')
  }
  if (conditions.includes('analytics_unavailable')) lines.push('Cloudflare could not read the recovery logs. Worker and heartbeat status are unknown.')
  if (conditions.includes('monitoring_gap')) {
    lines.push('The observer missed an earlier window. It checked the latest heartbeats and searched missed error logs within its one-hour lookback.')
  }
  if (conditions.includes('recovery_errors')) {
    lines.push(`Cloudflare recorded ${result.errorCount} recovery errors since ${new Date(window.errorStart).toISOString()}.`)
  }
  for (const lane of lanes) {
    if (conditions.includes(`missing_${lane}`)) lines.push(`No ${lane} recovery receipt appeared in the latest ten-minute window.`)
  }
  return lines.join('\n')
}

export class RecoveryAlertDelivery extends DurableObject {
  sending = false

  observationProgress() {
    const state = this.ctx.storage.kv.get('state')
    return { observedThrough: state?.observedThrough ?? null, latestEnd: state?.latestEnd ?? null }
  }

  async deliver(window, result) {
    if (this.sending) return 'busy'
    this.sending = true
    try {
      const storage = this.ctx.storage.kv
      const { state, accepted, expired } = nextAlertState(
        storage.get('state'), window, result, Date.now(), crypto.randomUUID(),
      )
      storage.put('state', state)
      for (const alert of expired) {
        console.error({ event: 'pika_billing_recovery_alert_delivery_expired', windowEnd: alert.window.end, conditions: alert.conditions })
      }
      if (!state.pending.length) return accepted ? 'quiet' : 'duplicate'
      while (state.pending.length) {
        const alert = state.pending[0]
        try {
          await sendBrevoEmail({
            to: this.env.BILLING_ALERT_TO,
            subject: 'Pika production billing recovery alert',
            textContent: emailText(alert),
            tags: ['pika-recovery-alert'],
            manualRedirect: true,
            idempotencyKey: alert.id,
            signal: AbortSignal.timeout(10_000),
          })
        } catch {
          throw new Error('Pika recovery alert email delivery failed')
        }
        recordAlertDelivery(state)
        storage.put('state', state)
      }
      return 'sent'
    } finally {
      this.sending = false
    }
  }
}

export default {
  async scheduled(controller, env) {
    if (env.BILLING_ALERTS_ENABLED === 'false') return
    if (env.BILLING_ALERTS_ENABLED !== 'true' || controller.cron !== cadence || !Number.isSafeInteger(controller.scheduledTime)
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.BILLING_ALERT_TO ?? '') || !env.BREVO_API_KEY) {
      throw new Error('Invalid Pika recovery alert configuration')
    }
    const expected = lanes.filter(lane => {
      const value = env[expectedHeartbeat[lane]]
      if (value !== 'true' && value !== 'false') throw new Error('Invalid Pika recovery heartbeat configuration')
      return value === 'true'
    })
    const delivery = env.DELIVERY.getByName(recoveryWorker)
    const window = recoveryAlertWindow(controller.scheduledTime)
    const progress = await delivery.observationProgress()
    const { observedThrough } = progress
    if (observedThrough !== null && observedThrough >= window.end) {
      await delivery.deliver(window, null)
      return
    }
    window.errorStart = recoveryErrorStart(window, observedThrough)
    let result
    try {
      result = await checkRecoveryAlerts(env.ANALYTICS, window, expected)
      result.coverageGap = missedRecoveryWindow(window, progress)
    } catch {
      result = { queryFailed: true }
    }
    const outcome = await delivery.deliver(window, result)
    console.info({ event: 'pika_billing_recovery_alert', windowEnd: window.end, conditions: alertConditions(result), delivery: outcome })
  },
}
