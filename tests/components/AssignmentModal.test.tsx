import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AssignmentModal } from '@/components/AssignmentModal'
import { toTorontoEndOfDayIso } from '@/lib/timezone'
import type { Assignment } from '@/types'

describe('AssignmentModal', () => {
  const baseAssignment: Assignment = {
    id: 'assignment-1',
    classroom_id: 'classroom-1',
    title: 'Original title',
    description: 'Original instructions',
    rich_instructions: {
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { textAlign: null }, content: [{ type: 'text', text: 'Original instructions' }] }],
    },
    due_at: toTorontoEndOfDayIso('2025-01-15'),
    position: 0,
    created_by: 'teacher-1',
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    is_draft: true,
  }

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('edit mode', () => {
    it('prefills the form with assignment data', () => {
      render(
        <AssignmentModal
          isOpen={true}
          classroomId="classroom-1"
          assignment={baseAssignment}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      )

      expect(screen.getByLabelText('Title')).toHaveValue('Original title')
      expect(screen.getByDisplayValue('2025-01-15')).toBeInTheDocument()
    })

    it('shows save status indicator', () => {
      render(
        <AssignmentModal
          isOpen={true}
          classroomId="classroom-1"
          assignment={baseAssignment}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      )

      expect(screen.getByText('Saved')).toBeInTheDocument()
    })

    it('manual save sends only changed fields and closes modal', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ assignment: { ...baseAssignment, title: 'Updated title' } }),
      })

      const onSuccess = vi.fn()
      const onClose = vi.fn()

      render(
        <AssignmentModal
          isOpen={true}
          classroomId="classroom-1"
          assignment={baseAssignment}
          onClose={onClose}
          onSuccess={onSuccess}
        />
      )

      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Updated title' } })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1)
      })

      const [url, options] = fetchMock.mock.calls[0]
      expect(url).toBe('/api/teacher/assignments/assignment-1')
      expect(options.method).toBe('PATCH')

      const payload = JSON.parse(options.body)
      expect(payload.title).toBe('Updated title')
      expect(payload.due_at).toBeUndefined()
      expect(payload.rich_instructions).toBeUndefined()

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalled()
        expect(onClose).toHaveBeenCalled()
      })
    })

    it('disables submit when title is empty', () => {
      render(
        <AssignmentModal
          isOpen={true}
          classroomId="classroom-1"
          assignment={baseAssignment}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      )

      fireEvent.change(screen.getByLabelText('Title'), { target: { value: '' } })
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    })

    it('shows Close button when no changes have been made', () => {
      render(
        <AssignmentModal
          isOpen={true}
          classroomId="classroom-1"
          assignment={baseAssignment}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      )

      const closeButtons = screen.getAllByRole('button', { name: 'Close' })
      const submitButton = closeButtons.find(btn => btn.getAttribute('type') === 'submit')
      expect(submitButton).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    })
  })

  describe('create mode', () => {
    it('automatically creates draft on open', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
      const newAssignment = { ...baseAssignment, id: 'new-draft-1', title: 'Untitled Assignment' }
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ assignment: newAssignment }),
      })

      render(
        <AssignmentModal
          isOpen={true}
          classroomId="classroom-1"
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      )

      // Initially shows "Creating Draft..."
      expect(screen.getByText('Creating Draft...')).toBeInTheDocument()

      // After creation, shows "Edit Draft"
      await waitFor(() => {
        expect(screen.getByText('Edit Draft')).toBeInTheDocument()
      })

      // Should have called POST to create the draft
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, options] = fetchMock.mock.calls[0]
      expect(url).toBe('/api/teacher/assignments')
      expect(options.method).toBe('POST')
    })

    it('shows Saved status after draft is created', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
      const newAssignment = { ...baseAssignment, id: 'new-draft-1', title: 'Untitled Assignment' }
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ assignment: newAssignment }),
      })

      render(
        <AssignmentModal
          isOpen={true}
          classroomId="classroom-1"
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      )

      // Initially shows "Saving..." during creation
      expect(screen.getByText('Saving...')).toBeInTheDocument()

      // After creation, shows "Saved"
      await waitFor(() => {
        expect(screen.getByText('Saved')).toBeInTheDocument()
      })
    })

    it('updates draft and closes on save', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
      const newAssignment = { ...baseAssignment, id: 'new-draft-1', title: 'Untitled Assignment' }
      const updatedAssignment = { ...newAssignment, title: 'Updated Title' }

      // First call creates the draft
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ assignment: newAssignment }),
      })
      // Second call updates it
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ assignment: updatedAssignment }),
      })

      const onSuccess = vi.fn()
      const onClose = vi.fn()

      render(
        <AssignmentModal
          isOpen={true}
          classroomId="classroom-1"
          onClose={onClose}
          onSuccess={onSuccess}
        />
      )

      // Wait for draft to be created
      await waitFor(() => {
        expect(screen.getByText('Edit Draft')).toBeInTheDocument()
      })

      // Change the title and save
      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Updated Title' } })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(2)
      })

      // Second call should be a PATCH to update
      const [url, options] = fetchMock.mock.calls[1]
      expect(url).toBe('/api/teacher/assignments/new-draft-1')
      expect(options.method).toBe('PATCH')

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalled()
        expect(onClose).toHaveBeenCalled()
      })
    })
  })

  describe('autosave behavior', () => {
    it('shows "Unsaved" after making changes', async () => {
      render(
        <AssignmentModal
          isOpen={true}
          classroomId="classroom-1"
          assignment={baseAssignment}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      )

      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Modified title' } })
      expect(screen.getByText('Unsaved')).toBeInTheDocument()
    })

    it('saves and closes on Escape key when there are changes', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ assignment: { ...baseAssignment, title: 'Modified title' } }),
      })

      const onClose = vi.fn()
      const onSuccess = vi.fn()

      render(
        <AssignmentModal
          isOpen={true}
          classroomId="classroom-1"
          assignment={baseAssignment}
          onClose={onClose}
          onSuccess={onSuccess}
        />
      )

      fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Modified title' } })
      fireEvent.keyDown(screen.getByRole('dialog').parentElement!, { key: 'Escape' })

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1)
      })

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalled()
        expect(onClose).toHaveBeenCalled()
      })
    })

    it('closes without saving if no changes on Escape key', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
      const onClose = vi.fn()
      const onSuccess = vi.fn()

      render(
        <AssignmentModal
          isOpen={true}
          classroomId="classroom-1"
          assignment={baseAssignment}
          onClose={onClose}
          onSuccess={onSuccess}
        />
      )

      fireEvent.keyDown(screen.getByRole('dialog').parentElement!, { key: 'Escape' })

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalled()
        expect(onClose).toHaveBeenCalled()
      })
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })
})
