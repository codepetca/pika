import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act, within } from '@testing-library/react'
import { TeacherSettingsTab } from '@/app/classrooms/[classroomId]/TeacherSettingsTab'
import { AppMessageProvider, TooltipProvider } from '@/ui'
import { MarkdownPreferenceProvider } from '@/contexts/MarkdownPreferenceContext'
import type { Classroom } from '@/types'
import type { ReactNode } from 'react'
import { DEFAULT_CLASSROOM_FEATURE_VISIBILITY } from '@/lib/classroom-feature-visibility'

// Mock next/navigation
const mockRefresh = vi.fn()
const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
  useSearchParams: () => ({
    get: () => null, // defaults to 'general' section
  }),
}))

vi.mock('@/components/editor', () => ({
  MarkdownContentEditor: ({ markdown, onMarkdownChange, id, placeholder, className, 'aria-labelledby': ariaLabelledBy }: {
    markdown: string
    onMarkdownChange: (value: string) => void
    id?: string
    placeholder?: string
    className?: string
    'aria-labelledby'?: string
  }) => (
    <textarea
      id={id}
      aria-labelledby={ariaLabelledBy}
      placeholder={placeholder}
      className={className}
      value={markdown}
      onChange={(event) => onMarkdownChange(event.target.value)}
    />
  ),
}))

