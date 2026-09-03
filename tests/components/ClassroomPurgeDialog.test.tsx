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
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/attendance-decommission/')) {
        return { ok: false, status: 404, json: async () => ({ error: 'Not found' }) }
      }
      if (init?.method === 'POST') {
        return {
          ok: true,
          status: 202,
          json: async () => ({ operation, advanced: false }),
        }
      }
      return {
        ok: true,
        status: 200,
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
      }
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
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('automatically removes linked attendance before deleting the classroom', async () => {
    const purgeOperationId = '20000000-0000-4000-8000-000000000001'
    const attendanceOperation = {
      operation_id: '30000000-0000-5000-8000-000000000001',
      state: 'fenced',
      deleted_count: 0,
      attendance_removed: false,
      classroom_deleted: false,
    } as const
    const completedAttendance = {
      ...attendanceOperation,
      state: 'local_deleted',
      deleted_count: 24,
      attendance_removed: true,
    } as const
    const completedPurge = {
      operation_id: purgeOperationId,
      classroom_id: CLASSROOM_ID,
      status: 'completed',
      retryable: null,
      error_code: null,
      attempt_count: 1,
      resource_counts: { classrooms: 1 },
      storage_object_counts: { deleted: 2 },
      completed_at: '2026-09-03T12:00:00.000Z',
    } as const
    let purgeReads = 0
    let purgeStarts = 0
    const requestOrder: string[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method || 'GET'
      requestOrder.push(`${method} ${url}`)

      if (url.includes('/attendance-decommission/') && method === 'GET') {
        return { ok: false, status: 404, json: async () => ({ error: 'Not found' }) }
      }
      if (url.endsWith('/attendance-decommission') && method === 'POST') {
        return { ok: true, status: 202, json: async () => ({ operation: attendanceOperation }) }
      }
      if (url.includes('/attendance-decommission/') && method === 'POST') {
        return { ok: true, status: 200, json: async () => ({ operation: completedAttendance }) }
      }
      if (url.endsWith('/purge') && method === 'GET') {
        purgeReads += 1
        return {
          ok: true,
          status: 200,
          json: async () => ({
            impact: {
              classroom_id: CLASSROOM_ID,
              classroom_title: 'Archived Biology',
              source_revision: purgeReads,
              storage_inventory_sha256: (purgeReads === 1 ? 'a' : 'c').repeat(64),
              operational_inventory_sha256: (purgeReads === 1 ? 'b' : 'd').repeat(64),
              relational_row_count: 10,
              student_count: 2,
              managed_file_count: 2,
              managed_file_bytes: 2048,
              missing_file_count: 0,
              archive_count: 0,
              gradex_extract_count: 0,
              interrupted_upload_count: 0,
              resource_counts: { classrooms: 1 },
              storage_counts: { 'submission-images': 2 },
              conflicting_operation: null,
              deletion_available: true,
              unavailable_reason: null,
            },
            operation: null,
          }),
        }
      }
      if (url.endsWith('/purge') && method === 'POST') {
        purgeStarts += 1
        if (purgeStarts === 1) {
          return {
            ok: false,
            status: 409,
            json: async () => ({
              error: 'Attendance must be decommissioned before this classroom can be permanently removed',
            }),
          }
        }
        return { ok: true, status: 200, json: async () => ({ operation: completedPurge }) }
      }
      throw new Error(`Unexpected request: ${method} ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(purgeOperationId)
    const onCompleted = vi.fn()
    render(
      <ClassroomPurgeDialog
        classroomId={CLASSROOM_ID}
        classroomTitle="Archived Biology"
        isOpen
        onClose={vi.fn()}
        onCompleted={onCompleted}
      />,
    )

    fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'DELETE' } })
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))

    await waitFor(() => expect(onCompleted).toHaveBeenCalledOnce())
    expect(purgeReads).toBe(2)
    expect(purgeStarts).toBe(2)
    const firstPurge = requestOrder.findIndex((entry) => entry === 'POST /api/teacher/classrooms/10000000-0000-4000-8000-000000000001/purge')
    const attendanceBegin = requestOrder.findIndex((entry) => entry.endsWith('/attendance-decommission'))
    const attendanceTick = requestOrder.findIndex((entry) => entry.includes('/attendance-decommission/') && entry.startsWith('POST'))
    expect(firstPurge).toBeLessThan(attendanceBegin)
    expect(attendanceBegin).toBeLessThan(attendanceTick)
    expect(attendanceTick).toBeLessThan(requestOrder.lastIndexOf('POST /api/teacher/classrooms/10000000-0000-4000-8000-000000000001/purge'))
  })

  it('shows saved attendance progress while rollout is paused and does not start the classroom purge', async () => {
    const attendanceOperation = {
      operation_id: '30000000-0000-5000-8000-000000000001',
      state: 'fenced',
      deleted_count: 7,
      attendance_removed: false,
      classroom_deleted: false,
    } as const
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method || 'GET'
      if (url.endsWith('/purge') && method === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            impact: {
              classroom_id: CLASSROOM_ID,
              classroom_title: 'Archived Biology',
              source_revision: 7,
              storage_inventory_sha256: 'a'.repeat(64),
              operational_inventory_sha256: 'b'.repeat(64),
              relational_row_count: 10,
              student_count: 2,
              managed_file_count: 2,
              managed_file_bytes: 2048,
              missing_file_count: 0,
              archive_count: 0,
              gradex_extract_count: 0,
              interrupted_upload_count: 0,
              resource_counts: { classrooms: 1 },
              storage_counts: { 'submission-images': 2 },
              conflicting_operation: null,
              deletion_available: true,
              unavailable_reason: null,
            },
            operation: null,
          }),
        }
      }
      if (url.includes('/attendance-decommission/') && method === 'GET') {
        return { ok: true, status: 200, json: async () => ({ operation: attendanceOperation }) }
      }
      if (url.includes('/attendance-decommission/') && method === 'POST') {
        return {
          ok: false,
          status: 503,
          json: async () => ({ error: 'Attendance deletion is disabled' }),
        }
      }
      throw new Error(`Unexpected request: ${method} ${url}`)
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

    expect(await screen.findByText('Removing linked attendance…')).toBeInTheDocument()
    expect(screen.getByText('7 attendance records removed. Progress is saved.')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Continue deletion' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Attendance deletion is disabled')
    expect(fetchMock.mock.calls.some(([input, init]) =>
      String(input).endsWith('/purge') && (init as RequestInit | undefined)?.method === 'POST',
    )).toBe(false)
  })

  it('ignores a late impact response after the dialog changes classrooms', async () => {
    const nextClassroomId = '10000000-0000-4000-8000-000000000002'
    type MockResponse = { ok: boolean; status: number; json: () => Promise<unknown> }
    let resolveOldImpact!: (response: MockResponse) => void
    const oldImpact = new Promise<MockResponse>((resolve) => { resolveOldImpact = resolve })
    const impactFor = (classroomId: string, title: string, rows: number) => ({
      classroom_id: classroomId,
      classroom_title: title,
      source_revision: 7,
      storage_inventory_sha256: 'a'.repeat(64),
      operational_inventory_sha256: 'b'.repeat(64),
      relational_row_count: rows,
      student_count: 2,
      managed_file_count: 3,
      managed_file_bytes: 2048,
      missing_file_count: 0,
      archive_count: 0,
      gradex_extract_count: 0,
      interrupted_upload_count: 0,
      resource_counts: { classrooms: 1 },
      storage_counts: { 'submission-images': 1 },
      conflicting_operation: null,
      deletion_available: true,
      unavailable_reason: null,
    })
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/attendance-decommission/')) {
        return { ok: false, status: 404, json: async () => ({ error: 'Not found' }) }
      }
      if (url.includes(`${CLASSROOM_ID}/purge`)) return oldImpact
      if (url.includes(`${nextClassroomId}/purge`)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            impact: impactFor(nextClassroomId, 'Archived Chemistry', 11),
            operation: null,
          }),
        }
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { rerender } = render(
      <ClassroomPurgeDialog
        classroomId={CLASSROOM_ID}
        classroomTitle="Archived Biology"
        isOpen
        onClose={vi.fn()}
        onCompleted={vi.fn()}
      />,
    )
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) =>
      String(input).includes(`${CLASSROOM_ID}/purge`),
    )).toBe(true))

    rerender(
      <ClassroomPurgeDialog
        classroomId={nextClassroomId}
        classroomTitle="Archived Chemistry"
        isOpen
        onClose={vi.fn()}
        onCompleted={vi.fn()}
      />,
    )
    expect(await screen.findByText('11')).toBeInTheDocument()

    resolveOldImpact({
      ok: true,
      status: 200,
      json: async () => ({
        impact: impactFor(CLASSROOM_ID, 'Archived Biology', 99),
        operation: null,
      }),
    })
    await waitFor(() => expect(screen.queryByText('99')).not.toBeInTheDocument())
    expect(screen.getByText('11')).toBeInTheDocument()
  })
})
