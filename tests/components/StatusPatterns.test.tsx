import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { StatusPatterns } from '@/app/__ui/StatusPatterns'
import { TooltipProvider } from '@/ui'

describe('StatusPatterns', () => {
  it('shows Test grading group counts alongside the status symbols and explains the combined group', () => {
    render(<TooltipProvider><StatusPatterns /></TooltipProvider>)

    const examples = screen.getByLabelText('Test grading status sort group examples')
    expect(within(examples).getByLabelText('Submitted: 1 student')).toHaveTextContent('1')
    expect(within(examples).getByLabelText('Returned: 1 student').querySelector('svg')).toHaveClass('lucide-reply')
    expect(within(examples).getByLabelText('Not submitted: 3 students').querySelector('svg')).toHaveClass('lucide-circle')
    expect(screen.getByText(/Not submitted combines Not started, In progress, and Closed for grading/)).toBeInTheDocument()
  })
})
