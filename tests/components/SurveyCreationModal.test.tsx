import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SurveyCreationModal } from '@/components/surveys/SurveyCreationModal'
import type { Survey } from '@/types'

function makeSurvey(overrides: Partial<Survey> = {}): Survey {
  return {
    id: 'survey-1',
    classroom_id: 'classroom-1',
    title: 'Class feedback',
    status: 'draft',
    opens_at: null,
    due_at: '2099-01-02T20:30:00.000Z',
    due_policy: 'soft',
    show_results: true,
    dynamic_responses: false,
    position: 0,
    created_by: 'teacher-1',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeQuestion() {
  return {
    id: 'question-1',
    survey_id: 'survey-1',
    question_type: 'short_text' as const,
    question_text: 'What should we change?',
    options: [],
    response_max_chars: 500,
    position: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }
}

describe('SurveyCreationModal', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses autosaved shared classwork chrome when creating a survey', async () => {
    const survey = makeSurvey({
      title: 'Untitled 2026-05-14 10:15:30',
      due_at: '2026-01-02T20:30:00.000Z',
    })
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url)
      if (href === '/api/teacher/surveys' && init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({ survey }),
        }
      }
      if (href === '/api/teacher/surveys/survey-1') {
        return {
          ok: true,
          json: async () => ({ survey, questions: [] }),
        }
      }
      throw new Error(`Unexpected fetch: ${href}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const onDraftSaved = vi.fn()

    render(
      <SurveyCreationModal
        isOpen={true}
        classroomId="classroom-1"
        onClose={vi.fn()}
        onDraftSaved={onDraftSaved}
      />
    )

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Edit Survey' })).toBeInTheDocument()
    })

    expect(screen.getByPlaceholderText('Enter survey title')).toBeInTheDocument()
    expect(screen.getByText('Saved')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit Survey' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Poll' })).toBeDisabled()
    expect(await screen.findByRole('button', { name: 'Preview' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Code' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add question' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Create' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    expect(screen.getByText('Due')).toBeInTheDocument()
    expect(screen.queryByText('Due mode')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Show class results to students')).toBeInTheDocument()
    expect(screen.getByLabelText('Allow students to update answers while open')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveClass('!max-w-6xl')
    expect(fetchMock).toHaveBeenCalledWith('/api/teacher/surveys', expect.objectContaining({ method: 'POST' }))
    expect(onDraftSaved).toHaveBeenCalled()
  })

  it('keeps the modal open when survey due-date storage requires migration', async () => {
    const onClose = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      json: async () => ({
        error: 'Survey due dates are unavailable until migration 134 is applied.',
        code: 'SURVEY_DUE_MIGRATION_REQUIRED',
        migration_required: true,
      }),
    })))

    render(
      <SurveyCreationModal
        isOpen
        classroomId="classroom-1"
        onClose={onClose}
      />
    )

    expect(await screen.findByText('Survey due dates are unavailable until migration 134 is applied.')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('keeps newer title edits when an older autosave response refreshes the parent survey', async () => {
    const initialSurvey = makeSurvey()
    let resolveFirstPatch: ((response: unknown) => void) | null = null
    const firstPatchResponse = new Promise((resolve) => {
      resolveFirstPatch = resolve
    })
    const patchBodies: Array<Record<string, unknown>> = []

    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url)
      if (href !== '/api/teacher/surveys/survey-1') {
        throw new Error(`Unexpected fetch: ${href}`)
      }
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        patchBodies.push(body)
        if (patchBodies.length === 1) return firstPatchResponse
        return {
          ok: true,
          json: async () => ({ survey: makeSurvey({ title: String(body.title) }) }),
        }
      }
      return {
        ok: true,
        json: async () => ({ survey: initialSurvey, questions: [makeQuestion()] }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    function Harness() {
      const [survey, setSurvey] = useState(initialSurvey)
      return (
        <SurveyCreationModal
          isOpen
          classroomId="classroom-1"
          surveyId={survey.id}
          survey={survey}
          onClose={vi.fn()}
          onSurveyUpdated={setSurvey}
        />
      )
    }

    render(<Harness />)

    const titleInput = await screen.findByPlaceholderText('Enter survey title')
    fireEvent.change(titleInput, { target: { value: 'First saved title' } })
    fireEvent.blur(titleInput)
    await waitFor(() => expect(patchBodies).toHaveLength(1))

    fireEvent.change(titleInput, { target: { value: 'Newer local title' } })
    fireEvent.blur(titleInput)
    expect(patchBodies).toHaveLength(1)

    resolveFirstPatch?.({
      ok: true,
      json: async () => ({ survey: makeSurvey({ title: 'First saved title' }) }),
    })

    await waitFor(() => {
      expect(titleInput).toHaveValue('Newer local title')
    })

    await waitFor(() => expect(patchBodies).toHaveLength(2))
    expect(patchBodies[1].title).toBe('Newer local title')
  })

  it('synchronizes Code-mode settings before a later top-line autosave', async () => {
    let serverSurvey = makeSurvey()
    const question = makeQuestion()
    const surveyPatchBodies: Array<Record<string, unknown>> = []
    const onClose = vi.fn()

    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url)
      if (href === '/api/teacher/surveys/survey-1' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        surveyPatchBodies.push(body)
        serverSurvey = {
          ...serverSurvey,
          ...(body.title !== undefined ? { title: String(body.title) } : {}),
          ...(body.show_results !== undefined ? { show_results: Boolean(body.show_results) } : {}),
          ...(body.dynamic_responses !== undefined
            ? { dynamic_responses: Boolean(body.dynamic_responses) }
            : {}),
          ...(body.due_at !== undefined ? { due_at: String(body.due_at) } : {}),
        }
        return { ok: true, json: async () => ({ survey: serverSurvey }) }
      }
      if (href === '/api/teacher/surveys/survey-1/questions/question-1' && init?.method === 'PATCH') {
        return {
          ok: true,
          json: async () => ({
            question: { ...question, ...JSON.parse(String(init.body)) },
          }),
        }
      }
      if (href === '/api/teacher/surveys/survey-1') {
        return { ok: true, json: async () => ({ survey: serverSurvey, questions: [question] }) }
      }
      throw new Error(`Unexpected fetch: ${href}`)
    }))

    render(
      <SurveyCreationModal
        isOpen
        classroomId="classroom-1"
        surveyId={serverSurvey.id}
        survey={serverSurvey}
        onClose={onClose}
      />
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Code' }))
    const editor = await screen.findByLabelText('Survey markdown editor')
    fireEvent.change(editor, {
      target: {
        value: (editor as HTMLTextAreaElement).value
          .replace('Title: Class feedback', 'Title: Code title')
          .replace('Show Results: true', 'Show Results: false')
          .replace('Dynamic Responses: false', 'Dynamic Responses: true'),
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply Markdown' }))

    expect(await screen.findByText('Markdown applied')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Enter survey title')).toHaveValue('Code title')
    expect(screen.getByLabelText('Show class results to students')).not.toBeChecked()
    expect(screen.getByLabelText('Allow students to update answers while open')).toBeChecked()

    fireEvent.click(screen.getByLabelText('Show class results to students'))
    fireEvent.click(screen.getByRole('button', { name: 'Close survey modal' }))

    await waitFor(() => expect(surveyPatchBodies).toHaveLength(2))
    expect(surveyPatchBodies[1]).toEqual(expect.objectContaining({
      title: 'Code title',
      show_results: true,
      dynamic_responses: true,
    }))
    expect(onClose).toHaveBeenCalled()
  })

  it('flushes pending top-line edits before applying question-only Code changes', async () => {
    let serverSurvey = makeSurvey()
    const question = makeQuestion()
    const surveyPatchBodies: Array<Record<string, unknown>> = []
    const questionPatchBodies: Array<Record<string, unknown>> = []

    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url)
      if (href === '/api/teacher/surveys/survey-1' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        surveyPatchBodies.push(body)
        serverSurvey = {
          ...serverSurvey,
          ...(body.title !== undefined ? { title: String(body.title) } : {}),
        }
        return { ok: true, json: async () => ({ survey: serverSurvey }) }
      }
      if (href === '/api/teacher/surveys/survey-1/questions/question-1' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        questionPatchBodies.push(body)
        return { ok: true, json: async () => ({ question: { ...question, ...body } }) }
      }
      if (href === '/api/teacher/surveys/survey-1') {
        return { ok: true, json: async () => ({ survey: serverSurvey, questions: [question] }) }
      }
      throw new Error(`Unexpected fetch: ${href}`)
    }))

    render(
      <SurveyCreationModal
        isOpen
        classroomId="classroom-1"
        surveyId={serverSurvey.id}
        survey={serverSurvey}
        onClose={vi.fn()}
      />
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Code' }))
    const editor = await screen.findByLabelText('Survey markdown editor')
    fireEvent.change(editor, {
      target: {
        value: (editor as HTMLTextAreaElement).value.replace(
          'What should we change?',
          'What should we improve?',
        ),
      },
    })

    const titleInput = screen.getByPlaceholderText('Enter survey title')
    fireEvent.change(titleInput, { target: { value: 'New top-line title' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply Markdown' }))

    expect(await screen.findByText('Markdown applied')).toBeInTheDocument()
    expect(titleInput).toHaveValue('New top-line title')
    expect(surveyPatchBodies).toHaveLength(1)
    expect(surveyPatchBodies[0].title).toBe('New top-line title')
    expect(questionPatchBodies).toHaveLength(1)
    expect(questionPatchBodies[0].question_text).toBe('What should we improve?')
  })

  it('retains saved Code settings when a later question mutation fails', async () => {
    let serverSurvey = makeSurvey()
    const question = makeQuestion()
    const surveyPatchBodies: Array<Record<string, unknown>> = []
    const onClose = vi.fn()

    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url)
      if (href === '/api/teacher/surveys/survey-1' && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        surveyPatchBodies.push(body)
        serverSurvey = {
          ...serverSurvey,
          ...(body.title !== undefined ? { title: String(body.title) } : {}),
          ...(body.show_results !== undefined ? { show_results: Boolean(body.show_results) } : {}),
          ...(body.dynamic_responses !== undefined
            ? { dynamic_responses: Boolean(body.dynamic_responses) }
            : {}),
        }
        return { ok: true, json: async () => ({ survey: serverSurvey }) }
      }
      if (href === '/api/teacher/surveys/survey-1/questions/question-1' && init?.method === 'PATCH') {
        return {
          ok: false,
          json: async () => ({ error: 'Question update failed' }),
        }
      }
      if (href === '/api/teacher/surveys/survey-1') {
        return { ok: true, json: async () => ({ survey: serverSurvey, questions: [question] }) }
      }
      throw new Error(`Unexpected fetch: ${href}`)
    }))

    render(
      <SurveyCreationModal
        isOpen
        classroomId="classroom-1"
        surveyId={serverSurvey.id}
        survey={serverSurvey}
        onClose={onClose}
      />
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Code' }))
    const editor = await screen.findByLabelText('Survey markdown editor')
    fireEvent.change(editor, {
      target: {
        value: (editor as HTMLTextAreaElement).value
          .replace('Title: Class feedback', 'Title: Code title')
          .replace('Show Results: true', 'Show Results: false')
          .replace('Dynamic Responses: false', 'Dynamic Responses: true')
          .replace('What should we change?', 'What should we improve?'),
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply Markdown' }))

    expect(await screen.findByText('Question update failed')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Enter survey title')).toHaveValue('Code title')
    expect(screen.getByLabelText('Show class results to students')).not.toBeChecked()
    expect(screen.getByLabelText('Allow students to update answers while open')).toBeChecked()

    fireEvent.click(screen.getByLabelText('Show class results to students'))
    fireEvent.click(screen.getByRole('button', { name: 'Close survey modal' }))

    await waitFor(() => expect(surveyPatchBodies).toHaveLength(2))
    expect(surveyPatchBodies[1]).toEqual(expect.objectContaining({
      title: 'Code title',
      show_results: true,
      dynamic_responses: true,
    }))
    expect(onClose).toHaveBeenCalled()
  })

  it('shows reschedule and open-now actions for a scheduled survey', async () => {
    const survey = makeSurvey({
      status: 'active',
      opens_at: '2099-01-03T14:00:00.000Z',
    })
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ survey, questions: [makeQuestion()] }),
    })))

    render(
      <SurveyCreationModal
        isOpen
        classroomId="classroom-1"
        surveyId={survey.id}
        survey={survey}
        onClose={vi.fn()}
      />
    )

    expect(await screen.findByRole('heading', { name: 'Edit Scheduled Survey' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save schedule' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close Poll' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Choose survey action' }))
    expect(screen.getByRole('menuitem', { name: 'Schedule...' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Open now' })).toBeInTheDocument()
  })

  it('keeps the schedule dialog open when scheduling fails', async () => {
    const survey = makeSurvey()
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        return {
          ok: false,
          json: async () => ({ error: 'Schedule failed' }),
        }
      }
      return {
        ok: true,
        json: async () => ({ survey, questions: [makeQuestion()] }),
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <SurveyCreationModal
        isOpen
        classroomId="classroom-1"
        surveyId={survey.id}
        survey={survey}
        onClose={vi.fn()}
      />
    )

    await screen.findByRole('button', { name: 'Open Poll' })
    fireEvent.click(screen.getByRole('button', { name: 'Choose survey action' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Schedule...' }))
    fireEvent.change(screen.getByLabelText('Open date'), { target: { value: '2099-01-04' } })
    fireEvent.change(screen.getByLabelText('Open time'), { target: { value: '09:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }))

    expect(await screen.findByText('Schedule failed')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Schedule Survey' })).toBeInTheDocument()
  })

})
