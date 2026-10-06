import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import VerifySignupPage from '@/app/verify-signup/page'
import ResetPasswordPage from '@/app/reset-password/page'
import { AppMessageProvider, useAppMessage } from '@/ui'
import { useAuthCodeResend } from '@/hooks/useAuthCodeResend'
import type { ReactNode } from 'react'

const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => ({ get: (key: string) => key === 'email' ? 'student@example.com' : null }),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
// Model native disabled-control focus loss, which jsdom leaves on the button.
function blurDisabledControl() {
  document.body.setAttribute('tabindex', '-1')
  document.body.focus()
  document.body.removeAttribute('tabindex')
}
function wrapper({ children }: { children: ReactNode }) {
  return <AppMessageProvider>{children}</AppMessageProvider>
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  push.mockClear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const surfaces = [
  { name: 'signup', Page: VerifySignupPage, codeLabel: /verification code/i, resendLabel: /resend verification code/i, verifyLabel: /verify email/i, success: 'Verification code requested' },
  { name: 'reset', Page: ResetPasswordPage, codeLabel: /^reset code/i, resendLabel: /resend reset code/i, verifyLabel: /verify code/i, success: 'Reset code requested' },
]

for (const surface of surfaces) {
  describe(`${surface.name} resend`, () => {
    it('shows immediate pending, rejects overlap, preserves dirty drafts and retries HTTP failure', async () => {
      const pending = deferred<{ ok: boolean }>()
      const fetchMock = vi.mocked(fetch).mockReturnValueOnce(pending.promise as Promise<Response>)
      const user = userEvent.setup()
      render(<surface.Page />, { wrapper })
      const code = screen.getByLabelText(surface.codeLabel)
      const email = screen.getByLabelText(/school email/i)
      await user.clear(email)
      await user.type(email, 'draft@example.com')
      await user.type(code, 'a7')
      const resend = screen.getByRole('button', { name: surface.resendLabel })
      const verify = screen.getByRole('button', { name: surface.verifyLabel })
      act(() => {
        fireEvent.click(resend)
        fireEvent.click(resend)
        fireEvent.submit(code.closest('form')!)
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock.mock.calls[0][1]?.body).toBe(JSON.stringify({ email: 'draft@example.com' }))
      expect(screen.getByRole('button', { name: 'Sending…' })).toHaveAttribute('aria-busy', 'true')
      expect(code).toBeDisabled()
      expect(email).toBeDisabled()
      expect(verify).toBeDisabled()
      await act(async () => pending.resolve({ ok: false }))
      expect(screen.getByText('Failed to resend code. Please try again.')).toBeInTheDocument()
      expect(screen.queryByTestId('app-message-overlay')).not.toBeInTheDocument()
      expect(code).toHaveValue('A7')
      expect(email).toHaveValue('draft@example.com')
      expect(screen.getByLabelText(surface.codeLabel)).toBe(code)
      expect(resend).toBeEnabled()
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ message: 'generic acceptance' }) } as Response)
      await user.click(resend)
      expect(await screen.findByText(surface.success)).toBeInTheDocument()
      expect(screen.queryByText('Failed to resend code. Please try again.')).not.toBeInTheDocument()
      expect(code).toHaveValue('A7')
    })

    it.each([false, true])('restores keyboard activation focus after HTTP acceptance=%s', async (ok) => {
      const pending = deferred<Response>()
      vi.mocked(fetch).mockReturnValueOnce(pending.promise)
      const user = userEvent.setup()
      render(<surface.Page />, { wrapper })
      const resend = screen.getByRole('button', { name: surface.resendLabel })
      resend.focus()
      await user.keyboard('{Enter}')
      expect(resend).toBeDisabled()
      // jsdom does not implement Chromium's blur when a focused button is disabled.
      blurDisabledControl()
      expect(document.activeElement).toBe(document.body)
      const focus = vi.spyOn(resend, 'focus')
      await act(async () => pending.resolve({ ok } as Response))
      expect(resend).toBeEnabled()
      expect(resend).toHaveFocus()
      expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    })

    it('blocks resend during verification, including same-turn activation', async () => {
      const pending = deferred<Response>()
      const fetchMock = vi.mocked(fetch).mockReturnValueOnce(pending.promise)
      const user = userEvent.setup()
      render(<surface.Page />, { wrapper })
      const code = screen.getByLabelText(surface.codeLabel)
      await user.type(code, 'A7Q2F')
      const resend = screen.getByRole('button', { name: surface.resendLabel })
      act(() => {
        fireEvent.submit(code.closest('form')!)
        fireEvent.click(resend)
        fireEvent.submit(code.closest('form')!)
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(resend).toBeDisabled()
      await act(async () => pending.resolve({ ok: false, json: async () => ({ error: 'Invalid code' }) } as Response))
      expect(resend).toBeEnabled()
    })

    it('clears an old success before pending and reports network failure inline', async () => {
      const pending = deferred<Response>()
      vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response).mockReturnValueOnce(pending.promise)
      const user = userEvent.setup()
      render(<surface.Page />, { wrapper })
      const resend = screen.getByRole('button', { name: surface.resendLabel })
      await user.click(resend)
      expect(await screen.findByText(surface.success)).toBeInTheDocument()
      await user.click(resend)
      expect(screen.queryByTestId('app-message-overlay')).not.toBeInTheDocument()
      await act(async () => pending.reject(new Error('private network details')))
      expect(screen.getByText('Failed to resend code. Please try again.')).toBeInTheDocument()
      expect(screen.queryByText('private network details')).not.toBeInTheDocument()
    })
  })
}

