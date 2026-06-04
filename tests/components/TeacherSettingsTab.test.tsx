import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act, within } from '@testing-library/react'
import { TeacherSettingsTab } from '@/app/classrooms/[classroomId]/TeacherSettingsTab'
import { AppMessageProvider, TooltipProvider } from '@/ui'
import { MarkdownPreferenceProvider } from '@/contexts/MarkdownPreferenceContext'
import type { Classroom } from '@/types'
import type { ReactNode } from 'react'

// Mock next/navigation
const mockRefresh = vi.fn()
const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
  useSearchParams: () => ({
    get: () => null, // defaults to 'general' section
  }),
}))

const mockClassroom: Classroom = {
  id: 'cls-123',
  teacher_id: 't1',
  title: 'Test Course',
  class_code: 'ABC123',
  term_label: null,
  allow_enrollment: true,
  join_policy: 'roster',
  start_date: '2026-01-01',
  end_date: '2026-06-01',
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
    quizzes: false,
    tests: true,
    lesson_plans: true,
    announcements: true,
    lesson_plan_scope: 'current_week',
  },
  course_overview_markdown: '',
  course_outline_markdown: '',
  archived_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const secondClassroom: Classroom = {
  ...mockClassroom,
  id: 'cls-456',
  title: 'Chemistry 12',
  class_code: 'CHEM12',
  allow_enrollment: false,
  join_policy: 'open_join',
  lesson_plan_visibility: 'all',
  actual_site_slug: 'chemistry-12',
  actual_site_published: true,
  actual_site_config: {
    overview: false,
    outline: true,
    resources: true,
    assignments: false,
    quizzes: false,
    tests: true,
    lesson_plans: false,
    announcements: false,
    lesson_plan_scope: 'one_week_ahead',
  },
  course_overview_markdown: 'Chemistry overview',
  course_outline_markdown: 'Chemistry outline',
}

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <MarkdownPreferenceProvider>
      <AppMessageProvider>
        <TooltipProvider>{children}</TooltipProvider>
      </AppMessageProvider>
    </MarkdownPreferenceProvider>
  )
}

