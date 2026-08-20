import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  destroy: vi.fn(),
  session: {} as { challenge?: unknown },
  cookieStore: new Map(),
}))

vi.mock('iron-session', () => ({
  getIronSession: vi.fn(async () => ({
    get challenge() { return mocks.session.challenge },
    set challenge(value) { mocks.session.challenge = value },
    save: mocks.save,
    destroy: mocks.destroy,
  })),
}))
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => mocks.cookieStore) }))

import { getIronSession } from 'iron-session'
import {
  clearPendingWorkOSMagicAuth,
  hasActivePendingWorkOSMagicAuth,
  readPendingWorkOSMagicAuth,
  savePendingWorkOSMagicAuth,
} from '@/lib/server/workos-magic-pending'

describe('pending WorkOS Magic Auth challenge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.session = {}
  })

  it('stores the challenge in a short-lived, HTTP-only cookie', async () => {
    const challenge = {
      email: 'student@example.com',
      expiresAt: '2026-08-16T18:00:00.000Z',
      intent: 'sign-in' as const,
      nextPath: '/classrooms',
    }

    await savePendingWorkOSMagicAuth(challenge)

    expect(mocks.session.challenge).toEqual(challenge)
    expect(mocks.save).toHaveBeenCalledOnce()
    expect(getIronSession).toHaveBeenCalledWith(mocks.cookieStore, expect.objectContaining({
      cookieName: 'pika_workos_magic',
      cookieOptions: expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 10 * 60,
      }),
    }))
  })

  it('reads and clears the challenge without exposing another store', async () => {
    mocks.session.challenge = {
      email: 'student@example.com',
      expiresAt: '2026-08-16T18:00:00.000Z',
      intent: 'sign-in',
      nextPath: '/classrooms',
    }

    await expect(readPendingWorkOSMagicAuth()).resolves.toEqual(mocks.session.challenge)
    await clearPendingWorkOSMagicAuth()
    expect(mocks.destroy).toHaveBeenCalledOnce()
  })

  it('restores only an unexpired challenge for the matching intent', async () => {
    const now = Date.now()
    mocks.session.challenge = {
      email: 'student@example.com',
      expiresAt: new Date(now + 60_000).toISOString(),
      intent: 'sign-in',
      nextPath: '/classrooms',
    }

    await expect(hasActivePendingWorkOSMagicAuth('sign-in', now)).resolves.toBe(true)
    await expect(hasActivePendingWorkOSMagicAuth('sign-up', now)).resolves.toBe(false)

    mocks.session.challenge = {
      ...mocks.session.challenge as object,
      expiresAt: new Date(now - 1).toISOString(),
    }
    await expect(hasActivePendingWorkOSMagicAuth('sign-in', now)).resolves.toBe(false)
  })
})
