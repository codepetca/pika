import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ClassroomPurgeDialog } from '@/components/ClassroomPurgeDialog'

const CLASSROOM_ID = '10000000-0000-4000-8000-000000000001'

describe('ClassroomPurgeDialog', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('shows the complete irreversible impact and requires typed confirmation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        impact: {
          classroom_id: CLASSROOM_ID,
          classroom_title: 'Archived Biology',
          source_revision: 7,
          storage_inventory_sha256: 'a'.repeat(64),
          operational_inventory_sha256: 'b'.repeat(64),
          relational_row_count: 10,
          student_count: 2,
          managed_file_count: 3,
          managed_file_bytes: 2048,
          missing_file_count: 0,
          archive_count: 1,
          gradex_extract_count: 1,
          interrupted_upload_count: 2,
          resource_counts: { classrooms: 1 },
          storage_counts: { 'submission-images': 1 },
          conflicting_operation: null,
          deletion_available: true,
          unavailable_reason: null,
        },
        operation: null,
      }),
    })))
    const onClose = vi.fn()
    render(
      <ClassroomPurgeDialog
        classroomId={CLASSROOM_ID}
        classroomTitle="Archived Biology"
        isOpen
        onClose={onClose}
        onCompleted={vi.fn()}
      />,
    )

    const dialog = await screen.findByRole('dialog', { name: 'Delete classroom permanently?' })
    await within(dialog).findByText('This cannot be undone.')
    expect(dialog).toHaveTextContent('This cannot be undone.')
    expect(dialog).toHaveTextContent(/all student work, submissions, tests, grades/)
    expect(dialog).toHaveTextContent(/attendance and logs, feedback, roster data, and uploads/)
    expect(dialog).toHaveTextContent(/Course Blueprint and user accounts are kept/)
    expect(dialog).toHaveTextContent(/2 interrupted uploads/)
    const deleteButton = within(dialog).getByRole('button', { name: 'Delete permanently' })
    expect(deleteButton).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'DELETE' } })
    expect(deleteButton).toBeEnabled()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })

  it('blocks deletion while a conflicting classroom operation is active', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        impact: {
          classroom_id: CLASSROOM_ID,
          classroom_title: 'Archived Biology',
          source_revision: 7,
          storage_inventory_sha256: 'a'.repeat(64),
          operational_inventory_sha256: 'b'.repeat(64),
          relational_row_count: 1,
          student_count: 0,
          managed_file_count: 0,
          managed_file_bytes: 0,
          missing_file_count: 0,
          archive_count: 0,
          gradex_extract_count: 0,
          interrupted_upload_count: 0,
          resource_counts: { classrooms: 1 },
          storage_counts: {},
          conflicting_operation: 'classroom_grading_operation_active',
          deletion_available: false,
          unavailable_reason: 'Finish the active classroom operation before deleting permanently.',
        },
        operation: null,
      }),
    })))
    render(
      <ClassroomPurgeDialog
        classroomId={CLASSROOM_ID}
        classroomTitle="Archived Biology"
        isOpen
        onClose={vi.fn()}
        onCompleted={vi.fn()}
      />,
    )
    const deleteButton = await screen.findByRole('button', { name: 'Delete permanently' })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'DELETE' } })
    expect(deleteButton).toBeDisabled()
    expect(screen.getAllByText(/Finish the active classroom operation/).length).toBeGreaterThan(0)
  })

  it('stops browser ticks when another worker owns the live lease', async () => {
    const operation = {
      operation_id: '20000000-0000-4000-8000-000000000001',
      classroom_id: CLASSROOM_ID,
      status: 'deleting_objects',
      retryable: null,
      error_code: null,
      attempt_count: 1,
      resource_counts: { classrooms: 1 },
      storage_object_counts: { processing: 1, pending: 1 },
      completed_at: null,
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          impact: {
            classroom_id: CLASSROOM_ID,
            classroom_title: 'Archived Biology',
            source_revision: 7,
            storage_inventory_sha256: 'a'.repeat(64),
            operational_inventory_sha256: 'b'.repeat(64),
            relational_row_count: 2,
            student_count: 1,
            managed_file_count: 2,
            managed_file_bytes: 2,
            missing_file_count: 0,
            archive_count: 0,
            gradex_extract_count: 0,
            interrupted_upload_count: 0,
            resource_counts: { classrooms: 1 },
            storage_counts: { 'test-documents': 2 },
            conflicting_operation: null,
            deletion_available: true,
            unavailable_reason: null,
          },
          operation,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ operation, advanced: false }),
      })
    vi.stubGlobal('fetch', fetchMock)
    render(
      <ClassroomPurgeDialog
        classroomId={CLASSROOM_ID}
        classroomTitle="Archived Biology"
        isOpen
        onClose={vi.fn()}
        onCompleted={vi.fn()}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Continue deletion' }))
    await screen.findByText(/waiting safely for another request or retry window/)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
