import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { applyMarkdownShortcut, LessonDayCell } from '@/components/LessonDayCell'
import type { LessonPlan, TiptapContent } from '@/types'

const content: TiptapContent = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Lesson text' }] }],
}

const lessonPlan: LessonPlan = {
  id: 'plan-1',
  classroom_id: 'class-1',
  date: '2026-03-13',
  content,
  content_markdown: 'Lesson text',
  created_at: '2026-03-13T00:00:00.000Z',
  updated_at: '2026-03-13T00:00:00.000Z',
}

describe('LessonDayCell', () => {
  function Harness() {
    const [plan, setPlan] = useState<LessonPlan | null>(lessonPlan)

    return (
      <LessonDayCell
        date="2026-03-13"
        day={new Date('2026-03-13T12:00:00.000Z')}
        lessonPlan={plan}
        isWeekend={false}
        isToday={false}
        editable={true}
        compact={false}
        onContentChange={(date, contentMarkdown) => {
          setPlan((current) => {
            if (!contentMarkdown.trim()) {
              return null
            }

            return {
              ...(current ?? {
                ...lessonPlan,
                id: `local-${date}`,
                date,
              }),
              content_markdown: contentMarkdown,
            }
          })
        }}
      />
    )
  }

  it('enters inline markdown edit mode when the preview is clicked', () => {
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
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByDisplayValue('Lesson text')).toHaveClass('font-mono')
  })

  it('keeps the edited markdown visible after blur when parent state updates optimistically', () => {
    render(<Harness />)

    fireEvent.click(screen.getByRole('button'))
    const textarea = screen.getByDisplayValue('Lesson text')
    fireEvent.change(textarea, { target: { value: 'Updated lesson text' } })
    fireEvent.blur(textarea)

    expect(screen.getByText('Updated lesson text')).toBeInTheDocument()
  })

  it('renders markdown preview inside the shared calendar text wrapper', () => {
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

    expect(screen.getByText('Lesson text').closest('.calendar-day-text')).toBeTruthy()
  })

  it('applies bold shortcut to the selected markdown range', () => {
    const result = applyMarkdownShortcut('hello world', 0, 5, 'bold')
    expect(result.value).toBe('**hello** world')
  })

  it('toggles list prefix for the selected lines', () => {
    const result = applyMarkdownShortcut('item one\nitem two', 0, 'item one\nitem two'.length, 'unordered-list')
    expect(result.value).toBe('- item one\n- item two')
  })
})
