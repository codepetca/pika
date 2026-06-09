import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TeacherClassResourcesSidebar } from '@/app/classrooms/[classroomId]/TeacherClassResourcesSidebar'
import { StudentClassResourcesSidebar } from '@/app/classrooms/[classroomId]/StudentClassResourcesSidebar'
import { invalidateCachedJSONMatching } from '@/lib/request-cache'
import type { Classroom, TiptapContent, TiptapNode } from '@/types'

vi.mock('@/components/editor', () => {
  function extractText(content: TiptapContent | null | undefined): string {
    function fromNode(node: TiptapNode): string {
      return [node.text, ...(node.content ?? []).map(fromNode)].filter(Boolean).join(' ')
    }

    return (content?.content ?? []).map(fromNode).join(' ')
  }

  function contentDoc(text: string): TiptapContent {
    return {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    }
  }

  return {
    RichTextEditor: ({ content, onBlur, onChange }: any) => (
      <div>
        <div data-testid="rich-text-editor">{extractText(content)}</div>
        <button type="button" onClick={() => onChange(contentDoc('Updated teacher resources'))}>
          Change teacher resources
        </button>
        <button type="button" onClick={() => onBlur?.()}>
          Blur resources editor
        </button>
      </div>
    ),
    RichTextViewer: ({ content }: any) => (
      <div data-testid="rich-text-viewer">{extractText(content)}</div>
    ),
  }
})

const classroom: Classroom = {
  id: 'classroom-resources',
  teacher_id: 'teacher-1',
  title: 'Resources Classroom',
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

const secondClassroom: Classroom = {
  ...classroom,
  id: 'classroom-resources-second',
  title: 'Second Resources',
}

function contentDoc(text: string): TiptapContent {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  }
}

function resourceResponse(text: string | null): Response {
  return new Response(
    JSON.stringify({
      resources: text
        ? {
            id: `resources-${text}`,
            classroom_id: classroom.id,
            content: contentDoc(text),
          }
        : null,
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    },
  )
}

describe('class resources sidebars', () => {
  beforeEach(() => {
    invalidateCachedJSONMatching('teacher-resources:')
    invalidateCachedJSONMatching('student-resources:')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not keep stale teacher resources visible while loading another classroom', async () => {
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

        return resourceResponse('First teacher resources')
      }),
    )

    const view = render(<TeacherClassResourcesSidebar classroom={classroom} />)

    await screen.findByText('First teacher resources')

    view.rerender(<TeacherClassResourcesSidebar classroom={secondClassroom} />)

    expect(screen.queryByText('First teacher resources')).not.toBeInTheDocument()

    await act(async () => {
      resolveSecondRead?.(resourceResponse('Second teacher resources'))
    })

    expect(await screen.findByText('Second teacher resources')).toBeInTheDocument()
  })

  it('does not keep stale student resources visible while loading another classroom', async () => {
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

        return resourceResponse('First student resources')
      }),
    )

    const view = render(<StudentClassResourcesSidebar classroom={classroom} />)

    await screen.findByText('First student resources')

    view.rerender(<StudentClassResourcesSidebar classroom={secondClassroom} />)

    expect(screen.queryByText('First student resources')).not.toBeInTheDocument()

    await act(async () => {
      resolveSecondRead?.(resourceResponse('Second student resources'))
    })

    expect(await screen.findByText('Second student resources')).toBeInTheDocument()
  })

  it('does not save a pending teacher edit to the next classroom after switching', async () => {
    const writeUrls: string[] = []
    let resolveSecondRead: ((response: Response) => void) | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (init?.method === 'PUT') {
          writeUrls.push(url)
          return resourceResponse('Updated teacher resources')
        }

        if (url.includes(secondClassroom.id)) {
          return new Promise<Response>((resolve) => {
            resolveSecondRead = resolve
          })
        }

        return resourceResponse('First teacher resources')
      }),
    )

    const view = render(<TeacherClassResourcesSidebar classroom={classroom} />)

    await screen.findByText('First teacher resources')
    fireEvent.click(screen.getByRole('button', { name: 'Change teacher resources' }))

    view.rerender(<TeacherClassResourcesSidebar classroom={secondClassroom} />)
    fireEvent.click(screen.getByRole('button', { name: 'Blur resources editor' }))

    expect(writeUrls).toEqual([])

    await act(async () => {
      resolveSecondRead?.(resourceResponse('Second teacher resources'))
    })

    expect(await screen.findByText('Second teacher resources')).toBeInTheDocument()
    expect(writeUrls).toEqual([])
  })

  it('does not let an in-flight teacher save clear a next-classroom pending edit', async () => {
    const writeUrls: string[] = []
    let resolveFirstSave: (() => void) | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (init?.method === 'PUT') {
          writeUrls.push(url)
          if (url.includes(classroom.id)) {
            return new Promise<Response>((resolve) => {
              resolveFirstSave = () => resolve(resourceResponse('Updated teacher resources'))
            })
          }

          return resourceResponse('Updated teacher resources')
        }

        if (url.includes(secondClassroom.id)) {
          return resourceResponse('Second teacher resources')
        }

        return resourceResponse('First teacher resources')
      }),
    )

    const view = render(<TeacherClassResourcesSidebar classroom={classroom} />)

    await screen.findByText('First teacher resources')
    fireEvent.click(screen.getByRole('button', { name: 'Change teacher resources' }))
    fireEvent.click(screen.getByRole('button', { name: 'Blur resources editor' }))

    await waitFor(() => {
      expect(writeUrls).toEqual([`/api/teacher/classrooms/${classroom.id}/resources`])
    })

    view.rerender(<TeacherClassResourcesSidebar classroom={secondClassroom} />)
    await screen.findByText('Second teacher resources')
    fireEvent.click(screen.getByRole('button', { name: 'Change teacher resources' }))

    await act(async () => {
      resolveFirstSave?.()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Blur resources editor' }))

    await waitFor(() => {
      expect(writeUrls).toEqual([
        `/api/teacher/classrooms/${classroom.id}/resources`,
        `/api/teacher/classrooms/${secondClassroom.id}/resources`,
      ])
    })
  })

  it('invalidates teacher and student resource caches after a teacher save', async () => {
    const readUrls: string[] = []
    const writeUrls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (init?.method === 'PUT') {
          writeUrls.push(url)
          return resourceResponse('Updated teacher resources')
        }

        readUrls.push(url)
        if (url.includes('/api/student/')) {
          return resourceResponse('Student resources')
        }

        return resourceResponse('Teacher resources')
      }),
    )

    const studentView = render(<StudentClassResourcesSidebar classroom={classroom} />)
    await screen.findByText('Student resources')
    studentView.unmount()

    const teacherView = render(<TeacherClassResourcesSidebar classroom={classroom} />)
    await screen.findByText('Teacher resources')

    fireEvent.click(screen.getByRole('button', { name: 'Change teacher resources' }))
    fireEvent.click(screen.getByRole('button', { name: 'Blur resources editor' }))

    await waitFor(() => {
      expect(writeUrls).toEqual([`/api/teacher/classrooms/${classroom.id}/resources`])
    })
    teacherView.unmount()

    render(<StudentClassResourcesSidebar classroom={classroom} />)
    await screen.findByText('Student resources')

    expect(readUrls.filter((url) => url.includes('/api/student/'))).toEqual([
      `/api/student/classrooms/${classroom.id}/resources`,
      `/api/student/classrooms/${classroom.id}/resources`,
    ])
  })
})
