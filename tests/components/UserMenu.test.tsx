import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { MarkdownPreferenceProvider } from '@/contexts/MarkdownPreferenceContext'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { UserMenu } from '@/components/UserMenu'

function renderUserMenu() {
  return render(
    <ThemeProvider>
      <MarkdownPreferenceProvider>
        <UserMenu user={{ email: 'teacher@example.com', role: 'teacher' }} />
      </MarkdownPreferenceProvider>
    </ThemeProvider>,
  )
}

describe('UserMenu', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('persists the show markdown checkbox preference', async () => {
    renderUserMenu()

    fireEvent.click(screen.getByRole('button', { name: 'User menu' }))

    const markdownToggle = await screen.findByRole('menuitemcheckbox', { name: 'Show markdown' })
    expect(markdownToggle).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(markdownToggle)

    await waitFor(() => {
      expect(markdownToggle).toHaveAttribute('aria-checked', 'false')
    })
    expect(window.localStorage.getItem('pika_show_markdown')).toBe('false')
  })
})
