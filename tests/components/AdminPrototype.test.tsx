import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminPrototype } from '@/app/__ui/AdminPrototype'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { TooltipProvider } from '@/ui'

function renderPrototype() {
  return render(<ThemeProvider><TooltipProvider><AdminPrototype /></TooltipProvider></ThemeProvider>)
}

describe('admin prototype', () => {
  it('moves from a filtered account inventory to a scoped plan preview without a live write', async () => {
    const user = userEvent.setup()
    renderPrototype()

    expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument()
    expect(screen.getByText('Fictional sample data')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Accounts' }))
    expect(screen.getByRole('heading', { name: 'Accounts' })).toHaveFocus()
    await user.type(screen.getByRole('textbox', { name: 'Find account' }), 'morgan')
    const inventory = screen.getByRole('table', { name: 'Sample account inventory' })
    expect(within(inventory).getByText('morgan@example.invalid')).toBeInTheDocument()
    expect(within(inventory).queryByText('alex@example.invalid')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'View morgan@example.invalid' }))
    expect(screen.getByRole('heading', { name: 'morgan@example.invalid' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'morgan@example.invalid' })).toHaveFocus()
    expect(screen.getByText('Account ID')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Preview plan change' }))
    expect(screen.getByRole('heading', { name: 'Preview plan change' })).toHaveFocus()
    await user.selectOptions(screen.getByRole('combobox', { name: 'Proposed plan' }), 'free')
    expect(screen.getByText('Current active classrooms remain available. New creation would stop.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm plan change' })).toBeDisabled()
  })

  it('shows unclassified and grant mismatch states without inferring a plan', async () => {
    const user = userEvent.setup()
    renderPrototype()
    await user.click(screen.getByRole('button', { name: 'Accounts' }))
    await user.click(screen.getByRole('button', { name: 'View sam@example.invalid' }))
    expect(screen.getByText('Unclassified')).toBeInTheDocument()
    expect(screen.getByText('No plan is assigned to this account.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back to accounts' }))
    expect(screen.getByRole('heading', { name: 'Accounts' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'View taylor@example.invalid' }))
    expect(screen.getByText('Plan/grant mismatch')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Preview plan change' }))
    expect(screen.getByText('Resolve the plan/grant mismatch before changing this plan.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Activity' }))
    expect(screen.getByRole('heading', { name: 'Activity' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Activity' })).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Activity' })).toHaveAttribute('aria-current', 'page')
  })

  it('uses the classroom-style sidebar to open plan guidance and return to accounts', async () => {
    const user = userEvent.setup()
    renderPrototype()

    const navigation = screen.getByRole('navigation', { name: 'Admin sections' })
    expect(within(navigation).getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')
    await user.click(within(navigation).getByRole('button', { name: 'Plans' }))
    expect(screen.getByRole('heading', { name: 'Plans' })).toHaveFocus()
    expect(within(navigation).getByRole('button', { name: 'Plans' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('Classroom creation limits by plan')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Browse accounts' }))
    expect(screen.getByRole('heading', { name: 'Accounts' })).toHaveFocus()
  })

  it('closes the classroom-style mobile drawer after choosing an admin section', async () => {
    const originalWidth = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
    try {
      const user = userEvent.setup()
      renderPrototype()
      await user.click(screen.getByRole('button', { name: 'Open admin navigation' }))
      const drawer = screen.getByRole('dialog', { name: 'Navigation menu' })
      expect(within(drawer).getByRole('button', { name: 'Accounts' })).toBeInTheDocument()
      await user.click(within(drawer).getByRole('button', { name: 'Plans' }))
      expect(screen.queryByRole('dialog', { name: 'Navigation menu' })).not.toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Plans' })).toHaveFocus()
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
    }
  })
})
