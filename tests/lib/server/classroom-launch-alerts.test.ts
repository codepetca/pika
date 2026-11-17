import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { scheduleClassroomLaunchAlert } from '@/lib/server/classroom-launch-alerts'

const { after, log } = vi.hoisted(() => ({ after: vi.fn(), log: vi.fn() }))
vi.mock('next/server', () => ({ after }))
vi.mock('@/lib/server/diagnostics', () => ({ logServerError: log }))

const token = 'a'.repeat(64)

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv('VERCEL_ENV', 'production')
  vi.stubEnv('PIKA_LAUNCH_ALERT_ORIGIN', 'https://alerts.example.test')
  vi.stubEnv('PIKA_LAUNCH_ALERT_TOKEN', token)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

it('reports only the failure kind after the response', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 202 }))
  vi.stubGlobal('fetch', fetch)
  scheduleClassroomLaunchAlert('signup-email')

  expect(log).toHaveBeenCalledExactlyOnceWith('classroom.launch.signup_email')
  expect(fetch).not.toHaveBeenCalled()
  await after.mock.calls[0][0]()
  expect(fetch).toHaveBeenCalledExactlyOnceWith(new URL('https://alerts.example.test/v1/launch-alerts/signup-email'), {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    redirect: 'error',
    signal: expect.any(AbortSignal),
  })
})

it.each([
  ['VERCEL_ENV', 'preview'],
  ['PIKA_LAUNCH_ALERT_ORIGIN', 'https://user:pass@alerts.example.test'],
  ['PIKA_LAUNCH_ALERT_TOKEN', ''],
])('does not enqueue an outbound request when %s is unsuitable', (name, value) => {
  vi.stubEnv(name, value)
  scheduleClassroomLaunchAlert('admission')
  expect(after).not.toHaveBeenCalled()
})

it('records a failed delivery without logging the response or its credentials', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('sensitive provider response', { status: 503 })))
  scheduleClassroomLaunchAlert('admission')
  await after.mock.calls[0][0]()
  expect(log.mock.calls).toEqual([
    ['classroom.launch.admission'],
    ['classroom.launch.alert_delivery'],
  ])
})