it('keeps Back to login immediate while reset resend is pending', async () => {
  vi.mocked(fetch).mockReturnValueOnce(deferred<Response>().promise)
  const user = userEvent.setup()
  render(<ResetPasswordPage />, { wrapper })
  await user.click(screen.getByRole('button', { name: /resend reset code/i }))
  await user.click(screen.getByRole('button', { name: /back to login/i }))
  expect(push).toHaveBeenCalledWith('/login')
})

it.each(['unmount', 'email change'] as const)('suppresses obsolete success after %s', async (change) => {
  const pending = deferred<Response>()
  vi.mocked(fetch).mockReturnValueOnce(pending.promise)
  const { result, unmount, rerender } = renderHook(
    ({ email }) => useAuthCodeResend({ kind: 'reset', email, isBlocked: () => false, onStart: () => {} }),
    { initialProps: { email: 'old@example.com' }, wrapper },
  )
  act(() => { void result.current.resend() })
  if (change === 'unmount') unmount()
  else rerender({ email: 'new@example.com' })
  await act(async () => pending.resolve({ ok: true } as Response))
  expect(screen.queryByTestId('app-message-overlay')).not.toBeInTheDocument()
  if (change === 'email change') expect(result.current.pending).toBe(false)
})

function Resender({ email = 'old@example.com' }: { email?: string }) {
  const resend = useAuthCodeResend({ kind: 'signup', email, isBlocked: () => false, onStart: () => {} })
  return <button disabled={resend.pending} onClick={resend.resend}>Request code</button>
}
function OtherMessage() {
  const { showMessage } = useAppMessage()
  return <button onClick={() => showMessage({ text: 'Another owner', tone: 'info' })}>Other notice</button>
}

it('suppresses an unmounted request while its AppMessage provider remains mounted', async () => {
  const pending = deferred<Response>()
  vi.mocked(fetch).mockReturnValueOnce(pending.promise)
  const { rerender } = render(<AppMessageProvider><Resender /></AppMessageProvider>)
  await userEvent.setup().click(screen.getByRole('button', { name: 'Request code' }))
  rerender(<AppMessageProvider><OtherMessage /></AppMessageProvider>)
  await act(async () => pending.resolve({ ok: true } as Response))
  expect(screen.queryByTestId('app-message-overlay')).not.toBeInTheDocument()
})

