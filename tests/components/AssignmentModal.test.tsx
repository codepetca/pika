import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { AssignmentModal } from '@/components/AssignmentModal'
import { MarkdownPreferenceProvider } from '@/contexts/MarkdownPreferenceContext'
import { toTorontoEndOfDayIso } from '@/lib/timezone'
import type { Assignment } from '@/types'

describe('AssignmentModal', () => {
  const baseAssignment: Assignment = {
    id: 'assignment-1',
    classroom_id: 'classroom-1',
    title: 'Original title',
    description: 'Original instructions',
    instructions_markdown: 'Original instructions',
    rich_instructions: {
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { textAlign: null }, content: [{ type: 'text', text: 'Original instructions' }] }],
    },
    due_at: toTorontoEndOfDayIso('2025-01-15'),
    position: 0,
    released_at: null,
    track_authenticity: true,
    created_by: 'teacher-1',
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    is_draft: true,
  }

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  describe('edit mode', () => {
    it('does not render the track writing authenticity toggle', () => {
      render(
        <AssignmentModal
          isOpen={true}
          classroomId="classroom-1"
          assignment={baseAssignment}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      )

      expect(screen.queryByText('Track writing authenticity')).not.toBeInTheDocument()
    })

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

      expect(screen.getByLabelText(/Title/)).toHaveValue('Original title')
      expect(screen.getByDisplayValue('2025-01-15')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Wed Jan 15' })).toBeInTheDocument()
    })

    it('renders a markdown-only instructions editor with formatting buttons', () => {
      render(
        <AssignmentModal
          isOpen={true}
          classroomId="classroom-1"
          assignment={baseAssignment}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      )

      expect(screen.queryByText('Author Markdown')).not.toBeInTheDocument()
      expect(screen.queryByText(/Legacy Rich Text Editor/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/Supported markdown:/i)).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Heading' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Bold' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Italic' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Bullet list' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Link' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Inline code' })).toBeInTheDocument()

      const instructions = screen.getByPlaceholderText('Assignment instructions') as HTMLTextAreaElement
      instructions.focus()
      instructions.setSelectionRange(0, 8)

      fireEvent.click(screen.getByRole('button', { name: 'Bold' }))

      expect(instructions).toHaveValue('**Original** instructions')
      expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled()

      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

      expect(instructions).toHaveValue('Original instructions')
      expect(screen.getByRole('button', { name: 'Redo' })).toBeEnabled()

      fireEvent.click(screen.getByRole('button', { name: 'Redo' }))

      expect(instructions).toHaveValue('**Original** instructions')
    })

    it('hides markdown instruction tools when the user preference is off', async () => {
      window.localStorage.setItem('pika_show_markdown', 'false')

      render(
        <MarkdownPreferenceProvider>
          <AssignmentModal
            isOpen={true}
            classroomId="classroom-1"
            assignment={baseAssignment}
            onClose={vi.fn()}
            onSuccess={vi.fn()}
          />
        </MarkdownPreferenceProvider>
      )

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'Heading' })).not.toBeInTheDocument()
      })
      expect(screen.queryByRole('button', { name: 'Bold' })).not.toBeInTheDocument()
      expect(screen.queryByText('Preview')).not.toBeInTheDocument()
      expect(screen.getByPlaceholderText('Assignment instructions')).toHaveValue('Original instructions')
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

    it('shows split button controls for draft assignments', () => {
      render(
        <AssignmentModal
          isOpen={true}
          classroomId="classroom-1"
          assignment={baseAssignment}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      )

      expect(screen.getByRole('button', { name: 'Post' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Choose assignment action' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Choose assignment action' }))
      expect(screen.queryByRole('menuitem', { name: 'Post' })).not.toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Schedule' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Draft' })).toBeInTheDocument()
    })

    it('schedules release for draft assignments', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          assignment: { ...baseAssignment, is_draft: false, released_at: '2099-03-01T14:00:00.000Z' },
        }),
      })

      render(
        <AssignmentModal
          isOpen={true}
          classroomId="classroom-1"
          assignment={baseAssignment}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: 'Choose assignment action' }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Schedule' }))

      await waitFor(() => {
        expect(screen.getByText('Schedule Release')).toBeInTheDocument()
      })

      const scheduleDialog = screen.getByRole('dialog', { name: 'Schedule Release' })
      const scheduleScope = within(scheduleDialog)

      fireEvent.change(scheduleScope.getByLabelText('Date'), { target: { value: '2099-03-01' } })
      fireEvent.change(scheduleScope.getByLabelText('Time'), { target: { value: '09:00' } })
      fireEvent.click(scheduleScope.getByRole('button', { name: 'Schedule' }))

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1)
      })

      const [url, options] = fetchMock.mock.calls[0]
      expect(url).toBe('/api/teacher/assignments/assignment-1/release')
      expect(options.method).toBe('POST')
      const payload = JSON.parse(options.body)
      expect(payload.release_at).toBeDefined()
    })

    it('defaults the schedule dialog date to the next day for draft assignments', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-03-01T13:00:00.000Z')) // 2026-03-01 08:00 Toronto

      render(
        <AssignmentModal
          isOpen={true}
          classroomId="classroom-1"
          assignment={{ ...baseAssignment, due_at: toTorontoEndOfDayIso('2026-03-02') }}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: 'Choose assignment action' }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Schedule' }))

      await act(async () => {
        await Promise.resolve()
      })

      const scheduleDialog = screen.getByRole('dialog', { name: 'Schedule Release' })
      const scheduleScope = within(scheduleDialog)

      expect(scheduleScope.getByText('Due tomorrow')).toBeInTheDocument()
      expect(scheduleScope.getByLabelText('Date')).toHaveValue('2026-03-02')
      expect(scheduleScope.getByLabelText('Time')).toHaveValue('07:00')
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

      fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Updated title' } })
      fireEvent.click(screen.getByRole('button', { name: 'Choose assignment action' }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Draft' }))
      fireEvent.click(screen.getByRole('button', { name: 'Draft' }))

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1)
      })

      const [url, options] = fetchMock.mock.calls[0]
      expect(url).toBe('/api/teacher/assignments/assignment-1')
      expect(options.method).toBe('PATCH')

      const payload = JSON.parse(options.body)
      expect(payload.title).toBe('Updated title')
      expect(payload.due_at).toBeUndefined()
      expect(payload.instructions_markdown).toBeUndefined()

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalled()
        expect(onClose).toHaveBeenCalled()
      })
    })

    it('uses Post as the default primary action for draft edits', () => {
      render(
        <AssignmentModal
          isOpen={true}
          classroomId="classroom-1"
          assignment={baseAssignment}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      )

      expect(screen.getByRole('button', { name: 'Post' })).toBeInTheDocument()
    })

    it('requires a title before posting a draft assignment', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>

      render(
        <AssignmentModal
          isOpen={true}
          classroomId="classroom-1"
          assignment={{ ...baseAssignment, title: 'Untitled Assignment' }}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      )

      const titleInput = screen.getByPlaceholderText('Add a title')
      expect(titleInput).toHaveValue('')

      fireEvent.click(screen.getByRole('button', { name: 'Post' }))

      expect(screen.getByText('Add a title before posting or scheduling this assignment.')).toBeInTheDocument()
      expect(document.activeElement).toBe(titleInput)
      expect(screen.queryByText('Post assignment to students?')).not.toBeInTheDocument()
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('requires a title before opening schedule flow for a draft assignment', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>

      render(
        <AssignmentModal
          isOpen={true}
          classroomId="classroom-1"
          assignment={{ ...baseAssignment, title: 'Untitled Assignment' }}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: 'Choose assignment action' }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Schedule' }))

      await waitFor(() => {
        expect(screen.getByText('Add a title before posting or scheduling this assignment.')).toBeInTheDocument()
      })
      expect(screen.queryByText('Schedule Release')).not.toBeInTheDocument()
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('opens mini schedule modal when scheduled assignment primary is clicked', async () => {
      const scheduledAssignment: Assignment = {
        ...baseAssignment,
        is_draft: false,
        released_at: '2099-03-01T14:00:00.000Z',
      }
      const onSuccess = vi.fn()

      render(
        <AssignmentModal
          isOpen={true}
          classroomId="classroom-1"
          assignment={scheduledAssignment}
          onClose={vi.fn()}
          onSuccess={onSuccess}
        />
      )

      expect(screen.getByRole('button', { name: 'Schedule' })).toBeInTheDocument()
      expect(screen.getByText(/Mar 1, 9:00 AM/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Choose assignment action' })).toBeDisabled()
      fireEvent.click(screen.getByRole('button', { name: 'Choose assignment action' }))
      expect(screen.queryByRole('menuitem', { name: 'Post' })).not.toBeInTheDocument()
      expect(screen.queryByRole('menuitem', { name: 'Schedule' })).not.toBeInTheDocument()
      expect(screen.queryByRole('menuitem', { name: 'Draft' })).not.toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Schedule' }))

      await waitFor(() => {
        expect(screen.getByText('Schedule Release')).toBeInTheDocument()
      })
      expect(screen.getByRole('button', { name: 'Cancel schedule' })).toBeInTheDocument()
      expect(onSuccess).not.toHaveBeenCalled()
    })

    it('closes both modals when save schedule is confirmed', async () => {
      const scheduledAssignment: Assignment = {
        ...baseAssignment,
        is_draft: false,
        released_at: '2099-03-01T14:00:00.000Z',
      }
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ assignment: { ...scheduledAssignment, released_at: '2099-03-02T15:00:00.000Z' } }),
      })
      const onSuccess = vi.fn()
      const onClose = vi.fn()

      render(
        <AssignmentModal
          isOpen={true}
          classroomId="classroom-1"
          assignment={scheduledAssignment}
          onClose={onClose}
          onSuccess={onSuccess}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: 'Schedule' }))
      await waitFor(() => {
        expect(screen.getByText('Schedule Release')).toBeInTheDocument()
      })

      const scheduleDialog = screen.getByRole('dialog', { name: 'Schedule Release' })
      const scheduleScope = within(scheduleDialog)
      fireEvent.change(scheduleScope.getByLabelText('Date'), { target: { value: '2099-03-02' } })
      fireEvent.change(scheduleScope.getByLabelText('Time'), { target: { value: '10:00' } })
      fireEvent.click(scheduleScope.getByRole('button', { name: 'Save schedule' }))

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1)
      })

      const [url, options] = fetchMock.mock.calls[0]
      expect(url).toBe('/api/teacher/assignments/assignment-1')
      expect(options.method).toBe('PATCH')
      expect(JSON.parse(options.body).released_at).toBeDefined()

      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalled()
        expect(onClose).toHaveBeenCalled()
      })
    })

    it('clears scheduled release from the schedule modal cancel action', async () => {
      const scheduledAssignment: Assignment = {
        ...baseAssignment,
        is_draft: false,
        released_at: '2099-03-01T14:00:00.000Z',
      }
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ assignment: { ...scheduledAssignment, is_draft: true, released_at: null } }),
      })
      const onSuccess = vi.fn()
      const onClose = vi.fn()

      render(
        <AssignmentModal
          isOpen={true}
          classroomId="classroom-1"
          assignment={scheduledAssignment}
          onClose={onClose}
          onSuccess={onSuccess}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: 'Schedule' }))
      await waitFor(() => {
        expect(screen.getByText('Schedule Release')).toBeInTheDocument()
      })
      fireEvent.click(screen.getByRole('button', { name: 'Cancel schedule' }))

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1)
      })
      const [url, options] = fetchMock.mock.calls[0]
      expect(url).toBe('/api/teacher/assignments/assignment-1')
      expect(options.method).toBe('PATCH')
      expect(JSON.parse(options.body)).toEqual({ is_draft: true, released_at: null })
      await waitFor(() => {
        expect(onSuccess).toHaveBeenCalledWith(
          expect.objectContaining({ is_draft: true, released_at: null }),
          { closeModal: false }
        )
      })
      expect(onClose).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'Schedule' })).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Choose assignment action' }))
      expect(screen.getByRole('menuitem', { name: 'Post' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Draft' })).toBeInTheDocument()
      expect(screen.queryByRole('menuitem', { name: 'Schedule' })).not.toBeInTheDocument()
    })

    it('saves pending form edits before opening schedule modal from schedule action', async () => {
      const scheduledAssignment: Assignment = {
        ...baseAssignment,
        is_draft: false,
        released_at: '2099-03-01T14:00:00.000Z',
      }
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ assignment: { ...scheduledAssignment, title: 'Updated title' } }),
      })

      render(
        <AssignmentModal
          isOpen={true}
          classroomId="classroom-1"
          assignment={scheduledAssignment}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      )

      fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Updated title' } })
      fireEvent.click(screen.getByRole('button', { name: 'Schedule' }))

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1)
      })

      const [url, options] = fetchMock.mock.calls[0]
      expect(url).toBe('/api/teacher/assignments/assignment-1')
      expect(options.method).toBe('PATCH')
      expect(screen.getByText('Schedule Release')).toBeInTheDocument()
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

      expect(screen.getByPlaceholderText('Add a title')).toHaveValue('')
      expect(screen.queryByDisplayValue('Untitled Assignment')).not.toBeInTheDocument()

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

    it('closes modal on auto-create failure', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
      fetchMock.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Failed to create assignment' }),
      })

      const onClose = vi.fn()
      const onSuccess = vi.fn()

      render(
        <AssignmentModal
          isOpen={true}
          classroomId="classroom-1"
          onClose={onClose}
          onSuccess={onSuccess}
        />
      )

      // Should close modal after failed creation
      await waitFor(() => {
        expect(onClose).toHaveBeenCalled()
      })

      // onSuccess should not be called
      expect(onSuccess).not.toHaveBeenCalled()
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

      // Change the title and choose "Draft" action
      fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Updated Title' } })
      fireEvent.click(screen.getByRole('button', { name: 'Choose assignment action' }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Draft' }))
      fireEvent.click(screen.getByRole('button', { name: 'Draft' }))

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

    it('opens schedule modal from split action and schedules release', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
      const newAssignment = { ...baseAssignment, id: 'new-draft-1', title: 'Essay outline' }
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ assignment: newAssignment }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            assignment: { ...newAssignment, is_draft: false, released_at: '2099-03-01T14:00:00.000Z' },
          }),
        })

      render(
        <AssignmentModal
          isOpen={true}
          classroomId="classroom-1"
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Edit Draft')).toBeInTheDocument()
      })

      fireEvent.change(screen.getByPlaceholderText('Add a title'), { target: { value: 'Essay outline' } })
      fireEvent.click(screen.getByRole('button', { name: 'Choose assignment action' }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Schedule' }))

      await waitFor(() => {
        expect(screen.getByText('Schedule Release')).toBeInTheDocument()
      })

      const scheduleDialog = screen.getByRole('dialog', { name: 'Schedule Release' })
      const scheduleScope = within(scheduleDialog)
      fireEvent.change(scheduleScope.getByLabelText('Date'), { target: { value: '2099-03-01' } })
      fireEvent.change(scheduleScope.getByLabelText('Time'), { target: { value: '09:00' } })
      fireEvent.click(scheduleScope.getByRole('button', { name: 'Schedule' }))

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(2)
      })

      const [url, options] = fetchMock.mock.calls[1]
      expect(url).toBe('/api/teacher/assignments/new-draft-1/release')
      expect(options.method).toBe('POST')
      const payload = JSON.parse(options.body)
      expect(payload.release_at).toBeDefined()

      await waitFor(() => {
        expect(screen.getByText(/Mar 1, 9:00 AM/)).toBeInTheDocument()
      })
    })

    it('closes create modal when save schedule is confirmed', async () => {
      const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>
      const newAssignment = { ...baseAssignment, id: 'new-draft-1', title: 'Research summary' }
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ assignment: newAssignment }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            assignment: { ...newAssignment, is_draft: false, released_at: '2099-03-01T14:00:00.000Z' },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            assignment: { ...newAssignment, is_draft: false, released_at: '2099-03-01T15:00:00.000Z' },
          }),
        })

      const onClose = vi.fn()

      render(
        <AssignmentModal
          isOpen={true}
          classroomId="classroom-1"
          onClose={onClose}
          onSuccess={vi.fn()}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Edit Draft')).toBeInTheDocument()
      })

      fireEvent.change(screen.getByPlaceholderText('Add a title'), { target: { value: 'Research summary' } })
      fireEvent.click(screen.getByRole('button', { name: 'Choose assignment action' }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Schedule' }))
      await waitFor(() => {
        expect(screen.getByText('Schedule Release')).toBeInTheDocument()
      })
      let scheduleDialog = screen.getByRole('dialog', { name: 'Schedule Release' })
      let scheduleScope = within(scheduleDialog)
      fireEvent.change(scheduleScope.getByLabelText('Date'), { target: { value: '2099-03-01' } })
      fireEvent.change(scheduleScope.getByLabelText('Time'), { target: { value: '09:00' } })
      fireEvent.click(scheduleScope.getByRole('button', { name: 'Schedule' }))

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(2)
      })
      expect(onClose).not.toHaveBeenCalled()

      const editScheduledDialog = screen.getByRole('dialog', { name: 'Edit Scheduled Assignment' })
      fireEvent.click(within(editScheduledDialog).getByRole('button', { name: 'Schedule' }))
      scheduleDialog = await screen.findByRole('dialog', { name: 'Schedule Release' })
      scheduleScope = within(scheduleDialog)
      fireEvent.change(scheduleScope.getByLabelText('Time'), { target: { value: '10:00' } })
      fireEvent.click(scheduleScope.getByRole('button', { name: 'Save schedule' }))

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(3)
      })
      await waitFor(() => {
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

      fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Modified title' } })
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

      fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Modified title' } })
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
