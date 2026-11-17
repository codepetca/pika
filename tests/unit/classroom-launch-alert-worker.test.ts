import { expect, it, vi } from 'vitest'
import worker, { ClassroomLaunchAlertDelivery } from '../../workers/classroom-launch-alerts/worker.mjs'

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(public ctx: unknown, public env: unknown) {}
  },
}))

const token = 'a'.repeat(64)
const alertEnv = {
  PIKA_LAUNCH_ALERTS_ENABLED: 'true',
  PIKA_LAUNCH_ALERT_TOKEN: token,
  PIKA_LAUNCH_ALERT_FROM: 'alerts@example.test',
  PIKA_LAUNCH_ALERT_TO: 'ops@example.test',
}

function request(kind: string, authorization?: string) {
  return new Request('https://alerts.example.test/v1/launch-alerts/' + kind, {
    method: 'POST',
    headers: authorization ? { Authorization: 'Bearer ' + authorization } : {},
  })
}

it('only queues known events with the configured token and delivery enabled', async () => {
  const enqueue = vi.fn()
  const getByName = vi.fn(() => ({ enqueue }))
  const env = { ...alertEnv, ALERT_EMAIL: { send: vi.fn() }, DELIVERY: { getByName } }

  expect((await worker.fetch(request('admission'), env)).status).toBe(401)
  expect((await worker.fetch(request('admission', 'b'.repeat(64)), env)).status).toBe(401)
  expect((await worker.fetch(request('anything', token), env)).status).toBe(404)
  expect((await worker.fetch(request('admission', token), { ...env, PIKA_LAUNCH_ALERTS_ENABLED: 'false' })).status).toBe(503)
  expect(getByName).not.toHaveBeenCalled()
  expect((await worker.fetch(request('admission', token), env)).status).toBe(202)
  expect(getByName).toHaveBeenCalledExactlyOnceWith('admission')
  expect(enqueue).toHaveBeenCalledExactlyOnceWith('admission')
})

it('suppresses another alert during the cooldown and keeps pending work for retry', async () => {
  const state = new Map()
  const setAlarm = vi.fn()
  const send = vi.fn().mockRejectedValueOnce(new Error('private provider detail')).mockResolvedValue(undefined)
  const ctx = {
    blockConcurrencyWhile: <T>(callback: () => T) => callback(),
    storage: {
      kv: { get: state.get.bind(state), put: state.set.bind(state), delete: state.delete.bind(state) },
      setAlarm,
    },
  }
  const delivery = new ClassroomLaunchAlertDelivery(ctx, { ...alertEnv, ALERT_EMAIL: { send } })

  await delivery.enqueue('canary')
  await delivery.enqueue('canary')
  expect(setAlarm).toHaveBeenCalledTimes(1)
  await expect(delivery.alarm()).rejects.toThrow('Pika launch alert email delivery failed')
  expect(state.get('pending')).toBe('canary')
  await delivery.alarm()
  await delivery.alarm()
  expect(state.has('pending')).toBe(false)
  expect(send).toHaveBeenCalledTimes(2)
  expect(send).toHaveBeenLastCalledWith({
    from: 'alerts@example.test',
    to: 'ops@example.test',
    subject: 'Pika launch alert test',
    text: 'Synthetic Pika launch alert. No action is needed.',
  })
})
