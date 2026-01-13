import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CreateAssignmentModal } from '@/components/CreateAssignmentModal'
import { toTorontoEndOfDayIso, getTodayInToronto } from '@/lib/timezone'
import { addDaysToDateString } from '@/lib/date-string'
import type { Assignment } from '@/types'

describe('CreateAssignmentModal', () => {
  const mockAssignment: Assignment = {
    id: 'new-assignment-1',
    classroom_id: 'classroom-1',
    title: 'New Assignment',
    description: '',
    rich_instructions: { type: 'doc', content: [] },
    due_at: toTorontoEndOfDayIso(addDaysToDateString(getTodayInToronto(), 1)),
    position: 0,
    created_by: 'teacher-1',
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
  }

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('initializes form with tomorrow as default due date', () => {
    render(
      <CreateAssignmentModal
        isOpen={true}
        classroomId="classroom-1"
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    )

    const tomorrow = addDaysToDateString(getTodayInToronto(), 1)
    expect(screen.getByDisplayValue(tomorrow)).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toHaveValue('')
  })

  it('submits POST with correct values and closes', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ assignment: mockAssignment }),
    })

    const onClose = vi.fn()
    const onSuccess = vi.fn()

    render(
      <CreateAssignmentModal
        isOpen={true}
        classroomId="classroom-1"
        onClose={onClose}
        onSuccess={onSuccess}
      />
    )

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'New Assignment' } })
    // Note: RichTextEditor content is not easily testable with fireEvent
    // The editor sends TiptapContent, which defaults to empty
    fireEvent.click(screen.getByRole('button', { name: 'Create Assignment' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/teacher/assignments')
    expect(options.method).toBe('POST')

    const payload = JSON.parse(options.body)
    const tomorrow = addDaysToDateString(getTodayInToronto(), 1)
    expect(payload.classroom_id).toBe('classroom-1')
    expect(payload.title).toBe('New Assignment')
    expect(payload.due_at).toBe(toTorontoEndOfDayIso(tomorrow))
    // Editor initializes with empty paragraph; verify it's valid TiptapContent
    expect(payload.rich_instructions).toHaveProperty('type', 'doc')
    expect(payload.rich_instructions).toHaveProperty('content')

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(mockAssignment)
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('disables submit when title is empty', () => {
    render(
      <CreateAssignmentModal
        isOpen={true}
        classroomId="classroom-1"
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: 'Create Assignment' })).toBeDisabled()
  })

  it('shows error message when API request fails', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Failed to create assignment' }),
    })

    render(
      <CreateAssignmentModal
        isOpen={true}
        classroomId="classroom-1"
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    )

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Test' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Assignment' }))

    await waitFor(() => {
      expect(screen.getByText('Failed to create assignment')).toBeInTheDocument()
    })
  })

  it('resets form when modal is reopened', async () => {
    const { rerender } = render(
      <CreateAssignmentModal
        isOpen={true}
        classroomId="classroom-1"
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    )

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Test Title' } })
    // Note: RichTextEditor state is managed internally and resets when modal reopens

    rerender(
      <CreateAssignmentModal
        isOpen={false}
        classroomId="classroom-1"
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    )

    rerender(
      <CreateAssignmentModal
        isOpen={true}
        classroomId="classroom-1"
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    )

    expect(screen.getByLabelText('Title')).toHaveValue('')
    // RichTextEditor resets to empty content when modal reopens (verified by component state)
  })
})
