import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PageActionBar, type ActionBarItem } from '@/components/PageLayout'

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
    expect(menuButton).toHaveAttribute('aria-expanded', 'false')
    expect(menuButton.parentElement?.parentElement).toHaveClass('sm:hidden')
  })

  it('opens mobile actions, groups destructive items last, and closes after selection', () => {
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
    expect(menu).toHaveClass('absolute', 'right-0', 'z-20', 'mt-2', 'w-56')

    const menuItems = within(menu).getAllByRole('menuitem')
    expect(menuItems.map((item) => item.textContent)).toEqual(['Archive', 'Delete'])
    expect(menuItems[1].parentElement).toHaveClass('border-t', 'border-border')

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Archive' }))

    expect(onArchive).toHaveBeenCalledOnce()
    expect(onDelete).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(menuButton).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes the mobile actions menu on escape and outside click', () => {
    renderActionBar([
      { id: 'archive', label: 'Archive', onSelect: vi.fn() },
    ])

    const menuButton = screen.getByRole('button', { name: 'Open actions menu' })

    fireEvent.click(menuButton)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    fireEvent.click(menuButton)
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('preserves disabled mobile actions without firing their handlers', () => {
    const onArchive = vi.fn()

    renderActionBar([
      { id: 'archive', label: 'Archive', disabled: true, onSelect: onArchive },
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Open actions menu' }))
    const item = screen.getByRole('menuitem', { name: 'Archive' })

    expect(item).toBeDisabled()
    fireEvent.click(item)
    expect(onArchive).not.toHaveBeenCalled()
    expect(screen.getByRole('menu')).toBeInTheDocument()
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
