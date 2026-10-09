import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SignupClient } from '@/app/signup/SignupClient'
import VerifySignupPage from '@/app/verify-signup/page'
import CreatePasswordPage from '@/app/create-password/page'
import { AppMessageProvider } from '@/ui'

const { push, navigate } = vi.hoisted(() => ({ push: vi.fn(), navigate: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), useSearchParams: () => ({ get: (key: string) => key === 'email' ? 'owner@example.invalid' : key === 'next' ? '/join/OWNERSAFE?profile=required' : null }) }))
vi.mock('@/lib/client-navigation', () => ({ navigateTo: navigate }))
const KEY = 'pika.signupHandoffToken'
function deferred() { let resolve!: (value: Response) => void; const promise = new Promise<Response>(yes => { resolve = yes }); return { promise, resolve } }
const response = (ok: boolean, body: object) => ({ ok, json: async () => body }) as Response
function nativeBodyLoss() { document.body.setAttribute('tabindex', '-1'); document.body.focus(); document.body.removeAttribute('tabindex') }
beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); push.mockClear(); navigate.mockClear(); sessionStorage.clear() })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })
function mount(kind: 'Signup' | 'Verify' | 'Create') {
  const view = render(<AppMessageProvider>{kind === 'Signup' ? <SignupClient /> : kind === 'Verify' ? <VerifySignupPage /> : <CreatePasswordPage />}</AppMessageProvider>)
  if (kind === 'Signup') fireEvent.change(screen.getByLabelText(/School Email/), { target: { value: 'owner@example.invalid' } })
  if (kind === 'Verify') fireEvent.change(screen.getByLabelText(/Verification Code/), { target: { value: 'A7Q2F' } })
  if (kind === 'Create') {
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'SyntheticOwner123!' } })
    fireEvent.change(screen.getByLabelText(/^Confirm Password/), { target: { value: 'SyntheticOwner123!' } })
  }
  const button = screen.getByRole('button', { name: kind === 'Signup' ? 'Send Verification Code' : kind === 'Verify' ? 'Verify Email' : 'Create Account' })
  const field = screen.getByLabelText(kind === 'Signup' ? /School Email/ : kind === 'Verify' ? /Verification Code/ : /^Confirm Password/) as HTMLInputElement
  return { ...view, button, field }
}
describe('Signup VerifySignup CreatePassword activation owners', () => {
  it.each(['Signup', 'Verify', 'Create'] as const)('%s restores only eligible failure activation and preserves field identity/value', async kind => {
    const held = deferred(); vi.mocked(fetch).mockReturnValue(held.promise)
    const { button, field } = mount(kind); const value = field.value
    if (kind !== 'Signup') field.setSelectionRange(3, 3)
    button.focus(); fireEvent.click(button); nativeBodyLoss()
    expect(field).toBeDisabled(); expect(button.closest('form')).toHaveAttribute('aria-busy', 'true')
    await act(async () => held.resolve(response(false, { error: 'Controlled recovery' })))
    expect(button).toHaveFocus(); expect(field).toHaveValue(value); expect(field.isConnected).toBe(true)
    if (kind !== 'Signup') expect(field.selectionStart).toBe(3)
    expect(button.closest('form')).toHaveAttribute('aria-busy', 'false')
    expect(screen.getByRole('alert')).toHaveTextContent('Controlled recovery')
  })
  it.each(['Signup', 'Verify', 'Create'] as const)('%s respects deliberate pointer movement after native focus loss', async kind => {
    const held = deferred(); vi.mocked(fetch).mockReturnValue(held.promise)
    const { button } = mount(kind); button.focus(); fireEvent.click(button); nativeBodyLoss(); fireEvent.pointerDown(document.body)
    await act(async () => held.resolve(response(false, { error: 'Controlled recovery' })))
    expect(document.body).toHaveFocus()
  })
  it.each(['Signup', 'Verify', 'Create'] as const)('%s respects deliberate keyboard movement after native focus loss', async kind => {
    const held = deferred(); vi.mocked(fetch).mockReturnValue(held.promise)
    const { button } = mount(kind); button.focus(); fireEvent.click(button); nativeBodyLoss(); fireEvent.keyDown(document.body, { key: 'Tab' })
    await act(async () => held.resolve(response(false, { error: 'Controlled recovery' })))
    expect(document.body).toHaveFocus()
  })
  it.each(['Signup', 'Verify', 'Create'] as const)('%s suppresses held successful completion after unmount', async kind => {
    vi.useFakeTimers(); const held = deferred(); vi.mocked(fetch).mockReturnValue(held.promise)
    sessionStorage.setItem(KEY, JSON.stringify({ email: 'owner@example.invalid', token: 'retained-token' }))
    const { button, unmount } = mount(kind); button.focus(); fireEvent.click(button); unmount()
    await act(async () => held.resolve(response(true, { handoffToken: 'obsolete-token', redirectUrl: '/obsolete' })))
    act(() => vi.advanceTimersByTime(2000))
    expect(push).not.toHaveBeenCalled(); expect(navigate).not.toHaveBeenCalled()
    expect(JSON.parse(sessionStorage.getItem(KEY)!)).toEqual({ email: 'owner@example.invalid', token: 'retained-token' })
  })
  it.each(['held', 'acknowledged'] as const)('Signup Login retires %s owner and actual one-second continuation', async mode => {
    vi.useFakeTimers(); const held = deferred(); vi.mocked(fetch).mockReturnValue(held.promise)
    const { button } = mount('Signup'); button.focus(); fireEvent.click(button)
    if (mode === 'acknowledged') {
      await act(async () => held.resolve(response(true, { success: true })))
      expect(screen.getByRole('status')).toHaveTextContent('Verification code sent')
      expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
      act(() => vi.advanceTimersByTime(999)); expect(push).not.toHaveBeenCalled()
    }
    fireEvent.click(screen.getByRole('button', { name: 'Login', exact: true }))
    if (mode === 'held') await act(async () => held.resolve(response(true, { success: true })))
    act(() => vi.advanceTimersByTime(2000))
    expect(push).toHaveBeenCalledExactlyOnceWith('/login?next=%2Fjoin%2FOWNERSAFE%3Fprofile%3Drequired')
  })
  it('Verify success releases obsolete code activation before storage/navigation', async () => {
    const held = deferred(); vi.mocked(fetch).mockReturnValue(held.promise)
    const { field } = mount('Verify'); field.focus(); fireEvent.submit(field.closest('form')!); nativeBodyLoss()
    await act(async () => held.resolve(response(true, { handoffToken: 'synthetic-owner-token' })))
    expect(document.body).toHaveFocus()
    expect(JSON.parse(sessionStorage.getItem(KEY)!)).toEqual({ email: 'owner@example.invalid', token: 'synthetic-owner-token' })
    expect(push).toHaveBeenCalledExactlyOnceWith('/create-password?email=owner%40example.invalid&next=%2Fjoin%2FOWNERSAFE%3Fprofile%3Drequired')
  })
  it('Create sends only a matching-email handoff and removes it only on current success', async () => {
    sessionStorage.setItem(KEY, JSON.stringify({ email: 'different@example.invalid', token: 'other-token' }))
    vi.mocked(fetch).mockResolvedValue(response(true, { redirectUrl: '/classrooms' }))
    const { button } = mount('Create'); fireEvent.click(button)
    await act(async () => {})
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toMatchObject({ handoffToken: '' })
    expect(sessionStorage.getItem(KEY)).toBeNull()
    expect(navigate).toHaveBeenCalledWith('/join/OWNERSAFE?profile=required')
  })
})
