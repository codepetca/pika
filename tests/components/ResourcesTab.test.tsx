import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render as renderTestingLibrary, screen, waitFor } from '@testing-library/react'
import { TeacherResourcesTab } from '@/app/classrooms/[classroomId]/TeacherResourcesTab'
import { StudentResourcesTab } from '@/app/classrooms/[classroomId]/StudentResourcesTab'
import { TeacherAnnouncementsTab } from '@/app/classrooms/[classroomId]/TeacherAnnouncementsTab'
import { StudentAnnouncementsTab } from '@/app/classrooms/[classroomId]/StudentAnnouncementsTab'
import { CourseGuidePanel } from '@/components/CourseGuidePanel'
import { invalidateCachedJSONMatching } from '@/lib/request-cache'
import { AppMessageProvider, TooltipProvider } from '@/ui'
import type { Classroom } from '@/types'
import type { ReactNode } from 'react'

const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('@/components/CourseGuideView', () => ({
  CourseGuideView: ({
    guide,
    editMode,
    activeEditor,
    onEditSection,
    overviewEditor,
    resourcesEditor,
  }: {
    guide: { classroom: { title: string } }
    editMode?: boolean
    activeEditor?: 'overview' | 'resources' | null
    onEditSection?: (section: 'overview' | 'resources') => void
    overviewEditor?: ReactNode
    resourcesEditor?: ReactNode
  }) => (
    <div data-testid="course-guide-view">
      Guide for {guide.classroom.title}
      {editMode ? (
        <>
          <button type="button" onClick={() => onEditSection?.('overview')}>Edit curriculum overview and expectations</button>
          <button type="button" onClick={() => onEditSection?.('resources')}>Edit resources</button>
        </>
      ) : null}
      {activeEditor === 'overview' ? overviewEditor : null}
      {activeEditor === 'resources' ? resourcesEditor : null}
    </div>
  ),
}))

