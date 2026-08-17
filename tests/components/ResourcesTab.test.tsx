import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { TeacherResourcesTab } from '@/app/classrooms/[classroomId]/TeacherResourcesTab'
import { StudentResourcesTab } from '@/app/classrooms/[classroomId]/StudentResourcesTab'
import { TeacherAnnouncementsTab } from '@/app/classrooms/[classroomId]/TeacherAnnouncementsTab'
import { StudentAnnouncementsTab } from '@/app/classrooms/[classroomId]/StudentAnnouncementsTab'
import { SyllabusPreview } from '@/components/SyllabusPreview'
import { SYLLABUS_PREVIEW_READY } from '@/lib/syllabus-preview-messages'

vi.mock('@/app/classrooms/[classroomId]/TeacherClassResourcesSidebar', () => ({
  TeacherClassResourcesSidebar: () => <div>Teacher resources content</div>,
}))

vi.mock('@/app/classrooms/[classroomId]/StudentClassResourcesSidebar', () => ({
  StudentClassResourcesSidebar: () => <div>Student resources content</div>,
}))

vi.mock('@/app/classrooms/[classroomId]/TeacherAnnouncementsSection', () => ({
  TeacherAnnouncementsSection: () => <div>Teacher announcements content</div>,
}))

vi.mock('@/app/classrooms/[classroomId]/StudentAnnouncementsSection', () => ({
  StudentAnnouncementsSection: () => <div>Student announcements content</div>,
}))

const classroom = {
  id: 'classroom-1',
  teacher_id: 'teacher-1',
  title: 'Test Classroom',
  class_code: 'ABC123',
  theme_color: 'blue',
  term_label: null,
  created_at: '2026-04-14T00:00:00.000Z',
  updated_at: '2026-04-14T00:00:00.000Z',
  allow_enrollment: true,
  start_date: '2026-02-01',
  end_date: '2026-06-30',
  archived_at: null,
  lesson_plan_visibility: 'current_week',
  position: 0,
  source_blueprint_id: null,
  source_blueprint_origin: null,
  actual_site_slug: 'test-classroom',
  actual_site_published: true,
  actual_site_config: {
    overview: true,
    outline: true,
    resources: true,
    assignments: true,
    tests: true,
    lesson_plans: true,
    announcements: true,
    lesson_plan_scope: 'current_week',
  },
  course_overview_markdown: '',
  course_outline_markdown: '',
} as const

