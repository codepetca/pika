import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TeacherGradebookTab } from '@/app/classrooms/[classroomId]/TeacherGradebookTab'
import { TooltipProvider } from '@/ui'
import { createMockClassroom } from '../helpers/mocks'

vi.mock('@/lib/request-cache', () => ({
  fetchJSONWithCache: vi.fn((_key: string, load: () => Promise<unknown>) => load()),
  invalidateCachedJSONMatching: vi.fn(),
}))

function gradebookResponse() {
  return {
    settings: {
      use_weights: false,
      assignments_weight: 50,
      quizzes_weight: 20,
      tests_weight: 30,
    },
    assessment_columns: [
      {
        assessment_id: 'assignment-1',
        assessment_type: 'assignment',
        code: 'A1',
        title: 'Essay',
        possible: 10,
        weight: 10,
        include_in_final: true,
        due_at: '2025-01-01T12:00:00.000Z',
        is_draft: false,
      },
      {
        assessment_id: 'quiz-1',
        assessment_type: 'quiz',
        code: 'Q1',
        title: 'Quiz 1',
        possible: 10,
        weight: 10,
        include_in_final: true,
        status: 'closed',
      },
      {
        assessment_id: 'test-1',
        assessment_type: 'test',
        code: 'T1',
        title: 'Test 1',
        possible: 10,
        weight: 10,
        include_in_final: true,
        status: 'closed',
      },
    ],
    students: [
      {
        student_id: 'student-2',
        student_email: 'grace@example.com',
        student_number: '0002',
        student_first_name: 'Grace',
        student_last_name: 'Hopper',
        assignments_earned: 6,
        assignments_possible: 10,
        assignments_percent: 60,
        quizzes_earned: null,
        quizzes_possible: null,
        quizzes_percent: null,
        tests_earned: 8,
        tests_possible: 10,
        tests_percent: 80,
        final_percent: 70,
        assessment_scores: [
          {
            assessment_id: 'assignment-1',
            assessment_type: 'assignment',
            earned: 6,
            possible: 10,
            percent: 60,
            is_graded: true,
          },
          {
            assessment_id: 'quiz-1',
            assessment_type: 'quiz',
            earned: null,
            possible: 10,
            percent: null,
            is_graded: false,
          },
          {
            assessment_id: 'test-1',
            assessment_type: 'test',
            earned: 8,
            possible: 10,
            percent: 80,
            is_graded: true,
          },
        ],
      },
      {
        student_id: 'student-1',
        student_email: 'ada@example.com',
        student_number: '1001',
        student_first_name: 'Ada',
        student_last_name: 'Lovelace',
        assignments_earned: 8,
        assignments_possible: 10,
        assignments_percent: 80,
        quizzes_earned: null,
        quizzes_possible: null,
        quizzes_percent: null,
        tests_earned: 9,
        tests_possible: 10,
        tests_percent: 90,
        final_percent: 85,
        assessment_scores: [
          {
            assessment_id: 'assignment-1',
            assessment_type: 'assignment',
            earned: 8,
            possible: 10,
            percent: 80,
            is_graded: true,
            status: 'submitted_late',
          },
          {
            assessment_id: 'quiz-1',
            assessment_type: 'quiz',
            earned: 10,
            possible: 10,
            percent: 100,
            is_graded: true,
          },
          {
            assessment_id: 'test-1',
            assessment_type: 'test',
            earned: 9,
            possible: 10,
            percent: 90,
            is_graded: true,
          },
        ],
      },
    ],
    class_summary: {
      total_students: 2,
      average_final_percent: 77.5,
      assignments: [],
      quizzes: [],
      tests: [],
    },
  }
}

