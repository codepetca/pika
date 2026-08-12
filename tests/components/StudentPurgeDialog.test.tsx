import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StudentPurgeDialog } from '@/components/StudentPurgeDialog'

const CLASSROOM_ID = '10000000-0000-4000-8000-000000000001'
const STUDENT_ID = '20000000-0000-4000-8000-000000000001'
const EMAIL = 'student@example.com'

function impact(overrides: Record<string, unknown> = {}) {
  return {
    classroom_id: CLASSROOM_ID,
    classroom_title: 'Biology',
    student_id: STUDENT_ID,
    student_email: EMAIL,
    source_revision: 7,
    storage_inventory_sha256: 'a'.repeat(64),
    relational_inventory_sha256: 'b'.repeat(64),
    relational_row_count: 18,
    managed_file_count: 3,
    managed_file_bytes: 2048,
    archive_count: 1,
    gradex_extract_count: 1,
    resource_counts: { entries: 2 },
    storage_counts: { student_inline_image: 1, classroom_archive: 1, gradex_extract: 1 },
    conflicting_operation: null,
    deletion_available: true,
    unavailable_reason: null,
    ...overrides,
  }
}

describe('StudentPurgeDialog', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('states the exact deletion and preservation contract and requires the case-sensitive email', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ impact: impact(), operation: null }),
    })))
    const onClose = vi.fn()
    render(<StudentPurgeDialog
      classroomId={CLASSROOM_ID}
      classroomTitle="Biology"
      studentId={STUDENT_ID}
      studentEmail={EMAIL}
      studentName="Ada Lovelace"
      isOpen
      onClose={onClose}
      onCompleted={vi.fn()}
    />)

    const dialog = await screen.findByRole('dialog', { name: 'Purge this student’s classroom data?' })
    expect(dialog).toHaveTextContent(/submissions, tests, grades, attendance/)
    expect(dialog).toHaveTextContent(/user account and data in other classrooms are kept/i)
    expect(dialog).toHaveTextContent(/archive copies and Gradex extracts/)
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toContainElement(document.activeElement)
    const purge = within(dialog).getByRole('button', { name: 'Purge classroom data' })
    expect(purge).toBeDisabled()
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'STUDENT@example.com' } })
    expect(purge).toBeDisabled()
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: EMAIL } })
    expect(purge).toBeEnabled()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })

  it('keeps provider-blocked targets fail closed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        impact: impact({
          deletion_available: false,
          unavailable_reason: 'student_purge_external_erasure_required',
        }),
        operation: null,
      }),
    })))
    render(<StudentPurgeDialog
      classroomId={CLASSROOM_ID}
      classroomTitle="Biology"
      studentId={STUDENT_ID}
      studentEmail={EMAIL}
      studentName="Ada Lovelace"
      isOpen
      onClose={vi.fn()}
      onCompleted={vi.fn()}
    />)
    expect(await screen.findByText('student_purge_external_erasure_required')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Purge classroom data' })).toBeDisabled()
  })
})
