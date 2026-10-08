import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LoginClient } from '@/app/login/LoginClient'
import { SignupClient } from '@/app/signup/SignupClient'
import VerifySignup from '@/app/verify-signup/page'
import CreatePassword from '@/app/create-password/page'
import ForgotPassword from '@/app/forgot-password/page'
import ResetPassword from '@/app/reset-password/page'
import { AppMessageProvider } from '@/ui'

const { push, navigate } = vi.hoisted(() => ({ push: vi.fn(), navigate: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), useSearchParams: () => ({ get: (key: string) => key === 'email' ? 'copy@example.invalid' : null }) }))
vi.mock('@/lib/client-navigation', () => ({ navigateTo: navigate }))
const stages = ['login', 'signup', 'verify', 'create', 'forgot', 'reset-verify', 'reset-confirm'] as const
type Stage = typeof stages[number]
const response = (ok: boolean, data: object) => ({ ok, json: async () => data }) as Response
const malformed = () => ({ ok: false, json: async () => { throw new SyntaxError('Unexpected token < in JSON') } }) as Response
const success = () => response(true, { handoffToken: 'synthetic-token', redirectUrl: '/classrooms', success: true })
beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); push.mockClear(); navigate.mockClear(); sessionStorage.clear() })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })
async function mount(stage: Stage) {
  const view = render(<AppMessageProvider>{stage === 'login' ? <LoginClient /> : stage === 'signup' ? <SignupClient /> : stage === 'verify' ? <VerifySignup /> : stage === 'create' ? <CreatePassword /> : stage === 'forgot' ? <ForgotPassword /> : <ResetPassword />}</AppMessageProvider>)
  if (stage === 'reset-confirm') {
    vi.mocked(fetch).mockResolvedValueOnce(success())
    fireEvent.change(screen.getByLabelText(/^Reset Code/), { target: { value: 'A7Q2F' } })
    await act(async () => fireEvent.submit(screen.getByLabelText(/^Reset Code/).closest('form')!))
  }
  for (const input of view.container.querySelectorAll('input')) {
    const value = input.type === 'email' ? 'copy@example.invalid' : input.type === 'password' ? 'SyntheticCopy123!' : 'A7Q2F'
    fireEvent.change(input, { target: { value } })
  }
  const form = view.container.querySelector('form')!
  const button = form.querySelector('button[type="submit"]')!
  const inputs = [...form.querySelectorAll('input')]
  return { ...view, form, button, inputs, values: inputs.map(input => input.value) }
}
describe('classic anonymous auth submit failure copy', () => {
  it.each(stages)('%s preserves validation, normalizes parse/transport failures and succeeds on retry', async stage => {
    vi.useFakeTimers()
    const { form, button, inputs, values } = await mount(stage)
    vi.mocked(fetch).mockResolvedValueOnce(response(false, { error: 'Intentional server validation' }))
      .mockResolvedValueOnce(malformed())
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(success())
    for (const message of ['Intentional server validation', 'Unable to read the response. Please try again.', 'Unable to connect. Check your connection and try again.']) {
      button.focus()
      await act(async () => fireEvent.submit(form))
      expect(screen.getByRole('alert')).toHaveTextContent(message)
      expect(button).not.toBeDisabled()
      expect(button).toHaveFocus()
      inputs.forEach((input, index) => { expect(input.isConnected).toBe(true); expect(input).toHaveValue(values[index]); expect(input).not.toBeDisabled() })
    }
    await act(async () => fireEvent.submit(form))
    expect(screen.queryByRole('alert')).toBeNull()
    if (stage === 'signup' || stage === 'forgot') expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
    if (stage === 'reset-verify') expect(screen.getByLabelText(/^New Password/)).toBeEnabled()
    act(() => vi.advanceTimersByTime(2000))
    if (stage !== 'reset-verify') expect(push.mock.calls.length + navigate.mock.calls.length).toBe(1)
  })
  it.each(stages)('%s ignores a late malformed failure after unmount', async stage => {
    const { form, unmount } = await mount(stage)
    let resolve!: (value: Response) => void
    vi.mocked(fetch).mockReturnValueOnce(new Promise<Response>(yes => { resolve = yes }))
    fireEvent.submit(form); unmount()
    await act(async () => resolve(malformed()))
    expect(push).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled()
  })
})
