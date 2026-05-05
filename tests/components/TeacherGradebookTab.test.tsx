import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TeacherGradebookTab } from '@/app/classrooms/[classroomId]/TeacherGradebookTab'
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
    students: [
      {
        student_id: 'student-1',
        student_email: 'ada@example.com',
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
      },
    ],
    class_summary: {
      total_students: 1,
      average_final_percent: 85,
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

  it('renders the Grades tab and delegates controlled section changes', async () => {
    const onSectionChange = vi.fn()

    render(
      <TeacherGradebookTab
        classroom={classroom}
        sectionParam="grades"
        onSectionChange={onSectionChange}
      />,
    )

    expect(await screen.findByText('Ada')).toBeInTheDocument()
    expect(screen.getByText('Lovelace')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Grades' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('checkbox', { name: 'Select all students' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /First/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Last/ })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Tests' })).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /Ada Lovelace .* 85\.0%/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }))

    expect(onSectionChange).toHaveBeenCalledWith('settings')
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(`/api/teacher/gradebook?classroom_id=${classroom.id}`)
    })
  })

  it('renders Settings with assignments, quizzes, and tests weights', async () => {
    render(<TeacherGradebookTab classroom={classroom} sectionParam="settings" />)

    expect(await screen.findByLabelText('Assignments')).toHaveValue(50)
    expect(screen.getByLabelText('Quizzes')).toHaveValue(20)
    expect(screen.getByLabelText('Tests')).toHaveValue(30)
    expect(screen.getByText('Total: 100%')).toBeInTheDocument()
  })
})
