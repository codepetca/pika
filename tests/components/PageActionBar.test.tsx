import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PageActionBar, type ActionBarItem } from '@/ui'

function renderActionBar(actions: ActionBarItem[], actionsAlign: 'start' | 'end' = 'end') {
  return render(
    <PageActionBar
      primary={<div>Primary content</div>}
      actions={actions}
      actionsAlign={actionsAlign}
      trailing={<button type="button">Trailing action</button>}
    />,
  )
}

describe('PageActionBar', () => {
  it('renders desktop actions and mobile overflow menu containers with responsive classes', () => {
    renderActionBar([
      { id: 'archive', label: 'Archive', onSelect: vi.fn() },
      { id: 'delete', label: 'Delete', destructive: true, onSelect: vi.fn() },
    ])

    const desktopActions = screen.getByRole('button', { name: 'Archive' }).parentElement
    expect(desktopActions).toHaveClass('hidden', 'sm:flex', 'justify-end')

    const menuButton = screen.getByRole('button', { name: 'Open actions menu' })
    expect(menuButton).toHaveAttribute('aria-haspopup', 'menu')
    expect(menuButton).toHaveAttribute('aria-controls')
    expect(menuButton).toHaveAttribute('aria-expanded', 'false')
    expect(menuButton.parentElement?.parentElement).toHaveClass('sm:hidden')
    expect(menuButton).toHaveClass('h-11', 'w-11')
  })

  it('opens mobile actions, groups destructive items last, and closes after selection', async () => {
    const onArchive = vi.fn()
    const onDelete = vi.fn()

    renderActionBar([
      { id: 'delete', label: 'Delete', destructive: true, onSelect: onDelete },
      { id: 'archive', label: 'Archive', onSelect: onArchive },
    ])

    const menuButton = screen.getByRole('button', { name: 'Open actions menu' })
    fireEvent.click(menuButton)

    expect(menuButton).toHaveAttribute('aria-expanded', 'true')
    const menu = screen.getByRole('menu')
    expect(menuButton).toHaveAttribute('aria-controls', menu.id)
    expect(menu).toHaveClass('absolute', 'right-0', 'z-20', 'mt-2', 'w-56')

    const menuItems = within(menu).getAllByRole('menuitem')
    expect(menuItems.map((item) => item.textContent)).toEqual(['Archive', 'Delete'])
    expect(menuItems[1].parentElement).toHaveClass('border-t', 'border-border')
    expect(menuItems[0]).toHaveClass('min-h-11', 'focus-visible:ring-2')
    await waitFor(() => {
      expect(within(menu).getByRole('menuitem', { name: 'Archive' })).toHaveFocus()
    })

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Archive' }))

    expect(onArchive).toHaveBeenCalledOnce()
    expect(onDelete).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(menuButton).toHaveAttribute('aria-expanded', 'false')
    expect(menuButton).toHaveFocus()
  })

  it('supports keyboard navigation and returns focus to the trigger on escape', async () => {
    renderActionBar([
      { id: 'archive', label: 'Archive', onSelect: vi.fn() },
      { id: 'disabled', label: 'Disabled', disabled: true, onSelect: vi.fn() },
      { id: 'delete', label: 'Delete', destructive: true, onSelect: vi.fn() },
    ])

    const menuButton = screen.getByRole('button', { name: 'Open actions menu' })

    fireEvent.click(menuButton)
    const menu = screen.getByRole('menu')
    const archiveItem = within(menu).getByRole('menuitem', { name: 'Archive' })
    const deleteItem = within(menu).getByRole('menuitem', { name: 'Delete' })

    await waitFor(() => {
      expect(archiveItem).toHaveFocus()
    })

    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(deleteItem).toHaveFocus()

    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(archiveItem).toHaveFocus()

    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(deleteItem).toHaveFocus()

    fireEvent.keyDown(menu, { key: 'Home' })
    expect(archiveItem).toHaveFocus()

    fireEvent.keyDown(menu, { key: 'End' })
    expect(deleteItem).toHaveFocus()

    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(menuButton).toHaveFocus()
  })

  it('activates the focused menu item with the keyboard and restores trigger focus', async () => {
    const user = userEvent.setup()
    const onArchive = vi.fn()
    renderActionBar([{ id: 'archive', label: 'Archive', onSelect: onArchive }])

    const menuButton = screen.getByRole('button', { name: 'Open actions menu' })
    await user.click(menuButton)
    const archiveItem = screen.getByRole('menuitem', { name: 'Archive' })
    await waitFor(() => expect(archiveItem).toHaveFocus())

    await user.keyboard('{Enter}')

    expect(onArchive).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(menuButton).toHaveAttribute('aria-expanded', 'false')
    expect(menuButton).toHaveFocus()
  })

  it('closes the mobile actions menu on escape and outside click', async () => {
    renderActionBar([
      { id: 'archive', label: 'Archive', onSelect: vi.fn() },
    ])

    const menuButton = screen.getByRole('button', { name: 'Open actions menu' })

    fireEvent.click(menuButton)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: 'Archive' })).toHaveFocus()
    })
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(menuButton).toHaveFocus()

    fireEvent.click(menuButton)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(menuButton).toHaveFocus()
  })

  it('disables the mobile overflow trigger when every action is unavailable', () => {
    const onArchive = vi.fn()

    renderActionBar([
      { id: 'archive', label: 'Archive', disabled: true, onSelect: onArchive },
    ])

    const menuButton = screen.getByRole('button', { name: 'Open actions menu' })

    expect(menuButton).toBeDisabled()
    expect(menuButton).not.toHaveAttribute('aria-controls')
    fireEvent.click(menuButton)
    expect(onArchive).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('supports start-aligned desktop action groups while retaining the mobile menu', () => {
    renderActionBar(
      [
        { id: 'archive', label: 'Archive', onSelect: vi.fn() },
      ],
      'start',
    )

    const desktopActions = screen.getByRole('button', { name: 'Archive' }).parentElement
    expect(desktopActions).toHaveClass('hidden', 'sm:flex', 'justify-start')
    expect(screen.getByRole('button', { name: 'Open actions menu' }).parentElement?.parentElement).toHaveClass(
      'sm:hidden',
    )
  })
})
