import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TeacherSurveyWorkspace } from '@/components/surveys/TeacherSurveyWorkspace'
import type { Survey } from '@/types'

function makeSurvey(overrides: Partial<Survey> = {}): Survey {
  return {
    id: 'survey-1',
    classroom_id: 'classroom-1',
    title: 'Game Jam Links',
    status: 'draft',
    opens_at: null,
    show_results: true,
    dynamic_responses: true,
    position: 0,
    created_by: 'teacher-1',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('TeacherSurveyWorkspace', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn(async (url: string | URL) => {
      const href = String(url)
      if (href.endsWith('/results')) {
        return {
          ok: true,
          json: async () => ({
            results: [],
            stats: { total_students: 0, responded: 0 },
          }),
        }
      }

      return {
        ok: true,
        json: async () => ({
          survey: makeSurvey(),
          questions: [],
        }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('honors an explicit markdown authoring mode', async () => {
    const onInitialEditModeConsumed = vi.fn()

    render(
      <TeacherSurveyWorkspace
        classroomId="classroom-1"
        surveyId="survey-1"
        initialEditMode="markdown"
        onInitialEditModeConsumed={onInitialEditModeConsumed}
        onBack={vi.fn()}
        onSurveyUpdated={vi.fn()}
        onSurveyDeleted={vi.fn()}
      />
    )

    const editor = await screen.findByTestId('survey-markdown-editor')
    const editorValue = (editor as HTMLTextAreaElement).value

    expect(editorValue).toContain('# Survey')
    expect(editorValue).toContain('Dynamic Responses: true')
    await waitFor(() => {
      expect(onInitialEditModeConsumed).toHaveBeenCalledTimes(1)
    })
  })

  it('saves title edits from the selected survey header', async () => {
    let surveyState = makeSurvey({ title: 'Untitled 2026-05-14 10:15:30' })
    fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const href = String(url)
      if (href.endsWith('/results')) {
        return {
          ok: true,
          json: async () => ({
            results: [],
            stats: { total_students: 0, responded: 0 },
          }),
        }
      }

      if (init?.method === 'PATCH') {
        surveyState = {
          ...surveyState,
          ...JSON.parse(String(init.body || '{}')),
        }
        return {
          ok: true,
          json: async () => ({ survey: surveyState }),
        }
      }

      return {
        ok: true,
        json: async () => ({
          survey: surveyState,
          questions: [],
        }),
      }
    })

    render(
      <TeacherSurveyWorkspace
        classroomId="classroom-1"
        surveyId="survey-1"
        onBack={vi.fn()}
        onSurveyUpdated={vi.fn()}
        onSurveyDeleted={vi.fn()}
      />
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Edit survey title' }))

    const titleInput = screen.getByLabelText('Survey title') as HTMLInputElement
    expect(titleInput.value).toBe('Untitled Survey')

    fireEvent.change(titleInput, { target: { value: 'Planning Poll' } })
    fireEvent.blur(titleInput)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/teacher/surveys/survey-1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ title: 'Planning Poll' }),
        }),
      )
    })
    expect(await screen.findByRole('button', { name: 'Edit survey title' })).toHaveTextContent('Planning Poll')
  })

  it('auto-selects the generated survey title when requested', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        survey: makeSurvey({ title: 'Untitled 2026-05-14 10:15:30' }),
        questions: [],
      }),
    })

    render(
      <TeacherSurveyWorkspace
        classroomId="classroom-1"
        surveyId="survey-1"
        autoEditTitle
        onBack={vi.fn()}
        onSurveyUpdated={vi.fn()}
        onSurveyDeleted={vi.fn()}
      />
    )

    const titleInput = await screen.findByLabelText('Survey title') as HTMLInputElement
    await waitFor(() => expect(titleInput).toHaveFocus())
    expect(titleInput.value).toBe('Untitled Survey')
    expect(titleInput.selectionStart).toBe(0)
    expect(titleInput.selectionEnd).toBe('Untitled Survey'.length)
  })

  it('hides response length editing for text survey questions', async () => {
    fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const href = String(url)
      if (href.endsWith('/results')) {
        return {
          ok: true,
          json: async () => ({
            results: [],
            stats: { total_students: 0, responded: 0 },
          }),
        }
      }

      if (init?.method === 'PATCH' && href.includes('/questions/question-1')) {
        const update = JSON.parse(String(init.body || '{}'))
        return {
          ok: true,
          json: async () => ({
            question: {
              id: 'question-1',
              survey_id: 'survey-1',
              question_type: update.question_type,
              question_text: update.question_text,
              options: update.options,
              response_max_chars: update.response_max_chars,
              position: 0,
              created_at: '2026-01-01T00:00:00.000Z',
              updated_at: '2026-01-01T00:00:00.000Z',
            },
          }),
        }
      }

      return {
        ok: true,
        json: async () => ({
          survey: makeSurvey(),
          questions: [
            {
              id: 'question-1',
              survey_id: 'survey-1',
              question_type: 'short_text',
              question_text: 'Share one note',
              options: [],
              response_max_chars: 1200,
              position: 0,
              created_at: '2026-01-01T00:00:00.000Z',
              updated_at: '2026-01-01T00:00:00.000Z',
            },
          ],
        }),
      }
    })

    render(
      <TeacherSurveyWorkspace
        classroomId="classroom-1"
        surveyId="survey-1"
        onBack={vi.fn()}
        onSurveyUpdated={vi.fn()}
        onSurveyDeleted={vi.fn()}
      />
    )

    expect(await screen.findByDisplayValue('Share one note')).toBeInTheDocument()
    expect(screen.queryByLabelText('Max characters')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByDisplayValue('Share one note'), {
      target: { value: 'Share one note today' },
    })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/teacher/surveys/survey-1/questions/question-1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            question_type: 'short_text',
            question_text: 'Share one note today',
            options: [],
            response_max_chars: 1200,
          }),
        }),
      )
    })
  })

  it('keeps survey results and visibility toggles out of the authoring workspace', async () => {
    render(
      <TeacherSurveyWorkspace
        classroomId="classroom-1"
        surveyId="survey-1"
        onBack={vi.fn()}
        onSurveyUpdated={vi.fn()}
        onSurveyDeleted={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Edit survey title' })).toBeInTheDocument()
    })
    expect(screen.queryByLabelText('Poll visibility')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Results visibility')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Allow live changes')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Results' })).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalledWith('/api/teacher/surveys/survey-1/results')
  })

  it('saves editable response changes from the authoring workspace', async () => {
    let surveyState = makeSurvey({ dynamic_responses: true })
    const onSurveyUpdated = vi.fn()
    fetchMock.mockImplementation(async (url: string | URL, init?: RequestInit) => {
      const href = String(url)
      if (href.endsWith('/results')) {
        return {
          ok: true,
          json: async () => ({
            results: [],
            stats: { total_students: 0, responded: 0 },
          }),
        }
      }

      if (init?.method === 'PATCH') {
        surveyState = {
          ...surveyState,
          ...JSON.parse(String(init.body || '{}')),
        }
        return {
          ok: true,
          json: async () => ({ survey: surveyState }),
        }
      }

      return {
        ok: true,
        json: async () => ({
          survey: surveyState,
          questions: [],
        }),
      }
    })

    render(
      <TeacherSurveyWorkspace
        classroomId="classroom-1"
        surveyId="survey-1"
        onBack={vi.fn()}
        onSurveyUpdated={onSurveyUpdated}
        onSurveyDeleted={vi.fn()}
      />
    )

    const checkbox = await screen.findByLabelText('Allow live changes') as HTMLInputElement
    expect(checkbox.checked).toBe(true)

    fireEvent.click(checkbox)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/teacher/surveys/survey-1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ dynamic_responses: false }),
        }),
      )
    })
    expect(onSurveyUpdated).toHaveBeenLastCalledWith(
      expect.objectContaining({ dynamic_responses: false }),
    )
  })
})
