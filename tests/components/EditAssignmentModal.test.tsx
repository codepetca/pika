import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { EditAssignmentModal } from '@/components/EditAssignmentModal'
import { toTorontoEndOfDayIso } from '@/lib/timezone'
import type { Assignment } from '@/types'

describe('EditAssignmentModal', () => {
  const baseAssignment: Assignment = {
    id: 'assignment-1',
    classroom_id: 'classroom-1',
    title: 'Original title',
    description: 'Original instructions',
    due_at: toTorontoEndOfDayIso('2025-01-15'),
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

  it('prefills the form with assignment data', () => {
    render(
      <EditAssignmentModal
        isOpen={true}
        assignment={baseAssignment}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    )

    expect(screen.getByLabelText('Title')).toHaveValue('Original title')
    expect(screen.getByDisplayValue('Original instructions')).toBeInTheDocument()
    expect(screen.getByDisplayValue('2025-01-15')).toBeInTheDocument()
  })

  it('submits PATCH with updated values and closes', async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ assignment: { ...baseAssignment, title: 'Updated title' } }),
    })

    const onClose = vi.fn()
    const onSuccess = vi.fn()

    render(
      <EditAssignmentModal
        isOpen={true}
        assignment={baseAssignment}
        onClose={onClose}
        onSuccess={onSuccess}
      />
    )

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Updated title' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/teacher/assignments/assignment-1')
    expect(options.method).toBe('PATCH')

    const payload = JSON.parse(options.body)
    expect(payload).toEqual({
      title: 'Updated title',
      description: 'Original instructions',
      due_at: toTorontoEndOfDayIso('2025-01-15'),
    })

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled()
      expect(onClose).toHaveBeenCalled()
    })
  })

  it('disables submit when title is empty', () => {
    render(
      <EditAssignmentModal
        isOpen={true}
        assignment={baseAssignment}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
      />
    )

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '' } })

    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
  })
})
