import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { UserMenu } from '@/components/UserMenu'

function renderUserMenu() {
  return render(
    <ThemeProvider>
      <UserMenu user={{ email: 'teacher@example.com', role: 'teacher' }} />
    </ThemeProvider>,
  )
}

describe('UserMenu', () => {
  it('keeps the server account menu hidden before client-only relationships attach', () => {
    const container = document.createElement('div')
    container.innerHTML = renderToString(
      <ThemeProvider><UserMenu user={{ email: 'teacher@example.com', role: 'teacher' }} /></ThemeProvider>,
    )
    const trigger = container.querySelector('[aria-label="User menu"]')!
    const menu = container.querySelector('[role="menu"]')!
    expect(trigger).not.toHaveAttribute('id')
    expect(trigger).not.toHaveAttribute('aria-controls')
    expect(menu).not.toHaveAttribute('id')
    expect(menu).not.toHaveAttribute('aria-labelledby')
    expect(menu).toHaveAttribute('aria-hidden', 'true')
    expect(menu).toHaveClass('pointer-events-none', 'opacity-0')
  })

  it('keeps the closed account menu out of the accessibility tree', () => {
    renderUserMenu()

    const trigger = screen.getByRole('button', { name: 'User menu' })

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(document.getElementById(trigger.getAttribute('aria-controls') ?? '')).toHaveAttribute('aria-hidden', 'true')
    expect(document.getElementById(trigger.getAttribute('aria-controls') ?? '')).toHaveAttribute('inert')
  })

  it('keeps display preferences out of the account menu', async () => {
    renderUserMenu()

    const trigger = screen.getByRole('button', { name: 'User menu' })
    expect(trigger).toHaveClass('min-h-11', 'min-w-11')
    fireEvent.click(trigger)

    expect(screen.queryByRole('menuitemcheckbox', { name: 'Show markdown' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /dark mode|light mode|toggle theme/i })).toHaveClass('min-h-11')
    expect(screen.getByRole('menuitem', { name: 'Send Feedback' })).toHaveClass('min-h-11')
    const logout = screen.getByRole('menuitem', { name: 'Logout' })
    expect(logout).toHaveClass('min-h-11')
    expect(logout.closest('form')).toHaveAttribute('action', '/api/auth/workos/logout')
    expect(logout.closest('form')).toHaveAttribute('method', 'post')
  })

  it('closes with Escape and outside click while restoring focus to the trigger', () => {
    renderUserMenu()

    const trigger = screen.getByRole('button', { name: 'User menu' })
    fireEvent.click(trigger)
    const themeToggle = screen.getByRole('menuitem', { name: /dark mode|light mode|toggle theme/i })
    expect(themeToggle).toHaveFocus()

    fireEvent.keyDown(themeToggle, { key: 'Escape' })

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()

    fireEvent.click(trigger)
    expect(screen.getByRole('menu')).toBeInTheDocument()

    fireEvent.mouseDown(document.body)

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('does not steal focus on outside clicks while closed', () => {
    render(
      <>
        <button type="button">Outside target</button>
        <ThemeProvider>
          <UserMenu user={{ email: 'teacher@example.com', role: 'teacher' }} />
        </ThemeProvider>
      </>,
    )

    const outsideTarget = screen.getByRole('button', { name: 'Outside target' })
    outsideTarget.focus()

    fireEvent.mouseDown(document.body)

    expect(outsideTarget).toHaveFocus()
    expect(screen.getByRole('button', { name: 'User menu' })).not.toHaveFocus()
  })

  it('keeps only the keyboard-selected menu item in the Tab order', () => {
    renderUserMenu()
    fireEvent.click(screen.getByRole('button', { name: 'User menu' }))
    const items = screen.getAllByRole('menuitem')
    expect(items.map((item) => item.tabIndex)).toEqual([0, -1, -1])
    fireEvent.keyDown(items[0], { key: 'End' })
    expect(items[2]).toHaveFocus()
    expect(items.map((item) => item.tabIndex)).toEqual([-1, -1, 0])
    fireEvent.keyDown(items[2], { key: 'Home' })
    expect(items[0]).toHaveFocus()
    expect(items.map((item) => item.tabIndex)).toEqual([0, -1, -1])
  })

  it('returns feedback dialog focus to the visible account trigger', () => {
    renderUserMenu()
    const trigger = screen.getByRole('button', { name: 'User menu' })
    fireEvent.click(trigger)
    const feedback = screen.getByRole('menuitem', { name: 'Send Feedback' })
    feedback.focus()
    fireEvent.click(feedback)
    const dialog = screen.getByRole('dialog')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})
