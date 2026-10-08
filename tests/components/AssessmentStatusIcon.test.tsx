import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AssessmentStatusIcon } from '@/components/AssessmentStatusIcon'

describe('AssessmentStatusIcon', () => {
  it('keeps the progress ring decorative and accepts compact consumer sizing', () => {
    render(<AssessmentStatusIcon state="in_progress" className="!h-3.5 !w-3.5" />)

    const icon = screen.getByTestId('assessment-status-icon-in_progress')
    expect(icon).toHaveAttribute('aria-hidden', 'true')
    expect(icon).toHaveClass('!h-3.5', '!w-3.5')
    expect(icon.querySelectorAll('svg')).toHaveLength(2)
  })

  it('preserves the separate late clock alongside the partial progress ring', () => {
    render(<AssessmentStatusIcon state="in_progress" late />)

    const late = screen.getByTestId('assessment-status-icon-in_progress-late')
    expect(late).toContainElement(screen.getByTestId('assessment-status-icon-in_progress'))
    expect(late).toContainElement(screen.getByTestId('assessment-status-icon-late-clock'))
    expect(screen.getByTestId('assessment-status-icon-in_progress').querySelectorAll('svg')).toHaveLength(2)
  })

  it('renders submitted as the shared green circle status', () => {
    render(<AssessmentStatusIcon state="submitted" />)

    const icon = screen.getByTestId('assessment-status-icon-submitted')
    expect(icon).toHaveClass('text-success')
    expect(icon.querySelector('circle')).not.toBeNull()
  })

  it('renders returned as the primary return icon', () => {
    render(<AssessmentStatusIcon state="returned" />)

    expect(screen.getByTestId('assessment-status-icon-returned')).toHaveClass('text-primary', 'lucide-reply')
  })

  it('renders resubmitted as the warning resubmission icon', () => {
    render(<AssessmentStatusIcon state="resubmitted" />)

    expect(screen.getByTestId('assessment-status-icon-resubmitted')).toHaveClass('text-warning')
  })

  it('adds a late clock without changing the base status', () => {
    render(<AssessmentStatusIcon state="submitted" late />)

    expect(screen.getByTestId('assessment-status-icon-submitted-late')).toHaveClass('text-success')
    expect(screen.getByTestId('assessment-status-icon-submitted')).toBeInTheDocument()
    expect(screen.getByTestId('assessment-status-icon-late-clock')).toBeInTheDocument()
  })
})
