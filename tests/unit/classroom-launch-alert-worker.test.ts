import { afterEach, expect, it, vi } from 'vitest'
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

function makeDelivery(send: ReturnType<typeof vi.fn>) {
  const state = new Map()
  const setAlarm = vi.fn()
  const ctx = {
    blockConcurrencyWhile: <T>(callback: () => T) => callback(),
    storage: {
      kv: { get: state.get.bind(state), put: state.set.bind(state), delete: state.delete.bind(state) },
      setAlarm,
    },
  }
  const delivery = new ClassroomLaunchAlertDelivery(ctx, { ...alertEnv, ALERT_EMAIL: { send } })
  return { state, setAlarm, delivery }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

it('submits pending state before waiting for the alarm write to commit', async () => {
  const { state, setAlarm, delivery } = makeDelivery(vi.fn())
  const write = Promise.withResolvers<void>()
  setAlarm.mockReturnValueOnce(write.promise)

  const enqueue = delivery.enqueue('canary')
  expect(state.get('pending')).toEqual({ kind: 'canary', retryIndex: 0 })
  expect(setAlarm).toHaveBeenCalledTimes(1)

  write.resolve()
  await enqueue
})

it('retries past the platform retry window and starts cooldown after delivery', async () => {
  vi.useFakeTimers()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const now = Date.now()
  const send = vi.fn().mockRejectedValueOnce(new Error('private provider detail'))
    .mockRejectedValueOnce(new Error('still unavailable'))
    .mockResolvedValue(undefined)
  const { state, setAlarm, delivery } = makeDelivery(send)

  await delivery.enqueue('canary')
  await delivery.enqueue('canary')
  expect(setAlarm).toHaveBeenCalledExactlyOnceWith(now)
  await delivery.alarm()
  expect(setAlarm).toHaveBeenLastCalledWith(now + 60_000)
  vi.setSystemTime(now + 60_000)
  setAlarm.mockImplementationOnce(() => {
    expect(state.get('pending')).toEqual({ kind: 'canary', retryIndex: 2 })
  })
  await delivery.alarm()
  expect(setAlarm).toHaveBeenLastCalledWith(now + 6 * 60_000)
  expect(state.get('pending')).toEqual({ kind: 'canary', retryIndex: 2 })
  vi.setSystemTime(now + 6 * 60_000)
  await delivery.enqueue('canary')
  expect(setAlarm).toHaveBeenCalledTimes(3)
  await delivery.alarm()
  await delivery.enqueue('canary')
  expect(setAlarm).toHaveBeenCalledTimes(3)
  expect(state.has('pending')).toBe(false)
  expect(send).toHaveBeenCalledTimes(3)
  expect(send).toHaveBeenLastCalledWith({
    from: 'alerts@example.test',
    to: 'ops@example.test',
    subject: 'Pika launch alert test',
    text: 'Synthetic Pika launch alert. No action is needed.',
  })
  vi.setSystemTime(now + 36 * 60_000)
  await delivery.enqueue('canary')
  expect(setAlarm).toHaveBeenCalledTimes(4)
})

it('logs exhausted retries and accepts fresh reports after a prolonged outage', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const logError = vi.spyOn(console, 'error').mockImplementation(() => {})
  const send = vi.fn().mockRejectedValue(new Error('private provider detail'))
  const { setAlarm, state, delivery } = makeDelivery(send)
  await delivery.enqueue('admission')
  for (let attempt = 0; attempt < 7; attempt += 1) await delivery.alarm()
  expect(send).toHaveBeenCalledTimes(7)
  expect(setAlarm).toHaveBeenCalledTimes(7)
  expect(logError).toHaveBeenCalledExactlyOnceWith({
    event: 'pika_classroom_launch_alert_delivery_exhausted',
    kind: 'admission',
  })
  expect(state.has('pending')).toBe(false)

  await delivery.enqueue('admission')
  expect(setAlarm).toHaveBeenCalledTimes(8)
})
