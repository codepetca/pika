import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { startTransition, StrictMode, Suspense, useEffect, useState } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { DialogPanel, SplitButton } from '@/ui'

describe('SplitButton', () => {
  it('keeps the committed primary action live while retirement is suspended', () => {
    const pending = new Promise<void>(() => {})
    const onPrimaryClick = vi.fn()
    let retire!: (value: boolean) => void
    let suspendedAttempts = 0
    function Suspender({ inactive }: { inactive: boolean }) {
      if (inactive) { suspendedAttempts += 1; throw pending }
      return null
    }
    function Parent() {
      const [inactive, setInactive] = useState(false)
      retire = setInactive
      return <Suspense fallback={<p>Pending</p>}>
        <SplitButton label="Post" interactionActive={!inactive} onPrimaryClick={onPrimaryClick} options={[]} />
        <Suspender inactive={inactive} />
      </Suspense>
    }
    render(<Parent />)
    act(() => { startTransition(() => retire(true)) })
    expect(suspendedAttempts).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    expect(onPrimaryClick).toHaveBeenCalledOnce()
    act(() => { retire(false) })
  })

  it('cancels and fences deferred focus across retirement and rapid reactivation without changing button styling', () => {
    let oldFrame!: FrameRequestCallback
    const frameSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { oldFrame = callback; return 41 })
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    const onPrimaryClick = vi.fn()
    const options = [{ id: 'draft', label: 'Draft', onSelect: vi.fn() }]
    const props = { label: 'Post', onPrimaryClick, options, toggleAriaLabel: 'Choose action' }
    const view = render(<SplitButton {...props} />)
    try {
      const primary = screen.getByRole('button', { name: 'Post' })
      const originalClass = primary.className
      fireEvent.click(screen.getByRole('button', { name: 'Choose action' }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Draft' }))
      expect(frameSpy).toHaveBeenCalledOnce()
      view.rerender(<SplitButton {...props} interactionActive={false} />)
      expect(cancelSpy).toHaveBeenCalledWith(41)
      expect(primary).toBeEnabled()
      expect(primary.className).toBe(originalClass)
      fireEvent.click(primary)
      expect(onPrimaryClick).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: 'Choose action' }))
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      view.rerender(<SplitButton {...props} />)
      // Even a cancelled callback delivered late cannot focus the new lifetime.
      act(() => { (document.activeElement as HTMLElement).blur(); oldFrame(0) })
      expect(primary).not.toHaveFocus()
      expect(screen.getByRole('button', { name: 'Choose action' })).not.toHaveFocus()
    } finally {
      view.unmount()
      frameSpy.mockRestore()
      cancelSpy.mockRestore()
    }
  })

  it('retires its document listeners and cancels a queued Tab close before a new menu opens', () => {
    vi.useFakeTimers()
    const addSpy = vi.spyOn(document, 'addEventListener')
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    const props = { label: 'Actions', singleMenuTrigger: true, options: [{ id: 'one', label: 'First action', onSelect: vi.fn() }] }
    const view = render(<SplitButton {...props} />)
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Actions' }))
      const mouseListener = addSpy.mock.calls.findLast(([name]) => name === 'mousedown')![1]
      const focusListener = addSpy.mock.calls.findLast(([name]) => name === 'focusin')![1]
      fireEvent.keyDown(screen.getByRole('menuitem', { name: 'First action' }), { key: 'Tab' })
      view.rerender(<SplitButton {...props} interactionActive={false} />)
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      expect(removeSpy).toHaveBeenCalledWith('mousedown', mouseListener)
      expect(removeSpy).toHaveBeenCalledWith('focusin', focusListener)
      view.rerender(<SplitButton {...props} />)
      fireEvent.click(screen.getByRole('button', { name: 'Actions' }))
      act(() => { vi.runOnlyPendingTimers() })
      expect(screen.getByRole('menuitem', { name: 'First action' })).toHaveFocus()
    } finally {
      view.unmount()
      addSpy.mockRestore()
      removeSpy.mockRestore()
      vi.useRealTimers()
    }
  })

  it('runs primary action when main button is clicked', () => {
    const onPrimaryClick = vi.fn()
    const onSelectDraft = vi.fn()

    render(
      <SplitButton
        label="Post"
        onPrimaryClick={onPrimaryClick}
        options={[
          { id: 'draft', label: 'Draft', onSelect: onSelectDraft },
        ]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    expect(onPrimaryClick).toHaveBeenCalledOnce()
    expect(onSelectDraft).not.toHaveBeenCalled()
  })

  it('opens menu and runs selected option action', async () => {
    const onPrimaryClick = vi.fn()
    const onSelectSchedule = vi.fn()

    render(
      <SplitButton
        label="Post"
        onPrimaryClick={onPrimaryClick}
        options={[
          { id: 'schedule', label: 'Schedule', onSelect: onSelectSchedule },
        ]}
        toggleAriaLabel="Choose action"
      />
    )

    const toggle = screen.getByRole('button', { name: 'Choose action' })
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Schedule' }))

    expect(onSelectSchedule).toHaveBeenCalledOnce()
    expect(onPrimaryClick).not.toHaveBeenCalled()
    expect(screen.queryByRole('menuitem', { name: 'Schedule' })).not.toBeInTheDocument()
    await waitFor(() => expect(toggle).toHaveFocus())
  })

  it('keeps menu options touch-sized with visible keyboard focus', () => {
    render(
      <SplitButton
        label="Post"
        onPrimaryClick={vi.fn()}
        options={[{ id: 'schedule', label: 'Schedule', onSelect: vi.fn() }]}
        toggleAriaLabel="Choose action"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Choose action' }))
    expect(screen.getByRole('menuitem', { name: 'Schedule' })).toHaveClass(
      'min-h-control',
      'focus-visible:ring-foundation',
      'focus-visible:ring-inset',
    )
  })

  it('can use the primary button to open the menu', () => {
    const onPrimaryClick = vi.fn()

    render(
      <SplitButton
        label="Add"
        onPrimaryClick={onPrimaryClick}
        primaryOpensMenu
        options={[
          { id: 'link', label: 'Link', onSelect: vi.fn() },
        ]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(screen.getByRole('menuitem', { name: 'Link' })).toBeInTheDocument()
    expect(onPrimaryClick).not.toHaveBeenCalled()
  })

  it('can render one named menu trigger', () => {
    render(
      <SplitButton
        label="+"
        singleMenuTrigger
        options={[
          { id: 'link', label: 'Link', onSelect: vi.fn() },
        ]}
        primaryButtonProps={{ 'aria-label': 'Add submission requirement' }}
      />
    )

    const trigger = screen.getByRole('button', { name: 'Add submission requirement' })
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')

    fireEvent.click(trigger)
    expect(screen.getByRole('menuitem', { name: 'Link' })).toHaveFocus()
  })

  it('renders dropdown below when menuPlacement is down', () => {
    render(
      <SplitButton
        label="Post"
        onPrimaryClick={vi.fn()}
        options={[
          { id: 'schedule', label: 'Schedule', onSelect: vi.fn() },
        ]}
        toggleAriaLabel="Choose action"
        menuPlacement="down"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Choose action' }))
    const menu = screen.getByRole('menu')
    expect(menu.className).toContain('top-full')
    expect(menu.className).not.toContain('bottom-full')
  })

  it('notifies option hover state and clears it when selected', () => {
    const onHoverChange = vi.fn()

    render(
      <SplitButton
        label="Post"
        onPrimaryClick={vi.fn()}
        options={[
          { id: 'schedule', label: 'Schedule', onSelect: vi.fn(), onHoverChange },
        ]}
        toggleAriaLabel="Choose action"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Choose action' }))
    const option = screen.getByRole('menuitem', { name: 'Schedule' })

    fireEvent.mouseEnter(option)
    expect(onHoverChange).toHaveBeenLastCalledWith(true)

    fireEvent.click(option)
    expect(onHoverChange).toHaveBeenLastCalledWith(false)
  })

  it('closes on Tab without trapping or returning focus, leaving external caret keys native', async () => {
    const user = userEvent.setup()
    render(<><SplitButton label="Actions" singleMenuTrigger options={[
      { id: 'one', label: 'First action', onSelect: vi.fn() },
      { id: 'two', label: 'Second action', onSelect: vi.fn() },
    ]} /><input aria-label="External text" /></>)
    await user.click(screen.getByRole('button', { name: 'Actions' }))
    expect(screen.getByRole('menuitem', { name: 'First action' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('menuitem', { name: 'Second action' })).toHaveAttribute('tabindex', '-1')
    await user.tab()
    const input = screen.getByRole('textbox', { name: 'External text' })
    expect(input).toHaveFocus()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    const event = new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true })
    input.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(input).toHaveFocus()
  })

  it('allows Shift-Tab to return to its trigger and closes without a focus trap', async () => {
    const user = userEvent.setup()
    render(<SplitButton label="Actions" singleMenuTrigger options={[
      { id: 'one', label: 'First action', onSelect: vi.fn() },
    ]} />)
    const trigger = screen.getByRole('button', { name: 'Actions' })
    await user.click(trigger)
    await user.tab({ shift: true })
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('keeps one enabled roving target when the active option becomes unavailable', () => {
    const options = [{ id: 'one', label: 'First action', onSelect: vi.fn() }, { id: 'two', label: 'Second action', onSelect: vi.fn() }]
    const { rerender } = render(<SplitButton label="Actions" singleMenuTrigger options={options} />)
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }))
    rerender(<SplitButton label="Actions" singleMenuTrigger options={[{ ...options[0], disabled: true }, options[1]]} />)
    expect(screen.getByRole('menuitem', { name: 'First action' })).toHaveAttribute('tabindex', '-1')
    expect(screen.getByRole('menuitem', { name: 'Second action' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('menuitem', { name: 'Second action' })).toHaveFocus()
  })

  it('closes when focus moves outside without stealing focus back', async () => {
    render(<><SplitButton label="Actions" singleMenuTrigger options={[
      { id: 'one', label: 'First action', onSelect: vi.fn() },
    ]} /><input aria-label="External text" /></>)
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }))
    const input = screen.getByRole('textbox', { name: 'External text' })
    input.focus()
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(input).toHaveFocus()
  })

  it('moves focus to the first enabled menu option when opened', () => {
    render(
      <SplitButton
        label="Post"
        onPrimaryClick={vi.fn()}
        options={[
          { id: 'draft', label: 'Draft', onSelect: vi.fn(), disabled: true },
          { id: 'schedule', label: 'Schedule', onSelect: vi.fn() },
          { id: 'publish', label: 'Publish now', onSelect: vi.fn() },
        ]}
        toggleAriaLabel="Choose action"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Choose action' }))

    expect(screen.getByRole('menuitem', { name: 'Schedule' })).toHaveFocus()
  })

  it('supports arrow, home, and end keyboard navigation across enabled menu options', () => {
    render(
      <SplitButton
        label="Post"
        onPrimaryClick={vi.fn()}
        options={[
          { id: 'draft', label: 'Draft', onSelect: vi.fn() },
          { id: 'schedule', label: 'Schedule', onSelect: vi.fn(), disabled: true },
          { id: 'publish', label: 'Publish now', onSelect: vi.fn() },
          { id: 'delete', label: 'Delete', onSelect: vi.fn(), destructive: true },
        ]}
        toggleAriaLabel="Choose action"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Choose action' }))

    const draft = screen.getByRole('menuitem', { name: 'Draft' })
    const publish = screen.getByRole('menuitem', { name: 'Publish now' })
    const deleteOption = screen.getByRole('menuitem', { name: 'Delete' })

    expect(draft).toHaveFocus()

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(publish).toHaveFocus()

    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    expect(deleteOption).toHaveFocus()

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(draft).toHaveFocus()

    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })
    expect(deleteOption).toHaveFocus()

    fireEvent.keyDown(document.activeElement!, { key: 'Home' })
    expect(draft).toHaveFocus()
  })

  it('keeps keyboard focus position when menu item focus causes a parent rerender', async () => {
    function RerenderingMenu() {
      const [, setHoveredItem] = useState<string | null>(null)
      return (
        <SplitButton
          label="Apply"
          onPrimaryClick={vi.fn()}
          options={[
            {
              id: 'grade',
              label: 'Apply Grade',
              onSelect: vi.fn(),
              onHoverChange: (active) => setHoveredItem(active ? 'grade' : null),
            },
            {
              id: 'comments',
              label: 'Apply Comments',
              onSelect: vi.fn(),
              onHoverChange: (active) => setHoveredItem(active ? 'comments' : null),
            },
          ]}
          toggleAriaLabel="Apply actions"
        />
      )
    }

    render(<RerenderingMenu />)

    fireEvent.click(screen.getByRole('button', { name: 'Apply actions' }))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'Apply Comments' })).toHaveFocus()
    })
  })

  it('closes with Escape and restores focus to the opener', () => {
    render(
      <SplitButton
        label="Add"
        onPrimaryClick={vi.fn()}
        primaryOpensMenu
        options={[
          { id: 'link', label: 'Link', onSelect: vi.fn() },
        ]}
      />
    )

    const primary = screen.getByRole('button', { name: 'Add' })
    fireEvent.click(primary)
    expect(screen.getByRole('menuitem', { name: 'Link' })).toHaveFocus()

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(primary).toHaveFocus()
  })

  it('closes its menu with Escape without closing a containing dialog', () => {
    const onClose = vi.fn()

    render(
      <DialogPanel isOpen onClose={onClose} ariaLabelledBy="assignment-title">
        <h2 id="assignment-title">Edit assignment</h2>
        <SplitButton
          label="+"
          singleMenuTrigger
          options={[{ id: 'link', label: 'Link', onSelect: vi.fn() }]}
          primaryButtonProps={{ 'aria-label': 'Add submission requirement' }}
        />
      </DialogPanel>
    )

    const trigger = screen.getByRole('button', { name: 'Add submission requirement' })
    fireEvent.click(trigger)
    const option = screen.getByRole('menuitem', { name: 'Link' })
    expect(option).toHaveFocus()

    fireEvent.keyDown(option, { key: 'Escape' })

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Edit assignment' })).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    expect(trigger).toHaveFocus()
  })

  it('does not restore focus to the opener when selected action opens a modal dialog', async () => {
    function DialogOpeningMenu() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <SplitButton
            label="Actions"
            onPrimaryClick={vi.fn()}
            options={[
              { id: 'confirm', label: 'Open confirm', onSelect: () => setOpen(true) },
            ]}
            toggleAriaLabel="More actions"
          />
          <DialogPanel isOpen={open} onClose={() => setOpen(false)} ariaLabelledBy="confirm-title">
            <h2 id="confirm-title">Confirm action</h2>
          </DialogPanel>
        </>
      )
    }

    render(<DialogOpeningMenu />)

    const toggle = screen.getByRole('button', { name: 'More actions' })
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open confirm' }))

    const dialog = await screen.findByRole('dialog', { name: 'Confirm action' })
    expect(dialog).toBeInTheDocument()
    await waitFor(() => expect(dialog).toHaveFocus())
    expect(toggle).not.toHaveFocus()
  })

  it('moves focus into a modal that opens after an async menu action', async () => {
    function AsyncDialogOpeningMenu() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <SplitButton
            label="Actions"
            onPrimaryClick={vi.fn()}
            options={[
              {
                id: 'schedule',
                label: 'Schedule',
                onSelect: () => {
                  window.setTimeout(() => setOpen(true), 20)
                },
              },
            ]}
            toggleAriaLabel="More actions"
          />
          <DialogPanel isOpen={open} onClose={() => setOpen(false)} ariaLabelledBy="schedule-title">
            <h2 id="schedule-title">Schedule release</h2>
          </DialogPanel>
        </>
      )
    }

    render(<AsyncDialogOpeningMenu />)

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Schedule' }))

    const dialog = await screen.findByRole('dialog', { name: 'Schedule release' })
    await waitFor(() => expect(dialog).toHaveFocus())
  })

  it('restores focus for normal actions from a menu inside an existing modal dialog', async () => {
    const onSelect = vi.fn()

    render(
      <DialogPanel isOpen onClose={vi.fn()} ariaLabelledBy="modal-title">
        <h2 id="modal-title">Edit assignment</h2>
        <SplitButton
          label="Add"
          onPrimaryClick={vi.fn()}
          options={[
            { id: 'link', label: 'Add link', onSelect },
          ]}
          toggleAriaLabel="Add submission"
        />
      </DialogPanel>
    )

    const toggle = screen.getByRole('button', { name: 'Add submission' })
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add link' }))

    expect(onSelect).toHaveBeenCalledOnce()
    expect(screen.getByRole('dialog', { name: 'Edit assignment' })).toBeInTheDocument()
    await waitFor(() => expect(toggle).toHaveFocus())
  })

  it('renders checked menu options and dividers', () => {
    render(
      <SplitButton
        label="View"
        onPrimaryClick={vi.fn()}
        options={[
          { id: 'percent', label: 'Show %', onSelect: vi.fn(), checked: true },
          { id: 'raw', label: 'Show Raw', onSelect: vi.fn(), checked: false },
          { id: 'copy', label: 'Copy emails', onSelect: vi.fn(), dividerBefore: true },
        ]}
        toggleAriaLabel="View actions"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'View actions' }))

    expect(screen.getByRole('menuitemradio', { name: 'Show %' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemradio', { name: 'Show Raw' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('separator')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Copy emails' })).toBeInTheDocument()
  })

  it('moves destructive menu options to the bottom under a separator', () => {
    render(
      <SplitButton
        label="Actions"
        onPrimaryClick={vi.fn()}
        options={[
          { id: 'delete-item', label: 'Delete', onSelect: vi.fn(), destructive: true },
          { id: 'copy', label: 'Copy', onSelect: vi.fn() },
          { id: 'archive', label: 'Archive', onSelect: vi.fn() },
        ]}
        toggleAriaLabel="More actions"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))

    const menu = screen.getByRole('menu')
    const items = within(menu).getAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual(['Copy', 'Archive', 'Delete'])

    const children = Array.from(menu.children)
    expect(children[0]).toBe(items[0])
    expect(children[1]).toBe(items[1])
    expect(children[2]).toHaveAttribute('role', 'separator')
    expect(children[3]).toBe(items[2])
  })
})


