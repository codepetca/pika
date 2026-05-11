import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TeacherWorkItemCardFrame } from '@/components/teacher-work-surface/TeacherWorkItemCardFrame'
import { TeacherWorkItemList } from '@/components/teacher-work-surface/TeacherWorkItemList'

describe('TeacherWorkItem primitives', () => {
  it('renders work-item lists at full available width', () => {
    const { container } = render(
      <TeacherWorkItemList>
        <div>Item</div>
      </TeacherWorkItemList>,
    )

    expect(container.firstElementChild).toHaveClass('w-full')
    expect(container.firstElementChild).not.toHaveClass('max-w-6xl')
  })

  it('centralizes the shared card frame chrome and tones', () => {
    const { rerender } = render(
      <TeacherWorkItemCardFrame tone="default">Default card</TeacherWorkItemCardFrame>,
    )

    const defaultCard = screen.getByText('Default card')
    expect(defaultCard).toHaveClass('w-full')
    expect(defaultCard).toHaveClass('rounded-card')
    expect(defaultCard).toHaveClass('bg-surface-panel')

    rerender(
      <TeacherWorkItemCardFrame tone="muted">Muted card</TeacherWorkItemCardFrame>,
    )
    expect(screen.getByText('Muted card')).toHaveClass('bg-surface-2')

    rerender(
      <TeacherWorkItemCardFrame tone="selected">Selected card</TeacherWorkItemCardFrame>,
    )
    expect(screen.getByText('Selected card')).toHaveClass('bg-surface-selected')

    rerender(
      <TeacherWorkItemCardFrame dragging dragTone="neutral">Neutral drag card</TeacherWorkItemCardFrame>,
    )
    expect(screen.getByText('Neutral drag card')).toHaveClass('border-border')
    expect(screen.getByText('Neutral drag card')).not.toHaveClass('border-primary')
  })
})
