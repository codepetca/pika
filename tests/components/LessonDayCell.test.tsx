import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { LessonDayCell } from '@/components/LessonDayCell'
import { createMockTest } from '../helpers/mocks'
import { TooltipProvider } from '@/ui'
import type { Announcement, Assignment, LessonPlan, TiptapContent } from '@/types'

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

const titledAnnouncementTitle = 'Test reminder with a very long title that should truncate in the calendar'

const titledAnnouncement: Announcement = {
  ...longAnnouncement,
  id: 'announcement-4',
  title: titledAnnouncementTitle,
}

const scheduledAnnouncement: Announcement = {
  ...longAnnouncement,
  id: 'announcement-5',
  scheduled_for: '2099-03-14T12:00:00.000Z',
}

function renderWithTooltip(ui: ReactElement) {
  return render(<TooltipProvider>{ui}</TooltipProvider>)
}

describe('LessonDayCell', () => {
  it.each([
    { layout: 'agenda' as const, isWeekend: false },
    { layout: 'agenda' as const, isWeekend: true },
    { layout: 'grid' as const, isWeekend: false },
    { layout: 'grid' as const, isWeekend: true },
  ])('opens a named Test link without editing the lesson in $layout, weekend=$isWeekend', ({ layout, isWeekend }) => {
    const test = createMockTest({ title: 'Ecosystems test', status: 'active', test_date: lessonPlan.date })
    const onTestClick = vi.fn()
    const onContentChange = vi.fn()
    renderWithTooltip(<LessonDayCell date={lessonPlan.date} day={new Date(`${lessonPlan.date}T12:00:00`)}
      lessonPlan={lessonPlan} tests={[test]} layout={layout} isWeekend={isWeekend} isToday={false}
      editable onTestClick={onTestClick} onContentChange={onContentChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Test: Ecosystems test' }))
    expect(onTestClick).toHaveBeenCalledWith(test)
    expect(onContentChange).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

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

  it('enters toolbar-free WYSIWYG edit mode when the preview is clicked', () => {
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
    expect(screen.getByRole('textbox', { name: 'Lesson plan for March 13, 2026' })).toHaveTextContent('Lesson text')
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
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

  it('enters inline WYSIWYG edit mode when the date header is clicked', () => {
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

    expect(screen.getByRole('textbox', { name: 'Lesson plan for March 13, 2026' })).toHaveTextContent('Lesson text')
    expect(container.querySelector('.ProseMirror')).toBeTruthy()
  })

  it('keeps edited content visible after blur when parent state updates optimistically', async () => {
    const user = userEvent.setup()
    renderWithTooltip(<Harness />)

    fireEvent.click(screen.getByRole('button'))
    const editor = screen.getByRole('textbox', { name: 'Lesson plan for March 13, 2026' })
    editor.focus()
    await user.keyboard('{Control>}a{/Control}Updated lesson text')
    fireEvent.blur(editor)

    expect(screen.getByText('Updated lesson text')).toBeInTheDocument()
  })

  it('keeps edited content visible after pressing escape', async () => {
    const user = userEvent.setup()
    renderWithTooltip(<Harness />)

    fireEvent.click(screen.getByRole('button'))
    const editor = screen.getByRole('textbox', { name: 'Lesson plan for March 13, 2026' })
    editor.focus()
    await user.keyboard('{Control>}a{/Control}Saved via escape')
    fireEvent.keyDown(editor, { key: 'Escape' })

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

  it.each([false, true])('labels assignment due dates with accessible solid fill (compact=%s)', (compact) => {
    renderWithTooltip(
      <LessonDayCell
        date="2026-03-13"
        day={new Date('2026-03-13T12:00:00.000Z')}
        lessonPlan={lessonPlan}
        assignments={[{ id: 'assignment-1', title: 'Essay', is_draft: false } as Assignment]}
        isWeekend={false}
        isToday={false}
        editable={false}
        compact={compact}
      />
    )

    expect(screen.getByRole('button', { name: 'Due: Essay' })).toHaveClass(
      'bg-primary-solid',
      'hover:bg-primary-solid-hover',
      'text-text-inverse'
    )
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

  it('keeps future scheduled announcements labeled and visually distinct', () => {
    renderWithTooltip(
      <LessonDayCell
        date="2099-03-14"
        day={new Date('2099-03-14T12:00:00.000Z')}
        lessonPlan={null}
        announcements={[scheduledAnnouncement]}
        isWeekend={false}
        isToday={false}
        editable={false}
        compact={false}
      />
    )

    expect(screen.getByRole('button', { name: 'Scheduled' })).toHaveClass(
      'bg-amber-500/40',
      'hover:bg-amber-500/60',
    )
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

describe('LessonDayCell agenda', () => {
  const agendaProps = {
    date: '2026-03-13',
    day: new Date('2026-03-13T12:00:00.000Z'),
    lessonPlan,
    isWeekend: false,
    isToday: false,
    editable: true,
    layout: 'agenda' as const,
  }

  function AgendaHarness({ onContentChange }: { onContentChange: ReturnType<typeof vi.fn> }) {
    const [plan, setPlan] = useState(lessonPlan)
    return <LessonDayCell {...agendaProps} lessonPlan={plan} onContentChange={(date, markdown) => {
      onContentChange(date, markdown)
      setPlan((current) => ({ ...current, content_markdown: markdown }))
    }} />
  }

  it('starts editing when teacher lesson content is clicked', () => {
    renderWithTooltip(<LessonDayCell {...agendaProps} lessonPlan={{ ...lessonPlan,
      content_markdown: 'Lesson text\n[Read notes](https://example.com/notes)',
    }} />)
    expect(screen.getByRole('link', { name: 'Read notes' }).closest('button')).toBeNull()
    fireEvent.click(screen.getByRole('link', { name: 'Read notes' }))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Lesson text'))
    expect(screen.getByRole('textbox', { name: 'Lesson plan for March 13, 2026' })).toHaveTextContent('Lesson text')
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument()
  })

  it('autosaves teacher changes and returns focus to the content editing target on Escape', async () => {
    const user = userEvent.setup()
    const onContentChange = vi.fn()
    renderWithTooltip(<AgendaHarness onContentChange={onContentChange} />)
    await user.click(screen.getByRole('button', { name: 'Edit lesson for March 13, 2026' }))
    const editor = screen.getByRole('textbox', { name: 'Lesson plan for March 13, 2026' })
    editor.focus()
    await user.keyboard('{Control>}a{/Control}Updated agenda lesson')
    expect(onContentChange).toHaveBeenLastCalledWith('2026-03-13', 'Updated agenda lesson')
    fireEvent.keyDown(editor, { key: 'Escape' })
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByText('Updated agenda lesson')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit lesson for March 13, 2026' })).toHaveFocus())
  })

  it.each(['{Enter}', ' '])('opens the teacher content editor with %s', async key => {
    const user = userEvent.setup()
    renderWithTooltip(<LessonDayCell {...agendaProps} />)
    screen.getByRole('button', { name: 'Edit lesson for March 13, 2026' }).focus()
    await user.keyboard(key)
    expect(screen.getByRole('textbox', { name: 'Lesson plan for March 13, 2026' })).toBeInTheDocument()
  })

  it('retains autosaved teacher content when the editor loses focus', async () => {
    const user = userEvent.setup()
    const onContentChange = vi.fn()
    renderWithTooltip(<AgendaHarness onContentChange={onContentChange} />)
    await user.click(screen.getByRole('button', { name: 'Edit lesson for March 13, 2026' }))
    const editor = screen.getByRole('textbox')
    editor.focus()
    await user.keyboard('{Control>}a{/Control}Saved on blur')
    fireEvent.blur(editor)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.getByText('Saved on blur')).toBeInTheDocument()
    expect(onContentChange).toHaveBeenLastCalledWith('2026-03-13', 'Saved on blur')
  })

  it('renders student rich content and links without an interactive lesson wrapper', () => {
    renderWithTooltip(<LessonDayCell {...agendaProps} editable={false} lessonPlan={{
      ...lessonPlan, content_markdown: '### Read together\nRead the [course outline](https://example.com/outline).',
    }} />)
    const heading = screen.getByRole('heading', { name: 'Read together' })
    expect(heading.closest('button')).toBeNull()
    expect(screen.getByRole('link', { name: 'course outline' })).toHaveAttribute('href', 'https://example.com/outline')
    fireEvent.click(heading)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /edit lesson|add lesson/i })).not.toBeInTheDocument()
  })

  it.each([
    { editable: true, placeholder: 'No lesson planned' },
    { editable: false, placeholder: 'No lesson posted' },
  ])('explains empty class days for editable=$editable', ({ editable, placeholder }) => {
    renderWithTooltip(<LessonDayCell {...agendaProps} editable={editable} lessonPlan={null} isClassDay={true} />)
    expect(screen.getByText(placeholder)).toBeInTheDocument()
    if (editable) {
      fireEvent.click(screen.getByRole('button', { name: 'Add lesson for March 13, 2026' }))
      expect(screen.getByRole('textbox')).toHaveTextContent('')
    } else {
      expect(screen.queryByRole('button', { name: 'Add lesson for March 13, 2026' })).not.toBeInTheDocument()
    }
  })

  it.each([false, true])('omits empty lesson placeholders on non-class days (weekend=%s)', (isWeekend) => {
    renderWithTooltip(<LessonDayCell {...agendaProps} lessonPlan={null} isClassDay={false} isWeekend={isWeekend} />)
    expect(screen.getByText('No class')).toBeInTheDocument()
    expect(screen.queryByText(/No lesson planned|No lesson posted/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('No class'))
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    if (isWeekend) {
      expect(screen.queryByRole('button', { name: /edit lesson|add lesson/i })).not.toBeInTheDocument()
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'Add lesson for March 13, 2026' }))
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    }
  })

  it('marks today and presents the focused day without starting an editor', () => {
    const onPresentDay = vi.fn()
    renderWithTooltip(<LessonDayCell {...agendaProps} isToday={true} onPresentDay={onPresentDay} />)
    expect(screen.queryByText('Today')).not.toBeInTheDocument()
    expect(screen.getByText('13')).toHaveAttribute('aria-current', 'date')
    fireEvent.click(screen.getByRole('button', { name: /open friday, march 13, 2026/i }))
    expect(onPresentDay).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('makes every weekend event readable and independently navigable without editing', () => {
    const assignments = [
      { id: 'assignment-1', title: 'First weekend assignment with a complete title', is_draft: false } as Assignment,
      { id: 'assignment-2', title: 'Second weekend assignment', is_draft: false } as Assignment,
    ]
    const announcements = [titledAnnouncement, { ...longAnnouncement, id: 'announcement-other', title: 'Weekend reminder' }]
    const onAssignmentClick = vi.fn()
    const onAnnouncementClick = vi.fn()
    renderWithTooltip(<LessonDayCell {...agendaProps} isWeekend={true} isClassDay={false}
      assignments={assignments} announcements={announcements}
      onAssignmentClick={onAssignmentClick} onAnnouncementClick={onAnnouncementClick} />)
    for (const assignment of assignments) {
      fireEvent.click(screen.getByRole('button', { name: `Due: ${assignment.title}` }))
      expect(onAssignmentClick).toHaveBeenLastCalledWith(assignment)
    }
    for (const announcement of announcements) {
      fireEvent.click(screen.getByRole('button', { name: announcement.title! }))
    }
    expect(onAssignmentClick).toHaveBeenCalledTimes(2)
    expect(onAnnouncementClick).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /edit lesson|add lesson/i })).not.toBeInTheDocument()
  })
})
