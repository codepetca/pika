import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { PageMockups } from '@/app/__ui/PageMockups'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { TooltipProvider } from '@/ui'

function renderMockups() {
  return render(<ThemeProvider><TooltipProvider><PageMockups /></TooltipProvider></ThemeProvider>)
}

describe('PageMockups', () => {
  it('keeps every named tab target mounted and supports keyboard tab changes', async () => {
    const user = userEvent.setup()
    renderMockups()
    const mockups = screen.getByTestId('page-mockups')
    for (const name of ['Gradebook', 'Calendar', 'Announcements', 'Roster']) {
      const tab = within(mockups).getByRole('tab', { name })
      expect(document.getElementById(tab.getAttribute('aria-controls')!)).toBeInTheDocument()
    }
    const gradebook = within(mockups).getByRole('tab', { name: 'Gradebook' })
    gradebook.focus()
    await user.keyboard('{ArrowRight}')
    expect(within(mockups).getByRole('tab', { name: 'Calendar' })).toHaveAttribute('aria-selected', 'true')
    expect(within(mockups).getByRole('tabpanel', { name: 'Calendar' })).toBeVisible()
  })

  it('retries local error state and explains prototype-only actions', async () => {
    const user = userEvent.setup()
    renderMockups()
    const mockups = screen.getByTestId('page-mockups')
    await user.selectOptions(within(mockups).getByRole('combobox', { name: 'Example state' }), 'error')
    await user.click(within(mockups).getByRole('button', { name: 'Try loading gradebook again' }))
    expect(within(mockups).getByRole('table')).toBeInTheDocument()
    await user.click(within(mockups).getByRole('checkbox', { name: 'Select Maya Chen' }))
    await user.click(within(mockups).getByRole('button', { name: 'Selected students (1)' }))
    await user.click(within(mockups).getByRole('menuitem', { name: 'Email 1 selected' }))
    expect(within(mockups).getByRole('status')).toHaveTextContent('Email students selected. Example only')
    await user.click(within(mockups).getByRole('tab', { name: 'Roster' }))
    await user.click(within(mockups).getByRole('button', { name: 'Add students' }))
    expect(within(mockups).getByRole('status')).toHaveTextContent('Add students selected. Example only')
  })
})
