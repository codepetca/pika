import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SurveyCreationModal } from '@/components/surveys/SurveyCreationModal'

describe('SurveyCreationModal', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses autosaved shared classwork chrome when creating a survey', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        survey: {
          id: 'survey-1',
          classroom_id: 'classroom-1',
          title: 'Untitled 2026-05-14 10:15:30',
          status: 'draft',
          opens_at: null,
          due_at: '2026-01-02T20:30:00.000Z',
          due_policy: 'soft',
          show_results: true,
          dynamic_responses: false,
          position: 0,
          created_by: 'teacher-1',
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const onDraftSaved = vi.fn()

    render(
      <SurveyCreationModal
        isOpen={true}
        classroomId="classroom-1"
        onClose={vi.fn()}
        onDraftSaved={onDraftSaved}
        onSuccess={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'New Survey' })).toBeInTheDocument()
    })

    expect(screen.getByPlaceholderText('Enter survey title')).toBeInTheDocument()
    expect(screen.getByText('Saved')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit Survey' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    expect(screen.getByText('Due')).toBeInTheDocument()
    expect(screen.queryByText('Due mode')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Show class results to students')).toBeInTheDocument()
    expect(screen.getByLabelText('Allow students to update answers while open')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveClass('!max-w-5xl')
    expect(fetchMock).toHaveBeenCalledWith('/api/teacher/surveys', expect.objectContaining({ method: 'POST' }))
    expect(onDraftSaved).toHaveBeenCalled()
  })

  it('flushes survey settings before opening preview', async () => {
    const survey = {
      id: 'survey-1',
      classroom_id: 'classroom-1',
      title: 'Untitled 2026-05-14 10:15:30',
      status: 'draft',
      opens_at: null,
      due_at: '2026-01-02T20:30:00.000Z',
      due_policy: 'soft',
      show_results: true,
      dynamic_responses: false,
      position: 0,
      created_by: 'teacher-1',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ survey }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ survey: { ...survey, title: 'Feedback check' } }),
      })
    vi.stubGlobal('fetch', fetchMock)
    const onPreview = vi.fn()

    render(
      <SurveyCreationModal
        isOpen={true}
        classroomId="classroom-1"
        onClose={vi.fn()}
        onPreview={onPreview}
        onSuccess={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Preview' })).toBeEnabled()
    })

    fireEvent.change(screen.getByPlaceholderText('Enter survey title'), {
      target: { value: 'Feedback check' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

    await waitFor(() => {
      expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ id: 'survey-1' }))
    })
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/teacher/surveys/survey-1',
      expect.objectContaining({
        method: 'PATCH',
        body: expect.stringContaining('"due_policy":"soft"'),
      })
    )
  })
})
