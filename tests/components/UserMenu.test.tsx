import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
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
  it('keeps the closed account menu out of the accessibility tree', () => {
    renderUserMenu()

    const trigger = screen.getByRole('button', { name: 'User menu' })

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(document.getElementById(trigger.getAttribute('aria-controls') ?? '')).toHaveAttribute('aria-hidden', 'true')
  })

  it('keeps display preferences out of the account menu', async () => {
    renderUserMenu()

    fireEvent.click(screen.getByRole('button', { name: 'User menu' }))

    expect(screen.queryByRole('menuitemcheckbox', { name: 'Show markdown' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /dark mode|light mode|toggle theme/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Send Feedback' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Logout' })).toBeInTheDocument()
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
})
