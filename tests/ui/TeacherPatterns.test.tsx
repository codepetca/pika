import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TeacherPatterns } from '@/app/__ui/TeacherPatterns'
import { TooltipProvider } from '@/ui'

function renderPatterns() {
  return render(<TooltipProvider><TeacherPatterns /></TooltipProvider>)
}

describe('Pattern Lab teacher-family examples', () => {
  it('uses a fixed reference date and the shared date-description contract', () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem')
    renderPatterns()

    expect(screen.getByRole('heading', { name: 'Daily date context (page-specific)' })).toBeInTheDocument()
    expect(screen.getByText(/Relative-date text is Daily-only/)).toBeInTheDocument()
    const date = screen.getByRole('button', { name: 'Go to reference today' })
    expect(date).toHaveTextContent('Fri Aug 28')
    expect(date).toHaveAccessibleDescription('2 days ago')
    fireEvent.click(screen.getByRole('button', { name: 'Previous example day' }))
    expect(date).toHaveAccessibleDescription('3 days ago')
    fireEvent.click(date)
    expect(date).toHaveAccessibleDescription('Today')
    fireEvent.click(screen.getByRole('button', { name: 'Next example day' }))
    expect(date).toHaveTextContent('Mon Aug 31')
    expect(date).not.toHaveAttribute('aria-describedby')
    expect(storage).not.toHaveBeenCalled()
    storage.mockRestore()
  })

  it('keeps the Lab display toggle temporary and removes hidden descriptions', () => {
    renderPatterns()
    const toggle = screen.getByRole('button', { name: 'Relative date' })
    const date = screen.getByRole('button', { name: 'Go to reference today' })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(date).not.toHaveAttribute('aria-describedby')
    expect(screen.queryByText('2 days ago')).not.toBeInTheDocument()
    expect(date.querySelector('[aria-hidden="true"]')).toBeNull()
    expect(date).not.toHaveClass('flex-col')
    fireEvent.click(toggle)
    expect(date).toHaveAccessibleDescription('2 days ago')
    expect(date).toHaveClass('flex-col')
  })

  it('keeps both attached panels mounted and delegates keyboard selection to the mode bar', () => {
    renderPatterns()
    const overview = screen.getByRole('tab', { name: 'Overview' })
    const details = screen.getByRole('tab', { name: 'Work details' })
    for (const tab of [overview, details]) {
      expect(document.getElementById(tab.getAttribute('aria-controls')!)).toHaveAttribute('role', 'tabpanel')
    }
    fireEvent.keyDown(overview, { key: 'ArrowRight' })
    expect(details).toHaveFocus()
    expect(details).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: 'Work details' })).toHaveTextContent('same selected work item')
    expect(screen.queryByRole('tabpanel', { name: 'Overview' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('tabpanel', { hidden: true })).toHaveLength(2)
  })

  it('discloses the continuous inspector with keyboard controls and returns focus on close', async () => {
    const user = userEvent.setup()
    renderPatterns()
    const example = screen.getByTestId('continuous-inspector-example')
    const alex = within(example).getByRole('button', { name: 'Alex Chen' })
    const sam = within(example).getByRole('button', { name: 'Sam Patel' })
    const inspector = example.querySelector('[data-workspace-inspector]')!
    expect(inspector).toHaveAttribute('inert')
    expect(within(example).queryByRole('button', { name: 'Close details' })).not.toBeInTheDocument()
    alex.focus()
    await user.keyboard('{Enter}')
    expect(alex).toHaveAttribute('aria-pressed', 'true')
    expect(inspector).not.toHaveAttribute('inert')
    await user.click(sam)
    expect(alex).toHaveAttribute('aria-pressed', 'false')
    expect(sam).toHaveAttribute('aria-pressed', 'true')
    expect(inspector).toHaveTextContent('Sam Patel')
    await user.click(within(example).getByRole('button', { name: 'Close details' }))
    expect(sam).toHaveFocus()
    expect(inspector).toHaveAttribute('inert')
    expect(sam).toHaveAttribute('aria-pressed', 'false')
    expect(within(example).queryByRole('button', { name: 'Close details' })).not.toBeInTheDocument()
  })

  it('shows the disabled selection guidance using the shared checkbox', () => {
    renderPatterns()
    expect(screen.getByRole('checkbox', { name: 'Select example student' })).toBeDisabled()
    expect(screen.getByRole('note', { name: 'Publish the test first to select students.' })).toBeInTheDocument()
  })
})