describe('TeacherGradebookTab', () => {
  const classroom = createMockClassroom()
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => gradebookResponse(),
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function renderGradebook(sectionParam: 'grades' | 'settings', onSectionChange = vi.fn()) {
    return render(
      <TooltipProvider>
        <TeacherGradebookTab
          classroom={classroom}
          sectionParam={sectionParam}
          onSectionChange={onSectionChange}
        />
      </TooltipProvider>,
    )
  }

  it('renders the assessment matrix and delegates settings navigation', async () => {
    const onSectionChange = vi.fn()

    const { rerender } = renderGradebook('grades', onSectionChange)

    expect(await screen.findByText('Ada')).toBeInTheDocument()
    expect(screen.getByText('Lovelace')).toBeInTheDocument()
    expect(screen.getByText('1001')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select all students' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /First/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Last' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'ID' })).toBeInTheDocument()
    expect(screen.getByText('A1')).toBeInTheDocument()
    expect(screen.getByText('Q1')).toBeInTheDocument()
    expect(screen.getByText('T1')).toBeInTheDocument()
    expect(screen.getByText('Jan 1')).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /Ada Lovelace.*1001.*80% 100% 90% 85\.0%/ })).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /Avg.*70% 100% 85% 77\.5%/ })).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /Med.*70% 100% 85% 77\.5%/ })).toBeInTheDocument()
    const percentToggle = screen.getByRole('button', { name: '%' })
    const rawToggle = screen.getByRole('button', { name: 'Raw' })
    expect(percentToggle).toHaveAttribute('aria-pressed', 'true')
    expect(rawToggle).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('button', { name: 'Summary' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Gradebook view' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('row', { name: /Ada Lovelace.*1001.*80% 100% 90% 85\.0%/ }))
    const detailPanel = screen.getByRole('region', { name: 'Ada Lovelace assessment details' })
    expect(within(detailPanel).getByText('Essay')).toBeInTheDocument()
    expect(within(detailPanel).getByText('Quiz 1')).toBeInTheDocument()
    expect(within(detailPanel).getByText('Test 1')).toBeInTheDocument()
    expect(within(detailPanel).getByText('Submitted late')).toBeInTheDocument()
    expect(within(detailPanel).getByTestId('assessment-status-icon-submitted-late')).toBeInTheDocument()
    expect(within(detailPanel).queryByTestId('assessment-status-icon-returned')).not.toBeInTheDocument()
    expect(within(detailPanel).getByText('8/10')).toBeInTheDocument()
    expect(within(detailPanel).getAllByText('100%').length).toBeGreaterThan(0)
    expect(within(detailPanel).queryByText('Score')).not.toBeInTheDocument()
    expect(within(detailPanel).queryByText('Possible')).not.toBeInTheDocument()
    expect(within(detailPanel).queryByText('Weight')).not.toBeInTheDocument()
    fireEvent.click(within(detailPanel).getByRole('button', { name: 'Close student details' }))
    expect(screen.queryByRole('region', { name: 'Ada Lovelace assessment details' })).not.toBeInTheDocument()

    expect(screen.getAllByRole('row')[1]).toHaveTextContent(/GraceHopper0002/)
    fireEvent.click(screen.getByRole('button', { name: 'ID' }))
    fireEvent.click(screen.getByRole('button', { name: 'ID' }))
    expect(screen.getAllByRole('row')[1]).toHaveTextContent(/AdaLovelace1001/)

    fireEvent.click(rawToggle)
    expect(screen.getByRole('row', { name: /Ada Lovelace.*1001.*8\/10 10\/10 9\/10 85\.0%/ })).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /Avg.*7\/10 10\/10 8\.5\/10 77\.5%/ })).toBeInTheDocument()
    expect(percentToggle).toHaveAttribute('aria-pressed', 'false')
    expect(rawToggle).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(percentToggle)
    expect(screen.getByRole('row', { name: /Ada Lovelace.*1001.*80% 100% 90% 85\.0%/ })).toBeInTheDocument()
    expect(percentToggle).toHaveAttribute('aria-pressed', 'true')
    expect(rawToggle).toHaveAttribute('aria-pressed', 'false')

    const settingsToggle = screen.getByRole('button', { name: 'Settings' })
    expect(settingsToggle).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(settingsToggle)

    expect(onSectionChange).toHaveBeenCalledWith('settings')
    expect(screen.queryByRole('checkbox', { name: 'Use category weights' })).not.toBeInTheDocument()
    expect(screen.queryByText('Visible columns')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Select all students' })).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'First' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Last' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'ID' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'A1' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Q1' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'T1' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Final' })).toBeChecked()
    expect(screen.getByRole('row', { name: /Visible.*First.*Last.*ID.*A1.*Q1.*T1.*Final/ })).toBeInTheDocument()
    const weightsRow = screen.getByRole('row', { name: /Weights.*10.*10.*10.*Total 30/ })
    expect(weightsRow).toBeInTheDocument()
    expect(within(weightsRow).getAllByText('33.3%')).toHaveLength(3)
    expect(within(weightsRow).getByText('100%')).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'A1 assessment weight' })).toHaveValue(10)
    expect(screen.getByRole('spinbutton', { name: 'Q1 assessment weight' })).toHaveValue(10)
    const avgRowToggle = screen.getByRole('checkbox', { name: 'Avg row' })
    const medRowToggle = screen.getByRole('checkbox', { name: 'Med row' })
    expect(avgRowToggle).toBeChecked()
    expect(medRowToggle).toBeChecked()

    const a1WeightInput = screen.getByRole('spinbutton', { name: 'A1 assessment weight' })
    fireEvent.change(a1WeightInput, { target: { value: '20' } })
    fireEvent.blur(a1WeightInput)
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/teacher/gradebook', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          classroom_id: classroom.id,
          assessment_type: 'assignment',
          assessment_id: 'assignment-1',
          gradebook_weight: 20,
        }),
      }))
    })

    fireEvent.click(screen.getByRole('checkbox', { name: 'Last' }))
    const adaEditRow = screen.getByRole('row', { name: /Ada Lovelace.*1001/ })
    expect(within(adaEditRow).getByText('Lovelace')).toBeInTheDocument()
    expect(adaEditRow).toHaveTextContent(/AdaLovelace100180%100%90%85\.0%/)

    fireEvent.click(screen.getByRole('checkbox', { name: 'A1' }))
    expect(screen.getByText('A1')).toBeInTheDocument()
    expect(within(adaEditRow).getByText('80%')).toBeInTheDocument()
    expect(adaEditRow).toHaveTextContent(/AdaLovelace100180%100%90%85\.0%/)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Final' }))
    expect(within(adaEditRow).getByText('85.0%')).toBeInTheDocument()

    fireEvent.click(avgRowToggle)
    expect(avgRowToggle).not.toBeChecked()
    expect(screen.getByRole('row', { name: /Avg.*70%.*100%.*85%/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.queryByRole('row', { name: /Avg/ })).not.toBeInTheDocument()
    expect(screen.getByRole('row', { name: /Med/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Last' })).not.toBeInTheDocument()
    expect(screen.queryByText('A1')).not.toBeInTheDocument()
    expect(screen.queryByText('Final')).not.toBeInTheDocument()

    rerender(
      <TooltipProvider>
        <TeacherGradebookTab
          classroom={classroom}
          sectionParam="settings"
          onSectionChange={onSectionChange}
        />
      </TooltipProvider>,
    )
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(`/api/teacher/gradebook?classroom_id=${classroom.id}`)
    })
  })

  it('renders edit controls with assessment weights only', async () => {
    renderGradebook('settings')

    expect(await screen.findByRole('spinbutton', { name: 'A1 assessment weight' })).toHaveValue(10)
    expect(screen.getByRole('spinbutton', { name: 'Q1 assessment weight' })).toHaveValue(10)
    expect(screen.getByRole('spinbutton', { name: 'T1 assessment weight' })).toHaveValue(10)
    expect(screen.getByRole('row', { name: /Weights.*10.*10.*10.*Total 30/ })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Use category weights' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Assignments')).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Avg row' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Med row' })).toBeChecked()
  })
})
