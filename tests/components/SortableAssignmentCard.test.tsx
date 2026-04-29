import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SortableAssignmentCard } from '@/components/SortableAssignmentCard'
import { TooltipProvider } from '@/ui'

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
  it('hides drag and delete affordances in normal mode', () => {
    renderCard({ editMode: false })

    expect(screen.queryByRole('button', { name: 'Drag to reorder' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete Assignment One' })).not.toBeInTheDocument()
  })

  it('shows drag and delete affordances in edit mode', () => {
    renderCard({ editMode: true })

    expect(screen.getByRole('button', { name: 'Drag to reorder' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete Assignment One' })).toBeInTheDocument()
  })

  it('opens the workspace in normal mode and the editor in edit mode', () => {
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
