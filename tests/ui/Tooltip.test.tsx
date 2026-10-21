import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Tooltip, TooltipProvider } from '@/ui'
import { AnnouncementContent } from '@/components/AnnouncementContent'

const presentation = () => document.querySelector<HTMLElement>('[data-tooltip-presentation], [data-tooltip-exit]')
const help = (props: Partial<React.ComponentProps<typeof Tooltip>> = {}) => (
  <TooltipProvider><Tooltip content="Format advice" openOnClick {...props}><button>Help</button></Tooltip><button>Next</button></TooltipProvider>
)
const tap = (button: HTMLElement, pointerType = 'mouse') => {
  fireEvent.pointerDown(button, { pointerType })
  fireEvent.pointerUp(button, { pointerType })
  fireEvent.click(button)
}

describe('Tooltip presentation and immediate retirement', () => {
  let reduced = false
  let motionChange: (() => void) | undefined

  beforeEach(() => {
    reduced = false
    const nativeStyle = window.getComputedStyle.bind(window)
    // JSDOM does not run CSS animations. Model the live computed animation name
    // consumed by the installed Radix Presence; animation events stay explicit.
    vi.spyOn(window, 'getComputedStyle').mockImplementation((node, pseudo) => {
      const style = nativeStyle(node, pseudo)
      if (!node.hasAttribute('data-tooltip-presentation')) return style
      return new Proxy(style, { get(target, property) {
        if (property === 'getPropertyValue') return (name: string) => name === '--motion-duration-fast' ? '150ms' : target.getPropertyValue(name)
        if (property === 'animationName') return reduced ? 'none' : node.getAttribute('data-state') === 'closed' ? 'none' : 'tooltip-opacity-in'
        return Reflect.get(target, property)
      } })
    })
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      get matches() { return reduced },
      media: '(prefers-reduced-motion: reduce)', onchange: null,
      addEventListener: (_type: string, listener: EventListener) => { motionChange = listener as () => void },
      removeEventListener: () => { motionChange = undefined },
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
    })
    vi.stubGlobal('CSS', { escape: (value: string) => value })
  })

  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it.each(['mouse', 'touch'])('toggles click help with real %s pointerdown/click ordering', async (pointerType) => {
    render(help())
    const button = screen.getByRole('button', { name: 'Help' })
    tap(button, pointerType)
    expect(button).toHaveAccessibleDescription('Format advice')
    expect(screen.getByRole('tooltip')).toHaveTextContent('Format advice')
    tap(button, pointerType)
    expect(button).not.toHaveAttribute('aria-describedby')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(presentation()).toHaveAttribute('aria-hidden', 'true')
    expect(presentation()?.inert).toBe(true)
    expect(document.querySelector('[data-tooltip-presentation]')).toBeNull()
    await waitFor(() => expect(presentation()).toBeNull())
  })

  it('preserves focus disclosure, Escape focus, and Tab retirement', async () => {
    const user = userEvent.setup()
    render(help())
    const button = screen.getByRole('button', { name: 'Help' })
    act(() => button.focus())
    expect(button).toHaveAccessibleDescription('Format advice')
    await user.keyboard('{Escape}')
    expect(button).toHaveFocus()
    expect(button).not.toHaveAttribute('aria-describedby')
    tap(button)
    expect(button).toHaveAccessibleDescription('Format advice')
    await user.tab()
    expect(button).not.toHaveAttribute('aria-describedby')
    expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus()
  })

  it('retires interactive descendants and fences retained callbacks immediately', () => {
    const click = vi.fn()
    const key = vi.fn()
    render(help({ interactive: true, content: <a href="#artifact" onClick={click} onKeyDown={key}>Artifact</a> }))
    tap(screen.getByRole('button', { name: 'Help' }))
    const visibleLink = screen.getAllByRole('link', { name: 'Artifact' })[0]
    fireEvent.click(visibleLink)
    expect(click).toHaveBeenCalledTimes(1)
    act(() => visibleLink.focus())
    expect(visibleLink).toHaveFocus()
    fireEvent.keyDown(visibleLink, { key: 'Escape' })
    expect(visibleLink).not.toHaveFocus()
    key.mockClear()
    const closing = presentation()!
    expect(closing).toHaveAttribute('aria-hidden', 'true')
    expect(closing.inert).toBe(true)
    expect(closing.style.pointerEvents).toBe('none')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    const retiredLink = closing.querySelector('a')!
    expect(retiredLink).not.toHaveAttribute('href')
    fireEvent.click(retiredLink)
    fireEvent.keyDown(retiredLink, { key: 'Enter' })
    expect(click).toHaveBeenCalledTimes(1)
    expect(key).not.toHaveBeenCalled()
  })

  it('cancels old exit expiry after rapid reopening and keeps current content', () => {
    vi.useFakeTimers()
    try {
      const view = render(help())
      const button = screen.getByRole('button', { name: 'Help' })
      tap(button)
      tap(button)
      const closing = presentation()!
      tap(button)
      view.rerender(help({ content: 'Updated advice' }))
      act(() => vi.advanceTimersByTime(200))
      expect(button).toHaveAccessibleDescription('Updated advice')
      expect(presentation()).not.toBe(closing)
      expect(document.querySelector('[data-tooltip-exit]')).toBeNull()
    } finally { vi.useRealTimers() }
  })

  it('releases document Escape ownership during the decorative exit', () => {
    render(help())
    const button = screen.getByRole('button', { name: 'Help' })
    tap(button)
    fireEvent.keyDown(button, { key: 'Escape' })
    expect(document.querySelector('[data-tooltip-exit]')).not.toBeNull()
    const secondEscape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    fireEvent(button, secondEscape)
    expect(secondEscape.defaultPrevented).toBe(false)
  })

  it('fades a formatted announcement while retiring its headings and links immediately', () => {
    render(help({ interactive: true, content: <AnnouncementContent content={'# Class reminder\n\n## Before class\n\n### Your notes\n\n> Bring your notes.\n\nRead the [class guide](https://example.invalid/guide).'} /> }))
    const button = screen.getByRole('button', { name: 'Help' })
    tap(button)
    expect(screen.getAllByRole('heading', { name: 'Class reminder' }).length).toBeGreaterThan(0)
    fireEvent.keyDown(button, { key: 'Escape' })
    expect(button).not.toHaveAttribute('aria-describedby')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    const closing = document.querySelector<HTMLElement>('[data-tooltip-exit]')!
    expect(closing).not.toBeNull()
    expect(closing).toHaveAttribute('aria-hidden', 'true')
    expect(closing.inert).toBe(true)
    expect(closing).toHaveTextContent('Class reminder')
    expect(closing).toHaveTextContent('Before class')
    expect(closing).toHaveTextContent('Your notes')
    expect(closing).toHaveTextContent('Bring your notes.')
    expect(closing.querySelector('a')).not.toHaveAttribute('href')
  })

  it('retires unsafe arbitrary content without retaining widgets', () => {
    render(help({ content: <input aria-label="Embedded field" /> }))
    const button = screen.getByRole('button', { name: 'Help' })
    tap(button)
    tap(button)
    expect(presentation()).toBeNull()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('preserves the hover delay and retires noninteractive hover on leave', () => {
    vi.useFakeTimers()
    try {
      render(help({ openOnClick: false, delayDuration: 100 }))
      const button = screen.getByRole('button', { name: 'Help' })
      fireEvent.pointerMove(button, { pointerType: 'mouse' })
      act(() => vi.advanceTimersByTime(99))
      expect(button).not.toHaveAttribute('aria-describedby')
      act(() => vi.advanceTimersByTime(1))
      expect(button).toHaveAccessibleDescription('Format advice')
      fireEvent.pointerLeave(button, { pointerType: 'mouse' })
      expect(button).not.toHaveAttribute('aria-describedby')
      expect(presentation()?.inert).toBe(true)
    } finally { vi.useRealTimers() }
  })

  it('removes presentation immediately when disabled, including pending hover disclosure', async () => {
    vi.useFakeTimers()
    try {
      const view = render(help())
      const button = screen.getByRole('button', { name: 'Help' })
      tap(button)
      tap(button)
      view.rerender(help({ disabled: true }))
      expect(presentation()).toBeNull()
      expect(button).not.toHaveAttribute('aria-describedby')
      view.rerender(help())
      fireEvent.pointerMove(button, { pointerType: 'mouse' })
      view.rerender(help({ disabled: true }))
      view.rerender(help())
      act(() => vi.advanceTimersByTime(100))
      expect(presentation()).toBeNull()
      fireEvent.pointerLeave(button, { pointerType: 'mouse' })
      fireEvent.pointerMove(button, { pointerType: 'mouse' })
      act(() => vi.advanceTimersByTime(100))
      expect(button).toHaveAccessibleDescription('Format advice')
    } finally { vi.useRealTimers() }
  })

  it('uses immediate close for reduced motion and retires a fade on a live preference change', () => {
    reduced = true
    const view = render(help())
    const button = screen.getByRole('button', { name: 'Help' })
    tap(button)
    tap(button)
    expect(presentation()).toBeNull()
    act(() => { reduced = false; motionChange?.() })
    tap(button)
    tap(button)
    expect(presentation()).not.toBeNull()
    act(() => { reduced = true; motionChange?.() })
    expect(presentation()).toBeNull()
    view.unmount()
  })

  it.each(['disabled', 'hidden'] as const)('accepts the first fresh hover after an initially %s owner becomes available', (reason) => {
    vi.useFakeTimers()
    const setVisibility = (value: 'hidden' | 'visible') => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value })
      fireEvent(document, new Event('visibilitychange'))
    }
    try {
      if (reason === 'hidden') setVisibility('hidden')
      const view = render(help({ openOnClick: false, disabled: reason === 'disabled' }))
      if (reason === 'disabled') view.rerender(help({ openOnClick: false }))
      else setVisibility('visible')
      const button = screen.getByRole('button', { name: 'Help' })
      fireEvent.pointerEnter(button, { pointerType: 'mouse' })
      fireEvent.pointerMove(button, { pointerType: 'mouse' })
      act(() => vi.advanceTimersByTime(99))
      expect(button).not.toHaveAttribute('aria-describedby')
      act(() => vi.advanceTimersByTime(1))
      expect(button).toHaveAccessibleDescription('Format advice')
    } finally {
      setVisibility('visible')
      vi.useRealTimers()
    }
  })

  it('keeps a pending hover retired when disabled help is clicked before re-enabling', () => {
    vi.useFakeTimers()
    try {
      const view = render(help())
      const button = screen.getByRole('button', { name: 'Help' })
      fireEvent.pointerEnter(button, { pointerType: 'mouse' })
      fireEvent.pointerMove(button, { pointerType: 'mouse' })
      view.rerender(help({ disabled: true }))
      tap(button)
      view.rerender(help())
      act(() => vi.advanceTimersByTime(150))
      expect(button).not.toHaveAttribute('aria-describedby')
      expect(presentation()).toBeNull()
    } finally { vi.useRealTimers() }
  })

  it('retires on document hiding and unmount without stale lifecycle work', () => {
    const view = render(help())
    const button = screen.getByRole('button', { name: 'Help' })
    tap(button)
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    fireEvent(document, new Event('visibilitychange'))
    expect(presentation()).toBeNull()
    expect(button).not.toHaveAttribute('aria-describedby')
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    fireEvent(document, new Event('visibilitychange'))
    expect(presentation()).toBeNull()
    tap(button)
    expect(presentation()).not.toBeNull()
    view.unmount()
    expect(presentation()).toBeNull()
    expect(motionChange).toBeUndefined()
  })
})