describe('TeacherSettingsTab - Classroom name Editing', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    mockRefresh.mockClear()
    mockPush.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    window.localStorage.clear()
    cleanup()
  })

  it('renders with classroom name prefilled', () => {
    render(<TeacherSettingsTab classroom={mockClassroom} />, { wrapper: Wrapper })

    const input = screen.getByLabelText('Classroom name')
    expect(input).toHaveValue('Test Course')
    expect(screen.queryByLabelText('Quizzes')).toBeNull()
  })

  it('resets classroom-derived form state when switching classrooms', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    const firstClassroom = {
      ...mockClassroom,
      actual_site_slug: 'test-course',
      actual_site_published: true,
    }
    const { rerender } = render(<TeacherSettingsTab classroom={firstClassroom} />, { wrapper: Wrapper })

    fireEvent.change(screen.getByLabelText('Classroom name'), { target: { value: 'Unsaved Course A' } })
    fireEvent.change(screen.getByLabelText('Syllabus slug'), { target: { value: 'course-a-draft' } })

    rerender(<TeacherSettingsTab classroom={secondClassroom} />)

    expect(screen.getByRole('link', { name: '/actual/chemistry-12' })).toHaveAttribute(
      'href',
      '/actual/chemistry-12',
    )
    expect(screen.queryByRole('link', { name: '/actual/test-course' })).not.toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByLabelText('Classroom name')).toHaveValue('Chemistry 12')
    })
    expect(screen.getByRole('button', { name: 'Copy join code' })).toHaveTextContent('CHEM12')
    expect(screen.getByRole('switch', { name: 'Allow new students to join' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByLabelText('Calendar visibility')).toHaveValue('all')
    expect(screen.getByLabelText('Syllabus slug')).toHaveValue('chemistry-12')
    expect(screen.getByRole('switch', { name: 'Publish this classroom syllabus' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByLabelText('Lesson plan visibility on syllabus')).toHaveValue('one_week_ahead')
    expect(screen.getByLabelText('Course overview')).toHaveValue('Chemistry overview')
    expect(screen.getByLabelText('Course outline')).toHaveValue('Chemistry outline')

    fireEvent.blur(screen.getByLabelText('Classroom name'))

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ignores an in-flight classroom name save after switching away and back', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    let resolveSave!: (value: unknown) => void
    fetchMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSave = resolve
      }),
    )

    const { rerender } = render(<TeacherSettingsTab classroom={mockClassroom} />, { wrapper: Wrapper })

    fireEvent.change(screen.getByLabelText('Classroom name'), { target: { value: 'Saved Course A' } })
    fireEvent.blur(screen.getByLabelText('Classroom name'))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    rerender(<TeacherSettingsTab classroom={secondClassroom} />)

    await waitFor(() => {
      expect(screen.getByLabelText('Classroom name')).toHaveValue('Chemistry 12')
    })

    rerender(<TeacherSettingsTab classroom={mockClassroom} />)

    await waitFor(() => {
      expect(screen.getByLabelText('Classroom name')).toHaveValue('Test Course')
    })

    await act(async () => {
      resolveSave({
        ok: true,
        json: async () => ({ classroom: { ...mockClassroom, title: 'Saved Course A' } }),
      })
    })

    expect(screen.getByLabelText('Classroom name')).toHaveValue('Test Course')
    expect(screen.queryByText('Classroom name updated')).not.toBeInTheDocument()
  })

  it('hides syllabus markdown fields when the user preference is off', async () => {
    window.localStorage.setItem('pika_show_markdown', 'false')

    render(<TeacherSettingsTab classroom={mockClassroom} />, { wrapper: Wrapper })

    await waitFor(() => {
      expect(screen.queryByLabelText('Course overview')).not.toBeInTheDocument()
    })
    expect(screen.queryByLabelText('Course outline')).not.toBeInTheDocument()
    expect(screen.getByText('Course overview and outline editing is hidden by your display setting.')).toBeInTheDocument()
  })

  it('persists the show markdown display setting from the general settings tab', async () => {
    render(<TeacherSettingsTab classroom={mockClassroom} />, { wrapper: Wrapper })

    const markdownToggle = await screen.findByRole('switch', { name: 'Show markdown' })
    expect(markdownToggle).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(markdownToggle)

    await waitFor(() => {
      expect(markdownToggle).toHaveAttribute('aria-checked', 'false')
    })
    expect(window.localStorage.getItem('pika_show_markdown')).toBe('false')
    expect(screen.queryByLabelText('Course overview')).not.toBeInTheDocument()
    expect(screen.getByText('Course overview and outline editing is hidden by your display setting.')).toBeInTheDocument()
  })

  it('exposes the syllabus lesson-plan visibility select with an accessible label', () => {
    render(<TeacherSettingsTab classroom={mockClassroom} />, { wrapper: Wrapper })

    expect(screen.getByLabelText('Lesson plan visibility on syllabus')).toHaveValue('current_week')
  })

  it('uses the shared section switcher for general and class-days settings', () => {
    const onSectionChange = vi.fn()
    render(
      <TeacherSettingsTab
        classroom={mockClassroom}
        sectionParam="general"
        onSectionChange={onSectionChange}
      />,
      { wrapper: Wrapper }
    )

    const sectionSwitcher = screen.getByRole('group', { name: 'Settings section' })
    expect(within(sectionSwitcher).getByRole('button', { name: 'General' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(within(sectionSwitcher).getByRole('button', { name: 'Class Days' }))

    expect(onSectionChange).toHaveBeenCalledWith('class-days')
  })

  it('saves on blur when value has changed', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ classroom: { ...mockClassroom, title: 'Updated Course' } }),
    })

    render(<TeacherSettingsTab classroom={mockClassroom} />, { wrapper: Wrapper })

    const input = screen.getByLabelText('Classroom name')
    fireEvent.change(input, { target: { value: 'Updated Course' } })
    fireEvent.blur(input)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/teacher/classrooms/cls-123')
    expect(options.method).toBe('PATCH')
    expect(JSON.parse(options.body)).toEqual({ title: 'Updated Course' })
  })

  it('saves on Enter key press', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ classroom: { ...mockClassroom, title: 'Enter Saved' } }),
    })

    render(<TeacherSettingsTab classroom={mockClassroom} />, { wrapper: Wrapper })

    const input = screen.getByLabelText('Classroom name')
    fireEvent.change(input, { target: { value: 'Enter Saved' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ title: 'Enter Saved' })
  })

  it('shows error when classroom name is empty', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>

    render(<TeacherSettingsTab classroom={mockClassroom} />, { wrapper: Wrapper })

    const input = screen.getByLabelText('Classroom name')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)

    expect(screen.getByText('Classroom name cannot be empty')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not save if value is unchanged', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>

    render(<TeacherSettingsTab classroom={mockClassroom} />, { wrapper: Wrapper })

    const input = screen.getByLabelText('Classroom name')
    // Change to same value
    fireEvent.change(input, { target: { value: 'Test Course' } })
    fireEvent.blur(input)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows success message after save', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ classroom: { ...mockClassroom, title: 'New Name' } }),
    })

    render(<TeacherSettingsTab classroom={mockClassroom} />, { wrapper: Wrapper })

    const input = screen.getByLabelText('Classroom name')
    fireEvent.change(input, { target: { value: 'New Name' } })
    fireEvent.blur(input)

    await waitFor(() => {
      expect(screen.getByText('Classroom name updated')).toBeInTheDocument()
    })
  })

  it('does not call router.refresh() after successful save (#304)', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ classroom: { ...mockClassroom, title: 'Refreshed' } }),
    })

    render(<TeacherSettingsTab classroom={mockClassroom} />, { wrapper: Wrapper })

    const input = screen.getByLabelText('Classroom name')
    fireEvent.change(input, { target: { value: 'Refreshed' } })
    fireEvent.blur(input)

    await waitFor(() => {
      expect(screen.getByText('Classroom name updated')).toBeInTheDocument()
    })
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('shows error message on API failure', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Server error' }),
    })

    render(<TeacherSettingsTab classroom={mockClassroom} />, { wrapper: Wrapper })

    const input = screen.getByLabelText('Classroom name')
    fireEvent.change(input, { target: { value: 'Will Fail' } })
    fireEvent.blur(input)

    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeInTheDocument()
    })

    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('disables input when classroom is archived', () => {
    const archivedClassroom = { ...mockClassroom, archived_at: '2026-01-15T00:00:00Z' }

    render(<TeacherSettingsTab classroom={archivedClassroom} />, { wrapper: Wrapper })

    const input = screen.getByLabelText('Classroom name')
    expect(input).toBeDisabled()
  })

  it('shows saving indicator while request is in progress', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    let resolvePromise: (value: unknown) => void
    const promise = new Promise((resolve) => {
      resolvePromise = resolve
    })
    fetchMock.mockReturnValueOnce(promise)

    render(<TeacherSettingsTab classroom={mockClassroom} />, { wrapper: Wrapper })

    const input = screen.getByLabelText('Classroom name')
    fireEvent.change(input, { target: { value: 'New Title' } })
    fireEvent.blur(input)

    // Should show saving indicator
    await waitFor(() => {
      expect(screen.getByText('Saving...')).toBeInTheDocument()
    })
    expect(input).toBeDisabled()

    // Resolve the promise
    await act(async () => {
      resolvePromise!({
        ok: true,
        json: async () => ({ classroom: { ...mockClassroom, title: 'New Title' } }),
      })
    })

    await waitFor(() => {
      expect(screen.queryByText('Saving...')).not.toBeInTheDocument()
    })
  })

  it('trims whitespace from classroom name before saving', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ classroom: { ...mockClassroom, title: 'Trimmed' } }),
    })

    render(<TeacherSettingsTab classroom={mockClassroom} />, { wrapper: Wrapper })

    const input = screen.getByLabelText('Classroom name')
    fireEvent.change(input, { target: { value: '  Trimmed  ' } })
    fireEvent.blur(input)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ title: 'Trimmed' })
  })
})