it('clears its success on unmount without clearing a newer owner message', async () => {
  vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response)
  const user = userEvent.setup()
  const { rerender } = render(<AppMessageProvider><Resender /><OtherMessage /></AppMessageProvider>)
  await user.click(screen.getByRole('button', { name: 'Request code' }))
  await waitFor(() => expect(screen.getByText('Verification code requested')).toBeInTheDocument())
  await user.click(screen.getByRole('button', { name: 'Other notice' }))
  rerender(<AppMessageProvider><OtherMessage /></AppMessageProvider>)
  expect(screen.getByText('Another owner')).toBeInTheDocument()
})

it.each(['Tab', 'other focus', 'blank pointer'] as const)('does not reclaim focus after deliberate %s during pending', async (intent) => {
  const pending = deferred<Response>()
  vi.mocked(fetch).mockReturnValueOnce(pending.promise)
  const user = userEvent.setup()
  render(<ResetPasswordPage />, { wrapper })
  const resend = screen.getByRole('button', { name: /resend reset code/i })
  const back = screen.getByRole('button', { name: /back to login/i })
  resend.focus()
  await user.keyboard('{Enter}')
  blurDisabledControl()
  if (intent === 'Tab') {
    await user.tab()
    expect(back).toHaveFocus()
  } else if (intent === 'other focus') {
    back.focus()
    back.blur()
  } else {
    await user.click(screen.getByRole('heading', { name: 'Reset Password' }))
  }
  const focus = vi.spyOn(resend, 'focus')
  await act(async () => pending.resolve({ ok: false } as Response))
  expect(focus).not.toHaveBeenCalled()
  expect(resend).not.toHaveFocus()
  if (intent === 'Tab') expect(back).toHaveFocus()
})

it('does not autofocus when resend was requested without a focused activation owner', async () => {
  const pending = deferred<Response>()
  vi.mocked(fetch).mockReturnValueOnce(pending.promise)
  render(<VerifySignupPage />, { wrapper })
  const resend = screen.getByRole('button', { name: /resend verification code/i })
  fireEvent.click(resend)
  await act(async () => pending.resolve({ ok: true } as Response))
  expect(resend).not.toHaveFocus()
})

it('removes pending focus tracking on unmount and never focuses the obsolete opener', async () => {
  const pending = deferred<Response>()
  vi.mocked(fetch).mockReturnValueOnce(pending.promise)
  const user = userEvent.setup()
  const { rerender } = render(<AppMessageProvider><ResetPasswordPage /></AppMessageProvider>)
  const resend = screen.getByRole('button', { name: /resend reset code/i })
  resend.focus()
  await user.keyboard('{Enter}')
  blurDisabledControl()
  const focus = vi.spyOn(resend, 'focus')
  const removeListener = vi.spyOn(document, 'removeEventListener')
  rerender(<AppMessageProvider><OtherMessage /></AppMessageProvider>)
  expect(removeListener).toHaveBeenCalledWith('pointerdown', expect.any(Function), true)
  expect(removeListener).toHaveBeenCalledWith('keydown', expect.any(Function), true)
  expect(removeListener).toHaveBeenCalledWith('focusin', expect.any(Function), true)
  await act(async () => pending.resolve({ ok: true } as Response))
  expect(focus).not.toHaveBeenCalled()
  removeListener.mockRestore()
})

it('discards focus ownership when the email request owner changes', async () => {
  const pending = deferred<Response>()
  vi.mocked(fetch).mockReturnValueOnce(pending.promise)
  const user = userEvent.setup()
  const { rerender } = render(<AppMessageProvider><Resender email="old@example.com" /></AppMessageProvider>)
  const resend = screen.getByRole('button', { name: 'Request code' })
  resend.focus()
  await user.keyboard('{Enter}')
  blurDisabledControl()
  const focus = vi.spyOn(resend, 'focus')
  rerender(<AppMessageProvider><Resender email="new@example.com" /></AppMessageProvider>)
  await act(async () => pending.resolve({ ok: true } as Response))
  expect(focus).not.toHaveBeenCalled()
  expect(screen.queryByTestId('app-message-overlay')).not.toBeInTheDocument()
})
