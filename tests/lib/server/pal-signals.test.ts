import { afterEach, describe, expect, it, vi } from 'vitest'

const { mockEnqueueStandalonePalEvent } = vi.hoisted(() => ({
  mockEnqueueStandalonePalEvent: vi.fn(),
}))

vi.mock('@/lib/server/pal-outbox', () => ({
  enqueueStandalonePalEvent: mockEnqueueStandalonePalEvent,
}))

import { recordPalAuthenticatedSession } from '@/lib/server/pal-signals'

describe('Pal session signal', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it('does nothing while the pilot is disabled', async () => {
    vi.stubEnv('PAL_ENABLED', 'false')

    await recordPalAuthenticatedSession({
      studentId: 'student-1',
      sessionId: 'session-1',
    })

    expect(mockEnqueueStandalonePalEvent).not.toHaveBeenCalled()
  })

  it('records one privacy-safe fact for an authenticated learner session', async () => {
    vi.stubEnv('PAL_ENABLED', 'true')
    vi.stubEnv('PAL_API_URL', 'https://pal.example.test')
    vi.stubEnv('PAL_INTEGRATION_SECRET', 'integration-secret')
    vi.stubEnv('PAL_PSEUDONYM_SECRET', 'pseudonym-secret')
    mockEnqueueStandalonePalEvent.mockResolvedValue('enqueued')

    await recordPalAuthenticatedSession({
      studentId: 'student-1',
      sessionId: 'session-1',
      occurredAt: new Date('2026-09-16T18:20:00.000Z'),
    })

    expect(mockEnqueueStandalonePalEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        studentId: 'student-1',
        sourceKind: 'authenticated_session',
        sourceId: 'session-1',
        event: expect.objectContaining({
          event_type: 'platform.session.started',
        }),
      }),
    )
  })

  it('never blocks login when the adapter cannot record the session', async () => {
    vi.stubEnv('PAL_ENABLED', 'true')
    vi.stubEnv('PAL_API_URL', 'https://pal.example.test')
    vi.stubEnv('PAL_INTEGRATION_SECRET', 'integration-secret')
    vi.stubEnv('PAL_PSEUDONYM_SECRET', 'pseudonym-secret')
    mockEnqueueStandalonePalEvent.mockRejectedValue(new Error('outbox unavailable'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(recordPalAuthenticatedSession({
      studentId: 'student-1',
      sessionId: 'session-1',
    })).resolves.toBeUndefined()
    expect(consoleError).toHaveBeenCalled()
  })
})