const mockClassroom: Classroom = {
  id: 'cls-123',
  teacher_id: 't1',
  title: 'Test Course',
  class_code: 'ABC123',
  theme_color: 'blue',
  term_label: null,
  allow_enrollment: true,
  join_policy: 'roster',
  start_date: '2026-01-01',
  end_date: '2026-06-01',
  lesson_plan_visibility: 'current_week',
  feature_visibility: DEFAULT_CLASSROOM_FEATURE_VISIBILITY,
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
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const secondClassroom: Classroom = {
  ...mockClassroom,
  id: 'cls-456',
  title: 'Chemistry 12',
  class_code: 'CHEM12',
  theme_color: 'rose',
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
    expect(screen.getByRole('group', { name: 'Classroom color' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Sky Selected/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('resets classroom-derived form state when switching classrooms', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    const firstClassroom = { ...mockClassroom }
    const { rerender } = render(
      <TeacherSettingsTab classroom={firstClassroom} sectionParam="general" />,
      { wrapper: Wrapper },
    )

    fireEvent.change(screen.getByLabelText('Classroom name'), { target: { value: 'Unsaved Course A' } })
    rerender(<TeacherSettingsTab classroom={secondClassroom} sectionParam="general" />)

    await waitFor(() => expect(screen.getByLabelText('Classroom name')).toHaveValue('Chemistry 12'))

    rerender(<TeacherSettingsTab classroom={secondClassroom} sectionParam="access" />)
    expect(screen.getByRole('button', { name: 'Copy join code' })).toHaveTextContent('CHEM12')
    expect(screen.getByRole('switch', { name: 'Allow new students to join' })).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByLabelText('Calendar visibility')).toHaveValue('all')

    rerender(<TeacherSettingsTab classroom={secondClassroom} sectionParam="general" />)
    await waitFor(() => expect(screen.getByLabelText('Classroom name')).toHaveValue('Chemistry 12'))
    expect(screen.getByRole('button', { name: /Coral Selected/ })).toHaveAttribute('aria-pressed', 'true')

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

  it('persists the show markdown display setting from the general settings tab', async () => {
    const { rerender } = render(<TeacherSettingsTab classroom={mockClassroom} />, { wrapper: Wrapper })

    const markdownToggle = await screen.findByRole('switch', { name: 'Show markdown' })
    expect(markdownToggle).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(markdownToggle)

    await waitFor(() => {
      expect(markdownToggle).toHaveAttribute('aria-checked', 'false')
    })
    expect(window.localStorage.getItem('pika_show_markdown')).toBe('false')
    rerender(<TeacherSettingsTab classroom={mockClassroom} sectionParam="general" />)
    expect(screen.getByRole('switch', { name: 'Show markdown' })).toHaveAttribute('aria-checked', 'false')
  })

  it('routes legacy Course Guide settings URLs back to General settings', () => {
    render(<TeacherSettingsTab classroom={mockClassroom} sectionParam="syllabus" />, { wrapper: Wrapper })

    expect(screen.getByRole('button', { name: 'General' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Classroom name')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Course Guide' })).toBeNull()
    expect(screen.queryByLabelText('Public page address')).toBeNull()
  })

  it('uses the shared section switcher for each settings area', () => {
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
    expect(within(sectionSwitcher).getByRole('button', { name: 'Access' })).toBeInTheDocument()
    expect(within(sectionSwitcher).getByRole('button', { name: 'Features' })).toBeInTheDocument()
    expect(within(sectionSwitcher).queryByRole('button', { name: 'Course Guide' })).toBeNull()
    expect(within(sectionSwitcher).getByRole('button', { name: 'Reuse' })).toBeInTheDocument()

    fireEvent.click(within(sectionSwitcher).getByRole('button', { name: 'Class Days' }))

    expect(onSectionChange).toHaveBeenCalledWith('class-days')
  })

  it('falls back to general settings for an unknown section URL', () => {
    render(<TeacherSettingsTab classroom={mockClassroom} sectionParam="removed-section" />, { wrapper: Wrapper })

    expect(screen.getByRole('button', { name: 'General' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Classroom name')).toBeInTheDocument()
  })

  it('shows the optional classroom features and explains the non-destructive core', () => {
    render(
      <TeacherSettingsTab classroom={mockClassroom} sectionParam="features" palEnabled />,
      { wrapper: Wrapper },
    )

    expect(screen.getByText(/Hiding a feature does not delete its content/)).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Show Attendance' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: 'Show Classwork' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: 'Show Achievements' })).toHaveAttribute('aria-checked', 'true')
  })

  it('saves a complete visibility record and reports the updated classroom', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    const onClassroomUpdated = vi.fn()
    const savedVisibility = { ...DEFAULT_CLASSROOM_FEATURE_VISIBILITY, tests: false }
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        classroom: { ...mockClassroom, feature_visibility: savedVisibility },
      }),
    })

    render(
      <TeacherSettingsTab
        classroom={mockClassroom}
        sectionParam="features"
        onClassroomUpdated={onClassroomUpdated}
      />,
      { wrapper: Wrapper },
    )
    fireEvent.click(screen.getByRole('switch', { name: 'Show Tests' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      featureVisibility: savedVisibility,
    })
    await waitFor(() => {
      expect(screen.getByRole('switch', { name: 'Show Tests' })).toHaveAttribute('aria-checked', 'false')
      expect(onClassroomUpdated).toHaveBeenCalledWith(
        expect.objectContaining({ feature_visibility: savedVisibility }),
      )
    })
  })

  it('can re-enable a hidden feature without changing the rest of the record', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    const hiddenTests = { ...DEFAULT_CLASSROOM_FEATURE_VISIBILITY, tests: false }
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        classroom: {
          ...mockClassroom,
          feature_visibility: DEFAULT_CLASSROOM_FEATURE_VISIBILITY,
        },
      }),
    })

    render(
      <TeacherSettingsTab
        classroom={{ ...mockClassroom, feature_visibility: hiddenTests }}
        sectionParam="features"
      />,
      { wrapper: Wrapper },
    )
    const tests = screen.getByRole('switch', { name: 'Show Tests' })
    expect(tests).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(tests)

    await waitFor(() => expect(tests).toHaveAttribute('aria-checked', 'true'))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      featureVisibility: DEFAULT_CLASSROOM_FEATURE_VISIBILITY,
    })
  })

  it('preserves the Gradebook preference but disables its switch without grade sources', () => {
    render(
      <TeacherSettingsTab
        classroom={{
          ...mockClassroom,
          feature_visibility: {
            ...DEFAULT_CLASSROOM_FEATURE_VISIBILITY,
            classwork: false,
            tests: false,
            gradebook: true,
          },
        }}
        sectionParam="features"
      />,
      { wrapper: Wrapper },
    )

    const gradebook = screen.getByRole('switch', { name: 'Show Gradebook' })
    expect(gradebook).toHaveAttribute('aria-checked', 'false')
    expect(gradebook).toBeDisabled()
    expect(screen.getByText('Teacher only · Hidden until Classwork or Tests is enabled')).toBeInTheDocument()
  })

  it('restores the prior feature state when saving fails', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Feature update failed' }),
    })
    render(
      <TeacherSettingsTab classroom={mockClassroom} sectionParam="features" />,
      { wrapper: Wrapper },
    )

    const tests = screen.getByRole('switch', { name: 'Show Tests' })
    fireEvent.click(tests)

    await waitFor(() => {
      expect(screen.getByText('Feature update failed')).toBeInTheDocument()
      expect(tests).toHaveAttribute('aria-checked', 'true')
    })
  })

  it('keeps feature switches read-only for archived classrooms', () => {
    render(
      <TeacherSettingsTab
        classroom={{ ...mockClassroom, archived_at: '2026-08-20T00:00:00.000Z' }}
        sectionParam="features"
      />,
      { wrapper: Wrapper },
    )

    expect(screen.getByRole('switch', { name: 'Show Tests' })).toBeDisabled()
    expect(screen.getByRole('switch', { name: 'Show Attendance' })).toBeDisabled()
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

  it('saves classroom theme color changes', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    const onClassroomUpdated = vi.fn()
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ classroom: { ...mockClassroom, theme_color: 'teal' } }),
    })

    render(<TeacherSettingsTab classroom={mockClassroom} onClassroomUpdated={onClassroomUpdated} />, { wrapper: Wrapper })

    const blueButton = screen.getByRole('button', { name: /Sky Selected/ })
    const tealButton = screen.getByRole('button', { name: /^Mint/ })

    expect(blueButton).toHaveClass('classroom-theme-option')
    expect(blueButton).toHaveClass('classroom-theme-option-selected')
    expect(blueButton).toHaveClass('border-l-4')
    expect(tealButton).toHaveClass('classroom-theme-option')
    expect(tealButton).not.toHaveClass('classroom-theme-option-selected')
    expect(tealButton).not.toHaveClass('border-l-4')

    fireEvent.click(tealButton)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/teacher/classrooms/cls-123', expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ themeColor: 'teal' }),
      }))
    })
    expect(await screen.findByText('Classroom color updated')).toBeInTheDocument()
    expect(onClassroomUpdated).toHaveBeenCalledWith(expect.objectContaining({ id: 'cls-123', theme_color: 'teal' }))
    expect(screen.getByRole('button', { name: /Mint Selected/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Mint Selected/ })).toHaveClass('classroom-theme-option-selected')
    expect(screen.getByRole('button', { name: /Mint Selected/ })).toHaveClass('border-l-4')
    expect(screen.getByRole('button', { name: /^Sky$/ })).not.toHaveClass('classroom-theme-option-selected')
    expect(screen.getByRole('button', { name: /^Sky$/ })).not.toHaveClass('border-l-4')
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

    render(<TeacherSettingsTab classroom={mockClassroom} sectionParam="access" />, { wrapper: Wrapper })

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
    render(<TeacherSettingsTab classroom={mockClassroom} sectionParam="access" />, { wrapper: Wrapper })

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

    render(<TeacherSettingsTab classroom={mockClassroom} sectionParam="access" />, { wrapper: Wrapper })

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
    render(<TeacherSettingsTab classroom={mockClassroom} sectionParam="reuse" />, { wrapper: Wrapper })

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

    render(<TeacherSettingsTab classroom={mockClassroom} sectionParam="reuse" />, { wrapper: Wrapper })

    fireEvent.click(screen.getByRole('button', { name: 'Save as Course Blueprint' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByPlaceholderText('Grade 11 Computer Science'), { target: { value: 'Reusable Draft' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Blueprint' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/teacher/classrooms/cls-123/blueprint', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        'Content-Type': 'application/json',
        'Idempotency-Key': expect.any(String),
      }),
      body: JSON.stringify({ title: 'Reusable Draft' }),
    }))

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/teacher/blueprints?blueprint=b-1&fromClassroom=cls-123')
    })
  })

  it('reuses the capture idempotency key when an unchanged request is retried', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Temporary failure' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          blueprint_id: 'b-1',
          redirect_url: '/teacher/blueprints?blueprint=b-1&fromClassroom=cls-123',
        }),
      })

    render(<TeacherSettingsTab classroom={mockClassroom} sectionParam="reuse" />, { wrapper: Wrapper })
    fireEvent.click(screen.getByRole('button', { name: 'Save as Course Blueprint' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByPlaceholderText('Grade 11 Computer Science'), { target: { value: 'Reusable Draft' } })

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Blueprint' }))
    expect(await within(dialog).findByText('Temporary failure')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Blueprint' }))

    await waitFor(() => expect(mockPush).toHaveBeenCalled())
    const firstHeaders = fetchMock.mock.calls[0][1]?.headers as Record<string, string>
    const secondHeaders = fetchMock.mock.calls[1][1]?.headers as Record<string, string>
    expect(firstHeaders['Idempotency-Key']).toBe(secondHeaders['Idempotency-Key'])
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

    render(<TeacherSettingsTab classroom={mockClassroom} sectionParam="access" />, { wrapper: Wrapper })

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
