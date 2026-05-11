import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  AssessmentStatusIndicator,
  getAssignmentWorkStatusDisplay,
  getGradebookAssessmentStatusDisplay,
  getTestGradingWorkStatusDisplay,
} from '@/components/AssessmentStatusIndicator'

describe('AssessmentStatusIndicator', () => {
  it('maps submitted assignment work to the shared submitted icon', () => {
    const display = getAssignmentWorkStatusDisplay('submitted_late')

    expect(display).toMatchObject({
      label: 'Submitted (late)',
      iconState: 'submitted',
      late: true,
    })
  })

  it('keeps returned assignment work on the returned icon while preserving late context', () => {
    const display = getAssignmentWorkStatusDisplay('returned', { wasLate: true })

    expect(display).toMatchObject({
      label: 'Returned (late)',
      iconState: 'returned',
      late: true,
    })
  })

  it('maps test grading statuses through the same icon states', () => {
    expect(getTestGradingWorkStatusDisplay('closed')).toMatchObject({
      label: 'Closed for grading',
      iconState: 'draft_graded',
    })
    expect(getTestGradingWorkStatusDisplay('submitted')).toMatchObject({
      label: 'Submitted',
      iconState: 'submitted',
    })
  })

  it('maps gradebook submitted statuses without using the returned icon', () => {
    expect(getGradebookAssessmentStatusDisplay('submitted')).toMatchObject({
      label: 'Submitted',
      iconState: 'submitted',
      late: false,
    })
    expect(getGradebookAssessmentStatusDisplay('submitted_late')).toMatchObject({
      label: 'Submitted late',
      iconState: 'submitted',
      late: true,
    })
  })

  it('renders icon and label from a shared display object', () => {
    const display = getGradebookAssessmentStatusDisplay('submitted')

    expect(display).not.toBeNull()
    render(<AssessmentStatusIndicator display={display!} />)

    expect(screen.getByTestId('assessment-status-icon-submitted')).toBeInTheDocument()
    expect(screen.getByText('Submitted')).toBeInTheDocument()
  })
})