describe('TeacherSettingsTab - Allow Joining', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    cleanup()
  })

  it('toggles allow joining and shows success message', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ classroom: { ...mockClassroom, allow_enrollment: false } }),
    })

    render(<TeacherSettingsTab classroom={mockClassroom} />, { wrapper: Wrapper })

    const toggle = screen.getByRole('switch', { name: 'Allow new students to join' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(toggle)

    await waitFor(() => {
      expect(screen.getByText('Settings saved')).toBeInTheDocument()
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/teacher/classrooms/cls-123')
    expect(JSON.parse(options.body)).toEqual({ allowEnrollment: false })
  })

  it('opens a title-only confirmation before generating a new join code', () => {
    render(<TeacherSettingsTab classroom={mockClassroom} />, { wrapper: Wrapper })

    fireEvent.click(screen.getByRole('button', { name: 'Generate new join code and link' }))

    expect(screen.getByRole('dialog', { name: 'Generate new join code and link?' })).toBeInTheDocument()
    expect(screen.queryByText('This replaces the current code. Students will need the new code/link to join.')).not.toBeInTheDocument()
  })

  it('saves the open join mode', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ classroom: { ...mockClassroom, join_policy: 'open_join' } }),
    })

    render(<TeacherSettingsTab classroom={mockClassroom} />, { wrapper: Wrapper })

    const joinMode = screen.getByRole('switch', { name: 'Join mode' })
    expect(joinMode).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('Allow new joins')).toBeInTheDocument()
    expect(screen.getByText('Only students on roster can join.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'view roster' })).toHaveAttribute(
      'href',
      '/classrooms/cls-123?tab=roster',
    )

    fireEvent.click(joinMode)

    await waitFor(() => {
      expect(screen.getByText('Anyone with this code or link can join after entering their name.')).toBeInTheDocument()
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, options] = fetchMock.mock.calls[0]
    expect(JSON.parse(options.body)).toEqual({ joinPolicy: 'open_join' })
  })
})

