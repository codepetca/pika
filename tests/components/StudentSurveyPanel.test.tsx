import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StudentSurveyPanel } from '@/components/surveys/StudentSurveyPanel'

describe('StudentSurveyPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      const href = String(url)
      if (href.endsWith('/results')) {
        return {
          ok: true,
          json: async () => ({
            results: [
              {
                question_id: 'question-1',
                question_type: 'multiple_choice',
                question_text: 'Pick one',
                options: ['A', 'B'],
                counts: [1, 0],
                responses: [],
                total_responses: 1,
              },
            ],
          }),
        }
      }

      return {
        ok: true,
        json: async () => ({
          survey: {
            id: 'survey-1',
            classroom_id: 'classroom-1',
            title: 'Quick Poll',
            status: 'active',
            opens_at: null,
            show_results: true,
            dynamic_responses: false,
            position: 0,
            student_status: 'can_view_results',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
          questions: [
            {
              id: 'question-1',
              survey_id: 'survey-1',
              question_type: 'multiple_choice',
              question_text: 'Pick one',
              options: ['A', 'B'],
              response_max_chars: 500,
              position: 0,
              created_at: '2026-01-01T00:00:00.000Z',
              updated_at: '2026-01-01T00:00:00.000Z',
            },
          ],
          student_status: 'can_view_results',
          has_submitted: false,
          student_responses: {},
        }),
      }
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows available class results first and exposes a response action', async () => {
    render(<StudentSurveyPanel surveyId="survey-1" />)

    expect(await screen.findByRole('heading', { name: 'Quick Poll' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Submit' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Respond' })).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Class results' })).toBeInTheDocument()
    })
    expect(await screen.findByText('1 (100%)')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Respond' }))
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View results' })).toBeInTheDocument()
  })
})
