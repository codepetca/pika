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
  it('keeps display preferences out of the account menu', async () => {
    renderUserMenu()

    fireEvent.click(screen.getByRole('button', { name: 'User menu' }))

    expect(screen.queryByRole('menuitemcheckbox', { name: 'Show markdown' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /dark mode|light mode|toggle theme/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Send Feedback' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Logout' })).toBeInTheDocument()
  })
})
