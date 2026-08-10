import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ColdClassroomPurgeDialog } from '@/components/ColdClassroomPurgeDialog'

const CLASSROOM_ID = '10000000-0000-4000-8000-000000000001'
const ARCHIVE_ID = '20000000-0000-4000-8000-000000000001'
const OPERATION_ID = '30000000-0000-4000-8000-000000000001'

const impact = {
  classroom_id: CLASSROOM_ID,
  archive_id: ARCHIVE_ID,
  classroom_title: 'Stored Biology',
  source_revision: 8,
  storage_inventory_sha256: 'a'.repeat(64),
  cold_resource_inventory_sha256: 'b'.repeat(64),
  cold_resource_count: 42,
  student_count: 3,
  managed_file_count: 4,
  managed_file_bytes: 2048,
  missing_file_count: 1,
  non_ready_file_count: 0,
  unmanaged_reference_count: 0,
  archive_count: 2,
  gradex_extract_count: 1,
  storage_counts: { 'classroom-archives': 2 },
  resource_counts: { classroom_cold_tombstones: 1 },
  retention: { mode: 'scheduled' as const, delete_after: '2099-08-20T04:00:00.000Z' },
  conflicting_operation: null,
  deletion_available: true,
  unavailable_reason: null,
}

const runningOperation = {
  operation_id: OPERATION_ID,
  classroom_id: CLASSROOM_ID,
  status: 'deleting_objects',
  retryable: null,
  error_code: null,
  attempt_count: 1,
  resource_counts: { classroom_cold_tombstones: 1 },
  storage_object_counts: { pending: 4 },
  completed_at: null,
}

describe('ColdClassroomPurgeDialog', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('explains recovery loss, preservation boundaries, and early retention override', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ impact, operation: null }),
    })))
    const onClose = vi.fn()
    render(
      <ColdClassroomPurgeDialog
        classroomId={CLASSROOM_ID}
        archiveId={ARCHIVE_ID}
        classroomTitle="Stored Biology"
        isOpen
        onClose={onClose}
        onCompleted={vi.fn()}
      />,
    )

    const dialog = await screen.findByRole('dialog', {
      name: 'Delete stored classroom permanently?',
    })
    expect(dialog).toHaveTextContent('This cannot be undone.')
    expect(dialog).toHaveTextContent(/no longer be able to restore or recover/)
    expect(dialog).toHaveTextContent(/User accounts, Course Blueprints, other classrooms/)
    expect(dialog).toHaveTextContent(/before its scheduled retention date of Aug 20, 2099/)
    expect(dialog).toHaveTextContent(/2 classroom archives and 1 related Gradex extract/)
    expect(dialog).toHaveTextContent(/1 registered file is already absent from Storage/)

    const button = within(dialog).getByRole('button', { name: 'Delete permanently' })
    expect(button).toBeDisabled()
    expect(dialog).toContainElement(document.activeElement)
    const confirmation = within(dialog).getByRole('textbox', {
      name: /Type “Stored Biology” or DELETE STORED ARCHIVE to confirm/,
    })
    fireEvent.change(confirmation, {
      target: { value: 'DELETE STORED ARCHIVE' },
    })
    expect(button).toBeEnabled()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })

  it('posts the exact archive identity and inventory digests, then resumes to completion', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(OPERATION_ID)
    const completedOperation = {
      ...runningOperation,
      status: 'completed',
      storage_object_counts: { deleted: 4 },
      completed_at: '2026-08-09T20:00:00.000Z',
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ impact, operation: null }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ operation: runningOperation }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ operation: completedOperation, advanced: true }),
      })
    vi.stubGlobal('fetch', fetchMock)
    const onCompleted = vi.fn()
    render(
      <ColdClassroomPurgeDialog
        classroomId={CLASSROOM_ID}
        archiveId={ARCHIVE_ID}
        classroomTitle="Stored Biology"
        isOpen
        onClose={vi.fn()}
        onCompleted={onCompleted}
      />,
    )

    fireEvent.change(await screen.findByRole('textbox'), {
      target: { value: 'Stored Biology' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))

    await waitFor(() => expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `/api/teacher/classrooms/${CLASSROOM_ID}/archives/${ARCHIVE_ID}/purge`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          operation_id: OPERATION_ID,
          confirmation: 'Stored Biology',
          expected_source_revision: 8,
          expected_storage_inventory_sha256: 'a'.repeat(64),
          expected_cold_resource_inventory_sha256: 'b'.repeat(64),
        }),
      }),
    ))
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      `/api/teacher/classrooms/${CLASSROOM_ID}/archives/${ARCHIVE_ID}/purge/${OPERATION_ID}/tick`,
      { method: 'POST' },
    )
    await waitFor(() => expect(onCompleted).toHaveBeenCalledOnce())
  })

  it('stops safely when another worker owns the live lease', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ impact, operation: runningOperation }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ operation: runningOperation, advanced: false }),
      })
    vi.stubGlobal('fetch', fetchMock)
    render(
      <ColdClassroomPurgeDialog
        classroomId={CLASSROOM_ID}
        archiveId={ARCHIVE_ID}
        classroomTitle="Stored Biology"
        isOpen
        onClose={vi.fn()}
        onCompleted={vi.fn()}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Continue deletion' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /waiting safely for another request or retry window/,
    )
    expect(screen.getByText(/recovery archive is deleted last/i)).toBeInTheDocument()
  })
})
