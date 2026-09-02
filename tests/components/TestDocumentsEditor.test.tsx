import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TestDocumentsEditor } from '@/components/TestDocumentsEditor'

const { uploadFileDirectly } = vi.hoisted(() => ({ uploadFileDirectly: vi.fn() }))
vi.mock('@/lib/direct-storage-upload', () => ({ uploadFileDirectly }))

describe('TestDocumentsEditor', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('exposes document types as keyboard-navigable tabs without adding a panel tab stop', async () => {
    const user = userEvent.setup()
    render(<TestDocumentsEditor testId="test-1" isEditable />)

    fireEvent.click(screen.getByRole('button', { name: 'Add Document' }))

    const linkTab = screen.getByRole('tab', { name: 'Link' })
    expect(linkTab).toHaveAttribute('aria-selected', 'true')
    expect(linkTab).toHaveAttribute('tabindex', '0')

    linkTab.focus()
    fireEvent.keyDown(linkTab, { key: 'End' })

    const textTab = screen.getByRole('tab', { name: 'Text' })
    expect(textTab).toHaveFocus()
    expect(textTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: 'Text' })).not.toHaveAttribute('tabindex')

    await user.tab()
    expect(screen.getByRole('textbox', { name: 'Document title' })).toHaveFocus()
  })

  it('persists the managed object identity returned by a PDF upload', async () => {
    const onDocumentsChange = vi.fn()
    const openMock = vi.spyOn(window, 'open').mockImplementation(() => null)
    uploadFileDirectly.mockResolvedValueOnce({
      managed_object_id: '30000000-0000-4000-8000-000000000001',
      storage_bucket: 'test-documents',
      storage_path: 'test-1/document-1/file.pdf',
    })
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        test: {
          documents: [{
            id: 'document-1',
            title: 'file.pdf',
            source: 'upload',
            storage_bucket: 'test-documents',
            storage_path: 'test-1/document-1/file.pdf',
            managed_object_id: '30000000-0000-4000-8000-000000000001',
          }],
        },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('crypto', { randomUUID: () => 'document-1' })
    render(
      <TestDocumentsEditor
        testId="test-1"
        isEditable
        onDocumentsChange={onDocumentsChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Add Document' }))
    fireEvent.click(screen.getByRole('tab', { name: 'PDF' }))
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')
    expect(input).not.toBeNull()
    fireEvent.change(input!, {
      target: { files: [new File(['pdf'], 'file.pdf', { type: 'application/pdf' })] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Upload pdf document' }))

    await vi.waitFor(() => expect(onDocumentsChange).toHaveBeenCalledWith([
      expect.objectContaining({
        managed_object_id: '30000000-0000-4000-8000-000000000001',
        storage_bucket: 'test-documents',
        storage_path: 'test-1/document-1/file.pdf',
      }),
    ]))
    expect(uploadFileDirectly).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: '/api/teacher/tests/test-1/documents/upload',
      metadata: { document_id: 'document-1' },
    }))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).documents[0]).toEqual(
      expect.objectContaining({
        managed_object_id: '30000000-0000-4000-8000-000000000001',
        storage_bucket: 'test-documents',
        storage_path: 'test-1/document-1/file.pdf',
      }),
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Open file.pdf' }))
    expect(openMock).toHaveBeenCalledWith(
      '/api/teacher/tests/test-1/documents/document-1/file',
      '_blank',
      'noopener,noreferrer',
    )
  })
})
