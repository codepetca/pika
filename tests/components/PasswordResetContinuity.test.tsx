import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ForgotPasswordPage from '@/app/forgot-password/page'
import ResetPasswordPage from '@/app/reset-password/page'
import { AppMessageProvider } from '@/ui'

const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => ({ get: (key: string) => key === 'email' ? 'reset@example.invalid' : null }),
}))
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
const response = (ok: boolean, data: object) => ({ ok, json: async () => data }) as Response
beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); push.mockClear() })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })
async function submitForgot() {
  fireEvent.change(screen.getByLabelText(/school email/i), { target: { value: 'reset@example.invalid' } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send Reset Code' })))
}

describe('forgot password owner continuation', () => {
  it('retains eligible failed email activation through the renamed auth owner', async () => {
    const held = deferred<Response>()
    vi.mocked(fetch).mockReturnValue(held.promise)
    render(<ForgotPasswordPage />)
    const email = screen.getByLabelText(/school email/i) as HTMLInputElement
    fireEvent.change(email, { target: { value: 'reset@example.invalid' } })
    email.focus()
    fireEvent.submit(email.closest('form')!)
    expect(email).toBeDisabled()
    document.body.setAttribute('tabindex', '-1'); document.body.focus(); document.body.removeAttribute('tabindex')
    await act(async () => held.resolve(response(false, { error: 'Controlled unavailable request' })))
    expect(email).toHaveFocus()
    expect(email).toHaveValue('reset@example.invalid')
    expect(screen.getByRole('alert')).toHaveTextContent('Controlled unavailable request')
    expect(screen.getByRole('button', { name: 'Send Reset Code' })).not.toBeDisabled()
  })

  it('announces generic acceptance and retains the actual two-second continuation', async () => {
    vi.useFakeTimers()
    vi.mocked(fetch).mockResolvedValue(response(true, { success: true }))
    render(<ForgotPasswordPage />)
    await submitForgot()
    expect(screen.getByRole('status')).toHaveTextContent('If an account exists with this email')
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
    act(() => vi.advanceTimersByTime(1999))
    expect(push).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(push).toHaveBeenCalledWith('/reset-password?email=reset%40example.invalid')
  })

  it('Back to login retires an acknowledged owner before its old continuation can override navigation', async () => {
    vi.useFakeTimers()
    vi.mocked(fetch).mockResolvedValue(response(true, { success: true }))
    render(<ForgotPasswordPage />)
    await submitForgot()
    fireEvent.click(screen.getByRole('button', { name: 'Back to login' }))
    expect(push).toHaveBeenCalledExactlyOnceWith('/login')
    act(() => vi.advanceTimersByTime(3000))
    expect(push).toHaveBeenCalledTimes(1)
  })

  it('unmount while a request is held suppresses late acceptance and continuation', async () => {
    vi.useFakeTimers()
    const held = deferred<Response>()
    vi.mocked(fetch).mockReturnValue(held.promise)
    const { unmount } = render(<ForgotPasswordPage />)
    await submitForgot()
    expect(screen.getByRole('button', { name: 'Sending...' })).toBeDisabled()
    unmount()
    await act(async () => held.resolve(response(true, { success: true })))
    act(() => vi.advanceTimersByTime(3000))
    expect(push).not.toHaveBeenCalled()
  })

  it('Back to login during a held request suppresses late acceptance even before an unmount', async () => {
    vi.useFakeTimers()
    const held = deferred<Response>()
    vi.mocked(fetch).mockReturnValue(held.promise)
    render(<ForgotPasswordPage />)
    await submitForgot()
    fireEvent.click(screen.getByRole('button', { name: 'Back to login' }))
    await act(async () => held.resolve(response(true, { success: true })))
    act(() => vi.advanceTimersByTime(3000))
    expect(push).toHaveBeenCalledExactlyOnceWith('/login')
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('reset native owner recovery', () => {
  it('preserves middle insertion through the shared auth-code export rename', async () => {
    const user = userEvent.setup()
    render(<AppMessageProvider><ResetPasswordPage /></AppMessageProvider>)
    const code = screen.getByLabelText(/^reset code/i) as HTMLInputElement
    await user.type(code, 'A7QF')
    code.setSelectionRange(2, 2)
    await user.keyboard('b')
    expect(code).toHaveValue('A7BQF')
    expect(code.selectionStart).toBe(3)
  })

  it('releases a code-input Enter activation on successful step change even when React reuses the node', async () => {
    const held = deferred<Response>()
    vi.mocked(fetch).mockReturnValue(held.promise)
    const user = userEvent.setup()
    render(<AppMessageProvider><ResetPasswordPage /></AppMessageProvider>)
    const code = screen.getByLabelText(/^reset code/i)
    await user.type(code, 'ABCDE')
    await user.keyboard('{Enter}')
    expect(code).toBeDisabled()
    document.body.setAttribute('tabindex', '-1')
    document.body.focus()
    document.body.removeAttribute('tabindex')
    await act(async () => held.resolve(response(true, { handoffToken: 'synthetic-reset-token-0000000000000000000000' })))
    const confirmation = screen.getByLabelText(/^confirm password/i)
    expect(confirmation).toBe(code)
    expect(confirmation).not.toHaveFocus()
    expect(document.body).toHaveFocus()
    expect(screen.getByLabelText(/^new password/i)).not.toBeDisabled()
  })

  it('keeps code node/value after401 and malformed response, then carries the token into password retry', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(response(false, { error: 'Invalid email or code' }))
      .mockResolvedValueOnce({ ok: true, json: async () => { throw new SyntaxError('Controlled malformed JSON') } } as Response)
      .mockResolvedValueOnce(response(true, { handoffToken: 'synthetic-reset-token-0000000000000000000000' }))
      .mockResolvedValueOnce(response(false, { error: 'Failed to reset password' }))
      .mockResolvedValueOnce(response(true, { redirectUrl: '/classrooms' }))
    render(<AppMessageProvider><ResetPasswordPage /></AppMessageProvider>)
    const code = screen.getByLabelText(/^reset code/i)
    fireEvent.change(code, { target: { value: 'abcde' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Verify Code' })))
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid email or code')
    expect(screen.getByLabelText(/^reset code/i)).toBe(code)
    expect(code).toHaveValue('ABCDE')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Verify Code' })))
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to read the response. Please try again.')
    expect(code).toHaveValue('ABCDE')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Verify Code' })))
    const password = screen.getByLabelText(/^new password/i)
    const confirmation = screen.getByLabelText(/^confirm password/i)
    fireEvent.change(password, { target: { value: 'SyntheticReset123!' } })
    fireEvent.change(confirmation, { target: { value: 'SyntheticReset123!' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Reset Password' })))
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to reset password')
    expect(screen.getByLabelText(/^new password/i)).toBe(password)
    expect(screen.getByLabelText(/^confirm password/i)).toBe(confirmation)
    expect(password).toHaveValue('SyntheticReset123!')
    expect(confirmation).toHaveValue('SyntheticReset123!')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Reset Password' })))
    expect(push).toHaveBeenCalledExactlyOnceWith('/classrooms')
    expect(JSON.parse(vi.mocked(fetch).mock.calls[4][1]!.body as string)).toEqual({ email: 'reset@example.invalid', password: 'SyntheticReset123!', passwordConfirmation: 'SyntheticReset123!', handoffToken: 'synthetic-reset-token-0000000000000000000000' })
  })
})
