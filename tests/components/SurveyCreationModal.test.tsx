import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { SurveyCreationModal } from '@/components/surveys/SurveyCreationModal'

describe('SurveyCreationModal', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uses autosaved shared classwork chrome when creating a survey', async () => {
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

})
