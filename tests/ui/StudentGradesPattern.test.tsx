import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { StudentGradesPattern } from '@/app/__ui/StudentGradesPattern'

describe('Pattern Lab student Grades visibility concept', () => {
  it('shows only the minimal returned-grade contract when enabled', () => {
    render(<StudentGradesPattern />)

    expect(screen.getByRole('switch', { name: 'Show grades to students' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('Current grade')).toBeInTheDocument()
    expect(screen.getByText('84%')).toBeInTheDocument()
    expect(screen.getByText('Based on returned work')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Returned grades' })).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Returned grades' })).getByText('Not counted')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Functions and Graphs/ })).toHaveAttribute(
      'href',
      '/classrooms/example-classroom?tab=tests',
    )
    expect(screen.getByRole('link', { name: /Field Study Reflection/ })).toHaveAttribute(
      'href',
      '/classrooms/example-classroom?tab=assignments&assignmentId=field-study',
    )
    expect(screen.getByRole('link', { name: /Practice Check/ })).toHaveAttribute(
      'href',
      '/classrooms/example-classroom?tab=assignments&assignmentId=practice-check',
    )
    expect(screen.queryByText(/trend/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/rank/i)).not.toBeInTheDocument()
  })

  it('removes the aggregate student area without retracting returned feedback', async () => {
    const user = userEvent.setup()
    render(<StudentGradesPattern />)

    const visibility = screen.getByRole('switch', { name: 'Show grades to students' })
    await user.click(visibility)

    expect(visibility).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByText('Current grade')).not.toBeInTheDocument()
    expect(screen.getByText('Grades is hidden from student navigation.')).toBeInTheDocument()
    expect(screen.getByText('Returned feedback remains available in Classwork and Tests.')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Returned marks' })).toBeInTheDocument()
  })

  it('renders the production standalone list with deterministic zero and excluded marks', () => {
    render(<StudentGradesPattern />)
    const preview = within(screen.getByTestId('standalone-returned-marks-preview'))
    expect(preview.getByText('Attendance – Term 1')).toBeInTheDocument()
    expect(preview.getByText('0 / 10')).toBeInTheDocument()
    expect(preview.getByText('Not counted')).toBeInTheDocument()
    expect(preview.queryByRole('link')).not.toBeInTheDocument()
  })
})
