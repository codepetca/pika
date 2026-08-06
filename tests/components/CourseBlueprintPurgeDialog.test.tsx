import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { CourseBlueprintPurgeDialog } from '@/components/CourseBlueprintPurgeDialog'

const BLUEPRINT_ID = '10000000-0000-4000-8000-000000000101'

function impact(overrides: Record<string, unknown> = {}) {
  return {
    course_blueprint_id: BLUEPRINT_ID,
    course_blueprint_title: 'Biology Blueprint',
    source_revision: 7,
    authority_mode: 'pika',
    planned_site_published: true,
    planned_site_slug: 'biology-blueprint',
    inventory_sha256: 'a'.repeat(64),
    relational_row_count: 12,
    linked_classroom_count: 2,
    managed_file_count: 3,
    managed_file_bytes: 2048,
    missing_file_count: 0,
    resource_counts: { course_blueprints: 1 },
    storage_counts: { 'test-documents': 3 },
    conflicting_operation: null,
    deletion_available: true,
    unavailable_reason: null,
    ...overrides,
  }
}

describe('CourseBlueprintPurgeDialog', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('explains both deletion and preservation and requires typed confirmation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ impact: impact(), operation: null }),
    })))
    const onClose = vi.fn()
    render(
      <CourseBlueprintPurgeDialog
        courseBlueprintId={BLUEPRINT_ID}
        courseBlueprintTitle="Biology Blueprint"
        isOpen
        onClose={onClose}
        onCompleted={vi.fn()}
      />,
    )

    const dialog = await screen.findByRole('dialog', {
      name: 'Delete Course Blueprint permanently?',
    })
    expect(dialog).toHaveTextContent('This cannot be undone.')
    expect(dialog).toHaveTextContent(/content, saved Versions, assignments, tests/)
    expect(dialog).toHaveTextContent(/uploaded teacher test files/)
    expect(dialog).toHaveTextContent(/Linked Classrooms, their student work and file copies/)
    expect(dialog).toHaveTextContent(/all user accounts are kept/)
    expect(dialog).toHaveTextContent(/published planned course site will also be removed/)
    expect(dialog).toHaveTextContent('2')
    expect(dialog).toHaveTextContent('classrooms kept')
    const deleteButton = within(dialog).getByRole('button', { name: 'Delete permanently' })
    expect(deleteButton).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'DELETE' } })
    expect(deleteButton).toBeEnabled()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })

  it('blocks repository-managed or operationally conflicted deletion', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        impact: impact({
          authority_mode: 'repository',
          conflicting_operation: 'course_blueprint_operation_active',
          deletion_available: false,
          unavailable_reason: 'Switch to Pika as Editor before deleting this Course Blueprint.',
        }),
        operation: null,
      }),
    })))
    render(
      <CourseBlueprintPurgeDialog
        courseBlueprintId={BLUEPRINT_ID}
        courseBlueprintTitle="Biology Blueprint"
        isOpen
        onClose={vi.fn()}
        onCompleted={vi.fn()}
      />,
    )
    const deleteButton = await screen.findByRole('button', { name: 'Delete permanently' })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'DELETE' } })
    expect(deleteButton).toBeDisabled()
    expect(screen.getByText(/Finish the active Blueprint operation/)).toBeInTheDocument()
    expect(screen.getByText(/Switch to Pika as Editor/)).toBeInTheDocument()
  })

  it('stops browser ticks when another worker owns the live lease', async () => {
    const operation = {
      operation_id: '20000000-0000-4000-8000-000000000101',
      course_blueprint_id: BLUEPRINT_ID,
      status: 'deleting_objects',
      retryable: null,
      error_code: null,
      attempt_count: 1,
      resource_counts: { course_blueprints: 1 },
      storage_object_counts: { processing: 1, pending: 1 },
      completed_at: null,
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          impact: impact({
            missing_file_count: 1,
            deletion_available: false,
            unavailable_reason: 'One or more managed files could not be verified.',
          }),
          operation,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ operation, advanced: false }),
      })
    vi.stubGlobal('fetch', fetchMock)
    render(
      <CourseBlueprintPurgeDialog
        courseBlueprintId={BLUEPRINT_ID}
        courseBlueprintTitle="Biology Blueprint"
        isOpen
        onClose={vi.fn()}
        onCompleted={vi.fn()}
      />,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Continue deletion' }))
    await screen.findByText(/waiting safely for another request or retry window/)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries a lost start response with the same durable operation id', async () => {
    const operation = {
      operation_id: '20000000-0000-4000-8000-000000000101',
      course_blueprint_id: BLUEPRINT_ID,
      status: 'completed',
      retryable: false,
      error_code: null,
      attempt_count: 1,
      resource_counts: { course_blueprints: 1 },
      storage_object_counts: { deleted: 1 },
      completed_at: new Date().toISOString(),
    }
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(operation.operation_id)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ impact: impact(), operation: null }),
      })
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ operation }),
      })
    vi.stubGlobal('fetch', fetchMock)
    const onCompleted = vi.fn()
    render(
      <CourseBlueprintPurgeDialog
        courseBlueprintId={BLUEPRINT_ID}
        courseBlueprintTitle="Biology Blueprint"
        isOpen
        onClose={vi.fn()}
        onCompleted={onCompleted}
      />,
    )

    fireEvent.change(await screen.findByRole('textbox'), {
      target: { value: 'DELETE' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
    await screen.findByText('connection lost')
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
    await waitFor(() => expect(onCompleted).toHaveBeenCalledOnce())

    const firstBody = JSON.parse(fetchMock.mock.calls[1][1].body)
    const secondBody = JSON.parse(fetchMock.mock.calls[2][1].body)
    expect(firstBody.operation_id).toBe(operation.operation_id)
    expect(secondBody.operation_id).toBe(operation.operation_id)
  })
})
