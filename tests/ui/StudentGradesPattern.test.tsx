import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { StudentGradesView } from '@/components/gradebook/StudentGradesView'
import { StudentGradesPattern } from '@/app/__ui/StudentGradesPattern'
import { TooltipProvider } from '@/ui'

function renderPattern() {
  return render(<TooltipProvider><StudentGradesPattern /></TooltipProvider>)
}

describe('Pattern Lab student Grades visibility concept', () => {
  it('supports keyboard operation for the production visibility action', async () => {
    const user = userEvent.setup()
    renderPattern()

    await user.tab()
    const visibility = screen.getByRole('switch', { name: 'Student grades visibility' })
    expect(visibility).toHaveFocus()
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Show grades to students')
    await user.keyboard(' ')
    expect(visibility).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('Current grade')).toBeVisible()
  })

  it('shows only the minimal returned-grade contract when enabled', () => {
    renderPattern()

    fireEvent.click(screen.getByRole('switch', { name: 'Student grades visibility' }))
    expect(screen.getByRole('switch', { name: 'Student grades visibility' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('Current grade')).toBeInTheDocument()
    expect(screen.getByText('84%')).toBeInTheDocument()
    expect(screen.getByText('Based on returned work and Gradebook marks')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Grades' })).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Grades' })).getByText('Not counted')).toBeInTheDocument()
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
    renderPattern()

    const visibility = screen.getByRole('switch', { name: 'Student grades visibility' })
    expect(visibility).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByText('Current grade')).not.toBeInTheDocument()
    expect(screen.getByText('Grades is hidden from student navigation.')).toBeInTheDocument()
    expect(screen.getByText('Returned feedback remains available in Classwork and Tests.')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Gradebook marks' })).toBeInTheDocument()

    await user.click(visibility)
    expect(visibility).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('Current grade')).toBeInTheDocument()
  })

  it('renders the production standalone list with deterministic zero and excluded marks', () => {
    renderPattern()
    expect(
      screen.getByText('Saved standalone marks appear in Classwork immediately and in Grades when enabled.'),
    ).toBeInTheDocument()
    const preview = within(screen.getByTestId('standalone-returned-marks-preview'))
    expect(preview.getByText('Attendance – Term 1')).toBeInTheDocument()
    expect(preview.getByText('0 / 10')).toBeInTheDocument()
    expect(preview.getByText('Not counted')).toBeInTheDocument()
    expect(preview.queryByRole('link')).not.toBeInTheDocument()
  })
})


it('presents a saved standalone zero in Grades without a feedback link', () => {
  render(<StudentGradesView grades={{ currentPercent: 0, items: [{ id: 'participation', kind: 'Gradebook item', title: 'Participation', earned: 0, possible: 10, percent: 0, included: true, href: null }] }} />)
  const list = within(screen.getByRole('list', { name: 'Grades' }))
  expect(list.getByText('Participation')).toBeVisible()
  expect(list.getByText('0 / 10')).toBeVisible()
  expect(list.queryByRole('link')).not.toBeInTheDocument()
  expect(screen.getByText('Based on returned work and Gradebook marks')).toBeVisible()
})
