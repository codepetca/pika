import { StrictMode, useEffect, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModalLayer } from '@/ui'

describe('ModalLayer', () => {
  it('isolates the page, contains focus, and restores the opener on close', async () => {
    const user = userEvent.setup()

    function Harness() {
      const [isOpen, setIsOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setIsOpen(true)}>Open dialog</button>
          <ModalLayer isOpen={isOpen} onClose={() => setIsOpen(false)} ariaLabel="Focus contract">
            <button type="button" data-modal-initial-focus>First action</button>
            <button type="button" onClick={() => setIsOpen(false)}>Done</button>
          </ModalLayer>
        </>
      )
    }

    const { container } = render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Open dialog' })
    await user.click(opener)

    const firstAction = await screen.findByRole('button', { name: 'First action' })
    const done = screen.getByRole('button', { name: 'Done' })
    const dialog = screen.getByRole('dialog', { name: 'Focus contract' })
    await waitFor(() => expect(firstAction).toHaveFocus())
    expect(dialog.parentElement).toHaveClass('z-modal')
    expect(screen.getByRole('button', { name: 'Close dialog' })).toHaveClass(
      'bg-overlay-scrim',
    )
    expect(container).toHaveAttribute('aria-hidden', 'true')
    expect(container.inert).toBe(true)
    expect(document.body.style.overflow).toBe('hidden')

    await user.tab({ shift: true })
    expect(done).toHaveFocus()
    await user.tab()
    expect(firstAction).toHaveFocus()

    await user.click(done)
    await waitFor(() => expect(opener).toHaveFocus())
    expect(container).not.toHaveAttribute('aria-hidden')
    expect(container.inert).toBe(false)
    expect(document.body.style.overflow).toBe('')
  })

  it('only lets the top nested layer handle Escape', () => {
    const closeOuter = vi.fn()
    const closeInner = vi.fn()

    render(
      <>
        <ModalLayer isOpen onClose={closeOuter} ariaLabel="Outer dialog">
          Outer content
        </ModalLayer>
        <ModalLayer isOpen onClose={closeInner} ariaLabel="Inner dialog">
          Inner content
        </ModalLayer>
      </>
    )

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(closeInner).toHaveBeenCalledOnce()
    expect(closeOuter).not.toHaveBeenCalled()
  })

  it('leaves Escape from an open menu for the menu to handle', () => {
    const onClose = vi.fn()
    render(
      <ModalLayer isOpen onClose={onClose} ariaLabel="Dialog with menu">
        <div role="menu">
          <button type="button" role="menuitem">Link</button>
        </div>
      </ModalLayer>,
    )

    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Link' }), { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('leaves Escape for an explicitly marked inline editor', () => {
    const onClose = vi.fn()
    render(
      <ModalLayer isOpen onClose={onClose} ariaLabel="Editor dialog">
        <input aria-label="Title" data-handle-escape />
      </ModalLayer>,
    )

    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Title' }), { key: 'Escape' })

    expect(onClose).not.toHaveBeenCalled()
  })

  it('wraps reverse Tab from a panel-focused custom dialog', async () => {
    render(
      <ModalLayer isOpen onClose={vi.fn()} ariaLabel="Custom dialog">
        <button type="button">First action</button>
        <button type="button">Last action</button>
      </ModalLayer>,
    )

    const dialog = screen.getByRole('dialog', { name: 'Custom dialog' })
    await waitFor(() => expect(dialog).toHaveFocus())
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(screen.getByRole('button', { name: 'Last action' })).toHaveFocus()
  })
})

