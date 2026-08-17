import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { UploadRosterModal } from '@/components/UploadRosterModal'

describe('UploadRosterModal', () => {
  it('does not expose an earlier classroom CSV confirmation after switching classrooms', async () => {
    let resolvePreview: (() => void) | null = null
    const fetchMock = vi.fn(() => new Promise((resolve) => {
      resolvePreview = () => resolve({
        ok: true,
        json: () => Promise.resolve({
          needsConfirmation: true,
          changes: [],
          updateCount: 1,
          newCount: 0,
          totalCount: 1,
        }),
      })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const onClose = vi.fn()
    const onSuccess = vi.fn()
    const view = render(
      <UploadRosterModal
        isOpen
        onClose={onClose}
        classroomId="classroom-a"
        onSuccess={onSuccess}
      />,
    )
    const csvFile = new File(['student_number,first_name,last_name,email\n1,Ada,Lovelace,ada@example.com'], 'a.csv', {
      type: 'text/csv',
    })
    Object.defineProperty(csvFile, 'text', {
      value: vi.fn().mockResolvedValue('A classroom CSV'),
    })
    fireEvent.change(screen.getByLabelText('Choose CSV file'), {
      target: { files: [csvFile] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    view.rerender(
      <UploadRosterModal
        isOpen
        onClose={onClose}
        classroomId="classroom-b"
        onSuccess={onSuccess}
      />,
    )

    await act(async () => {
      resolvePreview?.()
    })

    expect(screen.queryByRole('heading', { name: 'Confirm Roster Update' }))
      .not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Upload Roster' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/classroom-a/roster/upload-csv')
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({
      csvData: 'A classroom CSV',
    })
    expect(onClose).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
  })
})
