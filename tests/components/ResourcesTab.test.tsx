import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render as renderTestingLibrary, screen, waitFor, within } from '@testing-library/react'
import { TeacherResourcesTab } from '@/app/classrooms/[classroomId]/TeacherResourcesTab'
import { StudentResourcesTab } from '@/app/classrooms/[classroomId]/StudentResourcesTab'
import { TeacherAnnouncementsTab } from '@/app/classrooms/[classroomId]/TeacherAnnouncementsTab'
import { StudentAnnouncementsTab } from '@/app/classrooms/[classroomId]/StudentAnnouncementsTab'
import { CourseGuidePanel } from '@/components/CourseGuidePanel'
import { invalidateCachedJSONMatching } from '@/lib/request-cache'
import { AppMessageProvider, TooltipProvider } from '@/ui'
import type { Classroom } from '@/types'
import { Suspense, startTransition, useState, type ReactNode } from 'react'

const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

vi.mock('@/components/CourseGuideView', () => ({
  CourseGuideView: ({
    guide,
    editMode,
    overviewEditor,
  }: {
    guide: { classroom: { title: string } }
    editMode?: boolean
    overviewEditor?: ReactNode
  }) => (
    <div data-testid="course-guide-view">
      Guide for {guide.classroom.title}
      {editMode ? overviewEditor : null}
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
  visibility: {
    overview: true,
    resources: true,
    assignments: true,
    tests: true,
  },
  overviewMarkdown: classroom.course_overview_markdown,
  resourcesContent: null,
  assignments: [],
  tests: [],
}

function fetchResult(value: unknown, ok = true) {
  return Promise.resolve({
    ok,
    json: () => Promise.resolve(value),
  } as Response)
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => { resolve = res })
  return { promise, resolve }
}

function guideResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status })
}

function guideElement(value: Classroom, role: 'teacher' | 'student' = 'teacher') {
  return (
    <AppMessageProvider>
      <TooltipProvider><CourseGuidePanel classroom={value} role={role} /></TooltipProvider>
    </AppMessageProvider>
  )
}

function render(ui: ReactNode) {
  return renderTestingLibrary(
    <AppMessageProvider>
      <TooltipProvider>{ui}</TooltipProvider>
    </AppMessageProvider>,
  )
}

function selectCourseGuideAction(name: 'Edit' | 'Edit with Markdown' | 'Guide options') {
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
  fireEvent.click(screen.getByRole('menuitem', { name }))
}

