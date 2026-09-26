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
  it('finds an account and shows its observed state without tier controls', async () => {
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
    expect(screen.getByRole('heading', { name: 'morgan@example.invalid' })).toHaveFocus()
    expect(screen.getByText('Grant source')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Automation status' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /change plan|change tier|confirm/i })).not.toBeInTheDocument()
  })

  it('opens an exception, explains the automated response, and links to account context', async () => {
    const user = userEvent.setup()
    renderPrototype()

    await user.click(screen.getByRole('button', { name: 'View exceptions' }))
    expect(screen.getByRole('heading', { name: 'Exceptions' })).toHaveFocus()
    expect(screen.getByText('Provisioning is still pending')).toBeInTheDocument()
    expect(screen.getByText('Entitlement does not match the tier')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Inspect sam@example.invalid' }))
    expect(screen.getByRole('heading', { name: 'Provisioning is still pending' })).toHaveFocus()
    expect(screen.getByText('An automatic retry is scheduled. No operator change has been made.')).toBeInTheDocument()
    expect(screen.getByText('Check whether the next run completes and records an entitlement.')).toBeInTheDocument()
    expect(screen.getByText('Unclassified')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'View account' }))
    expect(screen.getByRole('heading', { name: 'sam@example.invalid' })).toHaveFocus()
    expect(screen.getByText('Creation grant').nextElementSibling).toHaveTextContent('—')
  })

  it('filters automation status, reports an empty result, and shows chronological activity', async () => {
    const user = userEvent.setup()
    renderPrototype()

    await user.click(screen.getByRole('button', { name: 'Accounts' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Automation status' }), 'investigate')
    const inventory = screen.getByRole('table', { name: 'Sample account inventory' })
    expect(within(inventory).getByText('taylor@example.invalid')).toBeInTheDocument()
    expect(within(inventory).queryByText('sam@example.invalid')).not.toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Find account' }), 'missing')
    expect(screen.getByRole('status')).toHaveTextContent('No sample accounts match this search.')
    await user.click(screen.getByRole('button', { name: 'Activity' }))
    expect(screen.getByRole('heading', { name: 'Activity' })).toHaveFocus()
    expect(screen.getByText('Tier sync completed')).toBeInTheDocument()
    expect(screen.getByText('Entitlement discrepancy detected')).toBeInTheDocument()
    expect(screen.getAllByText('Automated workflow')).toHaveLength(4)
    expect(screen.getByRole('button', { name: 'Activity' })).toHaveAttribute('aria-current', 'page')
  })

  it('does not offer a control that changes the shared app theme preference', async () => {
    localStorage.setItem('theme', 'light')
    try {
      const user = userEvent.setup()
      renderPrototype()
      expect(screen.queryByRole('button', { name: /theme/i })).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Exceptions' }))
      await user.click(screen.getByRole('button', { name: 'Inspect sam@example.invalid' }))
      expect(localStorage.getItem('theme')).toBe('light')
    } finally {
      localStorage.removeItem('theme')
    }
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
      await user.click(within(drawer).getByRole('button', { name: 'Exceptions' }))
      expect(screen.queryByRole('dialog', { name: 'Navigation menu' })).not.toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Exceptions' })).toHaveFocus()
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth })
    }
  })

  it('does not change the classroom sidebar preference when the prototype rail collapses', async () => {
    document.cookie = 'pika_left_sidebar=expanded; Path=/'
    try {
      const user = userEvent.setup()
      renderPrototype()
      await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
      expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
      expect(document.cookie).toContain('pika_left_sidebar=expanded')
    } finally {
      document.cookie = 'pika_left_sidebar=; Path=/; Max-Age=0'
    }
  })
})
