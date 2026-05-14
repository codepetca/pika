import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { applyMarkdownShortcut, LessonDayCell } from '@/components/LessonDayCell'
import { TooltipProvider } from '@/ui'
import type { Announcement, LessonPlan, TiptapContent } from '@/types'

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

const longAnnouncement: Announcement = {
  id: 'announcement-1',
  classroom_id: 'class-1',
  content: 'Long announcement text that should remain fully visible in the tooltip instead of being clipped to a single short preview line for the calendar.',
  created_by: 'teacher-1',
  scheduled_for: null,
  created_at: '2026-03-13T00:00:00.000Z',
  updated_at: '2026-03-13T00:00:00.000Z',
}

const multiLineAnnouncement: Announcement = {
  ...longAnnouncement,
  id: 'announcement-2',
  content: `${'This announcement keeps going so the tooltip has enough text to wrap onto multiple lines in a narrower tooltip. '.repeat(3)}Final sentence should still be visible.`,
}

const markdownAnnouncement: Announcement = {
  ...longAnnouncement,
  id: 'announcement-3',
  content: 'Read the [course outline](https://example.com/outline) before class.',
}

const titledAnnouncementTitle = 'Quiz reminder with a very long title that should truncate in the calendar'

const titledAnnouncement: Announcement = {
  ...longAnnouncement,
  id: 'announcement-4',
  title: titledAnnouncementTitle,
}

function renderWithTooltip(ui: ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>)
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
    const { container } = renderWithTooltip(
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

  it('does not render default add-lesson-plan prompt text for empty editable cells', () => {
    renderWithTooltip(
      <LessonDayCell
        date="2026-03-14"
        day={new Date('2026-03-14T12:00:00.000Z')}
        lessonPlan={null}
        isWeekend={false}
        isToday={false}
        editable={true}
        compact={false}
      />
    )

    expect(screen.queryByText('Add lesson plan...')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('14'))

    expect(screen.getByRole('textbox')).not.toHaveAttribute('placeholder')
  })

  it('enters inline markdown edit mode when the date header is clicked', () => {
    const { container } = renderWithTooltip(
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

    fireEvent.click(screen.getByText('13'))

    expect(screen.getByDisplayValue('Lesson text')).toHaveClass('font-mono')
    expect(container.querySelector('textarea')).toBeTruthy()
  })

  it('keeps the edited markdown visible after blur when parent state updates optimistically', () => {
    renderWithTooltip(<Harness />)

    fireEvent.click(screen.getByRole('button'))
    const textarea = screen.getByDisplayValue('Lesson text')
    fireEvent.change(textarea, { target: { value: 'Updated lesson text' } })
    fireEvent.blur(textarea)

    expect(screen.getByText('Updated lesson text')).toBeInTheDocument()
  })

  it('keeps the edited markdown visible after pressing escape', () => {
    renderWithTooltip(<Harness />)

    fireEvent.click(screen.getByRole('button'))
    const textarea = screen.getByDisplayValue('Lesson text')
    fireEvent.change(textarea, { target: { value: 'Saved via escape' } })
    fireEvent.keyDown(textarea, { key: 'Escape' })

    expect(screen.getByText('Saved via escape')).toBeInTheDocument()
  })

  it('renders markdown preview inside the shared calendar text wrapper', () => {
    renderWithTooltip(
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

  it('shows the full announcement content inside the tooltip', async () => {
    renderWithTooltip(
      <LessonDayCell
        date="2026-03-13"
        day={new Date('2026-03-13T12:00:00.000Z')}
        lessonPlan={null}
        announcements={[longAnnouncement]}
        isWeekend={false}
        isToday={false}
        editable={false}
        compact={false}
      />
    )

    fireEvent.focus(screen.getByRole('button', { name: 'Announcement' }))

    const tooltip = await screen.findByRole('tooltip')
    expect(within(tooltip).getByText(longAnnouncement.content)).toBeInTheDocument()
  })

  it('uses the announcement title as the calendar label and keeps it truncated', async () => {
    renderWithTooltip(
      <LessonDayCell
        date="2026-03-13"
        day={new Date('2026-03-13T12:00:00.000Z')}
        lessonPlan={null}
        announcements={[titledAnnouncement]}
        isWeekend={false}
        isToday={false}
        editable={false}
        compact={false}
      />
    )

    const button = screen.getByRole('button', { name: titledAnnouncementTitle })
    expect(button).toHaveClass('truncate')
    expect(button).toHaveAttribute('title', titledAnnouncementTitle)

    fireEvent.focus(button)

    const tooltip = await screen.findByRole('tooltip')
    expect(within(tooltip).getByText(titledAnnouncementTitle)).toBeInTheDocument()
    expect(within(tooltip).getByText(titledAnnouncement.content)).toBeInTheDocument()
  })

  it('shows long announcement content without truncating it', async () => {
    renderWithTooltip(
      <LessonDayCell
        date="2026-03-13"
        day={new Date('2026-03-13T12:00:00.000Z')}
        lessonPlan={null}
        announcements={[multiLineAnnouncement]}
        isWeekend={false}
        isToday={false}
        editable={false}
        compact={false}
      />
    )

    fireEvent.focus(screen.getByRole('button', { name: 'Announcement' }))

    const tooltip = await screen.findByRole('tooltip')
    const tooltipText = tooltip.textContent ?? ''

    expect(tooltipText).toContain('Final sentence should still be visible.')
    expect(tooltipText).not.toContain('...')
  })

  it('renders markdown links in announcement tooltips', async () => {
    renderWithTooltip(
      <LessonDayCell
        date="2026-03-13"
        day={new Date('2026-03-13T12:00:00.000Z')}
        lessonPlan={null}
        announcements={[markdownAnnouncement]}
        isWeekend={false}
        isToday={false}
        editable={false}
        compact={false}
      />
    )

    fireEvent.focus(screen.getByRole('button', { name: 'Announcement' }))

    const tooltip = await screen.findByRole('tooltip')
    expect(within(tooltip).getByRole('link', { name: 'course outline' })).toHaveAttribute(
      'href',
      'https://example.com/outline',
    )
  })
})