describe('ResourcesTab', () => {
  it('renders teacher resources as a syllabus entry point', () => {
    render(<TeacherResourcesTab classroom={classroom} />)

    const preview = screen.getByTitle('Test Classroom syllabus preview')
    expect(preview).toHaveAttribute('src', '/actual/test-classroom')
    expect(preview).toHaveAttribute('tabindex', '-1')
    expect(screen.getByRole('heading', { name: 'Syllabus' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open syllabus' })).toHaveAttribute(
      'href',
      '/actual/test-classroom',
    )
    expect(screen.getByText('Loading syllabus')).toBeInTheDocument()
    fireEvent.load(preview)
    expect(screen.getByText('Loading syllabus')).toBeInTheDocument()
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          type: SYLLABUS_PREVIEW_READY,
          href: `${window.location.origin}/actual/test-classroom`,
        },
        origin: window.location.origin,
        source: (preview as HTMLIFrameElement).contentWindow,
      }))
    })
    expect(screen.queryByText('Loading syllabus')).toBeNull()
    expect(preview).toHaveAttribute('tabindex', '0')
    expect(screen.queryByText('Public syllabus')).toBeNull()
    expect(screen.queryByRole('button', { name: /syllabus settings/i })).toBeNull()
    expect(screen.queryByRole('link', { name: '/actual/test-classroom' })).toBeNull()
    expect(screen.queryByText('Teacher announcements content')).toBeNull()
  })

  it('ignores readiness messages from another frame or URL', () => {
    render(
      <SyllabusPreview
        classroomTitle="Test Classroom"
        siteHref="/actual/test-classroom"
      />,
    )

    const preview = screen.getByTitle('Test Classroom syllabus preview')
    const sendReady = (source: MessageEventSource | null, href: string) => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: SYLLABUS_PREVIEW_READY, href },
        origin: window.location.origin,
        source,
      }))
    }

    act(() => {
      sendReady(window, `${window.location.origin}/actual/test-classroom`)
      sendReady(
        (preview as HTMLIFrameElement).contentWindow,
        `${window.location.origin}/actual/another-classroom`,
      )
    })

    expect(screen.getByText('Loading syllabus')).toBeInTheDocument()
    expect(preview).toHaveAttribute('tabindex', '-1')
  })

  it('returns a changed syllabus URL to protected loading state', () => {
    vi.useFakeTimers()
    try {
      const { rerender } = render(<TeacherResourcesTab classroom={classroom} />)
      const originalPreview = screen.getByTitle('Test Classroom syllabus preview')
      const originalWindow = (originalPreview as HTMLIFrameElement).contentWindow

      act(() => {
        window.dispatchEvent(new MessageEvent('message', {
          data: {
            type: SYLLABUS_PREVIEW_READY,
            href: `${window.location.origin}/actual/test-classroom`,
          },
          origin: window.location.origin,
          source: originalWindow,
        }))
      })
      expect(originalPreview).toHaveAttribute('tabindex', '0')

      rerender(
        <TeacherResourcesTab
          classroom={{ ...classroom, actual_site_slug: 'replacement-classroom' }}
        />,
      )
      const replacementPreview = screen.getByTitle('Test Classroom syllabus preview')
      expect(replacementPreview).toHaveAttribute('src', '/actual/replacement-classroom')
      expect(replacementPreview).toHaveAttribute('tabindex', '-1')
      expect(screen.getByText('Loading syllabus')).toBeInTheDocument()

      act(() => {
        window.dispatchEvent(new MessageEvent('message', {
          data: {
            type: SYLLABUS_PREVIEW_READY,
            href: `${window.location.origin}/actual/test-classroom`,
          },
          origin: window.location.origin,
          source: originalWindow,
        }))
        vi.advanceTimersByTime(15_000)
      })

      expect(screen.getByRole('alert')).toHaveTextContent('Syllabus unavailable')
      expect(replacementPreview).toHaveAttribute('tabindex', '-1')
    } finally {
      vi.useRealTimers()
    }
  })

  it('renders student resources as a syllabus entry point', () => {
    render(<StudentResourcesTab classroom={classroom} />)

    expect(screen.getByTitle('Test Classroom syllabus preview')).toHaveAttribute('src', '/actual/test-classroom')
    expect(screen.getByRole('link', { name: 'Open syllabus' })).toHaveAttribute(
      'target',
      '_blank',
    )
    expect(screen.queryByText('Public syllabus')).toBeNull()
    expect(screen.queryByText('Student announcements content')).toBeNull()
  })

  it('shows a retryable error when the published syllabus cannot load', () => {
    vi.useFakeTimers()
    try {
      render(<TeacherResourcesTab classroom={classroom} />)

      act(() => {
        vi.advanceTimersByTime(15_000)
      })

      expect(screen.getByRole('alert')).toHaveTextContent('Syllabus unavailable')
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

      expect(screen.getByText('Loading syllabus')).toBeInTheDocument()
      expect(screen.getByTitle('Test Classroom syllabus preview')).toHaveAttribute(
        'src',
        '/actual/test-classroom?previewAttempt=1',
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows unpublished state for students when the site is private', () => {
    render(<StudentResourcesTab classroom={{ ...classroom, actual_site_published: false }} />)

    expect(screen.getByText('No syllabus yet')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /open external/i })).toBeNull()
    expect(screen.queryByTitle('Test Classroom syllabus preview')).toBeNull()
  })

  it('renders teacher announcements in the announcements tab', () => {
    render(<TeacherAnnouncementsTab classroom={classroom} />)

    expect(screen.getByText('Teacher announcements content')).toBeInTheDocument()
    expect(screen.queryByText('Teacher resources content')).toBeNull()
  })

  it('renders student announcements in the announcements tab', () => {
    render(<StudentAnnouncementsTab classroom={classroom} />)

    expect(screen.getByText('Student announcements content')).toBeInTheDocument()
    expect(screen.queryByText('Student resources content')).toBeNull()
  })
})
