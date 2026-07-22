import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { DialogPanel, SplitButton } from '@/ui'

describe('SplitButton', () => {
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
      'min-h-11',
      'focus-visible:ring-2',
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

    fireEvent.keyDown(window, { key: 'ArrowDown' })
    expect(publish).toHaveFocus()

    fireEvent.keyDown(window, { key: 'End' })
    expect(deleteOption).toHaveFocus()

    fireEvent.keyDown(window, { key: 'ArrowDown' })
    expect(draft).toHaveFocus()

    fireEvent.keyDown(window, { key: 'ArrowUp' })
    expect(deleteOption).toHaveFocus()

    fireEvent.keyDown(window, { key: 'Home' })
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
    fireEvent.keyDown(window, { key: 'ArrowDown' })

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

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(primary).toHaveFocus()
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