vi.mock('@/components/editor', () => ({
  ContentField: ({ label, hint, children }: {
    label: string
    hint?: string
    children: ReactNode
  }) => <div><span>{label}</span>{children}{hint ? <span>{hint}</span> : null}</div>,
  MarkdownContentEditor: ({ markdown, onMarkdownChange, 'aria-label': ariaLabel }: {
    markdown: string
    onMarkdownChange: (value: string) => void
    'aria-label'?: string
  }) => (
    <textarea
      aria-label={ariaLabel}
      value={markdown}
      onChange={(event) => onMarkdownChange(event.target.value)}
    />
  ),
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
  join_policy: 'roster',
  feature_visibility: {
    attendance: true,
    classwork: true,
    tests: true,
    gradebook: true,
    calendar: true,
    syllabus: true,
    announcements: true,
    achievements: true,
  },
  blueprint_source_revision: 0,
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
  course_overview_markdown: 'Course overview',
  course_outline_markdown: 'Course outline',
} as Classroom

const guide = {
  classroom: {
    title: classroom.title,
  },
  visibility: classroom.actual_site_config,
  overviewMarkdown: classroom.course_overview_markdown,
  resourcesContent: null,
  assignments: [],
  tests: [],
  lessonPlans: [],
  announcements: [],
}

function fetchResult(value: unknown, ok = true) {
  return Promise.resolve({
    ok,
    json: () => Promise.resolve(value),
  } as Response)
}

function render(ui: ReactNode) {
  return renderTestingLibrary(
    <AppMessageProvider>
      <TooltipProvider>{ui}</TooltipProvider>
    </AppMessageProvider>,
  )
}

beforeEach(() => {
  mockPush.mockClear()
  invalidateCachedJSONMatching('public-course-guide:')
  invalidateCachedJSONMatching('classroom-course-guide:')
  vi.restoreAllMocks()
})

describe('Course Guide classroom tabs', () => {
  it.each([
    ['teacher', (value: Classroom) => <TeacherResourcesTab classroom={value} />],
    ['student', (value: Classroom) => <StudentResourcesTab classroom={value} />],
  ] as const)('loads the shared classroom guide for the %s view without an iframe', async (_role, renderTab) => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(fetchResult({ guide }))
    render(renderTab(classroom))

    expect(screen.getByText('Loading course guide')).toBeInTheDocument()
    expect(screen.queryByTitle(/preview/i)).toBeNull()
    expect(await screen.findByTestId('course-guide-view')).toHaveTextContent('Guide for Test Classroom')
    expect(screen.getByTestId('course-guide-view').closest('.overflow-y-auto')).not.toBeNull()
    expect(screen.queryByRole('heading', { name: 'Course Guide' })).toBeNull()
    if (_role === 'teacher') {
      const editGuide = screen.getByRole('button', { name: 'Edit guide' })
      expect(editGuide).toBeInTheDocument()
      fireEvent.click(editGuide)
      expect(screen.getByRole('button', { name: 'Guide options' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
      expect(mockPush).not.toHaveBeenCalled()
    } else {
      expect(screen.getByRole('link', { name: 'Open public guide' })).toHaveAttribute(
        'href',
        '/actual/test-classroom',
      )
    }
    expect(globalThis.fetch).toHaveBeenCalledWith('/api/classrooms/classroom-1/course-guide', undefined)
  })

  it('shows a retryable error and refetches the classroom guide', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(fetchResult({ error: 'Unavailable' }, false))
      .mockReturnValueOnce(fetchResult({ guide }))

    render(<TeacherResourcesTab classroom={classroom} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Course guide unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByTestId('course-guide-view')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['teacher', (value: Classroom) => <TeacherResourcesTab classroom={value} />],
    ['student', (value: Classroom) => <StudentResourcesTab classroom={value} />],
  ] as const)('keeps the in-Pika guide available privately for the %s view', async (_role, renderTab) => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(fetchResult({ guide }))
    render(renderTab({
      ...classroom,
      actual_site_published: false,
      actual_site_slug: null,
      course_overview_markdown: '',
    }))

    expect(await screen.findByTestId('course-guide-view')).toBeInTheDocument()
    expect(screen.queryByText(/coming soon|not published/i)).toBeNull()
    expect(screen.queryByRole('link', { name: 'Open public guide' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open public guide' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Course Guide' })).toBeNull()
    if (_role === 'teacher') {
      fireEvent.click(screen.getByRole('button', { name: 'Edit guide' }))
      expect(screen.getByRole('button', { name: 'Guide options' })).toBeInTheDocument()
      expect(mockPush).not.toHaveBeenCalled()
    }
  })

  it('edits and saves the curriculum overview within the guide pane', async () => {
    const onClassroomUpdated = vi.fn()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(fetchResult({ guide }))
      .mockReturnValueOnce(fetchResult({
        classroom: { ...classroom, course_overview_markdown: 'Updated overview' },
      }))

    render(<TeacherResourcesTab classroom={classroom} onClassroomUpdated={onClassroomUpdated} />)
    await screen.findByTestId('course-guide-view')
    fireEvent.click(screen.getByRole('button', { name: 'Edit guide' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit curriculum overview and expectations' }))
    fireEvent.change(screen.getByLabelText('Curriculum overview and expectations'), {
      target: { value: 'Updated overview' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save overview' }))

    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/teacher/classrooms/classroom-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ courseOverviewMarkdown: 'Updated overview' }),
      }),
    ))
    expect(onClassroomUpdated).toHaveBeenCalledWith(expect.objectContaining({
      course_overview_markdown: 'Updated overview',
    }))
  })

  it('owns visibility and public sharing in the accessible Guide options dialog', async () => {
    const updatedClassroom = {
      ...classroom,
      actual_site_config: { ...classroom.actual_site_config, assignments: false },
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(fetchResult({ guide }))
      .mockReturnValueOnce(fetchResult({ classroom: updatedClassroom }))

    render(<TeacherResourcesTab classroom={classroom} />)
    await screen.findByTestId('course-guide-view')
    fireEvent.click(screen.getByRole('button', { name: 'Edit guide' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guide options' }))

    expect(screen.getByRole('dialog', { name: 'Guide options' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import curriculum' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Share guide publicly' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Hide Assignments' }))
    expect(screen.getByRole('button', { name: 'Show Assignments' })).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Save options' }))

    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/teacher/classrooms/classroom-1',
      expect.objectContaining({ method: 'PATCH' }),
    ))
    const request = fetchMock.mock.calls.at(-1)?.[1] as RequestInit
    expect(JSON.parse(String(request.body))).toMatchObject({
      actualSitePublished: true,
      actualSiteSlug: 'test-classroom',
      actualSiteConfig: { assignments: false, outline: true },
    })
  })

  it('focuses, closes, and restores focus for Guide options with the keyboard', async () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(fetchResult({ guide }))
    render(<TeacherResourcesTab classroom={classroom} />)
    await screen.findByTestId('course-guide-view')
    fireEvent.click(screen.getByRole('button', { name: 'Edit guide' }))
    const optionsButton = screen.getByRole('button', { name: 'Guide options' })
    optionsButton.focus()
    fireEvent.click(optionsButton)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus())
    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Guide options' })).toBeNull())
    expect(optionsButton).toHaveFocus()
  })

  it('opens curriculum import from Guide options only when overview edits are saved', async () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(fetchResult({ guide }))
    render(<TeacherResourcesTab classroom={classroom} />)
    await screen.findByTestId('course-guide-view')
    fireEvent.click(screen.getByRole('button', { name: 'Edit guide' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guide options' }))
    fireEvent.click(screen.getByRole('button', { name: 'Import curriculum' }))

    expect(screen.getByRole('dialog', { name: 'Import curriculum' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    fireEvent.click(screen.getByRole('button', { name: 'Edit curriculum overview and expectations' }))
    fireEvent.change(screen.getByLabelText('Curriculum overview and expectations'), {
      target: { value: 'Unsaved overview' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Guide options' }))
    fireEvent.click(screen.getByRole('button', { name: 'Import curriculum' }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Save or cancel your overview edits before importing curriculum.',
    )
    expect(screen.queryByRole('dialog', { name: 'Import curriculum' })).toBeNull()
  })

  it('imports against raw teacher content when overview visibility is off', async () => {
    const hiddenGuide = {
      ...guide,
      visibility: { ...guide.visibility, overview: false },
      overviewMarkdown: '',
    }
    const importDraft = {
      sourceTitle: 'Ontario curriculum',
      sourceUrl: 'https://example.ca/curriculum.pdf',
      sourceFilename: null,
      sourceLabel: '[Ontario curriculum](https://example.ca/curriculum.pdf)',
      overviewMarkdown: 'Imported overview',
      expectationsMarkdown: '',
      sourceLinks: [],
      draftMarkdown: '## Curriculum overview\n\nImported overview',
      citationMarkdown: 'Source: [Ontario curriculum](https://example.ca/curriculum.pdf)',
    }
    const updatedClassroom = {
      ...classroom,
      course_overview_markdown: 'Course overview\n\n---\n\nImported overview',
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(fetchResult({ guide: hiddenGuide }))
      .mockReturnValueOnce(fetchResult({
        draft: importDraft,
        provenanceToken: 'p'.repeat(80),
      }))
      .mockReturnValueOnce(fetchResult({ classroom: updatedClassroom }))

    render(
      <CourseGuidePanel
        role="teacher"
        classroom={{
          ...classroom,
          actual_site_config: { ...classroom.actual_site_config, overview: false },
        }}
      />,
    )
    await screen.findByTestId('course-guide-view')
    fireEvent.click(screen.getByRole('button', { name: 'Edit guide' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guide options' }))
    fireEvent.click(screen.getByRole('button', { name: 'Import curriculum' }))
    fireEvent.click(screen.getByRole('button', { name: 'Public URL' }))
    fireEvent.change(screen.getByLabelText('Public document URL'), {
      target: { value: 'https://example.ca/curriculum.pdf' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create draft' }))
    await screen.findByLabelText('Imported curriculum draft')
    fireEvent.click(screen.getByRole('button', { name: 'Continue to confirmation' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add reviewed draft' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    const applyRequest = fetchMock.mock.calls[2]?.[1] as RequestInit
    expect(JSON.parse(String(applyRequest.body))).toMatchObject({
      expectedOverviewMarkdown: 'Course overview',
      provenanceToken: 'p'.repeat(80),
    })
  })

  it('keeps the overview editor open and announces a failed save', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(fetchResult({ guide }))
      .mockReturnValueOnce(fetchResult({ error: 'Could not save overview' }, false))

    render(<TeacherResourcesTab classroom={classroom} />)
    await screen.findByTestId('course-guide-view')
    fireEvent.click(screen.getByRole('button', { name: 'Edit guide' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit curriculum overview and expectations' }))
    fireEvent.change(screen.getByLabelText('Curriculum overview and expectations'), {
      target: { value: 'Unsaved overview' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save overview' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save overview')
    expect(screen.getByLabelText('Curriculum overview and expectations')).toHaveValue('Unsaved overview')
  })

  it('keeps archived classroom guides read-only', async () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(fetchResult({ guide }))
    render(<TeacherResourcesTab classroom={{ ...classroom, archived_at: '2026-08-27T00:00:00Z' }} />)

    await screen.findByTestId('course-guide-view')
    expect(screen.getByText('Archived classroom · Course Guide is read-only.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit guide' })).toBeNull()
  })

  it('keeps announcements in their dedicated teacher and student tabs', () => {
    const { rerender } = render(<TeacherAnnouncementsTab classroom={classroom} />)
    expect(screen.getByText('Teacher announcements content')).toBeInTheDocument()

    rerender(<StudentAnnouncementsTab classroom={classroom} />)
    expect(screen.getByText('Student announcements content')).toBeInTheDocument()
  })
})
