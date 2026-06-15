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
    due_at: '2026-01-02T20:30:00.000Z',
    due_policy: 'hard',
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
  it('uses the shared classwork top row for survey settings', () => {
    render(
      <SurveyModal
        isOpen={true}
        survey={makeSurvey({ title: 'Game Jam Links', dynamic_responses: true })}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    )

    expect(screen.getByRole('heading', { name: 'Edit Survey' })).toBeInTheDocument()
    expect(screen.getByDisplayValue('Game Jam Links')).toHaveAttribute('placeholder', 'Enter survey title')
    expect(screen.getByText('Saved')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    expect(screen.getByText('Due')).toBeInTheDocument()
    expect(screen.queryByText('Due mode')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Show class results to students')).toBeInTheDocument()
    expect(screen.getByLabelText('Allow students to update answers while open')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveClass('!max-w-5xl')
  })
})
