/**
 * The legacy password pages must not render a form that cannot be submitted.
 *
 * While the WorkOS pilot owns credentials, the API routes behind these screens
 * refuse the request, so a rendered form is a dead end. Each page redirects to
 * the sign-in that actually works instead. With the pilot off, they render the
 * password flow unchanged.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: (url: string) => mocks.redirect(url),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

import CreatePasswordPage from '@/app/create-password/page'
import VerifySignupPage from '@/app/verify-signup/page'
import ForgotPasswordPage from '@/app/forgot-password/page'
import ResetPasswordPage from '@/app/reset-password/page'

const LEGACY_PAGES: Array<[string, () => unknown]> = [
  ['/create-password', CreatePasswordPage],
  ['/verify-signup', VerifySignupPage],
  ['/forgot-password', ForgotPasswordPage],
  ['/reset-password', ResetPasswordPage],
]

describe('legacy password pages under the WorkOS pilot', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.unstubAllEnvs())

  describe.each(LEGACY_PAGES)('%s', (_path, Page) => {
    it('redirects to /login while the pilot is enabled', () => {
      vi.stubEnv('WORKOS_MAGIC_AUTH_PILOT', 'true')

      Page()

      expect(mocks.redirect).toHaveBeenCalledWith('/login')
    })

    it('renders the password flow while the pilot is disabled', () => {
      vi.stubEnv('WORKOS_MAGIC_AUTH_PILOT', 'false')

      const rendered = Page()

      expect(mocks.redirect).not.toHaveBeenCalled()
      expect(rendered).toBeTruthy()
    })
  })
})