// Captured React callbacks model already queued events after a commit boundary.
function handlers(node: HTMLElement): Record<string, (...args: any[]) => void> {
  const key = Object.keys(node).find((name) => name.startsWith('__reactProps$'))!
  return (node as any)[key]
}

describe('SplitButton closing lifetime', () => {
  function motion(duration = '100ms', reduced = false) {
    const listeners = new Set<() => void>()
    const media = { matches: reduced, addEventListener: vi.fn((_name, fn) => listeners.add(fn)), removeEventListener: vi.fn((_name, fn) => listeners.delete(fn)) }
    const mediaSpy = vi.spyOn(window, 'matchMedia').mockReturnValue(media as any)
    const styleSpy = vi.spyOn(window, 'getComputedStyle').mockReturnValue({ getPropertyValue: () => duration } as any)
    return { media, reduce: () => { media.matches = true; listeners.forEach((fn) => fn()) }, cleanup: () => { mediaSpy.mockRestore(); styleSpy.mockRestore() } }
  }
  const props = (options = [{ id: 'one', label: 'First', onSelect: vi.fn(), checked: true }]) => ({ label: 'Actions', singleMenuTrigger: true, options, exitMotion: 'opacity' as const })
  const open = () => fireEvent.click(screen.getByRole('button', { name: 'Actions' }))
  const escape = () => fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })

  it('retires commands immediately and keeps only inaccessible inert presentation until expiry', () => {
    vi.useFakeTimers(); const env = motion(); const input = props(); const view = render(<SplitButton {...input} />)
    try {
      open(); const item = screen.getByRole('menuitemradio'); const old = handlers(item)
      escape()
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      const visual = view.container.querySelector('[data-menu-closing]')!
      expect(visual).toHaveAttribute('aria-hidden', 'true')
      expect((visual as HTMLElement).inert).toBe(true)
      expect(visual.querySelectorAll('button,[tabindex],[role]')).toHaveLength(0)
      act(() => { old.onClick({ stopPropagation() {} }); old.onFocus(); old.onMouseEnter() })
      expect(input.options[0].onSelect).not.toHaveBeenCalled()
      act(() => { vi.advanceTimersByTime(99) }); expect(visual).toBeInTheDocument()
      act(() => { vi.advanceTimersByTime(1) }); expect(visual).not.toBeInTheDocument()
    } finally { view.unmount(); env.cleanup(); vi.useRealTimers() }
  })

  it('rejects old generation callbacks after reopen and cancels an obsolete Tab close', () => {
    vi.useFakeTimers(); const env = motion(); const input = props(); const view = render(<SplitButton {...input} />)
    try {
      open(); const old = handlers(screen.getByRole('menuitemradio')); const oldKeys = handlers(view.container.firstElementChild as HTMLElement)
      fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab' }); escape(); open()
      act(() => { old.onClick({ stopPropagation() {} }); oldKeys.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} }); vi.runOnlyPendingTimers() })
      expect(input.options[0].onSelect).not.toHaveBeenCalled()
      expect(screen.getByRole('menu')).toBeInTheDocument()
    } finally { view.unmount(); env.cleanup(); vi.useRealTimers() }
  })

  it('uses committed current commands and hover rollover, and discards replacement snapshots', () => {
    const env = motion(); const first = vi.fn(); const next = vi.fn(); const hover = vi.fn(); const nextHover = vi.fn()
    const initial = [{ id: 'one', label: 'First', onSelect: first, onHoverChange: hover }]
    const view = render(<SplitButton {...props(initial as any)} />)
    try {
      open(); const old = handlers(screen.getByRole('menuitem'))
      view.rerender(<SplitButton {...props([{ id: 'one', label: 'First', onSelect: next, onHoverChange: nextHover }] as any)} />)
      expect(hover).not.toHaveBeenCalledWith(false)
      act(() => old.onClick({ stopPropagation() {} }))
      expect(first).not.toHaveBeenCalled(); expect(next).toHaveBeenCalledOnce()
      expect(nextHover).toHaveBeenLastCalledWith(false)
      expect(view.container.querySelector('[data-menu-closing]')).toBeInTheDocument()
      view.rerender(<SplitButton {...props(initial as any)} />)
      expect(view.container.querySelector('[data-menu-closing]')).not.toBeInTheDocument()
    } finally { view.unmount(); env.cleanup() }
  })

  it.each(['disabled', 'inactive', 'empty', 'allDisabled'] as const)('retires open and closing authority for %s without resurrection', (reason) => {
    const env = motion(); const input = props(); const view = render(<SplitButton {...input} />)
    try {
      open(); const old = handlers(screen.getByRole('menuitemradio')); escape()
      view.rerender(<SplitButton {...input} disabled={reason === 'disabled'} interactionActive={reason !== 'inactive'} options={reason === 'empty' ? [] : reason === 'allDisabled' ? input.options.map((option) => ({ ...option, disabled: true })) : input.options} />)
      expect(view.container.querySelector('[data-menu-closing]')).not.toBeInTheDocument()
      act(() => old.onClick({ stopPropagation() {} })); expect(input.options[0].onSelect).not.toHaveBeenCalled()
      view.rerender(<SplitButton {...input} />); expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    } finally { view.unmount(); env.cleanup() }
  })

  it('unmounts rich effectful labels immediately and falls back for caller icons', () => {
    const env = motion(); const cleanup = vi.fn()
    function Rich() { useEffect(() => cleanup, []); return <span>Rich</span> }
    const input = props([{ id: 'one', label: <Rich />, onSelect: vi.fn() }] as any)
    const view = render(<SplitButton {...input} />)
    try {
      open(); escape(); expect(cleanup).toHaveBeenCalledOnce(); expect(view.container.querySelector('[data-menu-closing]')).not.toBeInTheDocument()
      view.rerender(<SplitButton {...props([{ id: 'one', label: 'First', icon: <span>Icon</span>, onSelect: vi.fn() }] as any)} />)
      open(); escape(); expect(view.container.querySelector('[data-menu-closing]')).not.toBeInTheDocument()
    } finally { view.unmount(); env.cleanup() }
  })

  it.each(['0ms', 'invalid', '-1ms'])('removes immediately for %s duration', (duration) => {
    const env = motion(duration); const view = render(<SplitButton {...props()} />)
    try { open(); escape(); expect(view.container.querySelector('[data-menu-closing]')).not.toBeInTheDocument() }
    finally { view.unmount(); env.cleanup() }
  })

  it('supports seconds and removes immediately on a reduced-motion preference change with cleanup', () => {
    vi.useFakeTimers(); const env = motion('.1s'); const view = render(<SplitButton {...props()} />)
    try {
      open(); escape(); expect(view.container.querySelector('[data-menu-closing]')).toBeInTheDocument()
      act(() => env.reduce()); expect(view.container.querySelector('[data-menu-closing]')).not.toBeInTheDocument()
      expect(env.media.removeEventListener).toHaveBeenCalled()
      open(); escape(); expect(view.container.querySelector('[data-menu-closing]')).not.toBeInTheDocument()
    } finally { view.unmount(); env.cleanup(); vi.useRealTimers() }
  })

  it('keeps the default exit immediate and initial reduced motion immediate', () => {
    const env = motion('100ms', true); const input = props(); const view = render(<SplitButton {...input} exitMotion="immediate" />)
    try {
      open(); escape(); expect(view.container.querySelector('[data-menu-closing]')).not.toBeInTheDocument()
      view.rerender(<SplitButton {...input} />)
      open(); escape(); expect(view.container.querySelector('[data-menu-closing]')).not.toBeInTheDocument()
    } finally { view.unmount(); env.cleanup() }
  })

  it('clears preview ownership and rejects detached hover, focus, keyboard and commands on unmount', () => {
    const env = motion(); const onSelect = vi.fn(); const onHoverChange = vi.fn()
    const view = render(<SplitButton {...props([{ id: 'one', label: 'First', onSelect, onHoverChange }] as any)} />)
    open(); const old = handlers(screen.getByRole('menuitem')); const keys = handlers(view.container.firstElementChild as HTMLElement)
    view.unmount()
    expect(onHoverChange).toHaveBeenLastCalledWith(false)
    onHoverChange.mockClear()
    act(() => {
      old.onMouseEnter(); old.onMouseLeave(); old.onFocus(); old.onBlur(); old.onClick({ stopPropagation() {} })
      keys.onKeyDown({ key: 'ArrowDown', preventDefault() {}, stopPropagation() {} })
    })
    expect(onSelect).not.toHaveBeenCalled(); expect(onHoverChange).not.toHaveBeenCalled()
    env.cleanup()
  })

  it.each(['disabled', 'inactive', 'empty', 'allDisabled'] as const)('retires an open menu before paint for %s', (reason) => {
    const env = motion(); const input = props(); const view = render(<SplitButton {...input} />)
    try {
      open(); const old = handlers(screen.getByRole('menuitemradio'))
      view.rerender(<SplitButton {...input} disabled={reason === 'disabled'} interactionActive={reason !== 'inactive'} options={reason === 'empty' ? [] : reason === 'allDisabled' ? input.options.map((option) => ({ ...option, disabled: true })) : input.options} />)
      expect(screen.queryByRole('menu')).not.toBeInTheDocument(); expect(view.container.querySelector('[data-menu-closing]')).not.toBeInTheDocument()
      act(() => old.onClick({ stopPropagation() {} })); expect(input.options[0].onSelect).not.toHaveBeenCalled()
      view.rerender(<SplitButton {...input} />); expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    } finally { view.unmount(); env.cleanup() }
  })

  it('cancels and fences expired closing work after rapid reopen and a later close', () => {
    const env = motion(); const timeoutSpy = vi.spyOn(window, 'setTimeout'); const clearSpy = vi.spyOn(window, 'clearTimeout')
    const view = render(<SplitButton {...props()} />)
    try {
      open(); escape()
      const firstCallIndex = timeoutSpy.mock.calls.findLastIndex(([, duration]) => duration === 100)
      const oldFinish = timeoutSpy.mock.calls[firstCallIndex][0] as () => void
      const oldTimer = timeoutSpy.mock.results[firstCallIndex].value
      open(); expect(clearSpy).toHaveBeenCalledWith(oldTimer)
      escape(); act(() => oldFinish())
      expect(view.container.querySelector('[data-menu-closing]')).toBeInTheDocument()
      view.unmount(); expect(env.media.removeEventListener).toHaveBeenCalled()
    } finally { view.unmount(); env.cleanup(); timeoutSpy.mockRestore(); clearSpy.mockRestore() }
  })


  it('keeps committed menu authority through StrictMode effect replay', () => {
    const input = props(); const view = render(<StrictMode><SplitButton {...input} /></StrictMode>)
    open(); fireEvent.click(screen.getByRole('menuitemradio'))
    expect(input.options[0].onSelect).toHaveBeenCalledOnce()
    view.unmount()
  })


  it('releases a removed preview callback even while other menu options remain active', () => {
    const hover = vi.fn(); const initial = [{ id: 'one', label: 'First', onSelect: vi.fn(), onHoverChange: hover }, { id: 'two', label: 'Second', onSelect: vi.fn() }]
    const view = render(<SplitButton {...props(initial as any)} />)
    open(); expect(hover).toHaveBeenLastCalledWith(true)
    view.rerender(<SplitButton {...props([initial[1]] as any)} />)
    expect(hover).toHaveBeenLastCalledWith(false)
    expect(screen.getByRole('menuitem', { name: 'Second' })).toHaveFocus()
    view.unmount()
  })


  it('cancels and fences selection focus fallback before rapid reopening', () => {
    let oldFrame!: FrameRequestCallback
    const frameSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { oldFrame = callback; return 52 })
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    const input = props(); const view = render(<SplitButton {...input} exitMotion="immediate" />)
    try {
      open(); fireEvent.click(screen.getByRole('menuitemradio'))
      expect(frameSpy).toHaveBeenCalledOnce()
      open(); expect(cancelSpy).toHaveBeenCalledWith(52)
      act(() => { (document.activeElement as HTMLElement).blur(); oldFrame(0) })
      expect(screen.getByRole('button', { name: 'Actions' })).not.toHaveFocus()
      expect(screen.getByRole('menu')).toBeInTheDocument()
    } finally { view.unmount(); frameSpy.mockRestore(); cancelSpy.mockRestore() }
  })

})


