import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { StatusPatterns } from '@/app/__ui/StatusPatterns'
import { TooltipProvider } from '@/ui'

function renderPatterns() {
  return render(<TooltipProvider><StatusPatterns /></TooltipProvider>)
}

describe('Status catalog examples', () => {
  it('sorts matching sample rows first without filtering or adding icons to counts', async () => {
    const user = userEvent.setup()
    renderPatterns()
    const chip = screen.getByRole('button', { name: 'Sort Absent first, 1 student' })
    expect(chip.querySelector('svg')).toBeNull()
    expect(chip).toHaveTextContent('1')
    await user.click(chip)
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    const rows = within(screen.getByRole('table', { name: 'Sample attendance' })).getAllByRole('row')
    expect(rows).toHaveLength(6)
    expect(rows[1]).toHaveTextContent('Casey')
    expect(screen.getByRole('status')).toHaveTextContent('all 5 sample students remain visible')
  })

  it('uses keyboard row controls to update counts, retains zero counts, and resets the example', async () => {
    const user = userEvent.setup()
    renderPatterns()
    const blair = screen.getByRole('group', { name: 'Attendance status for Blair' })
    within(blair).getByRole('button', { name: 'Late', exact: true }).focus()
    await user.keyboard('{ArrowLeft}')
    expect(within(blair).getByRole('button', { name: 'Present', exact: true })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Sort Present first, 3 students' })).toHaveTextContent('3')
    expect(screen.getByRole('button', { name: 'Sort Late first, 0 students' })).toHaveTextContent('0')
    expect(screen.queryByRole('button', { name: /Sort Unmarked/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reset example' }))
    expect(screen.getByRole('button', { name: 'Sort Late first, 1 student' })).toHaveTextContent('1')
  })

  it('keeps grading, return, and check-in meanings explicit', () => {
    renderPatterns()
    expect(screen.getByText('Graded but not yet returned.')).toBeInTheDocument()
    expect(screen.getByText('Results released to the student.')).toBeInTheDocument()
    const returnedStatuses = screen.getAllByText('Returned', { exact: true })
    expect(returnedStatuses).toHaveLength(2)
    for (const label of returnedStatuses) {
      expect(label.parentElement?.querySelector('svg')).toHaveClass('lucide-reply', 'text-primary')
    }
    expect(screen.getByText('Closed for grading')).toBeInTheDocument()
    expect(screen.getByText(/Checked in confirmation is separate/)).toBeInTheDocument()
  })
})
