import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { AssessmentStatusIcon } from '@/components/AssessmentStatusIcon'

describe('AssessmentStatusIcon', () => {
  it('renders submitted as the shared green circle status', () => {
    render(<AssessmentStatusIcon state="submitted" />)

    const icon = screen.getByTestId('assessment-status-icon-submitted')
    expect(icon).toHaveClass('text-success')
    expect(icon.querySelector('circle')).not.toBeNull()
  })

  it('renders returned as the primary return icon', () => {
    render(<AssessmentStatusIcon state="returned" />)

    expect(screen.getByTestId('assessment-status-icon-returned')).toHaveClass('text-primary')
  })

  it('adds a late clock without changing the base status', () => {
    render(<AssessmentStatusIcon state="submitted" late />)

    expect(screen.getByTestId('assessment-status-icon-submitted-late')).toHaveClass('text-success')
    expect(screen.getByTestId('assessment-status-icon-submitted')).toBeInTheDocument()
    expect(screen.getByTestId('assessment-status-icon-late-clock')).toBeInTheDocument()
  })
})
