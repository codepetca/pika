import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import type { ReactNode } from 'react'
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

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

function jsonResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as Response
}

function createMountedRoot() {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  return {
    render: (node: ReactNode) => root.render(node),
    cleanup: () => {
      root.unmount()
      host.remove()
    },
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

  it('ignores stale detail responses after selected survey changes', async () => {
    const staleDetail = createDeferred<Response>()
    const currentDetail = createDeferred<Response>()

    fetchMock.mockImplementation((url: string | URL) => {
      const href = String(url)
      if (href.endsWith('/api/teacher/surveys/survey-stale')) return staleDetail.promise
      if (href.endsWith('/api/teacher/surveys/survey-current')) return currentDetail.promise
      throw new Error(`Unexpected fetch: ${href}`)
    })

    const { rerender } = render(
      <TeacherSurveyWorkspace
        classroomId="classroom-1"
        surveyId="survey-stale"
        onBack={vi.fn()}
        onSurveyUpdated={vi.fn()}
        onSurveyDeleted={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/teacher/surveys/survey-stale')
    })

    rerender(
      <TeacherSurveyWorkspace
        classroomId="classroom-1"
        surveyId="survey-current"
        onBack={vi.fn()}
        onSurveyUpdated={vi.fn()}
        onSurveyDeleted={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/teacher/surveys/survey-current')
    })

    await act(async () => {
      currentDetail.resolve(jsonResponse({
        survey: makeSurvey({ id: 'survey-current', title: 'Current Survey' }),
        questions: [{
          id: 'question-current',
          survey_id: 'survey-current',
          question_type: 'short_text',
          question_text: 'Current survey question',
          options: [],
          response_max_chars: 1200,
          position: 0,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        }],
      }))
      await currentDetail.promise
    })

    expect(await screen.findByRole('button', { name: 'Edit survey title' })).toHaveTextContent('Current Survey')
    expect(screen.getByDisplayValue('Current survey question')).toBeInTheDocument()

    await act(async () => {
      staleDetail.resolve(jsonResponse({
        survey: makeSurvey({ id: 'survey-stale', title: 'Stale Survey' }),
        questions: [{
          id: 'question-stale',
          survey_id: 'survey-stale',
          question_type: 'short_text',
          question_text: 'Stale survey question',
          options: [],
          response_max_chars: 1200,
          position: 0,
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        }],
      }))
      await staleDetail.promise
    })

    expect(screen.getByRole('button', { name: 'Edit survey title' })).toHaveTextContent('Current Survey')
    expect(screen.getByDisplayValue('Current survey question')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('Stale survey question')).not.toBeInTheDocument()
  })

  it('hides loaded detail immediately when selected survey changes', async () => {
    const currentDetail = createDeferred<Response>()

    fetchMock.mockImplementation((url: string | URL) => {
      const href = String(url)
      if (href.endsWith('/api/teacher/surveys/survey-stale')) {
        return Promise.resolve(jsonResponse({
          survey: makeSurvey({ id: 'survey-stale', title: 'Already Loaded Stale Survey' }),
          questions: [{
            id: 'question-stale',
            survey_id: 'survey-stale',
            question_type: 'short_text',
            question_text: 'Already loaded stale question',
            options: [],
            response_max_chars: 1200,
            position: 0,
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          }],
        }))
      }
      if (href.endsWith('/api/teacher/surveys/survey-current')) return currentDetail.promise
      throw new Error(`Unexpected fetch: ${href}`)
    })

    const mounted = createMountedRoot()
    try {
      await act(async () => {
        mounted.render(
          <TeacherSurveyWorkspace
            classroomId="classroom-1"
            surveyId="survey-stale"
            onBack={vi.fn()}
            onSurveyUpdated={vi.fn()}
            onSurveyDeleted={vi.fn()}
          />
        )
      })

      expect(await screen.findByDisplayValue('Already loaded stale question')).toBeInTheDocument()

      flushSync(() => {
        mounted.render(
          <TeacherSurveyWorkspace
            classroomId="classroom-1"
            surveyId="survey-current"
            onBack={vi.fn()}
            onSurveyUpdated={vi.fn()}
            onSurveyDeleted={vi.fn()}
          />
        )
      })

      expect(screen.queryByDisplayValue('Already loaded stale question')).not.toBeInTheDocument()

      await act(async () => {
        currentDetail.resolve(jsonResponse({
          survey: makeSurvey({ id: 'survey-current', title: 'Current Survey' }),
          questions: [{
            id: 'question-current',
            survey_id: 'survey-current',
            question_type: 'short_text',
            question_text: 'Current loaded question',
            options: [],
            response_max_chars: 1200,
            position: 0,
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          }],
        }))
        await currentDetail.promise
      })

      expect(await screen.findByDisplayValue('Current loaded question')).toBeInTheDocument()
    } finally {
      mounted.cleanup()
    }
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

    const editor = await screen.findByLabelText('Survey markdown editor')
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

  it('previews the survey from the authoring workspace without saving preview responses', async () => {
    fetchMock.mockImplementation(async (url: string | URL) => {
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
          survey: makeSurvey({ title: 'Exit Ticket' }),
          questions: [
            {
              id: 'question-1',
              survey_id: 'survey-1',
              question_type: 'multiple_choice',
              question_text: 'Can you attend?',
              options: ['Yes', 'No'],
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

    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }))

    expect(screen.getByRole('heading', { name: 'Exit Ticket' })).toBeInTheDocument()
    expect(screen.getByText('Student preview')).toBeInTheDocument()
    expect(screen.getByText('Can you attend?')).toBeInTheDocument()

    const yesOption = screen.getByRole('button', { name: 'Yes' })
    expect(yesOption).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(yesOption)

    expect(yesOption).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled()
    expect(fetchMock).not.toHaveBeenCalledWith(
      '/api/teacher/surveys/survey-1',
      expect.objectContaining({ method: 'PATCH' }),
    )
  })

  it('renders setup previews as student-only preview content', async () => {
    fetchMock.mockImplementation(async (url: string | URL) => {
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
          survey: makeSurvey({ title: 'Exit Ticket' }),
          questions: [
            {
              id: 'question-1',
              survey_id: 'survey-1',
              question_type: 'short_text',
              question_text: 'What should we revisit?',
              options: [],
              response_max_chars: 500,
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
        initialEditMode="preview"
        previewOnly
        onBack={vi.fn()}
        onSurveyUpdated={vi.fn()}
        onSurveyDeleted={vi.fn()}
      />
    )

    expect(await screen.findByText('Student preview')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Exit Ticket' })).toBeInTheDocument()
    expect(screen.getByText('What should we revisit?')).toBeInTheDocument()
    expect(screen.queryByLabelText('Allow live changes')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Code' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save due' })).not.toBeInTheDocument()
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
