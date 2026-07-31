import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ClassroomPurgeDialog } from '@/components/ClassroomPurgeDialog'

const CLASSROOM_ID = '10000000-0000-4000-8000-000000000001'

describe('ClassroomPurgeDialog', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('exposes an accessible irreversible confirmation boundary and restores close control', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        impact: {
          classroom_id: CLASSROOM_ID,
          classroom_title: 'Archived Biology',
          relational_row_count: 10,
          student_count: 2,
          managed_file_count: 3,
          managed_file_bytes: 2048,
          missing_file_count: 0,
          archive_count: 1,
          gradex_extract_count: 1,
          resource_counts: { classrooms: 1 },
          storage_counts: { 'submission-images': 1 },
          conflicting_operation: null,
          ownership_coverage_status: 'verified',
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
    expect(dialog).toHaveTextContent('This cannot be undone.')
    expect(dialog).toHaveTextContent(/all student work, submissions, tests, grades/)
    const confirm = screen.getByRole('textbox')
    const deleteButton = screen.getByRole('button', { name: 'Delete permanently' })
    expect(deleteButton).toBeDisabled()

    fireEvent.change(confirm, { target: { value: 'DELETE' } })
    expect(deleteButton).toBeEnabled()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })
})
