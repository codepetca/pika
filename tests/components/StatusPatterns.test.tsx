import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { StatusPatterns } from '@/app/__ui/StatusPatterns'
import { TooltipProvider } from '@/ui'

describe('StatusPatterns', () => {
  it('shows one Test grading group icon and count at a time', () => {
    render(<TooltipProvider><StatusPatterns /></TooltipProvider>)

    const examples = screen.getByLabelText('Test grading status sort group example')
    const currentButton = () => within(examples).getByRole('button')
    expect(within(examples).getAllByRole('button')).toHaveLength(1)
    expect(currentButton()).toHaveAccessibleName('Status: Submitted, 1 student. Sort Returned first')
    fireEvent.click(currentButton())
    expect(currentButton()).toHaveAccessibleName('Status: Returned, 1 student. Sort Not submitted first')
    expect(currentButton().querySelector('svg')).toHaveClass('lucide-reply')
    fireEvent.click(currentButton())
    expect(currentButton()).toHaveAccessibleName('Status: Not submitted, 3 students. Sort Submitted first')
    expect(currentButton().querySelector('svg')).toHaveClass('lucide-circle')
    expect(screen.getByText(/Not submitted combines Not started, In progress, and Closed for grading/)).toBeInTheDocument()
  })
})
