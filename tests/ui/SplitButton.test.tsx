import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { SplitButton } from '@/ui'

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

  it('opens menu and runs selected option action', () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'Choose action' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Schedule' }))

    expect(onSelectSchedule).toHaveBeenCalledOnce()
    expect(onPrimaryClick).not.toHaveBeenCalled()
    expect(screen.queryByRole('menuitem', { name: 'Schedule' })).not.toBeInTheDocument()
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
