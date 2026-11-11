import { DurableObject } from 'cloudflare:workers'
import { sendBrevoEmail } from '../../src/lib/brevo.ts'
import { alertConditions, cadence, checkRecoveryAlerts, lanes, nextAlertState, recoveryAlertWindow, recoveryWorker } from './checks.mjs'

const expectedHeartbeat = {
  paid: 'BILLING_ALERT_EXPECT_PAID_HEARTBEAT',
  trial: 'BILLING_ALERT_EXPECT_TRIAL_HEARTBEAT',
}

function emailText(result, window, due) {
  const lines = [`Production Pika billing recovery, ${new Date(window.start).toISOString()} to ${new Date(window.end).toISOString()}.`]
  if (due.includes('analytics_unavailable')) lines.push('Cloudflare could not read the recovery logs. Worker and heartbeat status are unknown.')
  if (due.includes('recovery_errors')) lines.push(`Cloudflare recorded ${result.errorCount} recovery error logs or failed invocation records.`)
  for (const lane of lanes) {
    if (due.includes(`missing_${lane}`)) lines.push(`No ${lane} recovery receipt appeared in the monitoring window.`)
  }
  return lines.join('\n')
}

export class RecoveryAlertDelivery extends DurableObject {
  async deliver(window, result) {
    const storage = this.ctx.storage.kv
    const next = nextAlertState(storage.get('state'), window.end, alertConditions(result))
    if (!next) return 'duplicate'
    // Reserve this window before sending so a repeated cron delivery cannot resend it.
    storage.put('state', next.state)
    if (!next.due.length) return 'quiet'
    try {
      await sendBrevoEmail({
        to: this.env.BILLING_ALERT_TO,
        subject: 'Pika production billing recovery alert',
        textContent: emailText(result, window, next.due),
        tags: ['pika-recovery-alert'],
        manualRedirect: true,
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      throw new Error('Pika recovery alert email delivery failed')
    }
    if (storage.get('state')?.end === window.end) {
      for (const condition of next.due) next.state.notified[condition] = window.end
      storage.put('state', next.state)
    }
    return 'sent'
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
    const window = recoveryAlertWindow(controller.scheduledTime)
    let result
    try {
      result = await checkRecoveryAlerts(env.ANALYTICS, window, expected)
    } catch {
      result = { queryFailed: true }
    }
    const delivery = await env.DELIVERY.getByName(recoveryWorker).deliver(window, result)
    console.info({ event: 'pika_billing_recovery_alert', windowEnd: window.end, conditions: alertConditions(result), delivery })
  },
}
