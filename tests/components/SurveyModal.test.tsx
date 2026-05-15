import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SurveyModal } from '@/components/surveys/SurveyModal'
import type { Survey } from '@/types'

function makeSurvey(overrides: Partial<Survey> = {}): Survey {
  return {
    id: 'survey-1',
    classroom_id: 'classroom-1',
    title: 'Resource Links',
    status: 'draft',
    opens_at: null,
    show_results: true,
    dynamic_responses: false,
    position: 0,
    created_by: 'teacher-1',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('SurveyModal', () => {
  it('uses the shared full-screen assessment setup chrome when creating a survey', () => {
    render(
      <SurveyModal
        isOpen={true}
        classroomId="classroom-1"
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    )

    expect(screen.getByRole('heading', { name: 'New Survey' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Enter survey title')).toBeInTheDocument()
    expect(screen.getByLabelText('Show class results to students after they respond')).toBeInTheDocument()
    expect(screen.getByLabelText('Dynamic responses: students can update answers while open')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveClass('max-w-none')
  })

  it('keeps settings edits compact while using the same setup shell', () => {
    render(
      <SurveyModal
        isOpen={true}
        classroomId="classroom-1"
        survey={makeSurvey({ title: 'Game Jam Links', dynamic_responses: true })}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    )

    expect(screen.getByRole('heading', { name: 'Edit Survey' })).toBeInTheDocument()
    expect(screen.getByDisplayValue('Game Jam Links')).toHaveAttribute('placeholder', 'Enter survey title')
    expect(screen.getByRole('dialog')).toHaveClass('max-w-md')
  })
})