describe('TeacherSettingsTab - Classroom Blueprint Promotion', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    mockPush.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    cleanup()
  })

  it('opens the save-as-course-blueprint dialog with the classroom title prefilled', () => {
    render(<TeacherSettingsTab classroom={mockClassroom} />, { wrapper: Wrapper })

    fireEvent.click(screen.getByRole('button', { name: 'Save as Course Blueprint' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Save Classroom as Course Blueprint' })).toBeInTheDocument()
    expect(within(dialog).getByPlaceholderText('Grade 11 Computer Science')).toHaveValue('Test Course')
  })

  it('saves a classroom as a course blueprint and redirects into the blueprint workspace', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        blueprint_id: 'b-1',
        redirect_url: '/teacher/blueprints?blueprint=b-1&fromClassroom=cls-123',
      }),
    })

    render(<TeacherSettingsTab classroom={mockClassroom} />, { wrapper: Wrapper })

    fireEvent.click(screen.getByRole('button', { name: 'Save as Course Blueprint' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByPlaceholderText('Grade 11 Computer Science'), { target: { value: 'Reusable Draft' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Blueprint' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/teacher/classrooms/cls-123/blueprint', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Reusable Draft' }),
    }))

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/teacher/blueprints?blueprint=b-1&fromClassroom=cls-123')
    })
  })
})

describe('TeacherSettingsTab - Success message auto-clear', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    cleanup()
  })

  it('auto-clears classroom name success message after 2 seconds', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ classroom: { ...mockClassroom, title: 'New Name' } }),
    })

    render(<TeacherSettingsTab classroom={mockClassroom} />, { wrapper: Wrapper })

    const input = screen.getByLabelText('Classroom name')
    fireEvent.change(input, { target: { value: 'New Name' } })
    fireEvent.blur(input)

    // Advance microtasks to let the fetch resolve, but not the timeout
    await act(async () => {
      await Promise.resolve()
    })

    // Success message should appear
    expect(screen.getByText('Classroom name updated')).toBeInTheDocument()

    // Advance time to trigger the short auto-clear
    await act(async () => {
      vi.advanceTimersByTime(1800)
    })

    // Success message should be gone
    expect(screen.queryByText('Classroom name updated')).not.toBeInTheDocument()
  })

  it('auto-clears enrollment success message after 2 seconds', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ classroom: { ...mockClassroom, allow_enrollment: false } }),
    })

    render(<TeacherSettingsTab classroom={mockClassroom} />, { wrapper: Wrapper })

    const toggle = screen.getByRole('switch', { name: 'Allow new students to join' })
    fireEvent.click(toggle)

    // Advance microtasks to let the fetch resolve, but not the timeout
    await act(async () => {
      await Promise.resolve()
    })

    // Success message should appear
    expect(screen.getByText('Settings saved')).toBeInTheDocument()

    // Advance time to trigger the short auto-clear
    await act(async () => {
      vi.advanceTimersByTime(1800)
    })

    // Success message should be gone
    expect(screen.queryByText('Settings saved')).not.toBeInTheDocument()
  })
})