// Tokens/media are computed in a browser; JSDOM deliberately supplies neither.
describe('ModalLayer visual exit lifecycle', () => {
  let duration: string
  let motionListeners: Set<() => void>
  let reducedMotion: boolean

  beforeEach(() => {
    vi.useFakeTimers()
    duration = '180ms'
    reducedMotion = false
    motionListeners = new Set()
    const originalComputedStyle = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      const style = originalComputedStyle(element)
      style.setProperty('--motion-duration-standard', duration)
      return style
    })
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      media: query,
      get matches() { return reducedMotion },
      addEventListener: (_event: string, listener: () => void) => motionListeners.add(listener),
      removeEventListener: (_event: string, listener: () => void) => motionListeners.delete(listener),
    }) as MediaQueryList)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('closes logically and restores focus immediately while retaining last committed presentation', () => {
    const command = vi.fn()
    const changed = vi.fn()
    const submitted = vi.fn()
    function Harness() {
      const [open, setOpen] = useState(false)
      return <>
        <button onClick={() => setOpen(true)}>Open</button>
        <ModalLayer isOpen={open} exitMotion="opacity" onClose={() => setOpen(false)} onEnter={command} ariaLabel={open ? 'Original' : 'Cleared'}>
          <form onSubmit={submitted}>
            <input aria-label="Draft" defaultValue="Saved draft" onChange={changed} />
            <button type="button" onClick={command}>Command</button>
            <button type="button" onClick={() => setOpen(false)}>Close</button>
            <p>{open ? 'Original body' : 'Cleared body'}</p>
          </form>
        </ModalLayer>
      </>
    }
    const { container } = render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Open' })
    opener.focus()
    fireEvent.click(opener)
    const panel = screen.getByRole('dialog', { name: 'Original' })
    const root = panel.parentElement!
    const input = screen.getByRole('textbox', { name: 'Draft' })
    const button = screen.getByRole('button', { name: 'Command' })
    fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(panel).toBeInTheDocument()
    expect(panel).not.toHaveAttribute('aria-modal')
    expect(panel).toHaveAttribute('aria-label', 'Original')
    expect(root).toHaveAttribute('aria-hidden', 'true')
    expect(root.inert).toBe(true)
    expect(root).toHaveClass('pointer-events-none')
    expect(screen.getByText('Original body')).toBeInTheDocument()
    expect(screen.queryByText('Cleared body')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
    expect(container.inert).toBe(false)
    expect(container).not.toHaveAttribute('aria-hidden')
    expect(document.body.style.overflow).toBe('')

    fireEvent.click(button)
    fireEvent.change(input, { target: { value: 'Blocked' } })
    fireEvent.submit(input.closest('form')!)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(command).not.toHaveBeenCalled()
    expect(changed).not.toHaveBeenCalled()
    expect(submitted).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(179))
    expect(panel).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(1))
    expect(panel).not.toBeInTheDocument()
  })

  it('cancels stale exits when reopened, then uses the current content and duration', () => {
    const onClose = vi.fn()
    const { rerender } = render(<ModalLayer isOpen exitMotion="opacity" onClose={onClose} ariaLabel="Old">Old content</ModalLayer>)
    const panel = screen.getByRole('dialog', { name: 'Old' })
    rerender(<ModalLayer isOpen={false} exitMotion="opacity" onClose={onClose}>Cleared</ModalLayer>)
    act(() => vi.advanceTimersByTime(90))
    rerender(<ModalLayer isOpen exitMotion="opacity" onClose={onClose} ariaLabel="New">New content</ModalLayer>)
    expect(screen.getByRole('dialog', { name: 'New' })).toBe(panel)
    expect(panel.parentElement!.inert).toBe(false)
    expect(panel.parentElement).not.toHaveClass('opacity-0', 'transition-opacity')
    act(() => vi.advanceTimersByTime(180))
    expect(panel).toBeInTheDocument()
    expect(document.body.style.overflow).toBe('hidden')
    duration = '0.12s'
    rerender(<ModalLayer isOpen={false} exitMotion="opacity" onClose={onClose}>Cleared</ModalLayer>)
    expect(screen.getByText('New content')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(120))
    expect(panel).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
  })

  it('does not leave focus in an inert exit when its opener was removed', () => {
    const view = (open: boolean, keepOpener: boolean) => <>
      {keepOpener && <button>Opener</button>}
      <ModalLayer isOpen={open} exitMotion="opacity" onClose={vi.fn()} ariaLabel="Focus fallback"><input aria-label="Field" /></ModalLayer>
    </>
    const { rerender } = render(view(false, true))
    screen.getByRole('button', { name: 'Opener' }).focus()
    rerender(view(true, true))
    const panel = screen.getByRole('dialog')
    expect(panel).toHaveFocus()
    rerender(view(false, false))
    expect(panel).toBeInTheDocument()
    expect(document.body).toHaveFocus()
  })

  it.each(['0ms', 'invalid', ''])('does not retain visual content for a zero or unavailable duration (%s)', (token) => {
    duration = token
    const { rerender } = render(<ModalLayer isOpen exitMotion="opacity" onClose={vi.fn()}>Body</ModalLayer>)
    rerender(<ModalLayer isOpen={false} exitMotion="opacity" onClose={vi.fn()}>Body</ModalLayer>)
    expect(screen.queryByText('Body')).not.toBeInTheDocument()
    act(() => vi.runAllTimers())
    expect(vi.getTimerCount()).toBe(0)
  })

  it('skips reduced-motion retention and finishes an existing exit when the preference changes', () => {
    reducedMotion = true
    const { rerender } = render(<ModalLayer isOpen exitMotion="opacity" onClose={vi.fn()}>Body</ModalLayer>)
    rerender(<ModalLayer isOpen={false} exitMotion="opacity" onClose={vi.fn()}>Body</ModalLayer>)
    expect(screen.queryByText('Body')).not.toBeInTheDocument()
    reducedMotion = false
    rerender(<ModalLayer isOpen exitMotion="opacity" onClose={vi.fn()}>Body</ModalLayer>)
    rerender(<ModalLayer isOpen={false} exitMotion="opacity" onClose={vi.fn()}>Body</ModalLayer>)
    expect(screen.getByText('Body')).toBeInTheDocument()
    reducedMotion = true
    act(() => motionListeners.forEach((listener) => listener()))
    expect(screen.queryByText('Body')).not.toBeInTheDocument()
  })

  it.each(['none', 'opacity'] as const)('preserves the declared child cleanup lifetime for %s', (exitMotion) => {
    const dispose = vi.fn()
    function Child() {
      useEffect(() => dispose, [])
      return <p>Effect child</p>
    }
    const { rerender, unmount } = render(<ModalLayer isOpen exitMotion={exitMotion} onClose={vi.fn()}><Child /></ModalLayer>)
    rerender(<ModalLayer isOpen={false} exitMotion={exitMotion} onClose={vi.fn()}><Child /></ModalLayer>)
    expect(dispose).toHaveBeenCalledTimes(exitMotion === 'none' ? 1 : 0)
    unmount()
    expect(dispose).toHaveBeenCalledOnce()
    act(() => vi.runAllTimers())
    expect(vi.getTimerCount()).toBe(0)
    expect(motionListeners.size).toBe(0)
    expect(document.body.style.overflow).toBe('')
  })

  it('unmounts an open StrictMode owner without leaked isolation or registration', () => {
    const close = vi.fn()
    const { container, unmount } = render(<StrictMode><ModalLayer isOpen exitMotion="opacity" onClose={close}>Body</ModalLayer></StrictMode>)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(close).toHaveBeenCalledOnce()
    unmount()
    expect(document.body.style.overflow).toBe('')
    expect(container.inert).toBe(false)
    expect(container).not.toHaveAttribute('aria-hidden')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(close).toHaveBeenCalledOnce()
  })

  it.each(['open', 'closing'] as const)('unmounts a %s owner without a later focus or environment change', (phase) => {
    const view = (mounted: boolean, open: boolean) => <>
      <button>Opener</button>
      <button>Following action</button>
      {mounted && <ModalLayer isOpen={open} exitMotion="opacity" onClose={vi.fn()} ariaLabel="Unmounting">Body</ModalLayer>}
    </>
    const { rerender } = render(view(true, false))
    const opener = screen.getByRole('button', { name: 'Opener' })
    opener.focus()
    rerender(view(true, true))
    if (phase === 'closing') {
      rerender(view(true, false))
      expect(opener).toHaveFocus()
      screen.getByRole('button', { name: 'Following action' }).focus()
    }
    rerender(view(false, false))
    const focusTarget = phase === 'open' ? opener : screen.getByRole('button', { name: 'Following action' })
    expect(focusTarget).toHaveFocus()
    expect(document.body.style.overflow).toBe('')
    expect(motionListeners.size).toBe(0)
    act(() => vi.runAllTimers())
    expect(focusTarget).toHaveFocus()
    expect(screen.queryByRole('dialog', { hidden: true })).not.toBeInTheDocument()
  })

  it.each(['parent-first', 'child-first'] as const)('restores outside focus when both nested owners close (%s)', (order) => {
    function Harness({ parentOpen, childOpen }: { parentOpen: boolean; childOpen: boolean }) {
      const parent = <ModalLayer key="parent" isOpen={parentOpen} exitMotion="opacity" onClose={vi.fn()} ariaLabel="Parent"><button>Nested opener</button></ModalLayer>
      const child = <ModalLayer key="child" isOpen={childOpen} exitMotion="opacity" onClose={vi.fn()} ariaLabel="Child">Child body</ModalLayer>
      return <><button>Outside</button>{order === 'parent-first' ? <>{parent}{child}</> : <>{child}{parent}</>}</>
    }
    const { rerender } = render(<Harness parentOpen={false} childOpen={false} />)
    const outside = screen.getByRole('button', { name: 'Outside' })
    outside.focus()
    rerender(<Harness parentOpen childOpen={false} />)
    const nestedOpener = screen.getByRole('button', { name: 'Nested opener' })
    nestedOpener.focus()
    rerender(<Harness parentOpen childOpen />)
    rerender(<Harness parentOpen={false} childOpen={false} />)
    expect(outside).toHaveFocus()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('')
    expect(screen.getByText('Child body').parentElement!.inert).toBe(true)
  })

  it('keeps focus in the active child when its parent closes, then restores outside provenance', () => {
    const layers = (parentOpen: boolean, childOpen: boolean) => <>
      <button>Outside</button>
      <ModalLayer isOpen={parentOpen} exitMotion="opacity" onClose={vi.fn()} ariaLabel="Parent"><button>Nested opener</button></ModalLayer>
      <ModalLayer isOpen={childOpen} exitMotion="opacity" onClose={vi.fn()} ariaLabel="Child">Child body</ModalLayer>
    </>
    const { rerender } = render(layers(false, false))
    const outside = screen.getByRole('button', { name: 'Outside' })
    outside.focus()
    rerender(layers(true, false))
    screen.getByRole('button', { name: 'Nested opener' }).focus()
    rerender(layers(true, true))
    const child = screen.getByRole('dialog', { name: 'Child' })
    rerender(layers(false, true))
    expect(child).toHaveFocus()
    expect(document.body.style.overflow).toBe('hidden')
    rerender(layers(false, false))
    expect(outside).toHaveFocus()
    expect(document.body.style.overflow).toBe('')
  })

  it('returns to the active parent and blocks events from its visually retained closed child', () => {
    const parentClose = vi.fn()
    const parentEnter = vi.fn()
    const childClose = vi.fn()
    const layers = (childOpen: boolean) => <>
      <ModalLayer isOpen exitMotion="opacity" onClose={parentClose} onEnter={parentEnter} ariaLabel="Parent"><button>Nested opener</button></ModalLayer>
      <ModalLayer isOpen={childOpen} exitMotion="opacity" onClose={childClose} ariaLabel="Child"><input aria-label="Child field" /></ModalLayer>
    </>
    const { rerender } = render(layers(false))
    const nestedOpener = screen.getByRole('button', { name: 'Nested opener' })
    nestedOpener.focus()
    rerender(layers(true))
    const field = screen.getByLabelText('Child field')
    rerender(layers(false))
    expect(nestedOpener).toHaveFocus()
    fireEvent.keyDown(field, { key: 'Enter' })
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(parentEnter).not.toHaveBeenCalled()
    expect(parentClose).not.toHaveBeenCalled()
    expect(childClose).not.toHaveBeenCalled()
    expect(field.closest('[data-modal-state="closing"]')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('dialog', { name: 'Parent' }).parentElement!.inert).toBe(false)
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(parentClose).toHaveBeenCalledOnce()
    act(() => vi.advanceTimersByTime(180))
    expect(field).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Parent' })).toBeInTheDocument()
  })

  it('keeps older exits hidden when another layer opens and closes during their visual lifetime', () => {
    const layers = (oldOpen: boolean, newOpen: boolean) => <>
      <ModalLayer isOpen={oldOpen} exitMotion="opacity" onClose={vi.fn()} ariaLabel="Old">Old body</ModalLayer>
      <ModalLayer isOpen={newOpen} onClose={vi.fn()} ariaLabel="New">New body</ModalLayer>
    </>
    const { rerender } = render(layers(true, false))
    const oldRoot = screen.getByRole('dialog', { name: 'Old' }).parentElement!
    rerender(layers(false, false))
    rerender(layers(false, true))
    expect(oldRoot.inert).toBe(true)
    expect(oldRoot).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('dialog', { name: 'New' }).parentElement!.inert).toBe(false)
    rerender(layers(false, false))
    expect(oldRoot.inert).toBe(true)
    expect(oldRoot).toHaveAttribute('aria-hidden', 'true')
    expect(document.body.style.overflow).toBe('')
    rerender(layers(true, false))
    expect(screen.getByRole('dialog', { name: 'Old' }).parentElement).toBe(oldRoot)
    expect(oldRoot.inert).toBe(false)
    expect(oldRoot).not.toHaveAttribute('aria-hidden')
    act(() => vi.advanceTimersByTime(180))
    expect(oldRoot).toBeInTheDocument()
  })

  it('aligns the active stack and portal paint order when an older exit reopens above another dialog', () => {
    const oldClose = vi.fn()
    const newClose = vi.fn()
    const layers = (oldOpen: boolean, newOpen: boolean) => <>
      <ModalLayer isOpen={oldOpen} exitMotion="opacity" onClose={oldClose} ariaLabel="Old">Old body</ModalLayer>
      <ModalLayer isOpen={newOpen} onClose={newClose} ariaLabel="New">New body</ModalLayer>
    </>
    const { rerender } = render(layers(true, false))
    const oldPanel = screen.getByRole('dialog', { name: 'Old' })
    rerender(layers(false, true))
    const newRoot = screen.getByRole('dialog', { name: 'New' }).parentElement!
    rerender(layers(true, true))
    expect(screen.getByRole('dialog', { name: 'Old' })).toBe(oldPanel)
    expect(oldPanel).toHaveFocus()
    expect(document.body.lastElementChild).toBe(oldPanel.parentElement)
    expect(newRoot.inert).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(oldClose).toHaveBeenCalledOnce()
    expect(newClose).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(180))
    expect(oldPanel).toBeInTheDocument()
  })

  it.each((['old-first', 'new-first'] as const).flatMap((order) =>
    (['none', 'opacity'] as const).flatMap((oldExit) =>
      (['none', 'opacity'] as const).map((newExit) => ({ order, oldExit, newExit })),
    ),
  ))('preserves initial and return focus during sibling replacement ($order, $oldExit → $newExit)', ({ order, oldExit, newExit }) => {
    function Harness({ oldOpen, newOpen }: { oldOpen: boolean; newOpen: boolean }) {
      const old = <ModalLayer key="old" isOpen={oldOpen} exitMotion={oldExit} onClose={vi.fn()} ariaLabel="Old"><button data-modal-initial-focus>Old initial</button></ModalLayer>
      const replacement = <ModalLayer key="new" isOpen={newOpen} exitMotion={newExit} onClose={vi.fn()} ariaLabel="New"><button data-modal-initial-focus>New initial</button></ModalLayer>
      return <><button>Outside opener</button>{order === 'old-first' ? <>{old}{replacement}</> : <>{replacement}{old}</>}</>
    }
    const { rerender } = render(<Harness oldOpen={false} newOpen={false} />)
    const outside = screen.getByRole('button', { name: 'Outside opener' })
    outside.focus()
    rerender(<Harness oldOpen newOpen={false} />)
    expect(screen.getByRole('button', { name: 'Old initial' })).toHaveFocus()
    rerender(<Harness oldOpen={false} newOpen />)
    expect(screen.getByRole('button', { name: 'New initial' })).toHaveFocus()
    expect(screen.getByRole('dialog', { name: 'New' }).parentElement!.inert).toBe(false)
    expect(document.body.style.overflow).toBe('hidden')
    rerender(<Harness oldOpen={false} newOpen={false} />)
    expect(outside).toHaveFocus()
    expect(document.body.style.overflow).toBe('')
    act(() => vi.runAllTimers())
    expect(screen.queryByRole('dialog', { hidden: true })).not.toBeInTheDocument()
    expect(outside).toHaveFocus()
  })
})
