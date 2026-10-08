import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePasswordResetContinuity, useUppercaseResetCode } from '@/hooks/usePasswordResetContinuity'
import { Input } from '@/ui/Input'

function controls() {
  const form = document.createElement('form')
  const button = document.createElement('button')
  button.type = 'submit'
  form.append(button)
  document.body.append(form)
  button.focus()
  return { form, button }
}
// jsdom keeps disabled controls focused; model the native browser's BODY loss.
function nativeDisabledFocusLoss() {
  document.body.setAttribute('tabindex', '-1')
  document.body.focus()
  document.body.removeAttribute('tabindex')
}
afterEach(() => { cleanup(); document.querySelectorAll('form').forEach(form => form.remove()); vi.useRealTimers() })

describe('password reset request activation ownership', () => {
  it('returns native activation focus after failure without scrolling', () => {
    const { form, button } = controls()
    const { result, rerender } = renderHook(({ pending }) => usePasswordResetContinuity(pending), { initialProps: { pending: false } })
    let request!: number
    act(() => { request = result.current.begin(form)! })
    rerender({ pending: true })
    button.disabled = true
    nativeDisabledFocusLoss()
    button.disabled = false
    const focus = vi.spyOn(button, 'focus')
    act(() => result.current.finish(request))
    rerender({ pending: false })
    expect(button).toHaveFocus()
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
  })

  it.each(['pointer', 'keyboard', 'focus'] as const)('does not steal focus after deliberate %s movement', kind => {
    const { form, button } = controls()
    const { result, rerender } = renderHook(({ pending }) => usePasswordResetContinuity(pending), { initialProps: { pending: false } })
    let request!: number
    act(() => { request = result.current.begin(form)! })
    rerender({ pending: true })
    button.disabled = true
    nativeDisabledFocusLoss()
    if (kind === 'pointer') fireEvent.pointerDown(document.body)
    if (kind === 'keyboard') fireEvent.keyDown(document.body, { key: 'Tab' })
    if (kind === 'focus') {
      const other = document.createElement('button'); form.append(other); other.focus(); other.remove()
      nativeDisabledFocusLoss()
    }
    button.disabled = false
    act(() => result.current.finish(request))
    rerender({ pending: false })
    expect(document.body).toHaveFocus()
  })

  it('never moves focus away from another active owner', () => {
    const { form } = controls()
    const { result, rerender } = renderHook(({ pending }) => usePasswordResetContinuity(pending), { initialProps: { pending: false } })
    let request!: number
    act(() => { request = result.current.begin(form)! })
    rerender({ pending: true })
    const other = document.createElement('button'); form.append(other); other.focus()
    act(() => result.current.finish(request))
    rerender({ pending: false })
    expect(other).toHaveFocus()
  })

  it('rejects overlapping activation and obsolete completion after retirement', () => {
    const { form, button } = controls()
    const { result, unmount } = renderHook(() => usePasswordResetContinuity(true))
    let request!: number
    act(() => { request = result.current.begin(form)! })
    expect(result.current.begin(form)).toBeNull()
    nativeDisabledFocusLoss()
    const focus = vi.spyOn(button, 'focus')
    const continuity = result.current
    unmount()
    expect(continuity.isCurrent(request)).toBe(false)
    act(() => continuity.finish(request))
    expect(focus).not.toHaveBeenCalled()
    expect(continuity.begin(form)).toBeNull()
  })

  it.each(['departure', 'unmount'] as const)('cancels the old two-second continuation on %s', kind => {
    vi.useFakeTimers()
    const { form } = controls()
    const { result, unmount } = renderHook(() => usePasswordResetContinuity(true))
    const push = vi.fn()
    let request!: number
    act(() => { request = result.current.begin(form)!; result.current.continueAfter(request, push, 2000) })
    act(() => vi.advanceTimersByTime(1999))
    expect(push).not.toHaveBeenCalled()
    if (kind === 'departure') act(() => result.current.retire())
    else unmount()
    act(() => vi.advanceTimersByTime(2001))
    expect(push).not.toHaveBeenCalled()
  })

  it('continues at the existing two-second deadline while the owner remains current', () => {
    vi.useFakeTimers()
    const { form } = controls()
    const { result } = renderHook(() => usePasswordResetContinuity(true))
    const push = vi.fn()
    act(() => { const request = result.current.begin(form)!; result.current.continueAfter(request, push, 2000) })
    act(() => vi.advanceTimersByTime(1999))
    expect(push).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(push).toHaveBeenCalledTimes(1)
  })
})

function Code() {
  const code = useUppercaseResetCode()
  return <Input aria-label="Reset code" value={code.code} ref={code.inputRef} onChange={code.onChange} />
}

describe('native reset code insertion', () => {
  it('preserves a middle insertion caret while uppercasing native typing', async () => {
    const user = userEvent.setup()
    render(<Code />)
    const input = screen.getByRole('textbox', { name: 'Reset code' }) as HTMLInputElement
    await user.click(input)
    await user.keyboard('ab{ArrowLeft}z')
    expect(input).toHaveValue('AZB')
    expect(input.selectionStart).toBe(2)
    await user.keyboard('q')
    expect(input).toHaveValue('AZQB')
    expect(input.selectionStart).toBe(3)
  })

  it('preserves selection when a lowercase replacement produces the same uppercase state', async () => {
    const user = userEvent.setup()
    render(<Code />)
    const input = screen.getByRole('textbox', { name: 'Reset code' }) as HTMLInputElement
    await user.click(input)
    await user.keyboard('ABC')
    input.setSelectionRange(1, 2)
    await user.keyboard('b')
    expect(input).toHaveValue('ABC')
    expect(input.selectionStart).toBe(2)
  })
})
