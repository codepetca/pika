import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ClassroomRowFrame, ClassroomRowGhost, SortableClassroomRow } from '@/components/SortableClassroomRow'
import { createMockClassroom } from '../helpers/mocks'
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

describe('SortableClassroomRow', () => {
  it('reuses the row frame for joined presentation without inventing owner controls', () => {
    const onOpen = vi.fn()
    const { rerender } = render(<ClassroomRowFrame classroom={{ title: 'Joined science', term_label: null, start_date: null, end_date: null }} dragHandle={null} action={<button type="button">Hide Joined science</button>} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: /^Joined science Semester dates/ }))
    expect(onOpen).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: /Archive|Drag to reorder/ })).not.toBeInTheDocument()
    rerender(<ClassroomRowFrame classroom={{ title: 'Joined science', term_label: null, start_date: null, end_date: null }} dragHandle={null} action={null} onOpen={onOpen} isDisabled />)
    expect(screen.getByRole('button', { name: /^Joined science Semester dates/ })).toBeDisabled()
  })
  it('keeps reorder and archive actions full sized and independent', () => {
    const onOpen = vi.fn(), onArchive = vi.fn()
    render(<SortableClassroomRow classroom={createMockClassroom({ title: 'Math 101' })} onOpen={onOpen} onArchive={onArchive} />, { wrapper: TooltipProvider })
    expect(screen.getByRole('button', { name: 'Drag to reorder Math 101' })).toHaveClass('h-11', 'w-11')
    const archive = screen.getByRole('button', { name: 'Archive Math 101' })
    expect(archive).toHaveClass('h-11', 'w-11')
    fireEvent.click(archive)
    expect(onArchive).toHaveBeenCalledOnce()
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('uses gradient-only classroom theming on sortable rows', () => {
    const classroom = createMockClassroom({ id: 'c1', title: 'Math 101', theme_color: 'teal' })

    render(
      <SortableClassroomRow
        classroom={classroom}
        onOpen={vi.fn()}
        onArchive={vi.fn()}
      />,
      { wrapper: TooltipProvider },
    )

    const card = screen.getByTestId('classroom-card')

    expect(card).toHaveAttribute('data-classroom-theme-color', 'teal')
    expect(card).toHaveClass('classroom-theme-card')
    expect(card).not.toHaveClass('border')
    expect(card).not.toHaveClass('border-l-4')
  })

  it('uses gradient-only classroom theming on drag ghosts', () => {
    const classroom = createMockClassroom({ id: 'c1', title: 'Math 101', theme_color: 'rose' })

    const { container } = render(<ClassroomRowGhost classroom={classroom} />)
    const ghost = container.querySelector('[data-classroom-theme-color="rose"]')

    expect(ghost).toHaveClass('classroom-theme-card')
    expect(ghost).toHaveClass('border')
    expect(ghost).not.toHaveClass('border-l-4')
  })

  it('shows the semester date range instead of the join code', () => {
    render(
      <ClassroomRowGhost
        classroom={createMockClassroom({
          class_code: 'MATH01',
          start_date: '2025-09-02',
          end_date: '2026-01-30',
        })}
      />,
    )

    expect(screen.getByText('Sept 2025 - Jan 2026')).toBeInTheDocument()
    expect(screen.queryByText(/MATH01/)).not.toBeInTheDocument()
  })
})
