import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LessonDayCell } from '@/components/LessonDayCell'
import type { LessonPlan, TiptapContent } from '@/types'

vi.mock('@/components/editor/RichTextEditor', () => ({
  RichTextEditor: ({
    className,
  }: {
    className?: string
  }) => <div data-testid="rich-text-editor" className={className} />,
}))

const content: TiptapContent = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Lesson text' }] }],
}

const lessonPlan: LessonPlan = {
  id: 'plan-1',
  classroom_id: 'class-1',
  date: '2026-03-13',
  content,
  created_at: '2026-03-13T00:00:00.000Z',
  updated_at: '2026-03-13T00:00:00.000Z',
}

describe('LessonDayCell', () => {
  it('applies the shared calendar text wrapper in editable mode', () => {
    const { container } = render(
      <LessonDayCell
        date="2026-03-13"
        day={new Date('2026-03-13T12:00:00.000Z')}
        lessonPlan={lessonPlan}
        isWeekend={false}
        isToday={false}
        editable={true}
        compact={false}
      />
    )

    expect(container.querySelector('.calendar-day-text')).toBeTruthy()
    expect(screen.getByTestId('rich-text-editor')).toHaveClass('text-sm')
  })

  it('uses the shared calendar text wrapper for plain-text previews', () => {
    render(
      <LessonDayCell
        date="2026-03-13"
        day={new Date('2026-03-13T12:00:00.000Z')}
        lessonPlan={lessonPlan}
        isWeekend={false}
        isToday={false}
        editable={false}
        compact={false}
        plainTextOnly={true}
      />
    )

    expect(screen.getByText('Lesson text')).toHaveClass('calendar-day-text')
  })
})
