import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SortableSurveyCard } from '@/components/surveys/SortableSurveyCard'
import type { SurveyWithStats } from '@/types'

vi.mock('@dnd-kit/sortable', () => ({
  useSortable: vi.fn(() => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  })),
}))

vi.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Transform: {
      toString: vi.fn(() => undefined),
    },
  },
}))

const survey: SurveyWithStats = {
  id: 'survey-1',
  classroom_id: 'classroom-1',
  title: 'Scheduled survey',
  status: 'active',
  opens_at: '2099-01-02T14:00:00.000Z',
  due_at: null,
  due_policy: 'soft',
  show_results: true,
  dynamic_responses: true,
  position: 0,
  created_by: 'teacher-1',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  stats: { total_students: 2, responded: 0, questions_count: 1 },
}

describe('SortableSurveyCard', () => {
  it('labels a future active survey as scheduled instead of open', () => {
    render(
      <SortableSurveyCard
        survey={survey}
        isReadOnly={false}
        editMode={false}
        onOpen={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Scheduled survey' })).toBeInTheDocument()
    expect(screen.getByText('Scheduled')).toBeInTheDocument()
    expect(screen.queryByText('Open')).not.toBeInTheDocument()
  })
})
