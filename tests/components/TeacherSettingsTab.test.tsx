import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { TeacherSettingsTab } from '@/app/classrooms/[classroomId]/TeacherSettingsTab'
import { TooltipProvider } from '@/ui'
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
  start_date: '2026-01-01',
  end_date: '2026-06-01',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

function Wrapper({ children }: { children: ReactNode }) {
  return <TooltipProvider>{children}</TooltipProvider>
}

describe('TeacherSettingsTab - Course Name Editing', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    mockRefresh.mockClear()
    mockPush.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    cleanup()
  })

  it('renders with course name prefilled', () => {
    render(<TeacherSettingsTab classroom={mockClassroom} />, { wrapper: Wrapper })

    const input = screen.getByLabelText('Course Name')
    expect(input).toHaveValue('Test Course')
  })

  it('saves on blur when value has changed', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ classroom: { ...mockClassroom, title: 'Updated Course' } }),
    })

    render(<TeacherSettingsTab classroom={mockClassroom} />, { wrapper: Wrapper })

    const input = screen.getByLabelText('Course Name')
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

    const input = screen.getByLabelText('Course Name')
    fireEvent.change(input, { target: { value: 'Enter Saved' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ title: 'Enter Saved' })
  })

  it('shows error when course name is empty', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>

    render(<TeacherSettingsTab classroom={mockClassroom} />, { wrapper: Wrapper })

    const input = screen.getByLabelText('Course Name')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)

    expect(screen.getByText('Course name cannot be empty')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not save if value is unchanged', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>

    render(<TeacherSettingsTab classroom={mockClassroom} />, { wrapper: Wrapper })

    const input = screen.getByLabelText('Course Name')
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

    const input = screen.getByLabelText('Course Name')
    fireEvent.change(input, { target: { value: 'New Name' } })
    fireEvent.blur(input)

    await waitFor(() => {
      expect(screen.getByText('Course name updated.')).toBeInTheDocument()
    })
  })

  it('calls router.refresh() after successful save', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ classroom: { ...mockClassroom, title: 'Refreshed' } }),
    })

    render(<TeacherSettingsTab classroom={mockClassroom} />, { wrapper: Wrapper })

    const input = screen.getByLabelText('Course Name')
    fireEvent.change(input, { target: { value: 'Refreshed' } })
    fireEvent.blur(input)

    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalledTimes(1)
    })
  })

  it('shows error message on API failure', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Server error' }),
    })

    render(<TeacherSettingsTab classroom={mockClassroom} />, { wrapper: Wrapper })

    const input = screen.getByLabelText('Course Name')
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

    const input = screen.getByLabelText('Course Name')
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

    const input = screen.getByLabelText('Course Name')
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

  it('trims whitespace from course name before saving', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ classroom: { ...mockClassroom, title: 'Trimmed' } }),
    })

    render(<TeacherSettingsTab classroom={mockClassroom} />, { wrapper: Wrapper })

    const input = screen.getByLabelText('Course Name')
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

    const checkbox = screen.getByLabelText('Allow joining')
    expect(checkbox).toBeChecked()

    fireEvent.click(checkbox)

    await waitFor(() => {
      expect(screen.getByText('Settings saved.')).toBeInTheDocument()
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/teacher/classrooms/cls-123')
    expect(JSON.parse(options.body)).toEqual({ allowEnrollment: false })
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

  it('auto-clears course name success message after 2 seconds', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ classroom: { ...mockClassroom, title: 'New Name' } }),
    })

    render(<TeacherSettingsTab classroom={mockClassroom} />, { wrapper: Wrapper })

    const input = screen.getByLabelText('Course Name')
    fireEvent.change(input, { target: { value: 'New Name' } })
    fireEvent.blur(input)

    // Advance microtasks to let the fetch resolve, but not the 2s timeout
    await act(async () => {
      await Promise.resolve()
    })

    // Success message should appear
    expect(screen.getByText('Course name updated.')).toBeInTheDocument()

    // Advance time by 2 seconds to trigger the auto-clear
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })

    // Success message should be gone
    expect(screen.queryByText('Course name updated.')).not.toBeInTheDocument()
  })

  it('auto-clears enrollment success message after 2 seconds', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ classroom: { ...mockClassroom, allow_enrollment: false } }),
    })

    render(<TeacherSettingsTab classroom={mockClassroom} />, { wrapper: Wrapper })

    const checkbox = screen.getByLabelText('Allow joining')
    fireEvent.click(checkbox)

    // Advance microtasks to let the fetch resolve, but not the 2s timeout
    await act(async () => {
      await Promise.resolve()
    })

    // Success message should appear
    expect(screen.getByText('Settings saved.')).toBeInTheDocument()

    // Advance time by 2 seconds to trigger the auto-clear
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })

    // Success message should be gone
    expect(screen.queryByText('Settings saved.')).not.toBeInTheDocument()
  })
})
