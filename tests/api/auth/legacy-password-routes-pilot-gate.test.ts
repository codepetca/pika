/**
 * Security regression: the legacy email/password auth routes must be refused
 * while the WorkOS Magic Auth pilot owns credentials.
 *
 * With the pilot on, a password-issued `pika_session` already authorizes
 * nothing (`getCurrentUser` fails closed), so leaving these routes reachable
 * kept a credential-verification oracle plus account-enumeration and
 * email-amplification surface. The guard runs before request validation, so a
 * malformed body still yields 404 while the pilot is on and 400 while it is
 * off — which pins the guard's position without touching Supabase at all.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => {
    throw new Error('the legacy auth guard must run before any database access')
  }),
}))

vi.mock('@/lib/email', () => ({
  sendSignupCode: vi.fn(),
  sendPasswordResetCode: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  createSession: vi.fn(),
  isTeacherEmail: vi.fn(() => false),
}))

import { POST as login } from '@/app/api/auth/login/route'
import { POST as signup } from '@/app/api/auth/signup/route'
import { POST as createPassword } from '@/app/api/auth/create-password/route'
import { POST as forgotPassword } from '@/app/api/auth/forgot-password/route'
import { POST as verifySignup } from '@/app/api/auth/verify-signup/route'
import { POST as resetPasswordConfirm } from '@/app/api/auth/reset-password/confirm/route'
import { POST as resetPasswordVerify } from '@/app/api/auth/reset-password/verify/route'

const LEGACY_ROUTES: Array<[string, (request: NextRequest) => Promise<Response>]> = [
  ['/api/auth/login', login],
  ['/api/auth/signup', signup],
  ['/api/auth/create-password', createPassword],
  ['/api/auth/forgot-password', forgotPassword],
  ['/api/auth/verify-signup', verifySignup],
  ['/api/auth/reset-password/confirm', resetPasswordConfirm],
  ['/api/auth/reset-password/verify', resetPasswordVerify],
]

function request(path: string) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
}

describe('legacy password auth routes under the WorkOS pilot', () => {
  afterEach(() => vi.unstubAllEnvs())

  describe.each(LEGACY_ROUTES)('POST %s', (path, handler) => {
    it('is refused with an opaque 404 while the pilot is enabled', async () => {
      vi.stubEnv('WORKOS_MAGIC_AUTH_PILOT', 'true')

      const response = await handler(request(path))

      expect(response.status).toBe(404)
      await expect(response.json()).resolves.toEqual({ error: 'Not found' })
    })

    it('still serves the password flow while the pilot is disabled', async () => {
      vi.stubEnv('WORKOS_MAGIC_AUTH_PILOT', 'false')

      const response = await handler(request(path))

      expect(response.status).toBe(400)
    })
  })
})