beforeEach(() => {
  mockPush.mockClear()
  invalidateCachedJSONMatching('public-course-guide:')
  invalidateCachedJSONMatching('classroom-course-guide:')
  vi.restoreAllMocks()
  const computedStyle = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
    const style = computedStyle(element)
    style.setProperty('--motion-duration-standard', '200ms')
    return style
  })
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
      expect(screen.getByRole('button', { name: 'More actions' })).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
      expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Edit with Markdown' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Guide options' })).toBeInTheDocument()
      fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
      expect(screen.getByRole('textbox', { name: 'Course guide' })).toBeInTheDocument()
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
      selectCourseGuideAction('Edit')
      expect(screen.getByRole('textbox', { name: 'Course guide' })).toBeInTheDocument()
      expect(mockPush).not.toHaveBeenCalled()
    }
  })

  it('edits and saves the course guide directly within the page', async () => {
    const onClassroomUpdated = vi.fn()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(fetchResult({ guide }))
      .mockReturnValueOnce(fetchResult({
        classroom: { ...classroom, course_overview_markdown: 'Updated overview' },
      }))

    render(<TeacherResourcesTab classroom={classroom} onClassroomUpdated={onClassroomUpdated} />)
    await screen.findByTestId('course-guide-view')
    selectCourseGuideAction('Edit')
    fireEvent.change(screen.getByRole('textbox', { name: 'Course guide' }), {
      target: { value: 'Updated overview' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

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

  it('opens a paste-friendly Markdown source editor from More actions', async () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(fetchResult({ guide }))

    render(<TeacherResourcesTab classroom={classroom} />)
    await screen.findByTestId('course-guide-view')
    selectCourseGuideAction('Edit with Markdown')

    const markdownEditor = screen.getByRole('textbox', { name: 'Course guide Markdown' })
    expect(markdownEditor).toHaveValue(classroom.course_overview_markdown)
    fireEvent.change(markdownEditor, { target: { value: '# Pasted course guide' } })
    expect(markdownEditor).toHaveValue('# Pasted course guide')
  })

  it('retains the teacher Markdown editor through a same-classroom warm refresh and recoverable failure', async () => {
    const refresh = deferred<Response>()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(fetchResult({ guide }))
      .mockReturnValueOnce(refresh.promise)
    const element = (value: Classroom) => (
      <AppMessageProvider>
        <TooltipProvider><TeacherResourcesTab classroom={value} /></TooltipProvider>
      </AppMessageProvider>
    )
    const view = renderTestingLibrary(element(classroom))
    const originalGuide = await screen.findByTestId('course-guide-view')
    selectCourseGuideAction('Edit with Markdown')
    const editor = screen.getByRole('textbox', { name: 'Course guide Markdown' }) as HTMLTextAreaElement
    const draft = '# Unsaved course guide\n\nKeep this draft and caret.'
    fireEvent.change(editor, { target: { value: draft } })
    editor.focus()
    editor.setSelectionRange(12, 12)
    editor.scrollTop = 75
    editor.style.height = '450px'
    expect(editor).toHaveFocus()
    expect(editor.selectionStart).toBe(12)

    view.rerender(element({ ...classroom, updated_at: '2026-04-14T00:01:00.000Z' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock).toHaveBeenLastCalledWith('/api/classrooms/classroom-1/course-guide', undefined)

    const expectEditorRetained = () => {
      expect.soft(screen.queryByTestId('course-guide-view')).toBe(originalGuide)
      expect.soft(screen.queryByRole('textbox', { name: 'Course guide Markdown' })).toBe(editor)
      expect.soft(editor).toBeInTheDocument()
      expect.soft(editor).toHaveValue(draft)
      expect.soft(editor).toHaveFocus()
      expect.soft([editor.selectionStart, editor.selectionEnd]).toEqual([12, 12])
      expect.soft(editor.scrollTop).toBe(75)
      expect.soft(editor.style.height).toBe('450px')
    }
    // Soft assertions let the same deferred request prove both lifecycle phases.
    expectEditorRetained()
    expect.soft(screen.queryByText('Loading course guide')).toBeNull()

    await act(async () => {
      refresh.resolve(new Response(JSON.stringify({ error: 'Temporary guide failure' }), { status: 503 }))
    })
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expectEditorRetained()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retains the student guide through a same-classroom warm refresh and recoverable failure', async () => {
    const refresh = deferred<Response>()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(fetchResult({ guide }))
      .mockReturnValueOnce(refresh.promise)
    const element = (value: Classroom) => (
      <AppMessageProvider>
        <TooltipProvider><StudentResourcesTab classroom={value} /></TooltipProvider>
      </AppMessageProvider>
    )
    const view = renderTestingLibrary(element(classroom))
    const originalGuide = await screen.findByTestId('course-guide-view')

    view.rerender(element({ ...classroom, updated_at: '2026-04-14T00:01:00.000Z' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock).toHaveBeenLastCalledWith('/api/classrooms/classroom-1/course-guide', undefined)
    expect.soft(screen.queryByTestId('course-guide-view')).toBe(originalGuide)
    expect.soft(originalGuide).toBeInTheDocument()
    expect.soft(screen.queryByText('Loading course guide')).toBeNull()

    await act(async () => {
      refresh.resolve(new Response(JSON.stringify({ error: 'Temporary guide failure' }), { status: 503 }))
    })
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect.soft(screen.queryByTestId('course-guide-view')).toBe(originalGuide)
    expect.soft(originalGuide).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each(['success', 'failure'] as const)('keeps the latest warm %s authoritative over an older read', async (outcome) => {
    const older = deferred<Response>()
    const latest = deferred<Response>()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(fetchResult({ guide }))
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(latest.promise)
    const view = renderTestingLibrary(guideElement(classroom))
    const originalGuide = await screen.findByTestId('course-guide-view')
    selectCourseGuideAction('Edit with Markdown')
    const editor = screen.getByRole('textbox', { name: 'Course guide Markdown' }) as HTMLTextAreaElement
    fireEvent.change(editor, { target: { value: 'Unsaved latest-owner draft' } })
    editor.focus()
    editor.setSelectionRange(7, 7)
    editor.scrollTop = 60
    editor.style.height = '430px'
    view.rerender(guideElement({ ...classroom, updated_at: '2026-04-14T00:01:00.000Z' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    view.rerender(guideElement({ ...classroom, updated_at: '2026-04-14T00:02:00.000Z' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(screen.getByTestId('course-guide-view')).toBe(originalGuide)

    await act(async () => {
      latest.resolve(outcome === 'success'
        ? guideResponse({ guide: { ...guide, classroom: { title: 'Latest accepted guide' } } })
        : guideResponse({ error: 'Temporary latest failure' }, 503))
    })
    expect(screen.getByTestId('course-guide-view')).toBe(originalGuide)
    expect(originalGuide).toHaveTextContent(outcome === 'success' ? 'Latest accepted guide' : 'Test Classroom')
    if (outcome === 'failure') expect(screen.getByRole('alert')).toHaveTextContent('last loaded course guide')
    await act(async () => {
      // A late denial must not clear newer accepted data; a late success must
      // not erase the newest failure or replace the accepted snapshot either.
      older.resolve(outcome === 'success'
        ? guideResponse({ error: 'Obsolete denial' }, 403)
        : guideResponse({ guide: { ...guide, classroom: { title: 'Obsolete guide' } } }))
    })
    expect(screen.getByTestId('course-guide-view')).toBe(originalGuide)
    expect(originalGuide).not.toHaveTextContent('Obsolete guide')
    expect(screen.getByRole('textbox', { name: 'Course guide Markdown' })).toBe(editor)
    expect(editor).toHaveValue('Unsaved latest-owner draft')
    expect(editor).toHaveFocus()
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([7, 7])
    expect(editor.scrollTop).toBe(60)
    expect(editor.style.height).toBe('430px')
    if (outcome === 'success') expect(screen.queryByRole('alert')).toBeNull()
    else expect(screen.getByRole('alert')).toHaveTextContent('last loaded course guide')
  })

  it.each([401, 403, 404])('clears a current %s snapshot, editor and dialog instead of retaining denied data', async (status) => {
    const refresh = deferred<Response>()
    const retry = deferred<Response>()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(fetchResult({ guide }))
      .mockReturnValueOnce(refresh.promise)
      .mockReturnValueOnce(retry.promise)
    const view = renderTestingLibrary(guideElement(classroom))
    await screen.findByTestId('course-guide-view')
    selectCourseGuideAction('Edit with Markdown')
    fireEvent.change(screen.getByRole('textbox', { name: 'Course guide Markdown' }), { target: { value: 'Denied draft' } })
    selectCourseGuideAction('Guide options')
    fireEvent.change(screen.getByLabelText('Public page address'), { target: { value: 'denied-options' } })
    view.rerender(guideElement({ ...classroom, updated_at: '2026-04-14T00:01:00.000Z' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const retiringOptions = screen.getByRole('dialog', { name: 'Guide options' })
    await act(async () => { refresh.resolve(guideResponse({ error: 'Access revoked' }, status)) })
    expect(screen.queryByTestId('course-guide-view')).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Course guide Markdown' })).toBeNull()
    expect(screen.queryByRole('dialog', { name: 'Guide options' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull()
    expect(retiringOptions).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Course guide unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(screen.getByText('Loading course guide')).toBeInTheDocument()
    expect(screen.queryByTestId('course-guide-view')).toBeNull()
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull()
    await act(async () => { retry.resolve(guideResponse({ guide })) })
    await screen.findByTestId('course-guide-view')
    selectCourseGuideAction('Edit with Markdown')
    expect(screen.getByRole('textbox', { name: 'Course guide Markdown' })).toHaveValue(classroom.course_overview_markdown)
    selectCourseGuideAction('Guide options')
    expect(screen.getByLabelText('Public page address')).toHaveValue('test-classroom')
  })

  it.each(['classroom', 'role'] as const)('cold-loads a changed %s and ignores the previous owner read', async (boundary) => {
    const oldRead = deferred<Response>()
    const nextRead = deferred<Response>()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(fetchResult({ guide }))
      .mockReturnValueOnce(oldRead.promise)
      .mockReturnValueOnce(nextRead.promise)
    const view = renderTestingLibrary(guideElement(classroom))
    await screen.findByTestId('course-guide-view')
    selectCourseGuideAction('Edit with Markdown')
    fireEvent.change(screen.getByRole('textbox', { name: 'Course guide Markdown' }), { target: { value: 'Previous owner draft' } })
    selectCourseGuideAction('Guide options')
    view.rerender(guideElement({ ...classroom, updated_at: '2026-04-14T00:01:00.000Z' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const retiringOptions = screen.getByRole('dialog', { name: 'Guide options' })
    const nextClassroom = boundary === 'classroom' ? { ...classroom, id: 'classroom-2', title: 'Next classroom' } : classroom
    const nextRole = boundary === 'role' ? 'student' : 'teacher'
    view.rerender(guideElement(nextClassroom, nextRole))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(screen.getByText('Loading course guide')).toBeInTheDocument()
    expect(screen.queryByTestId('course-guide-view')).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Course guide Markdown' })).toBeNull()
    expect(screen.queryByRole('dialog', { name: 'Guide options' })).toBeNull()
    expect(retiringOptions).not.toBeInTheDocument()
    await act(async () => { nextRead.resolve(guideResponse({ guide: { ...guide, classroom: { title: 'Current owner guide' } } })) })
    const currentGuide = await screen.findByTestId('course-guide-view')
    await act(async () => { oldRead.resolve(guideResponse({ error: 'Previous owner denial' }, 403)) })
    expect(screen.getByTestId('course-guide-view')).toBe(currentGuide)
    expect(currentGuide).toHaveTextContent('Current owner guide')
    expect(screen.queryByRole('alert')).toBeNull()
    if (nextRole === 'student') expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull()
    else {
      selectCourseGuideAction('Edit with Markdown')
      expect(screen.getByRole('textbox', { name: 'Course guide Markdown' })).toHaveValue(nextClassroom.course_overview_markdown)
    }
  })

  it('keeps a current denial blocking after an older successful read arrives', async () => {
    const older = deferred<Response>()
    const denied = deferred<Response>()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(fetchResult({ guide }))
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(denied.promise)
    const view = renderTestingLibrary(guideElement(classroom))
    await screen.findByTestId('course-guide-view')
    selectCourseGuideAction('Edit with Markdown')
    view.rerender(guideElement({ ...classroom, updated_at: '2026-04-14T00:01:00.000Z' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    view.rerender(guideElement({ ...classroom, updated_at: '2026-04-14T00:02:00.000Z' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    await act(async () => { denied.resolve(guideResponse({ error: 'Current denial' }, 403)) })
    const blockingState = screen.getByRole('alert')
    await act(async () => { older.resolve(guideResponse({ guide: { ...guide, classroom: { title: 'Obsolete allowed guide' } } })) })
    expect(screen.getByRole('alert')).toBe(blockingState)
    expect(screen.queryByTestId('course-guide-view')).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Course guide Markdown' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull()
  })

  it.each(['overview', 'options'] as const)('ignores a late %s save after a committed role change and return', async (writeKind) => {
    const write = deferred<Response>()
    const onClassroomUpdated = vi.fn()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(fetchResult({ guide }))
      .mockReturnValueOnce(write.promise)
      .mockReturnValue(fetchResult({ guide }))
    const element = (role: 'teacher' | 'student') => (
      <AppMessageProvider>
        <TooltipProvider><CourseGuidePanel classroom={classroom} role={role} onClassroomUpdated={onClassroomUpdated} /></TooltipProvider>
      </AppMessageProvider>
    )
    const view = renderTestingLibrary(element('teacher'))
    await screen.findByTestId('course-guide-view')
    if (writeKind === 'overview') {
      selectCourseGuideAction('Edit with Markdown')
      fireEvent.change(screen.getByRole('textbox', { name: 'Course guide Markdown' }), { target: { value: 'Previous role save' } })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    } else {
      selectCourseGuideAction('Guide options')
      fireEvent.change(screen.getByLabelText('Public page address'), { target: { value: 'previous-role-slug' } })
      fireEvent.click(screen.getByRole('button', { name: 'Save options' }))
    }
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    view.rerender(element('student'))
    await screen.findByTestId('course-guide-view')
    view.rerender(element('teacher'))
    const currentGuide = await screen.findByTestId('course-guide-view')
    expect(fetchMock).toHaveBeenCalledTimes(4)
    await act(async () => { write.resolve(guideResponse({ classroom: { ...classroom, course_overview_markdown: 'Previous role save', actual_site_slug: 'previous-role-slug' } })) })
    expect(onClassroomUpdated).not.toHaveBeenCalled()
    expect(screen.getByTestId('course-guide-view')).toBe(currentGuide)
    expect(screen.queryByRole('dialog', { name: 'Guide options' })).toBeNull()
    selectCourseGuideAction('Edit with Markdown')
    expect(screen.getByRole('textbox', { name: 'Course guide Markdown' })).toHaveValue(classroom.course_overview_markdown)
    selectCourseGuideAction('Guide options')
    expect(screen.getByLabelText('Public page address')).toHaveValue('test-classroom')
  })

  it('does not revive denied work when its explicit retry fails recoverably', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(fetchResult({ guide }))
      .mockResolvedValueOnce(guideResponse({ error: 'Denied' }, 403))
      .mockResolvedValueOnce(guideResponse({ error: 'Retry unavailable' }, 503))
    const view = renderTestingLibrary(guideElement(classroom))
    await screen.findByTestId('course-guide-view')
    view.rerender(guideElement({ ...classroom, updated_at: '2026-04-14T00:01:00.000Z' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Course guide unavailable')
    expect(screen.queryByTestId('course-guide-view')).toBeNull()
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull()
  })

  it('retires a pending overview write when its panel unmounts', async () => {
    const write = deferred<Response>()
    const onClassroomUpdated = vi.fn()
    vi.spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(fetchResult({ guide }))
      .mockReturnValueOnce(write.promise)
    const view = render(<CourseGuidePanel classroom={classroom} role="teacher" onClassroomUpdated={onClassroomUpdated} />)
    await screen.findByTestId('course-guide-view')
    selectCourseGuideAction('Edit with Markdown')
    fireEvent.change(screen.getByRole('textbox', { name: 'Course guide Markdown' }), { target: { value: 'Unmounted save' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    view.unmount()
    await act(async () => { write.resolve(guideResponse({ classroom: { ...classroom, course_overview_markdown: 'Unmounted save' } })) })
    expect(onClassroomUpdated).not.toHaveBeenCalled()
  })

  it.each([true, false])('retries once and hands off focus only when Retry owns focus (%s)', async (retryFocused) => {
    const refresh = deferred<Response>()
    const retryRead = deferred<Response>()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(fetchResult({ guide }))
      .mockReturnValueOnce(refresh.promise)
      .mockReturnValueOnce(retryRead.promise)
    const view = renderTestingLibrary(guideElement(classroom))
    await screen.findByTestId('course-guide-view')
    selectCourseGuideAction('Edit with Markdown')
    const editor = screen.getByRole('textbox', { name: 'Course guide Markdown' })
    fireEvent.change(editor, { target: { value: 'Retry preserves this draft' } })
    view.rerender(guideElement({ ...classroom, updated_at: '2026-04-14T00:01:00.000Z' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await act(async () => { refresh.resolve(guideResponse({ error: 'Temporary failure' }, 503)) })
    const retryButton = screen.getByRole('button', { name: 'Retry' })
    const region = screen.getByRole('region', { name: 'Course guide workspace' })
    const focusSpy = vi.spyOn(region, 'focus')
    if (retryFocused) retryButton.focus()
    else editor.focus()
    act(() => {
      fireEvent.click(retryButton)
      fireEvent.click(retryButton)
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    if (retryFocused) {
      expect(region).toHaveFocus()
      expect(focusSpy).toHaveBeenCalledOnce()
      expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true })
    } else {
      expect(editor).toHaveFocus()
      expect(focusSpy).not.toHaveBeenCalled()
    }
    editor.focus()
    await act(async () => { retryRead.resolve(guideResponse({ guide })) })
    expect(screen.getByRole('textbox', { name: 'Course guide Markdown' })).toBe(editor)
    expect(editor).toHaveFocus()
    expect(editor).toHaveValue('Retry preserves this draft')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('keeps committed read and write authority when a different-owner render is suspended and abandoned', async () => {
    const write = deferred<Response>()
    const refresh = deferred<Response>()
    const onClassroomUpdated = vi.fn()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(fetchResult({ guide }))
      .mockReturnValueOnce(write.promise)
      .mockReturnValueOnce(refresh.promise)
    const suspended = new Promise<void>(() => {})
    let selectClassroom!: (value: Classroom) => void
    function SuspendAfterPanel({ value }: { value: Classroom }) {
      if (value.id !== classroom.id) throw suspended
      return null
    }
    function Harness() {
      const [value, setValue] = useState(classroom)
      selectClassroom = setValue
      return (
        <>
          <CourseGuidePanel classroom={value} role="teacher" onClassroomUpdated={onClassroomUpdated} />
          <SuspendAfterPanel value={value} />
        </>
      )
    }
    render(<Suspense fallback={<div>Suspended owner fallback</div>}><Harness /></Suspense>)
    await screen.findByTestId('course-guide-view')
    selectCourseGuideAction('Edit with Markdown')
    fireEvent.change(screen.getByRole('textbox', { name: 'Course guide Markdown' }), { target: { value: 'Committed owner save' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const committedClassroom = { ...classroom, updated_at: '2026-04-14T00:01:00.000Z' }
    await act(async () => { selectClassroom(committedClassroom) })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    await act(async () => { startTransition(() => selectClassroom({ ...classroom, id: 'suspended-owner' })) })
    expect(screen.queryByText('Suspended owner fallback')).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Course guide Markdown' })).toHaveValue('Committed owner save')
    await act(async () => { refresh.resolve(guideResponse({ guide: { ...guide, classroom: { title: 'Committed fresh guide' } } })) })
    expect(screen.getByTestId('course-guide-view')).toHaveTextContent('Committed fresh guide')
    const savedClassroom = { ...classroom, course_overview_markdown: 'Committed owner save' }
    await act(async () => { write.resolve(guideResponse({ classroom: savedClassroom })) })
    expect(onClassroomUpdated).toHaveBeenCalledOnce()
    expect(onClassroomUpdated).toHaveBeenCalledWith(savedClassroom)
    expect(screen.queryByRole('textbox', { name: 'Course guide Markdown' })).toBeNull()
    await act(async () => { selectClassroom(committedClassroom) })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('retains a passive options draft on cancel and reopens the saved parent draft immediately', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockReturnValue(fetchResult({ guide }))
    render(<TeacherResourcesTab classroom={classroom} />)
    await screen.findByTestId('course-guide-view')
    selectCourseGuideAction('Guide options')
    const panel = screen.getByRole('dialog', { name: 'Guide options' })
    const slug = within(panel).getByLabelText('Public page address')
    const save = within(panel).getByRole('button', { name: 'Save options' })
    const importButton = within(panel).getByRole('button', { name: 'Import curriculum' })
    fireEvent.change(slug, { target: { value: 'outgoing-draft' } })
    vi.useFakeTimers()
    fireEvent.click(within(panel).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(panel).toBeInTheDocument()
    expect(slug).toHaveValue('outgoing-draft')
    expect(panel.parentElement).toHaveAttribute('aria-hidden', 'true')
    expect(panel.parentElement!.inert).toBe(true)
    fireEvent.click(save)
    fireEvent.click(importButton)
    fireEvent.change(slug, { target: { value: 'blocked-draft' } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    try {
      selectCourseGuideAction('Guide options')
      expect(screen.getByLabelText('Public page address')).toHaveValue('test-classroom')
      act(() => vi.advanceTimersByTime(200))
      expect(screen.getByRole('dialog', { name: 'Guide options' })).toBeInTheDocument()
    } finally { vi.useRealTimers() }
  })

  it('skips options retention for reduced motion and keeps busy dismissal guarded', async () => {
    const write = deferred<Response>()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(fetchResult({ guide })).mockReturnValueOnce(write.promise)
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      media: query, matches: query === '(prefers-reduced-motion: reduce)',
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }) as unknown as MediaQueryList)
    render(<TeacherResourcesTab classroom={classroom} />)
    await screen.findByTestId('course-guide-view')
    selectCourseGuideAction('Guide options')
    const first = screen.getByRole('dialog', { name: 'Guide options' })
    fireEvent.click(within(first).getByRole('button', { name: 'Cancel' }))
    expect(first).not.toBeInTheDocument()
    selectCourseGuideAction('Guide options')
    fireEvent.click(screen.getByRole('button', { name: 'Save options' }))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true }))
    expect(screen.getByRole('dialog', { name: 'Guide options' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await act(async () => { write.resolve(guideResponse({ error: 'Save failed' }, 500)) })
    expect(await screen.findByRole('alert')).toHaveTextContent('Save failed')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    selectCourseGuideAction('Guide options')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByLabelText('Public page address')).toHaveValue('test-classroom')
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
    selectCourseGuideAction('Guide options')

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
    const moreButton = screen.getByRole('button', { name: 'More actions' })
    moreButton.focus()
    selectCourseGuideAction('Guide options')

    await waitFor(() => expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus())
    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Guide options' })).toBeNull())
    expect(moreButton).toHaveFocus()
  })

  it('opens curriculum import from Guide options only when overview edits are saved', async () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(fetchResult({ guide }))
    render(<TeacherResourcesTab classroom={classroom} />)
    await screen.findByTestId('course-guide-view')
    selectCourseGuideAction('Guide options')
    const outgoingOptions = screen.getByRole('dialog', { name: 'Guide options' })
    fireEvent.click(screen.getByRole('button', { name: 'Import curriculum' }))

    const activeImport = screen.getByRole('dialog', { name: 'Import curriculum' })
    expect(outgoingOptions).toBeInTheDocument()
    expect(outgoingOptions.parentElement!.inert).toBe(true)
    expect(activeImport).toContainElement(document.activeElement as HTMLElement)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(activeImport).not.toBeInTheDocument()
    expect(outgoingOptions).not.toContainElement(document.activeElement as HTMLElement)
    expect(screen.getByRole('button', { name: 'More actions' })).toHaveFocus()

    selectCourseGuideAction('Edit')
    fireEvent.change(screen.getByRole('textbox', { name: 'Course guide' }), {
      target: { value: 'Unsaved overview' },
    })
    selectCourseGuideAction('Guide options')
    fireEvent.click(screen.getByRole('button', { name: 'Import curriculum' }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Save or cancel your course guide edits before importing curriculum.',
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
      citationMarkdown: 'Source: Ontario curriculum — https://example.ca/curriculum.pdf',
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
    selectCourseGuideAction('Guide options')
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
    selectCourseGuideAction('Edit')
    fireEvent.change(screen.getByRole('textbox', { name: 'Course guide' }), {
      target: { value: 'Unsaved overview' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save overview')
    expect(screen.getByRole('textbox', { name: 'Course guide' })).toHaveValue('Unsaved overview')
  })

  it('keeps archived classroom guides read-only', async () => {
    vi.spyOn(globalThis, 'fetch').mockReturnValue(fetchResult({ guide }))
    render(<TeacherResourcesTab classroom={{ ...classroom, archived_at: '2026-08-27T00:00:00Z' }} />)

    await screen.findByTestId('course-guide-view')
    expect(screen.getByText('Archived classroom · Course Guide is read-only.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull()
  })

  it('keeps announcements in their dedicated teacher and student tabs', () => {
    const { rerender } = render(<TeacherAnnouncementsTab classroom={classroom} />)
    expect(screen.getByText('Teacher announcements content')).toBeInTheDocument()

    rerender(<StudentAnnouncementsTab classroom={classroom} />)
    expect(screen.getByText('Student announcements content')).toBeInTheDocument()
  })
})
