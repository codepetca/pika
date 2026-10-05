import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { useState, type ReactNode } from 'react'
import { TeacherSurveyWorkspace } from '@/components/surveys/TeacherSurveyWorkspace'
import type { Survey, SurveyQuestion } from '@/types'

vi.mock('@/ui', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/ui')>(),
  Tooltip: ({ children }: { children: ReactNode }) => children,
}))

vi.mock('@/components/editor', () => ({
  MarkdownContentEditor: ({ markdown, onMarkdownChange, readOnly, disabled, ...props }: {
    markdown: string; onMarkdownChange: (value: string) => void; readOnly?: boolean; disabled?: boolean; 'aria-label'?: string
  }) => <textarea aria-label={props['aria-label']} value={markdown} disabled={readOnly || disabled} onChange={(event) => onMarkdownChange(event.target.value)} />,
}))

function selectQuestion(number: number) {
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Question number' }), { target: { value: String(number) } })
  fireEvent.blur(screen.getByRole('spinbutton', { name: 'Question number' }))
}

function questionAction(name: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Question actions', exact: true }))
  fireEvent.click(screen.getByRole('menuitem', { name, exact: true }))
}

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

function makeQuestion(overrides: Partial<SurveyQuestion> = {}): SurveyQuestion {
  return {
    id: 'question-1',
    survey_id: 'survey-1',
    question_type: 'multiple_choice',
    question_text: 'Choose a project',
    options: ['Game', 'Website'],
    response_max_chars: 500,
    position: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
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

    expect(await screen.findByLabelText('Survey title')).toHaveValue('Current Survey')
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

    expect(screen.getByLabelText('Survey title')).toHaveValue('Current Survey')
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

    await screen.findByLabelText('Survey title')

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
    expect(await screen.findByLabelText('Survey title')).toHaveValue('Planning Poll')
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

  it('focuses the generated title after the parent consumes the initial editor intent', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      survey: makeSurvey({ title: 'Untitled 2026-05-14 10:15:30' }),
      questions: [],
    }))
    const onIntentConsumed = vi.fn()
    function CreationParent() {
      const [pendingIntent, setPendingIntent] = useState(true)
      return (
        <TeacherSurveyWorkspace
          classroomId="classroom-1"
          surveyId="survey-1"
          initialEditMode={pendingIntent ? 'edit' : undefined}
          autoEditTitle={pendingIntent}
          onInitialEditModeConsumed={() => {
            onIntentConsumed()
            setPendingIntent(false)
          }}
          onBack={vi.fn()}
          onSurveyUpdated={vi.fn()}
          onSurveyDeleted={vi.fn()}
        />
      )
    }
    render(<CreationParent />)

    const title = await screen.findByLabelText('Survey title') as HTMLInputElement
    await waitFor(() => {
      expect(onIntentConsumed).toHaveBeenCalledTimes(1)
      expect(title).toHaveValue('Untitled Survey')
      expect(title).toHaveFocus()
      expect(title.selectionStart).toBe(0)
      expect(title.selectionEnd).toBe('Untitled Survey'.length)
    })
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === 'PATCH')).toHaveLength(0)
  })

  it('preserves response length when editing a text survey question', async () => {
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
    expect(screen.getByLabelText('Response character limit')).toHaveValue(1200)
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
      expect(screen.getByLabelText('Survey title')).toBeInTheDocument()
    })
    expect(screen.queryByLabelText('Poll visibility')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Results visibility')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Settings', exact: true })).toBeInTheDocument()
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

    expect(await screen.findByRole('heading', { name: 'Exit Ticket' })).toBeInTheDocument()
    expect(screen.getByText('Student preview')).toBeInTheDocument()
    expect(within(screen.getByTestId('survey-editor-content-pane')).getByText('Can you attend?')).toBeInTheDocument()

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

  it('shows one question at a time with number navigation and compact details', async () => {
    const second = makeQuestion({ id: 'question-2', question_type: 'short_text', question_text: 'Explain your choice', options: [], position: 1 })
    fetchMock.mockResolvedValue(jsonResponse({ survey: makeSurvey(), questions: [makeQuestion(), second] }))
    render(<TeacherSurveyWorkspace classroomId="classroom-1" surveyId="survey-1" onBack={vi.fn()} onSurveyUpdated={vi.fn()} onSurveyDeleted={vi.fn()} />)
    expect(await screen.findByDisplayValue('Choose a project')).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Question number' })).toHaveValue(1)
    expect(screen.queryByRole('navigation', { name: 'Survey questions' })).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('Explain your choice')).not.toBeInTheDocument()
    selectQuestion(2)
    expect(await screen.findByDisplayValue('Explain your choice')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('Choose a project')).not.toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Question number' })).toHaveValue(2)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each(['Next question', 'Add open-response question', 'Markdown', 'Preview', 'Close survey editor', 'Publish', 'Duplicate question'])(
    'waits for the pending question save before %s', async (destination) => {
      const save = createDeferred<Response>()
      const first = makeQuestion()
      const second = makeQuestion({ id: 'question-2', question_type: 'short_text', question_text: 'Explain your choice', options: [], position: 1 })
      const onBack = vi.fn()
      fetchMock.mockImplementation((_url: string | URL, init?: RequestInit) => {
        if (init?.method === 'PATCH' && String(_url).includes('/questions/')) return save.promise
        if (init?.method === 'PATCH') return Promise.resolve(jsonResponse({ survey: makeSurvey({ status: 'active' }) }))
        if (init?.method === 'POST') return Promise.resolve(jsonResponse({ question: makeQuestion({ id: 'question-copy', position: 2, question_text: 'Choose your next project' }) }))
        return Promise.resolve(jsonResponse({ survey: makeSurvey(), questions: [first, second] }))
      })
      render(<TeacherSurveyWorkspace classroomId="classroom-1" surveyId="survey-1" onBack={onBack} onSurveyUpdated={vi.fn()} onSurveyDeleted={vi.fn()} />)
      fireEvent.change(await screen.findByDisplayValue('Choose a project'), { target: { value: 'Choose your next project' } })
      if (destination === 'Add open-response question' || destination === 'Duplicate question') questionAction(destination)
      else fireEvent.click(screen.getByRole('button', { name: destination, exact: true }))
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/teacher/surveys/survey-1/questions/question-1', expect.objectContaining({
        method: 'PATCH', body: JSON.stringify({ question_type: 'multiple_choice', question_text: 'Choose your next project', options: ['Game', 'Website'], response_max_chars: 500 }),
      })))
      expect(screen.getByDisplayValue('Choose your next project')).toBeInTheDocument()
      expect(onBack).not.toHaveBeenCalled()
      expect(fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(0)
      await act(async () => { save.resolve(jsonResponse({ question: { ...first, question_text: 'Choose your next project' } })); await save.promise })
      if (destination === 'Next question') expect(await screen.findByDisplayValue('Explain your choice')).toBeInTheDocument()
      else if (destination === 'Add open-response question') expect(await screen.findByLabelText('New question')).toBeInTheDocument()
      else if (destination === 'Markdown') expect(await screen.findByLabelText('Survey markdown editor')).toBeInTheDocument()
      else if (destination === 'Preview') expect(await screen.findByText('Student preview')).toBeInTheDocument()
      else if (destination === 'Close survey editor') await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1))
      else if (destination === 'Publish') await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/teacher/surveys/survey-1', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ status: 'active' }) })))
      else await waitFor(() => expect(fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1))
      expect(fetchMock.mock.calls.filter((call) => call[1]?.method === 'PATCH' && String(call[0]).includes('/questions/'))).toHaveLength(1)
    },
  )

  it('blocks navigation after a failed save and retries on the next explicit navigation', async () => {
    const failedSave = createDeferred<Response>()
    const first = makeQuestion()
    const second = makeQuestion({ id: 'question-2', question_type: 'short_text', question_text: 'Explain your choice', options: [], position: 1 })
    let attempts = 0
    fetchMock.mockImplementation((_url: string | URL, init?: RequestInit) => {
      if (init?.method === 'PATCH') return ++attempts === 1 ? failedSave.promise : Promise.resolve(jsonResponse({ question: { ...first, question_text: 'Updated project question' } }))
      return Promise.resolve(jsonResponse({ survey: makeSurvey(), questions: [first, second] }))
    })
    render(<TeacherSurveyWorkspace classroomId="classroom-1" surveyId="survey-1" onBack={vi.fn()} onSurveyUpdated={vi.fn()} onSurveyDeleted={vi.fn()} />)
    fireEvent.change(await screen.findByDisplayValue('Choose a project'), { target: { value: 'Updated project question' } })
    selectQuestion(2)
    await waitFor(() => expect(attempts).toBe(1))
    await act(async () => { failedSave.resolve({ ok: false, json: async () => ({ error: 'Question save failed' }) } as Response); await failedSave.promise })
    expect(await screen.findByText('Question save failed')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Updated project question')).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Question number' })).toHaveValue(1)
    fireEvent.click(screen.getByRole('button', { name: 'Next question' }))
    expect(await screen.findByDisplayValue('Explain your choice')).toBeInTheDocument()
    expect(attempts).toBe(2)
  })

  it.each([
    { type: 'multiple_choice', action: 'Add multiple-choice question', prompt: 'Choose a project', options: ['Game', 'Website'] },
    { type: 'short_text', action: 'Add open-response question', prompt: 'Explain your choice', options: [] },
  ] as const)('adds a $type question using the existing API', async ({ type, action, prompt, options }) => {
    const onQuestionCountChanged = vi.fn()
    fetchMock.mockImplementation(async (_url: string | URL, init?: RequestInit) => jsonResponse(init?.method === 'POST'
      ? { question: makeQuestion({ question_type: type, question_text: prompt, options: [...options] }) }
      : { survey: makeSurvey(), questions: [] }))
    render(<TeacherSurveyWorkspace classroomId="classroom-1" surveyId="survey-1" onBack={vi.fn()} onSurveyUpdated={vi.fn()} onSurveyDeleted={vi.fn()} onQuestionCountChanged={onQuestionCountChanged} />)
    await screen.findByLabelText('New question')
    questionAction(action)
    fireEvent.change(await screen.findByLabelText('New question'), { target: { value: prompt } })
    if (type === 'multiple_choice') {
      fireEvent.change(screen.getByLabelText('Option A'), { target: { value: options[0] } })
      fireEvent.change(screen.getByLabelText('Option B'), { target: { value: options[1] } })
    }
    fireEvent.click(screen.getByRole('button', { name: 'Add question', exact: true }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/teacher/surveys/survey-1/questions', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ question_type: type, question_text: prompt, options: [...options], response_max_chars: 500 }),
    })))
    expect(await screen.findByLabelText('Prompt')).toHaveValue(prompt)
    expect(screen.queryByLabelText('New question')).not.toBeInTheDocument()
    expect(onQuestionCountChanged).toHaveBeenCalledWith('survey-1', 1)
  })

  it('keeps incomplete multiple-choice questions local until prompt and two options are valid', async () => {
    render(<TeacherSurveyWorkspace classroomId="classroom-1" surveyId="survey-1" onBack={vi.fn()} onSurveyUpdated={vi.fn()} onSurveyDeleted={vi.fn()} />)
    fireEvent.change(await screen.findByLabelText('New question'), { target: { value: 'Choose one' } })
    fireEvent.change(screen.getByLabelText('Option A'), { target: { value: 'First choice' } })
    expect(screen.getByRole('button', { name: 'Add question', exact: true })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Add question', exact: true }))
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(0)
    fireEvent.change(screen.getByLabelText('Option B'), { target: { value: 'Second choice' } })
    expect(screen.getByRole('button', { name: 'Add question', exact: true })).not.toBeDisabled()
  })

  it('deletes the selected question and shows a new form after deleting the last question', async () => {
    const onQuestionCountChanged = vi.fn()
    const second = makeQuestion({ id: 'question-2', question_type: 'short_text', question_text: 'Explain your choice', options: [], position: 1 })
    fetchMock.mockImplementation(async (_url: string | URL, init?: RequestInit) => jsonResponse(init?.method === 'DELETE' ? { success: true } : { survey: makeSurvey(), questions: [makeQuestion(), second] }))
    render(<TeacherSurveyWorkspace classroomId="classroom-1" surveyId="survey-1" onBack={vi.fn()} onSurveyUpdated={vi.fn()} onSurveyDeleted={vi.fn()} onQuestionCountChanged={onQuestionCountChanged} />)
    await screen.findByLabelText('Prompt')
    selectQuestion(2)
    await screen.findByDisplayValue('Explain your choice')
    questionAction('Delete question')
    expect(await screen.findByDisplayValue('Choose a project')).toBeInTheDocument()
    expect(onQuestionCountChanged).toHaveBeenLastCalledWith('survey-1', 1)
    questionAction('Delete question')
    expect(await screen.findByLabelText('New question')).toBeInTheDocument()
    expect(onQuestionCountChanged).toHaveBeenLastCalledWith('survey-1', 0)
  })

  it('disables all question mutations in a read-only workspace', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ survey: makeSurvey(), questions: [makeQuestion()] }))
    render(<TeacherSurveyWorkspace classroomId="classroom-1" surveyId="survey-1" isReadOnly onBack={vi.fn()} onSurveyUpdated={vi.fn()} onSurveyDeleted={vi.fn()} />)
    expect(await screen.findByLabelText('Prompt')).toBeDisabled()
    expect(screen.getByLabelText('Option A')).toBeDisabled()
    expect(screen.getByLabelText('Survey title')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Settings', exact: true })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Question actions', exact: true })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Publish', exact: true })).toBeDisabled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('ignores a question save completing after the selected survey changes', async () => {
    const pendingSave = createDeferred<Response>()
    const currentQuestion = makeQuestion({ id: 'question-current', survey_id: 'survey-current', question_text: 'Current survey prompt' })
    fetchMock.mockImplementation((_url: string | URL, init?: RequestInit) => {
      if (init?.method === 'PATCH') return pendingSave.promise
      return Promise.resolve(jsonResponse(String(_url).endsWith('/survey-current')
        ? { survey: makeSurvey({ id: 'survey-current', title: 'Current survey' }), questions: [currentQuestion] }
        : { survey: makeSurvey(), questions: [makeQuestion()] }))
    })
    const onBack = vi.fn()
    const onSurveyUpdated = vi.fn()
    const view = render(<TeacherSurveyWorkspace classroomId="classroom-1" surveyId="survey-1" onBack={onBack} onSurveyUpdated={onSurveyUpdated} onSurveyDeleted={vi.fn()} />)
    fireEvent.change(await screen.findByLabelText('Prompt'), { target: { value: 'Older pending edit' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close survey editor' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/teacher/surveys/survey-1/questions/question-1', expect.objectContaining({ method: 'PATCH' })))
    view.rerender(<TeacherSurveyWorkspace classroomId="classroom-1" surveyId="survey-current" onBack={onBack} onSurveyUpdated={onSurveyUpdated} onSurveyDeleted={vi.fn()} />)
    expect(await screen.findByLabelText('Prompt')).toHaveValue('Current survey prompt')
    await act(async () => { pendingSave.resolve(jsonResponse({ question: makeQuestion({ question_text: 'Older pending edit' }) })); await pendingSave.promise })
    expect(screen.getByLabelText('Prompt')).toHaveValue('Current survey prompt')
    expect(screen.getByLabelText('Survey title')).toHaveValue('Current survey')
    expect(onBack).not.toHaveBeenCalled()
  })

  it('persists edited and keyboard-reordered MC choices without changing their text', async () => {
    const original = makeQuestion({ options: ['Game', 'Website', 'Animation'] })
    fetchMock.mockImplementation(async (_url: string | URL, init?: RequestInit) => jsonResponse(init?.method === 'PATCH'
      ? { question: { ...original, ...JSON.parse(String(init.body)) } }
      : { survey: makeSurvey(), questions: [original] }))
    render(<TeacherSurveyWorkspace classroomId="classroom-1" surveyId="survey-1" onBack={vi.fn()} onSurveyUpdated={vi.fn()} onSurveyDeleted={vi.fn()} />)
    fireEvent.change(await screen.findByLabelText('Option A'), { target: { value: 'Collaborative game' } })
    fireEvent.keyDown(screen.getByRole('button', { name: /Reorder option A;/ }), { key: 'ArrowDown' })
    expect(screen.getByLabelText('Option A')).toHaveValue('Website')
    expect(screen.getByLabelText('Option B')).toHaveValue('Collaborative game')
    fireEvent.click(screen.getByRole('button', { name: 'Close survey editor' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/teacher/surveys/survey-1/questions/question-1', expect.objectContaining({
      method: 'PATCH', body: JSON.stringify({ question_type: 'multiple_choice', question_text: 'Choose a project', options: ['Website', 'Collaborative game', 'Animation'], response_max_chars: 500 }),
    })))
  })

  it('duplicates the saved question with its type, choices and response limit', async () => {
    const original = makeQuestion({ response_max_chars: 1200 })
    const countChanged = vi.fn()
    fetchMock.mockImplementation(async (_url: string | URL, init?: RequestInit) => jsonResponse(init?.method === 'POST'
      ? { question: { ...original, ...JSON.parse(String(init.body)), id: 'question-copy', position: 1 } }
      : { survey: makeSurvey(), questions: [original] }))
    render(<TeacherSurveyWorkspace classroomId="classroom-1" surveyId="survey-1" onBack={vi.fn()} onSurveyUpdated={vi.fn()} onSurveyDeleted={vi.fn()} onQuestionCountChanged={countChanged} />)
    await screen.findByLabelText('Prompt')
    questionAction('Duplicate question')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/teacher/surveys/survey-1/questions', expect.objectContaining({
      method: 'POST', body: expect.any(String),
    })))
    const createCall = fetchMock.mock.calls.find((call) => call[1]?.method === 'POST')!
    expect(JSON.parse(String(createCall[1].body))).toMatchObject({ question_type: 'multiple_choice', question_text: 'Choose a project', options: ['Game', 'Website'], response_max_chars: 1200 })
    expect(countChanged).toHaveBeenLastCalledWith('survey-1', 2)
  })

  it('locks competing metadata changes while Markdown edits are pending and restores them on undo', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ survey: makeSurvey(), questions: [makeQuestion()] }))
    render(<TeacherSurveyWorkspace classroomId="classroom-1" surveyId="survey-1" onBack={vi.fn()} onSurveyUpdated={vi.fn()} onSurveyDeleted={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Markdown', exact: true }))
    const markdown = await screen.findByLabelText('Survey markdown editor') as HTMLTextAreaElement
    const initial = markdown.value
    fireEvent.change(markdown, { target: { value: initial.replace('Title: Game Jam Links', 'Title: Pending title') } })
    expect(screen.getByLabelText('Survey title')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Settings', exact: true })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Publish', exact: true })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Undo markdown edits' }))
    expect(markdown).toHaveValue(initial)
    fireEvent.click(screen.getByRole('button', { name: 'Markdown', exact: true }))
    await waitFor(() => expect(screen.getByLabelText('Survey title')).not.toBeDisabled())
    expect(screen.getByRole('button', { name: 'Settings', exact: true })).not.toBeDisabled()
  })

  it('persists survey settings without loading response results', async () => {
    let survey = makeSurvey()
    const onSurveyUpdated = vi.fn()
    fetchMock.mockImplementation(async (_url: string | URL, init?: RequestInit) => {
      if (init?.method === 'PATCH') { survey = { ...survey, ...JSON.parse(String(init.body)) }; return jsonResponse({ survey }) }
      return jsonResponse({ survey, questions: [] })
    })
    render(<TeacherSurveyWorkspace classroomId="classroom-1" surveyId="survey-1" onBack={vi.fn()} onSurveyUpdated={onSurveyUpdated} onSurveyDeleted={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Settings', exact: true }))
    expect(screen.getByRole('menuitemcheckbox', { name: 'Show class results to students' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Allow students to update responses' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/teacher/surveys/survey-1', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ dynamic_responses: false }) })))
    expect(onSurveyUpdated).toHaveBeenLastCalledWith(expect.objectContaining({ dynamic_responses: false }))
    fireEvent.click(screen.getByRole('button', { name: 'Settings', exact: true }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Show class results to students' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/teacher/surveys/survey-1', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ show_results: false }) })))
    expect(fetchMock).not.toHaveBeenCalledWith('/api/teacher/surveys/survey-1/results')
  })
})
