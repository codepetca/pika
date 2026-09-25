import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminPrototype } from '@/app/__ui/AdminPrototype'
import { ThemeProvider } from '@/contexts/ThemeContext'

function renderPrototype() {
  return render(<ThemeProvider><AdminPrototype /></ThemeProvider>)
}

describe('admin prototype', () => {
  it('moves from a filtered account inventory to a scoped plan preview without a live write', async () => {
    const user = userEvent.setup()
    renderPrototype()

    expect(screen.getByRole('heading', { name: 'Accounts' })).toBeInTheDocument()
    expect(screen.getByText('Fictional sample data')).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Find account' }), 'morgan')
    const inventory = screen.getByRole('table', { name: 'Sample account inventory' })
    expect(within(inventory).getByText('morgan@example.invalid')).toBeInTheDocument()
    expect(within(inventory).queryByText('alex@example.invalid')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'View morgan@example.invalid' }))
    expect(screen.getByRole('heading', { name: 'morgan@example.invalid' })).toBeInTheDocument()
    expect(screen.getByText('Account ID')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Preview plan change' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Proposed plan' }), 'free')
    expect(screen.getByText('Current active classrooms remain available. New creation would stop.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm plan change' })).toBeDisabled()
  })

  it('shows unclassified and grant mismatch states without inferring a plan', async () => {
    const user = userEvent.setup()
    renderPrototype()
    await user.click(screen.getByRole('button', { name: 'View sam@example.invalid' }))
    expect(screen.getByText('Unclassified')).toBeInTheDocument()
    expect(screen.getByText('No plan is assigned to this account.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back to accounts' }))
    await user.click(screen.getByRole('button', { name: 'View taylor@example.invalid' }))
    expect(screen.getByText('Plan/grant mismatch')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Preview plan change' }))
    expect(screen.getByText('Resolve the plan/grant mismatch before changing this plan.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Activity' }))
    expect(screen.getByRole('heading', { name: 'Plan activity' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Activity' })).toHaveAttribute('aria-current', 'page')
  })
})
