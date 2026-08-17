import { startTransition, Suspense, useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UploadRosterModal } from '@/components/UploadRosterModal'

describe('UploadRosterModal', () => {
  afterEach(() => vi.unstubAllGlobals())

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

  it.each([
    { outcome: 'success', ok: true },
    { outcome: 'failure', ok: false },
  ])('keeps the committed classroom active after an abandoned transition ($outcome)', async ({ ok }) => {
    let resolveUpload: (() => void) | null = null
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => {
      resolveUpload = () => resolve({
        ok,
        json: () => Promise.resolve(ok
          ? { totalProcessed: 1, upsertedCount: 1, errors: [] }
          : { error: 'Upload failed' }),
      })
    })))
    const onClose = vi.fn()
    const onSuccess = vi.fn()
    const suspended = new Promise<never>(() => {})

    function SuspendClassroomB({ classroomId }: { classroomId: string }) {
      if (classroomId === 'classroom-b') throw suspended
      return null
    }

    function Harness() {
      const [classroomId, setClassroomId] = useState('classroom-a')
      return (
        <>
          <button
            type="button"
            onClick={() => startTransition(() => setClassroomId('classroom-b'))}
          >
            Switch classroom
          </button>
          <Suspense fallback={<div>Switching</div>}>
            <UploadRosterModal
              isOpen
              onClose={onClose}
              classroomId={classroomId}
              onSuccess={onSuccess}
            />
            <SuspendClassroomB classroomId={classroomId} />
          </Suspense>
        </>
      )
    }

    render(<Harness />)
    const csvFile = new File(['csv'], 'a.csv', { type: 'text/csv' })
    Object.defineProperty(csvFile, 'text', {
      value: vi.fn().mockResolvedValue('A classroom CSV'),
    })
    fireEvent.change(screen.getByLabelText('Choose CSV file'), {
      target: { files: [csvFile] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }))
    expect(await screen.findByRole('button', { name: 'Uploading...' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Switch classroom', hidden: true }))
    expect(screen.queryByText('Switching')).not.toBeInTheDocument()

    await act(async () => {
      resolveUpload?.()
    })

    if (ok) {
      expect(onSuccess).toHaveBeenCalledWith('classroom-a')
      expect(onClose).toHaveBeenCalledTimes(1)
    } else {
      expect(await screen.findByText('Upload failed')).toBeInTheDocument()
      expect(onSuccess).not.toHaveBeenCalled()
      expect(onClose).not.toHaveBeenCalled()
    }
    if (ok) {
      expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled()
    } else {
      expect(screen.getByRole('button', { name: 'Upload' })).toBeEnabled()
    }
  })

  it.each([
    { lifecycle: 'close and reopen', ok: true },
    { lifecycle: 'close and reopen', ok: false },
    { lifecycle: 'unmount', ok: true },
    { lifecycle: 'unmount', ok: false },
  ])('ignores an in-flight $lifecycle completion (ok: $ok)', async ({ lifecycle, ok }) => {
    let resolveUpload: (() => void) | null = null
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => {
      resolveUpload = () => resolve({
        ok,
        json: () => Promise.resolve(ok
          ? { totalProcessed: 1, upsertedCount: 1, errors: [] }
          : { error: 'Upload failed' }),
      })
    })))
    const onClose = vi.fn()
    const onSuccess = vi.fn()
    const modal = (isOpen: boolean) => (
      <UploadRosterModal
        isOpen={isOpen}
        onClose={onClose}
        classroomId="classroom-a"
        onSuccess={onSuccess}
      />
    )
    const view = render(modal(true))
    const csvFile = new File(['csv'], 'a.csv', { type: 'text/csv' })
    Object.defineProperty(csvFile, 'text', {
      value: vi.fn().mockResolvedValue('A classroom CSV'),
    })

    fireEvent.change(screen.getByLabelText('Choose CSV file'), {
      target: { files: [csvFile] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }))
    expect(await screen.findByRole('button', { name: 'Uploading...' })).toBeDisabled()

    if (lifecycle === 'unmount') {
      view.unmount()
    } else {
      view.rerender(modal(false))
      view.rerender(modal(true))
      expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled()
    }

    await act(async () => {
      resolveUpload?.()
    })

    if (ok) {
      expect(onSuccess).toHaveBeenCalledWith('classroom-a')
    } else {
      expect(onSuccess).not.toHaveBeenCalled()
    }
    expect(onClose).not.toHaveBeenCalled()
    if (lifecycle !== 'unmount') {
      expect(screen.queryByText('Upload failed')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled()
    }
  })
})
