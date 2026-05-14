import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TeacherAnnouncementsSection } from '@/app/classrooms/[classroomId]/TeacherAnnouncementsSection'
import { StudentAnnouncementsSection } from '@/app/classrooms/[classroomId]/StudentAnnouncementsSection'
import { invalidateCachedJSONMatching } from '@/lib/request-cache'
import type { Announcement, Classroom } from '@/types'

const classroom: Classroom = {
  id: 'classroom-announcements-markdown',
  teacher_id: 'teacher-1',
  title: 'Announcements Markdown',
  class_code: 'ABC123',
  term_label: null,
  allow_enrollment: true,
  start_date: '2026-02-01',
  end_date: '2026-06-30',
  lesson_plan_visibility: 'current_week',
  source_blueprint_id: null,
  source_blueprint_origin: null,
  actual_site_slug: null,
  actual_site_published: false,
  actual_site_config: {
    overview: true,
    outline: true,
    resources: true,
    assignments: true,
    quizzes: true,
    tests: true,
    lesson_plans: true,
    announcements: true,
    lesson_plan_scope: 'current_week',
  },
  course_overview_markdown: '',
  course_outline_markdown: '',
  archived_at: null,
  created_at: '2026-05-13T00:00:00.000Z',
  updated_at: '2026-05-13T00:00:00.000Z',
}

const markdownAnnouncement: Announcement = {
  id: 'announcement-1',
  classroom_id: classroom.id,
  title: 'Unit update',
  content: 'Read the [course outline](https://example.com/outline) and **bring notes**.',
  created_by: classroom.teacher_id,
  scheduled_for: null,
  created_at: '2026-05-13T12:00:00.000Z',
  updated_at: '2026-05-13T12:00:00.000Z',
}

function mockAnnouncementFetch(announcements: Announcement[] = [markdownAnnouncement]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ success: true, marked: 1 }), { status: 200 })
      }

      return new Response(JSON.stringify({ announcements }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }),
  )
}

describe('announcement markdown rendering', () => {
  beforeEach(() => {
    invalidateCachedJSONMatching('teacher-announcements:')
    invalidateCachedJSONMatching('student-announcements:')
    mockAnnouncementFetch()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders teacher announcements as markdown without turning link clicks into edit mode', async () => {
    render(<TeacherAnnouncementsSection classroom={classroom} />)

    const link = await screen.findByRole('link', { name: 'course outline' })

    expect(link).toHaveAttribute('href', 'https://example.com/outline')
    expect(screen.getByText('Unit update')).toBeInTheDocument()
    expect(screen.getByText('bring notes')).toBeInTheDocument()

    fireEvent.click(link)

    await waitFor(() => {
      expect(screen.queryByDisplayValue(markdownAnnouncement.content)).not.toBeInTheDocument()
    })
  })

  it('renders a larger, vertically resizable creation textarea', async () => {
    const { container } = render(<TeacherAnnouncementsSection classroom={classroom} />)

    await screen.findByRole('link', { name: 'course outline' })
    fireEvent.click(screen.getByRole('button', { name: 'New announcement' }))

    const titleInput = screen.getByPlaceholderText('Title (optional)')
    const titleLabel = container.querySelector(`label[for="${titleInput.id}"]`)
    expect(titleLabel).toHaveClass('sr-only')
    expect(screen.queryByPlaceholderText('Optional title')).not.toBeInTheDocument()
    expect(titleInput.compareDocumentPosition(screen.getByText('Unit update')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    const textarea = screen.getByPlaceholderText('Write an announcement...')
    expect(textarea).toHaveAttribute('rows', '6')
    expect(textarea).toHaveClass('min-h-[10rem]')
    expect(textarea).toHaveClass('resize-y')

    fireEvent.change(textarea, { target: { value: 'Announcement draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Choose announcement action' }))
    expect(screen.getByRole('menuitem', { name: 'Schedule...' })).toBeInTheDocument()
  })

  it('shows the newest teacher announcements first', async () => {
    mockAnnouncementFetch([
      {
        ...markdownAnnouncement,
        id: 'older-scheduled-announcement',
        title: 'Older scheduled update',
        scheduled_for: '2026-05-20T12:00:00.000Z',
        created_at: '2026-05-12T12:00:00.000Z',
        updated_at: '2026-05-12T12:00:00.000Z',
      },
      {
        ...markdownAnnouncement,
        id: 'newest-announcement',
        title: 'Newest update',
        scheduled_for: null,
        created_at: '2026-05-14T12:00:00.000Z',
        updated_at: '2026-05-14T12:00:00.000Z',
      },
      {
        ...markdownAnnouncement,
        id: 'middle-announcement',
        title: 'Middle update',
        scheduled_for: null,
        created_at: '2026-05-13T12:00:00.000Z',
        updated_at: '2026-05-13T12:00:00.000Z',
      },
    ])

    render(<TeacherAnnouncementsSection classroom={classroom} />)

    const newest = await screen.findByText('Newest update')
    const middle = screen.getByText('Middle update')
    const scheduled = screen.getByText('Older scheduled update')

    expect(newest.compareDocumentPosition(middle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(middle.compareDocumentPosition(scheduled) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('renders student announcements as markdown links', async () => {
    render(<StudentAnnouncementsSection classroom={classroom} />)

    const link = await screen.findByRole('link', { name: 'course outline' })

    expect(link).toHaveAttribute('href', 'https://example.com/outline')
    expect(link).toHaveAttribute('target', '_blank')
    expect(screen.getByText('Unit update')).toBeInTheDocument()
    expect(screen.getByText('bring notes')).toBeInTheDocument()
  })
})
