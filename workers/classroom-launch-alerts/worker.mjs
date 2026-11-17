import { DurableObject } from 'cloudflare:workers'
import { timingSafeEqual } from 'node:crypto'
import { classroomLaunchAlerts } from '../../src/lib/contracts/classroom-launch-alerts.ts'

const prefix = '/v1/launch-alerts/'
const cooldownMs = 30 * 60 * 1000
const retryDelaysMs = [1, 5, 15, 30, 60, 120].map((minutes) => minutes * 60_000)
const tokenPattern = /^[a-f0-9]{64}$/
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const encoder = new TextEncoder()

function deliveryEnabled(env) {
  return env.PIKA_LAUNCH_ALERTS_ENABLED === 'true' && env.ALERT_EMAIL
    && emailPattern.test(env.PIKA_LAUNCH_ALERT_FROM ?? '')
    && emailPattern.test(env.PIKA_LAUNCH_ALERT_TO ?? '')
}

export class ClassroomLaunchAlertDelivery extends DurableObject {
  enqueue(kind) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const storage = this.ctx.storage
      const now = Date.now()
      if (storage.kv.get('pending') || (storage.kv.get('suppressUntil') ?? 0) > now) return
      await storage.setAlarm(now)
      storage.kv.put('pending', { kind, retryIndex: 0 })
    })
  }

  async alarm() {
    const storage = this.ctx.storage
    const pending = storage.kv.get('pending')
    if (!pending) return
    const { kind, retryIndex } = pending
    if (!Object.hasOwn(classroomLaunchAlerts, kind) || !deliveryEnabled(this.env)) {
      storage.kv.delete('pending')
      return
    }
    try {
      await this.env.ALERT_EMAIL.send({
        from: this.env.PIKA_LAUNCH_ALERT_FROM,
        to: this.env.PIKA_LAUNCH_ALERT_TO,
        subject: kind === 'canary' ? 'Pika launch alert test' : 'Pika production launch alert',
        text: classroomLaunchAlerts[kind],
      })
    } catch {
      const delay = retryDelaysMs[retryIndex]
      if (delay === undefined) {
        storage.kv.delete('pending')
        console.error({ event: 'pika_classroom_launch_alert_delivery_exhausted', kind })
        return
      }
      await storage.setAlarm(Date.now() + delay)
      storage.kv.put('pending', { kind, retryIndex: retryIndex + 1 })
      console.warn({ event: 'pika_classroom_launch_alert_retry', kind })
      return
    }
    storage.kv.put('suppressUntil', Date.now() + cooldownMs)
    storage.kv.delete('pending')
    console.info({ event: 'pika_classroom_launch_alert_sent', kind })
  }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url)
    const kind = pathname.slice(prefix.length)
    if (request.method !== 'POST' || !pathname.startsWith(prefix)
      || !Object.hasOwn(classroomLaunchAlerts, kind)) return new Response(null, { status: 404 })
    const token = request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1]
    const expected = env.PIKA_LAUNCH_ALERT_TOKEN
    if (!token || !tokenPattern.test(expected ?? '')
      || !timingSafeEqual(encoder.encode(token), encoder.encode(expected))) {
      return new Response(null, { status: 401 })
    }
    if (!deliveryEnabled(env)) return new Response(null, { status: 503 })
    await env.DELIVERY.getByName(kind).enqueue(kind)
    return new Response(null, { status: 202 })
  },
}