describe('SplitButton reviewed deferred-work boundaries', () => {
  it('preserves native Shift-Tab dismissal when hover release rerenders inline options', async () => {
    function Parent() {
      const [hovered, setHovered] = useState(false)
      return <>
        <SplitButton label="Actions" singleMenuTrigger options={[
          { id: 'one', label: 'First', onSelect: vi.fn(), onHoverChange: setHovered },
        ]} />
        <span data-testid="preview">{String(hovered)}</span>
      </>
    }
    const user = userEvent.setup()
    render(<Parent />)
    const trigger = screen.getByRole('button', { name: 'Actions' })
    await user.click(trigger)
    expect(screen.getByTestId('preview')).toHaveTextContent('true')
    await user.tab({ shift: true })
    expect(trigger).toHaveFocus()
    expect(screen.getByTestId('preview')).toHaveTextContent('false')
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  // Synthetic late delivery verifies the retirement fence, not a browser race.
  it.each(['empty', 'allDisabled'] as const)('fences a cancelled selection frame after closed-menu %s retirement and reactivation', (reason) => {
    let oldFrame!: FrameRequestCallback
    const frameSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { oldFrame = callback; return 77 })
    const cancelSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    const options = [{ id: 'one', label: 'First', onSelect: vi.fn() }]
    const props = { label: 'Actions', singleMenuTrigger: true, options }
    const view = render(<SplitButton {...props} />)
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Actions' }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'First' }))
      expect(frameSpy).toHaveBeenCalledOnce()
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      view.rerender(<SplitButton {...props} options={reason === 'empty' ? [] : options.map((option) => ({ ...option, disabled: true }))} />)
      expect(cancelSpy).toHaveBeenCalledWith(77)
      view.rerender(<SplitButton {...props} />)
      const trigger = screen.getByRole('button', { name: 'Actions' })
      expect(trigger).not.toHaveFocus()
      act(() => oldFrame(0))
      expect(trigger).not.toHaveFocus()
    } finally { view.unmount(); frameSpy.mockRestore(); cancelSpy.mockRestore() }
  })

  it('keeps the split primary action enabled across secondary menu availability changes', () => {
    const onPrimaryClick = vi.fn()
    const options = [{ id: 'one', label: 'First', onSelect: vi.fn() }]
    const props = { label: 'Post', onPrimaryClick, options }
    const view = render(<SplitButton {...props} />)
    for (const nextOptions of [[], options.map((option) => ({ ...option, disabled: true })), options]) {
      view.rerender(<SplitButton {...props} options={nextOptions} />)
      const primary = screen.getByRole('button', { name: 'Post' })
      expect(primary).toBeEnabled()
      fireEvent.click(primary)
    }
    expect(onPrimaryClick).toHaveBeenCalledTimes(3)
    view.unmount()
  })

})
