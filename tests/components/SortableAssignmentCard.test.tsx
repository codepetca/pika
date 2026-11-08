import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SortableAssignmentCard } from '@/components/SortableAssignmentCard'
import { SortableSurveyCard } from '@/components/surveys/SortableSurveyCard'
import { AssignmentControllerPattern } from '@/app/__ui/AssignmentControllerPattern'
import type { Assignment } from '@/types'
import userEvent from '@testing-library/user-event'
import { TooltipProvider } from '@/ui'

vi.mock('@/components/AssignmentModal', () => ({
  AssignmentModal: ({ isOpen, assignment }: { isOpen: boolean; assignment: Assignment | null }) => (
    isOpen && assignment ? <div role="dialog" aria-label={assignment.title}>{assignment.release_schedule?.state}</div> : null
  ),
}))

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

const assignment = {
  id: 'assignment-1',
  classroom_id: 'classroom-1',
  title: 'Assignment One',
  description: 'Description',
  instructions_markdown: 'Instructions',
  rich_instructions: null,
  due_at: '2026-04-20T12:00:00Z',
  position: 0,
  is_draft: false,
  released_at: '2026-04-10T12:00:00Z',
  created_by: 'teacher-1',
  created_at: '2026-04-01T12:00:00Z',
  updated_at: '2026-04-01T12:00:00Z',
  stats: { total_students: 2, submitted: 1, late: 0 },
}

function renderCard({
  editMode,
  onOpen = vi.fn(),
  onEdit = vi.fn(),
  onDelete = vi.fn(),
}: {
  editMode: boolean
  onOpen?: () => void
  onEdit?: () => void
  onDelete?: () => void
}) {
  render(
    <TooltipProvider>
      <SortableAssignmentCard
        assignment={assignment as any}
        isReadOnly={false}
        editMode={editMode}
        onOpen={onOpen}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    </TooltipProvider>,
  )

  return { onOpen, onEdit, onDelete }
}

describe('SortableAssignmentCard', () => {
  it('keeps past-due queued work distinct from a missed release and opens the owner editor', async () => {
    const user = userEvent.setup()
    render(<TooltipProvider><AssignmentControllerPattern /></TooltipProvider>)
    expect(screen.getByText('Release pending')).toBeInTheDocument()
    expect(screen.getByText('Release missed')).toBeInTheDocument()
    expect(screen.queryByText('Draft', { exact: true })).not.toBeInTheDocument()
    const queued = screen.getByRole('button', { name: 'Scheduled field observations' })
    queued.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('dialog', { name: 'Scheduled field observations' })).toHaveTextContent('pending')
  })

  it('presents pending survey counts without enabling the card', () => {
    const onOpen = vi.fn()
    render(<TooltipProvider><SortableSurveyCard survey={{ ...assignment, status: 'active', stats: undefined } as any}
      isReadOnly={true} pending editMode={false} onOpen={onOpen} onDelete={vi.fn()} /></TooltipProvider>)
    expect(screen.getByRole('button', { name: 'Assignment One' })).toBeDisabled()
    expect(screen.getByText('Loading count')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Assignment One' }))
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('places the scheduled release before the due date in the reading order', () => {
    render(<TooltipProvider><SortableAssignmentCard
      assignment={{ ...assignment, released_at: '2099-04-10T12:00:00Z' }}
      isReadOnly={false} editMode={false}
      onOpen={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()}
    /></TooltipProvider>)

    const release = screen.getByText(/Fri Apr 10/)
    const due = screen.getByText(/^Due:/)
    expect(release.compareDocumentPosition(due) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('Scheduled')).toBeInTheDocument()
  })

  it('keeps survey title activation available from the keyboard beside its decorative icon', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(<TooltipProvider><SortableSurveyCard survey={{ ...assignment, status: 'active',
      stats: { responded: 1, total_students: 2, questions_count: 1 } } as any}
      isReadOnly={false} editMode={false} onOpen={onOpen} onDelete={vi.fn()} /></TooltipProvider>)
    const button = screen.getByRole('button', { name: 'Assignment One', exact: true })
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    button.focus()
    await user.keyboard('{Enter}')
    expect(onOpen).toHaveBeenCalledOnce()
  })

  it('hides drag and delete affordances in normal mode', () => {
    renderCard({ editMode: false })
    expect(screen.getByRole('button', { name: 'Assignment One' }).querySelector('svg')).toHaveAttribute('aria-hidden', 'true')

    expect(screen.queryByRole('button', { name: 'Drag to reorder' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete Assignment One' })).not.toBeInTheDocument()
  })

  it('shows drag and delete affordances in organize mode', () => {
    renderCard({ editMode: true })

    expect(screen.getByRole('button', { name: 'Drag to reorder' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete Assignment One' })).toBeInTheDocument()
  })

  it('opens the workspace in normal mode and the editor in organize mode', () => {
    const normal = renderCard({ editMode: false })
    fireEvent.click(screen.getByRole('button', { name: 'Assignment One' }))
    expect(normal.onOpen).toHaveBeenCalledTimes(1)
    expect(normal.onEdit).not.toHaveBeenCalled()

    const edit = renderCard({ editMode: true })
    fireEvent.click(screen.getByRole('button', { name: 'Edit Assignment One' }))
    expect(edit.onEdit).toHaveBeenCalledTimes(1)
    expect(edit.onOpen).not.toHaveBeenCalled()
  })
})
