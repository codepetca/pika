import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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

  it('can open a newly created survey directly into code authoring mode', async () => {
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
})
