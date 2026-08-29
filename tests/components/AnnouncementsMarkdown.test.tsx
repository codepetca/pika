import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Suspense, startTransition, useState } from 'react'
import { TeacherAnnouncementsSection } from '@/app/classrooms/[classroomId]/TeacherAnnouncementsSection'
import { StudentAnnouncementsSection } from '@/app/classrooms/[classroomId]/StudentAnnouncementsSection'
import {
  StudentNotificationsProvider,
  useStudentNotifications,
} from '@/components/StudentNotificationsProvider'
import { invalidateCachedJSONMatching } from '@/lib/request-cache'
import { TooltipProvider } from '@/ui'
import type { Announcement, Classroom } from '@/types'

const classroom: Classroom = {
  id: 'classroom-announcements-markdown',
  teacher_id: 'teacher-1',
  title: 'Announcements Markdown',
  class_code: 'ABC123',
  theme_color: 'blue',
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

const secondClassroom: Classroom = {
  ...classroom,
  id: 'classroom-announcements-second',
  title: 'Second Announcements',
}

const secondClassroomAnnouncement: Announcement = {
  ...markdownAnnouncement,
  id: 'second-classroom-announcement',
  classroom_id: secondClassroom.id,
  title: 'Second classroom update',
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
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

function teacherAnnouncementsElement(sectionClassroom: Classroom) {
  return (
    <TooltipProvider>
      <TeacherAnnouncementsSection classroom={sectionClassroom} />
    </TooltipProvider>
  )
}

function UnreadAnnouncementCount() {
  const notifications = useStudentNotifications()
  return <div>Unread announcements: {notifications?.unreadAnnouncementsCount ?? 0}</div>
}

const suspendedClassroomRender = new Promise<never>(() => undefined)

function SuspendSecondClassroom({ classroomId }: { classroomId: string }) {
  if (classroomId === secondClassroom.id) throw suspendedClassroomRender
  return null
}

function TeacherTransitionHarness() {
  const [activeClassroom, setActiveClassroom] = useState(classroom)

  return (
    <TooltipProvider>
      <button
        type="button"
        onClick={() => startTransition(() => setActiveClassroom(secondClassroom))}
      >
        Attempt classroom switch
      </button>
      <Suspense fallback={<div>Switching classroom</div>}>
        <TeacherAnnouncementsSection classroom={activeClassroom} />
        <SuspendSecondClassroom classroomId={activeClassroom.id} />
      </Suspense>
    </TooltipProvider>
  )
}

function StudentTransitionHarness() {
  const [activeClassroom, setActiveClassroom] = useState(classroom)

  return (
    <>
      <button
        type="button"
        onClick={() => startTransition(() => setActiveClassroom(secondClassroom))}
      >
        Attempt student classroom switch
      </button>
      <Suspense fallback={<div>Switching student classroom</div>}>
        <StudentAnnouncementsSection classroom={activeClassroom} />
        <SuspendSecondClassroom classroomId={activeClassroom.id} />
      </Suspense>
    </>
  )
}

describe('announcement markdown rendering', () => {
  beforeEach(() => {
    invalidateCachedJSONMatching('teacher-announcements:')
    invalidateCachedJSONMatching('student-announcements:')
    invalidateCachedJSONMatching('student-notifications:')
    mockAnnouncementFetch()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders teacher announcements as markdown without turning link clicks into edit mode', async () => {
    render(teacherAnnouncementsElement(classroom))

    const link = await screen.findByRole('link', { name: 'course outline' })

    expect(link).toHaveAttribute('href', 'https://example.com/outline')
    expect(screen.getByText('Unit update')).toBeInTheDocument()
    expect(screen.getByText('bring notes')).toBeInTheDocument()

    fireEvent.click(link)

    await waitFor(() => {
      expect(screen.queryByDisplayValue(markdownAnnouncement.content)).not.toBeInTheDocument()
    })
  })

  it('reuses the teacher announcement cache on remount', async () => {
    const fetchMock = vi.mocked(fetch)

    const firstRender = render(teacherAnnouncementsElement(classroom))

    await screen.findByRole('link', { name: 'course outline' })

    firstRender.unmount()
    render(teacherAnnouncementsElement(classroom))

    await screen.findByRole('link', { name: 'course outline' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('renders a larger, vertically resizable creation textarea', async () => {
    const { container } = render(teacherAnnouncementsElement(classroom))

    await screen.findByRole('link', { name: 'course outline' })
    fireEvent.click(screen.getByRole('button', { name: 'New announcement' }))

    const titleInput = screen.getByPlaceholderText('Title (optional)')
    const titleLabel = container.querySelector(`label[for="${titleInput.id}"]`)
    expect(titleLabel).toHaveClass('sr-only')
    expect(screen.queryByPlaceholderText('Optional title')).not.toBeInTheDocument()
    expect(titleInput.compareDocumentPosition(screen.getByText('Unit update')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    const textarea = screen.getByRole('textbox', { name: 'Announcement body' })
    expect(textarea).toHaveAttribute('rows', '6')
    expect(textarea).toHaveClass('min-h-[10rem]')
    expect(textarea).toHaveClass('resize-y')

    fireEvent.change(textarea, { target: { value: 'Announcement draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Choose announcement action' }))
    expect(screen.getByRole('menuitem', { name: 'Schedule...' })).toBeInTheDocument()
  })

  it('keeps announcement creation in the shared action surface menu', async () => {
    render(teacherAnnouncementsElement(classroom))

    await screen.findByRole('link', { name: 'course outline' })

    const contextBar = screen.getByRole('region', { name: 'Announcement controls' })
    expect(contextBar).toHaveClass('grid', 'relative', 'z-floating')
    expect(screen.getByRole('button', { name: 'New announcement' })).toBeInTheDocument()
    const actionsTrigger = screen.getByRole('button', { name: 'Announcement actions' })
    expect(actionsTrigger.closest('.fixed')).toBeNull()
    expect(actionsTrigger).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(actionsTrigger)

    const menu = screen.getByRole('menu', { name: 'Announcement actions' })
    const expandedTrigger = screen.getByRole('button', { name: 'Announcement actions' })
    expect(menu).toBeInTheDocument()
    expect(expandedTrigger).toHaveAttribute('aria-expanded', 'true')
    expect(expandedTrigger).toHaveAttribute('aria-controls', menu.id)
    expect(screen.getByRole('menuitem', { name: 'Announcement' })).toBeInTheDocument()
  })

  it('labels the edit announcement textarea', async () => {
    render(teacherAnnouncementsElement(classroom))

    await screen.findByRole('link', { name: 'course outline' })
    fireEvent.click(screen.getByText('bring notes'))

    expect(screen.getByRole('textbox', { name: 'Edit announcement body' })).toHaveValue(
      markdownAnnouncement.content,
    )
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

    render(teacherAnnouncementsElement(classroom))

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

  it('shows a retryable teacher error instead of a false empty state', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Unavailable' }), { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ announcements: [markdownAnnouncement] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
    vi.stubGlobal('fetch', fetchMock)

    render(teacherAnnouncementsElement(classroom))

    expect(await screen.findByRole('alert')).toHaveTextContent("Announcements couldn't load")
    expect(screen.queryByText(/No announcements yet/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('Unit update')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    consoleError.mockRestore()
  })

  it('shows a retryable student error instead of a false empty state', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Unavailable' }), { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ announcements: [markdownAnnouncement] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, marked: 1 }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    render(<StudentAnnouncementsSection classroom={classroom} />)

    expect(await screen.findByRole('alert')).toHaveTextContent("Announcements couldn't load")
    expect(screen.queryByText('No announcements yet')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('Unit update')).toBeInTheDocument()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    consoleError.mockRestore()
  })

  it('keeps failed student read acknowledgement visible and retryable', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let postCount = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST') {
          postCount += 1
          return postCount === 1
            ? new Response(JSON.stringify({ error: 'Unavailable' }), { status: 500 })
            : new Response(JSON.stringify({ success: true, marked: 1 }), { status: 200 })
        }

        return new Response(JSON.stringify({ announcements: [markdownAnnouncement] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )

    render(<StudentAnnouncementsSection classroom={classroom} />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Announcements are visible, but Pika could not mark them as read.',
    )
    expect(screen.getByText('Unit update')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(postCount).toBe(2))
    await waitFor(() => {
      expect(screen.queryByText('Announcements are visible, but Pika could not mark them as read.')).not.toBeInTheDocument()
    })
    consoleError.mockRestore()
  })

  it('does not retry a failed read acknowledgement when notification state settles', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let resolveNotifications!: (response: Response) => void
    const notificationsResponse = new Promise<Response>((resolve) => {
      resolveNotifications = resolve
    })
    let postCount = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes('/api/student/notifications')) {
          return notificationsResponse
        }
        if (init?.method === 'POST') {
          postCount += 1
          return postCount === 1
            ? new Response(JSON.stringify({ error: 'Unavailable' }), { status: 500 })
            : new Response(JSON.stringify({ success: true, marked: 1 }), { status: 200 })
        }

        return new Response(JSON.stringify({ announcements: [markdownAnnouncement] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )

    render(
      <StudentNotificationsProvider classroomId={classroom.id}>
        <UnreadAnnouncementCount />
        <StudentAnnouncementsSection classroom={classroom} />
      </StudentNotificationsProvider>,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Announcements are visible, but Pika could not mark them as read.',
    )
    expect(postCount).toBe(1)

    await act(async () => {
      resolveNotifications(
        new Response(JSON.stringify({
          hasTodayEntry: true,
          unviewedAssignmentsCount: 0,
          activeTestsCount: 0,
          unreadAnnouncementsCount: 1,
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })

    expect(await screen.findByText('Unread announcements: 1')).toBeInTheDocument()
    expect(postCount).toBe(1)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Announcements are visible, but Pika could not mark them as read.',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(postCount).toBe(2))
    expect(await screen.findByText('Unread announcements: 0')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    consoleError.mockRestore()
  })

  it('finishes a student read acknowledgement when a classroom switch is suspended', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const readResponse = deferred<Response>()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST') return readResponse.promise
        return new Response(JSON.stringify({ announcements: [markdownAnnouncement] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )

    render(<StudentTransitionHarness />)
    await screen.findByText('Unit update')
    await waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        `/api/student/classrooms/${classroom.id}/announcements`,
        { method: 'POST' },
      )
    })
    fireEvent.click(screen.getByRole('button', { name: 'Attempt student classroom switch' }))

    await act(async () => {
      readResponse.resolve(
        new Response(JSON.stringify({ error: 'Unavailable' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Announcements are visible, but Pika could not mark them as read.',
    )
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled()
    consoleError.mockRestore()
  })

  it('does not keep stale teacher announcements visible while loading another classroom', async () => {
    let resolveSecondRead: ((response: Response) => void) | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes(secondClassroom.id)) {
          return new Promise<Response>((resolve) => {
            resolveSecondRead = resolve
          })
        }

        return new Response(JSON.stringify({ announcements: [markdownAnnouncement] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )

    const secondAnnouncement: Announcement = {
      ...markdownAnnouncement,
      id: 'second-announcement',
      classroom_id: secondClassroom.id,
      title: 'Second classroom update',
    }

    const view = render(teacherAnnouncementsElement(classroom))

    await screen.findByText('Unit update')

    view.rerender(teacherAnnouncementsElement(secondClassroom))

    expect(screen.queryByText('Unit update')).not.toBeInTheDocument()

    await act(async () => {
      resolveSecondRead?.(
        new Response(JSON.stringify({ announcements: [secondAnnouncement] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })

    expect(await screen.findByText('Second classroom update')).toBeInTheDocument()
  })

  it('does not relabel old teacher announcements when the next classroom fails to load', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes(secondClassroom.id)) {
          return new Response(JSON.stringify({ error: 'Unavailable' }), { status: 500 })
        }

        return new Response(JSON.stringify({ announcements: [markdownAnnouncement] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )

    const view = render(teacherAnnouncementsElement(classroom))
    await screen.findByText('Unit update')

    view.rerender(teacherAnnouncementsElement(secondClassroom))

    expect(await screen.findByRole('alert')).toHaveTextContent("Announcements couldn't load")
    expect(screen.queryByText('Unit update')).not.toBeInTheDocument()
    consoleError.mockRestore()
  })

  it('ignores a failed teacher create after switching classrooms', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const createResponse = deferred<Response>()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST') return createResponse.promise
        const announcements = String(input).includes(secondClassroom.id)
          ? [secondClassroomAnnouncement]
          : [markdownAnnouncement]
        return new Response(JSON.stringify({ announcements }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )

    const view = render(teacherAnnouncementsElement(classroom))
    await screen.findByText('Unit update')
    fireEvent.click(screen.getByRole('button', { name: 'New announcement' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Announcement body' }), {
      target: { value: 'Pending Classroom A update' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))

    expect(await screen.findByText('Pending Classroom A update', { selector: 'p' })).toBeInTheDocument()
    view.rerender(teacherAnnouncementsElement(secondClassroom))
    expect(await screen.findByText('Second classroom update')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New announcement' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Delete announcement' })).toBeEnabled()

    await act(async () => {
      createResponse.resolve(
        new Response(JSON.stringify({ error: 'Unavailable' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })

    expect(screen.getByText('Second classroom update')).toBeInTheDocument()
    expect(screen.queryByText('Pending Classroom A update')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New announcement' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Delete announcement' })).toBeEnabled()
    consoleError.mockRestore()
  })

  it('ignores a failed teacher edit after switching classrooms', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const editResponse = deferred<Response>()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'PATCH') return editResponse.promise
        const announcements = String(input).includes(secondClassroom.id)
          ? [secondClassroomAnnouncement]
          : [markdownAnnouncement]
        return new Response(JSON.stringify({ announcements }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )

    const view = render(teacherAnnouncementsElement(classroom))
    await screen.findByText('Unit update')
    fireEvent.click(screen.getByText('bring notes'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit announcement body' }), {
      target: { value: 'Edited Classroom A update' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))

    view.rerender(teacherAnnouncementsElement(secondClassroom))
    expect(await screen.findByText('Second classroom update')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New announcement' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Delete announcement' })).toBeEnabled()

    await act(async () => {
      editResponse.resolve(
        new Response(JSON.stringify({ error: 'Unavailable' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })

    expect(screen.getByText('Second classroom update')).toBeInTheDocument()
    expect(screen.queryByText('Edited Classroom A update')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New announcement' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Delete announcement' })).toBeEnabled()
    consoleError.mockRestore()
  })

  it('ignores a successful teacher delete after switching classrooms', async () => {
    const deleteResponse = deferred<Response>()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'DELETE') return deleteResponse.promise
        const announcements = String(input).includes(secondClassroom.id)
          ? [secondClassroomAnnouncement]
          : [markdownAnnouncement]
        return new Response(JSON.stringify({ announcements }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )

    const view = render(teacherAnnouncementsElement(classroom))
    await screen.findByText('Unit update')
    fireEvent.click(screen.getByRole('button', { name: 'Delete announcement' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))

    view.rerender(teacherAnnouncementsElement(secondClassroom))
    expect(await screen.findByText('Second classroom update')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New announcement' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Delete announcement' })).toBeEnabled()

    await act(async () => {
      deleteResponse.resolve(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })

    expect(screen.getByText('Second classroom update')).toBeInTheDocument()
    expect(screen.queryByText('Unit update')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New announcement' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Delete announcement' })).toBeEnabled()
  })

  it('finishes a teacher create when a suspended classroom switch is abandoned', async () => {
    const createResponse = deferred<Response>()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST') return createResponse.promise
        return new Response(JSON.stringify({ announcements: [markdownAnnouncement] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )

    render(<TeacherTransitionHarness />)
    await screen.findByText('Unit update')
    fireEvent.click(screen.getByRole('button', { name: 'New announcement' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Announcement body' }), {
      target: { value: 'Created while switch is suspended' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    fireEvent.click(screen.getByText('Attempt classroom switch'))

    await act(async () => {
      createResponse.resolve(
        new Response(JSON.stringify({
          announcement: {
            ...markdownAnnouncement,
            id: 'created-during-suspense',
            content: 'Created while switch is suspended',
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })

    expect(screen.getByText('Created while switch is suspended', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New announcement' })).toBeEnabled()
  })

  it('finishes a teacher edit when a suspended classroom switch is abandoned', async () => {
    const editResponse = deferred<Response>()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'PATCH') return editResponse.promise
        return new Response(JSON.stringify({ announcements: [markdownAnnouncement] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )

    render(<TeacherTransitionHarness />)
    await screen.findByText('Unit update')
    fireEvent.click(screen.getByText('bring notes'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit announcement body' }), {
      target: { value: 'Edited while switch is suspended' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Post' }))
    fireEvent.click(screen.getByRole('button', { name: 'Attempt classroom switch' }))

    await act(async () => {
      editResponse.resolve(
        new Response(JSON.stringify({
          announcement: {
            ...markdownAnnouncement,
            content: 'Edited while switch is suspended',
          },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })

    expect(screen.getByText('Edited while switch is suspended', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New announcement' })).toBeEnabled()
  })

  it('rolls back a teacher delete when a suspended classroom switch is abandoned', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const deleteResponse = deferred<Response>()
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'DELETE') return deleteResponse.promise
        return new Response(JSON.stringify({ announcements: [markdownAnnouncement] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )

    render(<TeacherTransitionHarness />)
    await screen.findByText('Unit update')
    fireEvent.click(screen.getByRole('button', { name: 'Delete announcement' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByText('Attempt classroom switch'))

    await act(async () => {
      deleteResponse.resolve(
        new Response(JSON.stringify({ error: 'Unavailable' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })

    expect(screen.getByText('Unit update')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete announcement' })).toBeEnabled()
    consoleError.mockRestore()
  })

  it('marks student announcements read once per classroom', async () => {
    const markedReadUrls: string[] = []
    let resolveSecondRead: ((response: Response) => void) | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (init?.method === 'POST') {
          markedReadUrls.push(url)
          return new Response(JSON.stringify({ success: true, marked: 1 }), { status: 200 })
        }

        if (url.includes(secondClassroom.id)) {
          return new Promise<Response>((resolve) => {
            resolveSecondRead = resolve
          })
        }

        return new Response(JSON.stringify({ announcements: [markdownAnnouncement] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }),
    )

    const view = render(<StudentAnnouncementsSection classroom={classroom} />)

    await screen.findByText('Unit update')
    await waitFor(() => {
      expect(markedReadUrls).toEqual([
        `/api/student/classrooms/${classroom.id}/announcements`,
      ])
    })

    view.rerender(<StudentAnnouncementsSection classroom={secondClassroom} />)

    expect(markedReadUrls).toEqual([
      `/api/student/classrooms/${classroom.id}/announcements`,
    ])

    await act(async () => {
      resolveSecondRead?.(
        new Response(
          JSON.stringify({
            announcements: [
              {
                ...markdownAnnouncement,
                id: 'second-student-announcement',
                classroom_id: secondClassroom.id,
                title: 'Second student update',
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      )
    })

    await screen.findByText('Second student update')
    await waitFor(() => {
      expect(markedReadUrls).toEqual([
        `/api/student/classrooms/${classroom.id}/announcements`,
        `/api/student/classrooms/${secondClassroom.id}/announcements`,
      ])
    })
  })
})
