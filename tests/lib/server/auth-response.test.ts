import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  sendPasswordResetCode: vi.fn(),
  sendSignupCode: vi.fn(),
}))

vi.mock('next/server', () => ({ after: mocks.after }))
vi.mock('@/lib/email', () => ({
  sendPasswordResetCode: mocks.sendPasswordResetCode,
  sendSignupCode: mocks.sendSignupCode,
}))

import {
  completeAuthResponseFloor,
  schedulePasswordResetCode,
  scheduleSignupCode,
} from '@/lib/server/auth-response'

describe('authentication response parity', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('holds fast account-state paths to the common response floor', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-01T12:00:00.000Z'))
    const completion = completeAuthResponseFloor(Date.now())
    let finished = false
    void completion.then(() => { finished = true })

    await vi.advanceTimersByTimeAsync(349)
    expect(finished).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await completion
    expect(finished).toBe(true)
  })

  it('moves eligible email delivery behind the response boundary', async () => {
    let pending: Promise<void> | undefined
    mocks.after.mockImplementation((callback: () => Promise<void>) => {
      pending = callback()
    })
    mocks.sendSignupCode.mockResolvedValue(undefined)
    mocks.sendPasswordResetCode.mockResolvedValue(undefined)

    scheduleSignupCode('student@example.com', 'ABC12')
    schedulePasswordResetCode('student@example.com', 'XYZ99')
    await pending

    expect(mocks.after).toHaveBeenCalledTimes(2)
    expect(mocks.sendSignupCode).toHaveBeenCalledWith('student@example.com', 'ABC12')
    expect(mocks.sendPasswordResetCode).toHaveBeenCalledWith('student@example.com', 'XYZ99')
  })

  it('contains provider failures after the response without exposing details', async () => {
    let pending: Promise<void> | undefined
    mocks.after.mockImplementation((callback: () => Promise<void>) => {
      pending = callback()
    })
    mocks.sendSignupCode.mockRejectedValue(new Error('provider detail'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => scheduleSignupCode('student@example.com', 'ABC12')).not.toThrow()
    await pending
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to deliver signup verification code:',
      expect.any(Error),
    )
  })
})
