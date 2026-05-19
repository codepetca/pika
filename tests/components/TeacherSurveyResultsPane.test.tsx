import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { TeacherSurveyResultsPane } from '@/components/surveys/TeacherSurveyResultsPane'
import type { SurveyWithStats } from '@/types'

function makeSurvey(overrides: Partial<SurveyWithStats> = {}): SurveyWithStats {
  return {
    id: 'survey-1',
    classroom_id: 'classroom-1',
    title: 'Planning Poll',
    status: 'active',
    opens_at: null,
    show_results: true,
    dynamic_responses: false,
    position: 0,
    created_by: 'teacher-1',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    stats: { total_students: 2, responded: 0, questions_count: 1 },
    ...overrides,
  }
}

describe('TeacherSurveyResultsPane', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows the survey title in the results card and puts percentages inside option bars', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        stats: { total_students: 2, responded: 2 },
        results: [
          {
            question_id: 'question-1',
            question_type: 'multiple_choice',
            question_text: 'Pick one',
            options: ['A', 'B'],
            counts: [1, 1],
            responses: [],
            total_responses: 2,
          },
        ],
      }),
    })))

    render(<TeacherSurveyResultsPane survey={makeSurvey()} />)

    expect(await screen.findByRole('heading', { name: 'Planning Poll' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Results' })).toBeInTheDocument()
    expect(screen.queryByText('0/2 responded')).not.toBeInTheDocument()
    expect(screen.queryByText('2 of 2 students responded')).not.toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getAllByText('50%')).toHaveLength(2)
    })
    expect(screen.queryByText('1 (50%)')).not.toBeInTheDocument()
  })
})
